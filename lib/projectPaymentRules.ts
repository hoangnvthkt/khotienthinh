import type {
  AdvancePayment,
  PaymentCertificateAdvanceRecovery,
  PaymentCertificateItem,
} from '../types';

export interface PaymentCalculationInput {
  items: PaymentCertificateItem[];
  advances?: AdvancePayment[];
  retentionPercent: number;
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

    if (currentQuantity < 0) {
      errors.push(`${item.contractItemCode || item.contractItemName || item.contractItemId}: khối lượng kỳ này không được âm.`);
    }
    if (revisedQuantity > 0 && cumulativeQuantity > revisedQuantity) {
      errors.push(`${item.contractItemCode || item.contractItemName || item.contractItemId}: lũy kế ${cumulativeQuantity} vượt khối lượng hợp đồng ${revisedQuantity}.`);
    }

    const unitPrice = money(item.unitPrice || 0);
    return {
      ...item,
      revisedContractQuantity: revisedQuantity,
      previousQuantity,
      currentQuantity,
      certifiedQuantity: currentQuantity,
      cumulativeQuantity,
      unitPrice,
      currentAmount: money(currentQuantity * unitPrice),
      cumulativeAmount: money(cumulativeQuantity * unitPrice),
    };
  });

  return { items: calculated, errors };
};

export const allocateAdvanceRecovery = (
  advances: AdvancePayment[],
  grossThisPeriod: number,
): PaymentCertificateAdvanceRecovery[] => {
  const recoveries: PaymentCertificateAdvanceRecovery[] = [];

  for (const advance of advances) {
    if (advance.status !== 'active' || advance.remainingAmount <= 0) continue;
    const recoveryAmount = money(Math.min(
      advance.remainingAmount,
      grossThisPeriod * (advance.recoveryPercent || 0) / 100,
    ));
    if (recoveryAmount <= 0) continue;
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
  const retentionThisPeriod = money(grossThisPeriod * (input.retentionPercent || 0) / 100);
  const retentionCumulative = money((input.previousRetentionCumulative || 0) + retentionThisPeriod);
  const advanceRecoveries = allocateAdvanceRecovery(input.advances || [], grossThisPeriod);
  const advanceRecoveryThisPeriod = money(advanceRecoveries.reduce((sum, r) => sum + r.recoveryAmount, 0));
  const advanceRecoveryCumulative = money((input.previousAdvanceRecoveryCumulative || 0) + advanceRecoveryThisPeriod);
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
