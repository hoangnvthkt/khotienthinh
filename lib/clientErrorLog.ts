// Sổ lỗi gần nhất trên máy người dùng (B2, chủ SP 21/10/2026) — chỉ giữ trong bộ nhớ tab, không lưu máy chủ; chỉ rời máy khi người dùng
// tự bấm Gửi Admin (đính vào phiếu sự cố) hoặc tự hỏi Trợ lý (Đợt 1 hỗ trợ 23/10: gửi kèm câu hỏi để Trợ lý giải thích lỗi vừa gặp).
// Giữ 10 dòng gần nhất: lệnh máy chủ trả lỗi (mã HTTP + mã lỗi / câu báo của máy chủ, cắt ngắn), lời báo lỗi / cảnh báo màn hình vừa hiện
// (toast), lỗi JS, promise bị bỏ rơi. Không ghi URL có tham số (tránh lộ dữ liệu).
export interface ClientError { at: string; kind: 'http' | 'js' | 'promise' | 'ui'; text: string }

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

/** Lệnh máy chủ trả lỗi: phương thức + đường dẫn (không query) + mã HTTP + mã lỗi / câu báo của máy chủ nếu có (detail). */
export const recordHttpError = (method: string, url: string, status: number, detail?: string | null) => {
  let path = url;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0]; }
  // Chỉ quan tâm REST / RPC / hàm Edge / storage của Supabase; lỗi xác thực 401 thường là phiên hết hạn (đã có luồng riêng).
  if (!/\/(rest|functions|storage)\/v1\//.test(path) || status === 401) return;
  const extra = detail ? ` ${clip(detail, 110)}` : '';
  recordClientError('http', `${method} ${path.replace(/^.*\/v1\//, '')} → ${status}${extra}`);
};

/** Mã lỗi + câu báo trong thân trả về của PostgREST / hàm Edge ({code, message} | {error} | chữ): "PT409 Đơn vừa được…". */
export const httpErrorDetail = (body: string): string | null => {
  const text = (body || '').trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const code = typeof o.code === 'string' ? o.code : typeof o.error_code === 'string' ? o.error_code : '';
    const msg = [o.message, o.error, o.msg, o.error_description].find(v => typeof v === 'string' && v.trim()) as string | undefined;
    const out = [code, msg && msg !== code ? msg : ''].filter(Boolean).join(' ');
    return out ? clip(out, 110) : null;
  } catch {
    return /^</.test(text) ? null : clip(text, 110);
  }
};

/** Lời báo lỗi / cảnh báo màn hình vừa hiện cho người dùng (toast). */
export const recordUiMessage = (title: string, message?: string) => recordClientError('ui', message ? `${title}: ${message}` : title);

/** Lỗi trong khoảng thời gian gần đây (mặc định 30 phút), mới nhất sau cùng. */
export const recentClientErrors = (now: Date = new Date(), windowMs = 30 * 60_000): ClientError[] =>
  log.filter(e => now.getTime() - new Date(e.at).getTime() <= windowMs);

export const clearClientErrors = () => { log.length = 0; };

/** Dòng chữ gọn để đính vào phiếu (≤ 5 dòng). */
export const clientErrorsText = (errors: ClientError[]) => errors.slice(-5)
  .map(e => `- ${new Date(e.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${e.kind === 'http' ? 'máy chủ' : e.kind === 'ui' ? 'màn hình báo' : e.kind === 'js' ? 'lỗi JS' : 'lỗi nền'}: ${e.text}`).join('\n');

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
