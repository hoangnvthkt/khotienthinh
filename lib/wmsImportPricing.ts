// Phiếu nhập kho trực tiếp từ NCC (không qua PO): giá và VAT bắt buộc để Tài chính ghi công nợ đúng (K3a-3, 02/10/2026).

export type ImportVatChoice = '' | '0' | '5' | '8' | '10' | 'incl';
export const IMPORT_VAT_OPTIONS: Array<{ value: ImportVatChoice; label: string }> = [
  { value: '', label: 'Chọn VAT' }, { value: '0', label: '0% / không chịu thuế' }, { value: '5', label: '5%' },
  { value: '8', label: '8%' }, { value: '10', label: '10%' }, { value: 'incl', label: 'Giá đã gồm VAT' },
];
// Giá cao hơn giá danh mục quá mức này thì gần như chắc là nhầm đơn vị (giá/tấn nhập vào ô giá/kg…).
export const IMPORT_PRICE_OUTLIER_RATIO = 20;

export interface ImportPricedLine { itemId: string; name: string; unit: string; stockQty: number; unitPrice: number; catalogPrice: number }

export type ImportPricingIssue =
  | { kind: 'vat' }
  | { kind: 'price'; name: string }
  | { kind: 'outlier'; name: string; unit: string; unitPrice: number; catalogPrice: number; ratio: number };

export const findImportPricingIssue = (lines: ImportPricedLine[], vat: ImportVatChoice): ImportPricingIssue | null => {
  if (!vat) return { kind: 'vat' };
  for (const line of lines) {
    if (!(line.unitPrice > 0) || !Number.isFinite(line.unitPrice)) return { kind: 'price', name: line.name };
    if (line.catalogPrice > 0 && line.unitPrice > line.catalogPrice * IMPORT_PRICE_OUTLIER_RATIO) {
      return { kind: 'outlier', name: line.name, unit: line.unit, unitPrice: line.unitPrice, catalogPrice: line.catalogPrice, ratio: Math.round(line.unitPrice / line.catalogPrice) };
    }
  }
  return null;
};

export const vatFields = (vat: ImportVatChoice) => vat === 'incl'
  ? { vatRate: undefined, priceIncludesVat: true }
  : { vatRate: vat === '' ? undefined : Number(vat), priceIncludesVat: false };
