// Sổ lỗi gần nhất trên máy người dùng (B2, chủ SP 21/10/2026) — chỉ giữ trong bộ nhớ tab (không gửi đi đâu, không lưu máy chủ);
// được đính vào phiếu sự cố KHI người dùng bấm Gửi Admin, để Admin thấy "máy báo gì" cạnh lời kể + ảnh. Giữ 10 dòng gần nhất:
// lệnh máy chủ trả lỗi (mã HTTP, không kèm nội dung), lỗi JS, promise bị bỏ rơi. Không ghi URL có tham số (tránh lộ dữ liệu).
export interface ClientError { at: string; kind: 'http' | 'js' | 'promise'; text: string }

const MAX = 10;
const log: ClientError[] = [];
const clip = (s: string, n = 160) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export const recordClientError = (kind: ClientError['kind'], text: string, now: () => Date = () => new Date()) => {
  const t = clip(text);
  if (!t) return;
  const last = log[log.length - 1];
  if (last && last.kind === kind && last.text === t && now().getTime() - new Date(last.at).getTime() < 5_000) return; // lặp liên tiếp
  log.push({ at: now().toISOString(), kind, text: t });
  if (log.length > MAX) log.splice(0, log.length - MAX);
};

/** Lệnh máy chủ trả lỗi: chỉ giữ phương thức + đường dẫn (không query, không body) + mã. */
export const recordHttpError = (method: string, url: string, status: number) => {
  let path = url;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0]; }
  // Chỉ quan tâm REST / RPC / hàm Edge / storage của Supabase; lỗi xác thực 401 thường là phiên hết hạn (đã có luồng riêng).
  if (!/\/(rest|functions|storage)\/v1\//.test(path) || status === 401) return;
  recordClientError('http', `${method} ${path.replace(/^.*\/v1\//, '')} → ${status}`);
};

/** Lỗi trong khoảng thời gian gần đây (mặc định 30 phút), mới nhất sau cùng. */
export const recentClientErrors = (now: Date = new Date(), windowMs = 30 * 60_000): ClientError[] =>
  log.filter(e => now.getTime() - new Date(e.at).getTime() <= windowMs);

export const clearClientErrors = () => { log.length = 0; };

/** Dòng chữ gọn để đính vào phiếu (≤ 5 dòng). */
export const clientErrorsText = (errors: ClientError[]) => errors.slice(-5)
  .map(e => `- ${new Date(e.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${e.kind === 'http' ? 'máy chủ' : e.kind === 'js' ? 'lỗi JS' : 'lỗi nền'}: ${e.text}`).join('\n');

let installed = false;
/** Gắn một lần ở khởi động app: lỗi JS và promise bị bỏ rơi. */
export const installClientErrorLog = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', ev => recordClientError('js', ev.message || String(ev.error || 'lỗi không rõ')));
  window.addEventListener('unhandledrejection', ev => {
    const r = (ev as PromiseRejectionEvent).reason;
    recordClientError('promise', r instanceof Error ? r.message : typeof r === 'string' ? r : 'promise bị bỏ rơi');
  });
};
