import React from 'react';
import { DayPicker } from 'react-day-picker';
import { vi } from 'react-day-picker/locale';
import 'react-day-picker/style.css';

// Calendar theo mẫu shadcn/ui: bọc DayPicker của react-day-picker.
// - Tiếng Việt, tuần bắt đầu theo locale (vi: Thứ Hai).
// - Giữ mô hình bàn phím của lưới ngày: mũi tên = ±1 ngày / ±1 tuần, PageUp/PageDown = ±1 tháng,
//   Shift+PageUp/PageDown = ±1 năm, Home/End = đầu / cuối tuần.
// - Khoảng ngày (mode="range"): hai đầu có modifier range_start / range_end, ngày ở giữa range_middle (tô nhạt).
// Ngày vào / ra là Date 00:00 giờ địa phương; quy đổi với "yyyy-mm-dd" ở lib/center/civilDate (không parse UTC).

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// Tiêu đề tháng dạng số như cách đọc ở công ty: "Tháng 10/2026".
const formatCaption = (month: Date) => `Tháng ${month.getMonth() + 1}/${month.getFullYear()}`;

export const Calendar: React.FC<CalendarProps> = ({ className, formatters, ...props }) => (
  <DayPicker
    locale={vi}
    showOutsideDays
    formatters={{ formatCaption, ...formatters }}
    className={`vcc-calendar${className ? ` ${className}` : ''}`}
    {...props}
  />
);

export default Calendar;
