// Trợ lý v2 · T4a — học từ việc người dùng làm thật (chủ SP duyệt 18/10/2026). Thẻ đề xuất / đơn mua chỉ dạy AI SAU KHI người dùng bấm
// Lưu / Gửi: "chữ trên báo cáo / báo giá" → mã vật tư, "tên NCC trên báo giá" → NCC. Lượt sau thẻ chọn sẵn đúng (nhãn "Đã nhớ").
// Không dạy từ lời nói hay nút like; không để AI tự sửa quy tắc. Máy chủ kiểm quyền theo việc (get/learn_ai_aliases_v2).
import { supabase } from './supabase';

export type LearningContext = 'material_request' | 'purchase_order';
export interface LearnedAlias { kind: 'item' | 'vendor'; alias: string; aliasNorm: string; targetId: string; targetLabel: string; hits: number }
export interface LearnPair { kind: 'item' | 'vendor'; alias: string; targetId: string; targetLabel: string }

/** Cùng cách chuẩn hóa với máy chủ (app_private.ai_alias_norm): chữ thường, bỏ dấu, đ → d, chỉ chữ + số, một dấu cách. */
export const aliasNorm = (text?: string | null) => String(text || '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const parseLearned = (raw: unknown): LearnedAlias[] => (Array.isArray(raw) ? raw : []).flatMap(item => {
  const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const kind = o.kind === 'item' || o.kind === 'vendor' ? o.kind : null;
  const norm = typeof o.aliasNorm === 'string' ? o.aliasNorm : '';
  const targetId = typeof o.targetId === 'string' ? o.targetId : '';
  if (!kind || !norm || !targetId) return [];
  return [{ kind, alias: String(o.alias || norm), aliasNorm: norm, targetId, targetLabel: String(o.targetLabel || ''), hits: Math.max(1, Number(o.hits) || 1) }];
});

/** Đích đã nhớ cho một cách gọi: trùng chữ (đã chuẩn hóa), nhiều lượt xác nhận nhất. */
export const recall = (memory: readonly LearnedAlias[], kind: LearnedAlias['kind'], ...texts: Array<string | null | undefined>): LearnedAlias | null => {
  const keys = texts.map(aliasNorm).filter(k => k.length >= 2);
  for (const key of keys) {
    const hit = memory.filter(m => m.kind === kind && m.aliasNorm === key).sort((a, b) => b.hits - a.hits)[0];
    if (hit) return hit;
  }
  return null;
};

export const aiLearning = {
  async get(context: LearningContext, projectId: string | null): Promise<LearnedAlias[]> {
    const { data, error } = await supabase.rpc('get_ai_aliases_v2', { p_context: context, p_project_id: projectId });
    if (error) throw error;
    return parseLearned(data);
  },
  /** Không chặn việc chính: lỗi dạy chỉ ghi cảnh báo. */
  async learn(context: LearningContext, projectId: string | null, pairs: LearnPair[]): Promise<number> {
    const clean = pairs.filter(p => aliasNorm(p.alias).length >= 2 && p.targetId);
    if (!clean.length) return 0;
    const { data, error } = await supabase.rpc('learn_ai_aliases_v2', { p_context: context, p_project_id: projectId, p_pairs: clean });
    if (error) { console.warn('AI learning failed', error.message); return 0; }
    return Number((data as { saved?: number } | null)?.saved) || 0;
  },
};
