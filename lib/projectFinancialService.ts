import { supabase } from './supabase';
import { ContractItemType, ProjectFinancialSummary, ProjectTransaction } from '../types';
import { contractItemService } from './contractItemService';
import { paymentCertificateService } from './paymentCertificateService';
import { advancePaymentService } from './advancePaymentService';
import { projectCostItemService } from './projectCostItemService';
import { customerContractService, subcontractorContractService } from './hdService';

// ══════════════════════════════════════════════════════════════
//  PROJECT FINANCIAL SERVICE
//  4 KPI đúng nghiệp vụ xây dựng (theo CodeX Audit):
//
//  KPI 1 — Budget Variance     = Ngân sách - Chi phí thực tế
//  KPI 2 — Contract Margin     = Revised Contract Value - Forecast Final Cost
//  KPI 3 — Certified Revenue   = Giá trị chứng từ approved + paid
//  KPI 4 — Cash Position       = Thu thực nhận - Chi thực tế
// ══════════════════════════════════════════════════════════════

export interface ProjectFinancialKPIs {
  // ── Hợp đồng ──
  originalContractValue: number;       // Giá trị HĐ gốc (Σ HĐ khách hàng không cancelled)
  approvedVariationsValue: number;     // Giá trị phát sinh đã duyệt (revised - original)
  revisedContractValue: number;        // = originalContractValue + approvedVariationsValue
  subcontractValue: number;            // Tổng giá trị HĐ thầu phụ

  // ── KPI 1: Budget Variance ──
  budgetTotal: number;                 // Ngân sách dự toán (từ project_cost_items)
  actualCost: number;                  // Chi phí thực tế (expense transactions)
  budgetVariance: number;              // = budgetTotal - actualCost (dương = tiết kiệm)
  budgetVariancePercent: number;       // %

  // ── KPI 2: Contract Margin (Biên lợi nhuận HĐ) ──
  committedCost: number;               // Chi phí cam kết = subcontract + PO pending/partial
  forecastFinalCost: number;           // = actualCost + committedCost
  contractMargin: number;              // = revisedContractValue - forecastFinalCost
  contractMarginPercent: number;       // %

  // ── KPI 3: Certified Revenue (Doanh thu xác nhận) ──
  totalCertifiedRevenue: number;       // Tổng gross chứng từ approved + paid
  totalPaidRevenue: number;            // Tổng payable chứng từ paid thực sự
  totalRetentionHeld: number;          // Tổng bảo lãnh giữ lại
  totalAdvanceOutstanding: number;     // Tạm ứng còn phải thu hồi
  certificationPercent: number;        // % certified / revisedContractValue

  // ── KPI 4: Cash Position (Vị thế tiền mặt) ──
  cashIn: number;                      // Tổng thu thực nhận (revenue_received)
  cashOut: number;                     // Tổng chi thực tế (expense)
  cashPosition: number;                // = cashIn - cashOut
  cashPositionPercent: number;         // % / revisedContractValue

  // ── Meta ──
  constructionSiteId: string;
  calculatedAt: string;
}

export const projectFinancialService = {
  /**
   * Tính toán đầy đủ 4 KPI tài chính cho 1 công trình.
   * Aggregate từ: contracts, BOQ, payment certs, advances, transactions, cost items, POs.
   */
  async getKPIs(
    constructionSiteId: string,
    transactions: ProjectTransaction[] = [],
  ): Promise<ProjectFinancialKPIs> {
    // ── Load song song tất cả data cần thiết ──
    const [
      customerContracts,
      subContracts,
      txData,
      costSummary,
      poData,
    ] = await Promise.all([
      customerContractService.listBySite(constructionSiteId),
      subcontractorContractService.listBySite(constructionSiteId),
      // Transactions: dùng prop nếu đã có, fallback fetch từ DB
      transactions.length > 0
        ? Promise.resolve(transactions.map(t => ({ type: t.type, amount: t.amount })))
        : supabase
            .from('project_transactions')
            .select('type, amount')
            .eq('construction_site_id', constructionSiteId)
            .then(r => (r.data || []) as { type: string; amount: number }[]),
      projectCostItemService.getSummary(constructionSiteId),
      supabase
        .from('project_purchase_orders')
        .select('total_amount, status')
        .eq('construction_site_id', constructionSiteId)
        .then(r => r.data || []),
    ]);

    // ── Hợp đồng ──
    const activeCustomerContracts = customerContracts.filter(c => c.status !== 'cancelled');
    const originalContractValue = activeCustomerContracts.reduce((s, c) => s + c.value, 0);
    const subcontractValue = subContracts
      .filter(c => c.status !== 'cancelled')
      .reduce((s, c) => s + c.value, 0);

    // Revised value từ BOQ (có variation delta)
    const allBoqItems = await contractItemService.listBySite(constructionSiteId, 'customer');
    const revisedContractValue = allBoqItems.length > 0
      ? allBoqItems.reduce((s, i) => s + (i.revisedTotalPrice ?? i.totalPrice ?? 0), 0)
      : originalContractValue;
    const boqOriginalValue = allBoqItems.reduce((s, i) => s + (i.totalPrice ?? 0), 0);
    const approvedVariationsValue = revisedContractValue - boqOriginalValue;

    // ── KPI 3: Certified Revenue ──
    let totalCertifiedRevenue = 0;
    let totalPaidRevenue = 0;
    let totalRetentionHeld = 0;
    let totalAdvanceOutstanding = 0;

    // Dùng listBySite để lấy tất cả certs của công trình (cross-contract)
    const allCerts = await paymentCertificateService.listBySite(constructionSiteId);
    totalCertifiedRevenue = allCerts
      .filter(c => c.status === 'approved' || c.status === 'paid')
      .reduce((s, c) => s + (c.grossThisPeriod ?? c.currentCompletedValue ?? 0), 0);
    totalPaidRevenue = allCerts
      .filter(c => c.status === 'paid')
      .reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount ?? 0), 0);
    totalRetentionHeld = allCerts
      .filter(c => c.status === 'approved' || c.status === 'paid')
      .reduce((s, c) => s + (c.retentionThisPeriod ?? c.retentionAmount ?? 0), 0);

    for (const contract of activeCustomerContracts) {
      try {
        const advBalance = await advancePaymentService.getBalance(contract.id, 'customer');
        totalAdvanceOutstanding += advBalance.totalRemaining;
      } catch { /* no advances */ }
    }

    const certificationPercent = revisedContractValue > 0
      ? Math.min(100, Math.round((totalCertifiedRevenue / revisedContractValue) * 100))
      : 0;

    // ── KPI 4: Cash Position ──
    const cashIn = txData
      .filter(t => t.type === 'revenue_received')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const cashOut = txData
      .filter(t => t.type === 'expense')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const cashPosition = cashIn - cashOut;
    const cashPositionPercent = revisedContractValue > 0
      ? Math.round((cashPosition / revisedContractValue) * 100)
      : 0;

    // ── KPI 1: Budget Variance ──
    const actualCost = cashOut || costSummary.totalActual;
    // budgetTotal: từ project_cost_items nếu có, fallback về revised value
    const budgetTotal = costSummary.totalBudget > 0
      ? costSummary.totalBudget
      : revisedContractValue;
    const budgetVariance = budgetTotal - actualCost;
    const budgetVariancePercent = budgetTotal > 0
      ? Math.round((budgetVariance / budgetTotal) * 100)
      : 0;

    // ── KPI 2: Contract Margin ──
    const committedPO = (poData as any[])
      .filter(p => ['sent', 'partial'].includes(p.status))
      .reduce((s, p) => s + Number(p.total_amount || 0), 0);
    const committedCost = subcontractValue + committedPO;
    const forecastFinalCost = actualCost + committedCost;
    const contractMargin = revisedContractValue - forecastFinalCost;
    const contractMarginPercent = revisedContractValue > 0
      ? Math.round((contractMargin / revisedContractValue) * 100)
      : 0;

    return {
      originalContractValue,
      approvedVariationsValue,
      revisedContractValue,
      subcontractValue,
      budgetTotal,
      actualCost,
      budgetVariance,
      budgetVariancePercent,
      committedCost,
      forecastFinalCost,
      contractMargin,
      contractMarginPercent,
      totalCertifiedRevenue,
      totalPaidRevenue,
      totalRetentionHeld,
      totalAdvanceOutstanding,
      certificationPercent,
      cashIn,
      cashOut,
      cashPosition,
      cashPositionPercent,
      constructionSiteId,
      calculatedAt: new Date().toISOString(),
    };
  },
};

// ── Backward compatibility: giữ buildFinancialSummary cho các component cũ ──
export const buildFinancialSummary = async (
  constructionSiteId: string,
  transactions: ProjectTransaction[] = [],
): Promise<ProjectFinancialSummary> => {
  const [contractItems, certs, costSummary] = await Promise.all([
    contractItemService.listBySite(constructionSiteId),
    paymentCertificateService.listBySite(constructionSiteId),
    projectCostItemService.getSummary(constructionSiteId),
  ]);

  const originalContractValue = contractItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  const revisedContractValue = contractItems.reduce((sum, item) => sum + (item.revisedTotalPrice ?? item.totalPrice ?? 0), 0);
  const approvedVariationValue = revisedContractValue - originalContractValue;
  const actualCostFromTransactions = transactions.filter(t => t.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const actualCost = actualCostFromTransactions || costSummary.totalActual;
  const cashIn = transactions.filter(t => t.type === 'revenue_received').reduce((sum, tx) => sum + tx.amount, 0);
  const cashOut = transactions.filter(t => t.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const paidRevenue = certs.filter(c => c.status === 'paid').reduce((sum, c) => sum + (c.payableThisPeriod ?? c.currentPayableAmount ?? 0), 0);
  const certifiedRevenue = certs
    .filter(c => c.status === 'approved' || c.status === 'paid')
    .reduce((sum, c) => sum + (c.grossThisPeriod ?? c.currentCompletedValue ?? 0), 0);
  const forecastFinalCost = Math.max(actualCost, costSummary.totalBudget);

  return {
    revisedContractValue,
    approvedVariationValue,
    forecastFinalCost,
    actualCost,
    budgetAmount: costSummary.totalBudget,
    budgetVariance: costSummary.totalBudget - actualCost,
    contractMargin: revisedContractValue - forecastFinalCost,
    certifiedRevenue,
    paidRevenue: paidRevenue || cashIn,
    cashIn,
    cashOut,
    cashPosition: cashIn - cashOut,
  };
};
