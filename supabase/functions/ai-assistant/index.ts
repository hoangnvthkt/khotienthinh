import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import {
  AI_TOOL_DEFINITIONS,
  DATA_ASSISTANT_SYSTEM_PROMPT,
  KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT,
  TOOL_ROUTER_PROMPT,
} from '../_shared/aiDatabaseContext.ts';

type AiMode = 'data' | 'knowledge';
type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface AssistantRequest {
  action?: 'feedback';
  question?: string;
  conversationId?: string | null;
  userId?: string;
  mode?: AiMode;
  history?: ChatMessage[];
  messageId?: string;
  rating?: 1 | -1;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_FAST_MODEL = Deno.env.get('GEMINI_FAST_MODEL') || 'gemini-2.5-flash';
const GEMINI_REASONING_MODEL = Deno.env.get('GEMINI_REASONING_MODEL') || 'gemini-2.5-pro';
const MAX_RESULT_CHARS = 26000;

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || '';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ═══ Utilities ═══════════════════════════════════════════════

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function compactJson(value: unknown, maxChars: number) {
  const text = JSON.stringify(value ?? null);
  return text.length > maxChars ? `${text.slice(0, maxChars)}... [truncated]` : text;
}

function extractJsonObject(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model did not return JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ═══ Gemini API ══════════════════════════════════════════════

async function callGemini(
  prompt: string,
  temperature = 0.15,
  model = GEMINI_FAST_MODEL,
  responseMimeType?: string
): Promise<string> {
  if (!geminiKey) throw new Error('Missing GEMINI_API_KEY.');

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 4096,
    },
  };

  if (responseMimeType) {
    body.generationConfig.responseMimeType = responseMimeType;
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Gemini request failed.');
  return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
}

// ═══ Tool Router — Replaces planSql() ════════════════════════

const ALLOWED_TOOL_NAMES = AI_TOOL_DEFINITIONS.map(t => t.name);

async function routeToTool(question: string, history: ChatMessage[]) {
  const prompt = `
${TOOL_ROUTER_PROMPT}

Available tools:
${JSON.stringify(AI_TOOL_DEFINITIONS, null, 2)}

Recent conversation:
${history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-6000)}

Question:
${question}
`.trim();

  const raw = await callGemini(prompt, 0.05, GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);

  return {
    action: String(parsed.action || 'clarification'),
    toolName: parsed.tool_name ? String(parsed.tool_name) : null,
    parameters: parsed.parameters && typeof parsed.parameters === 'object' ? parsed.parameters : {},
    message: parsed.message ? String(parsed.message) : null,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [
      'Tổng tồn kho hiện tại?',
      'Có bao nhiêu nhân viên?',
      'Dashboard tổng hợp',
    ],
    reason: parsed.reason ? String(parsed.reason) : null,
    raw,
  };
}

// ═══ Tool Executor — Replaces executeSql() ═══════════════════

async function callToolRpc(toolName: string, params: Record<string, any>) {
  // Whitelist validation
  if (!ALLOWED_TOOL_NAMES.includes(toolName)) {
    throw new Error(`Tool "${toolName}" is not registered. Allowed: ${ALLOWED_TOOL_NAMES.join(', ')}`);
  }

  // Clean params: remove null/undefined values
  const cleanParams: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      cleanParams[key] = value;
    }
  }

  const { data, error } = await admin.rpc(toolName, cleanParams);
  if (error) throw new Error(`RPC ${toolName} failed: ${error.message}`);
  return data;
}

// ═══ Answer Formatter — Replaces answerFromRows() ════════════

async function formatToolResult(
  question: string,
  toolName: string,
  result: unknown,
  history: ChatMessage[],
) {
  const prompt = `
${DATA_ASSISTANT_SYSTEM_PROMPT}

Recent conversation:
${history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-6000)}

Question:
${question}

Tool called: ${toolName}
Result JSON:
${compactJson(result, MAX_RESULT_CHARS)}

Hãy trả lời bằng tiếng Việt, đúng trọng tâm. Trình bày số liệu đẹp mắt bằng bảng/danh sách nếu phù hợp. Nêu nguồn dữ liệu ở cuối.
`.trim();

  return callGemini(prompt, 0.2, GEMINI_FAST_MODEL);
}

// ═══ Knowledge Mode (unchanged) ═════════════════════════════

function getQuestionTerms(question: string) {
  return question
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter(w => w.length >= 3)
    .slice(0, 8);
}

async function searchKnowledge(question: string) {
  const { data, error } = await admin.rpc('ai_search_knowledge', {
    p_query: question,
    p_limit: 8,
  });
  if (!error && Array.isArray(data)) return data;

  const terms = getQuestionTerms(question);
  if (terms.length === 0) return [];

  const fallback = await admin
    .from('rag_documents')
    .select('id, title, file_name, status, source, created_at')
    .eq('status', 'ready')
    .or(terms.map(term => `title.ilike.%${term}%,file_name.ilike.%${term}%`).join(','))
    .limit(8);

  return (fallback.data || []).map((doc: any) => ({
    document_id: doc.id,
    title: doc.title,
    file_name: doc.file_name,
    content: `Tài liệu phù hợp theo tên: ${doc.title || doc.file_name}`,
    rank: 0,
  }));
}

async function classifyComplexity(question: string): Promise<boolean> {
  const prompt = `Phân loại câu hỏi này có cần phân tích sâu, so sánh, tổng hợp nhiều thông tin, hay tìm hiểu nguyên nhân phức tạp không?\nTrả lời CHỈ một từ: COMPLEX hoặc SIMPLE.\nCâu hỏi: ${question}`;
  const res = await callGemini(prompt, 0, GEMINI_FAST_MODEL);
  return res.trim().toUpperCase().includes('COMPLEX');
}

async function answerFromKnowledge(question: string, chunks: any[], history: ChatMessage[], isComplex: boolean) {
  const prompt = `
${KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT}

Recent conversation:
${history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-6000)}

Question:
${question}

Retrieved internal documents:
${compactJson(chunks, MAX_RESULT_CHARS)}

Hãy trả lời bằng tiếng Việt, đúng trọng tâm, có phần "Nguồn" ở cuối.
`.trim();

  return callGemini(prompt, 0.2, isComplex ? GEMINI_REASONING_MODEL : GEMINI_FAST_MODEL);
}

// ═══ Conversation & Messages ════════════════════════════════

async function ensureConversation(req: AssistantRequest, title: string) {
  if (req.conversationId) return req.conversationId;

  const id = crypto.randomUUID();
  const { error } = await admin.from('ai_conversations').insert({
    id,
    title: title.length > 80 ? `${title.slice(0, 77)}...` : title,
    mode: req.mode || 'data',
    user_id: req.userId || null,
    created_at: new Date().toISOString(),
  });
  if (error) console.warn('ai_conversations insert failed:', error.message);
  return id;
}

async function saveMessage(args: {
  conversationId: string;
  role: ChatRole;
  content: string;
  mode?: string;
  sqlQuery?: string;
  toolName?: string;
  sources?: unknown;
}) {
  const { error } = await admin.from('ai_messages').insert({
    conversation_id: args.conversationId,
    role: args.role,
    content: args.content,
    mode: args.mode || null,
    sql_query: args.toolName ? `[TOOL] ${args.toolName}` : (args.sqlQuery || null),
    sources: args.sources || null,
    created_at: new Date().toISOString(),
  });
  if (error) console.warn('ai_messages insert failed:', error.message);
}

async function handleFeedback(req: AssistantRequest) {
  if (!req.messageId || !req.rating) return { ok: true };
  const { error } = await admin
    .from('ai_messages')
    .update({ feedback: req.rating })
    .eq('id', req.messageId);
  if (error) console.warn('feedback update failed:', error.message);
  return { ok: true };
}

// ═══ Main Handler ═══════════════════════════════════════════

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Missing Supabase function secrets.' }, 500);
    }

    const req = await request.json() as AssistantRequest;
    if (req.action === 'feedback') return jsonResponse(await handleFeedback(req));

    const question = (req.question || '').trim();
    if (!question) return jsonResponse({ error: 'Thiếu câu hỏi.' }, 400);

    const mode: AiMode = req.mode === 'knowledge' ? 'knowledge' : 'data';
    const history = (req.history || []).slice(-10);
    const conversationId = await ensureConversation({ ...req, mode }, question);
    await saveMessage({ conversationId, role: 'user', content: question, mode });

    // ── Knowledge Mode (unchanged) ──
    if (mode === 'knowledge') {
      const chunks = await searchKnowledge(question);
      const isComplex = await classifyComplexity(question);
      const answer = chunks.length > 0
        ? await answerFromKnowledge(question, chunks, history, isComplex)
        : 'Em chưa tìm thấy tài liệu nội bộ phù hợp trong Kho Kiến Thức. Anh có thể upload/sync thêm tài liệu hoặc hỏi cụ thể hơn theo tên tài liệu, quy trình, phòng ban.';
      const sources = chunks.map((c: any) => ({
        title: c.title,
        fileName: c.file_name,
        similarity: c.rank || 0,
      }));
      await saveMessage({ conversationId, role: 'assistant', content: answer, mode: 'rag', sources });
      return jsonResponse({ conversationId, answer, mode: 'rag', sources, hasMemory: chunks.length > 0 });
    }

    // ── Data Mode — Agentic Tool-calling ──
    let route: any = null;
    try {
      route = await routeToTool(question, history);
    } catch (routeErr) {
      console.error('ai-assistant routing failed:', routeErr);
      return jsonResponse({ error: `Routing failed: ${(routeErr as Error).message}` }, 500);
    }

    // Handle rejection or clarification
    if (route.action === 'rejection' || route.action === 'clarification') {
      const msg = route.message || 'Em cần thêm thông tin để trả lời câu hỏi này.';
      await saveMessage({ conversationId, role: 'assistant', content: msg, mode: 'sql' });
      return jsonResponse({
        conversationId,
        answer: msg,
        mode: 'sql',
        suggestions: route.suggestions,
        hasMemory: false,
      });
    }

    // Handle tool_call
    if (route.action === 'tool_call' && route.toolName) {
      let toolResult: any = null;
      try {
        toolResult = await callToolRpc(route.toolName, route.parameters);
      } catch (rpcErr) {
        console.error(`ai-assistant RPC ${route.toolName} failed:`, rpcErr);
        return jsonResponse({
          error: `Tool "${route.toolName}" execution failed: ${(rpcErr as Error).message}`,
          debug: { route },
        }, 500);
      }

      const answer = await formatToolResult(question, route.toolName, toolResult, history);
      await saveMessage({
        conversationId,
        role: 'assistant',
        content: answer,
        mode: 'sql',
        toolName: route.toolName,
      });

      return jsonResponse({
        conversationId,
        answer,
        toolName: route.toolName,
        mode: 'sql',
        suggestions: route.suggestions,
        hasMemory: false,
      });
    }

    // Fallback — no valid action
    return jsonResponse({
      error: 'AI Router returned an unrecognized action.',
      debug: { route },
    }, 500);

  } catch (err) {
    console.error('ai-assistant error:', err);
    return jsonResponse({
      error: err instanceof Error ? err.message : 'AI assistant failed.',
    }, 500);
  }
});
