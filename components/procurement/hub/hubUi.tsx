import React, { useEffect } from 'react';
import { AlertTriangle, Inbox, Loader2, ShieldAlert, X } from 'lucide-react';
import { PROCUREMENT_PO_STATUS_LABELS, type ProcurementPoPayment } from '../../../lib/procurementInboxService';

// Shared pieces of the Mua hàng hub (tiếp nhận, đơn hàng).

export const Badge: React.FC<{ className: string; children: React.ReactNode; title?: string }> = ({ className, children, title }) =>
  <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;

export const money = (value: number | null | undefined) => value == null || Number.isNaN(value)
  ? '' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value));

export const StateBox: React.FC<{ kind: 'loading' | 'error' | 'denied' | 'empty'; title?: string; message?: string; onRetry?: () => void }> = ({ kind, title, message, onRetry }) => {
  const Icon = kind === 'loading' ? Loader2 : kind === 'denied' ? ShieldAlert : kind === 'error' ? AlertTriangle : Inbox;
  const heading = title || { loading: 'Đang tải…', error: 'Chưa tải được dữ liệu', denied: 'Bạn chưa có quyền vào Mua hàng', empty: 'Không có dữ liệu khớp bộ lọc' }[kind];
  return <div role={kind === 'error' ? 'alert' : undefined} className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
    <Icon size={26} className={`mx-auto ${kind === 'loading' ? 'animate-spin text-teal-600' : kind === 'empty' ? 'text-muted-foreground' : 'text-amber-600'}`} />
    <p className="mt-3 font-semibold text-foreground">{heading}</p>
    {message && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{message}</p>}
    {onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">Thử lại</button>}
  </div>;
};

const PO_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  sent: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  returned: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  confirmed: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-900',
  in_transit: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900',
  partial: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900',
  delivered: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  closed: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
};

export const PoStatusChip: React.FC<{ status: string }> = ({ status }) =>
  <Badge className={PO_STATUS_STYLE[status] || PO_STATUS_STYLE.closed}>{PROCUREMENT_PO_STATUS_LABELS[status] || status}</Badge>;

/** Tình trạng thanh toán PO cho Mua hàng: chưa / một phần / đủ, quá hạn nhấp nháy. Không hiện khi PO chưa phát sinh nợ. */
export const PoPaymentChip: React.FC<{ payment?: ProcurementPoPayment | null }> = ({ payment: p }) => {
  if (!p || p.status === 'none') return null;
  if (p.status === 'paid') return <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200">Đã thanh toán</Badge>;
  const label = p.status === 'partial' ? 'TT một phần' : 'Chưa thanh toán';
  return <>
    <Badge className={p.overdue ? 'overdue-blink border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}
      title={`Còn nợ ${money(p.outstanding)} đ${p.nextDue ? ` · hạn ${p.nextDue.split('-').reverse().join('/')}` : ''}`}>{p.overdue ? `${label} · quá hạn` : label}</Badge>
    {p.inRequest > 0.5 && <Badge className="border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200" title={`${money(p.inRequest)} đ đang trong đề nghị chi`}>Đang đề nghị chi</Badge>}
  </>;
};

/** Right-hand drawer on desktop, full screen on phones. Escape closes. */
export const Drawer: React.FC<{ label: string; wide?: boolean; onClose: () => void; header: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }> = ({ label, wide, onClose, header, footer, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={label}>
    <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-slate-950/40" />
    <aside className={`relative flex h-full w-full flex-col bg-background shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <header className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="min-w-0 flex-1">{header}</div>
        <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 md:px-6">{footer}</footer>}
    </aside>
  </div>;
};

export const inputCls = 'rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/40';
export const primaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
