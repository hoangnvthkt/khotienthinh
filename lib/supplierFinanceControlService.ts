import type {
  SupplierFinanceControlSnapshot,
  SupplierInvoice,
  SupplierInvoicePayableLink,
  SupplierInvoiceReceiptAllocation,
} from '../types';
import { fromDb } from './dbMapping';
import { mapErpCompletionCommandError } from './erpCompletionRollout';
import { supabase } from './supabase';
import { validateSupplierInvoiceMatch } from './supplierFinanceMatching';

export interface SupplierInvoiceReceiptCandidate {
  deliveryLineId: string;
  deliveryBatchId: string;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  itemId: string;
  acceptedQty: number;
  unit: string;
  receiptUnitPrice: number;
  invoicedToDate: number;
  uninvoicedQty: number;
  vatRate: number;
}

export interface SupplierInvoiceMatchingCandidates {
  documents: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    documentNo: string;
    currency: string;
    recognizedAmount: number;
    creditAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    invoicedToDate: number;
    uninvoicedAmount: number;
  }>;
  receiptLines: SupplierInvoiceReceiptCandidate[];
}

const normalizeInvoice = (row: any): SupplierInvoice => ({
  ...(fromDb(row) as SupplierInvoice),
  netAmount: Number(row?.net_amount ?? row?.netAmount),
  vatAmount: Number(row?.vat_amount ?? row?.vatAmount),
  grossAmount: Number(row?.gross_amount ?? row?.grossAmount),
  currency: String(row?.currency || 'VND'),
  status: row?.status || 'posted',
  matchingVersion: Number(row?.matching_version ?? row?.matchingVersion ?? 1),
  rowVersion: Number(row?.row_version ?? row?.rowVersion ?? 1),
  attachments: Array.isArray(row?.attachments) ? row.attachments : [],
});

const normalizeSnapshot = (data: any): SupplierFinanceControlSnapshot => {
  if (!data || !Array.isArray(data.layers)) throw new Error('Dữ liệu kiểm soát tài chính không hợp lệ.');
  return {
    asOf: String(data.asOf || data.as_of || ''),
    projectId: data.projectId ?? data.project_id ?? null,
    constructionSiteId: data.constructionSiteId ?? data.construction_site_id ?? null,
    authoritative: Boolean(data.authoritative),
    issues: Array.isArray(data.issues) ? data.issues.map(String) : [],
    layers: data.layers.map((layer: any) => ({
      layer: layer.layer,
      amount: layer.amount == null ? null : Number(layer.amount),
      currency: String(layer.currency || 'VND'),
      completeness: layer.completeness,
      source: String(layer.source || ''),
      documentCount: Number(layer.documentCount ?? layer.document_count ?? 0),
      issues: Array.isArray(layer.issues) ? layer.issues.map(String) : [],
    })),
  };
};

export const supplierFinanceControlService = {
  async getInvoiceCandidates(input: { projectId?: string | null; constructionSiteId?: string | null; supplierId: string }): Promise<SupplierInvoiceMatchingCandidates> {
    const { data, error } = await supabase.rpc('get_supplier_invoice_matching_candidates_v1', {
      p_project_id: input.projectId || null,
      p_construction_site_id: input.constructionSiteId || null,
      p_supplier_id: input.supplierId,
    });
    if (error) throw error;
    return {
      documents: (data?.documents || []).map((row: any) => ({
        id: String(row.id), sourceType: String(row.source_type), sourceId: String(row.source_id),
        documentNo: String(row.document_no), currency: String(row.currency || 'VND'),
        recognizedAmount: Number(row.recognized_amount), creditAmount: Number(row.credit_amount),
        paidAmount: Number(row.paid_amount), outstandingAmount: Number(row.outstanding_amount),
        invoicedToDate: Number(row.invoiced_to_date), uninvoicedAmount: Number(row.uninvoiced_amount),
      })),
      receiptLines: (data?.receiptLines || []).map((row: any) => ({
        deliveryLineId: String(row.deliveryLineId), deliveryBatchId: String(row.deliveryBatchId),
        purchaseOrderId: String(row.purchaseOrderId), purchaseOrderLineId: String(row.purchaseOrderLineId),
        itemId: String(row.itemId), acceptedQty: Number(row.acceptedQty), unit: String(row.unit || ''),
        receiptUnitPrice: Number(row.receiptUnitPrice), invoicedToDate: Number(row.invoicedToDate),
        uninvoicedQty: Number(row.uninvoicedQty), vatRate: Number(row.vatRate || 0),
      })),
    };
  },

  async recordInvoiceMatch(input: {
    invoice: Omit<SupplierInvoice, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> & { id?: string };
    payableLinks: SupplierInvoicePayableLink[];
    receiptAllocations: SupplierInvoiceReceiptAllocation[];
    idempotencyKey: string;
  }): Promise<SupplierInvoice> {
    validateSupplierInvoiceMatch({
      currency: input.invoice.currency || 'VND',
      netAmount: input.invoice.netAmount,
      vatAmount: input.invoice.vatAmount,
      grossAmount: input.invoice.grossAmount,
      payableLinks: input.payableLinks,
      receiptAllocations: input.receiptAllocations,
    });
    const { data, error } = await supabase.rpc('record_supplier_invoice_reconciliation_v3', {
      p_invoice: input.invoice,
      p_payable_allocations: input.payableLinks,
      p_receipt_allocations: input.receiptAllocations,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapErpCompletionCommandError(error);
    return normalizeInvoice(data?.invoice ?? data);
  },

  async reverseInvoice(input: { invoiceId: string; expectedRowVersion: number; idempotencyKey: string; reason: string }) {
    const { data, error } = await supabase.rpc('reverse_supplier_invoice_v1', {
      p_invoice_id: input.invoiceId,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey,
      p_reason: input.reason,
    });
    if (error) throw mapErpCompletionCommandError(error);
    return normalizeInvoice(data?.invoice ?? data);
  },

  async getSnapshot(input: { projectId?: string | null; constructionSiteId?: string | null; asOf?: string | null }) {
    const { data, error } = await supabase.rpc('get_supplier_finance_control_v1', {
      p_project_id: input.projectId || null,
      p_construction_site_id: input.constructionSiteId || null,
      p_as_of: input.asOf || null,
    });
    if (error) throw error;
    return normalizeSnapshot(data);
  },
};
