// Cổng AI chung — phía màn hình (chủ SP 11–13/10/2026, doc audit mục 5–7). Mọi tính năng AI mới gọi `aiGateway.run(skill, input)`;
// máy chủ (edge function ai-gateway) giữ quyền, hạn mức, nhật ký và nhà cung cấp. Chưa có khóa → AI_NOT_CONFIGURED, màn hình làm tay như thường.
import { supabase } from './supabase';

export type AiProvider = 'anthropic' | 'gemini' | 'openai' | 'openai_compatible';
export type AiGatewayCode = 'OK' | 'AI_NOT_CONFIGURED' | 'AI_DENIED' | 'AI_OFF' | 'AI_SKILL_OFF' | 'AI_SKILL_UNKNOWN' | 'AI_QUOTA' | 'AI_REFUSED' | 'AI_FAILED';
export type AiGatewayErrorCode = Exclude<AiGatewayCode, 'OK'>;

export const AI_GATEWAY_MESSAGES: Record<AiGatewayErrorCode, string> = {
  AI_NOT_CONFIGURED: 'Chưa cấu hình khóa AI — làm tay như thường.',
  AI_DENIED: 'Bạn chưa được cấp loại AI này.',
  AI_OFF: 'Cổng AI đang tắt.',
  AI_SKILL_OFF: 'Tính năng AI này đang tắt.',
  AI_SKILL_UNKNOWN: 'Tính năng AI chưa được đăng ký.',
  AI_QUOTA: 'Hết lượt AI hôm nay.',
  AI_REFUSED: 'AI từ chối nội dung này.',
  AI_FAILED: 'AI chưa trả lời được.',
};
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: 'Anthropic (Claude)', gemini: 'Google (Gemini)', openai: 'OpenAI', openai_compatible: 'Chuẩn OpenAI' };
/** Đích đang dùng cho một lớp model: kết nối ở Cài đặt → Kết nối, hoặc khóa trong Secrets. */
export interface AiTargetInfo { source: 'connection' | 'secrets'; name: string; kind: AiProvider; label: string; model: string }
export const AI_TIER_LABELS: Record<string, string> = { base: 'Nền', ops: 'Nghiệp vụ', analysis: 'Phân tích', executive: 'Điều hành' };
export const AI_MODE_LABELS: Record<string, string> = { read: 'Đọc', draft: 'Nháp', auto: 'Tự chạy' };
export const AI_RUN_STATUS_LABELS: Record<string, string> = {
  started: 'Đang chạy', ok: 'Xong', denied: 'Không quyền', quota: 'Hết lượt', no_provider: 'Chưa có khóa', refused: 'AI từ chối', error: 'Lỗi',
};

export interface AiGatewayStatus {
  /** false = hàm ai-gateway chưa triển khai (404). */
  deployed: boolean;
  configured: boolean;
  provider: AiProvider;
  providerSource: 'AI_PROVIDER' | 'WMS_AI_PROVIDER' | 'default' | 'connection' | 'unknown';
  targets: { fast: AiTargetInfo | null; reasoning: AiTargetInfo | null };
  models: { fast: string; reasoning: string };
  keysPresent: Record<'anthropic' | 'gemini' | 'openai', boolean>;
  priceKnown: boolean;
  skills: string[];
}

/** Hết lượt vì: ngày · trần tháng · gửi quá nhanh trong một phút · còn một câu đang trả lời (chống spam, 18/10). */
export type AiQuotaReason = 'day' | 'month' | 'minute' | 'busy';
export interface AiUsage { tokensIn: number | null; tokensOut: number | null; costUsd: number | null; durationMs: number }
export type AiRunResult<T> =
  | { code: 'OK'; runId: string; result: T; model: string; provider: AiProvider; usage: AiUsage }
  | { code: AiGatewayErrorCode; runId?: string; error?: string; reason?: AiQuotaReason; usedToday?: number; dailyLimit?: number };

export interface AiSkillRow {
  code: string; name: string; description: string; tier: string; mode: string; enabled: boolean; dailyLimit: number; modelClass: 'fast' | 'reasoning';
  ownerUserId: string | null; ownerName: string | null;
  runs: number; ok: number; errors: number; noProvider: number; quota: number; denied: number; users: number;
  acceptedRate: number | null; feedbacks: number; avgMs: number | null; lastAt: string | null;
}
export interface AiRunRow {
  id: string; createdAt: string; userName: string | null; skillCode: string; status: string; provider: string | null; model: string | null;
  durationMs: number | null; costUsd: number | null; accepted: boolean | null; error: string | null;
}
export interface AiGatewayOverview {
  days: number; from: string;
  settings: { enabled: boolean; monthlyRunCap: number; monthlyCostCapUsd: number; updatedAt: string | null; updatedByName: string | null };
  month: { runs: number; ok: number; errors: number; noProvider: number; quota: number; denied: number; users: number; costUsd: number | null; costKnown: boolean };
  skills: AiSkillRow[];
  recent: AiRunRow[];
}

const NOT_DEPLOYED: AiGatewayStatus = {
  deployed: false, configured: false, provider: 'anthropic', providerSource: 'unknown', models: { fast: '', reasoning: '' }, targets: { fast: null, reasoning: null },
  keysPresent: { anthropic: false, gemini: false, openai: false }, priceKnown: false, skills: [],
};

const httpStatus = (error: unknown) => (error as { context?: { status?: number } } | null)?.context?.status;
const errorText = (error: unknown) => (error as { message?: string } | null)?.message || '';

/** Gọi edge function; 404 = chưa triển khai; 401/403 = không quyền. Lỗi khác → AI_FAILED kèm thông điệp. */
const invoke = async <T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: AiGatewayErrorCode; error: string; status?: number }> => {
  const { data, error } = await supabase.functions.invoke('ai-gateway', { body });
  if (error) {
    const status = httpStatus(error);
    if (status === 404) return { ok: false, code: 'AI_NOT_CONFIGURED', error: 'AI_NOT_DEPLOYED', status };
    if (status === 401 || status === 403) return { ok: false, code: 'AI_DENIED', error: errorText(error) || 'AI_DENIED', status };
    return { ok: false, code: 'AI_FAILED', error: errorText(error) || 'AI_FAILED', status };
  }
  return { ok: true, data: data as T };
};

const num = (value: unknown) => Number(value) || 0;
const numOrNull = (value: unknown) => (value == null || value === '' ? null : Number(value));

export const aiGateway = {
  /** Tình trạng cấu hình (không lộ khóa). Hàm chưa triển khai → deployed=false. */
  async status(): Promise<AiGatewayStatus> {
    const r = await invoke<Partial<AiGatewayStatus> & { code?: string }>({ action: 'status' });
    if (r.ok === false) {
      if (r.status === 404) return NOT_DEPLOYED;
      throw new Error(r.error);
    }
    const d = r.data;
    return {
      deployed: true, configured: Boolean(d.configured), provider: (d.provider as AiProvider) || 'anthropic',
      providerSource: (d.providerSource as AiGatewayStatus['providerSource']) || 'unknown',
      models: { fast: String(d.models?.fast || ''), reasoning: String(d.models?.reasoning || '') },
      keysPresent: { anthropic: Boolean(d.keysPresent?.anthropic), gemini: Boolean(d.keysPresent?.gemini), openai: Boolean(d.keysPresent?.openai) },
      targets: { fast: (d.targets?.fast as AiTargetInfo) || null, reasoning: (d.targets?.reasoning as AiTargetInfo) || null },
      priceKnown: Boolean(d.priceKnown), skills: Array.isArray(d.skills) ? d.skills.map(String) : [],
    };
  },

  /** Chạy một skill. `context` chỉ chứa id nguồn (không nội dung) để ghi nhật ký. */
  async run<T = Record<string, unknown>>(skill: string, input: Record<string, unknown>, context: Record<string, unknown> = {}): Promise<AiRunResult<T>> {
    const r = await invoke<AiRunResult<T> & { error?: string }>({ skill, input, context });
    if (r.ok === false) return { code: r.code, error: r.error };
    const d = r.data;
    if (!d || typeof d !== 'object' || !('code' in d)) return { code: 'AI_FAILED', error: 'AI_BAD_RESPONSE' };
    return d;
  },

  /** Người dùng cho biết dùng nguyên / bỏ kết quả — tỷ lệ chấp nhận theo skill. Không chặn luồng chính. */
  feedback(runId: string, accepted: boolean) {
    void supabase.rpc('ai_gateway_feedback_v1', { p_run_id: runId, p_accepted: accepted }).then(r => { if (r.error) console.warn('ai feedback failed', r.error.message); });
  },

  async overview(days: number): Promise<AiGatewayOverview> {
    const { data, error } = await supabase.rpc('get_ai_gateway_overview_v1', { p_days: days });
    if (error) throw error;
    const raw = (data || {}) as Partial<AiGatewayOverview> & { settings?: Partial<AiGatewayOverview['settings']>; month?: Partial<AiGatewayOverview['month']> };
    return {
      days: num(raw.days) || days, from: String(raw.from || ''),
      settings: {
        enabled: raw.settings?.enabled !== false, monthlyRunCap: num(raw.settings?.monthlyRunCap), monthlyCostCapUsd: Number(raw.settings?.monthlyCostCapUsd) || 0,
        updatedAt: raw.settings?.updatedAt || null, updatedByName: raw.settings?.updatedByName || null,
      },
      month: {
        runs: num(raw.month?.runs), ok: num(raw.month?.ok), errors: num(raw.month?.errors), noProvider: num(raw.month?.noProvider), quota: num(raw.month?.quota),
        denied: num(raw.month?.denied), users: num(raw.month?.users), costUsd: numOrNull(raw.month?.costUsd), costKnown: Boolean(raw.month?.costKnown),
      },
      skills: (raw.skills || []).map(s => ({
        code: String(s.code), name: String(s.name || s.code), description: String(s.description || ''), tier: String(s.tier || 'base'), mode: String(s.mode || 'read'),
        enabled: s.enabled !== false, dailyLimit: num(s.dailyLimit), modelClass: s.modelClass === 'reasoning' ? 'reasoning' : 'fast',
        ownerUserId: s.ownerUserId || null, ownerName: s.ownerName || null,
        runs: num(s.runs), ok: num(s.ok), errors: num(s.errors), noProvider: num(s.noProvider), quota: num(s.quota), denied: num(s.denied), users: num(s.users),
        acceptedRate: numOrNull(s.acceptedRate), feedbacks: num(s.feedbacks), avgMs: numOrNull(s.avgMs), lastAt: s.lastAt || null,
      })),
      recent: (raw.recent || []).map(r => ({
        id: String(r.id), createdAt: String(r.createdAt || ''), userName: r.userName || null, skillCode: String(r.skillCode || ''), status: String(r.status || ''),
        provider: r.provider || null, model: r.model || null, durationMs: numOrNull(r.durationMs), costUsd: numOrNull(r.costUsd),
        accepted: typeof r.accepted === 'boolean' ? r.accepted : null, error: r.error || null,
      })),
    };
  },

  async setSkill(code: string, patch: Partial<Pick<AiSkillRow, 'enabled' | 'dailyLimit' | 'modelClass' | 'ownerUserId'>>) {
    const { error } = await supabase.rpc('set_ai_skill_v1', { p_code: code, p: patch });
    if (error) throw error;
  },

  async setSettings(patch: Partial<Pick<AiGatewayOverview['settings'], 'enabled' | 'monthlyRunCap' | 'monthlyCostCapUsd'>>) {
    const { error } = await supabase.rpc('set_ai_settings_v1', { p: patch });
    if (error) throw error;
  },
};

/** Câu báo cho người dùng theo mã; hết lượt thì kèm số. */
export const aiErrorMessage = (outcome: { code: AiGatewayErrorCode; reason?: AiQuotaReason; usedToday?: number; dailyLimit?: number; error?: string }) => {
  if (outcome.code === 'AI_QUOTA') {
    if (outcome.reason === 'busy') return 'Trợ lý đang trả lời câu trước — đợi xong rồi hỏi tiếp.';
    if (outcome.reason === 'minute') return 'Bạn gửi hơi nhanh — đợi vài giây rồi hỏi tiếp.';
    return outcome.reason === 'month' ? 'Hết trần AI tháng này — làm tay như thường.'
      : `Hết lượt AI hôm nay${outcome.dailyLimit ? ` (${outcome.usedToday ?? outcome.dailyLimit}/${outcome.dailyLimit})` : ''}.`;
  }
  if (outcome.code === 'AI_NOT_CONFIGURED' && outcome.error === 'AI_NOT_DEPLOYED') return 'Hàm ai-gateway chưa triển khai.';
  return AI_GATEWAY_MESSAGES[outcome.code] || AI_GATEWAY_MESSAGES.AI_FAILED;
};
