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

/**
 * So sánh quy cách = so tên mã (khớp app_private.spec_key / catalog_name_key ở máy chủ, doc 13 mục 9.3):
 * bỏ dấu, hoa thường, dấu cách và - _ / ( ) ., coi "x" / "*" / "×" là một, dấu phẩy thập phân là dấu chấm, "ly" = mm.
 */
export const specKey = (value?: string | null): string => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/(\d)\s*ly\b/g, '$1mm').replace(/,/g, '.').replace(/[×*]/g, 'x').replace(/\bly\b/g, 'mm').replace(/[\s\-_/().]+/g, '');

/**
 * Một mã nhiều quy cách (chủ SP 09/10/2026): mã có từ 2 dòng trong chứng từ thì mỗi dòng phải ghi quy cách,
 * và các quy cách khác nhau. Trả về lineId → câu báo lỗi cho các dòng chưa đạt.
 */
export const duplicateItemSpecProblems = (
  lines: ReadonlyArray<{ key: string; itemId?: string | null; specification?: string | null }>,
): Map<string, string> => {
  const byItem = new Map<string, Array<{ key: string; spec: string }>>();
  lines.forEach(line => {
    const itemId = clean(line.itemId);
    if (!itemId) return;
    byItem.set(itemId, [...(byItem.get(itemId) || []), { key: line.key, spec: specKey(line.specification) }]);
  });
  const problems = new Map<string, string>();
  byItem.forEach(group => {
    if (group.length < 2) return;
    group.forEach(row => {
      if (!row.spec) problems.set(row.key, 'Mã này có nhiều dòng — ghi quy cách để phân biệt');
      else if (group.filter(other => other.spec === row.spec).length > 1) problems.set(row.key, 'Trùng quy cách với dòng khác cùng mã');
    });
  });
  return problems;
};
