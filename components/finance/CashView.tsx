import React, { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, Check, ClipboardCheck, FileText, Landmark, Pencil, Plus, RotateCcw, Send, Undo2, Wallet, X } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type CashAccount, type CashPlan, type FinanceCash, type FinanceSiteFunds } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney, viDate } from './financeUi';
import { SiteFundReview } from './SiteFundViews';
import { ACCOUNT_KINDS, AccountDrawer, CASH_SOURCE, CashOpeningDrawer, EXPENSE_CATEGORIES, ExpenseDrawer, MovementDrawer, PlanDrawer, RECEIPT_CATEGORIES, ReconDrawer } from './CashDrawers';
import { BankStatementDrawer } from './BankStatementDrawer';

// Tài chính → Thu chi & quỹ: công ty có bao nhiêu tiền, ở tài khoản nào; tiền vào ra; 8 tuần tới có thiếu tiền không.

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint: string; tone?: string; to?: string }> = ({ icon: I, label, value, hint, tone = 'text-leaf-700 dark:text-leaf-300', to }) =>
  <button type="button" onClick={() => to && document.getElementById(to)?.scrollIntoView({ behavior: 'smooth' })} className="rounded-2xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-teal-300 hover:shadow">
    <span className="flex items-start gap-1.5 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground"><I size={14} className="shrink-0 text-teal-700" />{label}</span>
    <span className={`mt-1 block text-xl font-bold tabular-nums ${tone}`}>{value}</span><span className="block text-xs text-muted-foreground">{hint}</span></button>;
const ddmm = (d: string | null) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—';

export const CashView: React.FC<{ onChanged: () => void; onOpenRequests: () => void }> = ({ onChanged, onOpenRequests }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceCash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(''); const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ kind: 'account'; account?: CashAccount } | { kind: 'opening'; account: CashAccount } | { kind: 'recon'; account: CashAccount }
    | { kind: 'movement'; mode: 'receipt' | 'transfer' } | { kind: 'plan'; plan?: CashPlan } | { kind: 'expense' } | { kind: 'bank'; accountId: string } | null>(null);
  const [site, setSite] = useState<FinanceSiteFunds | null>(null);
  const load = useCallback(() => { setError(null); financeService.cash({ month: month ? `${month}-01` : undefined, accountId: accountId || undefined }).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
    financeService.siteFunds().then(setSite).catch(() => setSite(null)); }, [month, accountId]);
  useEffect(load, [load]);
  if (error) return <StateBox kind="error" title="Chưa tải được Thu chi & quỹ" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải thu chi…" />;
  const f = data.forecast; const can = data.can;
  const done = (msg: string) => { toast.success('Thu chi & quỹ', msg); setDrawer(null); load(); onChanged(); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); done(msg); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } };
  const active = data.accounts.filter(a => a.active);
  const last = f.weeks[f.weeks.length - 1];
  const chart = f.weeks.map(w => ({ w: ddmm(w.weekStart), inSure: w.inSure + w.inPlan, inMaybe: w.inMaybe, out: -(w.outAp + w.outRequests + w.outPlan), sure: w.balanceSure, maybe: w.balanceMaybe }));
  const pendOpen = data.accounts.filter(a => a.opening?.status === 'submitted');
  const pendRecon = data.accounts.filter(a => a.lastRecon?.status === 'submitted');
  const pendMove = data.movements.filter(m => m.status === 'submitted');

  return <div className="space-y-3">
    {active.length === 0 ? <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <h3 className="flex items-center gap-1.5 text-base font-bold"><Landmark size={18} />Chưa khai tài khoản tiền</h3>
      <p className="mt-1">Khai tiền mặt, các tài khoản ngân hàng, quỹ công trường; rồi gửi số dư đầu kỳ theo MISA 30/09 để người khác chốt. Sau đó mọi khoản chi NCC, phiếu thu CĐT, chi khác khi xác nhận đều chọn tài khoản → sổ thu chi và dự báo tự cập nhật.</p>
      {can.record && <button type="button" onClick={() => setDrawer({ kind: 'account' })} className={`${primaryBtn} mt-3`}><Plus size={15} />Khai tài khoản tiền</button>}
    </section> : <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Kpi to="cash-accounts" icon={Wallet} label="Tiền hiện có" value={shortMoney(f.start)} hint={f.known ? `${f.accounts} tài khoản · theo sổ Vioo` : `${data.pending.accountsWithoutOpening} tài khoản chưa chốt đầu kỳ — số chưa đủ`} tone={f.known ? undefined : 'text-amber-700 dark:text-amber-300'} />
      <Kpi to="cash-ledger" icon={ArrowDownLeft} label="Thu 30 ngày" value={shortMoney(data.flows30.in)} hint="không gồm chuyển tiền nội bộ" />
      <Kpi to="cash-ledger" icon={ArrowUpRight} label="Chi 30 ngày" value={shortMoney(data.flows30.out)} hint="NCC, tạm ứng, chi khác" tone="text-foreground" />
      <Kpi to="cash-forecast" icon={CalendarClock} label="Dự báo sau 8 tuần" value={last ? shortMoney(last.balanceSure) : '—'} hint="chỉ tính khoản chắc chắn" tone={last && last.balanceSure < f.minBalance ? 'text-rose-700 dark:text-rose-300' : undefined} />
      <Kpi to="cash-forecast" icon={AlertTriangle} label="Tuần thấp nhất" value={f.lowest != null ? shortMoney(f.lowest) : '—'} hint={`tuần ${ddmm(f.lowestWeek)} · tối thiểu ${shortMoney(f.minBalance)}`} tone={f.belowMinWeek ? 'text-rose-700 dark:text-rose-300' : 'text-foreground'} />
    </section>}

    {(pendOpen.length + pendRecon.length + pendMove.length) > 0 && <section className="rounded-2xl border border-amber-300 bg-card p-4 shadow-sm">
      <h3 className="font-bold">Chờ xác nhận ({pendOpen.length + pendRecon.length + pendMove.length})</h3>
      <ul className="mt-2 divide-y divide-border text-sm">
        {pendOpen.map(a => <li key={a.opening!.id} className="flex flex-wrap items-center justify-end gap-2 py-2"><span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>Số dư đầu kỳ</b> <span className={ENT}>{a.name}</span>: <b className={NUM}>{money(a.opening!.balance)} đ</b>
          <span className="block text-xs text-muted-foreground">Lập: {a.opening!.createdByName}{a.opening!.note ? ` · ${a.opening!.note}` : ''}</span></span>
          {a.opening!.attachments.map(x => <button key={x.path} type="button" onClick={() => void financeService.openAttachment(x.path)} className="text-xs font-semibold text-teal-700 hover:underline"><FileText size={12} className="mr-0.5 inline" />{x.name}</button>)}
          {a.opening!.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Trả lại số dư đầu kỳ', targetName: a.name, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' }); if (r) void run(() => financeService.decideCashOpening({ id: a.opening!.id, action: 'reject', reason: r }), 'Đã trả lại.'); }}><X size={14} />Trả lại</button>
            <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Chốt số dư đầu kỳ?', targetName: `${a.name} · ${money(a.opening!.balance)} đ`, confirmText: 'Chốt', actionLabel: 'Chốt', intent: 'success', countdownSeconds: 0, warningText: 'Đã đối chiếu sổ MISA / sao kê 30/09.' })) void run(() => financeService.decideCashOpening({ id: a.opening!.id, action: 'confirm' }), 'Đã chốt đầu kỳ.'); }}><Check size={14} />Chốt</button></>}</li>)}
        {pendRecon.map(a => <li key={a.lastRecon!.id} className="flex flex-wrap items-center justify-end gap-2 py-2"><span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>Đối chiếu sao kê {a.lastRecon!.month.slice(5, 7)}/{a.lastRecon!.month.slice(0, 4)}</b> <span className={ENT}>{a.name}</span>
          <span className="block text-xs text-muted-foreground">Sổ {money(a.lastRecon!.bookBalance)} · sao kê {money(a.lastRecon!.statementBalance)} · {Math.abs(a.lastRecon!.difference) > 0.5 ? <b className="text-amber-700">lệch {money(a.lastRecon!.difference)}: {a.lastRecon!.explanation}</b> : 'khớp'} · lập: {a.lastRecon!.createdByName}</span></span>
          {a.lastRecon!.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Trả lại đối chiếu', targetName: a.name, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' }); if (r) void run(() => financeService.decideCashReconciliation({ id: a.lastRecon!.id, action: 'reject', reason: r }), 'Đã trả lại.'); }}><X size={14} />Trả lại</button>
            <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Chốt tháng?', targetName: a.name, confirmText: 'Chốt', actionLabel: 'Chốt tháng', intent: 'success', countdownSeconds: 0, warningText: 'Chốt xong không ghi lùi ngày vào tháng này của tài khoản; điều chỉnh ghi vào tháng sau.' })) void run(() => financeService.decideCashReconciliation({ id: a.lastRecon!.id, action: 'confirm' }), 'Đã chốt tháng.'); }}><Check size={14} />Chốt tháng</button></>}</li>)}
        {pendMove.map(m => <li key={m.id} className="flex flex-wrap items-center justify-end gap-2 py-2"><span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>{m.kind === 'transfer' ? 'Chuyển tiền' : RECEIPT_CATEGORIES[m.category] || 'Thu khác'}</b> {m.code}: <b className={NUM}>{money(m.amount)} đ</b>
          <span className="block text-xs text-muted-foreground">{m.kind === 'transfer' ? `${m.fromName} → ${m.toName}` : `vào ${m.toName}`} · {viDate(m.date)} · {m.description} · lập: {m.createdByName}</span></span>
          {m.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void run(() => financeService.decideCashMovement({ id: m.id, expectedRowVersion: m.rowVersion, action: 'withdraw' }), 'Đã rút.')}><Undo2 size={14} />Rút</button>}
          {m.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Từ chối', targetName: m.code, reasonLabel: 'Lý do', actionLabel: 'Từ chối', intent: 'warning' }); if (r) void run(() => financeService.decideCashMovement({ id: m.id, expectedRowVersion: m.rowVersion, action: 'reject', reason: r }), 'Đã từ chối.'); }}><X size={14} />Từ chối</button>
            <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Xác nhận?', targetName: `${m.code} · ${money(m.amount)} đ`, confirmText: 'Xác nhận', actionLabel: 'Xác nhận', intent: 'success', countdownSeconds: 0, warningText: 'Đã đối chiếu chứng từ; ghi vào sổ thu chi.' })) void run(() => financeService.decideCashMovement({ id: m.id, expectedRowVersion: m.rowVersion, action: 'confirm' }), 'Đã xác nhận — đã ghi sổ.'); }}><Check size={14} />Xác nhận</button></>}</li>)}
      </ul>
    </section>}

    {site && <SiteFundReview data={site} onChanged={() => { load(); onChanged(); }} />}

    {active.length > 0 && <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section id="cash-forecast" className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-2"><h3 className="font-bold">Dự báo dòng tiền 8 tuần</h3>
          <span className="text-xs text-muted-foreground">Chi: nợ NCC theo hạn, tạm ứng / chi khác đã lập, khoản định kỳ · Thu: đợt CĐT đã xác nhận; "có thể" = đợt đã gửi chưa xác nhận</span></div>
        <div className="mt-2 h-72"><ResponsiveContainer><ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="w" fontSize={12} /><YAxis fontSize={11} tickFormatter={v => (v < 0 ? '−' : '') + shortMoney(Math.abs(v))} width={70} />
          <Tooltip formatter={(v: number) => (v < 0 ? '−' : '') + shortMoney(Math.abs(v))} />
          <Bar dataKey="inSure" name="Thu chắc chắn" stackId="in" fill="#86efac" /><Bar dataKey="inMaybe" name="Thu có thể" stackId="in" fill="#99f6e4" />
          <Bar dataKey="out" name="Chi dự kiến" fill="#fca5a5" />
          <ReferenceLine y={f.minBalance} stroke="#d97706" strokeDasharray="4 4" label={{ value: 'Tồn quỹ tối thiểu', fontSize: 11, fill: '#b45309' }} />
          <Line dataKey="sure" name="Số dư (chắc chắn)" stroke="#15803d" strokeWidth={2.5} dot />
          <Line dataKey="maybe" name="Số dư (nếu thu được)" stroke="#0d9488" strokeDasharray="5 4" dot={false} />
        </ComposedChart></ResponsiveContainer></div>
        {f.belowMinWeek ? <p className="mt-1 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"><b>Từ tuần {ddmm(f.belowMinWeek)} số dư chắc chắn xuống dưới mức tối thiểu {shortMoney(f.minBalance)}</b> (thấp nhất {shortMoney(f.lowest || 0)} tuần {ddmm(f.lowestWeek)}). Đẩy nhanh đợt thu CĐT hoặc giãn chi.</p>
          : <p className="mt-1 text-xs text-muted-foreground">8 tuần tới không xuống dưới tồn quỹ tối thiểu {shortMoney(f.minBalance)}.{!f.known && ' Lưu ý: còn tài khoản chưa chốt đầu kỳ nên số dư chưa đủ.'}</p>}
      </section>
      <section id="cash-accounts" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2"><h3 className="flex items-center gap-1.5 font-bold"><Landmark size={16} className="text-teal-700" />Tài khoản tiền</h3>
          {can.record && <button type="button" onClick={() => setDrawer({ kind: 'account' })} className="ml-auto text-xs font-semibold text-teal-700 hover:underline"><Plus size={12} className="mr-0.5 inline" />Khai</button>}</div>
        <ul className="mt-2 space-y-2">{data.accounts.map(a => <li key={a.id} className={`rounded-xl border border-border px-3 py-2 ${a.active ? '' : 'opacity-50'}`}>
          <p className="flex items-center gap-2"><b className={`min-w-0 flex-1 truncate ${ENT}`}>{a.name}</b><span className={a.opening?.status === 'confirmed' ? NUM : 'font-semibold tabular-nums text-amber-700'}>{shortMoney(a.balance)}</span></p>
          <p className="text-xs text-muted-foreground">{ACCOUNT_KINDS[a.kind]}{a.accountNo ? ` · ${a.accountNo}` : ''}{a.projectCode ? ` · ${a.projectCode}` : ''}{a.holderName ? ` · ${a.holderName}` : ''}{!a.active ? ' · ngừng dùng' : ''}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
            {a.opening?.status === 'confirmed' ? <span className="text-leaf-700">Đầu kỳ {shortMoney(a.opening.balance)} đã chốt</span>
              : a.opening?.status === 'submitted' ? <span className="text-amber-700">Đầu kỳ chờ chốt</span>
                : <span className="font-semibold text-amber-700">Chưa có số dư đầu kỳ{a.opening?.status === 'rejected' ? ' (bị trả lại)' : ''}</span>}
            {a.lockedThrough && <span className="text-muted-foreground">· đã chốt đến {viDate(a.lockedThrough)}</span>}
            {a.lastRecon?.status === 'confirmed' && Math.abs(a.lastRecon.difference) > 0.5 && <span className="text-amber-700">· lệch sao kê {shortMoney(a.lastRecon.difference)}</span>}</p>
          {can.record && a.active && <p className="mt-1 flex flex-wrap gap-2 text-xs font-semibold">
            {(!a.opening || a.opening.status === 'rejected' || a.opening.status === 'cancelled') && <button type="button" onClick={() => setDrawer({ kind: 'opening', account: a })} className="text-teal-700 hover:underline">Gửi số dư đầu kỳ</button>}
            {a.opening?.status === 'confirmed' && a.lastRecon?.status !== 'submitted' && <button type="button" onClick={() => setDrawer({ kind: 'recon', account: a })} className="text-teal-700 hover:underline"><ClipboardCheck size={12} className="mr-0.5 inline" />Đối chiếu sao kê</button>}
            <button type="button" onClick={() => setDrawer({ kind: 'account', account: a })} className="text-muted-foreground hover:underline"><Pencil size={11} className="mr-0.5 inline" />Sửa</button></p>}
          {a.kind === 'bank' && <p className="mt-1 text-xs font-semibold"><button type="button" onClick={() => setDrawer({ kind: 'bank', accountId: a.id })} className="text-teal-700 hover:underline"><FileSpreadsheet size={12} className="mr-0.5 inline" />Sao kê ngân hàng</button></p>}
        </li>)}</ul>
      </section>
    </div>}

    {active.length > 0 && <section id="cash-ledger" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="mr-auto font-semibold">Sổ thu chi</h3>
        <input type="month" value={month || data.month.slice(0, 7)} onChange={e => setMonth(e.target.value)} className={inputCls} aria-label="Tháng" />
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls} aria-label="Tài khoản"><option value="">Mọi tài khoản</option>{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {can.record && <><button type="button" onClick={() => setDrawer({ kind: 'movement', mode: 'transfer' })} className={secondaryBtn}><ArrowLeftRight size={15} />Chuyển tiền</button>
          <button type="button" onClick={() => setDrawer({ kind: 'movement', mode: 'receipt' })} className={secondaryBtn}><ArrowDownLeft size={15} />Thu khác</button>
          <button type="button" onClick={() => setDrawer({ kind: 'expense' })} className={primaryBtn}><Send size={15} />Phiếu chi khác</button></>}
      </div>
      {data.entries.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có khoản tiền vào / ra trong tháng này. Khoản chi NCC, phiếu thu CĐT, chi khác khi được xác nhận sẽ tự ghi vào đây.</p>
        : <><ul className="divide-y divide-border md:hidden">{data.entries.map(e => <li key={e.id} className={`px-4 py-2.5 text-sm ${e.reversed ? 'opacity-60' : ''}`}>
          <p className="flex items-start gap-2"><span className="min-w-0 flex-1"><b>{CASH_SOURCE[e.sourceType] || e.sourceType}</b> {e.reversalOf && <Badge className="border-border bg-muted text-muted-foreground">đảo</Badge>}</span>
            <span className={`whitespace-nowrap font-semibold tabular-nums ${e.direction === 'in' ? 'text-leaf-700' : 'text-foreground'}`}>{e.direction === 'in' ? '+' : '−'}{money(e.amount)}</span></p>
          <p className="text-xs text-muted-foreground">{viDate(e.date)} · {e.accountName} · {e.description}</p></li>)}</ul>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Ngày</th><th className="px-2 py-2 text-left">Tài khoản</th><th className="px-2 py-2 text-left">Nội dung</th>
            <th className="px-2 py-2 text-left">Đối tượng</th><th className="px-2 py-2 text-right">Thu</th><th className="px-2 py-2 text-right">Chi</th><th className="px-3 py-2 text-left">Nguồn</th></tr></thead>
          <tbody className="divide-y divide-border">{data.entries.map(e => <tr key={e.id} className={e.reversed ? 'opacity-60' : ''}>
            <td className="whitespace-nowrap px-3 py-2">{viDate(e.date)}</td><td className="px-2 py-2">{e.accountName}</td>
            <td className="px-2 py-2">{e.description}<span className="block text-xs text-muted-foreground">{e.code}{e.projectCode ? ` · ${e.projectCode}` : ''}{e.reversed ? ' · đã đảo' : ''}</span></td>
            <td className="px-2 py-2 text-muted-foreground">{e.counterparty || '—'}</td>
            <td className={`whitespace-nowrap px-2 py-2 text-right ${NUM}`}>{e.direction === 'in' ? money(e.amount) : ''}</td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{e.direction === 'out' ? money(e.amount) : ''}</td>
            <td className="px-3 py-2"><Badge className="border-border bg-muted text-muted-foreground">{CASH_SOURCE[e.sourceType] || e.sourceType}</Badge>{e.reversalOf && <Badge className="ml-1 border-amber-300 bg-amber-50 text-amber-800">đảo</Badge>}</td></tr>)}</tbody></table></div></>}
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Sổ không sửa / xóa được: ghi nhầm thì đảo chứng từ gốc (đề nghị chi, phiếu thu, thu khác, chuyển tiền). Phiếu chi khác đang duyệt xem ở <button type="button" onClick={onOpenRequests} className="font-semibold text-teal-700 hover:underline">Phải trả → Đề nghị chi</button>.</p>
    </section>}

    {data.movements.filter(m => m.status !== 'submitted').length > 0 && <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="font-semibold">Thu khác & chuyển tiền gần đây</h3>
      <ul className="mt-1 divide-y divide-border text-sm">{data.movements.filter(m => m.status !== 'submitted').map(m => <li key={m.id} className={`flex flex-wrap items-center gap-2 py-2 ${m.status === 'confirmed' ? '' : 'opacity-60'}`}>
        <span className="min-w-0 flex-1"><b>{m.code}</b> {m.kind === 'transfer' ? `${m.fromName} → ${m.toName}` : `${RECEIPT_CATEGORIES[m.category] || 'Thu khác'} vào ${m.toName}`} · {viDate(m.date)}
          <span className="block text-xs text-muted-foreground">{m.description} · {{ confirmed: 'đã xác nhận', rejected: 'bị từ chối', withdrawn: 'đã rút', reversed: 'đã đảo', submitted: '' }[m.status]}{m.reverseReason ? `: ${m.reverseReason}` : m.decisionNote ? `: ${m.decisionNote}` : ''}</span></span>
        <span className={NUM}>{money(m.amount)}</span>
        {m.canReverse && <button type="button" disabled={busy} className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => { const r = await askReason({ title: 'Đảo phiếu', targetName: `${m.code} · ${money(m.amount)} đ`, subtitle: 'Ghi dòng ngược chiều vào sổ, không xóa.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' }); if (r) void run(() => financeService.decideCashMovement({ id: m.id, expectedRowVersion: m.rowVersion, action: 'reverse', reason: r }), 'Đã đảo.'); }}><RotateCcw size={12} className="mr-0.5 inline" />Đảo</button>}</li>)}</ul>
    </section>}

    {active.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2"><h3 className="flex items-center gap-1.5 font-semibold"><CalendarClock size={15} className="text-teal-700" />Khoản định kỳ (cho dự báo)</h3>
        {can.record && <button type="button" onClick={() => setDrawer({ kind: 'plan' })} className="ml-auto text-xs font-semibold text-teal-700 hover:underline"><Plus size={12} className="mr-0.5 inline" />Thêm</button>}</div>
      {data.plans.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Chưa có. Khai lương, thuê văn phòng, trả nợ vay… để dự báo tính trước các khoản chi cố định.</p>
        : <ul className="mt-1 divide-y divide-border text-sm">{data.plans.map(p => <li key={p.id} className={`flex flex-wrap items-center gap-2 py-2 ${p.active ? '' : 'opacity-50'}`}>
          <span className="min-w-0 flex-1"><b>{p.name}</b> <span className="text-xs text-muted-foreground">{p.direction === 'out' ? EXPENSE_CATEGORIES[p.category] || p.category : RECEIPT_CATEGORIES[p.category] || p.category} · ngày {p.dayOfMonth} hằng tháng từ {p.startMonth.slice(5, 7)}/{p.startMonth.slice(0, 4)}{p.endMonth ? ` đến ${p.endMonth.slice(5, 7)}/${p.endMonth.slice(0, 4)}` : ''}{p.active ? '' : ' · tạm dừng'}</span></span>
          <span className={p.direction === 'in' ? NUM : 'font-semibold tabular-nums'}>{p.direction === 'in' ? '+' : '−'}{money(p.amount)}</span>
          {can.record && <button type="button" onClick={() => setDrawer({ kind: 'plan', plan: p })} className="text-xs font-semibold text-teal-700 hover:underline">Sửa</button>}</li>)}</ul>}
    </section>}

    {drawer?.kind === 'account' && <AccountDrawer data={data} account={drawer.account} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'opening' && <CashOpeningDrawer account={drawer.account} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'recon' && <ReconDrawer data={data} account={drawer.account} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'movement' && <MovementDrawer data={data} kind={drawer.mode} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'plan' && <PlanDrawer data={data} plan={drawer.plan} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'bank' && <BankStatementDrawer cash={data} accountId={drawer.accountId} onClose={() => setDrawer(null)} onChanged={() => { load(); onChanged(); }} />}
    {drawer?.kind === 'expense' && <ExpenseDrawer projects={data.projects} onClose={() => setDrawer(null)} onSaved={done} />}
  </div>;
};
