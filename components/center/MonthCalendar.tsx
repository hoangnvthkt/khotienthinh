import React, { useState } from 'react';
import { Calendar } from './ui/calendar';

// Ô lịch ở đầu Hôm nay: lịch tháng bình thường (chủ SP 09/10 — không lọc việc theo ngày).
// Tiêu đề tháng bên trái, mũi tên đổi tháng bên phải, hôm nay tô đặc. Xem tháng khác thì có nút "Hôm nay" để về.
const MonthCalendar: React.FC<{ now: Date }> = ({ now }) => {
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const away = month.getFullYear() !== now.getFullYear() || month.getMonth() !== now.getMonth();
  return (
    <section className="vcc-monthcal" role="group" aria-label="Lịch" data-away={away || undefined}>
      <Calendar
        className="vcc-monthcal-grid"
        month={month}
        onMonthChange={setMonth}
        today={now}
        showOutsideDays={false}
        fixedWeeks={false}
      />
      {away && (
        <button type="button" className="vcc-monthcal-today" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>
          Về hôm nay
        </button>
      )}
    </section>
  );
};

export default MonthCalendar;
