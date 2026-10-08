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
