// Trợ lý v2 · T4b — "AI đã nhớ gì" + trí nhớ cá nhân (chủ SP duyệt 18/10/2026). Mọi thứ ở đây do NGƯỜI xác nhận:
// ghi nhớ người dùng tự viết (hoặc bấm Lưu trên thẻ Trợ lý chuẩn bị), thói quen = lựa chọn đã gửi thành công (người duyệt, kho nhận).
// Quên = xóa hẳn, người dùng tự bấm. Trợ lý không có đường nào tự ghi / tự quên.
import { supabase } from './supabase';
import { finishCommand, type AssistantCommand } from './assistantCommands';

export type NoteSource = 'user' | 'assistant';
export interface MemoryNote { id: string; text: string; source: NoteSource; createdAt: string }
export interface MemoryHabit { id: string; key: string; value: string; label: string; scopeLabel: string; hits: number; updatedAt: string }
export interface PersonalMemory { notes: MemoryNote[]; habits: MemoryHabit[] }
export interface SharedAlias { id: string; kind: string; alias: string; target: string; hits: number; lastUsedAt: string; by: string | null }
export interface SharedGroup { key: string; title: string; kind: 'mr' | 'po' | 'dl'; items: SharedAlias[] }
export interface HabitPair { key: string; value: string; label: string }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []).map(obj);

export const parsePersonal = (raw: unknown): PersonalMemory => {
  const o = obj(raw);
  return {
    notes: arr(o.notes).filter(n => str(n.id) && str(n.text))
      .map(n => ({ id: str(n.id), text: str(n.text), source: n.source === 'assistant' ? 'assistant' : 'user', createdAt: str(n.createdAt) })),
    habits: arr(o.habits).filter(h => str(h.id) && str(h.key) && str(h.value))
      .map(h => ({ id: str(h.id), key: str(h.key), value: str(h.value), label: str(h.label) || str(h.value), scopeLabel: str(h.scopeLabel),
        hits: Math.max(1, Number(h.hits) || 1), updatedAt: str(h.updatedAt) })),
  };
};
export const parseShared = (raw: unknown): SharedGroup[] => arr(raw).filter(g => str(g.key)).map(g => ({
  key: str(g.key), title: str(g.title) || str(g.key), kind: (g.kind === 'po' || g.kind === 'dl' ? g.kind : 'mr') as SharedGroup['kind'],
  items: arr(g.items).filter(i => str(i.id)).map(i => ({ id: str(i.id), kind: str(i.kind), alias: str(i.alias), target: str(i.target),
    hits: Math.max(1, Number(i.hits) || 1), lastUsedAt: str(i.lastUsedAt), by: str(i.by) || null })),
}));

/** Khóa thói quen (máy chủ chỉ nhận đúng các khóa này). */
export const habitKey = {
  mrApprovers: (projectId: string) => `mr.approvers:${projectId}`,
  mrWarehouse: (projectId: string) => `mr.warehouse:${projectId}`,
  poWarehouse: (projectId: string) => `po.warehouse:${projectId}`,
  poApprover: () => 'po.approver',
};
export const HABIT_LABEL: Record<string, string> = {
  'mr.approvers': 'Người duyệt đề xuất', 'mr.warehouse': 'Kho nhận đề xuất', 'po.warehouse': 'Kho nhận đơn mua', 'po.approver': 'Người duyệt đơn mua',
};
export const habitTitle = (h: Pick<MemoryHabit, 'key' | 'scopeLabel'>) => {
  const name = HABIT_LABEL[h.key.split(':')[0]] || 'Lựa chọn';
  return h.scopeLabel && !h.key.startsWith('po.approver') ? `${name} · ${h.scopeLabel}` : name;
};
/** Giá trị đã nhớ cho một khóa (người duyệt nhiều người thì tách bằng dấu phẩy). */
export const habitValue = (memory: PersonalMemory | null, key: string) => memory?.habits.find(h => h.key === key)?.value ?? null;
/** Id đã nhớ còn nằm trong danh sách chọn được hôm nay (người rời Room, kho đóng thì bỏ). */
export const rememberedIds = (memory: PersonalMemory | null, key: string, options: ReadonlyArray<{ id: string }>) => {
  const allowed = new Set(options.map(o => o.id));
  return (habitValue(memory, key) || '').split(',').map(x => x.trim()).filter(id => id && allowed.has(id));
};

export const aiMemory = {
  async personal(): Promise<PersonalMemory> {
    const { data, error } = await supabase.rpc('get_ai_user_memory_v1');
    if (error) throw error;
    return parsePersonal(data);
  },
  async shared(): Promise<SharedGroup[]> {
    const { data, error } = await supabase.rpc('get_ai_memory_overview_v1');
    if (error) throw error;
    return parseShared(data);
  },
  async addNote(text: string, source: NoteSource = 'user'): Promise<{ id: string; created: boolean }> {
    const { data, error } = await supabase.rpc('ai_user_note_save_v1', { p_text: text, p_source: source });
    if (error) {
      if (/AI_NOTE_LIMIT/.test(error.message)) throw new Error('Đã đủ 30 ghi nhớ — quên bớt ghi nhớ cũ rồi thêm.');
      if (/AI_NOTE_TOO_SHORT/.test(error.message)) throw new Error('Ghi nhớ quá ngắn.');
      throw error;
    }
    const o = obj(data);
    return { id: str(o.id), created: o.created === true };
  },
  async forget(scope: 'personal' | 'shared', id: string): Promise<void> {
    const { error } = await supabase.rpc('forget_ai_memory_v1', { p_scope: scope, p_id: id });
    if (error) {
      if (/AI_MEMORY_DENIED/.test(error.message)) throw new Error('Bạn không có quyền quên mục này.');
      if (/AI_MEMORY_NOT_FOUND/.test(error.message)) return;
      throw error;
    }
  },
  /** Không chặn việc chính: lỗi chỉ ghi cảnh báo. */
  async learnHabits(pairs: HabitPair[]): Promise<void> {
    const clean = pairs.filter(p => p.key && p.value);
    if (!clean.length) return;
    const { error } = await supabase.rpc('learn_ai_user_habits_v1', { p_pairs: clean });
    if (error) console.warn('AI habit learning failed', error.message);
  },
};

/** Hành động của bảng Trí nhớ + thẻ "nhớ giúp" (fixture thay bằng bản giả). */
export interface MemoryActions {
  personal: () => Promise<PersonalMemory>;
  shared: () => Promise<SharedGroup[]>;
  addNote: (text: string) => Promise<{ id: string; created: boolean }>;
  forget: (scope: 'personal' | 'shared', id: string) => Promise<void>;
  /** Người dùng bấm Lưu ghi nhớ trên thẻ Trợ lý chuẩn bị: lưu rồi ghi biên nhận vào lệnh. */
  saveNoteCommand: (command: AssistantCommand, text: string) => Promise<AssistantCommand>;
}
export const defaultMemoryActions: MemoryActions = {
  personal: () => aiMemory.personal(),
  shared: () => aiMemory.shared(),
  addNote: text => aiMemory.addNote(text, 'user'),
  forget: (scope, id) => aiMemory.forget(scope, id),
  async saveNoteCommand(command, text) {
    const saved = await aiMemory.addNote(text, 'assistant');
    const result = { id: saved.id, text: text.trim(), created: saved.created };
    return (await finishCommand(command.id, 'done', result).catch(() => null)) || { ...command, status: 'done', result };
  },
};
