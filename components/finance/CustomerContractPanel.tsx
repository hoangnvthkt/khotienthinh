import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Banknote, Check, ChevronDown, ClipboardCheck, FileText, HandCoins, History, Landmark, Pencil, Plus, Receipt, RotateCcw,
  Send, Settings2, ShieldCheck, Undo2, X,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import {
  EVENT_LABELS, financeService, type ContractGuarantee, type CustomerContractDetail, type CustomerContractMetrics, type ReceivableRound,
} from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, daysBetween, shortMoney, viDate } from './financeUi';
import {
  ConfirmRoundDrawer, CustomerOpeningDrawer, CustomerTermsDrawer, GuaranteeDrawer, KIND_LABELS, ReceiptDrawer, RoundDrawer,
} from './ReceivableDrawers';

// Chi tiết HĐ chủ đầu tư ở Tài chính → Phải thu: đợt thu (lập → gửi → CĐT xác nhận → hóa đơn → thu), phiếu thu, tạm ứng CĐT, giữ lại, bảo lãnh, đầu kỳ.

/** Thanh 3 lớp: đã thu / đã đề nghị / sản lượng ước tính (Gantt) trên giá trị HĐ gồm VAT. */
export const LifeBar: React.FC<{ m: CustomerContractMetrics }> = ({ m }) => {
  const pct = (n: number) => `${m.gross > 0 ? Math.min(100, (n / m.gross) * 100) : 0}%`;
  const asked = m.billed + m.advanceReceived;
  return <div>
    <div className="relative h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
      {m.estOutput != null && <span className="absolute inset-y-0 left-0 bg-teal-200 dark:bg-teal-900" style={{ width: pct(m.estOutput) }} />}
      <span className="absolute inset-y-0 left-0 bg-teal-500" style={{ width: pct(asked) }} />
      <span className="absolute inset-y-0 left-0 bg-leaf-600" style={{ width: pct(m.received) }} />
    </div>
    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
      <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-leaf-600" />Đã thu {shortMoney(m.received)}</span>
      <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-500" />Đã đề nghị {shortMoney(asked)} (gồm tạm ứng)</span>
      <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-200" />{m.estOutput != null ? `Sản lượng ước tính ${shortMoney(m.estOutput)} (${m.progress}% Gantt)` : 'Dự án chưa có tiến độ Gantt'}</span>
    </div>
  </div>;
};

const STATUS_BADGE = (r: ReceivableRound, today: string) => {
  if (r.status === 'cancelled') return ['Đã hủy', 'border-slate-200 bg-slate-100 text-slate-600'];
  if (r.status === 'draft') return [r.customerNote ? 'CĐT trả lại' : 'Nháp', r.customerNote ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-100 text-slate-700'];
  if (r.status === 'sent') { const d = r.sentDate ? daysBetween(today, r.sentDate) : 0; return [`Đã gửi CĐT ${d} ngày`, d > 15 ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-teal-200 bg-teal-50 text-teal-800']; }
  if (r.outstanding <= 0.5) return ['Đã thu đủ', 'border-leaf-200 bg-leaf-50 text-leaf-800'];
  if (r.overdue) return [`Quá hạn ${r.dueDate ? daysBetween(today, r.dueDate) : 0} ngày`, 'overdue-blink border-rose-300 bg-rose-50 text-rose-700'];
  return [r.received > 0 ? 'Thu một phần' : 'Chờ thu', 'border-amber-300 bg-amber-50 text-amber-800'];
};

export const CustomerContractPanel: React.FC<{ contractId: string; onBack: () => void; onChanged: () => void }> = ({ contractId, onBack, onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [d, setD] = useState<CustomerContractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ kind: 'round'; round?: ReceivableRound } | { kind: 'confirm'; round: ReceivableRound } | { kind: 'receipt' }
    | { kind: 'opening' } | { kind: 'terms' } | { kind: 'guarantee'; g: ContractGuarantee } | null>(null);
  const [apply, setApply] = useState<{ receiptId: string; roundId: string; amount: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(() => { setError(null); financeService.customerContract(contractId).then(setD).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [contractId]);
  useEffect(() => { setD(null); load(); }, [load]);
  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!d) return <StateBox kind="loading" title="Đang tải hợp đồng…" />;
  const { contract: c, metrics: m, can, today } = d;
  const done = (msg: string) => { toast.success(c.projectCode || c.code, msg); setDrawer(null); setApply(null); load(); onChanged(); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); done(msg); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } };
  const pendingOpening = d.openings.find(o => o.status === 'submitted');
  const prepayReceipts = d.receipts.filter(r => r.status === 'confirmed' && r.unallocated > 0.5);
  const openRounds = d.rounds.filter(r => r.status === 'confirmed' && r.outstanding - r.pending > 0.5);

  const roundActions = (r: ReceivableRound) => {
    if (!r.canAct) return null;
    const act = async (action: 'send' | 'return' | 'invoice' | 'cancel') => {
      if (action === 'send') {
        if (await confirm({ title: 'Đã gửi hồ sơ cho CĐT?', targetName: `Đợt ${r.sequenceNo} · ${money(r.gross)} đ`, confirmText: 'Đã gửi', actionLabel: 'Đã gửi', intent: 'success', countdownSeconds: 0,
          warningText: 'Ghi ngày gửi hôm nay. Quá 15 ngày CĐT chưa xác nhận sẽ nhắc ở Việc cần làm.' }))
          void run(() => financeService.transitionRound({ id: r.id, expectedRowVersion: r.rowVersion, action: 'send', date: today }), `Đợt ${r.sequenceNo}: đã gửi CĐT.`);
        return;
      }
      if (action === 'invoice') {
        const no = await askReason({ title: 'Ghi hóa đơn GTGT', targetName: `Đợt ${r.sequenceNo} · ${money(r.gross)} đ`, reasonLabel: 'Số hóa đơn', reasonPlaceholder: 'VD: 0001245', actionLabel: 'Lưu', intent: 'success' });
        if (no) void run(() => financeService.transitionRound({ id: r.id, expectedRowVersion: r.rowVersion, action: 'invoice', date: today, invoiceNo: no }), `Đợt ${r.sequenceNo}: đã ghi hóa đơn ${no}.`);
        return;
      }
      const reason = await askReason({ title: action === 'return' ? 'CĐT trả lại hồ sơ' : 'Hủy đợt thu', targetName: `Đợt ${r.sequenceNo} · ${r.description}`,
        subtitle: action === 'return' ? 'Đợt quay về nháp để sửa và gửi lại.' : 'Không xóa — đợt chuyển "Đã hủy", giữ lịch sử.', reasonLabel: 'Lý do', actionLabel: action === 'return' ? 'Trả lại' : 'Hủy đợt', intent: 'warning' });
      if (reason) void run(() => financeService.transitionRound({ id: r.id, expectedRowVersion: r.rowVersion, action, reason }), action === 'return' ? `Đợt ${r.sequenceNo} về nháp.` : `Đã hủy đợt ${r.sequenceNo}.`);
    };
    const btn = 'rounded-md px-1.5 py-0.5 text-xs font-semibold hover:bg-muted';
    return <span className="flex flex-wrap justify-end gap-1">
      {r.status === 'draft' && <><button type="button" className={`${btn} text-teal-700`} onClick={() => setDrawer({ kind: 'round', round: r })}><Pencil size={12} className="mr-0.5 inline" />Sửa</button>
        <button type="button" className={`${btn} text-teal-700`} disabled={busy} onClick={() => void act('send')}><Send size={12} className="mr-0.5 inline" />Đã gửi CĐT</button></>}
      {r.status === 'sent' && <><button type="button" className={`${btn} text-leaf-700`} onClick={() => setDrawer({ kind: 'confirm', round: r })}><Check size={12} className="mr-0.5 inline" />CĐT xác nhận</button>
        <button type="button" className={`${btn} text-amber-700`} disabled={busy} onClick={() => void act('return')}><Undo2 size={12} className="mr-0.5 inline" />CĐT trả lại</button></>}
      {r.status === 'confirmed' && !r.invoiceNo && <button type="button" className={`${btn} text-teal-700`} disabled={busy} onClick={() => void act('invoice')}><FileText size={12} className="mr-0.5 inline" />Ghi hóa đơn</button>}
      {r.received <= 0.5 && r.pending <= 0.5 && <button type="button" className={`${btn} text-rose-700`} disabled={busy} onClick={() => void act('cancel')}>Hủy</button>}
    </span>;
  };

  return <section className="min-w-0 space-y-3">
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 md:hidden"><ArrowLeft size={15} />Danh sách HĐ</button>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hợp đồng chủ đầu tư</p>
          <h2 className={`text-lg ${ENT}`}>{c.projectCode || '—'} · {c.customerName}</h2>
          <p className="text-sm text-muted-foreground">HĐ {c.code} · {money(c.value)} + VAT {c.vatPercent}% = <b className="text-foreground">{shortMoney(m.gross)}</b>{c.endDate ? ` · kết thúc ${viDate(c.endDate)}` : ''}</p>
          <p className="text-xs text-muted-foreground">Thu hồi tạm ứng {Number(m.recoveryPercent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%{m.recoveryPercentSource === 'auto' ? ' (tự tính)' : ''}
            {' '}· giữ lại {Number(m.retentionPercent)}%{m.retentionPercentSource === 'default' ? ' (mặc định)' : ''} · hạn {m.paymentTermDays} ngày{m.paymentTermSource === 'default' ? ' (mặc định)' : ''}
            {' '}· bảo hành {m.warrantyMonths ? `${m.warrantyMonths} tháng` : 'chưa khai'}
            {can.manage && <> · <button type="button" onClick={() => setDrawer({ kind: 'terms' })} className="font-semibold text-teal-700 hover:underline"><Settings2 size={11} className="mr-0.5 inline" />Khai điều khoản</button></>}</p></div>
        {can.record && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDrawer({ kind: 'receipt' })} className={secondaryBtn}><Banknote size={15} />Ghi CĐT trả tiền</button>
          <button type="button" onClick={() => setDrawer({ kind: 'round' })} className={primaryBtn}><Plus size={15} />Lập đợt đề nghị thanh toán</button></div>}
      </div>
      <div className="mt-3"><LifeBar m={m} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        {([['Phải thu (CĐT đã xác nhận)', m.outstanding, ''], ['Quá hạn', m.overdue, m.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'],
          ['Sản lượng chưa đề nghị', m.unbilled, m.unbilled && m.unbilled > 0 ? 'text-amber-700 dark:text-amber-300' : ''], ['CĐT trả trước chưa trừ', m.prepayment, '']] as const).map(([l, v, cls]) =>
          <div key={l} className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className={`font-semibold tabular-nums ${cls || 'text-foreground'}`}>{v == null ? 'Chưa có dữ liệu' : shortMoney(v)}</dd></div>)}
      </dl>
      {m.opening === 'todo' && !pendingOpening && <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle size={15} className="shrink-0" /><span className="min-w-[14rem] flex-1"><b>Chưa đối chiếu đầu kỳ với MISA.</b> Các đợt cũ chưa tách thu hồi tạm ứng / giữ lại — số tạm ứng còn phải thu hồi đang là tạm tính.</span>
        {can.record && <button type="button" onClick={() => setDrawer({ kind: 'opening' })} className={`${secondaryBtn} bg-card`}><ClipboardCheck size={15} />Đối chiếu đầu kỳ</button>}</p>}
      {pendingOpening && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <p><b>Đầu kỳ chờ chốt</b> (lập: {pendingOpening.createdByName}): phải thu {money(pendingOpening.receivableAmount)} đ · tạm ứng chưa thu hồi {money(pendingOpening.advanceRemaining)} đ · giữ lại {money(pendingOpening.retentionHeld)} đ</p>
        {pendingOpening.canDecide && <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} className={`${secondaryBtn} bg-card`} onClick={async () => {
            const reason = await askReason({ title: 'Trả lại đối chiếu đầu kỳ', targetName: c.code, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' });
            if (reason) void run(() => financeService.decideCustomerOpening({ id: pendingOpening.id, action: 'reject', reason }), 'Đã trả lại đối chiếu đầu kỳ.');
          }}><X size={14} />Trả lại</button>
          <button type="button" disabled={busy} className={primaryBtn} onClick={async () => {
            if (await confirm({ title: 'Chốt đầu kỳ phải thu?', targetName: c.code, confirmText: 'Chốt', actionLabel: 'Chốt', intent: 'success', countdownSeconds: 0,
              warningText: 'Đã đối chiếu với sổ MISA. Từ nay tạm ứng còn thu hồi và giữ lại tính từ số này; phần còn phải thu thành một đợt "Số dư đầu kỳ".' }))
              void run(() => financeService.decideCustomerOpening({ id: pendingOpening.id, action: 'confirm' }), 'Đã chốt đầu kỳ.');
          }}><Check size={14} />Chốt đầu kỳ</button></div>}
      </div>}
    </div>

    <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_19rem]">
      <section className="min-w-0 space-y-3">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <h3 className="flex items-center gap-2 border-b border-border px-4 py-2.5 font-semibold"><Receipt size={16} className="text-teal-700" />Các đợt thu ({d.rounds.filter(r => r.status !== 'cancelled').length})</h3>
          {d.rounds.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có đợt thu. Lập đợt đề nghị thanh toán khi gửi hồ sơ nghiệm thu / tạm ứng cho CĐT.</p>
            : <><ul className="divide-y divide-border md:hidden">{d.rounds.map(r => { const [label, cls] = STATUS_BADGE(r, today);
              return <li key={r.id} className={`space-y-1 px-4 py-3 text-sm ${r.status === 'cancelled' ? 'opacity-50' : ''}`}>
                <p className="flex items-start gap-2"><span className="min-w-0 flex-1"><b>{r.sequenceNo || 'ĐK'}</b> {r.description}</span><Badge className={cls}>{label}</Badge></p>
                <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span>{KIND_LABELS[r.kind]}{r.legacy ? ' · từ lịch cũ' : ''}</span>
                  <span>{r.invoiceNo ? `HĐ ${r.invoiceNo} · ` : ''}{r.dueDate ? `hạn ${viDate(r.dueDate)}` : ''}</span></p>
                <p className="flex justify-between gap-2"><span>Phải thu <b className={NUM}>{money(r.receivable)}</b></span><span>Đã thu <b className={NUM}>{money(r.received)}</b></span></p>
                {(r.advanceRecovery > 0 || r.retention > 0) && <p className="text-xs text-muted-foreground">Gồm VAT {money(r.gross)} − thu hồi {money(r.advanceRecovery)} − giữ lại {money(r.retention)}</p>}
                {r.submittedGross != null && <p className="text-xs text-amber-700 dark:text-amber-300">CĐT duyệt thấp hơn số gửi {money(r.submittedGross - r.gross)} đ{r.customerNote ? `: ${r.customerNote}` : ''}</p>}
                {r.status === 'draft' && r.customerNote && <p className="text-xs text-amber-700 dark:text-amber-300">CĐT trả lại: {r.customerNote}</p>}
                {roundActions(r)}</li>; })}</ul>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[54rem] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>
                <th className="min-w-[14rem] px-3 py-2 text-left">Đợt</th><th className="px-3 py-2 text-left">Trạng thái</th><th className="px-2 py-2 text-right">Phải thu</th><th className="px-2 py-2 text-right">Đã thu</th>
                <th className="px-2 py-2 text-left">Hóa đơn · hạn</th><th className="px-2 py-2 text-right">Giá trị gồm VAT</th><th className="px-2 py-2 text-right">Thu hồi tạm ứng</th><th className="px-2 py-2 text-right">Giữ lại</th></tr></thead>
              <tbody className="divide-y divide-border">{d.rounds.map(r => { const [label, cls] = STATUS_BADGE(r, today);
                return <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 align-top"><b>{r.sequenceNo || 'ĐK'}</b> <span>{r.description}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1"><Badge className="border-border bg-muted text-muted-foreground">{KIND_LABELS[r.kind]}</Badge>{r.legacy && <Badge className="border-border bg-muted text-muted-foreground">từ lịch cũ</Badge>}</span>
                    {r.submittedGross != null && <span className="block text-xs text-amber-700 dark:text-amber-300">CĐT duyệt thấp hơn số gửi {money(r.submittedGross - r.gross)} đ{r.customerNote ? `: ${r.customerNote}` : ''}</span>}
                    {r.status === 'draft' && r.customerNote && <span className="block text-xs text-amber-700 dark:text-amber-300">CĐT trả lại: {r.customerNote}</span>}
                    {r.adjustReason && r.submittedGross == null && <span className="block text-xs text-muted-foreground">Khác gợi ý: {r.adjustReason}</span>}
                    {r.cancelReason && <span className="block text-xs text-muted-foreground">Hủy: {r.cancelReason}</span>}</td>
                  <td className="min-w-[9rem] px-3 py-2 align-top"><Badge className={cls}>{label}</Badge><div className="mt-1">{roundActions(r)}</div></td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right align-top ${NUM}`}>{money(r.receivable)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top"><span className={NUM}>{money(r.received)}</span>{r.pending > 0.5 && <span className="block text-xs text-amber-700">+{money(r.pending)} chờ xác nhận</span>}</td>
                  <td className="min-w-[8.5rem] px-2 py-2 align-top text-xs text-muted-foreground">{r.invoiceNo ? `HĐ ${r.invoiceNo}` : r.status === 'confirmed' ? 'chưa có HĐ' : '—'}{r.dueDate ? ` · hạn ${viDate(r.dueDate)}` : ''}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums">{money(r.gross)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-muted-foreground">{r.legacy && r.kind !== 'advance' ? 'Chưa rõ' : r.advanceRecovery ? `−${money(r.advanceRecovery)}` : '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-muted-foreground">{r.legacy && r.kind !== 'advance' ? 'Chưa rõ' : r.retention ? `−${money(r.retention)}` : '—'}</td>
                </tr>; })}</tbody></table></div></>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <h3 className="flex items-center gap-2 border-b border-border px-4 py-2.5 font-semibold"><Banknote size={16} className="text-teal-700" />Phiếu thu ({d.receipts.length})</h3>
          {d.receipts.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">Chưa có phiếu thu ghi ở Tài chính. Tiền thu trước đây nằm ở các đợt "từ lịch cũ".</p>
            : <ul className="divide-y divide-border">{d.receipts.map(rc => <li key={rc.id} className={`px-4 py-3 text-sm ${['rejected', 'withdrawn', 'reversed'].includes(rc.status) ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2"><b className={ENT}>{rc.code}</b>
                <Badge className={rc.status === 'confirmed' ? 'border-leaf-200 bg-leaf-50 text-leaf-800' : rc.status === 'submitted' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-border bg-muted text-muted-foreground'}>
                  {{ submitted: 'Chờ xác nhận', confirmed: 'Đã ghi dòng tiền', rejected: 'Bị từ chối', withdrawn: 'Đã rút', reversed: 'Đã đảo' }[rc.status]}</Badge>
                <span className="text-xs text-muted-foreground">{viDate(rc.receiptDate)} · {rc.documentRef}</span><span className={`ml-auto ${NUM}`}>{money(rc.amount)} đ</span></div>
              <p className="mt-0.5 text-xs text-muted-foreground">{rc.allocations.map(a => `Đợt ${a.sequenceNo || 'ĐK'}: ${money(a.amount)}${a.kind === 'prepayment' ? ' (từ trả trước)' : ''}`).join(' · ') || 'Chưa trừ vào đợt nào'}
                {rc.unallocated > 0.5 && <b className="text-teal-800 dark:text-teal-200"> · trả trước còn {money(rc.unallocated)} đ</b>}</p>
              <p className="text-xs text-muted-foreground">Lập: <span className={ENT}>{rc.createdByName}</span>{rc.decidedByName ? <> · {rc.status === 'rejected' ? 'từ chối' : 'xác nhận'}: <span className={ENT}>{rc.decidedByName}</span>{rc.decisionNote ? ` — ${rc.decisionNote}` : ''}</> : ''}
                {rc.reverseReason ? ` · đảo: ${rc.reverseReason}` : ''}</p>
              {rc.attachments.length > 0 && <p className="mt-1 flex flex-wrap gap-2">{rc.attachments.map(f => <button key={f.path} type="button" onClick={() => void financeService.openAttachment(f.path)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"><FileText size={12} />{f.name}</button>)}</p>}
              {(rc.canDecide || rc.canWithdraw || rc.canReverse || (rc.status === 'confirmed' && rc.unallocated > 0.5 && can.record && openRounds.length > 0)) && <div className="mt-2 flex flex-wrap justify-end gap-2">
                {rc.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void run(() => financeService.decideCustomerReceipt({ id: rc.id, expectedRowVersion: rc.rowVersion, action: 'withdraw' }), `Đã rút ${rc.code}.`)}><Undo2 size={14} />Rút</button>}
                {rc.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                  const reason = await askReason({ title: 'Từ chối phiếu thu', targetName: `${rc.code} · ${money(rc.amount)} đ`, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: Giấy báo có không khớp số tiền', actionLabel: 'Từ chối', intent: 'warning' });
                  if (reason) void run(() => financeService.decideCustomerReceipt({ id: rc.id, expectedRowVersion: rc.rowVersion, action: 'reject', reason }), `Đã từ chối ${rc.code}.`);
                }}><X size={14} />Từ chối</button>
                  <button type="button" disabled={busy} className={primaryBtn} onClick={async () => {
                    if (await confirm({ title: 'Xác nhận đã nhận tiền?', targetName: `${rc.code} · ${money(rc.amount)} đ`, confirmText: 'Xác nhận', actionLabel: 'Xác nhận', intent: 'success', countdownSeconds: 0,
                      warningText: `Đã đối chiếu ${rc.documentRef} ngày ${viDate(rc.receiptDate)}. Ghi dòng tiền vào của dự án và giảm phải thu các đợt đã chọn.` }))
                      void run(() => financeService.decideCustomerReceipt({ id: rc.id, expectedRowVersion: rc.rowVersion, action: 'confirm' }), `Đã xác nhận ${rc.code}.`);
                  }}><ShieldCheck size={14} />Xác nhận</button></>}
                {rc.status === 'confirmed' && rc.unallocated > 0.5 && can.record && openRounds.length > 0 && <button type="button" className={secondaryBtn}
                  onClick={() => setApply({ receiptId: rc.id, roundId: openRounds[0].id, amount: String(Math.round(Math.min(rc.unallocated, openRounds[0].outstanding - openRounds[0].pending))) })}><HandCoins size={14} />Trừ trả trước vào đợt</button>}
                {rc.canReverse && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                  const reason = await askReason({ title: 'Đảo phiếu thu', targetName: `${rc.code} · ${money(rc.amount)} đ`, subtitle: 'Không xóa: dòng tiền vào được ghi đảo, các đợt quay lại còn phải thu.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
                  if (reason) void run(() => financeService.decideCustomerReceipt({ id: rc.id, expectedRowVersion: rc.rowVersion, action: 'reverse', reason }), `Đã đảo ${rc.code}.`);
                }}><RotateCcw size={14} />Đảo</button>}
              </div>}
              {apply?.receiptId === rc.id && <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/50 p-2">
                <select value={apply.roundId} onChange={e => setApply({ ...apply, roundId: e.target.value })} className={inputCls} aria-label="Đợt">
                  {openRounds.map(r => <option key={r.id} value={r.id}>Đợt {r.sequenceNo || 'ĐK'} · còn {money(r.outstanding - r.pending)}</option>)}</select>
                <input value={apply.amount} onChange={e => setApply({ ...apply, amount: e.target.value })} inputMode="numeric" className={`w-40 text-right ${inputCls}`} aria-label="Số tiền" />
                <button type="button" className={secondaryBtn} onClick={() => setApply(null)}>Thôi</button>
                <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(() => financeService.applyCustomerPrepayment({ receiptId: rc.id, roundId: apply.roundId, amount: Number(apply.amount.replace(/\D/g, '')) }), 'Đã trừ tiền trả trước vào đợt.')}>Trừ</button></div>}
            </li>)}</ul>}
          {prepayReceipts.length > 0 && openRounds.length === 0 && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Có tiền CĐT trả trước chưa trừ — sẽ trừ được khi có đợt CĐT xác nhận.</p>}
        </section>

        {d.events.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <button type="button" onClick={() => setShowHistory(v => !v)} className="flex items-center gap-1.5 text-sm font-semibold"><History size={15} />Lịch sử ({d.events.length})<ChevronDown size={14} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} /></button>
          {showHistory && <ol className="mt-2 space-y-1 text-sm">{d.events.map((e, i) => <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
            <span className="tabular-nums">{new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span><span className="font-medium text-foreground">{EVENT_LABELS[e.action] || e.action}</span><span>· {e.actorName}</span>
            {e.reason && <span className="w-full pl-4 italic">“{e.reason}”</span>}</li>)}</ol>}
        </section>}
      </section>

      <aside className="grid content-start gap-3 sm:grid-cols-2 2xl:grid-cols-1">
        <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm"><h3 className="flex items-center gap-1.5 font-semibold"><HandCoins size={15} className="text-teal-700" />Tạm ứng CĐT</h3>
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between"><dt className="text-muted-foreground">Đã nhận</dt><dd className={NUM}>{shortMoney(m.advanceReceived)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Đã thu hồi{m.opening === 'confirmed' ? ' (từ đầu kỳ)' : ''}</dt><dd className="font-semibold">{m.opening === 'todo' && !m.advanceRecovered ? 'Chưa rõ' : shortMoney(m.advanceRecovered)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Còn phải thu hồi</dt><dd className="font-semibold">{shortMoney(m.advanceRemaining)}{m.opening === 'todo' ? <span className="block text-right text-[11px] font-normal text-amber-700">tạm tính</span> : null}</dd></div>
          </dl></section>
        <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm"><h3 className="flex items-center gap-1.5 font-semibold"><ShieldCheck size={15} className="text-teal-700" />Giữ lại bảo hành</h3>
          <p className="mt-1"><b className={NUM}>{shortMoney(m.retentionHeld)}</b> <span className="text-muted-foreground">CĐT đang giữ</span></p>
          <p className="text-xs text-muted-foreground">Hết bảo hành ({m.warrantyMonths ? `${m.warrantyMonths} tháng` : 'chưa khai thời gian'}) thì lập đợt "Trả tiền giữ lại".</p></section>
        <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm"><h3 className="flex items-center gap-1.5 font-semibold"><Landmark size={15} className="text-teal-700" />Bảo lãnh</h3>
          {d.guarantees.length === 0 ? <p className="mt-1 text-muted-foreground">HĐ chưa có dòng bảo lãnh (khai ở Dự án → Hợp đồng).</p>
            : <ul className="mt-1 space-y-1.5">{d.guarantees.map(g => <li key={g.id} className="flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 flex-1">{g.name}<span className="block text-xs text-muted-foreground">{g.amount ? `${shortMoney(g.amount)} · ${g.bankName || '—'} · hết hạn ${viDate(g.expiryDate)}` : 'chưa khai số tiền, hạn'}</span></span>
              {g.expiring ? <Badge className="border-rose-300 bg-rose-50 text-rose-700">Sắp hết hạn</Badge> : g.status === 'active' ? <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800">Hiệu lực</Badge>
                : g.status === 'draft' ? <Badge className="border-amber-300 bg-amber-50 text-amber-800">Chưa khai</Badge> : <Badge className="border-border bg-muted text-muted-foreground">{g.status === 'released' ? 'Đã giải tỏa' : 'Hết hạn'}</Badge>}
              {can.record && <button type="button" onClick={() => setDrawer({ kind: 'guarantee', g })} className="text-xs font-semibold text-teal-700 hover:underline">Khai</button>}</li>)}</ul>}</section>
        {d.openings.filter(o => o.status !== 'submitted').length > 0 && <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm">
          <h3 className="flex items-center gap-1.5 font-semibold"><ClipboardCheck size={15} className="text-teal-700" />Đầu kỳ</h3>
          <ul className="mt-1 space-y-1.5">{d.openings.filter(o => o.status !== 'submitted').map(o => <li key={o.id} className={o.status !== 'confirmed' ? 'opacity-60' : ''}>
            <b>{o.status === 'confirmed' ? 'Đã chốt' : o.status === 'rejected' ? 'Bị trả lại' : 'Đã hủy'}</b> {viDate(o.decidedAt)} · {o.decidedByName}
            <span className="block text-xs text-muted-foreground">phải thu {shortMoney(o.receivableAmount)} · tạm ứng {shortMoney(o.advanceRemaining)} · giữ lại {shortMoney(o.retentionHeld)}{o.decisionNote ? ` · ${o.decisionNote}` : ''}</span>
            {o.canCancel && <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => {
              const reason = await askReason({ title: 'Hủy chốt đầu kỳ', targetName: c.code, subtitle: 'Chỉ khi đợt "Số dư đầu kỳ" chưa có phiếu thu.', reasonLabel: 'Lý do', actionLabel: 'Hủy chốt', intent: 'danger' });
              if (reason) void run(() => financeService.decideCustomerOpening({ id: o.id, action: 'cancel', reason }), 'Đã hủy chốt đầu kỳ.');
            }}>Hủy chốt</button>}</li>)}</ul>
          {m.opening !== 'confirmed' && can.record && !pendingOpening && <button type="button" onClick={() => setDrawer({ kind: 'opening' })} className="mt-2 text-xs font-semibold text-teal-700 hover:underline">Đối chiếu lại</button>}</section>}
      </aside>
    </div>

    {drawer?.kind === 'round' && <RoundDrawer d={d} round={drawer.round} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'confirm' && <ConfirmRoundDrawer d={d} round={drawer.round} onClose={() => setDrawer(null)} onDone={done} />}
    {drawer?.kind === 'receipt' && <ReceiptDrawer d={d} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'opening' && <CustomerOpeningDrawer d={d} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'terms' && <CustomerTermsDrawer d={d} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'guarantee' && <GuaranteeDrawer g={drawer.g} onClose={() => setDrawer(null)} onSaved={done} />}
  </section>;
};
