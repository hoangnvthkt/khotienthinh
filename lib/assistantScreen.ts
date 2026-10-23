// Màn vừa mở (Đợt 1 hỗ trợ, chủ SP 23/10/2026): Trợ lý trả lời "sao em không làm được…" cần biết người dùng vừa ở màn nào và máy vừa báo
// lỗi gì. Chỉ giữ trong bộ nhớ tab (như lib/clientErrorLog.ts); chỉ gửi kèm khi người dùng tự hỏi Trợ lý. Không giữ tham số lọc / tìm kiếm
// trên đường dẫn (có thể chứa chữ người dùng gõ) — chỉ đường dẫn + vài tham số chọn tab.
import { recentClientErrors, type ClientError } from './clientErrorLog';

export interface ScreenNote { path: string; title: string | null; at: string }
export interface ScreenContext { path: string; title: string | null; minutesAgo: number; errors: Array<Pick<ClientError, 'at' | 'kind' | 'text'>> }

/** Tham số giữ lại: chỉ những tham số chọn tab / chế độ xem, không giữ ô tìm, bộ lọc, mã một lần. */
const KEEP_PARAMS = ['tab', 'mode', 'view', 'section'];
/** Màn không phải "màn làm việc": trang chủ, Trung tâm điều hành (nơi có Trợ lý), đăng nhập. */
const SKIP = /^\/(login|reset-password|center)?\/?$/;
const SCREEN_WINDOW_MS = 60 * 60_000;

let last: ScreenNote | null = null;

export const screenPath = (raw: string): string | null => {
  const [pathPart, query = ''] = String(raw || '').split('#')[0].split('?');
  const path = `/${pathPart.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
  if (SKIP.test(path) || path.length > 200) return null;
  const params = new URLSearchParams(query);
  const kept = KEEP_PARAMS.filter(k => params.get(k)).map(k => `${k}=${encodeURIComponent(String(params.get(k)).slice(0, 40))}`);
  return kept.length ? `${path}?${kept.join('&')}` : path;
};

/** Ghi màn người dùng vừa mở (đổi đường dẫn ở giao diện cũ, mở / chuyển tab ở Trung tâm điều hành). */
export const noteScreen = (raw: string, title?: string | null, now: Date = new Date()) => {
  const path = screenPath(raw);
  if (!path) return;
  const t = (title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;
  // Cùng màn mà lần này không có tên thì giữ tên cũ.
  last = { path, title: t ?? (last?.path === path ? last.title : null), at: now.toISOString() };
};

export const lastScreen = (): ScreenNote | null => last;
export const clearScreen = () => { last = null; };

/** Ngữ cảnh gửi kèm câu hỏi: màn mở trong 60 phút gần đây + tối đa 5 lỗi 30 phút gần đây; không có gì thì null. */
export const screenContextFor = (now: Date = new Date()): ScreenContext | null => {
  const errors = recentClientErrors(now).slice(-5).map(e => ({ at: e.at, kind: e.kind, text: e.text }));
  const fresh = last && now.getTime() - new Date(last.at).getTime() <= SCREEN_WINDOW_MS ? last : null;
  if (!fresh && !errors.length) return null;
  return {
    path: fresh?.path ?? '',
    title: fresh?.title ?? null,
    minutesAgo: fresh ? Math.max(0, Math.round((now.getTime() - new Date(fresh.at).getTime()) / 60_000)) : -1,
    errors,
  };
};
