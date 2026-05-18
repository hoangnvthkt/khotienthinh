import { supabase } from './supabase';
import {
  ContractItemType,
  ContractVariation,
  ContractVariationItem,
  ContractVariationStatus,
  User,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { auditService } from './auditService';
import { approvalService } from './approvalService';

const TABLE = 'contract_variations';
const ITEM_TABLE = 'contract_variation_items';

const normalize = (row: any): ContractVariation => ({
  ...fromDb(row),
  items: row.items || [],
});

async function fetchItems(variationIds: string[]): Promise<Record<string, ContractVariationItem[]>> {
  if (variationIds.length === 0) return {};
  const { data, error } = await supabase
    .from(ITEM_TABLE)
    .select('*')
    .in('variation_id', variationIds)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('contract_variation_items unavailable', error.message);
    return {};
  }
  return (data || []).reduce<Record<string, ContractVariationItem[]>>((acc, row) => {
    if (!acc[row.variation_id]) acc[row.variation_id] = [];
    acc[row.variation_id].push(fromDb(row));
    return acc;
  }, {});
}

async function replaceItems(variationId: string, items: ContractVariationItem[]): Promise<void> {
  const { error: deleteError } = await supabase.from(ITEM_TABLE).delete().eq('variation_id', variationId);
  if (deleteError) {
    console.warn('Cannot replace normalized variation items', deleteError.message);
    return;
  }
  if (items.length === 0) return;
  const rows = items.map(item => {
    const amountDelta = item.amountDelta ?? item.quantityDelta * item.unitPrice;
    const dbItem = toDb({ ...item, variationId, amountDelta });
    delete dbItem.id;
    return dbItem;
  });
  const { error } = await supabase.from(ITEM_TABLE).insert(rows);
  if (error) throw error;
}

export const variationService = {
  async listByContract(contractId: string, contractType: ContractItemType): Promise<ContractVariation[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .eq('contract_type', contractType)
      .order('version_number', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    const variations = (data || []).map(normalize);
    const itemMap = await fetchItems(variations.map(v => v.id));
    return variations.map(v => ({ ...v, items: itemMap[v.id] || v.items || [] }));
  },

  async create(params: Omit<ContractVariation, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'totalAmountDelta'> & { status?: ContractVariationStatus }): Promise<ContractVariation> {
    const totalAmountDelta = params.items.reduce((sum, item) => sum + (item.amountDelta ?? item.quantityDelta * item.unitPrice), 0);
    const { data: existing, error: versionError } = await supabase
      .from(TABLE)
      .select('version_number')
      .eq('contract_id', params.contractId)
      .eq('contract_type', params.contractType)
      .order('version_number', { ascending: false, nullsFirst: false })
      .limit(1);
    if (versionError) throw versionError;
    const versionNumber = params.versionNumber || Number(existing?.[0]?.version_number || 0) + 1;
    const dbItem = toDb({
      ...params,
      status: params.status || 'draft',
      totalAmountDelta,
      versionNumber,
      adjustmentDate: params.adjustmentDate || new Date().toISOString().slice(0, 10),
    });
    delete dbItem.id;
    delete dbItem.items; // 'items' là virtual field, lưu riêng trong contract_variation_items
    const { data, error } = await supabase.from(TABLE).insert(dbItem).select().single();
    if (error) throw error;
    await replaceItems(data.id, params.items);
    return { ...normalize(data), versionNumber, items: params.items };
  },

  async update(id: string, updates: Partial<ContractVariation>): Promise<void> {
    const { data: current, error: readError } = await supabase.from(TABLE).select('status').eq('id', id).single();
    if (readError) throw readError;
    if (current.status === 'approved' || current.status === 'cancelled') {
      throw new Error('Phát sinh đã duyệt/hủy, không thể chỉnh sửa.');
    }
    const next = {
      ...updates,
      totalAmountDelta: updates.items
        ? updates.items.reduce((sum, item) => sum + (item.amountDelta ?? item.quantityDelta * item.unitPrice), 0)
        : updates.totalAmountDelta,
    };
    const dbNext = toDb(next);
    delete dbNext.items; // 'items' là virtual field, lưu riêng trong contract_variation_items
    const { error } = await supabase.from(TABLE).update(dbNext).eq('id', id);
    if (error) throw error;
    if (updates.items) await replaceItems(id, updates.items);
  },

  async setStatus(id: string, status: ContractVariationStatus, userId?: string, reason?: string, approverUser?: User, projectId?: string): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (readError) throw readError;
    const variation = normalize(data);
    const itemMap = await fetchItems([id]);
    variation.items = itemMap[id] || [];

    if (variation.status === 'approved' || variation.status === 'cancelled') {
      throw new Error('Phát sinh đã kết thúc, không thể đổi trạng thái.');
    }

    if ((status === 'approved' || status === 'rejected') && approverUser) {
      const check = await approvalService.checkApproval({
        module: 'contract_variation',
        action: 'approve',
        amount: Math.abs(variation.totalAmountDelta || 0),
        projectId,
        constructionSiteId: variation.constructionSiteId,
        user: approverUser,
      });
      if (!check.allowed) throw new Error(check.reason);
    }

    const now = new Date().toISOString();
    if (status === 'approved') {
      const { error } = await supabase.rpc('approve_contract_variation', {
        p_variation_id: id,
        p_user_id: userId || null,
      });
      if (error) throw error;
    } else {
      const updates: any = { status };
      if (status === 'submitted') { updates.submittedBy = userId; updates.submittedAt = now; }
      if (status === 'rejected') { updates.rejectedBy = userId; updates.rejectedAt = now; updates.rejectionReason = reason; }
      const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
      if (error) throw error;
    }
    await auditService.log({
      tableName: TABLE,
      recordId: id,
      action: 'UPDATE',
      oldData: { status: variation.status },
      newData: { status },
      userId: userId || 'system',
      userName: userId || 'system',
      description: `Chuyển trạng thái phát sinh ${variation.code}: ${variation.status} -> ${status}`,
    });
  },

  async remove(id: string): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('status').eq('id', id).single();
    if (readError) throw readError;
    if (data?.status !== 'draft') throw new Error('Chỉ xoá được phát sinh ở trạng thái Nháp.');
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};
