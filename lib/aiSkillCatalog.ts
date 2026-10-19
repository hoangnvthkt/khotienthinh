// Trung tâm AI · tab Skill · "Xem bên trong" (chủ SP 19/10/2026): mỗi skill / công cụ dùng khi nào, lời dặn, quyền, thẻ tạo ra, lượt dùng 7 ngày.
// Lời dặn + công cụ: cổng AI action "catalog" (lấy từ mã đang chạy, chỉ Quản trị AI). Lượt dùng: RPC get_ai_skill_usage_v1 (chỉ Admin).
import { supabase } from './supabase';

export interface SkillUsageRow {
  code: string; name: string; description: string; tier: string; mode: string; modelClass: string; enabled: boolean; access: 'everyone' | 'granted'; dailyLimit: number;
  runs: number; people: number; ok: number; errors: number; blocked: number; costUsd: number; likes: number; dislikes: number; lastAt: string | null;
}
export interface ToolUsageRow { tool: string; runs: number; people: number; lastAt: string | null }
export interface SkillUsage { days: number; skills: SkillUsageRow[]; tools: ToolUsageRow[]; commands: Array<{ kind: string; prepared: number; done: number }> }

export type ToolKind = 'tra_cuu' | 'bieu_do' | 'chuan_bi';
export interface CatalogTool { name: string; label: string; description: string; params: Array<{ name: string; description: string; required: boolean }>; kind: ToolKind;
  rpcs: string[]; permission: string; result: string; commandKind: string | null }
export interface CatalogSkill { code: string; where: string | null; result: string; instructions: string; readsImages: boolean; tools: string[] }
export interface SkillCatalog { guard: string; skills: CatalogSkill[]; tools: CatalogTool[] }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown) => (Array.isArray(v) ? v : []).map(obj);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const parseSkillUsage = (raw: unknown): SkillUsage => {
  const o = obj(raw);
  return {
    days: n0(o.days) || 7,
    skills: arr(o.skills).filter(s => str(s.code)).map(s => ({
      code: str(s.code), name: str(s.name) || str(s.code), description: str(s.description), tier: str(s.tier), mode: str(s.mode), modelClass: str(s.modelClass),
      enabled: s.enabled !== false, access: s.access === 'granted' ? 'granted' : 'everyone', dailyLimit: n0(s.dailyLimit),
      runs: n0(s.runs), people: n0(s.people), ok: n0(s.ok), errors: n0(s.errors), blocked: n0(s.blocked), costUsd: n0(s.costUsd), likes: n0(s.likes), dislikes: n0(s.dislikes),
      lastAt: str(s.lastAt) || null,
    })),
    tools: arr(o.tools).filter(t => /^[a-z_]+$/.test(str(t.tool))).map(t => ({ tool: str(t.tool), runs: n0(t.runs), people: n0(t.people), lastAt: str(t.lastAt) || null })),
    commands: arr(o.commands).filter(c => str(c.kind)).map(c => ({ kind: str(c.kind), prepared: n0(c.prepared), done: n0(c.done) })),
  };
};

const KINDS: ToolKind[] = ['tra_cuu', 'bieu_do', 'chuan_bi'];
export const parseSkillCatalog = (raw: unknown): SkillCatalog => {
  const o = obj(raw);
  return {
    guard: str(o.guard),
    skills: arr(o.skills).filter(s => str(s.code)).map(s => ({ code: str(s.code), where: str(s.where) || null, result: str(s.result), instructions: str(s.instructions),
      readsImages: s.readsImages === true, tools: strs(s.tools) })),
    tools: arr(o.tools).filter(t => str(t.name)).map(t => ({
      name: str(t.name), label: str(t.label) || str(t.name), description: str(t.description),
      params: arr(t.params).filter(p => str(p.name)).map(p => ({ name: str(p.name), description: str(p.description), required: p.required === true })),
      kind: KINDS.find(k => k === t.kind) || 'tra_cuu', rpcs: strs(t.rpcs), permission: str(t.permission), result: str(t.result), commandKind: str(t.commandKind) || null,
    })),
  };
};

export const TOOL_KIND_LABEL: Record<ToolKind, string> = { tra_cuu: 'Tra cứu', bieu_do: 'Biểu đồ', chuan_bi: 'Chuẩn bị nháp' };
/** Bậc skill (ai_tier_allowed) → ai dùng được, nói theo người dùng. Admin luôn dùng được. */
export const TIER_PERMISSION: Record<string, string> = {
  base: 'Mọi người đăng nhập',
  ops: 'Người có quyền Dùng Trợ lý AI (ai.assistant.use)',
  analysis: 'Người có quyền Tạo báo cáo AI (ai.report.generate)',
  executive: 'Chỉ Ban điều hành (ai.executive.view)',
};
export const MODE_LABEL: Record<string, string> = { read: 'Chỉ đọc', draft: 'Chuẩn bị nháp', auto: 'Tự chạy' };
/** Số dòng của lời dặn (để nói "N dòng" trên nút mở). */
export const lineCount = (text: string) => (text.trim() ? text.trim().split('\n').length : 0);

export interface AiSkillCatalogService {
  usage: (days: number) => Promise<SkillUsage>;
  catalog: () => Promise<SkillCatalog>;
}

export const aiSkillCatalogService: AiSkillCatalogService = {
  async usage(days) {
    const { data, error } = await supabase.rpc('get_ai_skill_usage_v1', { p_days: days });
    if (error) throw new Error(error.message.includes('AI_ADMIN_REQUIRED') ? 'Chỉ Quản trị AI (Admin) xem được.' : error.message);
    return parseSkillUsage(data);
  },
  async catalog() {
    const { data, error } = await supabase.functions.invoke('ai-gateway', { body: { action: 'catalog' } });
    const body = obj(data);
    if (error || body.code !== 'OK') throw new Error('Chưa đọc được lời dặn từ cổng AI — cổng chưa cập nhật hoặc mất kết nối.');
    return parseSkillCatalog(body.catalog);
  },
};
