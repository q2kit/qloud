import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({
  url,
  onError,
}: {
  url: string;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const container = React.useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = React.useState<{
    url: string;
    pdf: pdfjs.PDFDocumentProxy;
  }>();
  const document = loaded?.url === url ? loaded.pdf : undefined;
  const [page, setPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [width, setWidth] = React.useState(320);
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(100, entry.contentRect.width - 24));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  React.useEffect(() => {
    let alive = true;
    const task = pdfjs.getDocument({
      url,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
    });
    void task.promise
      .then((pdf) => {
        if (alive) setLoaded({ url, pdf });
      })
      .catch(() => {
        if (alive) onError();
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [url, onError]);
  React.useEffect(() => {
    const element = canvas.current;
    if (!document || !element) return;
    let alive = true;
    let render: pdfjs.RenderTask | undefined;
    void document
      .getPage(page)
      .then((pdfPage) => {
        if (!alive) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({
          scale: Math.min(width / original.width, 2) * zoom,
        });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${String(viewport.width)}px`;
        element.style.height = `${String(viewport.height)}px`;
        render = pdfPage.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        return render.promise;
      })
      .catch(() => {
        if (alive) onError();
      });
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [document, page, width, zoom, onError]);
  return (
    <div
      ref={container}
      className="flex h-full min-h-0 w-full flex-1 flex-col"
      data-preview-controls
    >
      <div className="flex flex-wrap items-center justify-center gap-2 p-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!document || page <= 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          {t('preview.pdf.previous')}
        </Button>
        <label className="flex items-center gap-1 text-sm">
          {t('preview.pdf.page')}
          <input
            aria-label={t('preview.pdf.page')}
            className="w-14 rounded border border-border bg-background px-1"
            type="number"
            min={1}
            max={document?.numPages ?? 1}
            value={page}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (
                document &&
                Number.isInteger(next) &&
                next >= 1 &&
                next <= document.numPages
              )
                setPage(next);
            }}
          />
          / {document?.numPages ?? 0}
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={!document || page >= document.numPages}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {t('preview.pdf.next')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={zoom <= 0.5}
          onClick={() => {
            setZoom(Math.max(0.5, zoom - 0.25));
          }}
        >
          {t('preview.pdf.zoomOut')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={zoom >= 3}
          onClick={() => {
            setZoom(Math.min(3, zoom + 0.25));
          }}
        >
          {t('preview.pdf.zoomIn')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setZoom(1);
          }}
        >
          {t('preview.pdf.fit')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <canvas
          ref={canvas}
          role="img"
          aria-label={t('preview.pdf.canvas', { page })}
          className="mx-auto bg-white"
        />
      </div>
    </div>
  );
}
