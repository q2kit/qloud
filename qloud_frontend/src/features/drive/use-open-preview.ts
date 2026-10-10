import { useSearchParams } from 'react-router';
import type { DriveNode } from './api';
import { compactId } from './paths';

export function useOpenPreview() {
  const [params, setParams] = useSearchParams();
  return (node: DriveNode) => {
    const next = new URLSearchParams(params);
    next.set('preview', compactId(node.id));
    setParams(next, { state: { openedPreview: true } });
  };
}
