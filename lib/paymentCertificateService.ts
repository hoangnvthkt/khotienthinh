import { supabase } from './supabase';
import {
  AdvancePayment,
  ContractItem,
  ContractItemType,
  PaymentCertificate,
  PaymentCertificateAdvanceRecovery,
  PaymentCertificateItem,
  PaymentCertificateStatus,
} from '../types';
import { contractItemService } from './contractItemService';
import { advancePaymentService } from './advancePaymentService';
import { calculatePaymentCertificate } from './projectPaymentRules';
import { fromDb, toDb } from './dbMapping';
import { auditService } from './auditService';
import { approvalService } from './approvalService';
import { User } from '../types';

const TABLE = 'payment_certificates';
const ITEM_TABLE = 'payment_certificate_items';
const ADV_RECOVERY_TABLE = 'payment_certificate_advance_recoveries';

const APPROVED_STATUSES: PaymentCertificateStatus[] = ['approved', 'paid'];
const LOCKED_STATUSES: PaymentCertificateStatus[] = ['approved', 'paid', 'cancelled'];

const normalizeCert = (row: any): PaymentCertificate => {
  const mapped = fromDb(row);
  return {
    ...mapped,
    items: mapped.items || [],
    grossThisPeriod: row.gross_this_period ?? row.current_completed_value ?? mapped.grossThisPeriod ?? 0,
    grossCumulative: row.gross_cumulative ?? row.total_completed_value ?? mapped.grossCumulative ?? 0,
    advanceRecoveryThisPeriod: row.advance_recovery_this_period ?? row.advance_recovery ?? mapped.advanceRecoveryThisPeriod ?? 0,
    retentionThisPeriod: row.retention_this_period ?? row.retention_amount ?? mapped.retentionThisPeriod ?? 0,
    payableThisPeriod: row.payable_this_period ?? row.current_payable_amount ?? mapped.payableThisPeriod ?? 0,
  };
};

const itemFromContract = (item: ContractItem, previousQuantity = 0): PaymentCertificateItem => {
  const revisedQuantity = item.revisedQuantity ?? item.quantity;
  const unitPrice = item.unitPrice || 0;
  return {
    contractItemId: item.id,
    contractItemCode: item.code,
    contractItemName: item.name,
    unit: item.unit,
    contractQuantity: item.quantity,
    revisedContractQuantity: revisedQuantity,
    previousQuantity,
    currentQuantity: 0,
    certifiedQuantity: 0,
    cumulativeQuantity: previousQuantity,
    unitPrice,
    currentAmount: 0,
    cumulativeAmount: previousQuantity * unitPrice,
  };
};

async function fetchItemsByCertIds(certIds: string[]): Promise<Record<string, PaymentCertificateItem[]>> {
  if (certIds.length === 0) return {};
  const { data, error } = await supabase
    .from(ITEM_TABLE)
    .select('*')
    .in('payment_certificate_id', certIds)
    .order('created_at', { ascending: true });
  if (error) {
    // Fresh migrations may not be pushed yet; fall back to JSONB items stored on payment_certificates.
    console.warn('payment_certificate_items not available; using JSONB items fallback', error.message);
    return {};
  }
  return (data || []).reduce<Record<string, PaymentCertificateItem[]>>((acc, row) => {
    const item = fromDb(row) as PaymentCertificateItem;
    const certId = row.payment_certificate_id;
    if (!acc[certId]) acc[certId] = [];
    acc[certId].push(item);
    return acc;
  }, {});
}

async function fetchRecoveries(paymentCertificateId: string): Promise<PaymentCertificateAdvanceRecovery[]> {
  const { data, error } = await supabase
    .from(ADV_RECOVERY_TABLE)
    .select('*')
    .eq('payment_certificate_id', paymentCertificateId);
  if (error) {
    console.warn('payment_certificate_advance_recoveries not available', error.message);
    return [];
  }
  return (data || []).map(fromDb);
}

async function replaceItems(paymentCertificateId: string, items: PaymentCertificateItem[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from(ITEM_TABLE)
    .delete()
    .eq('payment_certificate_id', paymentCertificateId);
  if (deleteError) {
    console.warn('Cannot replace normalized payment items; keeping JSONB only', deleteError.message);
    return;
  }
  if (items.length === 0) return;
  const rows = items.map(item => {
    const dbItem = toDb({ ...item, paymentCertificateId });
    delete dbItem.id;
    return dbItem;
  });
  const { error } = await supabase.from(ITEM_TABLE).insert(rows);
  if (error) throw error;
}

async function replaceAdvanceRecoveries(
  paymentCertificateId: string,
  recoveries: PaymentCertificateAdvanceRecovery[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from(ADV_RECOVERY_TABLE)
    .delete()
    .eq('payment_certificate_id', paymentCertificateId);
  if (deleteError) {
    console.warn('Cannot replace normalized advance recoveries', deleteError.message);
    return;
  }
  if (recoveries.length === 0) return;
  const rows = recoveries.map(recovery => {
    const dbItem = toDb({ ...recovery, paymentCertificateId });
    delete dbItem.id;
    return dbItem;
  });
  const { error } = await supabase.from(ADV_RECOVERY_TABLE).insert(rows);
  if (error) throw error;
}

export function calculatePayableAmount(cert: {
  grossThisPeriod?: number;
  totalCompletedValue?: number;
  advanceRecovery?: number;
  retentionPercent: number;
  penaltyAmount: number;
  deductionAmount: number;
  previousCertifiedAmount?: number;
}): { retentionAmount: number; currentPayableAmount: number } {
  const grossThisPeriod = cert.grossThisPeriod ?? cert.totalCompletedValue ?? 0;
  const retentionAmount = grossThisPeriod * cert.retentionPercent / 100;
  const currentPayableAmount =
    grossThisPeriod
    - (cert.advanceRecovery || 0)
    - retentionAmount
    - cert.penaltyAmount
    - cert.deductionAmount;
  return { retentionAmount, currentPayableAmount };
}

export function calculateAdvanceRecovery(
  advances: AdvancePayment[],
  currentCompletedValue: number,
): number {
  return advances
    .filter(adv => adv.status === 'active' && adv.remainingAmount > 0)
    .reduce((sum, adv) => sum + Math.min(adv.remainingAmount, currentCompletedValue * adv.recoveryPercent / 100), 0);
}

export const paymentCertificateService = {
  async listByContract(contractId: string, contractType?: ContractItemType): Promise<PaymentCertificate[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .order('period_number', { ascending: true });
    if (contractType) query = query.eq('contract_type', contractType);
    const { data, error } = await query;
    if (error) throw error;

    const certs = (data || []).map(normalizeCert);
    const itemMap = await fetchItemsByCertIds(certs.map(c => c.id));
    return certs.map(cert => ({
      ...cert,
      items: itemMap[cert.id] || cert.items || [],
    }));
  },

  async listBySite(constructionSiteId: string): Promise<PaymentCertificate[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const certs = (data || []).map(normalizeCert);
    const itemMap = await fetchItemsByCertIds(certs.map(c => c.id));
    return certs.map(cert => ({
      ...cert,
      items: itemMap[cert.id] || cert.items || [],
    }));
  },

  async create(
    contractId: string,
    contractType: ContractItemType,
    constructionSiteId: string,
    cert: Partial<PaymentCertificate>,
  ): Promise<PaymentCertificate> {
    const prevCerts = await this.listByContract(contractId, contractType);
    const periodNumber = prevCerts.length + 1;
    const approvedCerts = prevCerts.filter(c => APPROVED_STATUSES.includes(c.status));
    const previousCertifiedAmount = approvedCerts.reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount ?? 0), 0);
    const previousRetentionCumulative = approvedCerts.reduce((s, c) => s + (c.retentionThisPeriod ?? c.retentionAmount ?? 0), 0);
    const previousAdvanceRecoveryCumulative = approvedCerts.reduce((s, c) => s + (c.advanceRecoveryThisPeriod ?? c.advanceRecovery ?? 0), 0);

    const boqItems = await contractItemService.listByContract(contractId, contractType);
    const totalContractValue = boqItems.reduce((s, i) => s + (i.revisedTotalPrice ?? i.totalPrice ?? 0), 0);

    // M5: Auto-fill currentQuantity từ nghiệm thu liên kết nếu có acceptanceId
    let acceptanceItemMap = new Map<string, number>();
    if (cert.acceptanceId) {
      const { data: accItems } = await supabase
        .from('quantity_acceptance_items')
        .select('contract_item_id, accepted_quantity')
        .eq('acceptance_id', cert.acceptanceId);
      for (const row of accItems || []) {
        acceptanceItemMap.set(row.contract_item_id, Number(row.accepted_quantity) || 0);
      }
    }

    const items = cert.items && cert.items.length > 0 ? cert.items : boqItems.map(bi => {
      const prevQty = approvedCerts.reduce((sum, c) => {
        const pi = c.items.find(i => i.contractItemId === bi.id);
        return sum + (pi ? pi.currentQuantity : 0);
      }, 0);
      const base = itemFromContract(bi, prevQty);
      // Auto-fill currentQuantity = acceptedQuantity từ nghiệm thu nếu có
      const acceptedQty = acceptanceItemMap.get(bi.id);
      return acceptedQty !== undefined
        ? { ...base, currentQuantity: acceptedQty, certifiedQuantity: acceptedQty, currentAmount: acceptedQty * bi.unitPrice }
        : base;
    });

    const advances = await advancePaymentService.listByContract(contractId, contractType);
    const calculation = calculatePaymentCertificate({
      items,
      advances,
      retentionPercent: cert.retentionPercent ?? 5,
      penaltyAmount: cert.penaltyAmount ?? 0,
      deductionAmount: cert.deductionAmount ?? 0,
      previousRetentionCumulative,
      previousAdvanceRecoveryCumulative,
    });

    const newCert: Partial<PaymentCertificate> = {
      contractId,
      contractType,
      constructionSiteId,
      periodNumber,
      periodStart: cert.periodStart || new Date().toISOString().slice(0, 10),
      periodEnd: cert.periodEnd || new Date().toISOString().slice(0, 10),
      description: cert.description || `Thanh toán đợt ${periodNumber}`,
      acceptanceId: cert.acceptanceId,
      items: calculation.items,
      totalContractValue,
      totalCompletedValue: calculation.grossCumulative,
      currentCompletedValue: calculation.grossThisPeriod,
      grossThisPeriod: calculation.grossThisPeriod,
      grossCumulative: calculation.grossCumulative,
      advanceRecovery: calculation.advanceRecoveryThisPeriod,
      advanceRecoveryThisPeriod: calculation.advanceRecoveryThisPeriod,
      advanceRecoveryCumulative: previousAdvanceRecoveryCumulative,
      retentionPercent: cert.retentionPercent ?? 5,
      retentionAmount: calculation.retentionThisPeriod,
      retentionThisPeriod: calculation.retentionThisPeriod,
      retentionCumulative: previousRetentionCumulative,
      penaltyAmount: cert.penaltyAmount ?? 0,
      deductionAmount: cert.deductionAmount ?? 0,
      previousCertifiedAmount,
      currentPayableAmount: calculation.payableThisPeriod,
      payableThisPeriod: calculation.payableThisPeriod,
      status: 'draft',
      note: cert.note,
    };

    const dbItem = toDb(newCert);
    delete dbItem.id;
    delete dbItem.items; // lưu riêng qua replaceItems(), tránh double-write vào JSONB column
    const { data, error } = await supabase.from(TABLE).insert(dbItem).select().single();
    if (error) throw error;
    await replaceItems(data.id, calculation.items);
    return { ...normalizeCert(data), items: calculation.items };
  },

  async update(id: string, updates: Partial<PaymentCertificate>): Promise<void> {
    const { data: current, error: readError } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (readError) throw readError;
    const currentCert = normalizeCert(current);
    if (LOCKED_STATUSES.includes(currentCert.status)) {
      throw new Error('Chứng từ đã duyệt/thanh toán hoặc đã hủy, không thể chỉnh sửa trực tiếp.');
    }

    const prevCerts = await this.listByContract(currentCert.contractId, currentCert.contractType);
    const approvedBefore = prevCerts.filter(c => c.id !== id && APPROVED_STATUSES.includes(c.status));
    const previousRetentionCumulative = approvedBefore.reduce((s, c) => s + (c.retentionThisPeriod ?? c.retentionAmount ?? 0), 0);
    const previousAdvanceRecoveryCumulative = approvedBefore.reduce((s, c) => s + (c.advanceRecoveryThisPeriod ?? c.advanceRecovery ?? 0), 0);
    const advances = await advancePaymentService.listByContract(currentCert.contractId, currentCert.contractType);

    const itemMap = await fetchItemsByCertIds([id]);
    const baseItems = updates.items || itemMap[id] || currentCert.items || [];
    const calculation = calculatePaymentCertificate({
      items: baseItems,
      advances,
      retentionPercent: updates.retentionPercent ?? currentCert.retentionPercent ?? 5,
      penaltyAmount: updates.penaltyAmount ?? currentCert.penaltyAmount ?? 0,
      deductionAmount: updates.deductionAmount ?? currentCert.deductionAmount ?? 0,
      previousRetentionCumulative,
      previousAdvanceRecoveryCumulative,
    });
    if (calculation.errors.length > 0) throw new Error(calculation.errors[0]);

    const next: Partial<PaymentCertificate> = {
      ...updates,
      items: calculation.items,
      currentCompletedValue: calculation.grossThisPeriod,
      totalCompletedValue: calculation.grossCumulative,
      grossThisPeriod: calculation.grossThisPeriod,
      grossCumulative: calculation.grossCumulative,
      advanceRecovery: calculation.advanceRecoveryThisPeriod,
      advanceRecoveryThisPeriod: calculation.advanceRecoveryThisPeriod,
      advanceRecoveryCumulative: calculation.advanceRecoveryCumulative,
      retentionAmount: calculation.retentionThisPeriod,
      retentionThisPeriod: calculation.retentionThisPeriod,
      retentionCumulative: calculation.retentionCumulative,
      currentPayableAmount: calculation.payableThisPeriod,
      payableThisPeriod: calculation.payableThisPeriod,
    };

    const { error } = await supabase.from(TABLE).update(toDb(next)).eq('id', id);
    if (error) throw error;
    await replaceItems(id, calculation.items);
    await replaceAdvanceRecoveries(id, calculation.advanceRecoveries);
  },

  async setStatus(
    id: string,
    status: PaymentCertificateStatus,
    userId?: string,
    reason?: string,
    options?: { allowZeroOrNegativePayable?: boolean; approverUser?: User },
  ): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (readError) throw readError;
    const cert = normalizeCert(data);
    const itemMap = await fetchItemsByCertIds([id]);
    cert.items = itemMap[id] || cert.items || [];

    if (cert.status === 'cancelled') {
      throw new Error('Chứng từ đã hủy, không thể đổi trạng thái.');
    }
    if (cert.status === 'paid' && status !== 'cancelled') {
      throw new Error('Chứng từ đã thanh toán. Chỉ có thể chuyển sang Hủy để rollback.');
    }
    if ((status === 'approved' || status === 'paid') && (cert.payableThisPeriod ?? cert.currentPayableAmount ?? 0) <= 0 && !options?.allowZeroOrNegativePayable) {
      throw new Error('Giá trị thanh toán kỳ này không dương. Cần chỉnh chứng từ hoặc xác nhận bù trừ riêng.');
    }

    // M3: Guard — khi approve phải có nghiệm thu đã duyệt liên kết
    if (status === 'approved' && cert.acceptanceId) {
      const { data: acceptance, error: accError } = await supabase
        .from('quantity_acceptances')
        .select('status, period_number')
        .eq('id', cert.acceptanceId)
        .single();
      if (accError || !acceptance) {
        throw new Error('Không tìm thấy nghiệm thu liên kết. Vui lòng kiểm tra lại chứng từ.');
      }
      if (acceptance.status !== 'approved') {
        throw new Error(
          `Nghiệm thu đợt ${acceptance.period_number} chưa được duyệt (trạng thái: ${acceptance.status}). ` +
          'Phải duyệt nghiệm thu trước khi duyệt chứng từ thanh toán.',
        );
      }
    }

    // T5: Approval Matrix check — kiểm tra quyền duyệt
    if ((status === 'approved' || status === 'paid' || status === 'cancelled') && options?.approverUser) {
      const approvalAction = status === 'paid' ? 'paid' : 'approve';
      const certAmount = cert.payableThisPeriod ?? cert.currentPayableAmount ?? 0;
      const check = await approvalService.checkApproval({
        module: 'payment_certificate',
        action: approvalAction as any,
        amount: Math.abs(certAmount),
        constructionSiteId: cert.constructionSiteId,
        user: options.approverUser,
      });
      if (!check.allowed) {
        throw new Error(check.reason);
      }
    }

    const updates: any = { status };
    const now = new Date().toISOString();
    if (status === 'submitted') { updates.submittedBy = userId; updates.submittedAt = now; }
    if (status === 'returned') { updates.returnedBy = userId; updates.returnedAt = now; updates.returnReason = reason; }
    if (status === 'approved') { updates.approvedBy = userId; updates.approvedAt = now; }
    if (status === 'paid') { updates.paidAt = now; }
    const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
    if (error) throw error;
    await auditService.log({
      tableName: TABLE,
      recordId: id,
      action: 'UPDATE',
      oldData: { status: cert.status },
      newData: { status },
      userId: userId || 'system',
      userName: userId || 'system',
      description: `Chuyển trạng thái chứng từ thanh toán đợt ${cert.periodNumber}: ${cert.status} -> ${status}`,
    });

    if (status === 'paid') {
      const recoveries = await fetchRecoveries(id);
      await advancePaymentService.applyRecoveries(recoveries);
      await contractItemService.lockItems(cert.items.map(i => i.contractItemId));
    }
    if (status === 'approved') {
      await contractItemService.lockItems(cert.items.map(i => i.contractItemId));
    }

    // Mục 9b: Rollback khi hủy chứng từ đã approved hoặc paid
    if (status === 'cancelled' && (cert.status === 'approved' || cert.status === 'paid')) {
      // Unlock BOQ items — kiểm tra có cert paid khác nào dùng không trước khi unlock
      const otherPaidCerts = await this.listByContract(cert.contractId, cert.contractType);
      const otherPaidItemIds = new Set(
        otherPaidCerts
          .filter(c => c.id !== id && c.status === 'paid')
          .flatMap(c => c.items.map(i => i.contractItemId)),
      );
      const toUnlock = cert.items
        .map(i => i.contractItemId)
        .filter(cid => !otherPaidItemIds.has(cid));
      await contractItemService.unlockItems(toUnlock);

      // Revert advance recoveries nếu đã paid: tính lại từ các cert còn active
      if (cert.status === 'paid') {
        const activeCerts = otherPaidCerts.filter(c => c.id !== id && c.status === 'paid');
        const advanceIds = new Set(
          cert.items.map(i => i.contractItemId),
        );
        // Lấy tất cả advance payments của hợp đồng này
        const advances = await advancePaymentService.listByContract(cert.contractId, cert.contractType);
        for (const adv of advances) {
          // Tính lại total recovered từ các cert paid còn lại
          const { data: remainingRecoveries } = await supabase
            .from('payment_certificate_advance_recoveries')
            .select('recovery_amount')
            .eq('advance_payment_id', adv.id)
            .in('payment_certificate_id', activeCerts.map(c => c.id));
          const newRecovered = (remainingRecoveries || []).reduce(
            (sum, r) => sum + Number(r.recovery_amount || 0), 0,
          );
          await advancePaymentService.updateRecovery(adv.id, newRecovered);
        }
      }
    }
  },

  async remove(id: string): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('status').eq('id', id).single();
    if (readError) throw readError;
    if (data?.status !== 'draft') throw new Error('Chỉ xoá được đợt thanh toán ở trạng thái Nháp.');
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async getPaymentSummary(contractId: string, contractType: ContractItemType) {
    const certs = await this.listByContract(contractId, contractType);
    const boqSummary = await contractItemService.getSummary(contractId, contractType);
    const totalPaid = certs
      .filter(c => c.status === 'paid')
      .reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount), 0);
    const totalApproved = certs
      .filter(c => APPROVED_STATUSES.includes(c.status))
      .reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount), 0);
    const totalRetention = certs
      .filter(c => APPROVED_STATUSES.includes(c.status))
      .reduce((s, c) => s + (c.retentionThisPeriod ?? c.retentionAmount ?? 0), 0);
    return {
      totalContractValue: boqSummary.revisedTotalValue ?? boqSummary.totalValue,
      totalPaid,
      totalApproved,
      totalRetention,
      remaining: (boqSummary.revisedTotalValue ?? boqSummary.totalValue) - totalApproved,
      paymentPercent: boqSummary.totalValue > 0 ? (totalPaid / boqSummary.totalValue) * 100 : 0,
      certCount: certs.length,
    };
  },
};
