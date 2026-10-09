// Lịch sử tìm kiếm theo từng người trên máy này: từ khóa gần đây, hồ sơ/trang vừa mở, số lần dùng
// (để đưa thao tác hay dùng lên đầu). Chỉ là tiện ích — lỗi bộ nhớ trình duyệt thì coi như trống.

import type { SearchEntry } from './searchTypes';

const MAX_QUERIES = 8;
const MAX_OPENED = 10;

/** Phần của dòng kết quả đủ để mở lại — không lưu số liệu, trạng thái hay dữ liệu nhạy cảm. */
export type RememberedEntry = Pick<SearchEntry, 'key' | 'kind' | 'group' | 'title' | 'code' | 'context' | 'route' | 'routeState' | 'modal' | 'command' | 'needsProject'>;

interface HistoryState {
  queries: string[];
  opened: RememberedEntry[];
  usage: Record<string, number>;
}

const EMPTY: HistoryState = { queries: [], opened: [], usage: {} };
const storageKey = (userId: string) => `vioo_search_history:${userId}`;

export const readHistory = (userId: string | null | undefined): HistoryState => {
  if (!userId) return EMPTY;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || 'null');
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    return {
      queries: Array.isArray(parsed.queries) ? parsed.queries.filter((q: unknown) => typeof q === 'string').slice(0, MAX_QUERIES) : [],
      opened: Array.isArray(parsed.opened) ? parsed.opened.filter((e: any) => e && typeof e.key === 'string' && typeof e.title === 'string').slice(0, MAX_OPENED) : [],
      usage: parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {},
    };
  } catch {
    return EMPTY;
  }
};

const write = (userId: string, state: HistoryState) => {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(state)); } catch { /* bộ nhớ đầy hoặc bị chặn — bỏ qua */ }
};

export const rememberQuery = (userId: string | null | undefined, query: string): HistoryState => {
  const text = query.trim();
  const state = readHistory(userId);
  if (!userId || text.length < 2) return state;
  const next = { ...state, queries: [text, ...state.queries.filter(q => q.toLowerCase() !== text.toLowerCase())].slice(0, MAX_QUERIES) };
  write(userId, next);
  return next;
};

export const rememberOpened = (userId: string | null | undefined, entry: SearchEntry): HistoryState => {
  const state = readHistory(userId);
  if (!userId) return state;
  const remembered: RememberedEntry = {
    key: entry.key, kind: entry.kind, group: entry.group, title: entry.title, code: entry.code, context: entry.context,
    route: entry.route, routeState: entry.routeState, modal: entry.modal, command: entry.command, needsProject: entry.needsProject,
  };
  const usage = { ...state.usage, [entry.key]: Math.min((state.usage[entry.key] || 0) + 1, 999) };
  // Không giữ quá nhiều khóa cũ.
  const keys = Object.keys(usage);
  if (keys.length > 200) keys.sort((a, b) => usage[a] - usage[b]).slice(0, keys.length - 200).forEach(key => delete usage[key]);
  const opened = entry.command ? state.opened : [remembered, ...state.opened.filter(item => item.key !== entry.key)].slice(0, MAX_OPENED);
  const next = { ...state, opened, usage };
  write(userId, next);
  return next;
};

export const forgetQueries = (userId: string | null | undefined): HistoryState => {
  const state = readHistory(userId);
  if (!userId) return state;
  const next = { ...state, queries: [] };
  write(userId, next);
  return next;
};
