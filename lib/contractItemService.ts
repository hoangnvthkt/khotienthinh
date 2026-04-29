import { supabase } from './supabase';
import { ContractItem, ContractItemType } from '../types';

// ══════════════════════════════════════════════════════════════
//  CONTRACT ITEM SERVICE — CRUD cho BOQ hạng mục hợp đồng
//  Dùng chung cho: HĐ Khách hàng + HĐ Thầu phụ
// ══════════════════════════════════════════════════════════════

const TABLE = 'contract_items';

// snake_case ↔ camelCase mapping
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

// Helpers
const buildTree = (items: ContractItem[]): ContractItem[] => {
  const map = new Map<string, ContractItem & { children?: ContractItem[] }>();
  const roots: (ContractItem & { children?: ContractItem[] })[] = [];
  items.forEach(i => map.set(i.id, { ...i, children: [] }));
  items.forEach(i => {
    const node = map.get(i.id)!;
    if (i.parentId && map.has(i.parentId)) {
      map.get(i.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

export const contractItemService = {
  /** Lấy tất cả hạng mục BOQ theo hợp đồng */
  async listByContract(contractId: string, contractType: ContractItemType): Promise<ContractItem[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .eq('contract_type', contractType)
      .order('order', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Lấy BOQ theo construction site */
  async listBySite(constructionSiteId: string, contractType?: ContractItemType): Promise<ContractItem[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('order', { ascending: true });
    if (contractType) query = query.eq('contract_type', contractType);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Trả về cây phân cấp */
  async getTreeStructure(contractId: string, contractType: ContractItemType) {
    const items = await this.listByContract(contractId, contractType);
    return buildTree(items);
  },

  /** Tổng giá trị HĐ, % hoàn thành */
  async getSummary(contractId: string, contractType: ContractItemType) {
    const items = await this.listByContract(contractId, contractType);
    const totalValue = items.reduce((s, i) => s + (i.totalPrice || 0), 0);
    const completedValue = items.reduce((s, i) => s + ((i.completedQuantity || 0) * i.unitPrice), 0);
    const completedPercent = totalValue > 0 ? (completedValue / totalValue) * 100 : 0;
    return { totalValue, completedValue, completedPercent, itemCount: items.length };
  },

  /** Tạo mới hạng mục */
  async create(item: Omit<ContractItem, 'id' | 'createdAt'>): Promise<ContractItem> {
    const dbItem = toDb({
      ...item,
      totalPrice: item.quantity * item.unitPrice,
    });
    delete dbItem.id;
    const { data, error } = await supabase
      .from(TABLE)
      .insert(dbItem)
      .select()
      .single();
    if (error) throw error;
    return fromDb(data);
  },

  /** Cập nhật hạng mục */
  async update(id: string, updates: Partial<ContractItem>): Promise<void> {
    const dbUpdates = toDb(updates);
    // Auto-calculate totalPrice if quantity or unitPrice changed
    if (updates.quantity !== undefined || updates.unitPrice !== undefined) {
      const { data: current } = await supabase.from(TABLE).select('quantity, unit_price').eq('id', id).single();
      if (current) {
        const qty = updates.quantity ?? current.quantity;
        const price = updates.unitPrice ?? current.unit_price;
        dbUpdates.total_price = qty * price;
      }
    }
    const { error } = await supabase.from(TABLE).update(dbUpdates).eq('id', id);
    if (error) throw error;
  },

  /** Xóa hạng mục */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  /** Batch create (import Excel) */
  async batchCreate(items: Omit<ContractItem, 'id' | 'createdAt'>[]): Promise<ContractItem[]> {
    const dbItems = items.map(item => {
      const d = toDb({ ...item, totalPrice: item.quantity * item.unitPrice });
      delete d.id;
      return d;
    });
    const { data, error } = await supabase.from(TABLE).insert(dbItems).select();
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Cập nhật KL hoàn thành (gọi từ nhật ký/nghiệm thu) */
  async updateCompletedQuantity(id: string, completedQuantity: number): Promise<void> {
    const { data: item } = await supabase.from(TABLE).select('quantity').eq('id', id).single();
    const completedPercent = item && item.quantity > 0
      ? Math.min((completedQuantity / item.quantity) * 100, 100)
      : 0;
    const { error } = await supabase.from(TABLE).update({
      completed_quantity: completedQuantity,
      completed_percent: Math.round(completedPercent * 100) / 100,
    }).eq('id', id);
    if (error) throw error;
  },
};
