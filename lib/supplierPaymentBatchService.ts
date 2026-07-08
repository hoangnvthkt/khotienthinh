import type {
  SupplierPayableDocument,
  SupplierPaymentAllocation,
  SupplierPaymentAllocationMode,
  SupplierPaymentBatch,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const BATCH_TABLE = 'supplier_payment_batches';
const ALLOCATION_TABLE = 'supplier_payment_allocations';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;
const newId = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();

const allocationReduction = (allocation: Pick<SupplierPaymentAllocation, 'allocatedAmount' | 'discountAmount' | 'withholdingAmount'>) =>
  money(numeric(allocation.allocatedAmount) + numeric(allocation.discountAmount) + numeric(allocation.withholdingAmount));

const sortableDate = (document: SupplierPayableDocument) =>
  String(document.dueDate || document.documentDate || document.createdAt || '');

const baseAllocation = (
  paymentBatchId: string,
  document: SupplierPayableDocument,
  allocatedAmount: number,
  mode: SupplierPaymentAllocationMode,
): SupplierPaymentAllocation => ({
  id: newId(),
  paymentBatchId,
  payableDocumentId: document.id,
  sourceType: document.sourceType,
  sourceId: document.sourceId,
  documentNoSnapshot: document.documentNo,
  recognizedAmountSnapshot: document.recognizedAmount,
  paidBeforeSnapshot: document.paidAmount || 0,
  outstandingBeforeSnapshot: document.outstandingAmount,
  allocatedAmount: money(allocatedAmount),
  discountAmount: 0,
  withholdingAmount: 0,
  allocationMode: mode,
  createdAt: nowIso(),
});

export const allocateSupplierPayment = (input: {
  mode: SupplierPaymentAllocationMode;
  paymentBatchId: string;
  amount: number;
  documents: SupplierPayableDocument[];
  manualAllocations?: Record<string, number>;
}): SupplierPaymentAllocation[] => {
  const amount = money(input.amount);
  const documents = input.documents
    .filter(document => document.status !== 'cancelled' && document.status !== 'reversed')
    .filter(document => numeric(document.outstandingAmount) > 0);

  if (amount <= 0 || documents.length === 0) return [];

  if (input.mode === 'manual') {
    return documents
      .map(document => baseAllocation(input.paymentBatchId, document, input.manualAllocations?.[document.id] || 0, 'manual'))
      .filter(allocation => allocation.allocatedAmount > 0);
  }

  if (input.mode === 'proportional') {
    const totalOutstanding = documents.reduce((sum, document) => sum + numeric(document.outstandingAmount), 0);
    if (totalOutstanding <= 0) return [];
    let remaining = Math.min(amount, totalOutstanding);
    return documents.map((document, index) => {
      const isLast = index === documents.length - 1;
      const proportionalAmount = isLast
        ? remaining
        : Math.min(document.outstandingAmount, money(amount * (document.outstandingAmount / totalOutstanding)));
      remaining = money(remaining - proportionalAmount);
      return baseAllocation(input.paymentBatchId, document, proportionalAmount, 'proportional');
    }).filter(allocation => allocation.allocatedAmount > 0);
  }

  let remaining = amount;
  const allocations: SupplierPaymentAllocation[] = [];
  documents
    .slice()
    .sort((a, b) => sortableDate(a).localeCompare(sortableDate(b)) || a.documentNo.localeCompare(b.documentNo))
    .forEach(document => {
      if (remaining <= 0) return;
      const allocatedAmount = Math.min(remaining, numeric(document.outstandingAmount));
      if (allocatedAmount <= 0) return;
      allocations.push(baseAllocation(input.paymentBatchId, document, allocatedAmount, 'fifo'));
      remaining = money(remaining - allocatedAmount);
    });
  return allocations;
};

export const assertSupplierPaymentBatchCanPost = (input: {
  amount: number;
  allocations: SupplierPaymentAllocation[];
  documents: SupplierPayableDocument[];
}) => {
  const documentsById = new Map(input.documents.map(document => [document.id, document]));
  const allocatedByDocument = new Map<string, number>();
  input.allocations.forEach(allocation => {
    const current = allocatedByDocument.get(allocation.payableDocumentId) || 0;
    allocatedByDocument.set(allocation.payableDocumentId, money(current + allocationReduction(allocation)));
  });

  allocatedByDocument.forEach((allocatedAmount, documentId) => {
    const document = documentsById.get(documentId);
    if (!document) throw new Error(`Không tìm thấy chứng từ công nợ ${documentId}.`);
    if (allocatedAmount > money(document.outstandingAmount)) {
      throw new Error(`Số phân bổ vượt công nợ của chứng từ ${document.documentNo}.`);
    }
  });

  const totalAllocated = money(input.allocations.reduce((sum, allocation) => sum + numeric(allocation.allocatedAmount), 0));
  if (totalAllocated > money(input.amount)) {
    throw new Error('Tổng phân bổ vượt số tiền thanh toán.');
  }
};

const normalizeBatch = (row: any): SupplierPaymentBatch => {
  const mapped = fromDb(row) as SupplierPaymentBatch;
  const paymentAmount = money((row.payment_amount ?? mapped.paymentAmount ?? mapped.amount) || 0);
  return {
    ...mapped,
    amount: paymentAmount,
    paymentAmount,
    currency: mapped.currency || 'VND',
    allocationMode: mapped.allocationMode || 'fifo',
    metadata: mapped.metadata || {},
  };
};

const normalizeAllocation = (row: any): SupplierPaymentAllocation => ({
  ...(fromDb(row) as SupplierPaymentAllocation),
  allocatedAmount: money(row.allocated_amount),
  discountAmount: money(row.discount_amount),
  withholdingAmount: money(row.withholding_amount),
});

const batchPayload = (batch: SupplierPaymentBatch) => {
  const { amount, paymentAmount, ...rest } = batch;
  return toDb({
    ...rest,
    paymentAmount: paymentAmount ?? amount,
  });
};

export const supplierPaymentBatchService = {
  async listBatches(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierId?: string | null;
    status?: string | null;
    periodMonth?: string | null;
  } = {}): Promise<SupplierPaymentBatch[]> {
    let query = supabase.from(BATCH_TABLE).select('*').order('payment_date', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    if (input.status) query = query.eq('status', input.status);
    if (input.periodMonth) query = query.eq('period_month', input.periodMonth);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeBatch);
  },

  async getBatchDetail(paymentBatchId: string): Promise<{
    batch: SupplierPaymentBatch;
    allocations: SupplierPaymentAllocation[];
  }> {
    const { data, error } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .eq('id', paymentBatchId)
      .single();
    if (error) throw error;
    return {
      batch: normalizeBatch(data),
      allocations: await this.listAllocations(paymentBatchId),
    };
  },

  async createDraft(input: SupplierPaymentBatch, allocations: SupplierPaymentAllocation[] = []): Promise<SupplierPaymentBatch> {
    const { data, error } = await supabase
      .from(BATCH_TABLE)
      .upsert(batchPayload(input), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    const batch = normalizeBatch(data);

    if (allocations.length > 0) {
      const { error: allocationError } = await supabase
        .from(ALLOCATION_TABLE)
        .upsert(allocations.map(toDb), { onConflict: 'payment_batch_id,payable_document_id' });
      if (allocationError) throw allocationError;
    }
    return batch;
  },

  async updateDraft(input: SupplierPaymentBatch, allocations: SupplierPaymentAllocation[] = []): Promise<SupplierPaymentBatch> {
    const { data, error } = await supabase
      .from(BATCH_TABLE)
      .upsert(batchPayload(input), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;

    const { error: deleteError } = await supabase
      .from(ALLOCATION_TABLE)
      .delete()
      .eq('payment_batch_id', input.id);
    if (deleteError) throw deleteError;

    if (allocations.length > 0) {
      const { error: allocationError } = await supabase
        .from(ALLOCATION_TABLE)
        .upsert(allocations.map(toDb), { onConflict: 'payment_batch_id,payable_document_id' });
      if (allocationError) throw allocationError;
    }
    return normalizeBatch(data);
  },

  async listAllocations(paymentBatchId: string): Promise<SupplierPaymentAllocation[]> {
    const { data, error } = await supabase
      .from(ALLOCATION_TABLE)
      .select('*')
      .eq('payment_batch_id', paymentBatchId)
      .order('created_at', { ascending: true });
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeAllocation);
  },

  async post(paymentBatchId: string, actorId?: string | null): Promise<SupplierPaymentBatch> {
    const { data, error } = await supabase.rpc('post_supplier_payment_batch', {
      p_batch_id: paymentBatchId,
      p_actor_id: actorId || null,
    });
    if (error) throw error;
    return normalizeBatch(Array.isArray(data) ? data[0] : data);
  },

  async reverse(paymentBatchId: string, actorId?: string | null): Promise<SupplierPaymentBatch> {
    const { data, error } = await supabase.rpc('reverse_supplier_payment_batch', {
      p_batch_id: paymentBatchId,
      p_actor_id: actorId || null,
    });
    if (error) throw error;
    return normalizeBatch(Array.isArray(data) ? data[0] : data);
  },
};
