import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, Check, FileText, HandCoins, Loader2, RotateCcw, Send, Undo2, Wallet, X } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceAttachment, type FinancePaymentRequest, type FinancePaymentRequests, type FinanceRequestStatus } from '../../lib/financeService';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, CashAccountSelect, ENT, NUM, shortMoney, viDate } from './financeUi';
import { PaymentRequestDrawer } from './PaymentRequestDrawer';
import { AdvanceDrawer } from './AdvanceDrawer';
import { COST_CATEGORIES, EXPENSE_CATEGORIES, ExpenseDrawer } from './CashDrawers';

// Bước 3–5 của Phải trả: Đề nghị chi (đang duyệt) → Chờ chi (đã duyệt) → Đã chi (có UNC, đảo được).

export type RequestStage = 'request' | 'approved' | 'paid';
const STATUS: Record<FinanceRequestStatus, { label: string; cls: string }> = {
  pending: { label: 'Chờ duyệt', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  returned: { label: 'Bị trả lại', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
  approved: { label: 'Chờ chi', cls: 'border-teal-300 bg-teal-50 text-teal-800' },
  paid: { label: 'Đã chi', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  rejected: { label: 'Từ chối', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
  withdrawn: { label: 'Đã rút', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  cancelled: { label: 'Đã hủy', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  reversed: { label: 'Đã đảo', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
};
const EMPTY: Record<RequestStage, [string, string]> = {
  request: ['Không có đề nghị chi đang duyệt', 'Lập đề nghị chi từ chi tiết NCC ở bước Đang nợ; đề nghị tạm ứng lập ở Tạm ứng NCC.'],
  approved: ['Không có khoản chờ chi', 'Đề nghị đã duyệt đủ sẽ chờ ở đây để kế toán chi và đính UNC.'],
  paid: ['Chưa có khoản đã chi', 'Khoản chi đã xác nhận (kèm UNC) hiện ở đây.'],
};

const PayDrawer: React.FC<{ r: FinancePaymentRequest; today: string; onClose: () => void; onDone: () => void }> = ({ r, today, onClose, onDone }) => {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [ref, setRef] = useState('');
  const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const [note, setNote] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const byProject = Object.entries(r.lines.reduce((m, l) => ({ ...m, [l.projectCode || 'Kho công ty']: (m[l.projectCode || 'Kho công ty'] || 0) + l.amount }), {} as Record<string, number>));
  const blockers = [!cashAccountId && 'Chọn tài khoản đã chi', !ref.trim() && 'Nhập số UNC / phiếu chi', !files.length && 'Đính file UNC', date > today && 'Ngày chi không được sau hôm nay'].filter(Boolean) as string[];
  const submit = async () => {
    setBusy(true);
    try {
      await financeService.confirmPaymentRequest({ requestId: r.id, expectedRowVersion: r.rowVersion, paymentDate: date, documentRef: ref.trim(), attachments: files, note: note.trim() || undefined, cashAccountId });
      toast.success(`${r.code}: đã chi ${money(r.amount)} đ`, r.kind === 'expense' ? 'Đã ghi vào sổ thu chi.' : r.kind === 'advance' ? 'Đã ghi phiếu chi tạm ứng và dòng tiền ra; kho nhận hàng của đơn sẽ tự trừ tạm ứng.' : 'Công nợ đã giảm; phiếu chi tách theo dự án đã ghi sổ.');
      onDone();
    } catch (e) { toast.error('Chưa xác nhận được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  return <Drawer label="Xác nhận đã chi" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Xác nhận đã chi</p><h2 className={`text-lg ${ENT}`}>{r.code} · {r.supplierName}</h2><p className={NUM}>{money(r.amount)} đ</p></>}
    footer={<>{blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void submit()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}Xác nhận đã chi</button></>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">Ngày chi<input type="date" max={today} value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="text-sm font-medium">Số UNC / phiếu chi<input value={ref} onChange={e => setRef(e.target.value)} placeholder="VD: UNC 1002-03" className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    <p className="text-sm text-muted-foreground">{r.method === 'bank_transfer' ? <>Chuyển khoản tới <b className="text-foreground">{r.bank?.account}</b> · {r.bank?.bankName}</> : 'Chi tiền mặt'}</p>
    <CashAccountSelect value={cashAccountId} onChange={setCashAccountId} label="Chi từ tài khoản" hint="Sổ thu chi của tài khoản này tự ghi khoản chi." />
    <AttachmentPicker supplierId={r.supplierId || 'expense'} value={files} onChange={setFiles} label="UNC / phiếu chi (ảnh hoặc PDF)" required />
    <label className="block text-sm font-medium">Ghi chú<input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
    <section className="rounded-xl border border-border p-3 text-sm"><h3 className="font-bold">Hệ thống sẽ ghi</h3>
      {r.kind === 'expense' ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        <li>Ghi khoản chi vào sổ thu chi của tài khoản đã chọn.</li>
        <li>{r.expense?.projectCode ? `Ghi chi phí dự án ${r.expense.projectCode} theo khoản mục ${COST_CATEGORIES[r.expense.costCategory || 'other'] || ''}.` : 'Chi phí chung công ty — không vào chi phí dự án.'}</li>
      </ul> : r.kind === 'advance' ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        <li>Phiếu chi tạm ứng cho <b className="text-foreground">{r.advance?.projectCode || 'Kho Tổng (cấp công ty)'}</b> · {r.advance?.poNumber ? `đơn ${r.advance.poNumber}` : `HĐ ${r.advance?.contractCode}`}.</li>
        <li>Ghi dòng tiền ra của dự án. Không ghi chi phí — chi phí ghi khi kho nhận hàng.</li>
        <li>Công nợ của {r.advance?.poNumber ? 'đơn' : 'HĐ'} sinh ra (đã có hoặc sau này) tự trừ tạm ứng cho tới khi hết.</li>
      </ul> : <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        <li>Phiếu chi theo từng dự án: {byProject.map(([p, v]) => <b key={p} className="text-foreground">{p} {money(v)} đ </b>)}</li>
        <li>Giảm công nợ {r.lines.length} chứng từ; chứng từ chi một phần vẫn còn nợ phần còn lại.</li>
        <li>Ghi dòng tiền ra của dự án. Chi phí dự án không đổi (đã ghi lúc nhận hàng / ghi nợ).</li>
      </ul>}</section>
  </Drawer>;
};

export const PaymentRequestsView: React.FC<{ stage: RequestStage; today: string; initialRequestId?: string | null; onChanged: () => void }> = ({ stage, today, initialRequestId, onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [data, setData] = useState<FinancePaymentRequests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(initialRequestId || null);
  const [mobile, setMobile] = useState(Boolean(initialRequestId));
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(false);
  const [resubmit, setResubmit] = useState(false);

  const load = useCallback(() => { setError(null); financeService.paymentRequests(stage).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [stage]);
  useEffect(load, [load]);
  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải đề nghị chi…" />;
  if (!data.requests.length) return <StateBox kind="empty" title={EMPTY[stage][0]} message={EMPTY[stage][1]} />;
  const r = data.requests.find(x => x.id === sel) || data.requests[0];
  const refresh = () => { load(); onChanged(); };
  const act = async (action: 'approve' | 'return' | 'reject' | 'withdraw' | 'cancel', reason?: string) => {
    setBusy(true);
    try {
      const res = await financeService.decidePaymentRequest({ requestId: r.id, expectedRowVersion: r.rowVersion, action, reason });
      toast.success(r.code, action === 'approve' ? (res.status === 'approved' ? 'Đã duyệt đủ — chuyển sang Chờ chi.' : `Đã duyệt, chuyển ${r.route[res.currentStep]?.eligibleNames.join(' hoặc ') || 'bước sau'}.`)
        : action === 'return' ? `Đã trả lại cho ${r.createdByName}.` : action === 'withdraw' ? 'Đã rút đề nghị.' : 'Chứng từ trở lại Đang nợ.');
      refresh();
    } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const ask = async (action: 'return' | 'reject' | 'cancel') => {
    const t = { return: ['Trả lại cho người lập', 'Trả lại'], reject: ['Từ chối đề nghị chi', 'Từ chối'], cancel: ['Hủy đề nghị đã duyệt', 'Hủy đề nghị'] }[action];
    const reason = await askReason({ title: t[0], targetName: `${r.code} · ${money(r.amount)} đ`, reasonLabel: 'Lý do', actionLabel: t[1], intent: action === 'return' ? 'warning' : 'danger' });
    if (reason) void act(action, reason);
  };
  const current = r.steps.filter(s => s.submissionNo === r.submissionNo);
  const approvals = current.filter(s => s.action === 'approve');
  const lastReturn = [...r.steps].reverse().find(s => s.action === 'return' || s.action === 'reject');
  const byProject = Object.entries(r.lines.reduce((m, l) => ({ ...m, [l.projectCode || 'Kho công ty']: (m[l.projectCode || 'Kho công ty'] || 0) + l.amount }), {} as Record<string, number>));

  return <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
    <ul className={`h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
      {data.requests.map(x => <li key={x.id}><button type="button" onClick={() => { setSel(x.id); setMobile(true); }}
        className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left ${r.id === x.id ? 'bg-teal-50/70 dark:bg-teal-950/20' : 'hover:bg-muted/40'}`}>
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className={ENT}>{x.code}</span><Badge className={STATUS[x.status].cls}>{STATUS[x.status].label}</Badge>
          {x.kind === 'expense' && <Badge className="border-slate-200 bg-slate-100 text-slate-700">Chi khác · {EXPENSE_CATEGORIES[x.expense?.category || ''] || x.expense?.category}</Badge>}
          {x.kind === 'advance' && <Badge className="border-mint-200 bg-mint-50 text-mint-800"><HandCoins size={11} className="mr-0.5 inline" />Tạm ứng {x.advance?.poNumber || x.advance?.contractCode}</Badge>}
          {x.canApprove && <Badge className="border-teal-500 bg-teal-600 text-white">Chờ bạn duyệt</Badge>}{x.canConfirm && <Badge className="border-teal-500 bg-teal-600 text-white">Bạn chi được</Badge>}</span>
          <span className="block truncate text-sm">{x.supplierName}</span>
          <span className="text-xs text-muted-foreground">{x.status === 'pending' ? `Bước ${x.currentStep + 1}/${x.route.length}: ${x.route[x.currentStep]?.label}` : x.paid ? `${x.paid.documentRef} · ${viDate(x.paid.paymentDate)}` : `Lập bởi ${x.createdByName || '—'} · ${viDate(x.createdAt)}`}</span></span>
        <span className={`whitespace-nowrap text-sm ${NUM}`}>{shortMoney(x.amount)}</span></button></li>)}
    </ul>
    <section className={`min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm ${mobile ? '' : 'hidden md:block'}`}>
      <button type="button" onClick={() => setMobile(false)} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 md:hidden"><ArrowLeft size={15} />Danh sách</button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className={`text-lg ${ENT}`}>{r.code}</span><Badge className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></p>
          <p className="text-sm">{r.supplierName}</p>
          <p className="text-xs text-muted-foreground">Lập bởi {r.createdByName} · {new Date(r.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
            {r.method === 'bank_transfer' ? `CK ${r.bank?.account || ''} ${r.bank?.bankName || ''}` : 'Tiền mặt'} · dự kiến chi {viDate(r.plannedDate)}</p></div>
        <span className={`text-2xl ${NUM}`}>{money(r.amount)} đ</span>
      </div>
      {r.note && <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">{r.note}</p>}
      {r.status === 'returned' && lastReturn && <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
        {lastReturn.actorName} trả lại: “{lastReturn.reason}”</p>}
      {r.thresholdAmount > r.amount + 0.5 && <p className="mt-2 text-xs text-muted-foreground">Ngưỡng duyệt xét theo {money(r.thresholdAmount)} đ (cộng dồn {r.priorRequests.map(p => p.code).join(', ')} trong 7 ngày).</p>}

      <h3 className="mt-4 text-sm font-bold">Luồng duyệt</h3>
      <ol className="mt-2 space-y-2">{r.route.map((s, i) => { const done = approvals.find(a => a.stepNo === i); const now = r.status === 'pending' && i === r.currentStep;
        return <li key={i} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? 'bg-leaf-600 text-white' : now ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground'}`}>{done ? <Check size={12} /> : i + 1}</span>
          <span><b>{s.label}</b> <span className="text-muted-foreground">— {done ? `${done.actorName}, ${new Date(done.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}` : now ? `đang chờ ${s.eligibleNames.join(' hoặc ')}` : s.eligibleNames.join(' hoặc ')}</span></span></li>; })}
        <li className="flex items-start gap-2 text-sm"><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${r.paid ? 'bg-leaf-600 text-white' : 'bg-muted text-muted-foreground'}`}>{r.paid ? <Check size={12} /> : <Wallet size={11} />}</span>
          <span><b>Xác nhận đã chi</b> <span className="text-muted-foreground">— {r.paid ? `${r.paid.byName}, ${viDate(r.paid.paymentDate)} · ${r.paid.documentRef}` : 'kế toán khác người lập và người duyệt'}</span></span></li></ol>

      {r.kind === 'expense' && r.expense ? <section className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm">
        <h3 className="font-bold">Phiếu chi khác — không qua NCC</h3>
        <p className="mt-1">{EXPENSE_CATEGORIES[r.expense.category] || r.expense.category} · nhận: <b>{r.supplierName}</b> · {r.expense.projectCode ? <>tính chi phí dự án <b>{r.expense.projectCode}</b> ({COST_CATEGORIES[r.expense.costCategory || 'other'] || r.expense.costCategory})</> : 'chi phí chung công ty'}</p>
        {r.cashEntry && <p className="mt-1 text-xs text-muted-foreground">Đã chi từ {r.cashEntry.accountName} ngày {viDate(r.cashEntry.date)}</p>}
      </section> : r.kind === 'advance' && r.advance ? <section className="mt-4 rounded-xl border border-mint-200 bg-mint-50/40 p-3 text-sm dark:border-mint-900 dark:bg-mint-950/20">
        <h3 className="flex items-center gap-1.5 font-bold"><HandCoins size={15} className="text-teal-700" />Tạm ứng NCC — chưa có chứng từ công nợ</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          {([[r.advance.poNumber ? 'Đơn hàng' : 'HĐ nguyên tắc', r.advance.poNumber || r.advance.contractCode || '—'], ['Dự án', r.advance.projectCode || 'Kho Tổng'],
            ['Tỷ lệ', r.advance.percent != null ? `${Number(r.advance.percent).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% của ${shortMoney(r.advance.base || 0)}` : 'HĐ chưa có giá trị'],
            ['Hạn hoàn ứng', viDate(r.advance.repayDueDate)]] as const).map(([l, v]) =>
            <div key={l} className="rounded-lg bg-card px-2 py-1.5"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{r.paid ? `Đã cấn trừ vào công nợ ${money(r.advance.offset)} đ — theo dõi ở Phải trả → Tạm ứng NCC.` : 'Sau khi chi: kho nhận hàng của đơn (hoặc chốt đối soát HĐ) thì công nợ tự trừ tạm ứng.'}</p>
      </section> : <>
      <h3 className="mt-4 text-sm font-bold">Chứng từ ({r.lines.length})</h3>
      <ul className="mt-1 divide-y divide-border rounded-xl border border-border">{r.lines.map(l => <li key={l.documentId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0"><span className={`block truncate ${ENT}`}>{l.documentNo}</span><span className="text-xs text-muted-foreground">{l.projectCode || 'Kho công ty'} · hạn {viDate(l.dueDate)}{l.amount < l.outstandingSnapshot - 0.5 ? ` · chi một phần / còn ${money(l.outstandingSnapshot)} đ` : ''}</span></span>
        <span className={`whitespace-nowrap ${NUM}`}>{money(l.amount)}</span></li>)}</ul></>}
      {byProject.length > 1 && !r.paid && <p className="mt-2 text-xs text-muted-foreground">Khi xác nhận đã chi, hệ thống tự tách phiếu chi theo dự án: {byProject.map(([p, v]) => `${p} ${money(v)} đ`).join(' · ')}.</p>}
      {r.paid && <div className="mt-3 rounded-xl border border-border px-3 py-2 text-sm">
        <p>Chi ngày <b>{viDate(r.paid.paymentDate)}</b> · {r.paid.documentRef} · xác nhận bởi <span className={ENT}>{r.paid.byName}</span></p>
        <p className="mt-1 flex flex-wrap gap-2">{r.paid.attachments.map(a => <button key={a.path} type="button" onClick={() => void financeService.openAttachment(a.path)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"><FileText size={12} />{a.name}</button>)}</p>
        {r.paid.reversal && <p className="mt-1 text-xs text-rose-700">Đã đảo bởi {r.paid.reversal.byName} {viDate(r.paid.reversal.at)}: {r.paid.reversal.reason}</p>}
      </div>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-teal-700">Nhật ký ({r.steps.length})</summary>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{r.steps.map((s, i) => <li key={i}>{new Date(s.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })} · <b className="text-foreground">{s.actorName}</b> · {s.label}{s.action === 'approve' ? ' — duyệt' : s.action === 'return' ? ' — trả lại' : s.action === 'reject' ? ' — từ chối' : ''}{s.reason ? `: ${s.reason}` : ''}</li>)}</ul></details>

      <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        {r.status === 'pending' && <>
          <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{r.canApprove ? `Bạn duyệt bước ${r.currentStep + 1}: ${r.route[r.currentStep]?.label}` : `Đang chờ ${r.route[r.currentStep]?.eligibleNames.join(' hoặc ')}`}</span>
          {r.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void act('withdraw')}><RotateCcw size={15} />Rút</button>}
          {r.canApprove && <>
            <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void ask('return')}><Undo2 size={15} />Trả lại</button>
            <button type="button" disabled={busy} className={`${secondaryBtn} text-rose-700`} onClick={() => void ask('reject')}><Ban size={15} />Từ chối</button>
            <button type="button" disabled={busy} className={primaryBtn} onClick={async () => {
              if (await confirm({ title: 'Duyệt đề nghị chi?', targetName: `${r.code} · ${money(r.amount)} đ`, confirmText: 'Duyệt', actionLabel: 'Duyệt', intent: 'success', countdownSeconds: 0,
                warningText: r.currentStep + 1 >= r.route.length ? 'Đây là bước cuối — đề nghị chuyển sang Chờ chi.' : `Sau bạn: ${r.route[r.currentStep + 1].label} (${r.route[r.currentStep + 1].eligibleNames.join(' hoặc ')}).` })) void act('approve');
            }}><Check size={15} />Duyệt</button></>}
        </>}
        {r.status === 'returned' && <>
          <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{r.canResubmit ? `Sửa ${r.kind === 'advance' ? 'số tiền / hạn hoàn ứng' : 'số tiền / chứng từ'} rồi gửi lại — luồng duyệt chạy lại từ đầu.` : `Chờ ${r.createdByName} sửa và gửi lại.`}</span>
          {r.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void act('withdraw')}><RotateCcw size={15} />Rút</button>}
          {r.canResubmit && <button type="button" className={primaryBtn} onClick={() => setResubmit(true)}><Send size={15} />Sửa và gửi lại</button>}
        </>}
        {r.status === 'approved' && <>
          <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{r.canConfirm ? 'Chi xong thì đính UNC để ghi giảm công nợ.' : 'Người xác nhận chi phải khác người lập, người duyệt và người đã nhận hàng / chốt đối soát.'}</span>
          {r.canCancel && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void ask('cancel')}><X size={15} />Hủy đề nghị</button>}
          {r.canConfirm && <button type="button" className={primaryBtn} onClick={() => setPay(true)}><Wallet size={15} />Xác nhận đã chi</button>}
        </>}
        {r.status === 'paid' && <>
          <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{r.kind === 'expense' ? 'Chi nhầm thì đảo (không xóa) — sổ thu chi ghi dòng ngược chiều.' : r.kind === 'advance' ? 'Chi nhầm thì đảo (không xóa) — chỉ đảo được khi tạm ứng chưa cấn trừ / chưa có phiếu hoàn.' : 'Chi nhầm NCC / sai số tiền thì đảo (không xóa) — công nợ trở lại Đang nợ.'}</span>
          {r.canReverse && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
            const reason = await askReason({ title: 'Đảo phiếu chi', targetName: `${r.code} · ${money(r.amount)} đ`, subtitle: r.kind === 'expense' ? 'Sổ thu chi và chi phí dự án (nếu có) được ghi đảo. Không xóa phiếu.' : r.kind === 'advance' ? 'Tạm ứng về 0, dòng tiền ra được ghi đảo. Không xóa phiếu chi.' : 'Công nợ được cộng lại, dòng tiền ra được ghi đảo. Không xóa phiếu chi.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
            if (!reason) return;
            setBusy(true);
            try { await financeService.reversePaymentRequest({ requestId: r.id, expectedRowVersion: r.rowVersion, reason }); toast.success(r.code, r.kind !== 'payable' && r.kind ? 'Đã đảo phiếu chi — sổ thu chi được ghi đảo.' : 'Đã đảo phiếu chi — công nợ trở lại Đang nợ.'); refresh(); }
            catch (e) { toast.error('Chưa đảo được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
          }}><RotateCcw size={15} />Đảo phiếu chi</button>}
        </>}
        {['reversed', 'rejected', 'withdrawn', 'cancelled'].includes(r.status) && <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{r.kind === 'expense' ? 'Phiếu chi khác đã kết thúc.' : r.kind === 'advance' ? 'Đề nghị tạm ứng đã kết thúc.' : 'Đề nghị đã kết thúc — chứng từ trở lại Đang nợ.'}</span>}
      </div>
    </section>
    {pay && <PayDrawer r={r} today={today} onClose={() => setPay(false)} onDone={() => { setPay(false); refresh(); }} />}
    {resubmit && (r.kind === 'expense' ? <ExpenseDrawer request={r} onClose={() => setResubmit(false)} onSaved={() => { setResubmit(false); refresh(); }} />
      : r.kind === 'advance' ? <AdvanceDrawer supplierId={r.supplierId} request={r} onClose={() => setResubmit(false)} onSaved={() => { setResubmit(false); refresh(); }} />
      : <PaymentRequestDrawer supplierId={r.supplierId} request={r} onClose={() => setResubmit(false)} onSaved={() => { setResubmit(false); refresh(); }} />)}
  </div>;
};
