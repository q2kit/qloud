import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { cursorOf } from '@/features/drive/api';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components, operations } from '@/lib/api/schema';

export type SearchNode = components['schemas']['SearchNode'];
export type SearchFilters = operations['search_list']['parameters']['query'];
export const SEARCH_TYPES = [
  'folder',
  'document',
  'image',
  'video',
  'audio',
  'archive',
  'other',
] as const;

async function search(filters: SearchFilters, signal: AbortSignal) {
  return unwrap(
    await api.GET('/api/v1/search', { params: { query: filters }, signal }),
  );
}

export function useSearchResults(filters: SearchFilters) {
  return useInfiniteQuery({
    queryKey: ['search', 'results', filters],
    queryFn: ({ pageParam, signal }) =>
      search({ ...filters, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    enabled: Boolean(filters.q.trim()),
    retry: false,
  });
}

export function useSearchSuggestions(query: string, open: boolean) {
  const [debounced, setDebounced] = React.useState(query);
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query);
    }, 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);
  const matches = debounced === query;
  const result = useQuery({
    queryKey: ['search', 'suggestions', query],
    queryFn: ({ signal }) => search({ q: query.trim(), page_size: 8 }, signal),
    enabled: open && matches && Boolean(query.trim()),
    retry: false,
  });
  return {
    ...result,
    waiting: Boolean(query.trim()) && !matches,
    nodes: matches ? (result.data?.results ?? []) : [],
  };
}
