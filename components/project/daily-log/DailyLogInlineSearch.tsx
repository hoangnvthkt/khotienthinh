import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { normalizeSearch } from '../../../lib/dailyLogSlipRules';

// Ô gõ tìm ngay tại dòng (kiểu "Thêm vật tư" của Mua hàng): gõ → danh sách gợi ý ngay dưới ô,
// ↑/↓/Enter để chọn, Esc để đóng; gần đáy màn hình thì mở lên trên.

export const slipInputCls = 'w-full rounded-lg border border-border bg-background px-2 py-1.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60 sm:text-sm';

export function DailyLogInlineSearch<T>({ label, placeholder, items, text, render, onPick, footer, header, disabled, autoFocus, limit = 40, invalid }: {
  label: string;
  placeholder: string;
  items: T[];
  text: (item: T) => string;
  render: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
  /** Dòng cuối danh sách, vd "Thêm 'xxx' (gõ tay)". */
  footer?: (query: string, close: () => void) => React.ReactNode;
  header?: React.ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  limit?: number;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useRef(`dl-search-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  const list = useMemo(() => {
    const words = normalizeSearch(query.trim()).split(/\s+/).filter(Boolean);
    return items.filter(item => { const hay = normalizeSearch(text(item)); return words.every(word => hay.includes(word)); }).slice(0, limit);
  }, [items, query, text, limit]);
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (item: T) => { onPick(item); close(); };
  return <div className="relative min-w-0">
    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
    <input ref={input} value={query} disabled={disabled} placeholder={placeholder} aria-label={label} role="combobox" aria-expanded={open}
      aria-controls={listId} aria-autocomplete="list" aria-invalid={invalid || undefined}
      onFocus={event => { setUp(window.innerHeight - event.currentTarget.getBoundingClientRect().bottom < 320); setOpen(true); setActive(0); }}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(list.length - 1, index + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
        else if (event.key === 'Enter' && open && list[active]) { event.preventDefault(); pick(list[active]); }
        else if (event.key === 'Escape') close();
      }}
      className={`${slipInputCls} pl-7 ${invalid ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20' : ''}`} />
    {open && <div className={`absolute left-0 z-40 ${up ? 'bottom-full mb-1' : 'top-full mt-1'} w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card text-left shadow-xl`}>
      {header}
      <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
        {list.map((item, index) => <li key={index} role="option" aria-selected={index === active}
          onMouseDown={event => { event.preventDefault(); pick(item); }} onMouseEnter={() => setActive(index)}
          className={`cursor-pointer border-b border-border/60 px-3 py-2 text-sm last:border-0 ${index === active ? 'bg-mint-50 dark:bg-mint-950/40' : ''}`}>{render(item)}</li>)}
        {!list.length && <li className="px-3 py-3 text-sm text-muted-foreground">{query.trim() ? `Không có kết quả cho "${query.trim()}"` : 'Không có mục nào để chọn'}</li>}
      </ul>
      {footer?.(query.trim(), close)}
    </div>}
  </div>;
}
