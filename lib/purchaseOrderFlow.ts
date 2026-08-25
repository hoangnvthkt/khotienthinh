import type { PurchaseOrder } from '../types';

export const isPurchaseOrderFlowV3 = (
  po?: Pick<PurchaseOrder, 'procurementFlowVersion'> | null,
) => po?.procurementFlowVersion === 3;

export const isLegacyRequestPurchasePackage = (
  po?: Pick<PurchaseOrder, 'sourceMode' | 'purchaseMode' | 'procurementFlowVersion'> | null,
) => po?.sourceMode === 'from_request'
  && (po.purchaseMode === 'single' || po.purchaseMode === 'multiple')
  && !isPurchaseOrderFlowV3(po);
