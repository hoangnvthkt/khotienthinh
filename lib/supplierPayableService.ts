import type {
  PurchaseOrder,
  SupplierPayableBalance,
  SupplierPayableDocument,
  SupplierPaymentAllocation,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const DOCUMENT_TABLE = 'supplier_payable_documents';
const DOCUMENT_BALANCE_VIEW = 'supplier_payable_document_balances';
const BALANCE_VIEW = 'supplier_payable_balances';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

const newId = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

const compact = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const allocationReduction = (allocation: Pick<SupplierPaymentAllocation, 'allocatedAmount' | 'discountAmount' | 'withholdingAmount'>) =>
  money(numeric(allocation.allocatedAmount) + numeric(allocation.discountAmount) + numeric(allocation.withholdingAmount));

export const calculatePurchaseOrderRecognizedAmount = (po: Pick<PurchaseOrder, 'items'>) =>
  money((po.items || []).reduce((sum, item) => {
    const netReceivedQty = Math.max(0, numeric(item.receivedQty) - numeric(item.returnedQty));
    return sum + netReceivedQty * numeric(item.unitPrice);
  }, 0));

export const calculatePurchaseOrderCommittedAmount = (po: Pick<PurchaseOrder, 'items' | 'totalAmount'>) => {
  const itemTotal = (po.items || []).reduce((sum, item) => sum + numeric(item.qty) * numeric(item.unitPrice), 0);
  return money(itemTotal || po.totalAmount);
};

const documentStatus = (recognizedAmount: number, paidAmount: number, creditAmount = 0): SupplierPayableDocument['status'] => {
  const outstandingAmount = Math.max(0, recognizedAmount - paidAmount - creditAmount);
  if (recognizedAmount <= 0) return 'draft';
  if (outstandingAmount <= 0) return 'paid';
  if (paidAmount > 0 || creditAmount > 0) return 'partial';
  return 'open';
};

export const buildPayableDocumentFromPurchaseOrder = (
  po: PurchaseOrder,
  existing?: Partial<SupplierPayableDocument> | null,
): SupplierPayableDocument => {
  const committedAmount = calculatePurchaseOrderCommittedAmount(po);
  const recognizedAmount = calculatePurchaseOrderRecognizedAmount(po);
  const paidAmount = money(existing?.paidAmount || 0);
  const creditAmount = money(existing?.creditAmount || 0);
  const outstandingAmount = Math.max(0, money(recognizedAmount - paidAmount - creditAmount));
  const now = new Date().toISOString();

  return {
    id: existing?.id || newId(),
    code: existing?.code || `AP-${po.poNumber || po.id}`,
    projectId: po.projectId || null,
    constructionSiteId: po.constructionSiteId || null,
    supplierId: po.vendorId || null,
    supplierNameSnapshot: po.vendorName || po.vendorId || 'Nhà cung cấp',
    sourceType: 'purchase_order',
    sourceId: po.id,
    documentNo: po.poNumber || po.id,
    documentDate: po.orderDate || po.createdAt?.slice(0, 10) || todayIso(),
    dueDate: po.expectedDeliveryDate || null,
    currency: existing?.currency || 'VND',
    committedAmount,
    recognizedAmount,
    paidAmount,
    creditAmount,
    outstandingAmount,
    status: documentStatus(recognizedAmount, paidAmount, creditAmount),
    qrToken: existing?.qrToken || `ap_${po.id}_${newId().replace(/-/g, '').slice(0, 8)}`,
    invoiceNumber: (po as any).invoiceNumber || existing?.invoiceNumber || null,
    invoiceDate: (po as any).invoiceDate || existing?.invoiceDate || null,
    metadata: {
      ...(existing?.metadata || {}),
      sourceMode: po.sourceMode || null,
      targetWarehouseId: po.targetWarehouseId || null,
      receivedTransactionIds: po.receivedTransactionIds || [],
    },
    createdBy: po.createdById || existing?.createdBy || null,
    createdAt: existing?.createdAt || po.createdAt || now,
    updatedAt: now,
  };
};

export const buildSupplierPayableBalances = (
  documents: SupplierPayableDocument[],
  allocations: SupplierPaymentAllocation[] = [],
): SupplierPayableBalance[] => {
  const allocationByDocument = allocations.reduce((map, allocation) => {
    map.set(allocation.payableDocumentId, money((map.get(allocation.payableDocumentId) || 0) + allocationReduction(allocation)));
    return map;
  }, new Map<string, number>());

  const grouped = new Map<string, SupplierPayableBalance>();
  documents.forEach(document => {
    if (document.status === 'cancelled' || document.status === 'reversed') return;
    const supplierId = document.supplierId || '';
    const key = [
      document.projectId || '',
      document.constructionSiteId || '',
      supplierId,
      document.currency || 'VND',
    ].join('|');
    const current = grouped.get(key) || {
      projectId: document.projectId || null,
      constructionSiteId: document.constructionSiteId || null,
      supplierId: document.supplierId || null,
      supplierNameSnapshot: document.supplierNameSnapshot || supplierId || 'Nhà cung cấp',
      currency: document.currency || 'VND',
      recognizedAmount: 0,
      paidAmount: 0,
      creditAmount: 0,
      outstandingAmount: 0,
      documentCount: 0,
      oldestDueDate: null,
      latestDocumentDate: null,
      isOverdue: false,
    };
    const allocationAmount = money(allocationByDocument.get(document.id) || 0);
    const paidAmount = money(numeric(document.paidAmount) + allocationAmount);
    const creditAmount = money(document.creditAmount || 0);
    const outstandingAmount = Math.max(0, money(numeric(document.recognizedAmount) - paidAmount - creditAmount));
    const dueDate = document.dueDate || document.documentDate || null;

    current.recognizedAmount = money(current.recognizedAmount + document.recognizedAmount);
    current.paidAmount = money(current.paidAmount + paidAmount);
    current.creditAmount = money(current.creditAmount + creditAmount);
    current.outstandingAmount = money(current.outstandingAmount + outstandingAmount);
    current.documentCount += 1;
    current.oldestDueDate = !current.oldestDueDate || (dueDate && dueDate < current.oldestDueDate) ? dueDate : current.oldestDueDate;
    current.latestDocumentDate = !current.latestDocumentDate || (document.documentDate && document.documentDate > current.latestDocumentDate)
      ? document.documentDate
      : current.latestDocumentDate;
    current.isOverdue = Boolean(current.isOverdue || (dueDate && dueDate < todayIso() && outstandingAmount > 0));
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount || a.supplierNameSnapshot.localeCompare(b.supplierNameSnapshot));
};

const documentTablePayload = (document: SupplierPayableDocument) => {
  const { paidAmount, outstandingAmount, ...persisted } = document;
  return toDb(compact(persisted));
};

const normalizeDocument = (row: any): SupplierPayableDocument => {
  const mapped = fromDb(row) as SupplierPayableDocument;
  const paidAmount = money((mapped as any).paidAmount ?? (mapped as any).allocatedPaidAmount ?? 0);
  const creditAmount = money(mapped.creditAmount || 0);
  const recognizedAmount = money(mapped.recognizedAmount || 0);
  return {
    ...mapped,
    currency: mapped.currency || 'VND',
    paidAmount,
    creditAmount,
    outstandingAmount: money((mapped as any).outstandingAmount ?? Math.max(0, recognizedAmount - paidAmount - creditAmount)),
    metadata: mapped.metadata || {},
  };
};

export const supplierPayableService = {
  async listDocuments(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierId?: string | null;
    status?: string | null;
  } = {}): Promise<SupplierPayableDocument[]> {
    let query = supabase.from(DOCUMENT_BALANCE_VIEW).select('*').order('document_date', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    if (input.status) query = query.eq('status', input.status);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeDocument);
  },

  async listBalances(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierId?: string | null;
  } = {}): Promise<SupplierPayableBalance[]> {
    let query = supabase.from(BALANCE_VIEW).select('*').order('outstanding_amount', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(row => ({
      ...(fromDb(row) as SupplierPayableBalance),
      currency: row.currency || 'VND',
      recognizedAmount: money(row.recognized_amount),
      paidAmount: money(row.paid_amount),
      creditAmount: money(row.credit_amount),
      outstandingAmount: money(row.outstanding_amount),
      documentCount: Number(row.document_count || 0),
    }));
  },

  async syncFromPurchaseOrder(po: PurchaseOrder): Promise<SupplierPayableDocument> {
    const { data: existingRows, error: existingError } = await supabase
      .from(DOCUMENT_TABLE)
      .select('*')
      .eq('source_type', 'purchase_order')
      .eq('source_id', po.id)
      .limit(1);
    if (existingError && existingError.code !== '42P01') throw existingError;

    const existing = existingRows?.[0] ? normalizeDocument(existingRows[0]) : null;
    const document = buildPayableDocumentFromPurchaseOrder(po, existing);
    const { data, error } = await supabase
      .from(DOCUMENT_TABLE)
      .upsert(documentTablePayload(document), { onConflict: 'source_type,source_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data ? normalizeDocument(data) : document;
  },

  async syncPurchaseOrderById(purchaseOrderId: string): Promise<SupplierPayableDocument> {
    const { data, error } = await supabase.rpc('sync_supplier_payable_from_purchase_order', {
      p_po_id: purchaseOrderId,
    });
    if (error) throw error;
    return normalizeDocument(Array.isArray(data) ? data[0] : data);
  },

  async backfillFromPurchaseOrders(purchaseOrders: PurchaseOrder[]): Promise<SupplierPayableDocument[]> {
    const eligible = purchaseOrders.filter(po => calculatePurchaseOrderRecognizedAmount(po) > 0);
    const documents: SupplierPayableDocument[] = [];
    for (const po of eligible) {
      documents.push(await this.syncFromPurchaseOrder(po));
    }
    return documents;
  },
};
