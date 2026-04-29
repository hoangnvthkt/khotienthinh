import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import {
  DATA_ASSISTANT_SYSTEM_PROMPT,
  FALLBACK_DATABASE_CATALOG,
  KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT,
  SQL_PLANNER_PROMPT,
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
const GEMINI_REASONING_MODEL = Deno.env.get('GEMINI_REASONING_MODEL') || 'gemini-3.0-flash';
const MAX_ROWS_FOR_CONTEXT = 80;
const MAX_CATALOG_CHARS = 18000;
const MAX_RESULT_CHARS = 26000;

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || '';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

function validateReadonlySql(sql: string) {
  const normalized = sql.trim().replace(/;\s*$/, '');
  const lower = normalized.toLowerCase();
  const banned =
    /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|replace|merge|call|copy|do|execute|notify|listen|vacuum|analyze|set|reset|refresh)\b/i;
  const bannedSchemas = /\b(auth|storage|vault|net|extensions|pg_catalog|information_schema)\s*\./i;

  if (!/^(select|with)\s/i.test(lower)) throw new Error('SQL must start with SELECT or WITH.');
  if (normalized.includes(';')) throw new Error('SQL must contain exactly one statement.');
  if (/(--|\/\*)/.test(normalized)) throw new Error('SQL comments are not allowed.');
  if (banned.test(lower)) throw new Error('SQL contains a blocked keyword.');
  if (bannedSchemas.test(lower)) throw new Error('SQL references a blocked schema.');

  return normalized;
}

async function callGemini(prompt: string, temperature = 0.15, model = GEMINI_FAST_MODEL): Promise<string> {
  if (!geminiKey) throw new Error('Missing GEMINI_API_KEY.');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: 4096,
        },
      }),
    },
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Gemini request failed.');
  return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
}

async function getDatabaseCatalog() {
  const { data, error } = await admin.rpc('ai_database_catalog');
  if (error || !data) return FALLBACK_DATABASE_CATALOG;
  return data;
}

async function planSql(question: string, history: ChatMessage[]) {
  const catalog = await getDatabaseCatalog();
  const prompt = `
${SQL_PLANNER_PROMPT}

System rules:
${DATA_ASSISTANT_SYSTEM_PROMPT}

Schema catalog:
${compactJson(catalog, MAX_CATALOG_CHARS)}

Recent conversation:
${history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-6000)}

Question:
${question}
`.trim();

  const raw = await callGemini(prompt, 0.05, GEMINI_REASONING_MODEL);
  const parsed = extractJsonObject(raw);
  const sql = validateReadonlySql(String(parsed.sql || ''));
  return { sql, reason: String(parsed.reason || '') };
}

async function executeSql(sql: string) {
  const { data, error } = await admin.rpc('execute_ai_readonly_query', { p_query: sql });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, MAX_ROWS_FOR_CONTEXT) : [];
  return {
    rows,
    rowCount: data?.rowCount ?? rows.length,
    limited: Boolean(data?.limited),
  };
}

async function answerFromRows(question: string, sql: string, rowsPayload: unknown, history: ChatMessage[]) {
  const prompt = `
${DATA_ASSISTANT_SYSTEM_PROMPT}

Recent conversation:
${history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-6000)}

Question:
${question}

SQL used:
${sql}

Query result JSON:
${compactJson(rowsPayload, MAX_RESULT_CHARS)}

Hãy trả lời bằng tiếng Việt, đúng trọng tâm. Nếu là danh sách dài, chỉ tóm tắt nhóm quan trọng và nói rõ có giới hạn kết quả.
`.trim();

  return callGemini(prompt, 0.2, GEMINI_FAST_MODEL);
}

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
  const prompt = `Phân loại câu hỏi này có cần phân tích sâu, so sánh, tổng hợp nhiều thông tin, hay tìm hiểu nguyên nhân phức tạp không?
Trả lời CHỈ một từ: COMPLEX hoặc SIMPLE.
Câu hỏi: ${question}`;
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
  sources?: unknown;
}) {
  const { error } = await admin.from('ai_messages').insert({
    conversation_id: args.conversationId,
    role: args.role,
    content: args.content,
    mode: args.mode || null,
    sql_query: args.sqlQuery || null,
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

    const plan = await planSql(question, history);
    const result = await executeSql(plan.sql);
    const answer = await answerFromRows(question, plan.sql, result, history);
    const suggestions = [
      'Phân tích chi tiết theo tháng',
      'Cho xem các bản ghi bất thường',
      'So sánh với kỳ trước',
    ];

    await saveMessage({ conversationId, role: 'assistant', content: answer, mode: 'sql', sqlQuery: plan.sql });
    return jsonResponse({
      conversationId,
      answer,
      sqlQuery: plan.sql,
      mode: 'sql',
      suggestions,
      hasMemory: false,
    });
  } catch (err) {
    console.error('ai-assistant error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'AI assistant failed.' }, 500);
  }
});
