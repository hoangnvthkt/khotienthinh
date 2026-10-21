// Nháp form trên thẻ Trợ lý (đơn mua, đề xuất vật tư) — chủ SP 19/10/2026: rời tab / tải lại trang rồi quay lại thì form vẫn giữ
// nguyên những gì đang sửa (trước đây trạng thái chỉ nằm trong React nên mất, người dùng tưởng "đơn bị tải lại").
// Lưu ở localStorage theo id lệnh (không gọi máy chủ, không tốn lượt AI); xóa khi gửi xong / bỏ; tự dọn bản cũ quá 7 ngày hoặc quá 20 bản.
const PREFIX = 'vioo.assistant.formDraft.';
const MAX_ENTRIES = 20;
const TTL_MS = 7 * 24 * 3600_000;

interface Stored<T> { savedAt: number; data: T }

const keyOf = (commandId: string) => `${PREFIX}${commandId}`;
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const readFormDraft = <T,>(commandId: string, now = Date.now()): T | null => safe(() => {
  const raw = localStorage.getItem(keyOf(commandId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Stored<T>;
  if (!parsed || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > TTL_MS) { localStorage.removeItem(keyOf(commandId)); return null; }
  return parsed.data ?? null;
}, null);

export const writeFormDraft = <T,>(commandId: string, data: T, now = Date.now()): void => safe(() => {
  localStorage.setItem(keyOf(commandId), JSON.stringify({ savedAt: now, data } satisfies Stored<T>));
  pruneFormDrafts(now);
}, undefined);

export const clearFormDraft = (commandId: string): void => safe(() => localStorage.removeItem(keyOf(commandId)), undefined);

/** Bỏ bản quá hạn; quá MAX_ENTRIES thì bỏ bản cũ nhất. */
export const pruneFormDrafts = (now = Date.now()): void => safe(() => {
  const entries: Array<{ key: string; savedAt: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const savedAt = safe(() => (JSON.parse(localStorage.getItem(key) || 'null') as Stored<unknown> | null)?.savedAt ?? 0, 0);
    entries.push({ key, savedAt });
  }
  const stale = entries.filter(e => now - e.savedAt > TTL_MS);
  stale.forEach(e => localStorage.removeItem(e.key));
  const live = entries.filter(e => now - e.savedAt <= TTL_MS).sort((a, b) => a.savedAt - b.savedAt);
  live.slice(0, Math.max(0, live.length - MAX_ENTRIES)).forEach(e => localStorage.removeItem(e.key));
}, undefined);

/** Ghi trễ (debounce) để không ghi mỗi phím: trả hàm hủy cho useEffect. */
export const scheduleFormDraft = <T,>(commandId: string, data: T, delayMs = 400): (() => void) => {
  const t = setTimeout(() => writeFormDraft(commandId, data), delayMs);
  return () => clearTimeout(t);
};
