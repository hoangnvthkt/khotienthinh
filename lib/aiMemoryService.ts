// Trí nhớ chung của các skill AI (chủ SP 17/10/2026): cách gọi người dùng đã xác nhận, theo dự án.
// Chỉ đọc / ghi qua RPC (get/learn_ai_memory_aliases_v1), máy chủ kiểm quyền Room Nhật ký của (dự án, công trường).
import { supabase } from './supabase';
import type { MemoryAlias } from './dailyLogReport';

const KINDS = new Set(['task', 'crew', 'area']);

export const parseMemoryAliases = (raw: unknown): MemoryAlias[] => (Array.isArray(raw) ? raw : []).flatMap(item => {
  const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const kind = String(row.kind || '');
  const aliasNorm = typeof row.aliasNorm === 'string' ? row.aliasNorm : '';
  const targetLabel = typeof row.targetLabel === 'string' ? row.targetLabel : '';
  if (!KINDS.has(kind) || !aliasNorm || !targetLabel) return [];
  return [{ kind: kind as MemoryAlias['kind'], alias: String(row.alias || aliasNorm), aliasNorm,
    targetId: typeof row.targetId === 'string' && row.targetId ? row.targetId : null, targetLabel, hits: Math.max(1, Number(row.hits) || 1) }];
});

export const aiMemoryService = {
  async get(projectId: string, constructionSiteId: string | null, kinds: MemoryAlias['kind'][] = ['task', 'crew', 'area']): Promise<MemoryAlias[]> {
    const { data, error } = await supabase.rpc('get_ai_memory_aliases_v1', { p_project_id: projectId, p_construction_site_id: constructionSiteId, p_kinds: kinds });
    if (error) throw error;
    return parseMemoryAliases(data);
  },
  async learn(projectId: string, constructionSiteId: string | null, pairs: Array<{ kind: MemoryAlias['kind']; alias: string; targetId: string | null; targetLabel: string }>): Promise<number> {
    if (!pairs.length) return 0;
    const { data, error } = await supabase.rpc('learn_ai_memory_aliases_v1', { p_project_id: projectId, p_construction_site_id: constructionSiteId, p_pairs: pairs });
    if (error) throw error;
    return Number((data as { saved?: number } | null)?.saved) || 0;
  },
};
