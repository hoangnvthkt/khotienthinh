import { TransactionStatus, type Transaction } from '../types';

// Số thực nhận đang nhập dở của phiếu chờ duyệt: giữ trong phiên trình duyệt để đóng/mở lại phiếu, chuyển màn,
// hay dữ liệu tải lại không làm mất số đã gõ (mất số → bấm duyệt ghi đủ số phiếu, ca PO-272 13/10/2026).

export interface ReceiptDraft {
  quantities: Record<number, { quantity: string; reason: string }>;
  shortPlan: 'continue' | 'close' | null;
  arrivalDate: string | null;
}

const key = (transactionId: string) => `vioo:receipt-draft:${transactionId}`;

export const readReceiptDraft = (tx: Pick<Transaction, 'id' | 'status' | 'items'>): ReceiptDraft | null => {
  if (tx.status !== TransactionStatus.PENDING) return null;
  try {
    const raw = window.sessionStorage.getItem(key(tx.id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReceiptDraft & { lines?: number };
    if (parsed.lines !== tx.items.length || !parsed.quantities) return null;
    return { quantities: parsed.quantities, shortPlan: parsed.shortPlan ?? null, arrivalDate: parsed.arrivalDate ?? null };
  } catch {
    return null;
  }
};

/** Lưu khi người dùng đã sửa so với số phiếu; bằng số phiếu thì xoá (không có gì để khôi phục). */
export const writeReceiptDraft = (tx: Pick<Transaction, 'id' | 'items'>, draft: ReceiptDraft, defaultArrivalDate: string) => {
  const edited = tx.items.some((item, index) => {
    const line = draft.quantities[index];
    return !!line && (line.quantity !== String(item.quantity ?? '').replace('.', ',') || line.reason.trim() !== (item.varianceReason || ''));
  }) || !!draft.shortPlan || (!!draft.arrivalDate && draft.arrivalDate !== defaultArrivalDate);
  try {
    if (edited) window.sessionStorage.setItem(key(tx.id), JSON.stringify({ ...draft, lines: tx.items.length }));
    else window.sessionStorage.removeItem(key(tx.id));
  } catch {
    // Trình duyệt chặn lưu (chế độ riêng tư): bỏ qua, phiếu vẫn dùng được.
  }
};

export const clearReceiptDraft = (transactionId: string) => {
  try { window.sessionStorage.removeItem(key(transactionId)); } catch { /* bỏ qua */ }
};
