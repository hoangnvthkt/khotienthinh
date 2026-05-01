import { supabase } from './supabase';
import { AdvancePayment, AdvancePaymentStatus, ContractItemType, PaymentCertificateAdvanceRecovery } from '../types';
import { fromDb, toDb } from './dbMapping';

// ══════════════════════════════════════════════════════════════
//  ADVANCE PAYMENT SERVICE — Quản lý Tạm ứng (FastCons)
//  Công thức thu hồi: recovery = min(TU còn lại, GT × % thu hồi)
// ══════════════════════════════════════════════════════════════

const TABLE = 'advance_payments';


export const advancePaymentService = {
  /** Lấy tất cả tạm ứng theo HĐ */
  async listByContract(contractId: string, contractType?: ContractItemType): Promise<AdvancePayment[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .order('date', { ascending: true });
    if (contractType) query = query.eq('contract_type', contractType);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Lấy theo site */
  async listBySite(constructionSiteId: string): Promise<AdvancePayment[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  /** Tạo tạm ứng mới */
  async create(item: Omit<AdvancePayment, 'id' | 'createdAt' | 'recoveredAmount' | 'remainingAmount' | 'status'>): Promise<AdvancePayment> {
    const dbItem = toDb({
      ...item,
      recoveredAmount: 0,
      remainingAmount: item.amount,
      status: 'active' as AdvancePaymentStatus,
    });
    delete dbItem.id;
    const { data, error } = await supabase.from(TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  /** Cập nhật số tiền đã thu hồi */
  async updateRecovery(id: string, recoveredAmount: number): Promise<void> {
    const { data: current } = await supabase.from(TABLE).select('amount').eq('id', id).single();
    if (!current) throw new Error('Advance payment not found');
    const remaining = current.amount - recoveredAmount;
    const status: AdvancePaymentStatus = remaining <= 0 ? 'fully_recovered' : 'active';
    const { error } = await supabase.from(TABLE).update({
      recovered_amount: recoveredAmount,
      remaining_amount: Math.max(0, remaining),
      status,
    }).eq('id', id);
    if (error) throw error;
  },

  async applyRecoveries(recoveries: PaymentCertificateAdvanceRecovery[]): Promise<void> {
    for (const recovery of recoveries) {
      if (recovery.recoveryAmount <= 0) continue;
      const { data: current, error: readError } = await supabase
        .from(TABLE)
        .select('amount, recovered_amount')
        .eq('id', recovery.advancePaymentId)
        .single();
      if (readError) throw readError;
      if (!current) throw new Error('Advance payment not found');

      const recoveredAmount = Math.min(
        Number(current.amount || 0),
        Number(current.recovered_amount || 0) + recovery.recoveryAmount,
      );
      await this.updateRecovery(recovery.advancePaymentId, recoveredAmount);
    }
  },

  /**
   * Tính tổng thu hồi TU cho 1 đợt thanh toán
   * recovery = min(TU còn lại, GT hoàn thành × % thu hồi)
   */
  async calculateRecovery(contractId: string, contractType: ContractItemType, currentCompletedValue: number): Promise<number> {
    const advances = await this.listByContract(contractId, contractType);
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
  },

  /** Tổng hợp tạm ứng theo HĐ */
  async getBalance(contractId: string, contractType: ContractItemType) {
    const advances = await this.listByContract(contractId, contractType);
    const totalAdvance = advances.filter(a => a.status !== 'cancelled').reduce((s, a) => s + a.amount, 0);
    const totalRecovered = advances.reduce((s, a) => s + a.recoveredAmount, 0);
    const totalRemaining = advances.filter(a => a.status === 'active').reduce((s, a) => s + a.remainingAmount, 0);
    return { totalAdvance, totalRecovered, totalRemaining, count: advances.length };
  },

  /** Hủy tạm ứng */
  async cancel(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
  },

  /** Xóa tạm ứng */
  async remove(id: string): Promise<void> {
    const { data, error: readError } = await supabase
      .from(TABLE)
      .select('status, recovered_amount')
      .eq('id', id)
      .single();
    if (readError) throw readError;
    if (data?.status === 'fully_recovered') {
      throw new Error('Tạm ứng đã thu hồi hoàn tất, không thể xóa. Vui lòng hủy nếu cần.');
    }
    if (data?.recovered_amount > 0) {
      throw new Error('Tạm ứng đã có thu hồi một phần, không thể xóa. Dùng chức năng Hủy thay vì Xóa.');
    }
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};
