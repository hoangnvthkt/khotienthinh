import React, { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import { financeService, type FinanceAttachment, type FinanceRouteExtras } from '../../lib/financeService';
import { money } from '../procurement/hub/hubUi';

// Quy ước màu FastCons: dữ liệu có id màu xanh ngọc, số liệu xanh lá, cam/đỏ chỉ cho cảnh báo.
export const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
export const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';

export const viDate = (d: string | null | undefined) => d ? d.slice(0, 10).split('-').reverse().join('/') : '—';
export const shortMoney = (n: number) => n >= 1e9 ? `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`
  : n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr` : `${money(n)} đ`;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00`) - Date.parse(`${b.slice(0, 10)}T00:00:00`)) / 86400000);
export const parseMoney = (v: string) => { const n = Number(v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
export const moneyInput = (n: number | null | undefined) => n == null ? '' : Math.round(n).toLocaleString('vi-VN');

export type Tone = 'overdue' | 'soon' | 'later' | 'none' | 'settled';
export const toneOf = (dueDate: string | null, outstanding: number, today: string): Tone => {
  if (outstanding <= 0) return 'settled';
  if (!dueDate) return 'none';
  const left = daysBetween(dueDate, today);
  return left < 0 ? 'overdue' : left <= 7 ? 'soon' : 'later';
};
export const TONE_TEXT: Record<Tone, string> = {
  overdue: 'text-rose-700 dark:text-rose-300', soon: 'text-amber-700 dark:text-amber-300', later: 'text-muted-foreground',
  none: 'text-slate-500 dark:text-slate-400', settled: 'text-leaf-700 dark:text-leaf-300',
};
export const TONE_BAR: Record<Tone, string> = {
  overdue: 'border-l-rose-500', soon: 'border-l-amber-400', later: 'border-l-leaf-500', none: 'border-l-slate-300', settled: 'border-l-leaf-300',
};
export const dueText = (dueDate: string | null, outstanding: number, today: string) => {
  if (outstanding <= 0) return 'Đã trả đủ';
  if (!dueDate) return 'Chưa có hạn';
  const left = daysBetween(dueDate, today);
  return left < 0 ? `Quá hạn ${-left} ngày` : left === 0 ? 'Đến hạn hôm nay' : `Còn ${left} ngày`;
};

export const Kpi: React.FC<{ active: boolean; onClick: () => void; icon: React.ElementType; label: string; value: string; hint: string; tone: string; blink?: boolean }> =
  ({ active, onClick, icon: Icon, label, value, hint, tone, blink }) =>
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon size={14} className={tone} />{label}</span>
      <span className={`mt-1.5 block text-xl font-bold tabular-nums ${tone} ${blink ? 'overdue-blink' : ''}`}>{value}</span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </button>;

/** Pick files, upload to the private finance bucket, list them with remove. */
export const AttachmentPicker: React.FC<{ supplierId: string; value: FinanceAttachment[]; onChange: (v: FinanceAttachment[]) => void; label: string; required?: boolean; disabled?: boolean }> =
  ({ supplierId, value, onChange, label, required, disabled }) => {
    const ref = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return <div className="text-xs font-semibold text-muted-foreground">
      {label}{required && <span className="text-rose-600"> *</span>}
      <div className="mt-1 space-y-1">
        {value.map(a => <div key={a.path} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 font-normal">
          <FileText size={14} className="text-teal-700" />
          <button type="button" onClick={() => void financeService.openAttachment(a.path)} className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline">{a.name}</button>
          {!disabled && <button type="button" aria-label={`Bỏ ${a.name}`} onClick={() => onChange(value.filter(x => x.path !== a.path))} className="rounded p-0.5 hover:bg-muted"><X size={14} /></button>}
        </div>)}
        {!disabled && <button type="button" disabled={busy} onClick={() => ref.current?.click()}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-sm font-normal hover:bg-muted ${required && value.length === 0 ? 'border-amber-400' : 'border-border'}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}{busy ? 'Đang tải lên…' : 'Chọn tệp (ảnh, PDF, Excel)'}</button>}
        <input ref={ref} type="file" multiple hidden accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx"
          onChange={async e => {
            const files = Array.from(e.target.files || []); e.target.value = '';
            if (!files.length) return;
            setBusy(true); setError(null);
            try { onChange([...value, ...await financeService.upload(supplierId, files)]); }
            catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
          }} />
        {error && <p role="alert" className="font-normal text-rose-700">{error}</p>}
      </div>
    </div>;
  };

/** Vì sao luồng duyệt có bước thêm: khoản mục vượt ngân sách, quỹ dự án âm; dự án chưa chốt đầu kỳ quỹ thì chưa xét. */
export const RouteExtrasNote: React.FC<{ route?: FinanceRouteExtras | null }> = ({ route }) => {
  if (!route) return null;
  const over = route.budgetOver || []; const short = route.fundShort || []; const unknown = route.fundUnknown || [];
  if (!over.length && !short.length && !unknown.length) return null;
  return <ul className="mt-2 space-y-1 text-xs">
    {over.map((o, i) => <li key={`o${i}`} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <b>{o.projectCode} · {o.item} vượt ngân sách:</b> sau khoản này {shortMoney(o.projected)} / ngân sách {shortMoney(o.budget)} → thêm bước "Duyệt vượt ngân sách".</li>)}
    {short.map((s, i) => <li key={`s${i}`} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
      <b>Quỹ dự án {s.projectCode} không đủ:</b> còn {shortMoney(s.balance)}{s.pending > 0.5 ? `, đang duyệt / chờ chi ${shortMoney(s.pending)}` : ''} → sau khoản này âm {shortMoney(-s.after)}. Thêm bước "Cấp vốn dự án"; chi xong phần thiếu tự ghi là vốn công ty cấp.</li>)}
    {unknown.length > 0 && <li className="text-muted-foreground">{unknown.join(', ')} chưa chốt đầu kỳ quỹ dự án — chưa xét được bước cấp vốn.</li>}
  </ul>;
};

export const FieldError: React.FC<{ error: string | null }> = ({ error }) => error
  ? <p role="alert" className="mr-auto text-sm text-rose-700 dark:text-rose-300">{error}</p> : null;

/** Chọn tài khoản tiền (tiền ra / vào từ đâu) — bắt buộc khi xác nhận chi / thu từ mốc 01/10. */
export const CashAccountSelect: React.FC<{ value: string; onChange: (id: string) => void; label?: string; required?: boolean; hint?: string }> = ({ value, onChange, label = 'Tài khoản tiền', required = true, hint }) => {
  const [accounts, setAccounts] = React.useState<import('../../lib/financeService').CashAccountOption[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { financeService.cashAccounts().then(setAccounts).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  return <label className="block text-sm font-medium">{label}{required && <span className="text-rose-600"> *</span>}
    {error ? <span className="mt-1 block text-xs text-rose-700">{error}</span>
      : accounts && accounts.length === 0 ? <span className="mt-1 block rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Chưa khai tài khoản tiền nào — khai ở Tài chính → Thu chi & quỹ trước.</span>
        : <select value={value} onChange={e => onChange(e.target.value)} disabled={!accounts} className={`mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm ${required && !value ? 'border-amber-400' : 'border-border'}`}>
          <option value="">{accounts ? 'Chọn tài khoản…' : 'Đang tải…'}</option>
          {(accounts || []).map(a => <option key={a.id} value={a.id}>{a.name}{a.accountNo ? ` · ${a.accountNo}` : ''} — số dư {money(a.balance)}{a.openingConfirmed ? '' : ' (chưa chốt đầu kỳ)'}</option>)}</select>}
    {hint && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{hint}</span>}
  </label>;
};
