import type {
  SupplierInvoicePayableLink,
  SupplierInvoiceReceiptAllocation,
} from '../types';

const MONEY_SCALE = 100;

const minor = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} không hợp lệ.`);
  const result = Math.round(value * MONEY_SCALE);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} vượt giới hạn chính xác.`);
  return result;
};

export const validateSupplierInvoiceMatch = (input: {
  currency: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  payableLinks: SupplierInvoicePayableLink[];
  receiptAllocations: SupplierInvoiceReceiptAllocation[];
}) => {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Đơn vị tiền tệ không hợp lệ.');
  const net = minor(input.netAmount, 'Tiền trước thuế');
  const vat = minor(input.vatAmount, 'Thuế VAT');
  const gross = minor(input.grossAmount, 'Tổng hóa đơn');
  if (gross <= 0 || net + vat !== gross) throw new Error('Tiền trước thuế cộng VAT phải bằng tổng hóa đơn.');
  if (input.payableLinks.length === 0) throw new Error('Hóa đơn phải phân bổ vào ít nhất một chứng từ AP.');

  const payableIds = new Set<string>();
  let linkGross = 0;
  for (const link of input.payableLinks) {
    if (!link.payableDocumentId || payableIds.has(link.payableDocumentId)) {
      throw new Error('Mỗi chứng từ AP chỉ được phân bổ một lần.');
    }
    payableIds.add(link.payableDocumentId);
    const linkNet = minor(link.allocatedNetAmount ?? 0, 'Tiền trước thuế phân bổ');
    const linkVat = minor(link.allocatedVatAmount ?? 0, 'VAT phân bổ');
    const allocated = minor(link.allocatedGrossAmount, 'Tổng phân bổ AP');
    if (allocated <= 0 || linkNet + linkVat !== allocated) {
      throw new Error('Tiền trước thuế và VAT phân bổ phải bằng tổng phân bổ AP.');
    }
    if (link.currency && link.currency.trim().toUpperCase() !== currency) {
      throw new Error('Đơn vị tiền tệ của AP không khớp hóa đơn.');
    }
    linkGross += allocated;
  }
  if (linkGross !== gross) throw new Error('Tổng phân bổ AP phải bằng tổng hóa đơn.');

  const receiptKeys = new Set<string>();
  const receiptGrossByPayable = new Map<string, number>();
  for (const allocation of input.receiptAllocations) {
    if (!payableIds.has(allocation.payableDocumentId)) {
      throw new Error('Dòng nhận mua phải thuộc chứng từ AP được phân bổ.');
    }
    const key = `${allocation.payableDocumentId}:${allocation.deliveryLineId}`;
    if (!allocation.deliveryLineId || receiptKeys.has(key)) throw new Error('Dòng nhận mua bị trùng.');
    receiptKeys.add(key);
    if (!Number.isFinite(allocation.quantity) || allocation.quantity <= 0 || !allocation.unit.trim()) {
      throw new Error('Số lượng hoặc đơn vị nhận mua không hợp lệ.');
    }
    if (!Number.isFinite(allocation.unitPrice) || allocation.unitPrice < 0) {
      throw new Error('Đơn giá hóa đơn không hợp lệ.');
    }
    if (!allocation.priceSource.trim()) throw new Error('Phân bổ nhận mua thiếu nguồn giá.');
    const receiptNet = minor(allocation.netAmount, 'Tiền trước thuế dòng nhận');
    const receiptVat = minor(allocation.vatAmount, 'VAT dòng nhận');
    const receiptGross = minor(allocation.grossAmount, 'Tổng dòng nhận');
    if (receiptNet + receiptVat !== receiptGross) throw new Error('Giá trị dòng nhận mua không khớp VAT.');
    receiptGrossByPayable.set(
      allocation.payableDocumentId,
      (receiptGrossByPayable.get(allocation.payableDocumentId) || 0) + receiptGross,
    );
  }
  for (const link of input.payableLinks) {
    const receiptGross = receiptGrossByPayable.get(link.payableDocumentId);
    if (receiptGross != null && receiptGross !== minor(link.allocatedGrossAmount, 'Tổng phân bổ AP')) {
      throw new Error('Tổng dòng nhận mua phải bằng phân bổ AP tương ứng.');
    }
  }

  return { currency, grossAmount: gross / MONEY_SCALE };
};
