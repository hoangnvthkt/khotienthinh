// Báo cáo Nhập – Xuất – Tồn theo kho × vật tư (kiểu MISA "Tổng hợp tồn kho").
// Số liệu từ RPC get_inventory_nxt_report_v1; giá trị là tiền đã ghi trên sổ kho.

export type InventoryNxtRow = {
  key: string;
  warehouseId: string;
  warehouseName: string;
  materialId: string;
  sku: string;
  name: string;
  unit: string;
  openingQty: number;
  openingValue: number;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
  /** Số dòng nhập trong kỳ chưa có đơn giá (giá trị nhập đang thiếu). */
  unpricedInLines: number;
  /** Mã còn trên sổ kho nhưng đã xóa khỏi Danh mục vật tư. */
  itemMissing: boolean;
};

export type InventoryNxtTotals = {
  openingValue: number;
  inValue: number;
  outValue: number;
  closingValue: number;
  /** Dòng còn tồn / có nhập nhưng chưa có giá trị → giá trị tồn chưa đủ. */
  missingPriceRows: number;
  negativeRows: number;
};

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const mapNxtRow = (row: any): InventoryNxtRow => ({
  key: `${row.warehouseId}:${row.materialId}`,
  warehouseId: String(row.warehouseId ?? ''),
  warehouseName: String(row.warehouseName ?? row.warehouseId ?? ''),
  materialId: String(row.materialId ?? ''),
  sku: String(row.sku ?? row.materialId ?? ''),
  name: String(row.name ?? row.materialId ?? ''),
  unit: String(row.unit ?? ''),
  openingQty: num(row.openingQty),
  openingValue: num(row.openingValue),
  inQty: num(row.inQty),
  inValue: num(row.inValue),
  outQty: num(row.outQty),
  outValue: num(row.outValue),
  closingQty: num(row.closingQty),
  closingValue: num(row.closingValue),
  unpricedInLines: num(row.unpricedInLines),
  itemMissing: row.itemMissing === true,
});

export const MISSING_ITEM_LABEL = 'Đã xóa khỏi danh mục';

const QTY_EPS = 0.00005;

/** Có số lượng mà chưa có giá trị: không được hiện "0 ₫" như thể đã biết giá. */
export const isValueMissing = (qty: number, value: number) => Math.abs(qty) >= QTY_EPS && Math.round(value) === 0;

export const rowMissingPrice = (row: InventoryNxtRow) =>
  row.unpricedInLines > 0 || (row.closingQty > QTY_EPS && isValueMissing(row.closingQty, row.closingValue));

export const isNegativeStock = (row: InventoryNxtRow) => row.closingQty < -QTY_EPS;

export const summarizeNxt = (rows: InventoryNxtRow[]): InventoryNxtTotals => rows.reduce<InventoryNxtTotals>(
  (acc, row) => ({
    openingValue: acc.openingValue + row.openingValue,
    inValue: acc.inValue + row.inValue,
    outValue: acc.outValue + row.outValue,
    closingValue: acc.closingValue + row.closingValue,
    missingPriceRows: acc.missingPriceRows + (rowMissingPrice(row) ? 1 : 0),
    negativeRows: acc.negativeRows + (isNegativeStock(row) ? 1 : 0),
  }),
  { openingValue: 0, inValue: 0, outValue: 0, closingValue: 0, missingPriceRows: 0, negativeRows: 0 },
);

/** Cột giống bảng MISA chủ sản phẩm gửi 21/10/2026. */
export const NXT_EXCEL_HEADERS = [
  'Mã hàng',
  'Tên hàng',
  'ĐVT',
  'Đầu kỳ Số lượng',
  'Đầu kỳ Giá trị',
  'Nhập kho Số lượng',
  'Nhập kho Giá trị',
  'Xuất kho Số lượng',
  'Xuất kho Giá trị',
  'Cuối kỳ Số lượng',
  'Cuối kỳ Giá trị',
  'Tên kho',
] as const;

export const buildNxtExcelRows = (rows: InventoryNxtRow[]): Array<Array<string | number>> => rows.map(row => [
  row.sku,
  row.itemMissing ? MISSING_ITEM_LABEL : row.name,
  row.unit,
  row.openingQty,
  Math.round(row.openingValue),
  row.inQty,
  Math.round(row.inValue),
  row.outQty,
  Math.round(row.outValue),
  row.closingQty,
  Math.round(row.closingValue),
  row.warehouseName,
]);
