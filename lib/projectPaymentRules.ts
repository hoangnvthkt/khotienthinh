import type {
  AdvancePayment,
  PaymentCertificateAdvanceRecovery,
  PaymentCertificateItem,
} from '../types';

export interface PaymentCalculationInput {
  items: PaymentCertificateItem[];
  advances?: AdvancePayment[];
  retentionPercent: number;
  advanceRecoveryThisPeriod?: number;
  retentionThisPeriod?: number;
  penaltyAmount?: number;
  deductionAmount?: number;
  previousRetentionCumulative?: number;
  previousAdvanceRecoveryCumulative?: number;
}

export interface PaymentCalculationResult {
  items: PaymentCertificateItem[];
  grossThisPeriod: number;
  grossCumulative: number;
  retentionThisPeriod: number;
  retentionCumulative: number;
  advanceRecoveryThisPeriod: number;
  advanceRecoveryCumulative: number;
  payableThisPeriod: number;
  advanceRecoveries: PaymentCertificateAdvanceRecovery[];
  errors: string[];
}

const money = (n: number) => Number.isFinite(n) ? Math.round(n) : 0;
const qty = (n: number) => Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
const percent = (n: number) => Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;

export const getRevisedContractQuantity = (item: PaymentCertificateItem): number => {
  return item.revisedContractQuantity ?? item.contractQuantity ?? 0;
};

export const calculatePaymentItems = (items: PaymentCertificateItem[]): { items: PaymentCertificateItem[]; errors: string[] } => {
  const errors: string[] = [];
  const calculated = items.map(item => {
    const previousQuantity = qty(item.previousQuantity || 0);
    const currentQuantity = qty(item.currentQuantity ?? item.certifiedQuantity ?? 0);
    const cumulativeQuantity = qty(previousQuantity + currentQuantity);
    const revisedQuantity = qty(getRevisedContractQuantity(item));
    const unitPrice = money(item.unitPrice || 0);
    const previousAmount = money(Math.max(0, Number(item.cumulativeAmount || 0) - Number(item.currentAmount || 0)));
    const currentAmount = money(item.currentAmount ?? currentQuantity * unitPrice);
    const cumulativeAmount = money(previousAmount + currentAmount);
    const contractAmount = money(item.contractAmount ?? revisedQuantity * unitPrice);
    const paymentPercent = item.paymentPercent !== undefined
      ? percent(Number(item.paymentPercent || 0))
      : contractAmount > 0 ? percent((currentAmount / contractAmount) * 100) : 0;

    if (currentAmount < 0) {
      errors.push(`${item.contractItemCode || item.contractItemName || item.contractItemId}: giá trị thanh toán kỳ này không được âm.`);
    }
    if (contractAmount > 0 && cumulativeAmount > contractAmount) {
      errors.push(`${item.contractItemCode || item.contractItemName || item.contractItemId}: lũy kế thanh toán ${cumulativeAmount} vượt giá trị hợp đồng ${contractAmount}.`);
    }

    return {
      ...item,
      revisedContractQuantity: revisedQuantity,
      previousQuantity,
      currentQuantity,
      certifiedQuantity: currentQuantity,
      cumulativeQuantity,
      unitPrice,
      contractAmount,
      currentAmount,
      cumulativeAmount,
      paymentPercent,
      sourceAcceptedAmount: money(item.sourceAcceptedAmount || 0),
    };
  });

  return { items: calculated, errors };
};

export const allocateAdvanceRecovery = (
  advances: AdvancePayment[],
  recoveryThisPeriod: number,
): PaymentCertificateAdvanceRecovery[] => {
  const recoveries: PaymentCertificateAdvanceRecovery[] = [];
  let remaining = money(recoveryThisPeriod);

  for (const advance of advances) {
    if (remaining <= 0) break;
    if (advance.status !== 'active' || advance.remainingAmount <= 0) continue;
    const recoveryAmount = money(Math.min(advance.remainingAmount, remaining));
    if (recoveryAmount <= 0) continue;
    remaining -= recoveryAmount;
    recoveries.push({
      paymentCertificateId: '',
      advancePaymentId: advance.id,
      recoveryAmount,
    });
  }

  return recoveries;
};

export const calculatePaymentCertificate = (input: PaymentCalculationInput): PaymentCalculationResult => {
  const { items, errors } = calculatePaymentItems(input.items);
  const grossThisPeriod = money(items.reduce((sum, item) => sum + (item.currentAmount || 0), 0));
  const grossCumulative = money(items.reduce((sum, item) => sum + (item.cumulativeAmount || 0), 0));
  const retentionThisPeriod = money(input.retentionThisPeriod || 0);
  const retentionCumulative = money((input.previousRetentionCumulative || 0) + retentionThisPeriod);
  const requestedAdvanceRecovery = money(input.advanceRecoveryThisPeriod || 0);
  const advanceRecoveries = allocateAdvanceRecovery(input.advances || [], requestedAdvanceRecovery);
  const advanceRecoveryThisPeriod = money(advanceRecoveries.reduce((sum, r) => sum + r.recoveryAmount, 0));
  const advanceRecoveryCumulative = money((input.previousAdvanceRecoveryCumulative || 0) + advanceRecoveryThisPeriod);
  if (requestedAdvanceRecovery > advanceRecoveryThisPeriod) {
    errors.push('Thu hồi tạm ứng kỳ này vượt số tạm ứng còn lại.');
  }
  const payableThisPeriod = money(
    grossThisPeriod
    - retentionThisPeriod
    - advanceRecoveryThisPeriod
    - (input.penaltyAmount || 0)
    - (input.deductionAmount || 0),
  );

  return {
    items,
    grossThisPeriod,
    grossCumulative,
    retentionThisPeriod,
    retentionCumulative,
    advanceRecoveryThisPeriod,
    advanceRecoveryCumulative,
    payableThisPeriod,
    advanceRecoveries,
    errors,
  };
};
