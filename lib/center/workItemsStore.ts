import { useEffect, useState } from 'react';
import { fetchWorkItems, type InboxTab, type WorkItemsPage } from './workItemsService';

// Một nguồn "Việc chờ tôi" dùng chung cho cột việc, badge Sidebar và Home: gọi RPC một lần,
// nhớ 60 giây, ai gọi mới (hoặc bấm làm mới) thì mọi nơi cùng cập nhật.

const TTL_MS = 60_000;
type Listener = (page: WorkItemsPage) => void;

let minePage: WorkItemsPage | null = null;
let mineAt = 0;
let inflight: Promise<WorkItemsPage> | null = null;
const listeners = new Set<Listener>();

export const loadWorkItemsShared = (tab: InboxTab, options: { force?: boolean } = {}): Promise<WorkItemsPage> => {
  if (tab !== 'mine') return fetchWorkItems(tab);
  if (!options.force && minePage && Date.now() - mineAt < TTL_MS) return Promise.resolve(minePage);
  if (inflight) return inflight;
  inflight = fetchWorkItems('mine').then(page => {
    minePage = page;
    mineAt = Date.now();
    listeners.forEach(listener => listener(page));
    return page;
  }).finally(() => { inflight = null; });
  return inflight;
};

/** Trang "Chờ tôi" dùng chung; null khi chưa tải hoặc không bật. Lỗi → giữ bản cũ (hoặc null), không ném. */
export const useMineWorkItems = (enabled: boolean): WorkItemsPage | null => {
  const [page, setPage] = useState<WorkItemsPage | null>(enabled ? minePage : null);
  useEffect(() => {
    if (!enabled) { setPage(null); return; }
    const listener: Listener = next => setPage(next);
    listeners.add(listener);
    setPage(minePage);
    loadWorkItemsShared('mine').catch(error => console.warn('Center work items (shared) failed:', error));
    return () => { listeners.delete(listener); };
  }, [enabled]);
  return page;
};

/** Dùng trong kiểm thử để xóa bộ nhớ dùng chung. */
export const resetWorkItemsStore = () => { minePage = null; mineAt = 0; inflight = null; listeners.clear(); };
