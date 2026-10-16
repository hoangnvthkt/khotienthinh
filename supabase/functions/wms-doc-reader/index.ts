// Kho Đợt 1 — đọc ảnh phiếu giao NCC bằng AI rồi điền vào phiếu chụp (wms_delivery_captures).
// Nhà cung cấp AI chọn bằng biến môi trường (chủ SP 12/10: không cố định một hãng):
//   WMS_AI_PROVIDER = anthropic | gemini | openai   (mặc định anthropic)
//   WMS_AI_MODEL    = tên model (anthropic mặc định claude-opus-5-5; gemini mặc định gemini-2.5-flash; openai bắt buộc khai báo)
//   ANTHROPIC_API_KEY | GEMINI_API_KEY | OPENAI_API_KEY
// Kết nối Admin gán cho "Kho · đọc ảnh phiếu giao" ở Cài đặt → Kết nối (khóa trong Vault) được ưu tiên hơn các biến trên.
// Chưa cấu hình → trả { code: 'AI_NOT_CONFIGURED' } (màn Kho chuyển sang nhập tay). AI không ghi sổ: chỉ điền số liệu để người xem lại.
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { DOC_PROMPT, DOC_SCHEMA, normalizeRead, type DocRead } from './prompt.ts';
import { DEFAULT_BASE_URL, targetFromConnection, type AiTarget } from '../_shared/aiTargets.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

type Provider = 'anthropic' | 'gemini' | 'openai';
interface Page { mime: string; b64: string }

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

async function readWithAnthropic({ apiKey: key, model, baseUrl }: AiTarget, pages: Page[]): Promise<unknown> {
  const client = new Anthropic({ apiKey: key, baseURL: baseUrl });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...pages.map(p => p.mime === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: p.b64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: p.mime as 'image/jpeg' | 'image/png' | 'image/webp', data: p.b64 } }),
    { type: 'text', text: DOC_PROMPT },
  ];
  // Fallback phía máy chủ khi bị bộ lọc an toàn từ chối (mặc định nên bật); JSON theo lược đồ bằng structured outputs.
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DOC_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI_REFUSED');
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('AI_EMPTY');
  return JSON.parse(text);
}

async function readWithGemini({ apiKey: key, model, baseUrl }: AiTarget, pages: Page[]): Promise<unknown> {
  const res = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [...pages.map(p => ({ inline_data: { mime_type: p.mime, data: p.b64 } })), { text: DOC_PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
  if (!text) throw new Error('AI_EMPTY');
  return JSON.parse(text);
}

async function readWithOpenAI({ apiKey: key, model, baseUrl, kind }: AiTarget, pages: Page[]): Promise<unknown> {
  const compatible = kind === 'openai_compatible';
  if (!model) throw new Error('AI_MODEL_REQUIRED');
  if (pages.some(p => p.mime === 'application/pdf')) throw new Error('AI_PDF_UNSUPPORTED');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      response_format: compatible ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'delivery_doc', schema: DOC_SCHEMA, strict: true } },
      messages: [{ role: 'user', content: [...pages.map(p => ({ type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.b64}` } })), { type: 'text', text: DOC_PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI_EMPTY');
  return JSON.parse(text);
}

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
  if (!target) return json({ code: 'AI_NOT_CONFIGURED' });
  const provider = target.kind; const model = target.model;

  const { data: capture, error } = await user.from('wms_delivery_captures').select('id,status,photos,supplier_name,doc_no,doc_date,truck_no,lines').eq('id', body.captureId).maybeSingle();
  if (error || !capture) return json({ error: 'CAPTURE_NOT_FOUND' }, 404);
  if (capture.status === 'received' || capture.status === 'discarded') return json({ error: 'CAPTURE_LOCKED' }, 409);
  const photos = (Array.isArray(capture.photos) ? capture.photos : []).slice(0, 6) as Array<{ path?: string; mimeType?: string }>;
  if (!photos.length) return json({ error: 'CAPTURE_NO_PHOTO' }, 400);

  try {
    const pages: Page[] = [];
    for (const p of photos) {
      if (!p.path) continue;
      const file = await user.storage.from('wms-transaction-attachments').download(p.path);
      if (file.error || !file.data) throw new Error('PHOTO_READ_FAILED');
      if (file.data.size > 8 * 1024 * 1024) throw new Error('PHOTO_TOO_LARGE');
      pages.push({ mime: p.mimeType || file.data.type || 'image/jpeg', b64: toB64(new Uint8Array(await file.data.arrayBuffer())) });
    }
    const started = Date.now();
    const raw = provider === 'anthropic' ? await readWithAnthropic(target, pages)
      : provider === 'gemini' ? await readWithGemini(target, pages) : await readWithOpenAI(target, pages);
    const read: DocRead = normalizeRead(raw);
    // Không ghi đè ô người đã nhập: chỉ điền ô còn trống; dòng hàng chỉ điền khi phiếu chưa có dòng.
    const fill: Record<string, unknown> = { id: capture.id, ai: { provider, model, ms: Date.now() - started, readAt: new Date().toISOString(), result: read } };
    if (!capture.supplier_name && read.supplierName) fill.supplierName = read.supplierName;
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
