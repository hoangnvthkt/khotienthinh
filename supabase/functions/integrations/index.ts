// Kết nối API (Cài đặt → Kết nối, chỉ Admin): thử kết nối và liệt kê khóa đang có trong Secrets.
//   { action: 'env' }                                → khóa trong Secrets (tên, endpoint, model, 4 ký tự cuối) — chỉ đọc.
//   { action: 'test', connectionId }                 → thử kết nối đã lưu (khóa giải mã từ Vault), ghi kết quả vào bảng.
//   { action: 'test', envId }                        → thử khóa trong Secrets.
//   { action: 'test', draft: { kind, baseUrl, apiKey, model }, connectionId? } → thử trước khi lưu. Không nhập khóa mới thì dùng khóa đã lưu
//     nhưng KHÔNG cho đổi endpoint (không gửi khóa cũ tới địa chỉ mới).
// Khóa không bao giờ trả về trình duyệt. Kiểm Admin bằng JWT người gọi; service_role chỉ để đọc khóa qua integration_secret_v1.
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_BASE_URL, envEntries, probe, type AiKind } from '../_shared/aiTargets.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const KINDS = new Set<AiKind>(['anthropic', 'gemini', 'openai', 'openai_compatible', 'typesafe']);
const UUID = /^[0-9a-f-]{36}$/i;
const env = (name: string) => Deno.env.get(name);

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Unauthorized' }, 401);
  let body: { action?: unknown; connectionId?: unknown; envId?: unknown; draft?: Record<string, unknown> };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  const user = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  if ((await user.auth.getUser(token)).error) return json({ error: 'Unauthorized' }, 401);
  const admin = await user.rpc('is_admin');
  if (admin.error || admin.data !== true) return json({ error: 'INTEGRATIONS_ADMIN_REQUIRED' }, 403);

  const entries = envEntries(env);
  if (body?.action === 'env') {
    return json({ code: 'OK', entries: entries.map(({ target: _t, ...entry }) => entry) });
  }
  if (body?.action !== 'test') return json({ error: 'Invalid request' }, 400);

  const service = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const saved = async (id: string) => {
    const r = await service.rpc('integration_secret_v1', { p_id: id, p_feature: null });
    if (r.error) throw new Error('INTEGRATIONS_READ_FAILED');
    return r.data as { kind: AiKind; baseUrl: string; model: string | null; apiKey: string | null } | null;
  };

  const connectionId = typeof body.connectionId === 'string' && UUID.test(body.connectionId) ? body.connectionId : null;
  try {
    if (typeof body.envId === 'string') {
      const entry = entries.find(e => e.id === body.envId);
      if (!entry) return json({ error: 'INTEGRATIONS_NOT_FOUND' }, 404);
      return json({ code: 'OK', result: await probe(entry.target, fetch) });
    }
    if (body.draft && typeof body.draft === 'object') {
      const kind = String(body.draft.kind || '') as AiKind;
      if (!KINDS.has(kind)) return json({ error: 'Invalid request' }, 400);
      const baseUrl = String(body.draft.baseUrl || DEFAULT_BASE_URL[kind]).trim().replace(/\/+$/, '');
      const model = String(body.draft.model || '').trim();
      let apiKey = String(body.draft.apiKey || '').trim();
      if (!apiKey) {
        if (!connectionId) return json({ error: 'INTEGRATIONS_KEY_REQUIRED' }, 400);
        const row = await saved(connectionId);
        if (!row?.apiKey) return json({ error: 'INTEGRATIONS_NOT_FOUND' }, 404);
        if (row.baseUrl.replace(/\/+$/, '') !== baseUrl) return json({ error: 'INTEGRATIONS_KEY_REQUIRED_FOR_NEW_ENDPOINT' }, 400);
        apiKey = row.apiKey;
      }
      return json({ code: 'OK', result: await probe({ kind, baseUrl, apiKey, model }, fetch) });
    }
    if (connectionId) {
      const row = await saved(connectionId);
      if (!row?.apiKey) return json({ error: 'INTEGRATIONS_NOT_FOUND' }, 404);
      const result = await probe({ kind: row.kind, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model || '' }, fetch);
      const recorded = await user.rpc('record_integration_test_v1', { p_id: connectionId, p_result: result });
      return json({ code: 'OK', result, connection: recorded.data ?? null });
    }
    return json({ error: 'Invalid request' }, 400);
  } catch (e) {
    console.error('integrations test failed', e instanceof Error ? e.message : e);
    return json({ error: 'INTEGRATIONS_TEST_FAILED' }, 500);
  }
});
