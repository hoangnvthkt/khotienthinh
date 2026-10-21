// Kho Đợt 1 — đọc ảnh phiếu giao NCC bằng AI rồi điền vào phiếu chụp (wms_delivery_captures).
// Nhà cung cấp AI chọn bằng biến môi trường (chủ SP 12/10: không cố định một hãng):
//   WMS_AI_PROVIDER = anthropic | gemini | openai   (mặc định anthropic)
//   WMS_AI_MODEL    = tên model (anthropic mặc định claude-opus-5-5; gemini mặc định gemini-2.5-flash; openai bắt buộc khai báo)
//   ANTHROPIC_API_KEY | GEMINI_API_KEY | OPENAI_API_KEY
// Kết nối Admin gán cho "Kho · đọc ảnh phiếu giao" ở Cài đặt → Kết nối (khóa trong Vault) được ưu tiên hơn các biến trên.
// Chưa cấu hình → trả { code: 'AI_NOT_CONFIGURED' } (màn Kho chuyển sang nhập tay). AI không ghi sổ: chỉ điền số liệu để người xem lại.
import { createClient } from '@supabase/supabase-js';
import { DOC_PROMPT, DOC_SCHEMA, normalizeRead } from './prompt.ts';
import { DEFAULT_BASE_URL, parseJsonLoose, targetFromConnection, type AiTarget } from '../_shared/aiTargets.ts';
import { completeWithRetry, type VisionPart } from '../_shared/aiComplete.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

type Provider = 'anthropic' | 'gemini' | 'openai';
const PAGE_MIME: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const config = () => {
  const provider = (Deno.env.get('WMS_AI_PROVIDER') || 'anthropic').toLowerCase() as Provider;
  const key = provider === 'anthropic' ? Deno.env.get('ANTHROPIC_API_KEY')
    : provider === 'gemini' ? (Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY'))
    : provider === 'openai' ? Deno.env.get('OPENAI_API_KEY') : undefined;
  const model = Deno.env.get('WMS_AI_MODEL') || (provider === 'anthropic' ? 'claude-opus-5-5' : provider === 'gemini' ? 'gemini-2.5-flash' : '');
  return { provider, key, model };
};

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * B1 (21/10): đọc qua đường chung _shared/aiComplete (cùng ai-gateway): ảnh chờ 110 s, lỗi thoáng qua thử lại một lần, mã lỗi AI_*
 * ổn định. Phiếu giao chỉ chép lại → tắt suy nghĩ (báo giá 41–61 s → 11 s ở cổng chuẩn OpenAI, 17/10).
 */
const readPages = async (target: AiTarget, pages: VisionPart[]) => {
  const out = await completeWithRetry(target, {
    system: DOC_PROMPT, user: `Đọc ${pages.length} trang chứng từ đính kèm, trả JSON đúng lược đồ.`, schema: DOC_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 8000, images: pages, noThinking: true,
  });
  return { read: normalizeRead(parseJsonLoose(out.text)), retried: out.retried };
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Unauthorized' }, 401);
  let body: { captureId?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  if (typeof body?.captureId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.captureId)) return json({ error: 'Invalid request' }, 400);

  // Mọi đọc/ghi chạy bằng quyền người dùng: chỉ thủ kho kho của phiếu mới đọc được ảnh và lưu kết quả.
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  if ((await user.auth.getUser(token)).error) return json({ error: 'Unauthorized' }, 401);

  // Kết nối đã gán (service_role chỉ để giải mã đúng một khóa) → không có thì Secrets như cũ.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const linked = await service.rpc('integration_secret_v1', { p_id: null, p_feature: 'wms.doc_reader' });
  if (linked.error) console.error('wms-doc-reader connection read failed', linked.error.message);
  const env = config();
  const target: AiTarget | null = (!linked.error && targetFromConnection(linked.data, 'fast'))
    || (env.key && ['anthropic', 'gemini', 'openai'].includes(env.provider)
      ? { kind: env.provider, baseUrl: DEFAULT_BASE_URL[env.provider], apiKey: env.key, model: env.model, source: 'secrets', name: env.provider } : null);
  // reason giúp chẩn đoán (16/10: màn báo "Chưa bật AI" mà không rõ vì sao).
  if (!target) return json({ code: 'AI_NOT_CONFIGURED', reason: linked.error ? 'connection_read_failed' : linked.data ? 'connection_without_key' : 'no_connection_no_secret' });
  const provider = target.kind; const model = target.model;

  const { data: capture, error } = await user.from('wms_delivery_captures').select('id,status,photos,supplier_name,supplier_tax_code,supplier_address,doc_no,doc_date,truck_no,lines').eq('id', body.captureId).maybeSingle();
  if (error || !capture) return json({ error: 'CAPTURE_NOT_FOUND' }, 404);
  if (capture.status === 'received' || capture.status === 'discarded') return json({ error: 'CAPTURE_LOCKED' }, 409);
  const photos = (Array.isArray(capture.photos) ? capture.photos : []).slice(0, 6) as Array<{ path?: string; mimeType?: string }>;
  if (!photos.length) return json({ error: 'CAPTURE_NO_PHOTO' }, 400);

  try {
    const pages: VisionPart[] = [];
    for (const p of photos) {
      if (!p.path) continue;
      const file = await user.storage.from('wms-transaction-attachments').download(p.path);
      if (file.error || !file.data) throw new Error('PHOTO_READ_FAILED');
      if (file.data.size > 8 * 1024 * 1024) throw new Error('PHOTO_TOO_LARGE');
      const mime = p.mimeType || file.data.type || 'image/jpeg';
      pages.push({ mime: (PAGE_MIME.has(mime) ? mime : 'image/jpeg') as VisionPart['mime'], b64: toB64(new Uint8Array(await file.data.arrayBuffer())) });
    }
    const started = Date.now();
    const { read, retried } = await readPages(target, pages);
    // Không ghi đè ô người đã nhập: chỉ điền ô còn trống; dòng hàng chỉ điền khi phiếu chưa có dòng.
    const fill: Record<string, unknown> = { id: capture.id, ai: { provider, model, ms: Date.now() - started, retried, readAt: new Date().toISOString(), result: read } };
    if (!capture.supplier_name && read.supplierName) fill.supplierName = read.supplierName;
    if (!capture.supplier_tax_code && read.supplierTaxCode) fill.supplierTaxCode = read.supplierTaxCode;
    if (!capture.supplier_address && read.supplierAddress) fill.supplierAddress = read.supplierAddress;
    if (!capture.doc_no && read.docNo) fill.docNo = read.docNo;
    if (!capture.doc_date && read.docDate) fill.docDate = read.docDate;
    if (!capture.truck_no && read.truckNo) fill.truckNo = read.truckNo;
    if (read.docTime) fill.docTime = read.docTime;
    if (!(Array.isArray(capture.lines) && capture.lines.length) && read.lines.length) fill.lines = read.lines;
    const saved = await user.rpc('save_delivery_capture_v1', { p: fill });
    if (saved.error) return json({ error: saved.error.message }, saved.error.code === '42501' ? 403 : 409);
    return json({ code: 'OK', capture: saved.data, read });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI_FAILED';
    console.error('wms-doc-reader failed', provider, message);
    return json({ code: 'AI_FAILED', error: message.startsWith('AI_') || message.startsWith('PHOTO_') ? message : 'AI_FAILED' });
  }
});
