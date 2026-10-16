// Cổng AI chung (chủ SP 11–13/10/2026, doc audit mục 5–7): mọi tính năng AI mới là một skill cắm vào đây.
//   * Chạy bằng phiên người dùng (JWT), không dùng service-role; quyền theo bậc skill, hạn mức ngày và trần tháng do RPC ai_gateway_begin_v1 giữ.
//   * Mỗi lượt có nhật ký (ai_runs): ai gọi, skill nào, trạng thái, token, chi phí, thời gian; không lưu nội dung.
//   * Dữ liệu người dùng được che thông tin nhạy cảm và bọc <du_lieu> (guard.ts) trước khi gửi model.
//   * Cổng không ghi sổ: chỉ trả kết quả để màn hình hiện cho người quyết định.
//   Chưa có khóa AI → { code: 'AI_NOT_CONFIGURED' } và lượt ghi 'no_provider' (xem nhu cầu); form thường vẫn chạy.
// Body: { action: 'status' } → tình trạng cấu hình (không lộ khóa). { skill, input, context? } → chạy skill.
import { createClient } from '@supabase/supabase-js';
import { GUARD_SYSTEM, parseJsonLoose, redact } from './guard.ts';
import { complete, costUsd, envTarget, readConfig } from './providers.ts';
import { KIND_LABEL, targetFromConnection, type AiTarget, type ModelClass } from '../_shared/aiTargets.ts';
import { SKILLS } from './skills.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const SKILL_CODE = /^[a-z][a-z0-9_]{2,40}$/;

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Unauthorized' }, 401);
  let body: { action?: unknown; skill?: unknown; input?: unknown; context?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  if ((await user.auth.getUser(token)).error) return json({ error: 'Unauthorized' }, 401);

  const config = readConfig(name => Deno.env.get(name));
  // Đích theo lớp model: kết nối Admin gán (Cài đặt → Kết nối, khóa trong Vault) → Secrets → (suy luận) kết nối của lớp nhanh.
  // service_role chỉ dùng để giải mã đúng một khóa qua integration_secret_v1; mọi dữ liệu khác vẫn đi bằng JWT người dùng.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const assigned = async (feature: 'ai.fast' | 'ai.reasoning', cls: ModelClass) => {
    const r = await service.rpc('integration_secret_v1', { p_id: null, p_feature: feature });
    if (r.error) { console.error('ai-gateway connection read failed', r.error.message); return null; }
    return targetFromConnection(r.data, cls);
  };
  const resolveTarget = async (cls: ModelClass): Promise<AiTarget | null> =>
    (await assigned(cls === 'reasoning' ? 'ai.reasoning' : 'ai.fast', cls)) ?? envTarget(config, cls) ?? (cls === 'reasoning' ? await assigned('ai.fast', cls) : null);
  const describe = (t: AiTarget | null) => t ? { source: t.source, name: t.name, kind: t.kind, label: KIND_LABEL[t.kind], model: t.model } : null;

  if (body?.action === 'status') {
    const [fast, reasoning] = await Promise.all([resolveTarget('fast'), resolveTarget('reasoning')]);
    return json({
      code: 'OK', configured: Boolean(fast), provider: fast?.kind ?? config.provider, providerSource: fast?.source === 'connection' ? 'connection' : config.providerSource,
      models: { fast: fast?.model || '', reasoning: reasoning?.model || '' }, targets: { fast: describe(fast), reasoning: describe(reasoning) },
      keysPresent: config.keysPresent, priceKnown: config.price.inPerM != null && config.price.outPerM != null,
      skills: Object.keys(SKILLS),
    });
  }

  if (typeof body?.skill !== 'string' || !SKILL_CODE.test(body.skill)) return json({ error: 'Invalid request' }, 400);
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};

  const begin = await user.rpc('ai_gateway_begin_v1', { p_skill: body.skill, p_context: context });
  if (begin.error) return json({ code: 'AI_DENIED', error: begin.error.message }, begin.error.code === '42501' ? 403 : 409);
  const opened = begin.data as { code: string; runId?: string; skill?: { modelClass: 'fast' | 'reasoning'; name: string }; reason?: string; usedToday?: number; dailyLimit?: number };
  if (opened.code !== 'OK' || !opened.runId) return json(opened);

  const runId = opened.runId;
  const finish = (p: Record<string, unknown>) => user.rpc('ai_gateway_finish_v1', { p_run_id: runId, p }).then(r => { if (r.error) console.error('ai-gateway finish failed', r.error.message); });

  const def = SKILLS[body.skill];
  if (!def) { await finish({ status: 'error', error: 'AI_SKILL_NOT_IMPLEMENTED' }); return json({ code: 'AI_FAILED', error: 'AI_SKILL_NOT_IMPLEMENTED' }); }
  const target = await resolveTarget(opened.skill?.modelClass || 'fast');
  if (!target) { await finish({ status: 'no_provider', provider: config.provider, error: 'AI_NOT_CONFIGURED' }); return json({ code: 'AI_NOT_CONFIGURED', runId }); }

  const model = target.model;
  const provider = target.source === 'connection' ? `${target.kind}:${target.name}`.slice(0, 40) : target.kind;
  const started = Date.now();
  let input: Record<string, string>;
  try { input = def.parseInput(body.input); } catch { await finish({ status: 'error', provider, model, error: 'AI_BAD_INPUT', durationMs: 0 }); return json({ code: 'AI_FAILED', error: 'AI_BAD_INPUT' }); }

  // Che dữ liệu nhạy cảm từng ô rồi mới dựng prompt; số lượt che ghi vào tóm tắt nhật ký.
  const masked: Record<string, string> = {}; const hits: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    const r = redact(v); masked[k] = r.text.slice(0, def.maxInputChars);
    for (const [name, n] of Object.entries(r.hits)) hits[name] = (hits[name] || 0) + n;
  }
  const userText = def.user(masked);
  const inputChars = userText.length;

  try {
    const out = await complete(target, { system: `${GUARD_SYSTEM}\n${def.system}`, user: userText, schema: def.schema, maxTokens: def.maxOutputTokens });
    const result = def.parseOutput(parseJsonLoose(out.text));
    const redactNote = Object.keys(hits).length ? ` · đã che ${Object.entries(hits).map(([k, n]) => `${k}×${n}`).join(', ')}` : '';
    const usage = { tokensIn: out.usage.tokensIn, tokensOut: out.usage.tokensOut, costUsd: costUsd(out.usage, config.price), durationMs: Date.now() - started };
    await finish({ status: 'ok', provider, model, inputChars, outputChars: out.text.length, ...usage, summary: `${def.summary(masked, result)}${redactNote}` });
    return json({ code: 'OK', runId, result, model, provider: target.kind, usage });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI_FAILED';
    const code = message === 'AI_REFUSED' ? 'refused' : 'error';
    console.error('ai-gateway failed', provider, model, message);
    await finish({ status: code, provider, model, inputChars, durationMs: Date.now() - started, error: message.slice(0, 200) });
    return json({ code: message === 'AI_REFUSED' ? 'AI_REFUSED' : 'AI_FAILED', runId, error: message.startsWith('AI_') ? message : 'AI_FAILED' });
  }
});
