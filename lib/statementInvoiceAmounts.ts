// Bảng đối soát HĐ NCC: tiền theo hóa đơn thực tế (NCC làm tròn đơn giá / SL lẻ).
// Cùng công thức + dung sai với save_procurement_contract_statement_v1: mỗi dòng tối đa 1.000 đ;
// tổng VAT / cả bảng theo dung sai hóa đơn K3c (0,5%, tối thiểu 50.000 đ).

/** Dung sai làm tròn mỗi dòng (chủ SP 12/10/2026). */
export const LINE_ROUNDING_LIMIT = 1000;

export const invoiceTolerance = (expected: number) => Math.max(Math.round(Math.abs(expected) * 0.005 * 100) / 100, 50000);

export interface StatementCalcLine {
  qty: number;
  price: number;
  vatRate: number;
  /** Tiền hàng theo hóa đơn; null = SL × đơn giá. */
  amount?: number | null;
}

export interface StatementCalc {
  lines: Array<{ computed: number; gross: number; vat: number; delta: number; overLimit: boolean }>;
  computedGross: number;
  computedVat: number;
  gross: number;
  /** VAT cộng từ các dòng (trước khi sửa tổng VAT). */
  lineVat: number;
  vat: number;
  total: number;
  /** Chênh lệch so với SL × đơn giá (tiền hàng + VAT). */
  delta: number;
  overLimit: boolean;
}

export const calcStatement = (lines: StatementCalcLine[], invoiceVat: number | null = null): StatementCalc => {
  const rows = lines.map(l => {
    const computed = Math.round(l.qty * l.price);
    const gross = l.amount ?? computed;
    return {
      computed, gross, vat: Math.round(gross * l.vatRate / 100), computedVat: Math.round(computed * l.vatRate / 100),
      delta: gross - computed, overLimit: l.amount != null && Math.abs(l.amount - computed) > LINE_ROUNDING_LIMIT,
    };
  });
  const sum = (pick: (r: typeof rows[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const computedGross = sum(r => r.computed);
  const computedVat = sum(r => r.computedVat);
  const gross = sum(r => r.gross);
  const lineVat = sum(r => r.vat);
  const vat = invoiceVat ?? lineVat;
  const total = gross + vat;
  const vatTarget = lines.some(l => l.vatRate > 0);
  const overLimit = rows.some(r => r.overLimit)
    || (invoiceVat != null && invoiceVat !== lineVat && !vatTarget)
    || Math.abs(vat - computedVat) > invoiceTolerance(computedVat)
    || Math.abs(total - (computedGross + computedVat)) > invoiceTolerance(computedGross + computedVat);
  return {
    lines: rows.map(({ computed, gross: g, vat: v, delta, overLimit: o }) => ({ computed, gross: g, vat: v, delta, overLimit: o })),
    computedGross, computedVat, gross, lineVat, vat, total, delta: total - (computedGross + computedVat), overLimit,
  };
};
