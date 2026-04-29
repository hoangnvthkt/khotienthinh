import { supabase } from './supabase';
import {
  PaymentCertificate, PaymentCertificateItem, PaymentCertificateStatus,
  ContractItemType, ContractItem, AdvancePayment,
} from '../types';
import { contractItemService } from './contractItemService';

// ══════════════════════════════════════════════════════════════
//  PAYMENT CERTIFICATE SERVICE — Thanh toán chuẩn FastCons
//  Công thức: GT TT = Completed − TU − Giữ lại − Phạt − Khấu trừ − Đã TT
// ══════════════════════════════════════════════════════════════

const TABLE = 'payment_certificates';

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

/**
 * Tính GT thanh toán đợt này (công thức FastCons)
 */
export function calculatePayableAmount(cert: {
  totalCompletedValue: number;
  advanceRecovery: number;
  retentionPercent: number;
  penaltyAmount: number;
  deductionAmount: number;
  previousCertifiedAmount: number;
}): { retentionAmount: number; currentPayableAmount: number } {
  const retentionAmount = cert.totalCompletedValue * cert.retentionPercent / 100;
  const currentPayableAmount =
    cert.totalCompletedValue
    - cert.advanceRecovery
    - retentionAmount
    - cert.penaltyAmount
    - cert.deductionAmount
    - cert.previousCertifiedAmount;
  return { retentionAmount, currentPayableAmount: Math.max(0, currentPayableAmount) };
}

/**
 * Tính thu hồi tạm ứng cho 1 đợt thanh toán
 * recovery = min(TU còn lại, GT hoàn thành đợt này × % thu hồi)
 */
export function calculateAdvanceRecovery(
  advances: AdvancePayment[],
  currentCompletedValue: number,
): number {
  let totalRecovery = 0;
  for (const adv of advances) {
    if (adv.status === 'cancelled' || adv.remainingAmount <= 0) continue;
    const recovery = Math.min(
      adv.remainingAmount,
      currentCompletedValue * adv.recoveryPercent / 100,
    );
    totalRecovery += recovery;
  }
  return totalRecovery;
}

export const paymentCertificateService = {
  /** Lấy tất cả đợt TT theo hợp đồng */
  async listByContract(contractId: string, contractType?: ContractItemType): Promise<PaymentCertificate[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .order('period_number', { ascending: true });
    if (contractType) query = query.eq('contract_type', contractType);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Lấy theo site */
  async listBySite(constructionSiteId: string): Promise<PaymentCertificate[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Tạo đợt TT mới — auto fill KL lũy kế */
  async create(
    contractId: string,
    contractType: ContractItemType,
    constructionSiteId: string,
    cert: Partial<PaymentCertificate>,
  ): Promise<PaymentCertificate> {
    // Lấy previous certs
    const prevCerts = await this.listByContract(contractId, contractType);
    const periodNumber = prevCerts.length + 1;
    const previousCertifiedAmount = prevCerts
      .filter(c => c.status === 'approved' || c.status === 'paid')
      .reduce((s, c) => s + c.currentPayableAmount, 0);

    // Lấy BOQ items
    const boqItems = await contractItemService.listByContract(contractId, contractType);
    const totalContractValue = boqItems.reduce((s, i) => s + i.totalPrice, 0);

    // Build items list với KL lũy kế
    const items: PaymentCertificateItem[] = boqItems.map(bi => {
      const prevQty = prevCerts
        .filter(c => c.status === 'approved' || c.status === 'paid')
        .reduce((sum, c) => {
          const pi = c.items.find(i => i.contractItemId === bi.id);
          return sum + (pi ? pi.currentQuantity : 0);
        }, 0);
      return {
        contractItemId: bi.id,
        contractItemCode: bi.code,
        contractItemName: bi.name,
        unit: bi.unit,
        contractQuantity: bi.quantity,
        previousQuantity: prevQty,
        currentQuantity: 0,
        cumulativeQuantity: prevQty,
        unitPrice: bi.unitPrice,
        currentAmount: 0,
        cumulativeAmount: prevQty * bi.unitPrice,
      };
    });

    const newCert: Partial<PaymentCertificate> = {
      contractId,
      contractType,
      constructionSiteId,
      periodNumber,
      periodStart: cert.periodStart || new Date().toISOString().slice(0, 10),
      periodEnd: cert.periodEnd || new Date().toISOString().slice(0, 10),
      description: cert.description || `Thanh toán đợt ${periodNumber}`,
      items,
      totalContractValue,
      totalCompletedValue: 0,
      currentCompletedValue: 0,
      advanceRecovery: 0,
      retentionPercent: cert.retentionPercent ?? 5,
      retentionAmount: 0,
      penaltyAmount: 0,
      deductionAmount: 0,
      previousCertifiedAmount,
      currentPayableAmount: 0,
      status: 'draft',
      note: cert.note,
    };

    const dbItem = toDb(newCert);
    delete dbItem.id;
    const { data, error } = await supabase.from(TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  /** Cập nhật đợt TT (khi nhập KL, phạt, khấu trừ...) */
  async update(id: string, updates: Partial<PaymentCertificate>): Promise<void> {
    // Recalculate computed fields nếu items thay đổi
    if (updates.items) {
      updates.currentCompletedValue = updates.items.reduce((s, i) => s + i.currentAmount, 0);
      updates.totalCompletedValue = updates.items.reduce((s, i) => s + i.cumulativeAmount, 0);

      // Recalculate each item's cumulative
      updates.items = updates.items.map(item => ({
        ...item,
        cumulativeQuantity: item.previousQuantity + item.currentQuantity,
        currentAmount: item.currentQuantity * item.unitPrice,
        cumulativeAmount: (item.previousQuantity + item.currentQuantity) * item.unitPrice,
      }));
    }

    // Recalculate payable
    const { retentionAmount, currentPayableAmount } = calculatePayableAmount({
      totalCompletedValue: updates.totalCompletedValue ?? 0,
      advanceRecovery: updates.advanceRecovery ?? 0,
      retentionPercent: updates.retentionPercent ?? 5,
      penaltyAmount: updates.penaltyAmount ?? 0,
      deductionAmount: updates.deductionAmount ?? 0,
      previousCertifiedAmount: updates.previousCertifiedAmount ?? 0,
    });
    updates.retentionAmount = retentionAmount;
    updates.currentPayableAmount = currentPayableAmount;

    const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
    if (error) throw error;
  },

  /** Chuyển trạng thái */
  async setStatus(id: string, status: PaymentCertificateStatus, userId?: string): Promise<void> {
    const updates: any = { status };
    if (status === 'submitted') { updates.submittedBy = userId; updates.submittedAt = new Date().toISOString(); }
    if (status === 'approved') { updates.approvedBy = userId; updates.approvedAt = new Date().toISOString(); }
    if (status === 'paid') { updates.paidAt = new Date().toISOString(); }
    const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
    if (error) throw error;
  },

  /** Xóa đợt TT (chỉ draft) */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  /** Tổng hợp thanh toán theo HĐ */
  async getPaymentSummary(contractId: string, contractType: ContractItemType) {
    const certs = await this.listByContract(contractId, contractType);
    const boqSummary = await contractItemService.getSummary(contractId, contractType);
    const totalPaid = certs
      .filter(c => c.status === 'paid')
      .reduce((s, c) => s + c.currentPayableAmount, 0);
    const totalApproved = certs
      .filter(c => c.status === 'approved' || c.status === 'paid')
      .reduce((s, c) => s + c.currentPayableAmount, 0);
    return {
      totalContractValue: boqSummary.totalValue,
      totalPaid,
      totalApproved,
      remaining: boqSummary.totalValue - totalApproved,
      paymentPercent: boqSummary.totalValue > 0 ? (totalPaid / boqSummary.totalValue) * 100 : 0,
      certCount: certs.length,
    };
  },
};
