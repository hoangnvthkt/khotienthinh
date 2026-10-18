// Cổng AI chung (chủ SP 11–13/10/2026, doc audit mục 5–7): mọi tính năng AI mới là một skill cắm vào đây.
//   * Chạy bằng phiên người dùng (JWT), không dùng service-role; quyền theo bậc skill, hạn mức ngày và trần tháng do RPC ai_gateway_begin_v1 giữ.
//   * Mỗi lượt có nhật ký (ai_runs): ai gọi, skill nào, trạng thái, token, chi phí, thời gian; không lưu nội dung.
//   * Dữ liệu người dùng được che thông tin nhạy cảm và bọc <du_lieu> (guard.ts) trước khi gửi model.
//   * Cổng không ghi sổ: chỉ trả kết quả để màn hình hiện cho người quyết định.
//   Chưa có khóa AI → { code: 'AI_NOT_CONFIGURED' } và lượt ghi 'no_provider' (xem nhu cầu); form thường vẫn chạy.
// Body: { action: 'status' } → tình trạng cấu hình (không lộ khóa). { skill, input, context? } → chạy skill.
import { createClient } from '@supabase/supabase-js';
import { GUARD_SYSTEM, parseJsonLoose, redact } from './guard.ts';
import { agentStep, complete, costUsd, envTarget, readConfig, streamChat, supportsTools, type ImagePart } from './providers.ts';
import { SourceBook, type SourceRef } from './agent.ts';
import { converse } from './loop.ts';
import type { Rpc } from './tools.ts';
import { KIND_LABEL, targetFromConnection, type AiFeature, type AiTarget, type ModelClass } from '../_shared/aiTargets.ts';
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_SKILL, attachmentNote, buildChatPrompt, isDailyReportTurn, leaveTypesLine, userNotesOf, mentionsLeave, reportTextOf, parseChatInput, sourceKeysOf, splitRefusal, sseEvent, threadTurns, vnTodayLabel, type ChatTurn } from './chat.ts';
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
  const assigned = async (feature: AiFeature, cls: ModelClass) => {
    const r = await service.rpc('integration_secret_v1', { p_id: null, p_feature: feature });
    if (r.error) { console.error('ai-gateway connection read failed', r.error.message); return null; }
    return targetFromConnection(r.data, cls);
  };
  const resolveTarget = async (cls: ModelClass): Promise<AiTarget | null> =>
    (await assigned(cls === 'reasoning' ? 'ai.reasoning' : 'ai.fast', cls)) ?? envTarget(config, cls) ?? (cls === 'reasoning' ? await assigned('ai.fast', cls) : null);
  const describe = (t: AiTarget | null) => t ? { source: t.source, name: t.name, kind: t.kind, label: KIND_LABEL[t.kind], model: t.model } : null;

  const rpc: Rpc = async (fn, args) => {
    const r = await user.rpc(fn, args);
    return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null };
  };

  // Trợ lý · hội thoại (T0, chủ SP 17/10): trả lời chạy dần (text/event-stream: start → delta… → done | error).
  // Lỗi trước khi bắt đầu (đầu vào, chưa có khóa, hội thoại không phải của mình) → JSON như skill thường.
  // Xong thì ghi lượt hỏi–đáp vào hội thoại bằng JWT người hỏi; người dùng rời trang giữa chừng vẫn ghi để mở lại thấy.
  const chat = async (runId: string, finish: (p: Record<string, unknown>) => PromiseLike<void>, rawInput: unknown, context: { projectId?: unknown }): Promise<Response> => {
    let input: ReturnType<typeof parseChatInput>;
    try { input = parseChatInput(rawInput); } catch { await finish({ status: 'error', error: 'AI_BAD_INPUT', durationMs: 0 }); return json({ code: 'AI_FAILED', runId, error: 'AI_BAD_INPUT' }); }
    // Kết nối "Trợ lý · hội thoại" (Cài đặt → Kết nối) → lớp suy luận như cũ.
    const target = (await assigned('ai.assistant', 'reasoning')) ?? await resolveTarget('reasoning');
    if (!target) { await finish({ status: 'no_provider', provider: config.provider, error: 'AI_NOT_CONFIGURED' }); return json({ code: 'AI_NOT_CONFIGURED', runId }); }
    let history: ChatTurn[] = [];
    if (input.threadId) {
      const thread = await user.rpc('get_ai_thread_v1', { p_thread_id: input.threadId, p_limit: 40 });
      if (thread.error) { await finish({ status: 'error', error: 'AI_THREAD_NOT_FOUND', durationMs: 0 }); return json({ code: 'AI_FAILED', runId, error: 'AI_THREAD_NOT_FOUND' }); }
      history = threadTurns(thread.data);
    }
    // T1: nhà cung cấp nối được công cụ → Trợ lý tự tra (hồ sơ, tồn kho, đơn mua, đề xuất, việc của tôi) bằng JWT người hỏi.
    const withTools = supportsTools(target);
    // Hỏi về nghỉ phép: nạp loại nghỉ thật (theo quyền người hỏi) để Trợ lý hỏi lại bằng đúng tên loại, không bịa.
    const known = withTools && mentionsLeave(input.question, history)
      ? await user.rpc('assistant_leave_types_v1', {}).then(r => (r.error || !Array.isArray(r.data) ? [] : leaveTypesLine(r.data)), () => [])
      : [];
    // T4b: ghi nhớ người dùng tự lưu (bảng Trí nhớ) — đọc bằng JWT người hỏi, chỉ của chính họ; lỗi thì bỏ qua.
    const notes = await user.rpc('get_ai_user_memory_v1', {}).then(r => (r.error ? [] : userNotesOf(r.data)), () => []);
    const prompt = buildChatPrompt(input, history, withTools, vnTodayLabel(new Date()), known, notes);
    const model = target.model;
    const provider = target.source === 'connection' ? `${target.kind}:${target.name}`.slice(0, 40) : target.kind;
    const redactNote = Object.keys(prompt.hits).length ? ` · đã che ${Object.entries(prompt.hits).map(([k, n]) => `${k}×${n}`).join(', ')}` : '';
    const factLines = input.facts ? input.facts.split('\n').length : 0;
    const started = Date.now();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (chunk: string) => { if (!open) return; try { controller.enqueue(encoder.encode(chunk)); } catch { open = false; } };
        // Nhịp giữ kết nối khi model còn suy nghĩ (Supabase cắt sau 150 s không trả byte nào).
        const ping = setInterval(() => send(': ping\n\n'), 15_000);
        send(sseEvent({ type: 'start', runId, model, threadId: input.threadId }));
        try {
          const book = new SourceBook();
          const used: string[] = [];
          const out = withTools
            ? await converse({ step: (req, onDelta) => agentStep(target, req, onDelta), rpc, emit: event => send(sseEvent(event)), redact: text => redact(text).text,
              system: prompt.system, turns: prompt.messages, images: input.images, book, used, started, runId,
              projectId: typeof context.projectId === 'string' ? context.projectId : null, question: reportTextOf(input.question, history),
              forceTool: isDailyReportTurn(input.question, history) ? 'chuan_bi_nhat_ky' : undefined })
            : await streamChat(target, { system: prompt.system, messages: prompt.messages, maxTokens: CHAT_MAX_OUTPUT_TOKENS, noThinking: true },
              delta => send(sseEvent({ type: 'delta', text: delta })));
          if (!out.text.trim()) throw new Error('AI_EMPTY');
          // Câu từ chối (ngoài công việc, khiếm nhã, đòi xóa…): bỏ nhãn khỏi chữ lưu / trả về, ghi loại vào nhật ký.
          const { text: answer, refusal } = splitRefusal(out.text);
          // Từ chối vẫn giữ nút nguồn: câu lẫn (một phần công việc + một phần ngoài lề) và câu gợi ý việc khác đều dẫn chứng từ thật.
          // Nguồn = dòng số liệu bản tin [[khóa]] + hồ sơ công cụ trả về [[hN]] (màn hình mở đúng màn).
          const sources: Array<string | SourceRef> = [...sourceKeysOf(answer, input.facts), ...book.cited(answer)];
          const usage = { tokensIn: out.usage.tokensIn, tokensOut: out.usage.tokensOut, costUsd: costUsd(out.usage, target.price ?? config.price), durationMs: Date.now() - started };
          const saved = await user.rpc('ai_thread_save_turn_v1', { p_thread_id: input.threadId, p: {
            question: [input.question, attachmentNote(input)].filter(Boolean).join('\n').slice(0, 8000), answer, sources, runId, projectId: typeof context.projectId === 'string' ? context.projectId : null } });
          if (saved.error) console.error('ai-gateway chat save failed', saved.error.message);
          const ids = (saved.data || {}) as { threadId?: string; messageId?: string };
          await finish({ status: 'ok', provider, model, inputChars: prompt.inputChars, outputChars: answer.length, ...usage,
            summary: `hội thoại: ${prompt.historyUsed} tin trước, ${factLines} dòng số liệu${input.files?.length ? `, ${input.files.length} bảng tính` : ''}${input.images?.length ? `, ${input.images.length} ảnh` : ''}${used.length ? `, tra ${used.join(' ')}` : ''}${(out.usage.calls ?? 1) > 1 ? `, ${out.usage.calls} lượt gọi` : ''} → ${refusal ? `từ chối (${refusal})` : `${answer.length} ký tự, ${sources.length} nguồn`}${redactNote}` });
          send(sseEvent({ type: 'done', threadId: ids.threadId ?? input.threadId, messageId: ids.messageId ?? null, answer, sources, model, usage, saved: !saved.error, refusal }));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'AI_FAILED';
          console.error('ai-gateway chat failed', provider, model, message);
          await finish({ status: message === 'AI_REFUSED' ? 'refused' : 'error', provider, model, inputChars: prompt.inputChars, durationMs: Date.now() - started, error: message.slice(0, 200) });
          send(sseEvent({ type: 'error', code: message === 'AI_REFUSED' ? 'AI_REFUSED' : 'AI_FAILED', error: message.startsWith('AI_') ? message : 'AI_FAILED' }));
        } finally {
          clearInterval(ping);
          if (open) { open = false; try { controller.close(); } catch { /* đã đóng */ } }
        }
      },
    });
    return new Response(stream, { headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' } });
  };

  if (body?.action === 'status') {
    const [fast, reasoning, assistant] = await Promise.all([resolveTarget('fast'), resolveTarget('reasoning'), assigned('ai.assistant', 'reasoning')]);
    return json({
      code: 'OK', configured: Boolean(fast), provider: fast?.kind ?? config.provider, providerSource: fast?.source === 'connection' ? 'connection' : config.providerSource,
      models: { fast: fast?.model || '', reasoning: reasoning?.model || '' },
      targets: { fast: describe(fast), reasoning: describe(reasoning), assistant: describe(assistant ?? reasoning) },
      keysPresent: config.keysPresent, priceKnown: config.price.inPerM != null && config.price.outPerM != null,
      skills: [...Object.keys(SKILLS), CHAT_SKILL],
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

  if (body.skill === CHAT_SKILL) return chat(runId, finish, body.input, context);

  const def = SKILLS[body.skill];
  if (!def) { await finish({ status: 'error', error: 'AI_SKILL_NOT_IMPLEMENTED' }); return json({ code: 'AI_FAILED', error: 'AI_SKILL_NOT_IMPLEMENTED' }); }
  // Skill đọc ảnh đi kết nối đọc ảnh (Cài đặt → Kết nối · "Đọc ảnh chứng từ", đang dùng cho Kho); chưa gán thì như skill thường.
  const target = (def.images ? await assigned('wms.doc_reader', 'fast') : null) ?? await resolveTarget(opened.skill?.modelClass || 'fast');
  if (!target) { await finish({ status: 'no_provider', provider: config.provider, error: 'AI_NOT_CONFIGURED' }); return json({ code: 'AI_NOT_CONFIGURED', runId }); }

  const model = target.model;
  const provider = target.source === 'connection' ? `${target.kind}:${target.name}`.slice(0, 40) : target.kind;
  const started = Date.now();
  let input: Record<string, string>;
  let images: ImagePart[] | undefined;
  try { input = def.parseInput(body.input); images = def.images?.(body.input); } catch { await finish({ status: 'error', provider, model, error: 'AI_BAD_INPUT', durationMs: 0 }); return json({ code: 'AI_FAILED', error: 'AI_BAD_INPUT' }); }

  // Che dữ liệu nhạy cảm từng ô rồi mới dựng prompt; số lượt che ghi vào tóm tắt nhật ký.
  const masked: Record<string, string> = {}; const hits: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    const r = redact(v); masked[k] = r.text.slice(0, def.maxInputChars);
    for (const [name, n] of Object.entries(r.hits)) hits[name] = (hits[name] || 0) + n;
  }
  const userText = def.user(masked);
  const inputChars = userText.length;

  try {
    const out = await complete(target, { system: `${GUARD_SYSTEM}\n${def.system}`, user: userText, schema: def.schema, maxTokens: def.maxOutputTokens, images, noThinking: def.noThinking });
    const result = def.parseOutput(parseJsonLoose(out.text));
    const redactNote = Object.keys(hits).length ? ` · đã che ${Object.entries(hits).map(([k, n]) => `${k}×${n}`).join(', ')}` : '';
    const usage = { tokensIn: out.usage.tokensIn, tokensOut: out.usage.tokensOut, costUsd: costUsd(out.usage, target.price ?? config.price), durationMs: Date.now() - started };
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
