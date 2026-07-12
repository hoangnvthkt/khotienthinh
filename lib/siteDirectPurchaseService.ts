import type {
  SiteDirectPurchase,
  SiteDirectPurchaseLine,
  SiteDirectPurchaseLineStatus,
  SiteDirectPurchaseStatus,
  ProjectSubmissionTarget,
  SupplierPayableDocument,
  Transaction,
} from '../types';
import { TransactionStatus, TransactionType } from '../types';
import { fromDb, toDb } from './dbMapping';
import { siteSmallToolService } from './siteSmallToolService';
import { supabase } from './supabase';

const PURCHASE_TABLE = 'site_direct_purchases';
const LINE_TABLE = 'site_direct_purchase_lines';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isMissingDirectPurchaseTable = (error: any): boolean =>
  error?.code === '42P01'
  || String(error?.message || '').includes(PURCHASE_TABLE)
  || String(error?.message || '').includes(LINE_TABLE);

const isMissingSubmissionTargetColumn = (error: any): boolean =>
  error?.code === '42703'
  || ['submitted_to_user_id', 'submitted_to_name', 'submitted_to_permission', 'submission_note', 'ever_submitted', 'last_action_by', 'last_action_at']
    .some(column => String(error?.message || '').includes(column) || String(error?.details || '').includes(column));

const compactObject = <T extends Record<string, any>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;

const completedWmsStatuses = new Set<string>([
  TransactionStatus.COMPLETED,
  TransactionStatus.LEGACY_COMPLETED,
  'completed',
]);

export const calculateSiteDirectPurchaseTotals = (lines: SiteDirectPurchaseLine[]) => {
  const grossAmount = money(lines.reduce((sum, line) => sum + numeric(line.quantity) * numeric(line.unitPrice), 0));
  const vatAmount = money(lines.reduce((sum, line) => {
    const lineAmount = numeric(line.quantity) * numeric(line.unitPrice);
    return sum + lineAmount * numeric(line.vatRate) / 100;
  }, 0));
  return {
    grossAmount,
    vatAmount,
    totalAmount: money(grossAmount + vatAmount),
  };
};

export const canRecognizeSiteDirectPurchaseLine = (
  line: SiteDirectPurchaseLine,
  context: { wmsStatus?: string | null; financeAccepted?: boolean },
) => {
  if (line.status === 'rejected') return false;
  if (line.lineType === 'expense_only' || line.lineType === 'small_tool') return Boolean(context.financeAccepted);
  return context.wmsStatus === 'completed' && Boolean(context.financeAccepted);
};

const normalizePurchase = (row: any): SiteDirectPurchase => ({
  ...(fromDb(row) as SiteDirectPurchase),
  grossAmount: money(row.gross_amount),
  vatAmount: money(row.vat_amount),
  totalAmount: money(row.total_amount),
  attachments: row.attachments || [],
  everSubmitted: Boolean(row.ever_submitted ?? row.everSubmitted ?? false),
  note: row.note || null,
});

const normalizeLine = (row: any): SiteDirectPurchaseLine => ({
  ...(fromDb(row) as SiteDirectPurchaseLine),
  quantity: numeric(row.quantity),
  unitPrice: money(row.unit_price),
  vatRate: numeric(row.vat_rate),
  lineAmount: money(row.line_amount),
  vatAmount: money(row.vat_amount),
  acceptedQuantity: numeric(row.accepted_quantity),
  acceptedAmount: money(row.accepted_amount),
});

const normalizePayableDocument = (row: any): SupplierPayableDocument => {
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

const buildLinePayload = (line: SiteDirectPurchaseLine) => toDb({
  ...line,
  lineAmount: money(numeric(line.quantity) * numeric(line.unitPrice)),
  vatAmount: money(numeric(line.quantity) * numeric(line.unitPrice) * numeric(line.vatRate) / 100),
});

export const siteDirectPurchaseService = {
  async upsert(input: SiteDirectPurchase, lines: SiteDirectPurchaseLine[] = []): Promise<SiteDirectPurchase> {
    const totals = calculateSiteDirectPurchaseTotals(lines.length > 0 ? lines : input.lines || []);
    const { data: existingPurchase, error: existingError } = await supabase
      .from(PURCHASE_TABLE)
      .select('id')
      .eq('id', input.id)
      .maybeSingle();
    if (existingError && existingError.code !== 'PGRST116') throw existingError;
    const isNewPurchase = !existingPurchase?.id;

    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .upsert(toDb({ ...input, ...totals }), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;

    if (lines.length > 0) {
      const { error: lineError } = await supabase
        .from(LINE_TABLE)
        .upsert(lines.map(line => buildLinePayload({
          ...line,
          directPurchaseId: line.directPurchaseId || input.id,
        })), { onConflict: 'id' });
      if (lineError) {
        if (isNewPurchase) {
          const { error: rollbackError } = await supabase
            .from(PURCHASE_TABLE)
            .delete()
            .eq('id', input.id);
          if (rollbackError) console.warn('Failed to rollback direct purchase header after line upsert error', rollbackError);
        }
        throw lineError;
      }
    }

    return normalizePurchase(data);
  },

  async list(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierId?: string | null;
    status?: string | null;
  } = {}): Promise<SiteDirectPurchase[]> {
    let query = supabase.from(PURCHASE_TABLE).select('*').order('purchase_date', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    if (input.status) query = query.eq('status', input.status);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizePurchase);
  },

  async getDetail(id: string): Promise<{ purchase: SiteDirectPurchase; lines: SiteDirectPurchaseLine[] }> {
    const { data: purchaseRow, error: purchaseError } = await supabase
      .from(PURCHASE_TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (purchaseError) throw purchaseError;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('direct_purchase_id', id)
      .order('line_no', { ascending: true });
    if (lineError) {
      if (isMissingDirectPurchaseTable(lineError)) return { purchase: normalizePurchase(purchaseRow), lines: [] };
      throw lineError;
    }

    const lines = (lineRows || []).map(normalizeLine);
    return {
      purchase: {
        ...normalizePurchase(purchaseRow),
        lines,
      },
      lines,
    };
  },

  async deleteDraft(id: string): Promise<void> {
    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .delete()
      .eq('id', id)
      .in('status', ['draft', 'cancelled'])
      .select('id');
    if (error) throw error;
    if ((data || []).length === 0) throw new Error('Chỉ xoá được phiếu mua nóng còn nháp hoặc đã huỷ.');
  },

  async deleteUnsubmitted(id: string): Promise<void> {
    const { data: purchase, error: readError } = await supabase
      .from(PURCHASE_TABLE)
      .select('id,status,ever_submitted,wms_transaction_id,site_cash_settlement_id,po_id')
      .eq('id', id)
      .single();
    if (readError) throw readError;
    const status = String(purchase?.status || '');
    if (purchase?.ever_submitted || ['submitted', 'approved_to_buy'].includes(status)) {
      throw new Error('Phiếu mua nóng đã gửi duyệt, không được xoá. Hãy hủy duyệt/hủy nghiệp vụ nếu cần giữ lịch sử.');
    }
    if (['finance_review', 'reconciled', 'closed'].includes(status)) {
      throw new Error('Phiếu mua nóng đã phát sinh kiểm tra tài chính/AP, không thể xoá.');
    }
    if (purchase?.wms_transaction_id || purchase?.site_cash_settlement_id || purchase?.po_id) {
      throw new Error('Phiếu mua nóng đã có chứng từ phát sinh sau, không thể xoá.');
    }
    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if ((data || []).length === 0) throw new Error('Không tìm thấy phiếu mua nóng để xoá.');
  },

  async setStatus(id: string, status: SiteDirectPurchaseStatus, patch: Partial<SiteDirectPurchase> = {}): Promise<SiteDirectPurchase> {
    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .update(toDb(compactObject({ ...patch, status })))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizePurchase(data);
  },

  async submit(id: string, target?: ProjectSubmissionTarget | null, actorId?: string | null): Promise<SiteDirectPurchase> {
    if (!target) return this.setStatus(id, 'submitted');
    try {
      return await this.setStatus(id, 'submitted', {
        submittedToUserId: target.userId || null,
        submittedToName: target.name || null,
        submittedToPermission: target.permissionCode || 'approve',
        submissionNote: target.note || null,
        everSubmitted: true,
        lastActionBy: actorId || null,
        lastActionAt: new Date().toISOString(),
      });
    } catch (error) {
      if (isMissingSubmissionTargetColumn(error)) return this.setStatus(id, 'submitted');
      throw error;
    }
  },

  async approveToBuy(id: string): Promise<SiteDirectPurchase> {
    return this.setStatus(id, 'approved_to_buy');
  },

  async cancelApproval(id: string, reason?: string | null, actorId?: string | null): Promise<SiteDirectPurchase> {
    return this.setStatus(id, 'submitted', {
      submittedToPermission: 'approve',
      lastActionBy: actorId || null,
      lastActionAt: new Date().toISOString(),
      note: reason?.trim() ? `Hủy duyệt: ${reason.trim()}` : undefined,
    });
  },

  async markPurchased(id: string, patch: Partial<SiteDirectPurchase> = {}): Promise<SiteDirectPurchase> {
    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .update(toDb({
        ...patch,
        status: 'purchased',
      }))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizePurchase(data);
  },

  async reviewLines(
    id: string,
    reviews: Array<{
      lineId: string;
      status: SiteDirectPurchaseLineStatus;
      acceptedQuantity?: number;
      acceptedAmount?: number;
      reviewNote?: string | null;
      rejectionReason?: string | null;
    }>,
  ): Promise<{ purchase: SiteDirectPurchase; lines: SiteDirectPurchaseLine[] }> {
    for (const review of reviews) {
      const payload = toDb({
        status: review.status,
        acceptedQuantity: review.status === 'rejected' ? 0 : numeric(review.acceptedQuantity),
        acceptedAmount: review.status === 'rejected' ? 0 : money(review.acceptedAmount),
        rejectionReason: review.status === 'rejected' ? review.rejectionReason || review.reviewNote || 'Không được duyệt' : null,
        note: review.reviewNote || null,
      });
      const { error } = await supabase
        .from(LINE_TABLE)
        .update(payload)
        .eq('id', review.lineId)
        .eq('direct_purchase_id', id);
      if (error) throw error;
    }
    return this.getDetail(id);
  },

  async linkWmsImport(id: string, transactionId: string): Promise<SiteDirectPurchase> {
    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .update(toDb({ wmsTransactionId: transactionId, status: 'purchased' }))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizePurchase(data);
  },

  async syncSmallTools(id: string) {
    return siteSmallToolService.syncFromSiteDirectPurchase(id);
  },

  async createWmsImportDraft(id: string, actorId: string): Promise<Transaction> {
    const { purchase, lines } = await this.getDetail(id);
    const stockLines = lines.filter(line => line.lineType === 'stock_item' && line.status !== 'rejected' && numeric(line.quantity) > 0);
    if (stockLines.length === 0) throw new Error('Phiếu mua nóng không có dòng vật tư tồn kho cần nhập WMS.');
    if (!purchase.targetWarehouseId) throw new Error('Chọn kho nhận trước khi tạo phiếu nhập WMS.');

    const transaction: Transaction = {
      id: `tx-site-direct-${Date.now()}-${newId().slice(0, 8)}`,
      type: TransactionType.IMPORT,
      date: new Date().toISOString(),
      items: stockLines.map(line => ({
        itemId: line.itemId || '',
        quantity: numeric(line.quantity),
        price: money(line.unitPrice),
        accountingQty: numeric(line.quantity),
        accountingUnit: line.unitSnapshot || undefined,
        accountingPrice: money(line.unitPrice),
      })).filter(item => item.itemId && item.quantity > 0),
      targetWarehouseId: purchase.targetWarehouseId,
      supplierId: purchase.supplierId || undefined,
      requesterId: actorId,
      createdBy: actorId,
      approverId: actorId,
      status: TransactionStatus.PENDING,
      relatedRequestId: `direct-purchase:${id}`,
      note: `Mua nóng ${purchase.code} - ${purchase.supplierNameSnapshot}`,
    };

    if (transaction.items.length === 0) throw new Error('Dòng vật tư tồn kho chưa liên kết mã vật tư WMS.');

    const { error: txError } = await supabase
      .from('transactions')
      .insert({
        id: transaction.id,
        type: transaction.type,
        date: transaction.date,
        items: transaction.items,
        target_warehouse_id: transaction.targetWarehouseId,
        supplier_id: transaction.supplierId,
        requester_id: transaction.requesterId,
        created_by: transaction.createdBy,
        approver_id: transaction.approverId,
        status: transaction.status,
        note: transaction.note,
        related_request_id: transaction.relatedRequestId,
      });
    if (txError) throw txError;

    await this.linkWmsImport(id, transaction.id);
    return transaction;
  },

  async syncPayable(id: string): Promise<SupplierPayableDocument> {
    const { purchase, lines } = await this.getDetail(id);
    const stockLines = lines.filter(line => line.lineType === 'stock_item' && line.status !== 'rejected');
    const smallToolLines = lines.filter(line => line.lineType === 'small_tool' && (line.status === 'accepted' || line.status === 'adjusted'));
    const acceptedLines = lines.filter(line => line.status === 'accepted' || line.status === 'adjusted');
    if (acceptedLines.length === 0) throw new Error('Chưa có dòng mua nóng được duyệt để ghi nhận AP.');

    if (stockLines.length > 0) {
      if (!purchase.wmsTransactionId) throw new Error('WMS import chưa hoàn tất cho phiếu mua nóng vật tư tồn kho.');
      const { data: txRow, error: txError } = await supabase
        .from('transactions')
        .select('id,status')
        .eq('id', purchase.wmsTransactionId)
        .single();
      if (txError) throw txError;
      if (!completedWmsStatuses.has(String(txRow?.status || ''))) {
        throw new Error('WMS import chưa hoàn tất cho phiếu mua nóng vật tư tồn kho.');
      }
    }

    if (smallToolLines.length > 0) {
      await this.syncSmallTools(id);
    }

    const { data, error } = await supabase.rpc('sync_supplier_payable_from_site_direct_purchase', {
      p_direct_purchase_id: id,
    });
    if (error) throw error;
    return normalizePayableDocument(Array.isArray(data) ? data[0] : data);
  },
};
