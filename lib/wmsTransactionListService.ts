import type { Transaction } from '../types';
import { supabase } from './supabase';
import { clampPageSize, takeCursorPage, type CursorPage } from './supabasePagination';

export interface TransactionCursor {
  date: string;
  id: string;
}

export type TransactionSummary = Transaction;

export interface WmsTransactionListFilters {
  limit?: number;
  cursor?: TransactionCursor;
  statuses?: string[];
  types?: string[];
  warehouseId?: string | null;
  requesterId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export const WMS_TRANSACTION_LIST_SELECT = 'id,type,date,items,source_warehouse_id,target_warehouse_id,supplier_id,requester_id,created_by,updated_by,business_partner_id,business_partner_name_snapshot,approved_at,approval_note,approver_id,status,note,business_event_type,business_event_reason,source_type,source_id,related_request_id';

export const WMS_TRANSACTION_DETAIL_SELECT = `${WMS_TRANSACTION_LIST_SELECT},pending_items,attachments`;

export const mapWmsTransactionFromDb = (row: any): Transaction => ({
  ...row,
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
  items: Array.isArray(row.items)
    ? row.items.map((item: any) => ({
      ...item,
      orderedQty: item.orderedQty ?? item.ordered_qty,
      varianceReason: item.varianceReason ?? item.variance_reason,
    }))
    : [],
  sourceWarehouseId: row.source_warehouse_id ?? row.sourceWarehouseId,
  targetWarehouseId: row.target_warehouse_id ?? row.targetWarehouseId,
  supplierId: row.supplier_id ?? row.supplierId,
  requesterId: row.requester_id ?? row.requesterId,
  createdBy: row.created_by ?? row.createdBy ?? null,
  updatedBy: row.updated_by ?? row.updatedBy ?? null,
  businessPartnerId: row.business_partner_id ?? row.businessPartnerId ?? null,
  businessPartnerNameSnapshot: row.business_partner_name_snapshot ?? row.businessPartnerNameSnapshot ?? null,
  approvedAt: row.approved_at ?? row.approvedAt ?? null,
  approvalNote: row.approval_note ?? row.approvalNote ?? null,
  businessEventType: row.business_event_type ?? row.businessEventType ?? null,
  businessEventReason: row.business_event_reason ?? row.businessEventReason ?? null,
  approverId: row.approver_id ?? row.approverId,
  sourceType: row.source_type ?? row.sourceType ?? null,
  sourceId: row.source_id ?? row.sourceId ?? null,
  relatedRequestId: row.related_request_id ?? row.relatedRequestId,
  pendingItems: row.pending_items ?? row.pendingItems,
});

export const wmsTransactionListService = {
  async listPage(filters: WmsTransactionListFilters = {}): Promise<CursorPage<TransactionSummary, TransactionCursor>> {
    const limit = clampPageSize(filters.limit);
    let query = supabase
      .from('transactions')
      .select(WMS_TRANSACTION_LIST_SELECT)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (filters.statuses?.length) query = query.in('status', filters.statuses);
    if (filters.types?.length) query = query.in('type', filters.types);
    if (filters.requesterId) query = query.eq('requester_id', filters.requesterId);
    if (filters.warehouseId) {
      query = query.or(`source_warehouse_id.eq.${filters.warehouseId},target_warehouse_id.eq.${filters.warehouseId}`);
    }
    if (filters.dateFrom) query = query.gte('date', filters.dateFrom);
    if (filters.dateTo) query = query.lte('date', filters.dateTo);
    if (filters.cursor?.date && filters.cursor.id) {
      query = query.or(`date.lt.${filters.cursor.date},and(date.eq.${filters.cursor.date},id.lt.${filters.cursor.id})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const page = takeCursorPage(data || [], limit, row => ({ date: row.date, id: row.id }));
    return {
      items: page.items.map(mapWmsTransactionFromDb),
      nextCursor: page.nextCursor,
    };
  },

  async getById(id: string): Promise<Transaction | null> {
    if (!id) return null;
    const { data, error } = await supabase
      .from('transactions')
      .select(WMS_TRANSACTION_DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapWmsTransactionFromDb(data) : null;
  },
};
