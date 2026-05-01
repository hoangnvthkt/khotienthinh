import { supabase } from './supabase';
import { ContractItem, ContractItemType } from '../types';
import { fromDb, toDb } from './dbMapping';

// ══════════════════════════════════════════════════════════════
//  CONTRACT ITEM SERVICE — CRUD cho BOQ hạng mục hợp đồng
//  Dùng chung cho: HĐ Khách hàng + HĐ Thầu phụ
// ══════════════════════════════════════════════════════════════

const TABLE = 'contract_items';


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
    const approvedVariationValue = items.reduce((s, i) => s + (i.variationAmount || 0), 0);
    const revisedTotalValue = items.reduce((s, i) => s + (i.revisedTotalPrice ?? i.totalPrice ?? 0), 0);
    const completedValue = items.reduce((s, i) => s + ((i.completedQuantity || 0) * i.unitPrice), 0);
    const completedPercent = revisedTotalValue > 0 ? (completedValue / revisedTotalValue) * 100 : 0;
    return { totalValue, approvedVariationValue, revisedTotalValue, completedValue, completedPercent, itemCount: items.length };
  },

  /** Tạo mới hạng mục */
  async create(item: Omit<ContractItem, 'id' | 'createdAt'>): Promise<ContractItem> {
    const dbItem = toDb({
      ...item,
      originalQuantity: item.originalQuantity ?? item.quantity,
      originalUnitPrice: item.originalUnitPrice ?? item.unitPrice,
      originalTotalPrice: item.originalTotalPrice ?? item.quantity * item.unitPrice,
      revisedQuantity: item.revisedQuantity ?? item.quantity,
      totalPrice: item.quantity * item.unitPrice,
      revisedTotalPrice: item.revisedTotalPrice ?? item.quantity * item.unitPrice,
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
    const sensitive = updates.quantity !== undefined || updates.unitPrice !== undefined || updates.totalPrice !== undefined;
    if (sensitive) {
      const { data: lockInfo } = await supabase.from(TABLE).select('is_locked').eq('id', id).single();
      if (lockInfo?.is_locked) {
        throw new Error('BOQ đã có nghiệm thu/thanh toán, chỉ được điều chỉnh qua phát sinh hợp đồng.');
      }
    }
    // Auto-calculate totalPrice if quantity or unitPrice changed
    if (updates.quantity !== undefined || updates.unitPrice !== undefined) {
      const { data: current } = await supabase.from(TABLE).select('quantity, unit_price, variation_quantity, variation_amount').eq('id', id).single();
      if (current) {
        const qty = updates.quantity ?? current.quantity;
        const price = updates.unitPrice ?? current.unit_price;
        const variationQuantity = updates.variationQuantity ?? current.variation_quantity ?? 0;
        const variationAmount = updates.variationAmount ?? current.variation_amount ?? 0;
        dbUpdates.total_price = qty * price;
        dbUpdates.revised_quantity = qty + variationQuantity;
        dbUpdates.revised_total_price = qty * price + variationAmount;
      }
    }
    const { error } = await supabase.from(TABLE).update(dbUpdates).eq('id', id);
    if (error) throw error;
  },

  /** Xóa hạng mục */
  async remove(id: string): Promise<void> {
    // Guard: kiểm tra chứng chỉ thanh toán liên quan
    const { count: payCount } = await supabase
      .from('payment_certificate_items')
      .select('*', { count: 'exact', head: true })
      .eq('contract_item_id', id);
    if (payCount && payCount > 0) {
      throw new Error(
        `Không thể xóa hạng mục này vì đã có ${payCount} chứng chỉ thanh toán liên kết. Vui lòng xóa chứng chỉ thanh toán trước.`
      );
    }

    // Guard: kiểm tra phiếu nghiệm thu liên quan
    const { count: qaCount } = await supabase
      .from('quantity_acceptance_items')
      .select('*', { count: 'exact', head: true })
      .eq('contract_item_id', id);
    if (qaCount && qaCount > 0) {
      throw new Error(
        `Không thể xóa hạng mục này vì đã có ${qaCount} phiếu nghiệm thu khối lượng liên kết. Vui lòng xóa nghiệm thu trước.`
      );
    }

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

  async lockItems(ids: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;
    const { error } = await supabase
      .from(TABLE)
      .update({ is_locked: true, locked_at: new Date().toISOString() })
      .in('id', uniqueIds);
    if (error) throw error;
  },

  /** Mở khóa BOQ items — dùng khi rollback nghiệm thu/thanh toán bị hủy */
  async unlockItems(ids: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;
    const { error } = await supabase
      .from(TABLE)
      .update({ is_locked: false, locked_at: null })
      .in('id', uniqueIds);
    if (error) throw error;
  },


  async applyVariationDelta(id: string, quantityDelta: number, amountDelta: number): Promise<void> {
    const { data: current, error: readError } = await supabase
      .from(TABLE)
      .select('quantity, total_price, variation_quantity, variation_amount')
      .eq('id', id)
      .single();
    if (readError) throw readError;
    const variationQuantity = Number(current?.variation_quantity || 0) + quantityDelta;
    const variationAmount = Number(current?.variation_amount || 0) + amountDelta;
    const revisedQuantity = Number(current?.quantity || 0) + variationQuantity;
    const revisedTotalPrice = Number(current?.total_price || 0) + variationAmount;
    const { error } = await supabase.from(TABLE).update({
      variation_quantity: variationQuantity,
      variation_amount: variationAmount,
      revised_quantity: revisedQuantity,
      revised_total_price: revisedTotalPrice,
    }).eq('id', id);
    if (error) throw error;
  },
};
