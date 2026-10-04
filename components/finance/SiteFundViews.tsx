import React, { useMemo, useState } from 'react';
import { Camera, Check, FileText, Loader2, Plus, RotateCcw, Send, X } from 'lucide-react';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceAttachment, type FinanceSiteExpense, type FinanceSiteFund, type FinanceSiteFunds } from '../../lib/financeService';
import { Badge, Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, moneyInput, parseMoney, shortMoney, viDate } from './financeUi';

// Quỹ công trường: người giữ quỹ (CHT) ghi từng khoản chi kèm ảnh hóa đơn; kế toán duyệt / trả lại từng khoản ở Thu chi & quỹ.

export const SITE_STATUS: Record<FinanceSiteExpense['status'], { label: string; cls: string }> = {
  submitted: { label: 'Chờ duyệt', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  approved: { label: 'Đã duyệt', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  rejected: { label: 'Bị trả lại', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  withdrawn: { label: 'Đã rút', cls: 'border-border bg-muted text-muted-foreground' },
  reversed: { label: 'Đã đảo', cls: 'border-border bg-muted text-muted-foreground' },
};

/** Số dư quỹ: dương = người giữ quỹ đang cầm tiền; âm = công ty đang nợ người giữ quỹ. */
export const FundBalance: React.FC<{ fund: FinanceSiteFund }> = ({ fund }) => <dl className="grid grid-cols-3 gap-2 text-sm">
  <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">{fund.balance < -0.5 ? 'Công ty đang nợ' : 'Đang giữ'}</dt>
    <dd className={fund.balance < -0.5 ? 'font-semibold tabular-nums text-amber-700' : NUM}>{shortMoney(Math.abs(fund.balance))}</dd></div>
  <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">Chờ duyệt</dt><dd className={fund.pending > 0.5 ? 'font-semibold tabular-nums text-amber-700' : 'font-semibold tabular-nums text-muted-foreground'}>{shortMoney(fund.pending)}</dd></div>
  <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">Đã được cấp</dt><dd className={NUM}>{shortMoney(fund.received)}</dd></div>
</dl>;

export const SiteExpenseDrawer: React.FC<{ data: FinanceSiteFunds; fund: FinanceSiteFund; expense?: FinanceSiteExpense | null; onClose: () => void; onSaved: (m: string) => void }> = ({ data, fund, expense, onClose, onSaved }) => {
  const [date, setDate] = useState(expense?.date || data.today); const [desc, setDesc] = useState(expense?.description || ''); const [party, setParty] = useState(expense?.counterparty || '');
  const [item, setItem] = useState(expense?.costItemId || data.items.find(i => i.symbol === 'CPK')?.id || ''); const [amount, setAmount] = useState(expense ? moneyInput(expense.amount) : '');
  const [files, setFiles] = useState<FinanceAttachment[]>(expense?.attachments || []); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const amt = parseMoney(amount) || 0;
  const blockers = [!desc.trim() && 'Nhập nội dung', !(amt > 0) && 'Nhập số tiền', !item && 'Chọn khoản mục', date > data.today && 'Ngày không được sau hôm nay'].filter(Boolean) as string[];
  const save = async () => { setBusy(true); setErr(null);
    try { await financeService.saveSiteExpense({ id: expense?.id, expectedRowVersion: expense?.rowVersion, accountId: fund.id, spentDate: date, description: desc.trim(), counterparty: party.trim() || undefined, costItemId: item, amount: amt, attachments: files });
      onSaved(expense ? 'Đã gửi lại — chờ kế toán duyệt.' : 'Đã ghi khoản chi — chờ kế toán duyệt.'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <Drawer label="Khoản chi quỹ công trường" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{expense ? `Sửa và gửi lại ${expense.code}` : 'Khoản chi từ quỹ công trường'}</p>
      <h2 className={`text-lg ${ENT}`}>{fund.name}</h2><p className="text-sm text-muted-foreground">Chụp hóa đơn / phiếu chi đính kèm. Kế toán kiểm rồi duyệt; khoản thiếu chứng từ có thể bị trả lại.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{expense ? 'Gửi lại' : 'Gửi duyệt'}</button></>}>
    {expense?.status === 'rejected' && expense.decisionNote && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"><b>Bị trả lại:</b> {expense.decisionNote}</p>}
    <label className="block text-sm font-medium">Nội dung chi<input value={desc} onChange={e => setDesc(e.target.value)} placeholder="VD: Thuê cẩu 25T nửa ngày" className={`mt-1 w-full ${inputCls}`} /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm font-medium">Số tiền<input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => amount && setAmount(moneyInput(amt))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Ngày chi<input type="date" value={date} max={data.today} min={data.cutoverDate} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    <label className="block text-sm font-medium">Khoản mục chi phí<select value={item} onChange={e => setItem(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
      {data.items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.symbol})</option>)}</select></label>
    <label className="block text-sm font-medium">Chi cho ai<input value={party} onChange={e => setParty(e.target.value)} placeholder="VD: Cửa hàng Hùng Cường" className={`mt-1 w-full ${inputCls}`} /></label>
    <AttachmentPicker supplierId={`site/${fund.id}`} value={files} onChange={setFiles} label="Ảnh hóa đơn / phiếu chi" />
  </Drawer>;
};

/** Danh sách khoản chi của một quỹ (màn CHT). */
export const SiteExpenseList: React.FC<{ fund: FinanceSiteFund; onEdit: (x: FinanceSiteExpense) => void; onWithdraw: (x: FinanceSiteExpense) => void; busy: boolean }> = ({ fund, onEdit, onWithdraw, busy }) =>
  fund.expenses.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Chưa có khoản chi nào. Bấm "Thêm khoản chi" và chụp hóa đơn.</p>
    : <ul className="divide-y divide-border text-sm">{fund.expenses.map(x => <li key={x.id} className={`py-2.5 ${x.status === 'withdrawn' || x.status === 'reversed' ? 'opacity-60' : ''}`}>
      <p className="flex items-start gap-2"><span className="min-w-0 flex-1"><b>{x.description}</b><span className="block text-xs text-muted-foreground">{viDate(x.date)} · {x.counterparty || '—'} · {x.costItem}</span></span>
        <span className="whitespace-nowrap font-semibold tabular-nums">{money(x.amount)}</span></p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        {x.attachments.length ? <span className="text-teal-700"><Camera size={12} className="mr-0.5 inline" />{x.attachments.length} ảnh</span> : <span className="text-amber-700">chưa có ảnh chứng từ</span>}
        <Badge className={SITE_STATUS[x.status].cls}>{SITE_STATUS[x.status].label}{x.status === 'rejected' && x.decisionNote ? `: ${x.decisionNote}` : x.status === 'reversed' && x.reverseReason ? `: ${x.reverseReason}` : ''}</Badge>
        {x.canEdit && <button type="button" onClick={() => onEdit(x)} className="font-semibold text-teal-700 hover:underline">{x.status === 'rejected' ? 'Bổ sung, gửi lại' : 'Sửa'}</button>}
        {x.canEdit && <button type="button" disabled={busy} onClick={() => onWithdraw(x)} className="font-semibold text-muted-foreground hover:underline">Rút</button>}</p></li>)}</ul>;

/** Kế toán: khoản chi quỹ công trường chờ duyệt (chọn lại khoản mục, duyệt / trả lại) và khoản đã duyệt gần đây (đảo). */
export const SiteFundReview: React.FC<{ data: FinanceSiteFunds; onChanged: () => void }> = ({ data, onChanged }) => {
  const toast = useToast(); const askReason = useReasonConfirm();
  const [items, setItems] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const pending = useMemo(() => data.funds.flatMap(f => f.expenses.filter(x => x.status === 'submitted').map(x => ({ f, x }))), [data]);
  const recent = useMemo(() => data.funds.flatMap(f => f.expenses.filter(x => x.status === 'approved').map(x => ({ f, x }))).slice(0, 12), [data]);
  if (!data.funds.length) return null;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast.success('Quỹ công trường', msg); onChanged(); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } };
  const decidable = pending.filter(p => p.x.canDecide);
  return <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-bold">Quỹ công trường</h3>
      {decidable.length > 1 && <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(() => financeService.decideSiteExpenses({ action: 'approve',
        items: decidable.map(p => ({ id: p.x.id, expectedRowVersion: p.x.rowVersion, costItemId: items[p.x.id] || p.x.costItemId })) }), `Đã duyệt ${decidable.length} khoản.`)}><Check size={15} />Duyệt cả {decidable.length} khoản</button>}</div>
    <ul className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{data.funds.map(f => <li key={f.id} className="rounded-xl border border-border p-3 text-sm">
      <p className="flex items-center gap-2"><b className={`min-w-0 flex-1 truncate ${ENT}`}>{f.name}</b><span className="text-xs text-muted-foreground">{f.projectCode}</span></p>
      <p className="mb-2 text-xs text-muted-foreground">Người giữ: {f.holderName || <span className="font-semibold text-amber-700">chưa gắn tài khoản người dùng — sửa tài khoản quỹ</span>}</p>
      <FundBalance fund={f} /></li>)}</ul>
    <h4 className="mt-3 text-sm font-semibold">Chờ duyệt ({pending.length})</h4>
    {pending.length === 0 ? <p className="text-sm text-muted-foreground">Không có khoản nào chờ duyệt.</p>
      : <ul className="mt-1 divide-y divide-border text-sm">{pending.map(({ f, x }) => <li key={x.id} className="flex flex-wrap items-center justify-end gap-2 py-2">
        <span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>{x.description}</b> <span className="text-xs text-muted-foreground">{x.code}</span>
          <span className="block text-xs text-muted-foreground">{viDate(x.date)} · {f.projectCode} · {x.createdByName} · {x.counterparty || '—'}{x.submissionNo > 1 ? ` · gửi lại lần ${x.submissionNo}` : ''}</span>
          <span className="mt-0.5 flex flex-wrap gap-2 text-xs">{x.attachments.length ? x.attachments.map(a => <button key={a.path} type="button" onClick={() => void financeService.openAttachment(a.path)} className="font-semibold text-teal-700 hover:underline"><FileText size={12} className="mr-0.5 inline" />{a.name}</button>)
            : <span className="font-semibold text-amber-700">không có chứng từ</span>}</span></span>
        <select value={items[x.id] || x.costItemId} disabled={!x.canDecide} onChange={e => setItems({ ...items, [x.id]: e.target.value })} className={`max-w-[12rem] ${inputCls}`} aria-label="Khoản mục">
          {data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <span className={`w-28 text-right ${NUM}`}>{money(x.amount)}</span>
        {x.canDecide ? <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Trả lại khoản chi', targetName: `${x.code} · ${x.description}`, subtitle: 'CHT bổ sung chứng từ rồi gửi lại, hoặc nộp lại tiền.', reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' });
            if (r) void run(() => financeService.decideSiteExpenses({ action: 'reject', reason: r, items: [{ id: x.id, expectedRowVersion: x.rowVersion }] }), 'Đã trả lại.'); }}><X size={14} />Trả lại</button>
          <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(() => financeService.decideSiteExpenses({ action: 'approve', items: [{ id: x.id, expectedRowVersion: x.rowVersion, costItemId: items[x.id] || x.costItemId }] }), 'Đã duyệt — đã ghi chi phí dự án.')}><Check size={14} />Duyệt</button></>
          : <span className="text-xs text-muted-foreground">người khác người lập và người giữ quỹ duyệt</span>}</li>)}</ul>}
    {recent.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Đã duyệt gần đây ({recent.length})</summary>
      <ul className="mt-1 divide-y divide-border">{recent.map(({ f, x }) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5">
        <span className="min-w-0 flex-1">{x.description} <span className="text-xs text-muted-foreground">{x.code} · {f.projectCode} · {x.costItem} · duyệt: {x.decidedByName}</span></span>
        <span className="tabular-nums">{money(x.amount)}</span>
        {x.canReverse && <button type="button" disabled={busy} className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => { const r = await askReason({ title: 'Đảo khoản chi quỹ công trường', targetName: `${x.code} · ${money(x.amount)} đ`, subtitle: 'Ghi ngược sổ thu chi và chi phí dự án, không xóa.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
          if (r) void run(() => financeService.decideSiteExpenses({ action: 'reverse', reason: r, items: [{ id: x.id, expectedRowVersion: x.rowVersion }] }), 'Đã đảo.'); }}><RotateCcw size={12} className="mr-0.5 inline" />Đảo</button>}</li>)}</ul></details>}
    <p className="mt-2 text-xs text-muted-foreground">Duyệt = trừ tiền quỹ công trường (sổ thu chi) + ghi chi phí dự án theo khoản mục; quỹ dự án không trừ lại (đã trừ lúc cấp quỹ). Cấp thêm quỹ / CHT nộp lại tiền: dùng "Chuyển tiền" ở sổ thu chi.</p>
  </section>;
};

export const SiteFundHolderHeader: React.FC<{ fund: FinanceSiteFund; onAdd: () => void }> = ({ fund, onAdd }) => <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fund.projectCode}</p>
  <h2 className={`text-lg ${ENT}`}>{fund.name}</h2>
  <div className="mt-2"><FundBalance fund={fund} /></div>
  {fund.balance < -0.5 && <p className="mt-2 text-xs text-amber-800">Bạn đã chi quá số được cấp {shortMoney(-fund.balance)} — công ty sẽ bù ở lần cấp quỹ sau.</p>}
  {fund.active && <button type="button" onClick={onAdd} className={`${primaryBtn} mt-3 w-full justify-center`}><Plus size={15} />Thêm khoản chi</button>}
</section>;

