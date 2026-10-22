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
  /** Tab Hoạt động (không có → tab báo chưa có dữ liệu). */
  activity?: (days: number) => Promise<AiActivity>;
  /** B4 (22/10): bản tin Admin tuần — danh sách đã dựng; dựng ngay tuần này / tuần trước (gửi khi send = true). */
  digests?: () => Promise<AiDigest[]>;
  runDigest?: (weekStart: string | null, send: boolean) => Promise<AiDigest>;
}

// ── B4 — bản tin Admin hằng tuần ──────────────────────────────────────────────────────────────────────────────────────
export interface AiDigestPick { key: string; score: number; title: string; detail: string; link: string | null }
export interface AiDigest {
  weekStart: string; weekEnd: string; generatedAt: string; sentAt: string | null; recipients: number; picks: AiDigestPick[];
  assistant: { runs: number; askers: number; questions: number; errors: number; errorCodes: Array<{ code: string; n: number }>; dislikes: number; refusals: number; slow: number; costUsd: number;
    granted: number; idleCount: number; idle: string[]; commands: { prepared: number; done: number; cancelled: number; expired: number }; jev: { n: number; auto: number; autoAgree: number } };
  feedback: { new: number; fromAssistant: number; open: number; oldestOpenDays: number | null; urgentOpen: number };
  stale: { leavePending3d: number; wfRunningStale7d: number; captureUnreceived3d: number; poDraft7d: number; requestDraft7d: number; dailyLogDraft3d: number; requestPending3d: number };
}
const digestObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const dn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
export const parseDigest = (raw: unknown): AiDigest | null => {
  const o = digestObj(raw);
  if (!str(o.week_start)) return null;
  const s = digestObj(o.signals); const a = digestObj(s.assistant); const f = digestObj(s.feedback); const st = digestObj(s.stale); const cmd = digestObj(a.commands); const jev = digestObj(a.jev);
  return {
    weekStart: str(o.week_start), weekEnd: str(o.week_end), generatedAt: str(o.generated_at), sentAt: str(o.sent_at) || null, recipients: dn(o.recipients),
    picks: arr(o.picks).map(digestObj).filter(p => str(p.title)).map(p => ({ key: str(p.key), score: dn(p.score), title: str(p.title), detail: str(p.detail), link: str(p.link) || null })),
    assistant: { runs: dn(a.runs), askers: dn(a.askers), questions: dn(a.questions), errors: dn(a.errors), errorCodes: arr(a.errorCodes).map(digestObj).map(e => ({ code: str(e.code), n: dn(e.n) })),
      dislikes: dn(a.dislikes), refusals: dn(a.refusals), slow: dn(a.slow), costUsd: dn(a.costUsd), granted: dn(a.granted), idleCount: dn(a.idleCount), idle: (Array.isArray(a.idle) ? a.idle : []).map(x => str(x)).filter(Boolean),
      commands: { prepared: dn(cmd.prepared), done: dn(cmd.done), cancelled: dn(cmd.cancelled), expired: dn(cmd.expired) }, jev: { n: dn(jev.n), auto: dn(jev.auto), autoAgree: dn(jev.autoAgree) } },
    feedback: { new: dn(f.new), fromAssistant: dn(f.fromAssistant), open: dn(f.open), oldestOpenDays: f.oldestOpenDays == null ? null : dn(f.oldestOpenDays), urgentOpen: dn(f.urgentOpen) },
    stale: { leavePending3d: dn(st.leavePending3d), wfRunningStale7d: dn(st.wfRunningStale7d), captureUnreceived3d: dn(st.captureUnreceived3d), poDraft7d: dn(st.poDraft7d), requestDraft7d: dn(st.requestDraft7d), dailyLogDraft3d: dn(st.dailyLogDraft3d), requestPending3d: dn(st.requestPending3d) },
  };
};
/** Thứ Hai của tuần chứa ngày d (YYYY-MM-DD, theo giờ máy). */
export const mondayOf = (d: Date): string => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

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
  activity: days => aiActivityService.get(days),
  async digests() {
    const { data, error } = await supabase.rpc('ai_admin_digest_list_v1', { p_limit: 8 });
    if (error) fail(error);
    return arr(data).map(parseDigest).filter((d): d is AiDigest => Boolean(d));
  },
  async runDigest(weekStart, send) {
    const { data, error } = await supabase.rpc('ai_admin_digest_run_v1', { p_week_start: weekStart, p_send: send });
    if (error) fail(error);
    const d = parseDigest(data);
    if (!d) throw new Error('Máy chủ không trả bản tin.');
    return d;
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

// ── Hoạt động (tab "Hoạt động" của Trung tâm AI) ──────────────────────────────────────────────────────────────────────
export interface AiActivity {
  days: number;
  totals: { questions: number; askers: number; runs: number; costUsd: number; likes: number; dislikes: number; errors: number; blocked: number; withFiles: number };
  granted: number;
  daily: Array<{ day: string; questions: number; people: number }>;
  topics: Array<{ topic: string; questions: number }>;
  commands: Array<{ kind: string; prepared: number; done: number; cancelled: number; failed: number; open: number; expired: number }>;
  people: Array<{ userId: string; name: string; granted: boolean; template: string | null; questions: number; runs: number; costUsd: number; likes: number; dislikes: number;
    blocked: number; lastAt: string | null; commands: number; done: number }>;
  models: Array<{ model: string; runs: number; costUsd: number }>;
  dislikes: Array<{ at: string; name: string; skill: string; reason: string | null; note: string | null }>;
}
export const TOPIC_LABEL: Record<string, string> = {
  lookup: 'Tra cứu hồ sơ, tồn kho, việc', chat: 'Hỏi đáp chung', purchase_order: 'Đơn mua', material_request: 'Đề xuất vật tư', daily_log: 'Nhật ký công trường',
  leave_request: 'Nghỉ phép', memory_note: 'Ghi nhớ', refused: 'Bị từ chối (ngoài công việc…)',
};
export const COMMAND_LABEL: Record<string, string> = {
  leave_request: 'Đơn nghỉ phép', material_request: 'Đề xuất vật tư', purchase_order: 'Đơn mua', daily_log: 'Nhật ký', memory_note: 'Ghi nhớ',
};
const n0 = (v: unknown) => num(v) ?? 0;
export const parseActivity = (raw: unknown): AiActivity => {
  const o = obj(raw); const t = obj(o.totals);
  return {
    days: n0(o.days) || 14,
    totals: { questions: n0(t.questions), askers: n0(t.askers), runs: n0(t.runs), costUsd: n0(t.costUsd), likes: n0(t.likes), dislikes: n0(t.dislikes),
      errors: n0(t.errors), blocked: n0(t.blocked), withFiles: n0(t.withFiles) },
    granted: n0(o.granted),
    daily: arr(o.daily).map(d => ({ day: str(d.day), questions: n0(d.questions), people: n0(d.people) })).filter(d => d.day),
    topics: arr(o.topics).map(x => ({ topic: str(x.topic), questions: n0(x.questions) })).filter(x => x.topic),
    commands: arr(o.commands).map(c => ({ kind: str(c.kind), prepared: n0(c.prepared), done: n0(c.done), cancelled: n0(c.cancelled), failed: n0(c.failed), open: n0(c.open), expired: n0(c.expired) })),
    people: arr(o.people).filter(p => str(p.userId)).map(p => ({ userId: str(p.userId), name: str(p.name), granted: p.granted === true, template: str(p.template) || null,
      questions: n0(p.questions), runs: n0(p.runs), costUsd: n0(p.costUsd), likes: n0(p.likes), dislikes: n0(p.dislikes), blocked: n0(p.blocked),
      lastAt: str(p.lastAt) || null, commands: n0(p.commands), done: n0(p.done) })),
    models: arr(o.models).map(m => ({ model: str(m.model), runs: n0(m.runs), costUsd: n0(m.costUsd) })),
    dislikes: arr(o.dislikes).map(d => ({ at: str(d.at), name: str(d.name), skill: str(d.skill), reason: str(d.reason) || null, note: str(d.note) || null })),
  };
};
/** Mọi ngày trong kỳ (kể cả ngày không ai hỏi) để biểu đồ không bị nhảy cóc. */
export const fillDays = (daily: AiActivity['daily'], days: number, today: Date): AiActivity['daily'] => {
  const byDay = new Map(daily.map(d => [d.day, d]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return byDay.get(key) || { day: key, questions: 0, people: 0 };
  });
};
export const aiActivityService = {
  async get(days: number): Promise<AiActivity> {
    const { data, error } = await supabase.rpc('get_ai_activity_v1', { p_days: days });
    if (error) fail(error);
    return parseActivity(data);
  },
};
