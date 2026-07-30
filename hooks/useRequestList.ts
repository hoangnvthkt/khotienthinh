import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRuntimeService, type RequestListItem } from '../lib/requestRuntimeService';
import { mergeRequestPage, requestQueryKey, type RequestQueryFilter } from '../lib/requestQueryState';

export type RequestListFilter = RequestQueryFilter;
export interface UseRequestListResult {
  items: RequestListItem[];
  nextCursor: { createdAt: string; id: string } | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
}

const PAGE_SIZE = 40;

export const useRequestList = (filter: RequestListFilter): UseRequestListResult => {
  const queryKey = useMemo(() => requestQueryKey(filter), [filter]);
  const [debouncedFilter, setDebouncedFilter] = useState(filter);
  const [items, setItems] = useState<RequestListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<UseRequestListResult['nextCursor']>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilter({ ...filter, search: filter.search?.trim() || undefined }), 300);
    return () => window.clearTimeout(timer);
  }, [queryKey]);

  const refresh = useCallback(async () => {
    const token = ++tokenRef.current;
    setLoading(true); setError(null);
    try {
      const page = await requestRuntimeService.list({ ...debouncedFilter, limit: PAGE_SIZE });
      if (token !== tokenRef.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? null);
    } catch (cause) {
      if (token === tokenRef.current) setError(cause instanceof Error ? cause : new Error('Không thể tải danh sách đề xuất.'));
    } finally { if (token === tokenRef.current) setLoading(false); }
  }, [debouncedFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const token = tokenRef.current;
    setLoadingMore(true);
    try {
      const page = await requestRuntimeService.list({ ...debouncedFilter, cursor: nextCursor, limit: PAGE_SIZE });
      if (token !== tokenRef.current) return;
      setItems(current => mergeRequestPage(current, page.items));
      setNextCursor(page.nextCursor ?? null);
    } catch (cause) {
      if (token === tokenRef.current) setError(cause instanceof Error ? cause : new Error('Không thể tải thêm đề xuất.'));
    } finally { if (token === tokenRef.current) setLoadingMore(false); }
  }, [debouncedFilter, loadingMore, nextCursor]);

  return { items, nextCursor, loading, loadingMore, error, loadMore, refresh };
};
