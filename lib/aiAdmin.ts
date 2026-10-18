// Trung tâm AI (chủ SP chốt 18/10/2026): Quản trị AI (Admin Hoàng) cấp AI tới từng người — model, trần tiền / tháng, câu / ngày, skill —
// bằng mẫu rồi chỉnh riêng. Máy chủ kiểm quyền Admin; cổng AI áp cấp phát + trần ở ai_gateway_begin_v1.
import { supabase } from './supabase';

export type SkillAccess = 'everyone' | 'granted';
export interface AiTemplate { id: string; name: string; connectionId: string | null; extraConnectionIds: string[]; monthlyCostCapUsd: number | null; dailyQuestionCap: number | null; skills: string[]; note: string; users: number }
export interface AiGrantValues { enabled: boolean; templateId: string | null; connectionId: string | null; extraConnectionIds: string[] | null; monthlyCostCapUsd: number | null; dailyQuestionCap: number | null; skills: string[] | null; note: string }
export interface AiEffective { enabled: boolean; templateName: string | null; connectionId: string | null; models: string[]; monthlyCostCapUsd: number | null; dailyQuestionCap: number | null; skills: string[] }
export interface AiUsage { today: number; monthRuns: number; monthCostUsd: number; lastAt: string | null }
export interface AiGrant extends AiGrantValues { userId: string; name: string; email: string; role: string; active: boolean; updatedAt: string; effective: AiEffective; usage: AiUsage }
export interface AiSkillAccessRow { code: string; name: string; access: SkillAccess; enabled: boolean; dailyLimit: number }
export interface AiConnectionRow { id: string; name: string; model: string; enabled: boolean; pricePerCall: number | null; displayName: string; blurb: string; icon: string; vision: boolean }
export const modelLabel = (c: Pick<AiConnectionRow, 'displayName' | 'model' | 'name'> | undefined) => (c ? c.displayName || c.model || c.name : 'Mặc định');
export interface AiAdminOverview {
  templates: AiTemplate[]; grants: AiGrant[]; skills: AiSkillAccessRow[]; connections: AiConnectionRow[];
  settings: { monthlyCostCapUsd: number | null; monthlyRunCap: number | null }; month: { runs: number; costUsd: number };
}
export interface AiPerson { id: string; name: string; email: string; role: string; granted: boolean }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown) => (Array.isArray(v) ? v : []).map(obj);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);

const parseEffective = (raw: unknown): AiEffective => {
  const o = obj(raw);
  return { enabled: o.enabled === true, templateName: str(o.templateName) || null, connectionId: str(o.connectionId) || null, models: strs(o.models) || [],
    monthlyCostCapUsd: num(o.monthlyCostCapUsd), dailyQuestionCap: num(o.dailyQuestionCap), skills: strs(o.skills) || [] };
};
export const parseOverview = (raw: unknown): AiAdminOverview => {
  const o = obj(raw); const st = obj(o.settings); const m = obj(o.month);
  return {
    templates: arr(o.templates).filter(t => str(t.id)).map(t => ({ id: str(t.id), name: str(t.name), connectionId: str(t.connectionId) || null, extraConnectionIds: strs(t.extraConnectionIds) || [],
      monthlyCostCapUsd: num(t.monthlyCostCapUsd), dailyQuestionCap: num(t.dailyQuestionCap), skills: strs(t.skills) || [], note: str(t.note), users: num(t.users) ?? 0 })),
    grants: arr(o.grants).filter(g => str(g.userId)).map(g => {
      const u = obj(g.usage);
      return { userId: str(g.userId), name: str(g.name), email: str(g.email), role: str(g.role), active: g.active !== false, enabled: g.enabled === true,
        templateId: str(g.templateId) || null, connectionId: str(g.connectionId) || null, extraConnectionIds: strs(g.extraConnectionIds), monthlyCostCapUsd: num(g.monthlyCostCapUsd),
        dailyQuestionCap: num(g.dailyQuestionCap), skills: strs(g.skills), note: str(g.note), updatedAt: str(g.updatedAt), effective: parseEffective(g.effective),
        usage: { today: num(u.today) ?? 0, monthRuns: num(u.monthRuns) ?? 0, monthCostUsd: num(u.monthCostUsd) ?? 0, lastAt: str(u.lastAt) || null } };
    }),
    skills: arr(o.skills).filter(s => str(s.code)).map(s => ({ code: str(s.code), name: str(s.name) || str(s.code), access: s.access === 'granted' ? 'granted' : 'everyone',
      enabled: s.enabled !== false, dailyLimit: num(s.dailyLimit) ?? 0 })),
    connections: arr(o.connections).filter(c => str(c.id)).map(c => ({ id: str(c.id), name: str(c.name), model: str(c.model), enabled: c.enabled !== false, pricePerCall: num(c.pricePerCall),
      displayName: str(c.displayName), blurb: str(c.blurb), icon: str(c.icon), vision: c.vision !== false })),
    settings: { monthlyCostCapUsd: num(st.monthlyCostCapUsd), monthlyRunCap: num(st.monthlyRunCap) },
    month: { runs: num(m.runs) ?? 0, costUsd: num(m.costUsd) ?? 0 },
  };
};

const ERRORS: Record<string, string> = {
  AI_ADMIN_REQUIRED: 'Chỉ Quản trị AI (Admin) làm được việc này.',
  AI_TEMPLATE_IN_USE: 'Mẫu đang được dùng — đổi mẫu cho những người đó trước rồi xóa.',
  AI_TEMPLATE_NAME_TAKEN: 'Đã có mẫu trùng tên.',
  AI_GRANT_BAD_SKILL: 'Có skill không còn tồn tại — tải lại trang.',
};
const fail = (error: { message: string }) => { const key = Object.keys(ERRORS).find(k => error.message.includes(k)); throw new Error(key ? ERRORS[key] : error.message); };

/** Giá trị gửi máy chủ: null = theo mẫu. */
export const grantPayload = (v: AiGrantValues) => ({
  enabled: v.enabled, templateId: v.templateId || '', connectionId: v.connectionId || '', extraConnectionIds: v.extraConnectionIds, monthlyCostCapUsd: v.monthlyCostCapUsd ?? '',
  dailyQuestionCap: v.dailyQuestionCap ?? '', skills: v.skills, note: v.note.trim(),
});

export interface AiAdminService {
  overview: () => Promise<AiAdminOverview>;
  people: (search: string) => Promise<AiPerson[]>;
  saveGrants: (userIds: string[], values: AiGrantValues) => Promise<void>;
  saveTemplate: (t: Omit<AiTemplate, 'id' | 'users'> & { id?: string }) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  setSkillAccess: (code: string, access: SkillAccess) => Promise<void>;
  saveModel: (m: Pick<AiConnectionRow, 'id' | 'displayName' | 'blurb' | 'icon' | 'vision'>) => Promise<void>;
}

export const aiAdminService: AiAdminService = {
  async overview() {
    const { data, error } = await supabase.rpc('get_ai_admin_overview_v1');
    if (error) fail(error);
    return parseOverview(data);
  },
  async people(search) {
    const { data, error } = await supabase.rpc('ai_admin_people_v1', { p_search: search.trim() || null });
    if (error) fail(error);
    return arr(data).filter(p => str(p.id)).map(p => ({ id: str(p.id), name: str(p.name), email: str(p.email), role: str(p.role), granted: p.granted === true }));
  },
  async saveGrants(userIds, values) {
    const { error } = await supabase.rpc('ai_admin_grant_save_v1', { p_user_ids: userIds, p: grantPayload(values) });
    if (error) fail(error);
  },
  async saveTemplate(t) {
    const { error } = await supabase.rpc('ai_admin_template_save_v1', { p: { id: t.id || '', name: t.name.trim(), connectionId: t.connectionId || '', extraConnectionIds: t.extraConnectionIds,
      monthlyCostCapUsd: t.monthlyCostCapUsd ?? '', dailyQuestionCap: t.dailyQuestionCap ?? '', skills: t.skills, note: t.note.trim() } });
    if (error) fail(error);
  },
  async deleteTemplate(id) {
    const { error } = await supabase.rpc('ai_admin_template_delete_v1', { p_id: id });
    if (error) fail(error);
  },
  async saveModel(m) {
    const { error } = await supabase.rpc('ai_admin_model_save_v1', { p: { id: m.id, displayName: m.displayName.trim(), blurb: m.blurb.trim(), icon: m.icon.trim(), vision: m.vision } });
    if (error) fail(error);
  },
  async setSkillAccess(code, access) {
    const { error } = await supabase.rpc('ai_admin_skill_access_v1', { p_code: code, p_access: access });
    if (error) fail(error);
  },
};

export const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: 2 })}`);
/** Phần trăm đã dùng của trần (0–100+); không trần → null. */
export const usedPct = (used: number, cap: number | null) => (cap == null || cap <= 0 ? null : Math.round((used / cap) * 100));
