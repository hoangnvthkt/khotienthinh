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
  model?: string;
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

const CLASSIFICATION_PROMPT = `
Bạn là bộ phân loại câu hỏi (Classifier Agent) cho hệ thống ERP Kho Tiến Thịnh.
Nhiệm vụ của bạn là kiểm tra xem câu hỏi hiện tại của người dùng có liên quan đến các chủ đề được phép hỗ trợ sau đây hay không.

Các chủ đề ĐƯỢC PHÉP HỖ TRỢ (được coi là liên quan):
- Chào hỏi hoặc giao tiếp cơ bản (như "xin chào", "hello", "chào bạn", "bạn là ai").
- Hỏi về danh sách dự án, công trường, tiến độ thi công, tiến độ dự án.
- Hỏi về vật tư, thiết bị, giá vật tư, tồn kho ở các kho, nhập xuất kho.
- Hỏi về nhân sự, thông tin nhân viên, phòng ban, chấm công, nghỉ phép, lương.
- Hỏi về tài sản công ty, danh mục thiết bị, lịch bảo trì thiết bị.
- Hỏi về tài chính của dự án, doanh thu, ngân sách dự toán, chi phí thực tế, lãi lỗ.
- Hỏi về nhật ký thi công (daily logs), nghiệm thu chất lượng (quality checklists), biên bản nghiệm thu.
- Hỏi về các quy trình, tài liệu quy định nội bộ hoặc chính sách công ty có trong Kho Kiến Thức.
- Hướng dẫn hoặc giải đáp thắc mắc về cách sử dụng phần mềm Vioo/Kho Tiến Thịnh.

Các câu hỏi KHÔNG ĐƯỢC PHÉP HỖ TRỢ (câu hỏi ngoài lề, vu vơ):
- Các câu hỏi tâm sự đời sống, tán gẫu sâu, trò đùa, đố vui.
- Các kiến thức khoa học, toán học, địa lý, thời tiết hoặc kỹ thuật lập trình chung chung không liên quan đến công ty (VD: "thời tiết hôm nay thế nào", "phương trình bậc 2 giải sao", "viết code python kết nối database", "dịch từ hello").
- Hỏi về các công ty khác hoặc tin tức thế giới không liên quan đến Kho Tiến Thịnh.
- Ý kiến chính trị, tôn giáo, các cuộc bàn luận nhạy cảm.

Hãy trả về định dạng JSON duy nhất sau:
{
  "is_related": true hoặc false,
  "friendly_rejection": "Lời từ chối lịch sự bằng tiếng Việt (nếu is_related = false, null nếu true). Lời từ chối cần giải thích rõ phần mềm chỉ hỗ trợ tra cứu thông tin doanh nghiệp, tồn kho, nhân sự, dự án hoặc quy trình nội bộ công ty.",
  "suggestions": ["Gợi ý câu hỏi 1", "Gợi ý câu hỏi 2", "Gợi ý câu hỏi 3"] (3 câu hỏi gợi ý liên quan đến chức năng phần mềm để hướng dẫn người dùng quay lại đúng chủ đề, ví dụ: 'Tổng tồn kho hiện tại?', 'Danh sách các dự án?', 'Quy trình xin nghỉ phép?')
}
`;

async function classifyQuestionRelation(
  question: string,
  history: ChatMessage[],
  selectedModel?: string | null
): Promise<{ isRelated: boolean; friendlyRejection?: string; suggestions?: string[] }> {
  const historyText = history.length > 0
    ? `\nLịch sử chat gần đây:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n`
    : '';

  const prompt = `
${CLASSIFICATION_PROMPT}

${historyText}
Câu hỏi hiện tại của người dùng:
"${question}"
`.trim();

  try {
    const raw = await callGemini(prompt, 0, selectedModel || GEMINI_FAST_MODEL, 'application/json');
    const parsed = extractJsonObject(raw);
    return {
      isRelated: parsed.is_related === true,
      friendlyRejection: parsed.friendly_rejection || undefined,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : undefined,
    };
  } catch (err) {
    console.error('classifyQuestionRelation error:', err);
    return { isRelated: true };
  }
}

function extractSuggestionsAndCleanAnswer(content: string): { cleanAnswer: string; suggestions: string[] } {
  const lines = content.split('\n');
  let suggestionsIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('gợi ý câu hỏi:')) {
      suggestionsIndex = i;
      break;
    }
  }

  if (suggestionsIndex === -1) {
    return { cleanAnswer: content, suggestions: [] };
  }

  const cleanAnswer = lines.slice(0, suggestionsIndex).join('\n').trim();
  const suggestionLines = lines.slice(suggestionsIndex + 1);
  const suggestions: string[] = [];

  for (const line of suggestionLines) {
    const match = line.trim().match(/^\d+\.\s*(.+)$/);
    if (match) {
      suggestions.push(match[1].trim());
    } else if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
      suggestions.push(line.replace(/^[-*]\s*/, '').trim());
    } else if (line.trim().length > 0) {
      suggestions.push(line.trim());
    }
  }

  const finalSuggestions = suggestions.map(s => s.replace(/^[123]\.\s*/, '').trim()).filter(s => s.length > 0).slice(0, 3);
  return { cleanAnswer, suggestions: finalSuggestions };
}

const TOOL_SOURCES: Record<string, { title: string; fileName: string }> = {
  ai_tool_project_list: { title: 'Danh sách dự án', fileName: 'Hệ thống Quản lý Dự án (ERP)' },
  ai_tool_project_summary: { title: 'Chi tiết dự án', fileName: 'Hệ thống Quản lý Dự án (ERP)' },
  ai_tool_project_progress: { title: 'Tiến độ thi công', fileName: 'Hệ thống Quản lý Dự án (ERP)' },
  ai_tool_daily_log_summary: { title: 'Nhật ký thi công', fileName: 'Hệ thống Quản lý Dự án (ERP)' },
  ai_tool_inventory_summary: { title: 'Tồn kho hệ thống', fileName: 'Hệ thống Quản lý Kho (WMS)' },
  ai_tool_material_search: { title: 'Tìm kiếm vật tư', fileName: 'Hệ thống Quản lý Kho (WMS)' },
  ai_tool_material_request_status: { title: 'Yêu cầu vật tư (MR)', fileName: 'Hệ thống Quản lý Kho (WMS)' },
  ai_tool_purchase_order_summary: { title: 'Đơn mua hàng (PO)', fileName: 'Hệ thống Quản lý Kho (WMS)' },
  ai_tool_project_finance: { title: 'Tài chính dự án', fileName: 'Hệ thống Quản lý Tài chính' },
  ai_tool_employee_summary: { title: 'Hồ sơ nhân sự', fileName: 'Hệ thống Quản lý Nhân sự (HRM)' },
  ai_tool_attendance_report: { title: 'Báo cáo chấm công', fileName: 'Hệ thống Quản lý Nhân sự (HRM)' },
  ai_tool_executive_dashboard: { title: 'Dashboard tổng hợp', fileName: 'Hệ thống Quản lý Vioo ERP' },
};

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

async function routeToTool(question: string, history: ChatMessage[], selectedModel?: string | null) {
  const prompt = `
${TOOL_ROUTER_PROMPT}

Available tools:
${JSON.stringify(AI_TOOL_DEFINITIONS, null, 2)}

Recent conversation:
${history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-6000)}

Question:
${question}
`.trim();

  const raw = await callGemini(prompt, 0.05, selectedModel || GEMINI_FAST_MODEL, 'application/json');
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
  selectedModel?: string | null,
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

  return callGemini(prompt, 0.2, selectedModel || GEMINI_FAST_MODEL);
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

async function answerFromKnowledge(question: string, chunks: any[], history: ChatMessage[], isComplex: boolean, selectedModel?: string | null) {
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

  return callGemini(prompt, 0.2, selectedModel || (isComplex ? GEMINI_REASONING_MODEL : GEMINI_FAST_MODEL));
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
    const selectedModel = req.model || null;

    // ── Off-topic classification ──
    const relation = await classifyQuestionRelation(question, history, selectedModel);
    if (!relation.isRelated) {
      const conversationId = await ensureConversation({ ...req, mode }, question);
      await saveMessage({ conversationId, role: 'user', content: question, mode });

      const friendlyRejection = relation.friendlyRejection || 'Xin chào! Em là Trợ lý AI của Kho Tiến Thịnh. Em chỉ có thể hỗ trợ giải đáp các thông tin liên quan đến dữ liệu phần mềm ERP (tồn kho, nhân sự, dự án, tài chính) hoặc tài liệu quy trình trong công ty. Anh/chị vui lòng hỏi đúng chủ đề nhé!';
      const rejectionSuggestions = relation.suggestions || [
        'Tổng tồn kho hiện tại bao nhiêu?',
        'Danh sách dự án đang hoạt động?',
        'Quy trình xin nghỉ phép?',
      ];

      await saveMessage({ conversationId, role: 'assistant', content: friendlyRejection, mode: 'general' });

      return jsonResponse({
        conversationId,
        answer: friendlyRejection,
        mode: 'general',
        suggestions: rejectionSuggestions,
        hasMemory: false,
      });
    }

    const conversationId = await ensureConversation({ ...req, mode }, question);
    await saveMessage({ conversationId, role: 'user', content: question, mode });

    // ── Knowledge Mode ──
    if (mode === 'knowledge') {
      const chunks = await searchKnowledge(question);
      const isComplex = await classifyComplexity(question);
      
      const rawAnswer = chunks.length > 0
        ? await answerFromKnowledge(question, chunks, history, isComplex, selectedModel)
        : 'Em chưa tìm thấy tài liệu nội bộ phù hợp trong Kho Kiến Thức. Anh có thể upload/sync thêm tài liệu hoặc hỏi cụ thể hơn theo tên tài liệu, quy trình, phòng ban.\n\nGợi ý câu hỏi:\n1. Quy trình xin nghỉ phép theo nội quy công ty?\n2. Quy định bảo mật thông tin nội bộ là gì?\n3. Tiêu chuẩn an toàn lao động trên công trường?';

      const { cleanAnswer, suggestions } = extractSuggestionsAndCleanAnswer(rawAnswer);

      const sources = chunks.map((c: any) => ({
        title: c.title,
        fileName: c.file_name,
        similarity: c.rank || 0,
      }));

      await saveMessage({ conversationId, role: 'assistant', content: cleanAnswer, mode: 'rag', sources });
      return jsonResponse({
        conversationId,
        answer: cleanAnswer,
        mode: 'rag',
        sources,
        suggestions: suggestions.length > 0 ? suggestions : [
          'Quy trình xin nghỉ phép theo nội quy công ty?',
          'Quy định bảo mật thông tin nội bộ là gì?',
          'Tiêu chuẩn an toàn lao động trên công trường?',
        ],
        hasMemory: chunks.length > 0,
      });
    }

    // ── Data Mode — Agentic Tool-calling ──
    let route: any = null;
    try {
      route = await routeToTool(question, history, selectedModel);
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

      const rawAnswer = await formatToolResult(question, route.toolName, toolResult, history, selectedModel);
      const { cleanAnswer, suggestions } = extractSuggestionsAndCleanAnswer(rawAnswer);

      const toolSource = TOOL_SOURCES[route.toolName]
        ? [{ ...TOOL_SOURCES[route.toolName], similarity: 1 }]
        : [{ title: 'Dữ liệu ERP', fileName: 'Cơ sở dữ liệu hệ thống', similarity: 1 }];

      const finalSuggestions = suggestions.length > 0 ? suggestions : (route.suggestions || []);

      await saveMessage({
        conversationId,
        role: 'assistant',
        content: cleanAnswer,
        mode: 'sql',
        toolName: route.toolName,
        sources: toolSource,
      });

      return jsonResponse({
        conversationId,
        answer: cleanAnswer,
        toolName: route.toolName,
        mode: 'sql',
        suggestions: finalSuggestions,
        sources: toolSource,
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
