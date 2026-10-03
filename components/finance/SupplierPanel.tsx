import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Ban, Banknote, CalendarClock, Check, ChevronDown, ChevronRight, ClipboardCheck, FileText, HandCoins, History, Loader2,
  RotateCcw, ShieldCheck, Undo2, X,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import {
  DUE_SOURCE_LABELS, EVENT_LABELS, ISSUE_LABELS, METHOD_LABELS, SOURCE_LABELS, financeService,
  type FinanceAdvances, type FinanceDocument, type FinancePayment, type FinanceSupplierDetail,
} from '../../lib/financeService';
import { AdvanceDrawer } from './AdvanceDrawer';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ExternalPaymentDrawer } from './ExternalPaymentDrawer';
import { OpeningDrawer } from './OpeningDrawer';
import { PaymentRequestDrawer } from './PaymentRequestDrawer';
import { TermsDrawer } from './TermsDrawer';
import { ENT, NUM, TONE_BAR, TONE_TEXT, dueText, shortMoney, toneOf, viDate } from './financeUi';

const Provenance: React.FC<{ d: FinanceDocument }> = ({ d }) => {
  const p = d.provenance || {};
  const rows: React.ReactNode[] = [];
  if (d.sourceType === 'purchase_delivery_receipt') {
    rows.push(<>Đơn hàng <b className={ENT}>{p.poNumber || '—'}</b> · đợt giao {p.deliveryNo ?? '—'}</>);
    rows.push(<>Kho <b className={ENT}>{p.warehouse || '—'}</b> nhận {viDate(p.receivedAt as string)} · <span className={ENT}>{p.receivedByName || '—'}</span></>);
    rows.push(<>Công nợ tự sinh khi kho nhận hàng{d.origin === 'receipt_reconciliation' ? ' — ghi lùi ngày từ đối chiếu nhận hàng' : ''}</>);
  } else if (d.sourceType === 'supplier_delivery_statement') {
    rows.push(<>Hợp đồng <b className={ENT}>{d.contractCode || '—'}</b></>);
    rows.push(<>Bảng đối soát <b className={ENT}>{p.statementCode}</b> · kỳ {viDate(p.periodMonth as string).slice(3)} · {p.notes ?? 0} phiếu giao</>);
    rows.push(<>Lập: <span className={ENT}>{p.createdByName || '—'}</span> · Chốt: <span className={ENT}>{p.confirmedByName || '—'}</span> · Ghi nợ: <span className={ENT}>{p.postedByName || '—'}</span> {viDate(p.postedAt as string)}</>);
  } else if (d.sourceType === 'direct_supplier_receipt') {
    rows.push(<>Phiếu nhập trực tiếp <b className={ENT}>{p.transactionId as string}</b> · kho <b className={ENT}>{(p.warehouse as string) || '—'}</b>{p.note ? ` · ${p.note}` : ''}</>);
    rows.push(<>Lập: <span className={ENT}>{(p.receivedByName as string) || '—'}</span> · Duyệt nhập: <span className={ENT}>{(p.approvedByName as string) || '—'}</span> · Ghi nợ: <span className={ENT}>{(p.postedByName as string) || '—'}</span> {viDate(p.postedAt as string)}</>);
    rows.push(<>Tiền hàng <b className={NUM}>{money(Number(p.netAmount || 0))} đ</b> · {p.priceIncludesVat ? 'giá đã gồm VAT' : `VAT ${Number(p.vatRate || 0)}% = ${money(Number(p.vatAmount || 0))} đ`}{p.duplicateOf ? ` · đã đối chiếu không trùng ${p.duplicateOf as string}` : ''}</>);
  } else if (d.sourceType === 'opening_balance') {
    rows.push(<>Đối chiếu đầu kỳ: sổ MISA <b className={NUM}>{money(Number(p.misaAmount || 0))} đ</b></>);
    rows.push(<>Lập: <span className={ENT}>{p.createdByName}</span> · Chốt: <span className={ENT}>{p.confirmedByName}</span> {viDate(p.confirmedAt as string)}</>);
  }
  rows.push(<>Hạn {viDate(d.dueDate)} — {DUE_SOURCE_LABELS[d.dueSource || 'default']}</>);
  return <ol className="mt-2 space-y-1 border-l-2 border-mint-200 pl-3 text-xs text-muted-foreground dark:border-mint-900">{rows.map((r, i) => <li key={i}>{r}</li>)}</ol>;
};

export const SupplierPanel: React.FC<{ supplierId: string; onBack: () => void; onChanged: () => void; onOpenAdvances?: () => void }> = ({ supplierId, onBack, onChanged, onOpenAdvances }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [detail, setDetail] = useState<FinanceSupplierDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [dueEdit, setDueEdit] = useState<{ id: string; date: string; reason: string } | null>(null);
  const [drawer, setDrawer] = useState<{ kind: 'external'; documentId?: string | null } | { kind: 'opening'; projectId?: string | null } | { kind: 'terms' } | { kind: 'request' } | { kind: 'advance' } | null>(null);
  const [advances, setAdvances] = useState<FinanceAdvances | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    setError(null);
    financeService.supplier(supplierId).then(setDetail).catch(e => setError(e instanceof Error ? e.message : String(e)));
    financeService.advances(supplierId).then(setAdvances).catch(() => setAdvances(null));
  }, [supplierId]);
  useEffect(() => { setDetail(null); setOpenDoc(null); load(); }, [load]);

  const done = (message: string) => { toast.success(detail?.supplier.name || 'Tài chính', message); setDrawer(null); load(); onChanged(); };
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await fn(); done(message); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    if (!detail) return [];
    const byProject = new Map<string, FinanceDocument[]>();
    detail.documents.forEach(d => { const k = d.projectCode || 'Kho công ty'; byProject.set(k, [...(byProject.get(k) || []), d]); });
    return Array.from(byProject.entries()).map(([project, docs]) => ({
      project, name: docs[0].projectId ? docs[0].projectName : 'Hàng dự trữ — công nợ cấp công ty, chi phí vào dự án khi chuyển kho', contracts: Array.from(new Set(docs.map(d => d.contractCode || ''))).map(c => ({ c, docs: docs.filter(d => (d.contractCode || '') === c) })),
    }));
  }, [detail]);

  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!detail) return <StateBox kind="loading" title="Đang tải công nợ NCC…" />;
  const { can, today, currentUserId: me } = detail;
  const openDocs = detail.documents.filter(d => d.outstanding > 0);
  const owed = openDocs.reduce((s, d) => s + d.outstanding, 0);
  const overdue = openDocs.filter(d => toneOf(d.dueDate, d.outstanding, today) === 'overdue').reduce((s, d) => s + d.outstanding, 0);
  const soon = openDocs.filter(d => toneOf(d.dueDate, d.outstanding, today) === 'soon').reduce((s, d) => s + d.outstanding, 0);
  const paid = detail.documents.reduce((s, d) => s + d.paid, 0);
  const liveAdvances = (advances?.advances || []).filter(a => ['approving', 'to_pay', 'open', 'refund_due'].includes(a.state));
  const advanceLeft = liveAdvances.reduce((s, a) => s + a.remaining, 0);
  const preProjects = Array.from(new Set(detail.documents.filter(d => d.documentDate < detail.cutoverDate && d.sourceType !== 'opening_balance').map(d => d.projectCode || '')));
  const waitingMe = detail.payments.filter(p => p.status === 'submitted' && can.confirm && p.createdBy !== me).length
    + detail.documents.filter(d => d.pendingAdjustment && can.confirm && d.pendingAdjustment.createdBy !== me).length
    + detail.openings.filter(o => o.status === 'submitted' && can.confirm && o.createdBy !== me).length;

  const docActions = (d: FinanceDocument) => {
    const adj = d.pendingAdjustment;
    return <div className="mt-2 flex flex-wrap items-center gap-2">
      {adj ? <>
        <p className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Đề xuất hủy công nợ: “{adj.reason}” · <span className={ENT}>{adj.createdByName}</span> {viDate(adj.createdAt)}</p>
        {can.confirm && adj.createdBy !== me && <>
          <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
            const reason = await askReason({ title: 'Từ chối hủy công nợ', targetName: d.documentNo, reasonLabel: 'Lý do', actionLabel: 'Từ chối', intent: 'warning' });
            if (reason) void run(() => financeService.decideAdjustment({ adjustmentId: adj.id, action: 'reject', reason }), `Đã từ chối hủy ${d.documentNo} — công nợ giữ nguyên.`);
          }}><X size={14} />Từ chối</button>
          <button type="button" disabled={busy} className={primaryBtn} onClick={async () => {
            if (await confirm({ title: 'Xác nhận hủy công nợ?', targetName: d.documentNo, confirmText: 'Hủy công nợ', actionLabel: 'Hủy công nợ', intent: 'warning', countdownSeconds: 0,
              warningText: `${money(d.outstanding)} đ không còn là nợ phải trả. Chứng từ được giữ lại để truy vết (trạng thái "Đã hủy").` }))
              void run(() => financeService.decideAdjustment({ adjustmentId: adj.id, action: 'confirm' }), `Đã hủy công nợ ${d.documentNo}.`);
          }}><Check size={14} />Xác nhận hủy</button></>}
        {adj.createdBy === me && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void run(() => financeService.decideAdjustment({ adjustmentId: adj.id, action: 'withdraw' }), 'Đã rút đề xuất hủy.')}><Undo2 size={14} />Rút đề xuất</button>}
      </> : <>
        {can.record && !detail.supplier.internal && d.outstanding - d.pendingExternal > 0.5 && <button type="button" className={secondaryBtn} onClick={() => setDrawer({ kind: 'external', documentId: d.id })}><Banknote size={14} />Ghi đã trả ngoài</button>}
        {can.record && d.paid === 0 && d.pendingExternal === 0 && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
          const reason = await askReason({ title: 'Đề xuất hủy công nợ', targetName: d.documentNo, subtitle: 'Dùng khi chứng từ không phải nợ NCC (VD điều chuyển nội bộ, ghi trùng). Người khác xác nhận mới hủy.',
            reasonLabel: 'Lý do', reasonPlaceholder: 'VD: Điều chuyển nội bộ RICO → DA29, không phải nợ NCC', actionLabel: 'Gửi đề xuất', intent: 'warning' });
          if (reason) void run(() => financeService.requestCancel({ documentId: d.id, reason }), `Đã gửi đề xuất hủy ${d.documentNo} — chờ người khác xác nhận.`);
        }}><Ban size={14} />Đề xuất hủy</button>}
      </>}
      {can.manage && (dueEdit?.id === d.id
        ? <span className="flex w-full flex-wrap items-center gap-2">
          <input type="date" value={dueEdit.date} min={d.documentDate} onChange={e => setDueEdit({ ...dueEdit, date: e.target.value })} className={inputCls} />
          <input value={dueEdit.reason} onChange={e => setDueEdit({ ...dueEdit, reason: e.target.value })} placeholder="Lý do sửa hạn (bắt buộc)" className={`min-w-[12rem] flex-1 ${inputCls}`} />
          <button type="button" disabled={busy || !dueEdit.reason.trim()} className={primaryBtn} onClick={() => void run(() => financeService.setDue({ documentId: d.id, dueDate: dueEdit.date || null, reason: dueEdit.reason.trim() }), `Đã sửa hạn ${d.documentNo}.`).then(() => setDueEdit(null))}>Lưu hạn</button>
          <button type="button" className={secondaryBtn} onClick={() => setDueEdit(null)}>Thôi</button></span>
        : <button type="button" className={secondaryBtn} onClick={() => setDueEdit({ id: d.id, date: d.dueDate || '', reason: '' })}><CalendarClock size={14} />Sửa hạn</button>)}
    </div>;
  };

  const paymentRow = (p: FinancePayment) => <li key={p.id} className={`rounded-xl border bg-card px-3 py-2.5 ${p.status === 'submitted' ? 'border-amber-300' : 'border-border'} ${['cancelled', 'reversed'].includes(p.status) ? 'opacity-60' : ''}`}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={ENT}>{p.code}</span>
      <Badge className={p.status === 'paid' ? 'border-leaf-200 bg-leaf-50 text-leaf-800' : p.status === 'submitted' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-border bg-muted text-muted-foreground'}>
        {p.status === 'paid' ? (p.kind === 'advance' ? 'Đã chi' : 'Đã trừ công nợ') : p.status === 'submitted' ? 'Chờ xác nhận' : p.status === 'reversed' ? 'Đã đảo' : p.rejection ? 'Bị từ chối' : 'Đã rút'}</Badge>
      {p.external && <Badge className="border-slate-200 bg-slate-100 text-slate-700">Chi ngoài hệ thống</Badge>}
      {p.kind === 'advance' && <Badge className="border-mint-200 bg-mint-50 text-mint-800">Tạm ứng {p.requestCode}</Badge>}
      <span className="text-xs text-muted-foreground">{p.projectCode} · {viDate(p.paymentDate)} · {METHOD_LABELS[p.method] || p.method} · {p.documentRef}</span>
      <span className={`ml-auto ${NUM}`}>{money(p.amount)} đ</span>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{p.kind === 'advance' ? (p.allocations?.length ? `Đã cấn trừ: ${p.allocations.map(a => `${a.documentNo} ${money(a.amount)} đ`).join(' · ')}` : 'Chưa cấn trừ vào chứng từ nào')
      : (p.allocations || []).map(a => `${a.documentNo}: ${money(a.amount)} đ`).join(' · ')}</p>
    <p className="mt-0.5 text-xs text-muted-foreground">Lập: <span className={ENT}>{p.createdByName}</span>{p.paidByName ? <> · Xác nhận: <span className={ENT}>{p.paidByName}</span> {viDate(p.paidAt)}</> : ''}
      {p.rejection ? ` · Từ chối: ${p.rejection.reason}` : ''}{p.reversal ? ` · Lý do đảo: ${p.reversal}` : ''}</p>
    {p.attachments.length > 0 && <p className="mt-1 flex flex-wrap gap-2">{p.attachments.map(a => <button key={a.path} type="button" onClick={() => void financeService.openAttachment(a.path)}
      className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"><FileText size={12} />{a.name}</button>)}</p>}
    {(p.status === 'submitted' || (p.status === 'paid' && p.external && can.confirm)) && <div className="mt-2 flex flex-wrap justify-end gap-2">
      {p.status === 'submitted' && p.createdBy === me && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void run(() => financeService.decideExternalPayment({ paymentId: p.id, action: 'withdraw', expectedRowVersion: p.rowVersion }), `Đã rút ${p.code}.`)}><Undo2 size={14} />Rút</button>}
      {p.status === 'submitted' && can.confirm && p.createdBy !== me && <>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
          const reason = await askReason({ title: 'Từ chối khoản chi', targetName: `${p.code} · ${p.documentRef}`, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: UNC không khớp số tiền', actionLabel: 'Từ chối', intent: 'warning' });
          if (reason) void run(() => financeService.decideExternalPayment({ paymentId: p.id, action: 'reject', reason, expectedRowVersion: p.rowVersion }), `Đã từ chối ${p.code}.`);
        }}><X size={14} />Từ chối</button>
        <button type="button" disabled={busy} className={primaryBtn} onClick={async () => {
          if (await confirm({ title: 'Xác nhận đã chi?', targetName: `${p.code} · ${money(p.amount)} đ`, confirmText: 'Xác nhận', actionLabel: 'Xác nhận đã chi', intent: 'success', countdownSeconds: 0,
            warningText: `Đã đối chiếu UNC ${p.documentRef} ngày ${viDate(p.paymentDate)}. Công nợ sẽ giảm ${money(p.amount)} đ và ghi dòng tiền ra của dự án.` }))
            void run(() => financeService.decideExternalPayment({ paymentId: p.id, action: 'confirm', expectedRowVersion: p.rowVersion }), `Đã xác nhận ${p.code} — công nợ giảm ${money(p.amount)} đ.`);
        }}><ShieldCheck size={14} />Xác nhận đã chi</button></>}
      {p.status === 'paid' && p.external && can.confirm && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
        const reason = await askReason({ title: 'Đảo khoản chi', targetName: `${p.code} · ${money(p.amount)} đ`, subtitle: 'Công nợ được cộng lại, dòng tiền ra được ghi đảo. Không xóa khoản chi.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
        if (reason) void run(() => financeService.decideExternalPayment({ paymentId: p.id, action: 'reverse', reason, expectedRowVersion: p.rowVersion }), `Đã đảo ${p.code}.`);
      }}><RotateCcw size={14} />Đảo</button>}
    </div>}
  </li>;

  return <section className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="border-b border-border p-4">
      <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 md:hidden"><ArrowLeft size={15} />Danh sách</button>
      <div className="flex flex-wrap items-center gap-2"><h2 className={`text-lg ${ENT}`}>{detail.supplier.name}</h2>
        {detail.supplier.internal && <Badge className="border-amber-300 bg-amber-50 text-amber-800" title={detail.supplier.internalReason || ''}>Đơn vị nội bộ</Badge>}</div>
      <p className="text-xs text-muted-foreground">{[detail.supplier.taxCode && `MST ${detail.supplier.taxCode}`, detail.supplier.bankAccount && `${detail.supplier.bankName || 'TK'} ${detail.supplier.bankAccount}`].filter(Boolean).join(' · ')}
        {' '}· Hạn: {detail.supplier.terms ? `${detail.supplier.terms.paymentDays} ngày (theo NCC)` : `mặc định ${detail.defaultPaymentDays} ngày`}
        {detail.contracts.some(c => c.paymentTermDays != null) && `, ${detail.contracts.filter(c => c.paymentTermDays != null).length} HĐ có hạn riêng`}
        {can.manage && <> · <button type="button" onClick={() => setDrawer({ kind: 'terms' })} className="font-semibold text-teal-700 hover:underline">Khai hạn thanh toán</button></>}</p>
      {detail.supplier.internal && <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{detail.supplier.internalReason} — không chi tiền; đề xuất hủy công nợ.</p>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        {([['Đang nợ', shortMoney(owed), NUM], ['Quá hạn', shortMoney(overdue), `font-semibold tabular-nums ${overdue > 0 ? 'text-rose-700' : 'text-muted-foreground'}`],
          ['Đến hạn 7 ngày', shortMoney(soon), `font-semibold tabular-nums ${soon > 0 ? 'text-amber-700' : 'text-muted-foreground'}`], [advanceLeft > 0.5 || liveAdvances.length ? 'Đã trả (gồm cấn trừ tạm ứng)' : 'Đã chi trong Vioo', shortMoney(paid), 'font-semibold tabular-nums text-foreground']] as const).map(([l, v, c]) =>
          <div key={l} className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className={c}>{v}</dd></div>)}
      </dl>
      {advanceLeft > 0.5 && <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-mint-200 bg-mint-50/50 px-3 py-2 text-sm dark:border-mint-900 dark:bg-mint-950/20">
        <span className="inline-flex items-center gap-1.5"><HandCoins size={15} className="text-teal-700" />Tạm ứng còn lại <b className={NUM}>{shortMoney(advanceLeft)}</b></span>
        {owed - advanceLeft >= 0 ? <span>Phải trả ròng <b className={NUM}>{shortMoney(owed - advanceLeft)}</b></span>
          : <span>Ứng vượt nợ <b className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">{shortMoney(advanceLeft - owed)}</b></span>}
        <span className="text-xs text-muted-foreground">đang nợ − tạm ứng còn lại · tự trừ khi kho nhận hàng của đơn</span></p>}
      {preProjects.length > 0 && <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} />Đầu kỳ:
        {preProjects.map(code => { const o = detail.openings.find(x => (x.projectCode || '') === code && x.status !== 'cancelled');
          return <button key={code} type="button" onClick={() => setDrawer({ kind: 'opening', projectId: detail.documents.find(d => (d.projectCode || '') === code)?.projectId })}
            className={`rounded-full border px-2 py-0.5 font-semibold ${o?.status === 'confirmed' ? 'border-leaf-200 bg-leaf-50 text-leaf-800' : o?.status === 'submitted' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
            {code}: {o?.status === 'confirmed' ? 'đã chốt' : o?.status === 'submitted' ? 'chờ xác nhận' : o?.status === 'rejected' ? 'bị trả lại' : o ? 'nháp' : 'chưa đối chiếu'}</button>; })}</p>}
      {waitingMe > 0 && <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">{waitingMe} việc đang chờ bạn xác nhận ở NCC này.</p>}
    </div>

    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {groups.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Không còn chứng từ công nợ đang theo dõi.</p>}
      {groups.map(g => <div key={g.project} className="overflow-hidden rounded-xl border border-border">
        <p className="flex items-center gap-2 bg-teal-50/70 px-3 py-2 text-sm dark:bg-teal-950/20"><ChevronDown size={15} className="shrink-0" /><b className={`shrink-0 ${ENT}`}>{g.project}</b><span className="min-w-0 truncate text-xs text-muted-foreground">{g.name}</span></p>
        {g.contracts.map(c => <div key={c.c}>
          <p className="border-t border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">{c.c ? <>Hợp đồng <span className={ENT}>{c.c}</span></> : 'Không theo hợp đồng'}
            <span className={`float-right ${NUM}`}>{money(c.docs.reduce((a, d) => a + d.outstanding, 0))} đ</span></p>
          <ul className="divide-y divide-border border-t border-border">{c.docs.map(d => {
            const tone = toneOf(d.dueDate, d.outstanding, today); const open = openDoc === d.id;
            return <li key={d.id} className={`border-l-4 bg-card ${TONE_BAR[tone]}`}>
              <button type="button" onClick={() => setOpenDoc(open ? null : d.id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-muted/40">
                <ChevronRight size={14} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] md:basis-auto">
                  <span className={ENT}>{d.documentNo}</span>
                  <Badge className="ml-2 border-border bg-muted text-muted-foreground">{SOURCE_LABELS[d.sourceType] || d.sourceType}</Badge>
                  {d.issues.length > 0 && <Badge className="ml-1 border-amber-300 bg-amber-50 text-amber-800">Cần xử lý</Badge>}
                  {d.pendingExternal > 0 && <Badge className="ml-1 border-amber-300 bg-amber-50 text-amber-800">Chi chờ xác nhận</Badge>}
                  <span className="block text-xs text-muted-foreground">Ghi nợ {viDate(d.documentDate)} · hạn {viDate(d.dueDate)}{d.paid > 0 ? ` · đã trả ${money(d.paid)} đ` : ''}</span>
                </span>
                <span className={`pl-5 text-xs font-semibold md:pl-0 ${TONE_TEXT[tone]} ${tone === 'overdue' ? 'overdue-blink' : ''}`}>{dueText(d.dueDate, d.outstanding, today)}</span>
                <span className={`ml-auto whitespace-nowrap text-right md:w-32 ${NUM}`}>{money(d.outstanding)} đ</span>
              </button>
              {open && <div className="px-3 pb-3 pl-9">
                {d.issues.map(i => <p key={i} className="mt-1 flex gap-1.5 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{ISSUE_LABELS[i]}</p>)}
                <Provenance d={d} />
                <p className="mt-2 text-xs text-muted-foreground">Ghi nhận <b className="text-foreground">{money(d.recognized)} đ</b>{d.credit > 0 ? ` · giảm trừ ${money(d.credit)} đ` : ''} · đã trả {money(d.paid)} đ · Hóa đơn: <span className="italic">ghi ở K3c</span></p>
                {docActions(d)}
              </div>}
            </li>;
          })}</ul>
        </div>)}
      </div>)}

      {liveAdvances.length > 0 && <section className="overflow-hidden rounded-xl border border-border">
        <h3 className="flex items-center gap-2 bg-mint-50/60 px-3 py-2 text-sm font-semibold dark:bg-mint-950/20"><HandCoins size={15} className="text-teal-700" />Tạm ứng ({liveAdvances.length})
          {onOpenAdvances && <button type="button" onClick={onOpenAdvances} className="ml-auto text-xs font-semibold text-teal-700 hover:underline">Xử lý ở Tạm ứng NCC</button>}</h3>
        <ul className="divide-y divide-border text-sm">{liveAdvances.map(a => <li key={a.id} className="space-y-1 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2"><b className={ENT}>{a.code}</b>
            <Badge className="border-teal-200 bg-teal-50 text-teal-800">{a.target?.no} · {a.projectCode || 'Kho Tổng'}</Badge>
            {a.state === 'approving' || a.state === 'to_pay' ? <Badge className="border-amber-300 bg-amber-50 text-amber-800">{a.state === 'approving' ? 'Đang duyệt' : 'Chờ chi'}</Badge>
              : a.state === 'refund_due' ? <Badge className="border-rose-300 bg-rose-50 text-rose-700">Chờ hoàn</Badge>
                : a.overdue ? <Badge className="overdue-blink border-rose-300 bg-rose-50 text-rose-700">Quá hạn hoàn ứng</Badge> : null}
            <span className={`ml-auto ${NUM}`}>{money(a.paid ? a.remaining : a.amount)} đ</span></div>
          {a.paid && <div className="flex items-center gap-2 text-xs"><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-leaf-500" style={{ width: `${a.amount ? Math.min(100, ((a.offset + a.refunded) / a.amount) * 100) : 0}%` }} /></span>
            <span className="tabular-nums text-muted-foreground">đã trừ {shortMoney(a.offset + a.refunded)} / {shortMoney(a.amount)} · hạn {viDate(a.repayDueDate)}</span></div>}
        </li>)}</ul>
      </section>}

      {detail.payments.length > 0 && <section>
        <h3 className="mb-2 font-semibold text-foreground">Khoản chi ({detail.payments.length})</h3>
        <ul className="space-y-2">{detail.payments.map(paymentRow)}</ul>
      </section>}

      {detail.events.length > 0 && <section>
        <button type="button" onClick={() => setShowHistory(v => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><History size={15} />Lịch sử ({detail.events.length})
          <ChevronDown size={14} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} /></button>
        {showHistory && <ol className="mt-2 space-y-1 text-sm">{detail.events.map((e, i) => <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span className="tabular-nums">{new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span className="font-medium text-foreground">{EVENT_LABELS[e.action] || e.action}</span><span>· {e.actorName}</span>
          {e.reason && <span className="w-full pl-4 italic">“{e.reason}”</span>}</li>)}</ol>}
      </section>}
    </div>

    <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
      <span className="mr-auto text-xs text-muted-foreground">{can.confirm ? 'Bạn ghi nhận và xác nhận được — nhưng không xác nhận việc do chính bạn lập.' : can.record ? 'Bạn ghi nhận được; người khác có quyền Xác nhận sẽ xác nhận.' : 'Bạn chỉ xem.'}</span>
      {can.record && !detail.supplier.internal && <button type="button" className={secondaryBtn} onClick={() => setDrawer({ kind: 'external' })}><Banknote size={15} />Ghi chi ngoài hệ thống</button>}
      {can.record && !detail.supplier.internal && <button type="button" onClick={() => setDrawer({ kind: 'advance' })} className={secondaryBtn}><HandCoins size={15} />Lập tạm ứng</button>}
      {can.record && !detail.supplier.internal && openDocs.length > 0 && <button type="button" onClick={() => setDrawer({ kind: 'request' })} className={primaryBtn}><FileText size={15} />Lập đề nghị chi</button>}
      {(can.record || can.confirm) && preProjects.length > 0 && <button type="button" onClick={() => setDrawer({ kind: 'opening' })} className={primaryBtn}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}Đối chiếu đầu kỳ</button>}
    </footer>

    {drawer?.kind === 'request' && <PaymentRequestDrawer supplierId={detail.supplier.id} onClose={() => setDrawer(null)} onSaved={code => done(`Đã gửi ${code} — xem ở bước Đề nghị chi.`)} />}
    {drawer?.kind === 'external' && <ExternalPaymentDrawer detail={detail} initialDocumentId={drawer.documentId} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'opening' && <OpeningDrawer detail={detail} projectId={drawer.projectId} onClose={() => setDrawer(null)} onChanged={done}
      onExternalPayment={documentId => setDrawer({ kind: 'external', documentId })} />}
    {drawer?.kind === 'terms' && <TermsDrawer detail={detail} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'advance' && <AdvanceDrawer supplierId={detail.supplier.id} onClose={() => setDrawer(null)} onSaved={code => done(`Đã gửi ${code} — xem ở bước Đề nghị chi.`)} />}
  </section>;
};
