import { supabase } from './supabase';
import { ProjectCostItem, CostItemSource } from '../types';

// ══════════════════════════════════════════════════════════════
//  PROJECT COST ITEM SERVICE — Danh mục khoản mục chi phí dự án
//  Cây phân cấp + định mức + cảnh báo ngưỡng
// ══════════════════════════════════════════════════════════════

const TABLE = 'project_cost_items';

const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
const mapKeys = (obj: any, fn: (k: string) => string): any => {
  if (Array.isArray(obj)) return obj.map(v => mapKeys(v, fn));
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));
  }
  return obj;
};
const toDb = (obj: any) => mapKeys(obj, toSnake);
const fromDb = (obj: any) => mapKeys(obj, toCamel);

// Cấu trúc danh mục mặc định theo chuẩn xây dựng
const DEFAULT_COST_STRUCTURE: Array<{
  code: string; name: string; parentCode?: string; source: CostItemSource; order: number;
}> = [
  { code: 'I',    name: 'Chi phí trực tiếp',                source: 'manual',   order: 1 },
  { code: 'I.1',  name: 'Chi phí vật liệu',   parentCode: 'I', source: 'dailylog', order: 2 },
  { code: 'I.2',  name: 'Chi phí nhân công',   parentCode: 'I', source: 'dailylog', order: 3 },
  { code: 'I.3',  name: 'Chi phí máy thi công', parentCode: 'I', source: 'dailylog', order: 4 },
  { code: 'II',   name: 'Chi phí chung',                    source: 'manual',   order: 5 },
  { code: 'II.1', name: 'Chi phí quản lý',    parentCode: 'II', source: 'manual',   order: 6 },
  { code: 'II.2', name: 'Chi phí tạm thời',   parentCode: 'II', source: 'manual',   order: 7 },
  { code: 'III',  name: 'Thu nhập chịu thuế tính trước',     source: 'manual',   order: 8 },
  { code: 'IV',   name: 'Chi phí khác',                      source: 'manual',   order: 9 },
  { code: 'IV.1', name: 'Bảo hiểm công trình', parentCode: 'IV', source: 'manual',  order: 10 },
  { code: 'IV.2', name: 'Chi phí kiểm toán',  parentCode: 'IV', source: 'manual',   order: 11 },
];

export const projectCostItemService = {
  /** Lấy tất cả khoản mục theo site */
  async listBySite(constructionSiteId: string): Promise<ProjectCostItem[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('order', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Khởi tạo danh mục mặc định cho 1 dự án */
  async initDefault(constructionSiteId: string): Promise<ProjectCostItem[]> {
    // Check if already initialized
    const existing = await this.listBySite(constructionSiteId);
    if (existing.length > 0) return existing;

    // First pass: create root items (no parentCode)
    const codeToId = new Map<string, string>();
    const roots = DEFAULT_COST_STRUCTURE.filter(d => !d.parentCode);
    for (const item of roots) {
      const { data, error } = await supabase.from(TABLE).insert({
        construction_site_id: constructionSiteId,
        code: item.code,
        name: item.name,
        order: item.order,
        source: item.source,
        budget_amount: 0,
        actual_amount: 0,
      }).select().single();
      if (error) throw error;
      codeToId.set(item.code, data.id);
    }

    // Second pass: create child items
    const children = DEFAULT_COST_STRUCTURE.filter(d => d.parentCode);
    for (const item of children) {
      const parentId = codeToId.get(item.parentCode!);
      const { data, error } = await supabase.from(TABLE).insert({
        construction_site_id: constructionSiteId,
        code: item.code,
        name: item.name,
        parent_id: parentId,
        order: item.order,
        source: item.source,
        budget_amount: 0,
        actual_amount: 0,
      }).select().single();
      if (error) throw error;
      codeToId.set(item.code, data.id);
    }

    return this.listBySite(constructionSiteId);
  },

  /** Tạo mới khoản mục */
  async create(item: Omit<ProjectCostItem, 'id' | 'createdAt'>): Promise<ProjectCostItem> {
    const dbItem = toDb(item);
    delete dbItem.id;
    const { data, error } = await supabase.from(TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  /** Cập nhật */
  async update(id: string, updates: Partial<ProjectCostItem>): Promise<void> {
    // Auto-calculate variance
    if (updates.actualAmount !== undefined || updates.budgetAmount !== undefined) {
      const { data: current } = await supabase.from(TABLE).select('budget_amount, actual_amount').eq('id', id).single();
      if (current) {
        const budget = updates.budgetAmount ?? current.budget_amount;
        const actual = updates.actualAmount ?? current.actual_amount;
        updates.varianceAmount = actual - budget;
        updates.variancePercent = budget > 0 ? ((actual - budget) / budget) * 100 : 0;
      }
    }
    const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
    if (error) throw error;
  },

  /** Xóa */
  async remove(id: string): Promise<void> {
    const { count } = await supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id);
    if ((count ?? 0) > 0) {
      throw new Error('Khoản mục chi phí này có khoản mục con. Vui lòng xóa các khoản mục con trước.');
    }
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  /** Kiểm tra cảnh báo ngưỡng */
  async checkThresholds(constructionSiteId: string): Promise<Array<{ item: ProjectCostItem; overPercent: number }>> {
    const items = await this.listBySite(constructionSiteId);
    const warnings: Array<{ item: ProjectCostItem; overPercent: number }> = [];
    for (const item of items) {
      if (item.budgetAmount <= 0 || !item.warningThreshold) continue;
      const usedPercent = (item.actualAmount / item.budgetAmount) * 100;
      if (usedPercent >= item.warningThreshold) {
        warnings.push({ item, overPercent: Math.round(usedPercent * 100) / 100 });
      }
    }
    return warnings;
  },

  /** Tổng hợp ngân sách vs thực tế */
  async getSummary(constructionSiteId: string) {
    const items = await this.listBySite(constructionSiteId);
    // Chỉ tính root items (không parentId) để tránh double count
    const rootItems = items.filter(i => !i.parentId);
    const totalBudget = rootItems.reduce((s, i) => s + i.budgetAmount, 0);
    const totalActual = rootItems.reduce((s, i) => s + i.actualAmount, 0);
    return {
      totalBudget,
      totalActual,
      variance: totalActual - totalBudget,
      variancePercent: totalBudget > 0 ? ((totalActual - totalBudget) / totalBudget) * 100 : 0,
      itemCount: items.length,
    };
  },
};
