import React, { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';

// Khung dùng chung của Kho vật tư (V1), cùng style Mua hàng: ô chỉ số bấm được, danh sách trái – chi tiết phải, nút ghim đáy.

export const WARN = 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
export const BAD = 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200';
export const OK = 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200';
export const GREY = 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
export const TEAL = 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200';

export const fmtQty = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
export const dateVi = (s?: string | null) => s ? s.slice(0, 10).split('-').reverse().join('/') : '—';
export const daysBetween = (from?: string | null, to?: string | null) => {
  if (!from || !to) return 0;
  return Math.max(0, Math.floor((new Date(to.slice(0, 10)).getTime() - new Date(from.slice(0, 10)).getTime()) / 86_400_000));
};

export const Tile: React.FC<{ active: boolean; onClick: () => void; icon: React.ElementType; label: string; value: React.ReactNode; hint: React.ReactNode; tone: string; ic: string; blink?: boolean }> =
  ({ active, onClick, icon: Icon, label, value, hint, tone, ic, blink }) =>
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-w-[10.5rem] flex-1 shrink-0 rounded-2xl border bg-card px-3 py-2.5 text-left shadow-sm transition ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'} ${blink ? 'overdue-blink' : ''}`}>
      <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span className={`grid h-6 w-6 place-items-center rounded-lg text-white ${ic}`}><Icon size={13} /></span>{label}</span>
      <span className={`mt-1 block text-xl font-bold tabular-nums ${tone}`}>{value}</span>
      <span className="block truncate text-xs text-muted-foreground">{hint}</span>
    </button>;

/** Danh sách trái – chi tiết phải. Chọn một dòng thì cuộn trang để panel chi tiết (kèm nút ghim đáy) hiện trọn. */
export const Split: React.FC<{ open: boolean; selKey?: string | null; list: React.ReactNode; detail: React.ReactNode; wide?: boolean }> = ({ open, selKey, list, detail, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!selKey || !ref.current) return;
    const top = ref.current.getBoundingClientRect().top;
    if (top > 12) window.scrollBy({ top: top - 12, behavior: 'smooth' });
  }, [selKey]);
  return <div ref={ref} className={`grid grid-cols-[minmax(0,1fr)] gap-3 ${wide ? 'lg:grid-cols-[minmax(0,1fr)_440px]' : 'lg:grid-cols-[400px_minmax(0,1fr)]'}`}>
    <div className={`min-w-0 ${open ? 'hidden lg:block' : ''}`}>{list}</div>
    <div className={`min-w-0 ${open ? '' : 'hidden lg:block'}`}>{detail}</div>
  </div>;
};

export const Panel: React.FC<{ onBack?: () => void; head: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode }> = ({ onBack, head, foot, children }) =>
  <section className="flex min-h-[28rem] flex-col rounded-2xl border border-border bg-card shadow-sm lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-hidden">
    <header className="border-b border-border px-4 py-3">
      {onBack && <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 lg:hidden dark:text-teal-300"><ArrowLeft size={15} />Danh sách</button>}
      {head}
    </header>
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">{children}</div>
    {foot && <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-border bg-card/95 px-4 py-3 backdrop-blur">{foot}</footer>}
  </section>;

export const EmptyPanel: React.FC<{ icon: React.ElementType; title: string; text: React.ReactNode }> = ({ icon: Icon, title, text }) =>
  <section className="grid min-h-[28rem] place-items-center rounded-2xl border border-dashed border-border bg-card px-6 text-center">
    <div><Icon size={26} className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">{title}</p><div className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{text}</div></div>
  </section>;

export const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) =>
  <div className="rounded-xl bg-muted/60 px-3 py-2"><span className="block text-xs text-muted-foreground">{label}</span><span className="text-sm">{children}</span></div>;

export const Section: React.FC<{ title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) =>
  <section><div className="mb-1.5 flex items-center justify-between gap-2"><h3 className="text-sm font-bold">{title}</h3>{right}</div>{children}</section>;
