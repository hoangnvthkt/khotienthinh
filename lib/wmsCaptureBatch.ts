import { foldVi } from './wmsCatalogService';
import type { DeliveryCapture } from './wmsDeliveryCaptureService';

// Xấp phiếu (chủ SP 16/10): chọn / chụp nhiều ảnh → mỗi ảnh một phiếu giao, AI đọc từng phiếu,
// ảnh cùng NCC + cùng số phiếu thì gộp thành các trang của một phiếu. Thủ kho tách / gộp lại được.

const key = (s?: string | null) => foldVi(s || '').replace(/[^a-z0-9]/g, '');
// Tên NCC trên các trang có thể bị cắt hoặc viết tắt khác nhau: so phần lõi, bỏ chữ chung.
const LEGAL = /\b(cong ty|cty|tnhh|co phan|cp|mtv|thuong mai|xay dung|dau tu|dich vu|san xuat|tm|xd|dt|dv|sx|va|&)\b/g;
const supplierCore = (s?: string | null) => foldVi(s || '').replace(LEGAL, ' ').replace(/[^a-z0-9]/g, '');
const sameOrEmpty = (a: string, b: string) => !a || !b || a === b;

/** Hai phiếu là các trang của cùng một phiếu giao? Cần cùng số phiếu; NCC, ngày, biển số không được khác nhau.
 *  Bẫy đợt 0: 3 xe khác nhau cùng số biên bản 007/10 → biển số khác thì không gộp. */
export const samePaper = (a: DeliveryCapture, b: DeliveryCapture): boolean => {
  const docA = key(a.docNo); const docB = key(b.docNo);
  if (!docA || docA !== docB) return false;
  const supA = supplierCore(a.supplierName); const supB = supplierCore(b.supplierName);
  const supplierOk = !supA || !supB || supA.includes(supB) || supB.includes(supA);
  return supplierOk && sameOrEmpty(a.docDate || '', b.docDate || '') && sameOrEmpty(key(a.truckNo), key(b.truckNo));
};

/** Cặp gộp theo thứ tự chụp: phiếu sau gộp vào phiếu đầu tiên cùng giấy. Trả [đích, nguồn]. */
export const findMerges = (list: DeliveryCapture[]): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const heads: DeliveryCapture[] = [];
  for (const c of list) {
    const head = heads.find(h => samePaper(h, c));
    if (head) out.push([head.id, c.id]); else heads.push(c);
  }
  return out;
};

/** Chạy việc với số luồng giới hạn (AI đọc ~15 giây/phiếu; 3 luồng để không bị nhà cung cấp AI chặn). */
export const runLimited = async <T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> => {
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next++; await work(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
};
