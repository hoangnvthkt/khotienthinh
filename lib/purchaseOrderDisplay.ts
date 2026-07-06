import type { MaterialRequest, PurchaseOrder, PurchaseOrderItem } from '../types';

const cleanText = (value?: string | null) => String(value || '').trim();

const uniqueTexts = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const buildPurchaseOrderMaterialSummary = (
  items: PurchaseOrderItem[] = [],
  maxVisibleItems = 2,
): string => {
  const names = uniqueTexts(items.map(item =>
    cleanText(item.name || item.itemNameSnapshot || item.materialBudgetItemName || item.sku),
  ));
  if (names.length === 0) return 'Chưa có vật tư';
  const visible = names.slice(0, maxVisibleItems).join(', ');
  const hiddenCount = Math.max(0, names.length - maxVisibleItems);
  return hiddenCount > 0 ? `${visible} +${hiddenCount} vật tư` : visible;
};

export const buildPurchaseOrderRequestTitle = (
  po: PurchaseOrder,
  materialRequests: Pick<MaterialRequest, 'id' | 'code' | 'title'>[] = [],
): string => {
  const requestsById = new Map(materialRequests.map(request => [request.id, request]));
  const linkedRequestIds = uniqueTexts((po.items || []).map(item => cleanText(item.requestId)));
  const linkedRequests = linkedRequestIds
    .map(id => requestsById.get(id))
    .filter((request): request is Pick<MaterialRequest, 'id' | 'code' | 'title'> => Boolean(request));

  if (linkedRequests.length > 0) {
    const labels = uniqueTexts(linkedRequests.map(request => {
      const code = cleanText(request.code);
      const title = cleanText(request.title);
      if (code && title) return `${code} - ${title}`;
      return title || code;
    }));
    if (labels.length === 1) return labels[0];
    if (labels.length > 1) return `${labels[0]} +${labels.length - 1} đề xuất`;
  }

  const approvalTitle = cleanText(po.approvalRequestTitle);
  if (approvalTitle) return approvalTitle;

  const requestCodes = uniqueTexts((po.items || []).map(item => cleanText(item.requestCode)));
  if (requestCodes.length === 1) return requestCodes[0];
  if (requestCodes.length > 1) return `${requestCodes[0]} +${requestCodes.length - 1} đề xuất`;

  return buildPurchaseOrderMaterialSummary(po.items);
};

export const buildPurchaseOrderListSummary = (
  po: PurchaseOrder,
  materialRequests: Pick<MaterialRequest, 'id' | 'code' | 'title'>[] = [],
) => ({
  requestTitle: buildPurchaseOrderRequestTitle(po, materialRequests),
  materialSummary: buildPurchaseOrderMaterialSummary(po.items),
});
