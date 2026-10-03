import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRightLeft, Check, CheckCircle2, FileText, HandCoins, Loader2, Plus, RotateCcw, Undo2, Wallet, X,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceAdvance, type FinanceAdvanceState, type FinanceAdvances, type FinanceAttachment } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, Kpi, NUM, daysBetween, moneyInput, parseMoney, shortMoney, viDate } from './financeUi';
import { AdvanceDrawer } from './AdvanceDrawer';

// Tạm ứng NCC (Phải trả): theo dõi số đã chi, đã cấn trừ vào công nợ, NCC đã hoàn, còn lại; xử lý tạm ứng quá hạn / chờ hoàn.

const STATE: Record<FinanceAdvanceState, { label: string; cls: string }> = {
  approving: { label: 'Đang duyệt', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  to_pay: { label: 'Chờ chi', cls: 'border-teal-300 bg-teal-50 text-teal-800' },
  open: { label: 'Còn tạm ứng', cls: 'border-teal-300 bg-teal-50 text-teal-800' },
  refund_due: { label: 'Chờ hoàn', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
  settled: { label: 'Đã cấn trừ hết', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  reversed: { label: 'Đã đảo', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  closed: { label: 'Không chi', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
};
const ADJ_STATUS: Record<string, string> = { submitted: 'Chờ xác nhận', confirmed: 'Đã xác nhận', rejected: 'Bị từ chối', withdrawn: 'Đã rút', reversed: 'Đã đảo' };
const RELEASE: Record<string, string> = { manual: 'kế toán hoàn tác', return: 'trả hàng NCC', document_cancel: 'chứng từ bị hủy' };

export type AdvanceFilter = 'active' | 'overdue' | 'refund' | 'approving' | 'done';

export const AdvancesView: React.FC<{ initialFilter?: AdvanceFilter; supplierId?: string | null; onChanged: () => void; onOpenRequests: () => void }> =
  ({ initialFilter = 'active', supplierId, onChanged, onOpenRequests }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const askReason = useReasonConfirm();
    const [data, setData] = useState<FinanceAdvances | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<AdvanceFilter>(initialFilter);
    const [sel, setSel] = useState<string | null>(null);
    const [mobile, setMobile] = useState(false);
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);
    const top = useRef<HTMLDivElement>(null);
    const [form, setForm] = useState<null | { kind: 'refund'; amount: string; date: string; ref: string; files: FinanceAttachment[]; reason: string }
      | { kind: 'transfer'; target: string; reason: string } | { kind: 'apply'; documentId: string; amount: string }>(null);

    const load = useCallback(() => { setError(null); financeService.advances(supplierId || undefined).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [supplierId]);
    useEffect(load, [load]);
    useEffect(() => setForm(null), [sel]);
    if (error) return <StateBox kind="error" message={error} onRetry={load} />;
    if (!data) return <StateBox kind="loading" title="Đang tải tạm ứng NCC…" />;
    const t = data.totals;
    const match = (a: FinanceAdvance) => filter === 'active' ? ['approving', 'to_pay', 'open', 'refund_due'].includes(a.state)
      : filter === 'overdue' ? a.overdue : filter === 'refund' ? a.state === 'refund_due' : filter === 'approving' ? ['approving', 'to_pay'].includes(a.state)
        : ['settled', 'reversed', 'closed'].includes(a.state);
    const list = data.advances.filter(match);
    const a = list.find(x => x.id === sel) || list[0] || null;
    const refresh = () => { load(); onChanged(); };
    const run = async (fn: () => Promise<unknown>, message: string) => {
      setBusy(true);
      try { await fn(); toast.success(a?.code || 'Tạm ứng', message); setForm(null); refresh(); }
      catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
    };

    const detail = (a: FinanceAdvance) => {
      const pctOff = a.amount ? Math.min(100, (a.offset / a.amount) * 100) : 0;
      const pctRef = a.amount ? Math.min(100 - pctOff, (a.refunded / a.amount) * 100) : 0;
      const pending = a.adjustments.find(j => j.status === 'submitted');
      const late = a.overdue ? daysBetween(data.today, a.repayDueDate) : 0;
      return <section className={`min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm ${mobile ? '' : 'hidden md:block'}`}>
        <button type="button" onClick={() => setMobile(false)} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 md:hidden"><ArrowLeft size={15} />Danh sách</button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className={`text-lg ${ENT}`}>{a.code}</span><Badge className={STATE[a.state].cls}>{STATE[a.state].label}</Badge>
            {a.overdue && <Badge className="overdue-blink border-rose-300 bg-rose-50 text-rose-700">Quá hạn hoàn ứng {late} ngày</Badge>}</p>
            <p className={`text-sm ${ENT}`}>{a.supplierName}</p>
            <p className="text-xs text-muted-foreground">{a.target?.kind === 'contract' ? 'HĐ nguyên tắc' : 'Đơn'} <b className="text-foreground">{a.target?.no}</b> · {a.projectCode || 'Kho Tổng (cấp công ty)'}
              {a.percent != null && ` · ${Number(a.percent).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% giá trị ${a.target?.kind === 'contract' ? 'HĐ' : 'đơn'}`} · hạn hoàn ứng {viDate(a.repayDueDate)}</p></div>
          <span className={`text-2xl ${NUM}`}>{money(a.amount)} đ</span>
        </div>
        {a.note && <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">{a.note}</p>}

        {a.state === 'refund_due' && <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><b>{a.target?.kind === 'contract' ? 'Hợp đồng' : 'Đơn'} đã kết thúc mà còn tạm ứng {money(a.remaining)} đ.</b> Ghi NCC hoàn tiền (kèm giấy báo có) hoặc chuyển sang đơn khác của NCC.</span></p>}
        {a.overdue && <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />NCC chưa giao đủ hàng để trừ tạm ứng — nhờ Mua hàng đôn đốc giao, hoặc thu hồi tạm ứng.</p>}
        {(a.state === 'approving' || a.state === 'to_pay') && <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
          {a.state === 'approving' ? <>Đang chờ duyệt: <b>{a.currentStepLabel}</b></> : 'Đã duyệt đủ — chờ kế toán chi và đính UNC.'}
          <button type="button" onClick={onOpenRequests} className="ml-auto font-semibold text-teal-700 hover:underline">Xem ở {a.state === 'approving' ? 'Đề nghị chi' : 'Chờ chi'}</button></p>}

        {a.paid && <>
          <div className="mt-4">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="h-full bg-leaf-500" style={{ width: `${pctOff}%` }} /><span className="h-full bg-teal-400" style={{ width: `${pctRef}%` }} /></div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              {([['Đã chi', a.amount, 'text-foreground'], ['Đã cấn trừ công nợ', a.offset, 'text-leaf-700 dark:text-leaf-300'], ['NCC đã hoàn', a.refunded, 'text-teal-700 dark:text-teal-300'],
                ['Còn lại', a.remaining, a.remaining > 0.5 && (a.overdue || a.state === 'refund_due') ? 'text-rose-700 dark:text-rose-300' : 'text-foreground']] as const).map(([l, v, c]) =>
                <div key={l} className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className={`font-semibold tabular-nums ${c}`}>{money(v)} đ</dd></div>)}
            </dl>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Chi ngày {viDate(a.paid.paymentDate)} · {a.paid.documentRef} · xác nhận bởi <span className={ENT}>{a.paid.byName}</span>
            {a.paid.attachments?.map(f => <button key={f.path} type="button" onClick={() => void financeService.openAttachment(f.path)} className="ml-2 inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline"><FileText size={12} />{f.name}</button>)}</p>
          {a.paid.reversal && <p className="mt-1 text-xs text-rose-700">Đã đảo phiếu chi bởi {a.paid.reversal.byName} {viDate(a.paid.reversal.at)}: {a.paid.reversal.reason}</p>}
          {a.target?.kind === 'po' && a.target.base != null && <p className="mt-1 text-xs text-muted-foreground">Đơn {a.target.no}: giá trị {shortMoney(a.target.base)} (gồm VAT) · kho đã nhận {shortMoney(a.target.received || 0)} · hẹn giao {viDate(a.target.expectedDate)}</p>}
        </>}

        <h3 className="mt-4 text-sm font-bold">Cấn trừ vào công nợ ({a.offsets.length})</h3>
        {a.offsets.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">{a.paid ? 'Chưa có. Khi kho nhận hàng của đơn (hoặc chốt đối soát HĐ) công nợ sinh ra sẽ tự trừ tạm ứng.' : 'Sau khi chi, công nợ của đơn sẽ tự trừ tạm ứng.'}</p>
          : <ul className="mt-1 divide-y divide-border rounded-xl border border-border">{a.offsets.map(o => { const active = o.amount - o.released;
            return <li key={o.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${o.status === 'released' ? 'opacity-60' : ''}`}>
              <span className="min-w-0 flex-1"><span className={ENT}>{o.documentNo}</span> <Badge className="border-border bg-muted text-muted-foreground">{o.mode === 'auto' ? 'Tự động' : 'Cấn tay'}</Badge>
                <span className="block text-xs text-muted-foreground">{new Date(o.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}{o.byName ? ` · ${o.byName}` : ''}
                  {o.released > 0 && ` · đã trả lại ${money(o.released)} đ (${RELEASE[o.releaseKind || 'manual']}${o.releaseReason && o.releaseKind === 'manual' ? `: ${o.releaseReason}` : ''})`}</span></span>
              <span className={`whitespace-nowrap ${NUM}`}>{money(active)} đ</span>
              {o.status === 'active' && a.canRelease && <button type="button" disabled={busy} className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => {
                const reason = await askReason({ title: 'Hoàn tác cấn trừ', targetName: `${o.documentNo} · ${money(active)} đ`, subtitle: 'Chứng từ trở lại còn nợ; số này quay về tạm ứng còn lại. Có thể cấn tay lại sau.',
                  reasonLabel: 'Lý do', reasonPlaceholder: 'VD: Cấn nhầm chứng từ — chờ hóa đơn', actionLabel: 'Hoàn tác', intent: 'warning' });
                if (reason) void run(() => financeService.releaseAdvanceOffset({ offsetId: o.id, reason }), `Đã hoàn tác cấn trừ ${o.documentNo}.`);
              }}>Hoàn tác</button>}
            </li>; })}</ul>}

        {a.adjustments.length > 0 && <>
          <h3 className="mt-4 text-sm font-bold">Hoàn tiền / chuyển đơn ({a.adjustments.length})</h3>
          <ul className="mt-1 space-y-2">{a.adjustments.map(j => <li key={j.id} className={`rounded-xl border px-3 py-2 text-sm ${j.status === 'submitted' ? 'border-amber-300' : 'border-border'} ${['rejected', 'withdrawn', 'reversed'].includes(j.status) ? 'opacity-60' : ''}`}>
            <p className="flex flex-wrap items-center gap-2">{j.kind === 'refund' ? <HandCoins size={14} className="text-teal-700" /> : <ArrowRightLeft size={14} className="text-teal-700" />}
              <b>{j.kind === 'refund' ? `NCC hoàn ${money(j.amount)} đ` : `Chuyển ${money(j.amount)} đ: ${j.sourcePoNumber} → ${j.targetPoNumber}`}</b>
              <Badge className={j.status === 'submitted' ? 'border-amber-300 bg-amber-50 text-amber-800' : j.status === 'confirmed' ? 'border-leaf-200 bg-leaf-50 text-leaf-800' : 'border-border bg-muted text-muted-foreground'}>{ADJ_STATUS[j.status]}</Badge></p>
            <p className="mt-0.5 text-xs text-muted-foreground">{j.kind === 'refund' && <>{viDate(j.paymentDate)} · {j.documentRef} · </>}“{j.reason}” · lập: <span className={ENT}>{j.createdByName}</span>
              {j.decidedByName && <> · {ADJ_STATUS[j.status].toLowerCase()}: <span className={ENT}>{j.decidedByName}</span> {viDate(j.decidedAt)}{j.decisionNote ? ` — ${j.decisionNote}` : ''}</>}</p>
            {j.attachments.length > 0 && <p className="mt-1 flex flex-wrap gap-2">{j.attachments.map(f => <button key={f.path} type="button" onClick={() => void financeService.openAttachment(f.path)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"><FileText size={12} />{f.name}</button>)}</p>}
            {(j.canDecide || j.canWithdraw || j.canReverse) && <div className="mt-2 flex flex-wrap justify-end gap-2">
              {j.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void run(() => financeService.decideAdvanceAdjustment({ adjustmentId: j.id, action: 'withdraw' }), 'Đã rút.')}><Undo2 size={14} />Rút</button>}
              {j.canDecide && <>
                <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                  const reason = await askReason({ title: 'Từ chối', targetName: a.code, reasonLabel: 'Lý do', actionLabel: 'Từ chối', intent: 'warning' });
                  if (reason) void run(() => financeService.decideAdvanceAdjustment({ adjustmentId: j.id, action: 'reject', reason }), 'Đã từ chối.');
                }}><X size={14} />Từ chối</button>
                <button type="button" disabled={busy} className={primaryBtn} onClick={async () => {
                  if (await confirm({ title: j.kind === 'refund' ? 'Xác nhận NCC đã hoàn tiền?' : 'Xác nhận chuyển tạm ứng?', targetName: `${a.code} · ${money(j.amount)} đ`, confirmText: 'Xác nhận',
                    actionLabel: 'Xác nhận', intent: 'success', countdownSeconds: 0,
                    warningText: j.kind === 'refund' ? `Đã đối chiếu ${j.documentRef} ngày ${viDate(j.paymentDate)}. Tạm ứng còn lại giảm ${money(j.amount)} đ; dòng tiền ra của dự án giảm tương ứng.`
                      : `Tạm ứng gắn sang ${j.targetPoNumber}; công nợ đang mở của đơn đó (nếu có) được trừ ngay.` }))
                    void run(() => financeService.decideAdvanceAdjustment({ adjustmentId: j.id, action: 'confirm' }), 'Đã xác nhận.');
                }}><Check size={14} />Xác nhận</button></>}
              {j.canReverse && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                const reason = await askReason({ title: 'Đảo phiếu thu hoàn tạm ứng', targetName: `${j.documentRef} · ${money(j.amount)} đ`, subtitle: 'Tạm ứng còn lại tăng lại; không xóa phiếu.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
                if (reason) void run(() => financeService.decideAdvanceAdjustment({ adjustmentId: j.id, action: 'reverse', reason }), 'Đã đảo phiếu thu hoàn.');
              }}><RotateCcw size={14} />Đảo</button>}
            </div>}
          </li>)}</ul></>}

        {form?.kind === 'refund' && <section className="mt-4 space-y-3 rounded-2xl border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20">
          <h3 className="font-semibold">NCC hoàn tạm ứng</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">Số tiền NCC trả<input value={form.amount} inputMode="numeric" onChange={e => setForm({ ...form, amount: e.target.value })} onBlur={() => setForm({ ...form, amount: moneyInput(parseMoney(form.amount) || 0) })} className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
            <label className="text-sm font-medium">Ngày nhận tiền<input type="date" max={data.today} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={`mt-1 w-full ${inputCls}`} /></label>
            <label className="text-sm font-medium">Số giấy báo có / phiếu thu<input value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} placeholder="VD: GBC 0310-01" className={`mt-1 w-full ${inputCls}`} /></label>
          </div>
          <AttachmentPicker supplierId={a.supplierId} value={form.files} onChange={files => setForm({ ...form, files })} label="Giấy báo có / phiếu thu (ảnh hoặc PDF)" required />
          <label className="block text-sm font-medium">Lý do<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="VD: Đơn kết thúc thiếu, NCC trả lại phần ứng dư" className={`mt-1 w-full ${inputCls}`} /></label>
          <div className="flex flex-wrap items-center justify-end gap-2"><span className="mr-auto text-xs text-muted-foreground">Người khác có quyền Xác nhận sẽ đối chiếu rồi xác nhận.</span>
            <button type="button" className={secondaryBtn} onClick={() => setForm(null)}>Thôi</button>
            <button type="button" className={primaryBtn} disabled={busy || !(parseMoney(form.amount) > 0) || parseMoney(form.amount) > a.remaining + 0.5 || !form.ref.trim() || !form.files.length || !form.reason.trim() || !form.date}
              onClick={() => void run(() => financeService.saveAdvanceAdjustment({ requestId: a.id, kind: 'refund', amount: parseMoney(form.amount), paymentDate: form.date, documentRef: form.ref.trim(),
                attachments: form.files, reason: form.reason.trim() }), 'Đã ghi NCC hoàn tiền — chờ người khác xác nhận.')}>{busy ? <Loader2 size={14} className="animate-spin" /> : <HandCoins size={14} />}Gửi xác nhận</button></div>
        </section>}
        {form?.kind === 'transfer' && <section className="mt-4 space-y-3 rounded-2xl border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20">
          <h3 className="font-semibold">Chuyển {money(a.remaining)} đ tạm ứng sang đơn khác</h3>
          {a.transferTargets.length === 0 ? <p className="text-sm text-muted-foreground">NCC không có đơn nào khác đang chờ giao cùng dự án {a.projectCode || ''}. Ghi NCC hoàn tiền thay vì chuyển.</p> : <>
            <select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className={`w-full ${inputCls}`} aria-label="Đơn nhận tạm ứng">
              <option value="">Chọn đơn cùng NCC, cùng dự án…</option>{a.transferTargets.map(p => <option key={p.id} value={p.id}>{p.poNumber} · {shortMoney(p.base)} · hẹn giao {viDate(p.expectedDate)}</option>)}</select>
            <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Lý do (bắt buộc) — VD: NCC không giao đơn này, ứng cho đơn kế tiếp" className={`w-full ${inputCls}`} /></>}
          <div className="flex justify-end gap-2"><button type="button" className={secondaryBtn} onClick={() => setForm(null)}>Thôi</button>
            {a.transferTargets.length > 0 && <button type="button" className={primaryBtn} disabled={busy || !form.target || !form.reason.trim()}
              onClick={() => void run(() => financeService.saveAdvanceAdjustment({ requestId: a.id, kind: 'transfer', targetPurchaseOrderId: form.target, reason: form.reason.trim() }), 'Đã gửi đề nghị chuyển — chờ người khác xác nhận.')}><ArrowRightLeft size={14} />Gửi xác nhận</button>}</div>
        </section>}
        {form?.kind === 'apply' && <section className="mt-4 space-y-2 rounded-2xl border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20">
          <h3 className="font-semibold">Cấn trừ tay vào chứng từ</h3>
          <ul className="space-y-1">{a.candidates.map(c => <li key={c.documentId}><label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="radio" name="apply-doc" checked={form.documentId === c.documentId} onChange={() => setForm({ ...form, documentId: c.documentId, amount: moneyInput(Math.min(c.available, a.remaining)) })} className="accent-teal-600" />
            <span className={ENT}>{c.documentNo}</span><span className="text-xs text-muted-foreground">ghi nợ {viDate(c.documentDate)} · còn trừ được {money(c.available)} đ</span></label></li>)}</ul>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input value={form.amount} inputMode="numeric" onChange={e => setForm({ ...form, amount: e.target.value })} className={`w-40 text-right tabular-nums ${inputCls}`} aria-label="Số cấn trừ" />
            <button type="button" className={secondaryBtn} onClick={() => setForm(null)}>Thôi</button>
            <button type="button" className={primaryBtn} disabled={busy || !form.documentId || !(parseMoney(form.amount) > 0)}
              onClick={() => void run(() => financeService.applyAdvanceOffset({ requestId: a.id, documentId: form.documentId, amount: parseMoney(form.amount) }), 'Đã cấn trừ.')}>Cấn trừ</button></div>
        </section>}

        {a.canAct && !form && <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{pending ? 'Đang có phiếu chờ xác nhận — xử lý xong mới lập tiếp.' : 'Còn tạm ứng: chờ kho nhận hàng để tự trừ, hoặc xử lý tay.'}</span>
          {a.candidates.length > 0 && <button type="button" className={secondaryBtn} onClick={() => setForm({ kind: 'apply', documentId: '', amount: '' })}>Cấn trừ tay</button>}
          {!pending && a.purchaseOrderId && <button type="button" className={secondaryBtn} onClick={() => setForm({ kind: 'transfer', target: '', reason: '' })}><ArrowRightLeft size={15} />Chuyển sang đơn khác</button>}
          {!pending && <button type="button" className={a.state === 'refund_due' ? primaryBtn : secondaryBtn} onClick={() => setForm({ kind: 'refund', amount: moneyInput(a.remaining), date: data.today, ref: '', files: [], reason: '' })}><HandCoins size={15} />NCC hoàn tiền</button>}
        </div>}
      </section>;
    };

    return <div ref={top} className="scroll-mt-4 space-y-3">
      <section className={`grid grid-cols-2 gap-2 lg:grid-cols-4 ${mobile ? 'hidden md:grid' : ''}`}>
        <Kpi active={filter === 'active'} onClick={() => setFilter('active')} icon={HandCoins} label="Tạm ứng còn lại" value={shortMoney(t.remaining)} hint={`${t.openCount} khoản đã chi, chưa trừ hết`} tone="text-leaf-700 dark:text-leaf-300" />
        <Kpi active={filter === 'overdue'} onClick={() => setFilter('overdue')} icon={AlertTriangle} label="Quá hạn hoàn ứng" value={shortMoney(t.overdue)} hint={`${t.overdueCount} khoản · NCC chưa giao hàng`}
          tone={t.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'} blink={t.overdue > 0} />
        <Kpi active={filter === 'refund'} onClick={() => setFilter('refund')} icon={RotateCcw} label="Chờ hoàn" value={shortMoney(t.refundDue)} hint={`${t.refundDueCount} khoản · đơn đã kết thúc`} tone={t.refundDue > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'} />
        <Kpi active={filter === 'approving'} onClick={() => setFilter('approving')} icon={Wallet} label="Đang duyệt / chờ chi" value={String(t.approving)} hint={t.approving ? shortMoney(t.approvingAmount) : 'không có'} tone="text-teal-700 dark:text-teal-300" />
      </section>
      <div className={`flex flex-wrap items-center gap-2 ${mobile ? 'hidden md:flex' : ''}`}>
        <p className="min-w-[14rem] flex-1 text-sm text-muted-foreground">Tạm ứng gắn đơn hàng / HĐ nguyên tắc → duyệt như đề nghị chi → chi (UNC) → kho nhận hàng thì <b className="text-foreground">tự trừ vào công nợ</b>. Tạm ứng là tiền ra, không phải chi phí.</p>
        <button type="button" onClick={() => setFilter(filter === 'done' ? 'active' : 'done')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-teal-700 hover:bg-muted">
          <CheckCircle2 size={15} />{filter === 'done' ? 'Đang theo dõi' : 'Đã xong / đã đảo'}</button>
        {t.adjustmentsWaitingMe > 0 && <Badge className="border-amber-300 bg-amber-50 text-amber-800">{t.adjustmentsWaitingMe} phiếu chờ bạn xác nhận</Badge>}
        {data.can.record && <button type="button" onClick={() => setCreating(true)} className={primaryBtn}><Plus size={15} />Lập đề nghị tạm ứng</button>}
      </div>
      {list.length === 0 ? <StateBox kind="empty" title={filter === 'active' ? 'Chưa có tạm ứng nào đang theo dõi' : filter === 'overdue' ? 'Không có tạm ứng quá hạn hoàn ứng' : filter === 'refund' ? 'Không có tạm ứng chờ hoàn' : filter === 'approving' ? 'Không có đề nghị tạm ứng đang duyệt' : 'Chưa có khoản nào đã xong'}
        message={filter === 'active' ? 'Khi NCC yêu cầu ứng trước, lập đề nghị tạm ứng gắn với đơn hàng. Kho nhận hàng của đơn đó thì số tạm ứng tự trừ vào công nợ.' : ''} />
        : <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ul className={`h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
            {list.map(x => <li key={x.id}><button type="button" onClick={() => { setSel(x.id); setMobile(true); requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' })); }}
              className={`flex w-full items-start gap-3 border-b border-l-4 border-border px-3 py-3 text-left ${x.state === 'refund_due' || x.overdue ? 'border-l-rose-500' : x.state === 'open' ? 'border-l-leaf-500' : 'border-l-slate-300'} ${a?.id === x.id ? 'bg-teal-50/70 dark:bg-teal-950/20' : 'hover:bg-muted/40'}`}>
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className={ENT}>{x.code}</span><Badge className={STATE[x.state].cls}>{STATE[x.state].label}</Badge>
                {x.adjustments.some(j => j.canDecide) && <Badge className="border-teal-500 bg-teal-600 text-white">Chờ bạn xác nhận</Badge>}</span>
                <span className="block truncate text-sm">{x.supplierName}</span>
                <span className={`text-xs ${x.overdue ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>{x.target?.no} · {x.projectCode || 'Kho Tổng'} · {x.overdue ? `quá hạn ${daysBetween(data.today, x.repayDueDate)} ngày` : `hạn ${viDate(x.repayDueDate)}`}</span></span>
              <span className="text-right"><span className={`block whitespace-nowrap text-sm ${NUM}`}>{shortMoney(x.paid ? x.remaining : x.amount)}</span>
                <span className="text-[11px] text-muted-foreground">{x.paid ? 'còn lại' : 'đề nghị'}</span></span></button></li>)}
          </ul>
          {a && detail(a)}
        </div>}
      {creating && <AdvanceDrawer supplierId={supplierId} onClose={() => setCreating(false)} onSaved={code => { setCreating(false); toast.success(code, 'Xem tiến độ duyệt ở bước Đề nghị chi.'); refresh(); }} />}
    </div>;
  };
