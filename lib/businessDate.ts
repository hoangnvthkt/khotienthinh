// Ngày nghiệp vụ (08/10/2026): ngày ghi nhận chọn được, mặc định hôm nay theo giờ Việt Nam.
export const vnToday = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

/** Số ngày lùi so với hôm nay (âm = tương lai). */
export const daysBack = (date: string, today = vnToday()): number =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);

/** Gợi ý dưới ô ngày: lùi quá 7 ngày cần quyền "Nhập dữ liệu quá khứ". */
export const backdateHint = (date: string, today = vnToday()): string | null => {
  if (!date) return null;
  const n = daysBack(date, today);
  if (n < 0) return 'Không chọn ngày sau hôm nay.';
  if (n > 7) return `Lùi ${n} ngày — cần quyền “Nhập dữ liệu quá khứ”.`;
  return null;
};

/** Ngày sớm nhất chọn được khi KHÔNG có quyền "Nhập dữ liệu quá khứ" (lùi tối đa 7 ngày). */
export const earliestBusinessDate = (today = vnToday()): string =>
  new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);

/**
 * Ô ngày nghiệp vụ ở màn lập đơn: nói ngay tại ô, trước khi bấm Lưu.
 * blocked = máy chủ (app_private.assert_business_date) sẽ từ chối, nên chặn luôn ở màn
 * thay vì để người dùng lưu xong mới nhận lỗi và tưởng đơn chưa lưu.
 */
export const businessDateIssue = (
  date: string, canBackdate: boolean, today = vnToday(),
): { blocked: boolean; text: string } | null => {
  if (!date) return null;
  const n = daysBack(date, today);
  if (n < 0) return { blocked: true, text: 'Không chọn ngày sau hôm nay.' };
  if (n > 7) return canBackdate
    ? { blocked: false, text: `Lùi ${n} ngày — sổ sách, công nợ ghi theo ngày này.` }
    : { blocked: true, text: `Lùi ${n} ngày — bạn chưa có quyền “Nhập dữ liệu quá khứ”. Chọn ngày trong 7 ngày gần đây, hoặc nhờ Admin cấp quyền.` };
  return null;
};
