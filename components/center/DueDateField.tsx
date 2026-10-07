import React, { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import {
  addCivilDays, civilRange, formatCivilRange, fromCivil, inCivilRange, toCivil, type CivilDate, type CivilRange,
} from '../../lib/center/civilDate';

// Ô "Lịch" ở đầu Hôm nay: chọn một ngày hoặc khoảng ngày (Popover + Calendar, mode="range") để lọc Việc của tôi
// theo hạn. Ngày có việc tới hạn có chấm dưới số. Mọi giá trị là ngày dân sự "yyyy-mm-dd".

const mondayOf = (civil: CivilDate): CivilDate => {
  const day = (fromCivil(civil).getDay() + 6) % 7;
  return addCivilDays(civil, -day);
};

const DueDateField: React.FC<{
  today: CivilDate;
  /** Ngày có việc tới hạn (Chờ tôi). */
  dueDays: CivilDate[];
  value: CivilRange | null;
  onChange: (range: CivilRange | null) => void;
}> = ({ today, dueDays, value, onChange }) => {
  const [open, setOpen] = useState(false);
  // Bản nháp trong lịch: chọn xong bấm "Xem việc" mới lọc.
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const dueDates = useMemo(() => [...new Set(dueDays)].map(fromCivil), [dueDays]);
  const draftRange = draft?.from ? civilRange(toCivil(draft.from), draft.to ? toCivil(draft.to) : null) : null;
  const draftCount = draftRange ? dueDays.filter(day => inCivilRange(day, draftRange)).length : 0;

  const openChange = (next: boolean) => {
    if (next) setDraft(value ? { from: fromCivil(value.from), to: fromCivil(value.to) } : undefined);
    setOpen(next);
  };
  const preset = (range: CivilRange) => setDraft({ from: fromCivil(range.from), to: fromCivil(range.to) });
  const apply = () => { onChange(draftRange); setOpen(false); };

  return (
    <div className="vcc-duefield">
      <Popover open={open} onOpenChange={openChange}>
        <PopoverTrigger asChild>
          <button type="button" className="vcc-datefield" aria-label={value ? `Lọc việc theo hạn: ${formatCivilRange(value)}` : 'Chọn ngày hoặc khoảng ngày để xem việc tới hạn'}>
            <CalendarDays size={14} />
            <span className={value ? 'vcc-datefield-v' : 'vcc-datefield-ph'}>{value ? formatCivilRange(value) : 'Xem việc theo hạn…'}</span>
            <ChevronDown size={13} className="vcc-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label="Chọn ngày">
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            <button type="button" className="vcc-preset" onClick={() => preset({ from: today, to: today })}>Hôm nay</button>
            <button type="button" className="vcc-preset" onClick={() => preset({ from: mondayOf(today), to: addCivilDays(mondayOf(today), 6) })}>Tuần này</button>
            <button type="button" className="vcc-preset" onClick={() => preset({ from: today, to: addCivilDays(today, 6) })}>7 ngày tới</button>
          </div>
          <Calendar
            mode="range"
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.from || fromCivil(today)}
            today={fromCivil(today)}
            modifiers={{ due: dueDates }}
            modifiersClassNames={{ due: 'vcc-day-due' }}
            autoFocus
          />
          <div className="vcc-popover-foot">
            <span className="text-xs vcc-muted" role="status">
              {draftRange ? `${formatCivilRange(draftRange)} · ${draftCount} việc tới hạn` : 'Bấm một ngày, hoặc ngày đầu rồi ngày cuối'}
            </span>
            <span className="flex gap-1.5">
              {value && <button type="button" className="vcc-btn" onClick={() => { onChange(null); setOpen(false); }}>Bỏ lọc</button>}
              <button type="button" className="vcc-btn" data-pri="true" onClick={apply} disabled={!draftRange}>Xem việc</button>
            </span>
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <button type="button" className="vcc-iconbtn vcc-datefield-x" onClick={() => onChange(null)} aria-label="Bỏ lọc theo hạn" title="Bỏ lọc theo hạn">
          <X size={13} />
        </button>
      )}
    </div>
  );
};

export default DueDateField;
