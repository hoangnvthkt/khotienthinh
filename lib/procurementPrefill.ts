// Gợi ý in mờ khi lập đơn (chủ SP 11–12/10/2026): theo đơn trước cùng NCC. Đo 120 ngày: 59% đơn có NCC đã mua,
// trong đó VAT giống 74%, hình thức giao 88%; 33% dòng từng mua từ NCC đó — giá y hệt 52%, lệch ≤ 5%: 63%.
import type { ProcurementVendorPrefill, ProcurementVendorPrefillLine, ProcurementVendorPrefillOrder } from './procurementInboxService';
import { specKey } from './materialLineDescription';
import { shortDate } from './uiPrefill';
import { recordSuggestionEvent } from './uiSuggestionEvents';

/** Giá lệch quá mức này so với lần trước thì báo cam. */
export const PRICE_DEVIATION_WARN_PERCENT = 5;

/** "PO-621 (8/10)" */
export const prefillSourceLabel = (source: Pick<ProcurementVendorPrefillOrder, 'poNumber' | 'orderDate'>) =>
  `${source.poNumber || 'đơn trước'} (${shortDate(source.orderDate || '')})`;

/**
 * Dòng mua gần nhất của NCC cho vật tư: đúng quy cách đang gõ; ô quy cách còn trống thì lấy dòng mới nhất của mã
 * (kèm quy cách của nó). Quy cách khác hẳn thì không gợi ý giá — mỗi quy cách một giá.
 */
export const matchPrefillLine = (lines: ProcurementVendorPrefillLine[], itemId: string, specification: string): ProcurementVendorPrefillLine | null => {
  const mine = lines.filter(line => line.itemId === itemId);
  if (!mine.length) return null;
  const key = specKey(specification);
  if (!key) return mine[0];
  return mine.find(line => specKey(line.specification) === key) || null;
};

/** % lệch của giá đang gõ so với giá lần trước (dương = đắt hơn); null khi không so được. */
export const priceDeviationPercent = (typed: number | null, last: number | null | undefined) => {
  if (typed == null || Number.isNaN(typed) || !last || last <= 0) return null;
  return Math.round(((typed - last) / last) * 1000) / 10;
};

const fmt = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });

/** Dòng chữ mờ cho ô đơn giá: "1.250.000" + nguồn, kèm đơn vị mua lần trước. */
export const priceGhost = (line: ProcurementVendorPrefillLine) => ({
  text: fmt(line.unitPrice),
  value: String(line.unitPrice),
  title: `Theo ${prefillSourceLabel(line)}${line.unit ? ` · /${line.unit}` : ''}`,
});

export const specGhost = (line: ProcurementVendorPrefillLine) => line.specification.trim()
  ? { text: line.specification.trim(), value: line.specification.trim(), title: `Theo ${prefillSourceLabel(line)}` }
  : null;

/** Dòng mô tả gợi ý đầu đơn, chỉ những ô khác với đơn đang lập; rỗng = không có gì để gợi ý. */
export const headerGhostRows = (order: ProcurementVendorPrefillOrder, current: {
  vat: string; mode: 'single' | 'multiple';
  /** Tên dự án / kho của đơn trước theo danh sách màn đang có; null = không gợi ý ô đó. */
  projectName?: string | null; warehouseName?: string | null;
  projectId?: string; warehouseId?: string;
  /** Đơn gom nhiều dự án không có ô hình thức giao. */
  allowMode?: boolean;
}) => {
  const rows: string[] = [];
  if (order.vatRate != null && String(order.vatRate) !== current.vat) rows.push(`VAT ${order.vatRate}%`);
  if (current.allowMode !== false && order.purchaseMode && order.purchaseMode !== current.mode) rows.push(order.purchaseMode === 'multiple' ? 'Giao nhiều đợt' : 'Giao 1 lần');
  if (current.projectName && order.projectId && order.projectId !== current.projectId) rows.push(`Dự án ${current.projectName}`);
  if (current.warehouseName && order.targetWarehouseId && order.targetWarehouseId !== current.warehouseId) rows.push(`Kho nhận ${current.warehouseName}`);
  return rows;
};

/** Tổng kết lúc lưu để đo: số dòng có gợi ý và số dòng giữ nguyên giá / quy cách gợi ý. */
export const prefillOutcome = (prefill: ProcurementVendorPrefill | null, lines: Array<{ itemId: string; specification: string; price: number | null }>) => {
  const result = { price: { suggested: 0, accepted: 0 }, spec: { suggested: 0, accepted: 0 } };
  if (!prefill) return result;
  lines.forEach(line => {
    const exact = matchPrefillLine(prefill.lines, line.itemId, line.specification);
    const any = prefill.lines.find(candidate => candidate.itemId === line.itemId) || null;
    if (any?.specification.trim()) {
      result.spec.suggested += 1;
      if (specKey(any.specification) === specKey(line.specification)) result.spec.accepted += 1;
    }
    const priced = exact || any;
    if (priced && priced.unitPrice > 0) {
      result.price.suggested += 1;
      if (line.price != null && Math.abs(line.price - priced.unitPrice) < 0.005) result.price.accepted += 1;
    }
  });
  return result;
};

/** Ghi đo lúc lưu đơn mới: mỗi nhóm ô một dòng (giá, quy cách) — giữ nguyên hết / sửa một phần / không dùng. */
export const recordPrefillOutcome = (prefill: ProcurementVendorPrefill | null, lines: Array<{ itemId: string; specification: string; price: number | null }>, source: Record<string, unknown>) => {
  const outcome = prefillOutcome(prefill, lines);
  (['price', 'spec'] as const).forEach(field => {
    const { suggested, accepted } = outcome[field];
    if (!suggested) return;
    recordSuggestionEvent({ screen: 'purchase_order', field, outcome: accepted === suggested ? 'accepted' : accepted ? 'edited' : 'dismissed', suggested, accepted, source });
  });
};
