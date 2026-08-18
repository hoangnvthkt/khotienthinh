import type { InventoryItem, PurchaseOrderItem, RequestItem } from '../types';

type MaterialLineLike = {
  lineId?: string | null;
  itemId?: string | null;
  sku?: string | null;
  skuSnapshot?: string | null;
  name?: string | null;
  itemNameSnapshot?: string | null;
  specification?: string | null;
  materialBudgetItemName?: string | null;
};

const clean = (value?: string | null) => String(value || '').trim();

export const resolveMaterialLineName = (
  line: MaterialLineLike,
  catalogName?: string | null,
): string => (
  clean(line.itemNameSnapshot)
  || clean(line.name)
  || clean(line.materialBudgetItemName)
  || clean(catalogName)
  || clean(line.skuSnapshot)
  || clean(line.sku)
  || clean(line.itemId)
);

export const resolveMaterialLineSpecification = (line: MaterialLineLike): string =>
  clean(line.specification);

export const getMaterialDocumentLineKey = (line: MaterialLineLike, index: number): string => {
  const lineId = clean(line.lineId);
  if (lineId) return `line:${lineId}`;
  return `legacy:${index}:${clean(line.itemId) || clean(line.skuSnapshot) || clean(line.sku) || 'unknown'}`;
};

export const buildPurchaseOrderLineDescription = (
  requestLine: Pick<RequestItem, 'itemId' | 'itemNameSnapshot' | 'materialBudgetItemName' | 'specification'>,
  catalogItem?: Pick<InventoryItem, 'name'>,
): Pick<PurchaseOrderItem, 'name' | 'itemNameSnapshot' | 'specification'> => {
  const itemNameSnapshot = resolveMaterialLineName(requestLine, catalogItem?.name);
  return {
    name: itemNameSnapshot,
    itemNameSnapshot,
    specification: resolveMaterialLineSpecification(requestLine),
  };
};
