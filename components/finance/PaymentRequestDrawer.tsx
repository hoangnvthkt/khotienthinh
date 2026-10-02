import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Send, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { SOURCE_LABELS, financeService, type FinancePaymentRequest, type FinanceRoutePreview, type FinanceSupplierDetail } from '../../lib/financeService';
import { Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, toneOf, viDate } from './financeUi';

// Lập (hoặc sửa và gửi lại) đề nghị chi cho một NCC: chọn chứng từ, số chi từng chứng từ, xem trước luồng duyệt theo ma trận.

const WARN = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100';

export const PaymentRequestDrawer: React.FC<{ supplierId: string; request?: FinancePaymentRequest | null; onClose: () => void; onSaved: (code: string) => void }> =
  ({ supplierId, request, onClose, onSaved }) => {
    const toast = useToast();
    const [detail, setDetail] = useState<FinanceSupplierDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reserved, setReserved] = useState<Record<string, number> | null>(null);
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [method, setMethod] = useState<'bank_transfer' | 'cash'>(request?.method || 'bank_transfer');
    const [plannedDate, setPlannedDate] = useState(request?.plannedDate || '');
    const [note, setNote] = useState(request?.note || '');
    const [preview, setPreview] = useState<FinanceRoutePreview | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      financeService.supplier(supplierId).then(async d => {
        setDetail(d);
        const open = d.documents.filter(x => x.outstanding > 0.5);
        const p = await financeService.previewPaymentRequest({ supplierId, requestId: request?.id, lines: open.map(x => ({ documentId: x.id, amount: x.outstanding })) });
        setReserved(p.reserved);
        setPlannedDate(cur => cur || new Date(Date.parse(`${d.today}T00:00:00`) + 2 * 86400000).toISOString().slice(0, 10));
        if (request) {
          setChecked(Object.fromEntries(request.lines.map(l => [l.documentId, true])));
          setAmounts(Object.fromEntries(request.lines.map(l => [l.documentId, moneyInput(l.amount)])));
        } else {
          // Gợi ý: chứng từ quá hạn và đến hạn trong 7 ngày, chi đủ phần còn chi được.
          const pick = open.filter(x => ['overdue', 'soon'].includes(toneOf(x.dueDate, x.outstanding, d.today)) && !x.issues.includes('internal_partner'));
          setChecked(Object.fromEntries(pick.map(x => [x.id, true])));
          setAmounts(Object.fromEntries(open.map(x => [x.id, moneyInput(Math.max(0, x.outstanding - x.pendingExternal - (p.reserved[x.id] || 0)))])));
        }
        if (!p.bank) setMethod(m => request ? m : 'cash');
      }).catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [supplierId, request]);

    const docs = useMemo(() => (detail?.documents || []).filter(d => d.outstanding > 0.5 || checked[d.id])
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [detail, checked]);
    const available = (id: string) => { const d = detail?.documents.find(x => x.id === id); return d ? Math.max(0, d.outstanding - d.pendingExternal - (reserved?.[id] || 0)) : 0; };
    const value = (id: string) => parseMoney(amounts[id] || '') || 0;
    const lines = docs.filter(d => checked[d.id]).map(d => ({ documentId: d.id, amount: value(d.id) }));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const linesKey = JSON.stringify(lines);

    useEffect(() => {
      if (!detail || !lines.length || total <= 0) { setPreview(null); return; }
      setPreviewing(true);
      const t = setTimeout(() => {
        financeService.previewPaymentRequest({ supplierId, requestId: request?.id, lines })
          .then(setPreview).catch(() => setPreview(null)).finally(() => setPreviewing(false));
      }, 350);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linesKey, detail]);

    const over = lines.some(l => l.amount > available(l.documentId) + 0.5);
    const internal = preview?.internal || detail?.supplier.internal;
    const blockers = [
      !lines.length && 'Chọn chứng từ cần chi', lines.some(l => !(l.amount > 0)) && 'Nhập số chi cho chứng từ đã chọn',
      over && 'Số chi lớn hơn phần còn chi được', internal && 'Đơn vị nội bộ — không chi tiền',
      method === 'bank_transfer' && preview && !preview.bank && 'NCC chưa có số tài khoản — chọn tiền mặt hoặc nhờ Mua hàng cập nhật',
      preview?.route.problemStep && `Bước "${preview.route.problemStep}" không còn người duyệt hợp lệ`,
      preview && !preview.canRecord && 'Cần quyền Tài chính — Ghi nhận', !plannedDate && 'Chọn ngày dự kiến chi',
    ].filter(Boolean) as string[];

    const submit = async () => {
      setBusy(true);
      try {
        const r = await financeService.savePaymentRequest({ requestId: request?.id, expectedRowVersion: request?.rowVersion, supplierId, method, plannedDate, note: note.trim() || undefined, lines });
        toast.success(request ? `Đã gửi lại ${r.code}` : `Đã gửi ${r.code}`, `${money(r.amount)} đ — chờ ${preview?.route.steps[0]?.eligibleNames.join(' hoặc ') || 'người duyệt'}.`);
        onSaved(r.code);
      } catch (e) { toast.error('Chưa gửi được đề nghị chi', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
    };

    return <Drawer label="Lập đề nghị chi" wide onClose={onClose}
      header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{request ? `Sửa và gửi lại ${request.code}` : 'Lập đề nghị chi'}</p>
        <h2 className={`text-lg ${ENT}`}>{detail?.supplier.name || request?.supplierName || '…'}</h2>
        {detail && <p className="text-sm text-muted-foreground">{lines.length} chứng từ · <b className={NUM}>{money(total)} đ</b></p>}</>}
      footer={<>{blockers.length > 0 && lines.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
        <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
        <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0 || previewing || !preview} onClick={() => void submit()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{request ? 'Gửi lại' : 'Gửi duyệt'} {money(total)} đ</button></>}>
      {error ? <StateBox kind="error" message={error} /> : !detail || !reserved ? <StateBox kind="loading" title="Đang tải chứng từ…" /> : <>
        <section className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)_8rem_9rem] gap-x-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span /><span>Chứng từ</span><span className="text-right">Còn chi được</span><span className="text-right">Chi lần này</span></div>
          {docs.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">NCC không còn chứng từ đang nợ.</p>}
          {docs.map(d => { const avail = available(d.id); const blocked = d.issues.includes('internal_partner') || (avail <= 0.5 && !checked[d.id]);
            return <label key={d.id} className={`grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem_9rem] ${blocked ? 'opacity-60' : ''}`}>
              <input type="checkbox" disabled={blocked} checked={!!checked[d.id]} onChange={e => setChecked(c => ({ ...c, [d.id]: e.target.checked }))} />
              <span className="min-w-0"><span className={`block truncate text-sm ${ENT}`}>{d.documentNo}</span>
                <span className="block text-xs text-muted-foreground">{d.projectCode || 'Kho công ty'} · {SOURCE_LABELS[d.sourceType] || d.sourceType} · hạn {viDate(d.dueDate)}
                  {(reserved[d.id] || 0) > 0 && <span className="text-amber-700"> · {money(reserved[d.id])} đ đang trong đề nghị khác</span>}
                  {d.pendingExternal > 0 && <span className="text-amber-700"> · {money(d.pendingExternal)} đ chi ngoài chờ xác nhận</span>}</span></span>
              <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm">{money(avail)}<span className="sm:hidden"> còn chi được</span></span>
              <input inputMode="numeric" aria-label={`Số chi ${d.documentNo}`} disabled={!checked[d.id]} value={amounts[d.id] || ''}
                onChange={e => setAmounts(a => ({ ...a, [d.id]: e.target.value }))} onBlur={() => setAmounts(a => ({ ...a, [d.id]: moneyInput(value(d.id)) }))}
                className={`col-start-2 text-right tabular-nums sm:col-start-auto ${inputCls} ${checked[d.id] && value(d.id) > avail + 0.5 ? 'border-rose-400' : ''}`} />
            </label>; })}
          <p className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span className="text-muted-foreground">Chi một phần thì chứng từ còn nợ phần còn lại.</span><span className={NUM}>{money(total)} đ</span></p>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">Hình thức
            <select value={method} onChange={e => setMethod(e.target.value as 'bank_transfer' | 'cash')} className={`mt-1 w-full ${inputCls}`}>
              <option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label>
          <label className="text-sm font-medium">Ngày dự kiến chi<input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
          <div className="text-sm"><span className="font-medium">Tài khoản NCC</span>
            <span className="mt-1 block rounded-lg border border-border bg-muted/30 px-2 py-1.5">{preview?.bank || detail.supplier.bankAccount
              ? <><b className="tabular-nums">{preview?.bank?.account || detail.supplier.bankAccount}</b> · {preview?.bank?.bankName || detail.supplier.bankName}</>
              : <span className="text-amber-700 dark:text-amber-300">Chưa có — Mua hàng cập nhật ở hồ sơ đối tác</span>}</span></div>
        </section>
        <label className="block text-sm font-medium">Ghi chú cho người duyệt
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: NCC đòi thanh toán đợt T9 trước 05/10" className={`mt-1 w-full ${inputCls}`} /></label>

        <section className="rounded-xl border border-border p-3">
          <h3 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={16} className="text-teal-700" />Luồng duyệt
            {previewing && <Loader2 size={14} className="animate-spin text-muted-foreground" />}</h3>
          {!preview ? <p className="mt-1 text-sm text-muted-foreground">Chọn chứng từ để xem ai duyệt.</p> : <>
            {preview.route.priorAmount > 0 && <p className={`mt-2 rounded-lg border px-3 py-2 text-xs ${WARN}`}>Cộng dồn {preview.route.priorRequests.map(r => r.code).join(', ')} trong 7 ngày ({money(preview.route.priorAmount)} đ)
              → xét ngưỡng theo {money(preview.route.thresholdAmount)} đ, tránh chia nhỏ để né duyệt.</p>}
            <ol className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {preview.route.steps.map((s, i) => <li key={i} className="flex items-center gap-2">{i > 0 && <span className="text-muted-foreground">→</span>}
                <span className={`rounded-lg border px-2 py-1 ${s.eligibleIds.length ? 'border-border' : 'border-rose-300 bg-rose-50 dark:bg-rose-950/30'}`}><b>{i + 1}. {s.label}</b>
                  <span className="block text-xs text-muted-foreground">{s.eligibleNames.length ? s.eligibleNames.join(' hoặc ') : 'Không còn người hợp lệ'}</span></span></li>)}
              <li className="flex items-center gap-2"><span className="text-muted-foreground">→</span><span className="rounded-lg border border-dashed border-border px-2 py-1"><b>Xác nhận đã chi</b>
                <span className="block text-xs text-muted-foreground">kế toán khác người lập và người duyệt</span></span></li></ol>
            {preview.route.handlerNames.length > 0 && <p className="mt-2 text-xs text-muted-foreground"><Lock size={12} className="inline" /> {preview.route.handlerNames.join(', ')} đã nhận hàng / lập-chốt chứng từ nên không duyệt và không xác nhận chi đề nghị này.</p>}
          </>}
        </section>
      </>}
    </Drawer>;
  };
