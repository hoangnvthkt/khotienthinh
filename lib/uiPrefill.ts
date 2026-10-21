// Dùng chung cho các gợi ý in mờ ("Như hôm qua", "Như đơn trước"): nhãn nguồn ngắn.
/** "11/10" từ "2026-10-11" (hoặc chuỗi ISO dài hơn). */
export const shortDate = (value: string) => {
  const [y, m, d] = String(value || '').slice(0, 10).split('-');
  return y && m && d ? `${Number(d)}/${Number(m)}` : value;
};
