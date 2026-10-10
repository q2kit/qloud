import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  render: vi.fn(),
  cancel: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
}));
import PdfPreview from './pdf-preview';

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  mocks.render.mockReturnValue({
    promise: Promise.resolve(),
    cancel: mocks.cancel,
  });
  mocks.getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: mocks.render,
  });
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 2, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  });
});

it('renders one page at a time, switches pages, zooms and destroys tasks on close', async () => {
  const user = userEvent.setup();
  const onError = vi.fn();
  const view = render(
    <PdfPreview url="https://storage.example/pdf" onError={onError} />,
  );
  await waitFor(() => {
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });
  expect(mocks.getPage).toHaveBeenLastCalledWith(1);
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => {
    expect(mocks.getPage).toHaveBeenLastCalledWith(2);
  });
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Zoom in' }));
  await waitFor(() => {
    expect(mocks.render).toHaveBeenCalledTimes(3);
  });
  expect(mocks.cancel).toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
});

it('keeps the page when a signed URL is refreshed and cancels the old document', async () => {
  const user = userEvent.setup();
  const onError = vi.fn();
  const view = render(
    <PdfPreview url="https://storage.example/old" onError={onError} />,
  );
  await waitFor(() => {
    expect(mocks.render).toHaveBeenCalled();
  });
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  let resolve!: (pdf: {
    numPages: number;
    getPage: typeof mocks.getPage;
  }) => void;
  mocks.getDocument.mockReturnValueOnce({
    promise: new Promise((done) => {
      resolve = done;
    }),
    destroy: mocks.destroy,
  });
  const oldCalls = mocks.getPage.mock.calls.length;
  const refreshedError = vi.fn();
  view.rerender(
    <PdfPreview url="https://storage.example/new" onError={refreshedError} />,
  );
  await waitFor(() => {
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  expect(mocks.getPage).toHaveBeenCalledTimes(oldCalls);
  resolve({ numPages: 2, getPage: mocks.getPage });
  await waitFor(() => {
    expect(mocks.getPage).toHaveBeenCalledTimes(oldCalls + 1);
  });
  expect(refreshedError).not.toHaveBeenCalled();
  expect(screen.getByRole('spinbutton', { name: 'Page' })).toHaveValue(2);
});

it('reports PDF load errors instead of leaving a blank canvas', async () => {
  const onError = vi.fn();
  mocks.getDocument.mockReturnValue({
    promise: Promise.reject(new Error('Invalid PDF')),
    destroy: mocks.destroy,
  });
  render(<PdfPreview url="https://storage.example/bad" onError={onError} />);
  await waitFor(() => {
    expect(onError).toHaveBeenCalledOnce();
  });
});
