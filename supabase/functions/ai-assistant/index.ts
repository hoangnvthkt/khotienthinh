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
  action?: 'feedback' | 'estimate_suggestion' | 'cost_norm_standardization' | 'cost_norm_import_excel' | 'tender_detect_columns' | 'tender_suggest_mapping' | 'tender_risk_rfi';
  question?: string;
  prompt?: string;
  conversationId?: string | null;
  userId?: string;
  mode?: AiMode;
  history?: ChatMessage[];
  messageId?: string;
  rating?: 1 | -1;
  comment?: string;
  reason?: string;
  correctionText?: string;
  approvedAnswer?: string;
  feedbackType?: 'rating' | 'correction' | 'approved_answer';
  answer?: string;
  sqlQuery?: string;
  model?: string;
  templates?: any[];
  currentInput?: Record<string, unknown>;
  selectedTemplateId?: string;
  canSeeInternalCost?: boolean;
  workbook?: any;
  packageId?: string;
  lines?: any[];
  mappings?: any[];
  pricingGaps?: any[];
  item?: any;
  targetItem?: any;
  baseQuantity?: number | null;
  rawMaterials?: any[];
  normalizedRows?: any[];
  priceBookSamples?: any[];
  fileName?: string;
  sheetName?: string;
  rows?: any[];
  mergedRanges?: any[];
  localPackages?: any[];
}

interface AppUserContext {
  id: string;
  role?: string | null;
  email?: string | null;
  isActive?: boolean | null;
  allowedModules?: string[] | null;
  adminModules?: string[] | null;
  source: 'jwt' | 'body';
}

interface LearningContext {
  userPreferences: Record<string, unknown> | null;
  rules: Array<{ title: string; content: string; domain?: string | null; priority?: number | null }>;
  glossary: Array<{ term: string; definition: string; aliases?: string[] | null; domain?: string | null }>;
  memories: Array<{ content: string; category?: string | null; scope?: string | null; importance?: number | null; domain?: string | null }>;
  patterns: Array<{ questionSample?: string | null; toolName?: string | null; routeAction?: string | null; successCount?: number | null }>;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_FAST_MODEL = Deno.env.get('GEMINI_FAST_MODEL') || 'gemini-3.5-flash';
const GEMINI_FAST_FALLBACK_MODEL = Deno.env.get('GEMINI_FAST_FALLBACK_MODEL') || 'gemini-2.5-flash';
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

function estimateTokenCount(text: string) {
  return Math.ceil((text || '').length / 4);
}

function isUuid(value?: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

function normalizePatternQuestion(question: string) {
  return question
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function inferDomainFromTool(toolName?: string | null, mode?: string | null) {
  if (mode === 'knowledge') return 'knowledge';
  if (!toolName) return 'general';
  if (toolName.includes('inventory') || toolName.includes('material') || toolName.includes('purchase_order')) return 'wms';
  if (toolName.includes('employee') || toolName.includes('attendance')) return 'hrm';
  if (toolName.includes('project') || toolName.includes('daily_log')) return 'project';
  if (toolName.includes('estimate') || toolName.includes('cost') || toolName.includes('price') || toolName.includes('norm')) return 'cost_estimate';
  if (toolName.includes('executive')) return 'executive';
  return 'general';
}

function countLearningSignals(ctx: LearningContext | null) {
  if (!ctx) return 0;
  return (ctx.rules?.length || 0)
    + (ctx.glossary?.length || 0)
    + (ctx.memories?.length || 0)
    + (ctx.patterns?.length || 0)
    + (ctx.userPreferences ? 1 : 0);
}

function buildLearningContextPrompt(ctx: LearningContext | null) {
  if (!ctx || countLearningSignals(ctx) === 0) return '';

  const sections: string[] = [];
  if (ctx.rules.length > 0) {
    sections.push(`Business rules da duyet:\n${ctx.rules.map((r, i) => `${i + 1}. ${r.title}: ${r.content}`).join('\n')}`);
  }
  if (ctx.glossary.length > 0) {
    sections.push(`Tu dien thuat ngu noi bo:\n${ctx.glossary.map((g, i) => {
      const aliases = Array.isArray(g.aliases) && g.aliases.length > 0 ? ` (goi khac: ${g.aliases.join(', ')})` : '';
      return `${i + 1}. ${g.term}${aliases}: ${g.definition}`;
    }).join('\n')}`);
  }
  if (ctx.memories.length > 0) {
    sections.push(`Bo nho AI da duyet:\n${ctx.memories.map((m, i) => `${i + 1}. [${m.scope || 'memory'}${m.domain ? `/${m.domain}` : ''}] ${m.content}`).join('\n')}`);
  }
  if (ctx.userPreferences) {
    sections.push(`Tuy chon nguoi dung:\n${compactJson(ctx.userPreferences, 1200)}`);
  }
  if (ctx.patterns.length > 0) {
    sections.push(`Mau truy van thanh cong gan day (chi dung lam goi y router, khong thay the authorization):\n${ctx.patterns.map((p, i) => `${i + 1}. ${p.questionSample || ''} -> ${p.routeAction || 'tool_call'}${p.toolName ? `/${p.toolName}` : ''}`).join('\n')}`);
  }

  return `
Approved AI Learning Context:
- Chi su dung thong tin da duyet trong section nay de dieu chinh cach tra loi.
- Khong xem section nay la quyen truy cap du lieu. Quyen doc du lieu van phai theo tool authorization/RPC.
- Neu business rule mau thuan voi du lieu tool, uu tien du lieu tool va neu can thi noi ro can kiem tra lai rule.

${sections.join('\n\n')}
`.trim();
}

async function collectLearningContext(args: {
  userId?: string | null;
  domain?: string | null;
  mode?: AiMode;
}): Promise<LearningContext> {
  const domain = args.domain || 'general';
  const userId = args.userId || null;
  const empty: LearningContext = {
    userPreferences: null,
    rules: [],
    glossary: [],
    memories: [],
    patterns: [],
  };

  try {
    const [preferences, rules, glossary, enterpriseMemory, domainMemory, userMemory, patterns] = await Promise.all([
      userId
        ? admin.from('ai_user_preferences').select('*').eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from('ai_business_rules')
        .select('title, content, domain, priority')
        .eq('status', 'approved')
        .or(`domain.is.null,domain.eq.${domain}`)
        .order('priority', { ascending: false })
        .limit(8),
      admin
        .from('ai_business_glossary')
        .select('term, definition, aliases, domain')
        .eq('status', 'approved')
        .or(`domain.is.null,domain.eq.${domain}`)
        .order('term', { ascending: true })
        .limit(12),
      admin
        .from('ai_memory')
        .select('content, category, scope, importance, domain')
        .eq('status', 'approved')
        .eq('scope', 'enterprise')
        .order('importance', { ascending: false })
        .limit(4),
      admin
        .from('ai_memory')
        .select('content, category, scope, importance, domain')
        .eq('status', 'approved')
        .eq('scope', 'domain')
        .eq('domain', domain)
        .order('importance', { ascending: false })
        .limit(4),
      userId
        ? admin
          .from('ai_memory')
          .select('content, category, scope, importance, domain')
          .eq('status', 'approved')
          .eq('scope', 'user')
          .eq('user_id', userId)
          .order('importance', { ascending: false })
          .limit(4)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('ai_query_patterns')
        .select('question_sample, tool_name, route_action, success_count')
        .eq('mode', args.mode || 'data')
        .order('success_count', { ascending: false })
        .order('last_used_at', { ascending: false })
        .limit(5),
    ]);

    for (const result of [preferences, rules, glossary, enterpriseMemory, domainMemory, userMemory, patterns]) {
      if ((result as any)?.error) {
        console.warn('ai learning context query skipped:', (result as any).error.message);
      }
    }

    return {
      userPreferences: preferences.data ? {
        tone: preferences.data.tone,
        responseLength: preferences.data.response_length,
        showDataSources: preferences.data.show_data_sources,
        preferTables: preferences.data.prefer_tables,
      } : null,
      rules: (rules.data || []).map((r: any) => ({
        title: String(r.title || ''),
        content: String(r.content || ''),
        domain: r.domain || null,
        priority: Number(r.priority || 0),
      })).filter(r => r.title && r.content),
      glossary: (glossary.data || []).map((g: any) => ({
        term: String(g.term || ''),
        definition: String(g.definition || ''),
        aliases: Array.isArray(g.aliases) ? g.aliases.map(String) : [],
        domain: g.domain || null,
      })).filter(g => g.term && g.definition),
      memories: [
        ...(enterpriseMemory.data || []),
        ...(domainMemory.data || []),
        ...(userMemory.data || []),
      ].map((m: any) => ({
        content: String(m.content || ''),
        category: m.category || null,
        scope: m.scope || null,
        importance: Number(m.importance || 0),
        domain: m.domain || null,
      })).filter(m => m.content).slice(0, 10),
      patterns: (patterns.data || []).map((p: any) => ({
        questionSample: p.question_sample || null,
        toolName: p.tool_name || null,
        routeAction: p.route_action || null,
        successCount: Number(p.success_count || 0),
      })),
    };
  } catch (err) {
    console.warn('collectLearningContext failed:', err);
    return empty;
  }
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
- Hỏi về chào thầu, BOQ Chủ đầu tư, AI Tender BOQ Analyzer, dự toán nhanh, đơn giá nội bộ, định mức nội bộ, template dự toán, estimate scenario, chuyển estimate thành BOQ.
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
  ai_tool_employee_search: { title: 'Tìm kiếm nhân sự', fileName: 'Hệ thống Quản lý Nhân sự (HRM)' },
  ai_tool_attendance_report: { title: 'Báo cáo chấm công', fileName: 'Hệ thống Quản lý Nhân sự (HRM)' },
  ai_tool_estimate_module_blueprint: { title: 'Blueprint AI dự toán nhanh', fileName: 'Module Đơn giá nội bộ & AI dự toán nhanh' },
  ai_tool_cost_template_summary: { title: 'Cost templates', fileName: 'Module Đơn giá nội bộ & AI dự toán nhanh' },
  ai_tool_internal_price_book_lookup: { title: 'Đơn giá nội bộ', fileName: 'Internal Price Book' },
  ai_tool_internal_norms_lookup: { title: 'Định mức nội bộ', fileName: 'Internal Norms' },
  ai_tool_estimate_scenario_summary: { title: 'Phương án dự toán', fileName: 'Estimate Scenarios' },
  ai_tool_executive_dashboard: { title: 'Dashboard tổng hợp', fileName: 'Hệ thống Quản lý Vioo ERP' },
};

const TOOL_ACCESS: Record<string, { requiresJwt?: boolean; adminModules?: string[]; message: string }> = {
  ai_tool_cost_template_summary: {
    requiresJwt: true,
    adminModules: ['HD', 'DA', 'TENDER_AI'],
    message: 'Cost template là dữ liệu nghiệp vụ nội bộ. Anh/chị cần đăng nhập bằng tài khoản Admin hoặc quản trị module Hợp đồng/Dự án để AI tra cứu.',
  },
  ai_tool_internal_price_book_lookup: {
    requiresJwt: true,
    adminModules: ['HD', 'TENDER_AI'],
    message: 'Đơn giá nội bộ là dữ liệu nhạy cảm. AI chỉ được tra cứu khi tài khoản là Admin hoặc quản trị module Hợp đồng.',
  },
  ai_tool_internal_norms_lookup: {
    requiresJwt: true,
    adminModules: ['HD', 'DA', 'TENDER_AI'],
    message: 'Định mức nội bộ là dữ liệu nhạy cảm. AI chỉ được tra cứu khi tài khoản là Admin hoặc quản trị module Hợp đồng/Dự án.',
  },
  ai_tool_estimate_scenario_summary: {
    requiresJwt: true,
    adminModules: ['HD', 'DA', 'TENDER_AI'],
    message: 'Phương án dự toán/chào thầu cần quyền nội bộ. Anh/chị cần đăng nhập bằng tài khoản Admin hoặc quản trị module Hợp đồng/Dự án.',
  },
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v).trim()).filter(Boolean);
}

function isAdminOrModuleAdmin(actor: AppUserContext | null, modules: string[]) {
  if (!actor || actor.isActive === false) return false;
  if (String(actor.role || '').toUpperCase() === 'ADMIN') return true;
  const adminModules = normalizeStringArray(actor.adminModules).map(m => m.toUpperCase());
  return modules.some(moduleCode => adminModules.includes(moduleCode.toUpperCase()));
}

function canUseEstimateAssistant(actor: AppUserContext | null) {
  if (!actor || actor.isActive === false) return false;
  if (String(actor.role || '').toUpperCase() === 'ADMIN') return true;
  const allowedModules = normalizeStringArray(actor.allowedModules).map(m => m.toUpperCase());
  const adminModules = normalizeStringArray(actor.adminModules).map(m => m.toUpperCase());
  return ['HD', 'DA', 'TENDER_AI'].some(moduleCode => allowedModules.includes(moduleCode) || adminModules.includes(moduleCode));
}

function canUseTenderAssistant(actor: AppUserContext | null) {
  if (!actor || actor.isActive === false) return false;
  if (String(actor.role || '').toUpperCase() === 'ADMIN') return true;
  const allowedModules = normalizeStringArray(actor.allowedModules).map(m => m.toUpperCase());
  const adminModules = normalizeStringArray(actor.adminModules).map(m => m.toUpperCase());
  return allowedModules.includes('TENDER_AI') || adminModules.includes('TENDER_AI') || allowedModules.includes('HD') || adminModules.includes('HD');
}

function canUseCostNormAssistant(actor: AppUserContext | null) {
  return isAdminOrModuleAdmin(actor, ['HD', 'TENDER_AI']);
}

function getBearerToken(request: Request) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function findAppUserByAuthUser(authUser: any): Promise<AppUserContext | null> {
  if (!authUser?.id && !authUser?.email) return null;

  if (authUser.id) {
    const byAuthId = await admin
      .from('users')
      .select('id, role, email, is_active, allowed_modules, admin_modules')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (byAuthId.data) {
      return {
        id: byAuthId.data.id,
        role: byAuthId.data.role,
        email: byAuthId.data.email,
        isActive: byAuthId.data.is_active,
        allowedModules: byAuthId.data.allowed_modules,
        adminModules: byAuthId.data.admin_modules,
        source: 'jwt',
      };
    }
  }

  if (authUser.email) {
    const byEmail = await admin
      .from('users')
      .select('id, role, email, is_active, allowed_modules, admin_modules')
      .ilike('email', authUser.email)
      .maybeSingle();

    if (byEmail.data) {
      return {
        id: byEmail.data.id,
        role: byEmail.data.role,
        email: byEmail.data.email,
        isActive: byEmail.data.is_active,
        allowedModules: byEmail.data.allowed_modules,
        adminModules: byEmail.data.admin_modules,
        source: 'jwt',
      };
    }
  }

  return null;
}

async function resolveActor(request: Request, fallbackUserId?: string): Promise<AppUserContext | null> {
  const token = getBearerToken(request);
  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data?.user) {
      const appUser = await findAppUserByAuthUser(data.user);
      if (appUser) return appUser;
    } else {
      console.warn('ai-assistant auth token validation failed:', error?.message);
    }
  }

  if (fallbackUserId) {
    const { data } = await admin
      .from('users')
      .select('id, role, email, is_active, allowed_modules, admin_modules')
      .eq('id', fallbackUserId)
      .maybeSingle();

    if (data) {
      return {
        id: data.id,
        role: data.role,
        email: data.email,
        isActive: data.is_active,
        allowedModules: data.allowed_modules,
        adminModules: data.admin_modules,
        source: 'body',
      };
    }
  }

  return null;
}

function authorizeTool(toolName: string, actor: AppUserContext | null): { allowed: boolean; message?: string; suggestions?: string[] } {
  const access = TOOL_ACCESS[toolName];
  if (!access) return { allowed: true };

  if (access.requiresJwt && actor?.source !== 'jwt') {
    return {
      allowed: false,
      message: `${access.message}\n\nLưu ý: phiên hiện tại chưa gửi access token hợp lệ tới AI Assistant.`,
      suggestions: [
        'Thiết kế module AI dự toán nhanh như thế nào?',
        'Các bảng dữ liệu của module dự toán gồm những gì?',
        'Nguyên tắc bảo mật đơn giá nội bộ là gì?',
      ],
    };
  }

  if (!isAdminOrModuleAdmin(actor, access.adminModules || [])) {
    return {
      allowed: false,
      message: access.message,
      suggestions: [
        'Thiết kế module AI dự toán nhanh như thế nào?',
        'Các bảng dữ liệu của module dự toán gồm những gì?',
        'Nguyên tắc snapshot dự toán cũ là gì?',
      ],
    };
  }

  return { allowed: true };
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

  const requestModel = async (modelName: string) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  let res = await requestModel(model);
  const data = await res.json();
  if (!res.ok && model === GEMINI_FAST_MODEL && GEMINI_FAST_FALLBACK_MODEL && GEMINI_FAST_FALLBACK_MODEL !== model) {
    console.warn(`Gemini model ${model} failed, retrying ${GEMINI_FAST_FALLBACK_MODEL}:`, data?.error?.message || res.status);
    res = await requestModel(GEMINI_FAST_FALLBACK_MODEL);
    const fallbackData = await res.json();
    if (!res.ok) throw new Error(fallbackData?.error?.message || 'Gemini request failed.');
    return fallbackData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  }
  if (!res.ok) throw new Error(data?.error?.message || 'Gemini request failed.');
  return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
}

// ═══ Tool Router — Replaces planSql() ════════════════════════

const ALLOWED_TOOL_NAMES = AI_TOOL_DEFINITIONS.map(t => t.name);

function getMissingRequiredParams(toolName: string, params: Record<string, any>) {
  const definition = AI_TOOL_DEFINITIONS.find(tool => tool.name === toolName);
  if (!definition?.parameters) return [];

  return Object.entries(definition.parameters)
    .filter(([, spec]: any) => spec?.required)
    .map(([key]) => key)
    .filter(key => params[key] === null || params[key] === undefined || String(params[key]).trim() === '');
}

async function routeToTool(
  question: string,
  history: ChatMessage[],
  selectedModel?: string | null,
  learningContextPrompt = '',
) {
  const prompt = `
${TOOL_ROUTER_PROMPT}

${learningContextPrompt ? `${learningContextPrompt}\n` : ''}

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
  learningContextPrompt = '',
) {
  const prompt = `
${DATA_ASSISTANT_SYSTEM_PROMPT}

${learningContextPrompt ? `${learningContextPrompt}\n` : ''}

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

async function answerFromKnowledge(
  question: string,
  chunks: any[],
  history: ChatMessage[],
  isComplex: boolean,
  selectedModel?: string | null,
  learningContextPrompt = '',
) {
  const prompt = `
${KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT}

${learningContextPrompt ? `${learningContextPrompt}\n` : ''}

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
  if (req.conversationId) {
    await admin
      .from('ai_conversations')
      .update({ updated_at: new Date().toISOString(), model_used: req.model || null })
      .eq('id', req.conversationId);
    return req.conversationId;
  }

  const id = crypto.randomUUID();
  const { error } = await admin.from('ai_conversations').insert({
    id,
    title: title.length > 80 ? `${title.slice(0, 77)}...` : title,
    mode: req.mode || 'data',
    user_id: req.userId || 'anonymous',
    model_used: req.model || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) console.warn('ai_conversations insert failed:', error.message);
  return id;
}

async function updateConversationMeta(args: {
  conversationId: string;
  classifiedDomain?: string | null;
  modelUsed?: string | null;
}) {
  const { error } = await admin
    .from('ai_conversations')
    .update({
      classified_domain: args.classifiedDomain || null,
      model_used: args.modelUsed || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId);
  if (error) console.warn('ai_conversations metadata update failed:', error.message);
}

async function saveMessage(args: {
  conversationId: string;
  role: ChatRole;
  content: string;
  mode?: string;
  sqlQuery?: string;
  toolName?: string;
  sources?: unknown;
  responseTimeMs?: number | null;
  tokenCount?: number | null;
  classifiedDomain?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await admin.from('ai_messages').insert({
    conversation_id: args.conversationId,
    role: args.role,
    content: args.content,
    mode: args.mode || null,
    sql_query: args.toolName ? `[TOOL] ${args.toolName}` : (args.sqlQuery || null),
    tool_name: args.toolName || null,
    sources: args.sources || null,
    response_time_ms: args.responseTimeMs || null,
    token_count: args.tokenCount || estimateTokenCount(args.content),
    classified_domain: args.classifiedDomain || null,
    metadata: args.metadata || {},
    created_at: new Date().toISOString(),
  }).select('id').single();
  if (error) console.warn('ai_messages insert failed:', error.message);
  return data?.id ? String(data.id) : null;
}

async function handleFeedback(req: AssistantRequest, actor: AppUserContext | null) {
  if (!req.messageId || !req.rating) return { ok: true };
  const effectiveUserId = actor?.id || req.userId || 'anonymous';
  const now = new Date().toISOString();
  const feedbackType = req.feedbackType || (req.approvedAnswer ? 'approved_answer' : req.correctionText ? 'correction' : 'rating');
  const status = req.rating === 1 && !req.correctionText && !req.approvedAnswer && !req.reason ? 'approved' : 'pending';
  const aiMessageId = isUuid(req.messageId) ? req.messageId : null;

  const { error: feedbackError } = await admin
    .from('ai_feedback')
    .upsert({
      message_id: req.messageId,
      ai_message_id: aiMessageId,
      conversation_id: isUuid(req.conversationId) ? req.conversationId : null,
      user_id: effectiveUserId,
      rating: req.rating,
      comment: req.comment || req.reason || null,
      reason: req.reason || null,
      correction_text: req.correctionText || null,
      approved_answer: req.approvedAnswer || null,
      feedback_type: feedbackType,
      status,
      question: req.question || null,
      answer: req.approvedAnswer || req.answer || null,
      sql_query: req.sqlQuery || null,
      updated_at: now,
      metadata: {
        actorSource: actor?.source || null,
        actorRole: actor?.role || null,
      },
    }, { onConflict: 'message_id,user_id' });
  if (feedbackError) console.warn('ai_feedback upsert failed:', feedbackError.message);

  const { error: messageError } = await admin
    .from('ai_messages')
    .update({ feedback_rating: req.rating })
    .eq('id', req.messageId);
  if (messageError) console.warn('feedback message update failed:', messageError.message);
  return { ok: true };
}

async function logChatRun(args: {
  conversationId?: string | null;
  userId?: string | null;
  mode?: string | null;
  question?: string | null;
  classifiedDomain?: string | null;
  routeAction?: string | null;
  toolName?: string | null;
  modelUsed?: string | null;
  responseTimeMs?: number | null;
  tokenCount?: number | null;
  status: 'success' | 'rejected' | 'clarification' | 'error';
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await admin.from('ai_chat_runs').insert({
    conversation_id: args.conversationId || null,
    user_id: args.userId || null,
    mode: args.mode || null,
    question: args.question || null,
    classified_domain: args.classifiedDomain || null,
    route_action: args.routeAction || null,
    tool_name: args.toolName || null,
    model_used: args.modelUsed || null,
    response_time_ms: args.responseTimeMs || null,
    token_count: args.tokenCount || null,
    status: args.status,
    error_message: args.errorMessage || null,
    metadata: args.metadata || {},
  });
  if (error) console.warn('ai_chat_runs insert failed:', error.message);
}

async function recordQueryPattern(args: {
  question: string;
  mode: AiMode;
  domain?: string | null;
  routeAction?: string | null;
  toolName?: string | null;
  answer?: string | null;
}) {
  const normalized = normalizePatternQuestion(args.question);
  if (!normalized || !args.toolName) return;

  try {
    const existing = await admin
      .from('ai_query_patterns')
      .select('id, success_count')
      .eq('normalized_question', normalized)
      .eq('tool_name', args.toolName)
      .eq('mode', args.mode)
      .maybeSingle();

    if (existing.data?.id) {
      await admin
        .from('ai_query_patterns')
        .update({
          question_sample: args.question.slice(0, 500),
          classified_domain: args.domain || null,
          route_action: args.routeAction || 'tool_call',
          answer_summary: args.answer ? args.answer.slice(0, 600) : null,
          success_count: Number(existing.data.success_count || 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id);
      return;
    }

    await admin.from('ai_query_patterns').insert({
      normalized_question: normalized,
      question_sample: args.question.slice(0, 500),
      mode: args.mode,
      classified_domain: args.domain || null,
      route_action: args.routeAction || 'tool_call',
      tool_name: args.toolName,
      answer_summary: args.answer ? args.answer.slice(0, 600) : null,
      success_count: 1,
      failure_count: 0,
      last_used_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('recordQueryPattern failed:', err);
  }
}

function normalizeEstimateSuggestionPayload(raw: any, req: AssistantRequest) {
  const templates = Array.isArray(req.templates) ? req.templates : [];
  const selectedTemplate = templates.find((template: any) => template.id === raw?.templateId)
    || templates.find((template: any) => template.id === req.selectedTemplateId)
    || templates[0]
    || null;
  const allowedParamCodes = new Set<string>((selectedTemplate?.parameters || []).map((param: any) => String(param.code)));
  const currentInput = req.currentInput || {};
  const rawInputs = raw?.suggestedInputs && typeof raw.suggestedInputs === 'object' ? raw.suggestedInputs : {};
  const suggestedInputs = Object.fromEntries(
    Object.entries({ ...currentInput, ...rawInputs })
      .filter(([key]) => allowedParamCodes.size === 0 || allowedParamCodes.has(key)),
  );
  const missingParameters = (selectedTemplate?.parameters || [])
    .filter((param: any) => param.isRequired && (suggestedInputs[param.code] === undefined || suggestedInputs[param.code] === ''))
    .map((param: any) => String(param.code));
  const confidenceScore = Math.max(0, Math.min(1, Number(raw?.confidenceScore ?? 0.5)));
  return {
    templateId: selectedTemplate?.id,
    templateName: selectedTemplate?.name,
    suggestedInputs,
    missingParameters,
    assumptions: Array.isArray(raw?.assumptions)
      ? raw.assumptions.map(String)
      : ['AI chỉ gợi ý điền form từ template đã có, không tạo/chốt estimate.'],
    riskWarnings: Array.isArray(raw?.riskWarnings) ? raw.riskWarnings.map(String) : [],
    dataGaps: Array.isArray(raw?.dataGaps) ? raw.dataGaps.map(String) : missingParameters.map((code: string) => `missing_parameter:${code}`),
    confidenceScore,
    source: 'remote',
  };
}

async function handleEstimateSuggestion(req: AssistantRequest, actor: AppUserContext | null) {
  if (!canUseEstimateAssistant(actor)) {
    return jsonResponse({
      error: 'Tài khoản hiện tại chưa có quyền HD/DA để dùng AI gợi ý dự toán trong builder.',
    }, 403);
  }
  const promptText = String(req.prompt || req.question || '').trim();
  if (!promptText) return jsonResponse({ error: 'Thiếu mô tả đầu vào để AI gợi ý.' }, 400);
  const templates = Array.isArray(req.templates) ? req.templates : [];
  const aiPrompt = `
Bạn là AI Estimate Assistant trong ERP thi công nhà xưởng.
Nhiệm vụ: gợi ý template và tham số form dự toán nhanh từ mô tả người dùng.

Quy tắc bắt buộc:
- Chỉ dùng template và parameter được cung cấp trong JSON dưới đây.
- Không bịa đơn giá, định mức, giá vốn, margin hoặc profit.
- Không tạo/chốt estimate. Chỉ trả gợi ý để user bấm "Áp dụng vào form".
- Nếu thiếu tham số quan trọng, ghi vào missingParameters và dataGaps.
- Trả về DUY NHẤT một JSON object, không markdown.

Schema JSON:
{
  "templateId": "id template phù hợp",
  "templateName": "tên template",
  "suggestedInputs": { "parameter_code": "value hoặc number" },
  "missingParameters": ["code"],
  "assumptions": ["giả định"],
  "riskWarnings": ["cảnh báo"],
  "dataGaps": ["thiếu dữ liệu"],
  "confidenceScore": 0.0
}

Mô tả người dùng:
${promptText}

Selected template id:
${req.selectedTemplateId || ''}

Current input:
${compactJson(req.currentInput || {}, 5000)}

Templates:
${compactJson(templates, 18000)}
`.trim();

  const raw = await callGemini(aiPrompt, 0.05, req.model || GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);
  const suggestion = normalizeEstimateSuggestionPayload(parsed, req);
  console.info('ai-assistant estimate_suggestion', JSON.stringify({
    actorId: actor?.id || null,
    templateId: suggestion.templateId || null,
    missingParameters: suggestion.missingParameters,
    confidenceScore: suggestion.confidenceScore,
    at: new Date().toISOString(),
  }));
  return jsonResponse({ suggestion });
}

function normalizeNormResourceType(value: unknown) {
  const text = String(value || 'material');
  return ['material', 'labor', 'machine', 'subcontract', 'overhead', 'other'].includes(text) ? text : 'material';
}

function normalizeNormSuggestionRows(raw: any, req: AssistantRequest) {
  const rows = Array.isArray(raw?.suggestions) ? raw.suggestions : Array.isArray(raw?.rows) ? raw.rows : [];
  const sourceIds = new Set((Array.isArray(req.rawMaterials) ? req.rawMaterials : []).map((row: any) => String(row.sourceMaterialBudgetItemId || '')).filter(Boolean));
  const baseQuantity = Number(req.baseQuantity || req.item?.baseQuantity || 0);
  return rows.map((row: any, index: number) => {
    const sourceId = row.sourceMaterialBudgetItemId && sourceIds.has(String(row.sourceMaterialBudgetItemId))
      ? String(row.sourceMaterialBudgetItemId)
      : null;
    const resourceName = String(row.resourceName || row.itemName || '').trim();
    const resourceCode = row.resourceCode || row.materialCode ? String(row.resourceCode || row.materialCode) : '';
    const normQuantity = Math.max(0, Number(row.normQuantity ?? row.quantity ?? 0));
    const rawQuantity = row.rawQuantity === null || row.rawQuantity === undefined ? null : Number(row.rawQuantity);
    const confidenceScore = Math.max(0, Math.min(1, Number(row.confidenceScore ?? 0.5)));
    return {
      id: String(row.id || sourceId || row.normCode || `${req.item?.id || 'item'}-ai-${index}`),
      sourceMaterialBudgetItemId: sourceId,
      normCode: row.normCode ? String(row.normCode).slice(0, 120) : '',
      resourceCode,
      resourceName,
      resourceType: normalizeNormResourceType(row.resourceType),
      category: row.category ? String(row.category) : '',
      unit: String(row.unit || '').trim(),
      rawQuantity: Number.isFinite(rawQuantity) ? rawQuantity : null,
      baseQuantity: Number.isFinite(baseQuantity) && baseQuantity > 0 ? baseQuantity : null,
      normQuantity,
      suggestedNormQuantity: Math.max(0, Number(row.suggestedNormQuantity ?? normQuantity)),
      wastePercent: Math.max(0, Number(row.wastePercent ?? 0)),
      region: row.region ? String(row.region) : 'all',
      versionNo: 1,
      confidenceScore,
      note: row.note ? String(row.note) : '',
      reason: String(row.reason || 'AI gợi ý chuẩn hóa từ dữ liệu tham chiếu.'),
      needsReview: row.needsReview !== false,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
    };
  }).filter((row: any) => row.resourceName && row.unit && row.normQuantity >= 0);
}

async function handleCostNormStandardization(req: AssistantRequest, actor: AppUserContext | null) {
  if (!canUseCostNormAssistant(actor)) {
    return jsonResponse({ error: 'Tài khoản hiện tại chưa có quyền Admin/HD admin/Tender AI admin để dùng AI chuẩn hóa định mức.' }, 403);
  }
  const item = req.item || {};
  const targetItem = req.targetItem || {};
  const rawMaterials = Array.isArray(req.rawMaterials) ? req.rawMaterials.slice(0, 120) : [];
  const normalizedRows = Array.isArray(req.normalizedRows) ? req.normalizedRows.slice(0, 120) : [];
  const priceBookSamples = Array.isArray(req.priceBookSamples) ? req.priceBookSamples.slice(0, 80) : [];
  const baseQuantity = Number(req.baseQuantity || item.baseQuantity || 0);
  const prompt = `
Bạn là AI trợ lý chuẩn hóa định mức nội bộ cho công ty thi công nhà xưởng.
Nhiệm vụ: gợi ý bảng định mức draft cho gói/hạng mục định mức đích, dựa trên hạng mục tham chiếu Sơn Miền Bắc.

Quy tắc bắt buộc:
- Hạng mục tham chiếu chỉ dùng để lấy rawMaterials và tính gợi ý ban đầu.
- Gói định mức đích mới là nơi người dùng sẽ lưu thư viện định mức; mã/tên gói đích phải được ưu tiên khi gợi ý normCode.
- Chỉ dùng dữ liệu hạng mục tham chiếu, gói đích, rawMaterials, normalizedRows và priceBookSamples được cung cấp.
- Không bịa đơn giá, margin, profit, risk buffer.
- Định mức normQuantity là hao phí trên 1 đơn vị gói/hạng mục định mức đích, ưu tiên công thức rawQuantity / baseQuantity tham chiếu khi có đủ dữ liệu.
- Nếu baseQuantity thiếu hoặc <= 0, không tự tính normQuantity từ raw quantity; đặt needsReview=true và giải thích.
- Không tự tạo nguồn lực mới nếu không có căn cứ. Nếu gợi ý nhân công/máy/thầu phụ thì needsReview=true và reason phải nêu rõ vì sao.
- Không lưu DB, không activate; chỉ trả về dữ liệu để frontend fill draft.
- Trả về DUY NHẤT JSON object.

Schema:
{
  "suggestions": [
    {
      "sourceMaterialBudgetItemId": "id raw material hoặc null",
      "normCode": "mã định mức draft nếu có",
      "resourceCode": "mã nguồn lực/vật tư nếu có",
      "resourceName": "tên nguồn lực/vật tư",
      "resourceType": "material|labor|machine|subcontract|overhead|other",
      "category": "nhóm nếu có",
      "unit": "đơn vị",
      "rawQuantity": 0,
      "baseQuantity": 0,
      "normQuantity": 0,
      "suggestedNormQuantity": 0,
      "wastePercent": 0,
      "region": "all",
      "confidenceScore": 0.0,
      "note": "ghi chú ngắn",
      "reason": "lý do gợi ý",
      "needsReview": true,
      "sortOrder": 0
    }
  ],
  "warnings": ["cảnh báo dữ liệu thiếu hoặc bất thường"],
  "confidenceScore": 0.0
}

Hạng mục tham chiếu:
${compactJson(item, 6000)}

Gói định mức đích:
${compactJson(targetItem, 4000)}

Base quantity:
${Number.isFinite(baseQuantity) ? baseQuantity : null}

Raw materials:
${compactJson(rawMaterials, 14000)}

Normalized rows hiện có:
${compactJson(normalizedRows, 12000)}

Price book samples không bao gồm đơn giá:
${compactJson(priceBookSamples, 10000)}
`.trim();

  const raw = await callGemini(prompt, 0.04, req.model || GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);
  const suggestions = normalizeNormSuggestionRows(parsed, req);
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 10) : [];
  const confidenceScore = Math.max(0, Math.min(1, Number(parsed.confidenceScore ?? (
    suggestions.length ? suggestions.reduce((sum: number, row: any) => sum + Number(row.confidenceScore || 0), 0) / suggestions.length : 0.4
  ))));
  await writeTenderAiLog(req, actor, 'cost_norm_standardization', {
    suggestions,
    warnings,
    confidenceScore,
  });
  return jsonResponse({ suggestions, warnings, confidenceScore });
}

function normalizeCostNormImportPayload(raw: any) {
  const packages = Array.isArray(raw?.packages) ? raw.packages : [];
  return packages.map((pkg: any, packageIndex: number) => {
    const lines = Array.isArray(pkg.lines) ? pkg.lines : [];
    return {
      id: String(pkg.id || `ai-package-${packageIndex + 1}`),
      sourceRowStart: Math.max(1, Number(pkg.sourceRowStart || pkg.rowNumber || 1)),
      sourceRowEnd: Math.max(1, Number(pkg.sourceRowEnd || pkg.sourceRowStart || pkg.rowNumber || 1)),
      workCode: String(pkg.workCode || pkg.code || '').trim().slice(0, 120),
      workName: String(pkg.workName || pkg.name || '').trim(),
      unit: String(pkg.unit || pkg.standardUnit || '').trim(),
      baseQuantity: pkg.baseQuantity === null || pkg.baseQuantity === undefined ? null : Math.max(0, Number(pkg.baseQuantity)),
      baseUnitRaw: String(pkg.baseUnitRaw || '').trim(),
      standardUnit: String(pkg.standardUnit || pkg.unit || '').trim(),
      confidenceScore: Math.max(0, Math.min(1, Number(pkg.confidenceScore ?? 0.5))),
      warnings: Array.isArray(pkg.warnings) ? pkg.warnings.map(String).slice(0, 10) : [],
      needsReview: pkg.needsReview !== false || !pkg.workCode || !pkg.workName,
      lines: lines.map((line: any, lineIndex: number) => {
        const type = normalizeNormResourceType(line.resourceType || line.resourceSection);
        const normQuantity = Math.max(0, Number(line.normQuantity ?? line.quantity ?? 0));
        return {
          id: String(line.id || `${pkg.id || `ai-package-${packageIndex + 1}`}-line-${lineIndex + 1}`),
          sourceRowNumber: Math.max(1, Number(line.sourceRowNumber || line.rowNumber || pkg.sourceRowStart || 1)),
          resourceSection: normalizeNormResourceType(line.resourceSection || type),
          resourceType: type,
          resourceCode: String(line.resourceCode || line.materialCode || '').trim(),
          resourceName: String(line.resourceName || line.itemName || '').trim(),
          unit: String(line.unit || '').trim(),
          normQuantity,
          wastePercent: Math.max(0, Number(line.wastePercent ?? 0)),
          confidenceScore: Math.max(0, Math.min(1, Number(line.confidenceScore ?? 0.5))),
          warnings: Array.isArray(line.warnings) ? line.warnings.map(String).slice(0, 10) : [],
          needsReview: line.needsReview !== false || !line.resourceName || !line.unit || normQuantity <= 0,
          reason: String(line.reason || 'AI tách từ bảng định mức Excel.'),
        };
      }).filter((line: any) => line.resourceName || line.resourceCode),
    };
  }).filter((pkg: any) => pkg.workName && pkg.lines.length > 0);
}

async function handleCostNormImportExcel(req: AssistantRequest, actor: AppUserContext | null) {
  if (!canUseCostNormAssistant(actor)) {
    return jsonResponse({ error: 'Tài khoản hiện tại chưa có quyền Admin/HD admin/Tender AI admin để dùng AI import định mức.' }, 403);
  }
  const rows = Array.isArray(req.rows) ? req.rows.slice(0, 600) : [];
  if (rows.length === 0) return jsonResponse({ error: 'Thiếu dữ liệu dòng Excel để AI tách định mức.' }, 400);

  const prompt = `
Bạn là AI bóc bảng định mức xây dựng từ Excel cho thư viện định mức nội bộ.
Nhiệm vụ: tách các dòng Excel raw thành các gói/hạng mục định mức và dòng hao phí nguồn lực.

Quy tắc bắt buộc:
- Chỉ dùng dữ liệu rows, mergedRanges và localPackages được cung cấp.
- Không bịa đơn giá, giá vốn, margin, profit hoặc risk buffer.
- Không tự tạo số định mức nếu ô Excel không có số; đặt normQuantity=0, needsReview=true và ghi warning.
- Dòng nhóm như "Vật liệu", "Nhân công", "Máy thi công" chỉ dùng để phân loại, không tạo thành nguồn lực.
- Mỗi hạng mục/công tác cha là một package riêng. Ví dụ "Đổ bê tông lót M100" là package; xi măng/cát/đá/nhân công/máy là lines.
- Nếu đơn vị hạng mục là "100m2" hoặc "100m3", baseQuantity là 100 và standardUnit là "m2"/"m3".
- Nếu không chắc phân loại, dùng resourceType="other", needsReview=true.
- Không lưu DB, không activate; chỉ trả JSON để frontend review.
- Trả về DUY NHẤT JSON object.

Schema:
{
  "packages": [
    {
      "id": "id tạm",
      "sourceRowStart": 1,
      "sourceRowEnd": 5,
      "workCode": "mã công tác/gói",
      "workName": "tên công tác/gói",
      "unit": "đơn vị chuẩn",
      "baseQuantity": 1,
      "baseUnitRaw": "100m2",
      "standardUnit": "m2",
      "confidenceScore": 0.0,
      "warnings": ["cảnh báo"],
      "needsReview": false,
      "lines": [
        {
          "id": "id tạm",
          "sourceRowNumber": 1,
          "resourceSection": "material|labor|machine|subcontract|overhead|other",
          "resourceType": "material|labor|machine|subcontract|overhead|other",
          "resourceCode": "mã VL/NC/M nếu có",
          "resourceName": "tên nguồn lực",
          "unit": "đơn vị",
          "normQuantity": 0,
          "wastePercent": 0,
          "confidenceScore": 0.0,
          "warnings": ["cảnh báo"],
          "needsReview": true,
          "reason": "lý do"
        }
      ]
    }
  ],
  "warnings": ["cảnh báo chung"],
  "confidenceScore": 0.0
}

File: ${String(req.fileName || '')}
Sheet: ${String(req.sheetName || '')}

Merged ranges:
${compactJson(Array.isArray(req.mergedRanges) ? req.mergedRanges.slice(0, 200) : [], 8000)}

Rows:
${compactJson(rows, 22000)}

Local parser draft:
${compactJson(Array.isArray(req.localPackages) ? req.localPackages.slice(0, 80) : [], 18000)}
`.trim();

  const raw = await callGemini(prompt, 0.02, req.model || GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);
  const packages = normalizeCostNormImportPayload(parsed);
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 20) : [];
  const confidenceScore = Math.max(0, Math.min(1, Number(parsed.confidenceScore ?? (
    packages.length ? packages.reduce((sum: number, pkg: any) => sum + Number(pkg.confidenceScore || 0), 0) / packages.length : 0.35
  ))));
  await writeTenderAiLog(req, actor, 'cost_norm_import_excel', {
    fileName: req.fileName || null,
    sheetName: req.sheetName || null,
    packageCount: packages.length,
    lineCount: packages.reduce((sum: number, pkg: any) => sum + pkg.lines.length, 0),
    warnings,
    confidenceScore,
  });
  return jsonResponse({ packages, warnings, confidenceScore });
}

function normalizeMappingObject(raw: any) {
  const mapping = raw?.mapping && typeof raw.mapping === 'object' ? raw.mapping : {};
  const allowedKeys = ['lineNo', 'itemCode', 'name', 'description', 'unit', 'quantity', 'ownerUnitPrice', 'ownerAmount', 'note'];
  return Object.fromEntries(
    allowedKeys
      .filter(key => mapping[key] !== null && mapping[key] !== undefined && mapping[key] !== '')
      .map(key => [key, Math.max(0, Number(mapping[key]))]),
  );
}

async function writeTenderAiLog(req: AssistantRequest, actor: AppUserContext | null, action: string, response: any) {
  try {
    await admin.from('tender_ai_logs').insert({
      package_id: req.packageId || null,
      action,
      request_summary: {
        actorId: actor?.id || null,
        lineCount: Array.isArray(req.lines) ? req.lines.length : null,
        templateCount: Array.isArray(req.templates) ? req.templates.length : null,
        hasWorkbook: Boolean(req.workbook),
      },
      response,
      confidence_score: Number(response?.confidenceScore ?? response?.suggestion?.confidenceScore ?? 0.5),
      created_by: actor?.id || null,
    });
  } catch (error) {
    console.warn('tender_ai_logs insert failed:', (error as Error)?.message || error);
  }
}

async function handleTenderDetectColumns(req: AssistantRequest, actor: AppUserContext | null) {
  if (!canUseTenderAssistant(actor)) {
    return jsonResponse({ error: 'Tài khoản hiện tại chưa có quyền HD để dùng Tender AI.' }, 403);
  }
  const workbook = req.workbook || {};
  const prompt = `
Bạn là Tender BOQ Analyzer cho công ty thi công nhà xưởng kết cấu thép.
Nhiệm vụ: đọc mẫu Excel BOQ của Chủ đầu tư và gợi ý sheet/cột BOQ chính.

Quy tắc:
- Chỉ dùng sampleRows được cung cấp, không bịa thêm cột.
- headerRow là index 0-based trong sampleRows.
- mapping value là column index 0-based.
- Nếu không chắc, giữ localSuggestion và ghi notes.
- Trả về DUY NHẤT JSON object.

Schema:
{
  "sheetName": "tên sheet",
  "headerRow": 0,
  "mapping": {
    "lineNo": 0,
    "itemCode": 1,
    "name": 2,
    "description": 3,
    "unit": 4,
    "quantity": 5,
    "ownerUnitPrice": 6,
    "ownerAmount": 7,
    "note": 8
  },
  "confidenceScore": 0.0,
  "notes": ["lý do"]
}

Workbook summary:
${compactJson(workbook, 22000)}
`.trim();

  const raw = await callGemini(prompt, 0.02, req.model || GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);
  const suggestion = {
    sheetName: String(parsed.sheetName || workbook?.localSuggestion?.sheetName || workbook?.sheets?.[0]?.name || ''),
    headerRow: Math.max(0, Number(parsed.headerRow ?? workbook?.localSuggestion?.headerRow ?? 0)),
    mapping: normalizeMappingObject(parsed),
    confidenceScore: Math.max(0, Math.min(1, Number(parsed.confidenceScore ?? 0.5))),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 8) : ['AI đã nhận diện cột BOQ.'],
  };
  await writeTenderAiLog(req, actor, 'tender_detect_columns', { suggestion });
  return jsonResponse({ suggestion });
}

async function handleTenderSuggestMapping(req: AssistantRequest, actor: AppUserContext | null) {
  if (!canUseTenderAssistant(actor)) {
    return jsonResponse({ error: 'Tài khoản hiện tại chưa có quyền HD để dùng Tender AI.' }, 403);
  }
  const lines = Array.isArray(req.lines) ? req.lines.slice(0, 300) : [];
  const templates = Array.isArray(req.templates) ? req.templates.slice(0, 15) : [];
  const prompt = `
Bạn là AI mapping BOQ CĐT sang template nội bộ của công ty thi công nhà xưởng.
Mục tiêu: đề xuất mapping từng dòng BOQ Chủ đầu tư sang cost_template_item phù hợp.

Quy tắc bắt buộc:
- Chỉ chọn templateId/templateSectionId/templateItemId có trong Templates JSON.
- Một dòng BOQ CĐT có thể map sang nhiều item nội bộ. Khi cần tách nhiều đầu mục, trả trong mappingLinks.
- Nếu một dòng chỉ map một item, vẫn trả mappingLinks có 1 phần tử.
- Không tự tạo đơn giá, định mức, giá vốn hoặc margin.
- Dòng chưa chắc phải để "needs_review"; dòng không khớp để "unmatched"; dòng tổng/ghi chú để "ignored".
- Trả về DUY NHẤT JSON object.

Schema:
{
  "mappings": [
    {
      "externalLineId": "id dòng BOQ",
      "templateId": "id template hoặc null",
      "templateSectionId": "id section hoặc null",
      "templateItemId": "id item hoặc null",
      "workCode": "work_code hoặc null",
      "normGroupCode": "norm_group_code hoặc null",
      "mappingLinks": [
        {
          "templateId": "id template",
          "templateSectionId": "id section hoặc null",
          "templateItemId": "id item",
          "workCode": "work_code hoặc null",
          "normGroupCode": "norm_group_code hoặc null",
          "allocationType": "inherit_quantity|percent|fixed_quantity|formula",
          "allocationValue": null,
          "quantityFormula": null,
          "note": "ghi chú phân bổ nếu có",
          "confidenceScore": 0.0,
          "reason": "giải thích link"
        }
      ],
      "mappingStatus": "matched|needs_review|unmatched|ignored",
      "confidenceScore": 0.0,
      "reason": "giải thích ngắn",
      "assumptions": ["giả định nếu có"]
    }
  ]
}

BOQ lines:
${compactJson(lines, 16000)}

Templates:
${compactJson(templates, 24000)}
`.trim();

  const raw = await callGemini(prompt, 0.03, req.model || GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);
  const lineIds = new Set(lines.map((line: any) => String(line.id)));
  const templateIds = new Set(templates.map((template: any) => String(template.id)));
  const itemIds = new Set(templates.flatMap((template: any) => (template.items || []).map((item: any) => String(item.id))));
  const sectionIds = new Set(templates.flatMap((template: any) => (template.sections || []).map((section: any) => String(section.id))));
  const mappings = Array.isArray(parsed.mappings) ? parsed.mappings.map((row: any) => {
    const status = ['matched', 'needs_review', 'unmatched', 'ignored'].includes(row.mappingStatus) ? row.mappingStatus : 'needs_review';
    const rawLinks = Array.isArray(row.mappingLinks) ? row.mappingLinks : Array.isArray(row.links) ? row.links : [];
    const normalizedLinks = rawLinks.map((link: any) => {
      const linkTemplateId = link.templateId && templateIds.has(String(link.templateId)) ? String(link.templateId) : null;
      const linkTemplateItemId = link.templateItemId && itemIds.has(String(link.templateItemId)) ? String(link.templateItemId) : null;
      const linkTemplateSectionId = link.templateSectionId && sectionIds.has(String(link.templateSectionId)) ? String(link.templateSectionId) : null;
      if (!linkTemplateItemId && !link.workCode && !link.normGroupCode) return null;
      return {
        templateId: linkTemplateId,
        templateSectionId: linkTemplateSectionId,
        templateItemId: linkTemplateItemId,
        workCode: link.workCode ? String(link.workCode) : null,
        normGroupCode: link.normGroupCode ? String(link.normGroupCode) : null,
        allocationType: ['inherit_quantity', 'percent', 'fixed_quantity', 'formula'].includes(link.allocationType) ? link.allocationType : 'inherit_quantity',
        allocationValue: link.allocationValue === null || link.allocationValue === undefined ? null : Number(link.allocationValue),
        quantityFormula: link.quantityFormula ? String(link.quantityFormula) : null,
        note: link.note ? String(link.note) : null,
        confidenceScore: Math.max(0, Math.min(1, Number(link.confidenceScore ?? row.confidenceScore ?? 0.5))),
        reason: String(link.reason || row.reason || 'AI đề xuất mapping link.'),
      };
    }).filter(Boolean);
    const fallbackTemplateId = row.templateId && templateIds.has(String(row.templateId)) ? String(row.templateId) : null;
    const fallbackTemplateItemId = row.templateItemId && itemIds.has(String(row.templateItemId)) ? String(row.templateItemId) : null;
    const fallbackTemplateSectionId = row.templateSectionId && sectionIds.has(String(row.templateSectionId)) ? String(row.templateSectionId) : null;
    const mappingLinks = normalizedLinks.length
      ? normalizedLinks
      : fallbackTemplateItemId || row.workCode || row.normGroupCode
        ? [{
          templateId: fallbackTemplateId,
          templateSectionId: fallbackTemplateSectionId,
          templateItemId: fallbackTemplateItemId,
          workCode: row.workCode ? String(row.workCode) : null,
          normGroupCode: row.normGroupCode ? String(row.normGroupCode) : null,
          allocationType: 'inherit_quantity',
          allocationValue: null,
          quantityFormula: null,
          note: null,
          confidenceScore: Math.max(0, Math.min(1, Number(row.confidenceScore ?? 0.5))),
          reason: String(row.reason || 'AI đề xuất mapping.'),
        }]
        : [];
    const firstLink = mappingLinks[0] || {};
    return {
      externalLineId: String(row.externalLineId || row.lineId || ''),
      templateId: firstLink.templateId || fallbackTemplateId,
      templateSectionId: firstLink.templateSectionId || fallbackTemplateSectionId,
      templateItemId: firstLink.templateItemId || fallbackTemplateItemId,
      workCode: firstLink.workCode || (row.workCode ? String(row.workCode) : null),
      normGroupCode: firstLink.normGroupCode || (row.normGroupCode ? String(row.normGroupCode) : null),
      mappingLinks,
      mappingStatus: mappingLinks.length || status === 'ignored' ? status : (status === 'matched' ? 'needs_review' : status),
      confidenceScore: Math.max(0, Math.min(1, Number(row.confidenceScore ?? 0.5))),
      reason: String(row.reason || 'AI đề xuất mapping.'),
      assumptions: Array.isArray(row.assumptions) ? row.assumptions.map(String).slice(0, 5) : [],
    };
  }).filter((row: any) => row.externalLineId && lineIds.has(row.externalLineId)) : [];

  await writeTenderAiLog(req, actor, 'tender_suggest_mapping', {
    mappings,
    confidenceScore: mappings.length
      ? mappings.reduce((sum: number, row: any) => sum + Number(row.confidenceScore || 0), 0) / mappings.length
      : 0,
  });
  return jsonResponse({ mappings });
}

async function handleTenderRiskRfi(req: AssistantRequest, actor: AppUserContext | null) {
  if (!canUseTenderAssistant(actor)) {
    return jsonResponse({ error: 'Tài khoản hiện tại chưa có quyền HD để dùng Tender AI.' }, 403);
  }
  const prompt = `
Bạn là AI Risk/RFI Assistant cho hồ sơ chào thầu nhà xưởng.
Nhiệm vụ: rà BOQ CĐT, mapping và pricing gaps để đề xuất rủi ro/RFI trước khi gửi giá.

Quy tắc:
- Không bịa giá hoặc định mức.
- Ưu tiên rủi ro scope/spec/đơn vị/khối lượng/mapping/thiếu giá.
- suggestedRfi chỉ là câu hỏi đề xuất, user quyết định có gửi CĐT không.
- Trả về DUY NHẤT JSON object.

Schema:
{
  "risks": [
    {
      "externalLineId": "id dòng hoặc null",
      "riskType": "scope|spec|unit|quantity|mapping|missing_price|commercial|other",
      "severity": "low|medium|high|critical",
      "title": "tiêu đề",
      "description": "mô tả",
      "suggestedRfi": "câu hỏi gửi CĐT hoặc null",
      "confidenceScore": 0.0,
      "assumptions": ["nếu có"]
    }
  ]
}

BOQ lines:
${compactJson(req.lines || [], 14000)}

Mappings:
${compactJson(req.mappings || [], 10000)}

Pricing gaps:
${compactJson(req.pricingGaps || [], 10000)}
`.trim();

  const raw = await callGemini(prompt, 0.08, req.model || GEMINI_FAST_MODEL, 'application/json');
  const parsed = extractJsonObject(raw);
  const lineIds = new Set((Array.isArray(req.lines) ? req.lines : []).map((line: any) => String(line.id)));
  const risks = Array.isArray(parsed.risks) ? parsed.risks.map((row: any) => {
    const severity = ['low', 'medium', 'high', 'critical'].includes(row.severity) ? row.severity : 'medium';
    const externalLineId = row.externalLineId && lineIds.has(String(row.externalLineId)) ? String(row.externalLineId) : null;
    return {
      externalLineId,
      riskType: String(row.riskType || 'scope'),
      severity,
      title: String(row.title || 'Rủi ro hồ sơ thầu'),
      description: row.description ? String(row.description) : null,
      suggestedRfi: row.suggestedRfi ? String(row.suggestedRfi) : null,
      confidenceScore: Math.max(0, Math.min(1, Number(row.confidenceScore ?? 0.5))),
      assumptions: Array.isArray(row.assumptions) ? row.assumptions.map(String).slice(0, 5) : [],
    };
  }).filter((row: any) => row.title) : [];

  await writeTenderAiLog(req, actor, 'tender_risk_rfi', {
    risks,
    confidenceScore: risks.length
      ? risks.reduce((sum: number, row: any) => sum + Number(row.confidenceScore || 0), 0) / risks.length
      : 0,
  });
  return jsonResponse({ risks });
}

// ═══ Main Handler ═══════════════════════════════════════════

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const startedAt = performance.now();
  let req: AssistantRequest | null = null;
  let activeConversationId: string | null = null;
  let activeUserId: string | null = null;
  let activeMode: AiMode | null = null;
  let activeQuestion: string | null = null;
  let activeModel: string | null = null;
  let activeDomain: string | null = null;
  let activeRouteAction: string | null = null;
  let activeToolName: string | null = null;
  let activeUserMessageId: string | null = null;
  let activeAssistantMessageId: string | null = null;

  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Missing Supabase function secrets.' }, 500);
    }

    req = await request.json() as AssistantRequest;
    if (req.action === 'feedback') {
      const actor = await resolveActor(request, req.userId);
      return jsonResponse(await handleFeedback(req, actor));
    }
    if (req.action === 'estimate_suggestion') {
      const actor = await resolveActor(request, req.userId);
      return handleEstimateSuggestion(req, actor);
    }
    if (req.action === 'cost_norm_standardization') {
      const actor = await resolveActor(request, req.userId);
      return handleCostNormStandardization(req, actor);
    }
    if (req.action === 'cost_norm_import_excel') {
      const actor = await resolveActor(request, req.userId);
      return handleCostNormImportExcel(req, actor);
    }
    if (req.action === 'tender_detect_columns') {
      const actor = await resolveActor(request, req.userId);
      return handleTenderDetectColumns(req, actor);
    }
    if (req.action === 'tender_suggest_mapping') {
      const actor = await resolveActor(request, req.userId);
      return handleTenderSuggestMapping(req, actor);
    }
    if (req.action === 'tender_risk_rfi') {
      const actor = await resolveActor(request, req.userId);
      return handleTenderRiskRfi(req, actor);
    }

    const question = (req.question || '').trim();
    if (!question) return jsonResponse({ error: 'Thiếu câu hỏi.' }, 400);

    const mode: AiMode = req.mode === 'knowledge' ? 'knowledge' : 'data';
    const history = (req.history || []).slice(-10);
    const selectedModel = req.model || null;
    const actor = await resolveActor(request, req.userId);
    const effectiveUserId = actor?.id || req.userId || null;
    activeUserId = effectiveUserId;
    activeMode = mode;
    activeQuestion = question;
    activeModel = selectedModel || (mode === 'knowledge' ? GEMINI_FAST_MODEL : GEMINI_FAST_MODEL);

    const finishChat = async (
      body: Record<string, unknown>,
      status = 200,
      run: Partial<{
        status: 'success' | 'rejected' | 'clarification' | 'error';
        routeAction: string | null;
        toolName: string | null;
        classifiedDomain: string | null;
        errorMessage: string | null;
        tokenCount: number | null;
        metadata: Record<string, unknown>;
      }> = {},
    ) => {
      const responseTimeMs = Math.round(performance.now() - startedAt);
      const tokenCount = run.tokenCount ?? (typeof body.answer === 'string' ? estimateTokenCount(String(body.answer)) : null);
      await logChatRun({
        conversationId: activeConversationId,
        userId: activeUserId,
        mode: activeMode,
        question: activeQuestion,
        classifiedDomain: run.classifiedDomain ?? activeDomain,
        routeAction: run.routeAction ?? activeRouteAction,
        toolName: run.toolName ?? activeToolName,
        modelUsed: activeModel,
        responseTimeMs,
        tokenCount,
        status: run.status || 'success',
        errorMessage: run.errorMessage || null,
        metadata: {
          ...(run.metadata || {}),
          userMessageId: activeUserMessageId,
          assistantMessageId: activeAssistantMessageId,
        },
      });
      return jsonResponse({
        ...body,
        userMessageId: activeUserMessageId,
        assistantMessageId: activeAssistantMessageId,
      }, status);
    };

    // ── Off-topic classification ──
    const relation = await classifyQuestionRelation(question, history, selectedModel);
    if (!relation.isRelated) {
      const conversationId = await ensureConversation({ ...req, userId: effectiveUserId || undefined, mode }, question);
      activeConversationId = conversationId;
      activeDomain = 'general';
      activeRouteAction = 'rejection';
      activeUserMessageId = await saveMessage({ conversationId, role: 'user', content: question, mode, classifiedDomain: activeDomain });

      const friendlyRejection = relation.friendlyRejection || 'Xin chào! Em là Trợ lý AI của Kho Tiến Thịnh. Em chỉ có thể hỗ trợ giải đáp các thông tin liên quan đến dữ liệu phần mềm ERP (tồn kho, nhân sự, dự án, tài chính) hoặc tài liệu quy trình trong công ty. Anh/chị vui lòng hỏi đúng chủ đề nhé!';
      const rejectionSuggestions = relation.suggestions || [
        'Tổng tồn kho hiện tại bao nhiêu?',
        'Danh sách dự án đang hoạt động?',
        'Quy trình xin nghỉ phép?',
      ];

      activeAssistantMessageId = await saveMessage({ conversationId, role: 'assistant', content: friendlyRejection, mode: 'general', classifiedDomain: activeDomain });
      await updateConversationMeta({ conversationId, classifiedDomain: activeDomain, modelUsed: activeModel });

      return finishChat({
        conversationId,
        answer: friendlyRejection,
        mode: 'general',
        suggestions: rejectionSuggestions,
        hasMemory: false,
      }, 200, { status: 'rejected', routeAction: 'rejection', classifiedDomain: activeDomain });
    }

    const conversationId = await ensureConversation({ ...req, userId: effectiveUserId || undefined, mode }, question);
    activeConversationId = conversationId;
    activeDomain = mode === 'knowledge' ? 'knowledge' : 'general';
    const initialLearningContext = await collectLearningContext({ userId: effectiveUserId, domain: activeDomain, mode });
    let learningContextPrompt = buildLearningContextPrompt(initialLearningContext);
    activeUserMessageId = await saveMessage({
      conversationId,
      role: 'user',
      content: question,
      mode,
      classifiedDomain: activeDomain,
      metadata: { learningSignals: countLearningSignals(initialLearningContext) },
    });

    // ── Knowledge Mode ──
    if (mode === 'knowledge') {
      const chunks = await searchKnowledge(question);
      const isComplex = await classifyComplexity(question);
      
      const rawAnswer = chunks.length > 0
        ? await answerFromKnowledge(question, chunks, history, isComplex, selectedModel, learningContextPrompt)
        : 'Em chưa tìm thấy tài liệu nội bộ phù hợp trong Kho Kiến Thức. Anh có thể upload/sync thêm tài liệu hoặc hỏi cụ thể hơn theo tên tài liệu, quy trình, phòng ban.\n\nGợi ý câu hỏi:\n1. Quy trình xin nghỉ phép theo nội quy công ty?\n2. Quy định bảo mật thông tin nội bộ là gì?\n3. Tiêu chuẩn an toàn lao động trên công trường?';

      const { cleanAnswer, suggestions } = extractSuggestionsAndCleanAnswer(rawAnswer);

      const sources = chunks.map((c: any) => ({
        title: c.title,
        fileName: c.file_name,
        similarity: c.rank || 0,
      }));

      activeAssistantMessageId = await saveMessage({
        conversationId,
        role: 'assistant',
        content: cleanAnswer,
        mode: 'rag',
        sources,
        classifiedDomain: activeDomain,
        metadata: { learningSignals: countLearningSignals(initialLearningContext), chunks: chunks.length },
      });
      await updateConversationMeta({ conversationId, classifiedDomain: activeDomain, modelUsed: activeModel });
      return finishChat({
        conversationId,
        answer: cleanAnswer,
        mode: 'rag',
        sources,
        suggestions: suggestions.length > 0 ? suggestions : [
          'Quy trình xin nghỉ phép theo nội quy công ty?',
          'Quy định bảo mật thông tin nội bộ là gì?',
          'Tiêu chuẩn an toàn lao động trên công trường?',
        ],
        hasMemory: chunks.length > 0 || countLearningSignals(initialLearningContext) > 0,
      });
    }

    // ── Data Mode — Agentic Tool-calling ──
    let route: any = null;
    try {
      route = await routeToTool(question, history, selectedModel, learningContextPrompt);
      activeRouteAction = route.action || null;
      activeToolName = route.toolName || null;
    } catch (routeErr) {
      console.error('ai-assistant routing failed:', routeErr);
      return finishChat({ error: `Routing failed: ${(routeErr as Error).message}` }, 500, {
        status: 'error',
        routeAction: 'routing',
        errorMessage: (routeErr as Error).message,
      });
    }
    activeDomain = inferDomainFromTool(route.toolName, mode);
    const domainLearningContext = await collectLearningContext({ userId: effectiveUserId, domain: activeDomain, mode });
    learningContextPrompt = buildLearningContextPrompt(domainLearningContext);

    // Handle rejection or clarification
    if (route.action === 'rejection' || route.action === 'clarification') {
      const msg = route.message || 'Em cần thêm thông tin để trả lời câu hỏi này.';
      activeAssistantMessageId = await saveMessage({
        conversationId,
        role: 'assistant',
        content: msg,
        mode: 'sql',
        classifiedDomain: activeDomain,
        metadata: { routeReason: route.reason || null, learningSignals: countLearningSignals(domainLearningContext) },
      });
      await updateConversationMeta({ conversationId, classifiedDomain: activeDomain, modelUsed: activeModel });
      return finishChat({
        conversationId,
        answer: msg,
        mode: 'sql',
        suggestions: route.suggestions,
        hasMemory: countLearningSignals(domainLearningContext) > 0,
      }, 200, { status: route.action === 'rejection' ? 'rejected' : 'clarification' });
    }

    // Handle tool_call
    if (route.action === 'tool_call' && route.toolName) {
      const missingParams = getMissingRequiredParams(route.toolName, route.parameters);
      if (missingParams.length > 0) {
        const msg = `Em cần thêm thông tin để tra cứu chính xác: ${missingParams.join(', ')}. Anh/chị cho em biết từ khóa hoặc mã hạng mục/vật tư cụ thể nhé.`;
        activeAssistantMessageId = await saveMessage({
          conversationId,
          role: 'assistant',
          content: msg,
          mode: 'sql',
          toolName: route.toolName,
          classifiedDomain: activeDomain,
          metadata: { missingParams, learningSignals: countLearningSignals(domainLearningContext) },
        });
        await updateConversationMeta({ conversationId, classifiedDomain: activeDomain, modelUsed: activeModel });
        return finishChat({
          conversationId,
          answer: msg,
          mode: 'sql',
          suggestions: route.suggestions || [
            'Tra đơn giá nội bộ của thép D10',
            'Tra định mức bê tông móng',
            'Tra template dự toán nhà xưởng',
          ],
          hasMemory: countLearningSignals(domainLearningContext) > 0,
        }, 200, { status: 'clarification', toolName: route.toolName });
      }

      const toolAuthorization = authorizeTool(route.toolName, actor);
      if (!toolAuthorization.allowed) {
        const msg = toolAuthorization.message || 'Tài khoản hiện tại chưa đủ quyền để AI tra cứu dữ liệu này.';
        activeAssistantMessageId = await saveMessage({
          conversationId,
          role: 'assistant',
          content: msg,
          mode: 'sql',
          toolName: route.toolName,
          classifiedDomain: activeDomain,
          metadata: { authorizationDenied: true, learningSignals: countLearningSignals(domainLearningContext) },
        });
        await updateConversationMeta({ conversationId, classifiedDomain: activeDomain, modelUsed: activeModel });
        return finishChat({
          conversationId,
          answer: msg,
          mode: 'sql',
          suggestions: toolAuthorization.suggestions || route.suggestions,
          hasMemory: countLearningSignals(domainLearningContext) > 0,
        }, 200, { status: 'rejected', toolName: route.toolName });
      }

      let toolResult: any = null;
      try {
        console.info('ai-assistant tool_access', JSON.stringify({
          actorId: actor?.id || null,
          actorSource: actor?.source || null,
          role: actor?.role || null,
          toolName: route.toolName,
          parameters: route.parameters,
          mode,
          conversationId,
          at: new Date().toISOString(),
        }));
        toolResult = await callToolRpc(route.toolName, route.parameters);
      } catch (rpcErr) {
        console.error(`ai-assistant RPC ${route.toolName} failed:`, rpcErr);
        return finishChat({
          error: `Tool "${route.toolName}" execution failed: ${(rpcErr as Error).message}`,
          debug: { route },
        }, 500, {
          status: 'error',
          toolName: route.toolName,
          errorMessage: (rpcErr as Error).message,
        });
      }

      const rawAnswer = await formatToolResult(question, route.toolName, toolResult, history, selectedModel, learningContextPrompt);
      const { cleanAnswer, suggestions } = extractSuggestionsAndCleanAnswer(rawAnswer);

      const toolSource = TOOL_SOURCES[route.toolName]
        ? [{ ...TOOL_SOURCES[route.toolName], similarity: 1 }]
        : [{ title: 'Dữ liệu ERP', fileName: 'Cơ sở dữ liệu hệ thống', similarity: 1 }];

      const finalSuggestions = suggestions.length > 0 ? suggestions : (route.suggestions || []);

      activeAssistantMessageId = await saveMessage({
        conversationId,
        role: 'assistant',
        content: cleanAnswer,
        mode: 'sql',
        toolName: route.toolName,
        sources: toolSource,
        classifiedDomain: activeDomain,
        metadata: {
          routeReason: route.reason || null,
          learningSignals: countLearningSignals(domainLearningContext),
        },
      });
      await updateConversationMeta({ conversationId, classifiedDomain: activeDomain, modelUsed: activeModel });
      await recordQueryPattern({
        question,
        mode,
        domain: activeDomain,
        routeAction: route.action,
        toolName: route.toolName,
        answer: cleanAnswer,
      });

      return finishChat({
        conversationId,
        answer: cleanAnswer,
        toolName: route.toolName,
        mode: 'sql',
        suggestions: finalSuggestions,
        sources: toolSource,
        hasMemory: countLearningSignals(domainLearningContext) > 0,
      });
    }

    // Fallback — no valid action
    return finishChat({
      error: 'AI Router returned an unrecognized action.',
      debug: { route },
    }, 500, { status: 'error', errorMessage: 'AI Router returned an unrecognized action.' });

  } catch (err) {
    console.error('ai-assistant error:', err);
    await logChatRun({
      conversationId: activeConversationId,
      userId: activeUserId,
      mode: activeMode,
      question: activeQuestion,
      classifiedDomain: activeDomain,
      routeAction: activeRouteAction,
      toolName: activeToolName,
      modelUsed: activeModel,
      responseTimeMs: Math.round(performance.now() - startedAt),
      tokenCount: null,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'AI assistant failed.',
      metadata: {
        userMessageId: activeUserMessageId,
        assistantMessageId: activeAssistantMessageId,
      },
    });
    return jsonResponse({
      error: err instanceof Error ? err.message : 'AI assistant failed.',
    }, 500);
  }
});
