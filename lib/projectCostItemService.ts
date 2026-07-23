import { supabase } from './supabase';
import { ProjectCostItem, CostItemSource, ProjectCostCategory, ProjectTransaction } from '../types';
import { contractCostItemService } from './contractMetadataService';
import { buildContractCostItemOptions } from './contractCostItemOptions';

export interface ProjectContractCostAnalysisNode {
  id: string;
  symbol: string;
  name: string;
  parentId?: string | null;
  category?: ProjectCostCategory | null;
  costType?: string | null;
  depth: number;
  order: number;
  budgetAmount: number;
  totalBudgetAmount: number;
  directActualAmount: number;
  actualAmount: number;
  varianceAmount: number;
  variancePercent: number;
  txCount: number;
  directTxCount: number;
  children: ProjectContractCostAnalysisNode[];
}

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
  /** Lấy tất cả khoản mục theo dự án; fallback theo site chỉ dùng cho luồng không có projectId. */
  async listBySite(constructionSiteId: string, projectId?: string | null): Promise<ProjectCostItem[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .order('order', { ascending: true });
    query = projectId ? query.eq('project_id', projectId) : query.eq('construction_site_id', constructionSiteId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Khởi tạo danh mục mặc định cho 1 dự án */
  async initDefault(constructionSiteId: string, projectId?: string | null): Promise<ProjectCostItem[]> {
    // Check if already initialized
    const existing = await this.listBySite(constructionSiteId, projectId);
    if (existing.length > 0) return existing;

    // First pass: create root items (no parentCode)
    const codeToId = new Map<string, string>();
    const roots = DEFAULT_COST_STRUCTURE.filter(d => !d.parentCode);
    for (const item of roots) {
      const { data, error } = await supabase.from(TABLE).insert({
        project_id: projectId || null,
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
        project_id: projectId || null,
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

    return this.listBySite(constructionSiteId, projectId);
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
    const { data: childRows, error: childError } = await supabase
      .from(TABLE)
      .select('id')
      .eq('parent_id', id)
      .limit(1);
    if (childError) throw childError;
    if ((childRows?.length || 0) > 0) {
      throw new Error('Khoản mục chi phí này có khoản mục con. Vui lòng xóa các khoản mục con trước.');
    }
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  /** Kiểm tra cảnh báo ngưỡng */
  async checkThresholds(constructionSiteId: string, projectId?: string | null): Promise<Array<{ item: ProjectCostItem; overPercent: number }>> {
    const items = await this.listBySite(constructionSiteId, projectId);
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
  async getSummary(constructionSiteId: string, projectId?: string | null) {
    const items = await this.listBySite(constructionSiteId, projectId);
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

  /** Ánh xạ Cây Khoản mục Chi phí từ Quản lý Hợp đồng + Tự động tổng hợp số tiền phát sinh từ Sổ giao dịch project_transactions */
  async listProjectCostAnalysisTree(constructionSiteId: string, projectId?: string | null): Promise<ProjectContractCostAnalysisNode[]> {
    const contractCostItems = await contractCostItemService.list();

    let projectCostItems: ProjectCostItem[] = [];
    try {
      projectCostItems = await this.listBySite(constructionSiteId, projectId);
    } catch {
      projectCostItems = [];
    }

    const budgetMap = new Map<string, number>();
    for (const pci of projectCostItems) {
      if (pci.code) budgetMap.set(pci.code, pci.budgetAmount || 0);
      if (pci.name) budgetMap.set(pci.name, pci.budgetAmount || 0);
    }

    let query = supabase
      .from('project_transactions')
      .select('*')
      .eq('type', 'expense');
    if (projectId) {
      query = query.eq('project_id', projectId);
    } else {
      query = query.eq('construction_site_id', constructionSiteId);
    }
    const { data: txData, error: txError } = await query;
    if (txError) throw txError;
    const transactions: ProjectTransaction[] = (txData || []).map(fromDb);

    const directActualMap = new Map<string, { amount: number; count: number }>();
    for (const tx of transactions) {
      const amount = Math.abs(Number(tx.amount || 0));
      let matchedItemId: string | null = tx.contractCostItemId || null;

      if (!matchedItemId && tx.contractCostItemSymbolSnapshot) {
        const found = contractCostItems.find(c => c.symbol.toLowerCase() === tx.contractCostItemSymbolSnapshot?.toLowerCase());
        if (found) matchedItemId = found.id;
      }
      if (!matchedItemId && tx.contractCostItemNameSnapshot) {
        const found = contractCostItems.find(c => c.name.toLowerCase() === tx.contractCostItemNameSnapshot?.toLowerCase());
        if (found) matchedItemId = found.id;
      }

      if (matchedItemId) {
        const prev = directActualMap.get(matchedItemId) || { amount: 0, count: 0 };
        directActualMap.set(matchedItemId, {
          amount: prev.amount + amount,
          count: prev.count + 1,
        });
      }
    }

    const options = buildContractCostItemOptions(contractCostItems);
    const nodeMap = new Map<string, ProjectContractCostAnalysisNode>();

    for (const opt of options) {
      const item = opt.item;
      const budget = budgetMap.get(item.symbol) || budgetMap.get(item.id) || 0;
      const direct = directActualMap.get(item.id) || { amount: 0, count: 0 };

      nodeMap.set(item.id, {
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        parentId: item.parentId || null,
        category: item.category || null,
        costType: item.costType || null,
        depth: opt.depth,
        order: item.sortOrder || 0,
        budgetAmount: budget,
        totalBudgetAmount: budget,
        directActualAmount: direct.amount,
        actualAmount: direct.amount,
        varianceAmount: 0,
        variancePercent: 0,
        txCount: direct.count,
        directTxCount: direct.count,
        children: [],
      });
    }

    const rootNodes: ProjectContractCostAnalysisNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    const computeRollup = (node: ProjectContractCostAnalysisNode) => {
      let childBudgetSum = 0;
      let childActualSum = 0;
      let childTxCountSum = 0;

      for (const child of node.children) {
        computeRollup(child);
        childBudgetSum += child.totalBudgetAmount;
        childActualSum += child.actualAmount;
        childTxCountSum += child.txCount;
      }

      node.totalBudgetAmount = node.budgetAmount + childBudgetSum;
      node.actualAmount = node.directActualAmount + childActualSum;
      node.txCount = node.directTxCount + childTxCountSum;
      node.varianceAmount = node.totalBudgetAmount - node.actualAmount;
      node.variancePercent = node.totalBudgetAmount > 0
        ? (node.actualAmount / node.totalBudgetAmount) * 100
        : 0;
    };

    for (const root of rootNodes) {
      computeRollup(root);
    }

    return rootNodes;
  },

  /** Lưu/Cập nhật Ngân sách Dự toán cho 1 Khoản mục Chi phí */
  async saveProjectCostBudget(
    constructionSiteId: string,
    projectId: string | null | undefined,
    symbol: string,
    name: string,
    budgetAmount: number,
  ): Promise<void> {
    const existingList = await this.listBySite(constructionSiteId, projectId);
    const existing = existingList.find(i => i.code === symbol || i.name === name);

    if (existing) {
      await this.update(existing.id, { budgetAmount });
    } else {
      await this.create({
        constructionSiteId,
        projectId: projectId || null,
        code: symbol,
        name,
        budgetAmount,
        actualAmount: 0,
        order: 1,
        source: 'manual',
      });
    }
  },
};
