import type {
  PurchaseOrder,
  PurchaseOrderDeliveryLine,
  PurchaseOrderItem,
} from '../types';
import { isLegacyRequestPurchasePackage } from './purchaseOrderFlow';

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isRequestPackagePurchaseOrder = (
  po?: Pick<PurchaseOrder, 'sourceMode' | 'purchaseMode' | 'procurementFlowVersion' | 'referenceGrossAmount' | 'items'> | null,
) =>
  isLegacyRequestPurchasePackage(po)
  && numberValue(po.referenceGrossAmount) > 0;

export const getPurchaseOrderScheduleLineUnitPrice = ({
  po,
  item,
  line,
  deliveryUnitPrice,
}: {
  po?: Pick<PurchaseOrder, 'sourceMode' | 'purchaseMode' | 'procurementFlowVersion' | 'referenceGrossAmount' | 'items'> | null;
  item?: Pick<PurchaseOrderItem, 'unitPrice'> | null;
  line?: Pick<PurchaseOrderDeliveryLine, 'deliveryUnitPrice'> | null;
  deliveryUnitPrice?: number | null;
}) => {
  const sourcePrice = deliveryUnitPrice ?? line?.deliveryUnitPrice;
  if (isRequestPackagePurchaseOrder(po)) {
    return numberValue(item?.unitPrice ?? sourcePrice);
  }

  return numberValue(sourcePrice ?? item?.unitPrice);
};
