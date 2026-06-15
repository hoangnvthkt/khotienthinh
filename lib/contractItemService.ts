import { supabase } from './supabase';
import { ContractItem, ContractItemResource, ContractItemType } from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';

// ══════════════════════════════════════════════════════════════
//  CONTRACT ITEM SERVICE — CRUD cho BOQ hạng mục hợp đồng
//  Dùng chung cho: HĐ Khách hàng + HĐ Thầu phụ
// ══════════════════════════════════════════════════════════════

const TABLE = 'contract_items';
const RESOURCE_TABLE = 'contract_item_resources';

async function hasLinkedRows(table: string, column: string, value: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq(column, value)
    .limit(1);
  if (error) throw error;
  return (data?.length || 0) > 0;
}

async function getUsageFlags(id: string): Promise<{ hasPaymentUsage: boolean; hasAcceptanceUsage: boolean }> {
  const [paymentResult, acceptanceResult] = await Promise.all([
    hasLinkedRows('payment_certificate_items', 'contract_item_id', id),
    hasLinkedRows('quantity_acceptance_items', 'contract_item_id', id),
  ]);
  return {
    hasPaymentUsage: paymentResult,
    hasAcceptanceUsage: acceptanceResult,
  };
}

function assertNoUsage(id: string, usage: { hasPaymentUsage: boolean; hasAcceptanceUsage: boolean }) {
  if (usage.hasPaymentUsage) {
    throw new Error(
      'Không thể xóa hạng mục này vì đã có chứng chỉ thanh toán liên kết. Vui lòng rollback hoặc xóa chứng chỉ thanh toán trước.'
    );
  }
  if (usage.hasAcceptanceUsage) {
    throw new Error(
      'Không thể xóa hạng mục này vì đã có phiếu nghiệm thu khối lượng liên kết. Vui lòng rollback hoặc xóa nghiệm thu trước.'
    );
  }
}


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

  /** Lấy BOQ theo project master, fallback theo construction site */
  async listBySite(projectIdOrSiteId: string, contractType?: ContractItemType, constructionSiteId?: string | null): Promise<ContractItem[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('order', { ascending: true });
    if (contractType) query = query.eq('contract_type', contractType);
    const { data, error } = await query;
    if (error) throw error;
    return dedupeRowsById(data || []).map(fromDb);
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
    const existing = await this.findByCode(item.contractId, item.contractType, item.code);
    if (existing) throw new Error(`Mã BOQ "${item.code}" đã tồn tại trong hợp đồng này.`);
    const dbItem = toDb({
      ...item,
      originalQuantity: item.originalQuantity ?? item.quantity,
      originalUnitPrice: item.originalUnitPrice ?? item.unitPrice,
      originalTotalPrice: item.originalTotalPrice ?? item.quantity * item.unitPrice,
      revisedUnitPrice: item.revisedUnitPrice ?? item.unitPrice,
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
      const usage = await getUsageFlags(id);
      if (usage.hasPaymentUsage || usage.hasAcceptanceUsage) {
        throw new Error('BOQ đã có nghiệm thu/thanh toán liên kết, chỉ được điều chỉnh qua phát sinh hợp đồng.');
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
    assertNoUsage(id, await getUsageFlags(id));

    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  /** Batch create (import Excel) */
  async batchCreate(items: Omit<ContractItem, 'id' | 'createdAt'>[]): Promise<ContractItem[]> {
    const duplicateInFile = items.find((item, index) =>
      items.some((other, otherIndex) => otherIndex !== index && other.code.trim().toLowerCase() === item.code.trim().toLowerCase())
    );
    if (duplicateInFile) throw new Error(`File import có mã BOQ bị trùng: ${duplicateInFile.code}`);
    if (items.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from(TABLE)
        .select('code')
        .eq('contract_id', items[0].contractId)
        .eq('contract_type', items[0].contractType)
        .in('code', items.map(item => item.code));
      if (existingError) throw existingError;
      if (existing && existing.length > 0) {
        throw new Error(`Mã BOQ đã tồn tại: ${existing.map(row => row.code).join(', ')}`);
      }
    }
    const dbItems = items.map(item => {
      const d = toDb({
        ...item,
        totalPrice: item.quantity * item.unitPrice,
        revisedUnitPrice: item.revisedUnitPrice ?? item.unitPrice,
        revisedQuantity: item.revisedQuantity ?? item.quantity,
        revisedTotalPrice: item.revisedTotalPrice ?? item.quantity * item.unitPrice,
      });
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


  async findByCode(contractId: string, contractType: ContractItemType, code: string): Promise<ContractItem | null> {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .eq('contract_type', contractType)
      .ilike('code', trimmed)
      .maybeSingle();
    if (error) throw error;
    return data ? fromDb(data) : null;
  },

  async applyVariationDelta(id: string, quantityDelta: number, amountDelta: number, revisedUnitPrice?: number): Promise<void> {
    const { data: current, error: readError } = await supabase
      .from(TABLE)
      .select('quantity, total_price, unit_price, revised_unit_price, variation_quantity, variation_amount')
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
      revised_unit_price: revisedUnitPrice ?? current?.revised_unit_price ?? current?.unit_price ?? 0,
      revised_total_price: revisedTotalPrice,
    }).eq('id', id);
    if (error) throw error;
  },
};

export const contractItemResourceService = {
  async listByItem(contractItemId: string): Promise<ContractItemResource[]> {
    const { data, error } = await supabase
      .from(RESOURCE_TABLE)
      .select('*')
      .eq('contract_item_id', contractItemId)
      .order('order', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async listByItems(contractItemIds: string[]): Promise<Record<string, ContractItemResource[]>> {
    const ids = Array.from(new Set(contractItemIds.filter(Boolean)));
    if (ids.length === 0) return {};
    const { data, error } = await supabase
      .from(RESOURCE_TABLE)
      .select('*')
      .in('contract_item_id', ids)
      .order('order', { ascending: true });
    if (error) throw error;
    return (data || []).reduce<Record<string, ContractItemResource[]>>((acc, row) => {
      const item = fromDb(row) as ContractItemResource;
      if (!acc[item.contractItemId]) acc[item.contractItemId] = [];
      acc[item.contractItemId].push(item);
      return acc;
    }, {});
  },

  async replaceForItem(contractItemId: string, resources: Omit<ContractItemResource, 'id' | 'contractItemId' | 'createdAt'>[]): Promise<void> {
    const { error: deleteError } = await supabase
      .from(RESOURCE_TABLE)
      .delete()
      .eq('contract_item_id', contractItemId);
    if (deleteError) throw deleteError;
    if (resources.length === 0) return;
    const rows = resources.map((resource, index) => {
      const normalized = {
        ...resource,
        contractItemId,
        order: resource.order ?? index,
        totalPrice: resource.totalPrice || resource.quantity * resource.unitPrice,
      };
      const dbItem = toDb(normalized);
      delete dbItem.id;
      return dbItem;
    });
    const { error } = await supabase.from(RESOURCE_TABLE).insert(rows);
    if (error) throw error;
  },
};
