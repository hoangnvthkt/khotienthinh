import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Loader2, Search, Send, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  financeService, type FinanceAdvanceOptions, type FinanceAdvancePreview, type FinanceAdvanceSupplier, type FinancePaymentRequest,
} from '../../lib/financeService';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, shortMoney, viDate } from './financeUi';

// Lập (hoặc sửa và gửi lại) đề nghị tạm ứng NCC: gắn một đơn hàng hoặc một HĐ nguyên tắc + dự án, % / số tiền, hạn hoàn ứng, lý do.
// Duyệt theo ma trận đề nghị chi; vượt ngưỡng % thì thêm bước duyệt (cài ở Quản trị). Kho nhận hàng của đơn đó thì tự cấn trừ.

const WARN = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export const AdvanceDrawer: React.FC<{ supplierId?: string | null; request?: FinancePaymentRequest | null; onClose: () => void; onSaved: (code: string) => void }> =
  ({ supplierId: initialSupplier, request, onClose, onSaved }) => {
    const toast = useToast();
    const [supplierId, setSupplierId] = useState<string | null>(initialSupplier || request?.supplierId || null);
    const [suppliers, setSuppliers] = useState<FinanceAdvanceSupplier[] | null>(null);
    const [q, setQ] = useState('');
    const [opt, setOpt] = useState<FinanceAdvanceOptions | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'po' | 'contract'>(request?.advance?.contractId ? 'contract' : 'po');
    const [poId, setPoId] = useState<string | null>(request?.advance?.purchaseOrderId || null);
    const [contractId, setContractId] = useState<string>(request?.advance?.contractId || '');
    const [projectId, setProjectId] = useState<string>(request?.advance?.projectId || '');
    const [pct, setPct] = useState('');
    const [amount, setAmount] = useState(request ? moneyInput(request.amount) : '');
    const [due, setDue] = useState(request?.advance?.repayDueDate || '');
    const [note, setNote] = useState(request?.note || '');
    const [method, setMethod] = useState<'bank_transfer' | 'cash'>(request?.method || 'bank_transfer');
    const [plannedDate, setPlannedDate] = useState(request?.plannedDate || '');
    const [preview, setPreview] = useState<FinanceAdvancePreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (supplierId) return;
      financeService.advanceSuppliers().then(d => setSuppliers(d.suppliers)).catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [supplierId]);
    useEffect(() => {
      if (!supplierId) return;
      setOpt(null);
      financeService.advanceOptions(supplierId).then(d => {
        setOpt(d);
        setPlannedDate(cur => cur || addDays(d.today, 2));
        if (!d.supplier.bankAccount && !request) setMethod('cash');
        if (!request && d.orders.length === 1) setPoId(d.orders[0].id);
        if (!request && !d.orders.length && d.contracts.length) setMode('contract');
      }).catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [supplierId, request]);

    const order = opt?.orders.find(o => o.id === poId) || null;
    const contract = opt?.contracts.find(c => c.id === contractId) || null;
    const base = mode === 'po' ? order?.base ?? null : contract?.value ?? null;
    // Đã tạm ứng khác (trừ chính đề nghị đang sửa) để biết phần còn ứng được.
    const other = mode === 'po' && order ? Math.max(0, order.advanced - (request && request.advance?.purchaseOrderId === order.id ? request.amount : 0)) : 0;
    const value = parseMoney(amount) || 0;
    const percent = base ? (value * 100) / base : null;

    // Hạn hoàn ứng mặc định = ngày hẹn giao + số ngày cài ở Quản trị (không lấy ngày đã qua).
    useEffect(() => {
      if (request || !opt) return;
      const expected = mode === 'po' ? order?.expectedDate : contract?.expiryDate;
      const d = expected ? addDays(expected, opt.settings.graceDays) : '';
      setDue(d && d >= opt.today ? d : '');
    }, [order, contract, mode, opt, request]);

    const targetKey = mode === 'po' ? poId : contractId ? `${contractId}:${projectId}` : null;
    useEffect(() => {
      if (!supplierId || !targetKey || value <= 0) { setPreview(null); setPreviewError(null); return; }
      setPreviewing(true);
      const t = setTimeout(() => {
        financeService.previewAdvance({ supplierId, requestId: request?.id, purchaseOrderId: mode === 'po' ? poId : null,
          contractId: mode === 'contract' ? contractId : null, projectId: mode === 'contract' ? projectId || null : null, amount: value })
          .then(p => { setPreview(p); setPreviewError(null); }).catch(e => { setPreview(null); setPreviewError(e instanceof Error ? e.message : String(e)); })
          .finally(() => setPreviewing(false));
      }, 350);
      return () => clearTimeout(t);
    }, [supplierId, targetKey, value, mode, poId, contractId, projectId, request?.id]);

    const setFromPct = (v: string) => { setPct(v); const n = Number(v.replace(',', '.')); if (base && Number.isFinite(n)) setAmount(moneyInput(Math.round((base * n) / 100))); };
    const setFromAmount = (v: string) => { setAmount(v); const n = parseMoney(v); setPct(base && Number.isFinite(n) ? (Math.round((n * 1000) / base) / 10).toString() : ''); };
    useEffect(() => { if (base && value) setPct((Math.round((value * 1000) / base) / 10).toString()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [base]);

    const available = base != null ? Math.max(0, base - other) : null;
    const settings = opt?.settings;
    const blockers = [
      !targetKey && (mode === 'po' ? 'Chọn đơn hàng' : 'Chọn hợp đồng'),
      !(value > 0) && 'Nhập số tiền tạm ứng', available != null && value > available + 0.5 && 'Vượt giá trị đơn còn ứng được',
      !due && 'Chọn hạn hoàn ứng', !note.trim() && 'Ghi lý do tạm ứng', !plannedDate && 'Chọn ngày dự kiến chi',
      method === 'bank_transfer' && opt && !opt.supplier.bankAccount && 'NCC chưa có số tài khoản — chọn tiền mặt hoặc nhờ Mua hàng khai ở hồ sơ đối tác',
      opt?.supplier.internal && 'Đơn vị nội bộ — không chi tiền',
      preview?.route.problemStep && `Bước "${preview.route.problemStep}" chưa có người duyệt hợp lệ`,
      preview && !preview.canRecord && 'Cần quyền Tài chính — Ghi nhận', previewError,
    ].filter(Boolean) as string[];

    const submit = async () => {
      if (!supplierId) return;
      setBusy(true);
      try {
        const r = await financeService.saveAdvance({ requestId: request?.id, expectedRowVersion: request?.rowVersion, supplierId,
          purchaseOrderId: mode === 'po' ? poId : null, contractId: mode === 'contract' ? contractId : null, projectId: mode === 'contract' ? projectId || null : null,
          amount: value, repayDueDate: due, method, plannedDate, note: note.trim() });
        toast.success(request ? `Đã gửi lại ${r.code}` : `Đã gửi ${r.code}`, `Tạm ứng ${money(r.amount)} đ — chờ ${preview?.route.steps[0]?.eligibleNames.join(' hoặc ') || 'người duyệt'}.`);
        onSaved(r.code);
      } catch (e) { toast.error('Chưa gửi được đề nghị tạm ứng', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
    };

    const supplierList = useMemo(() => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      return (suppliers || []).filter(s => words.every(w => s.name.toLowerCase().includes(w)));
    }, [suppliers, q]);

    return <Drawer label="Đề nghị tạm ứng NCC" wide onClose={onClose}
      header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{request ? `Sửa và gửi lại ${request.code}` : 'Đề nghị tạm ứng NCC'}</p>
        <h2 className={`text-lg ${ENT}`}>{opt?.supplier.name || request?.supplierName || (supplierId ? '…' : 'Chọn nhà cung cấp')}</h2>
        <p className="text-sm text-muted-foreground">Tạm ứng không phải chi phí: chỉ là tiền ra. Chi phí dự án ghi khi kho nhận hàng; khi đó tạm ứng tự trừ vào công nợ của đơn.</p></>}
      footer={supplierId ? <>{blockers.length > 0 && (value > 0 || targetKey) && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
        <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
        <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0 || previewing || !preview} onClick={() => void submit()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{request ? 'Gửi lại' : 'Gửi duyệt'} {value > 0 ? `${money(value)} đ` : ''}</button></> : undefined}>
      {error ? <StateBox kind="error" message={error} />
        : !supplierId ? (!suppliers ? <StateBox kind="loading" title="Đang tải NCC có đơn chờ giao…" /> : <section className="space-y-2">
          <p className="text-sm text-muted-foreground">Tạm ứng gắn với đơn hàng đang chờ giao. Chọn NCC:</p>
          <label className="relative block"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm NCC…" className={`w-full pl-8 ${inputCls}`} autoFocus /></label>
          {supplierList.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Không có NCC nào có đơn đang chờ giao khớp tìm kiếm.</p>}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{supplierList.map(s => <li key={s.id}>
            <button type="button" onClick={() => setSupplierId(s.id)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40">
              <span className={`min-w-0 flex-1 truncate ${ENT}`}>{s.name}</span>
              {!s.hasBank && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Chưa có số TK</Badge>}
              <span className="text-xs text-muted-foreground">{s.orders} đơn chờ giao</span><span className={`w-20 text-right text-sm ${NUM}`}>{shortMoney(s.value)}</span>
            </button></li>)}</ul>
        </section>)
        : !opt ? <StateBox kind="loading" title="Đang tải đơn hàng của NCC…" /> : <>
          {!opt.supplier.bankAccount && <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${WARN}`}><AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span><b>NCC chưa có số tài khoản.</b> Tạm ứng chuyển khoản cần tài khoản — Mua hàng khai ở hồ sơ đối tác, hoặc chọn chi tiền mặt.</span></p>}

          {opt.contracts.length > 0 && <div role="tablist" aria-label="Gắn tạm ứng với" className="inline-flex rounded-xl border border-border bg-card p-1">
            {([['po', `Theo đơn hàng (${opt.orders.length})`], ['contract', `Theo HĐ nguyên tắc (${opt.contracts.length})`]] as const).map(([k, l]) =>
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>)}
          </div>}

          {mode === 'po' ? <section className="space-y-2"><h3 className="text-sm font-semibold">Gắn với đơn hàng</h3>
            {opt.orders.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">NCC không có đơn nào đang chờ giao (đơn theo HĐ nguyên tắc tạm ứng theo hợp đồng).</p>
              : <ul className="space-y-2">{opt.orders.map(o => { const left = Math.max(0, o.base - o.advanced); const past = o.expectedDate && o.expectedDate < opt.today;
                return <li key={o.id}><label className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-sm ${poId === o.id ? 'border-teal-500 bg-teal-50/60 ring-2 ring-teal-500/20 dark:bg-teal-950/20' : 'border-border bg-card hover:border-teal-300'}`}>
                  <input type="radio" name="advance-po" checked={poId === o.id} onChange={() => setPoId(o.id)} className="accent-teal-600" />
                  <b className={ENT}>{o.poNumber}</b><span className="text-muted-foreground">{o.projectCode || 'Kho công ty'}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.items}</span>
                  <span className={`whitespace-nowrap ${NUM}`}>{shortMoney(o.base)}</span>
                  <span className="basis-full pl-6 text-xs text-muted-foreground">
                    Hẹn giao <span className={past ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{viDate(o.expectedDate)}{past ? ' (đã qua)' : ''}</span>
                    {' '}· đã nhận {shortMoney(o.received)} · {o.advanced > 0 ? <>đã tạm ứng <b className="text-foreground">{shortMoney(o.advanced)}</b> · còn ứng được {shortMoney(left)}</> : 'chưa tạm ứng'}</span>
                </label></li>; })}</ul>}
          </section> : <section className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium">Hợp đồng nguyên tắc<select value={contractId} onChange={e => setContractId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
              <option value="">Chọn hợp đồng…</option>{opt.contracts.map(c => <option key={c.id} value={c.id}>{c.code}{c.value ? ` · ${shortMoney(c.value)}` : ''}</option>)}</select></label>
            <label className="text-sm font-medium">Dùng cho<select value={projectId} onChange={e => setProjectId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
              <option value="">Kho Tổng (cấp công ty)</option>{opt.projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}</select>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Cấn trừ vào bảng đối soát tháng của HĐ cho đúng dự án này.</span></label>
          </section>}

          <section className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-medium">Tỷ lệ (% giá trị {mode === 'po' ? 'đơn gồm VAT' : 'HĐ'})
              <input value={pct} onChange={e => setFromPct(e.target.value)} disabled={!base} inputMode="decimal" placeholder={base ? 'VD: 30' : 'HĐ chưa có giá trị'} className={`mt-1 w-full text-right ${inputCls}`} />
              <span className="mt-0.5 block text-xs font-normal">{percent != null && settings && percent > settings.extraPercent
                ? <span className="text-amber-700 dark:text-amber-300">Trên {settings.extraPercent}% — thêm bước duyệt tạm ứng vượt ngưỡng</span>
                : percent != null && settings && percent > settings.warnPercent ? <span className="text-amber-700 dark:text-amber-300">Trên {settings.warnPercent}% — ghi rõ lý do</span>
                  : <span className="text-muted-foreground">Thường 10–{settings?.warnPercent ?? 30}%</span>}</span></label>
            <label className="text-sm font-medium">Số tiền tạm ứng
              <input value={amount} onChange={e => setFromAmount(e.target.value)} onBlur={() => setAmount(moneyInput(value))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls} ${available != null && value > available + 0.5 ? 'border-rose-400' : ''}`} />
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{available != null ? `Còn ứng được ${money(available)} đ` : 'Không giới hạn theo giá trị HĐ'}</span></label>
            <label className="text-sm font-medium">Hạn hoàn ứng
              <input type="date" value={due} min={opt.today} onChange={e => setDue(e.target.value)} className={`mt-1 w-full ${inputCls}`} />
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{mode === 'po' && order?.expectedDate && order.expectedDate < opt.today
                ? <span className="text-amber-700 dark:text-amber-300">Ngày hẹn giao {viDate(order.expectedDate)} đã qua — chọn ngày NCC hẹn giao lại</span>
                : `Mặc định = ngày hẹn giao${opt.settings.graceDays ? ` + ${opt.settings.graceDays} ngày` : ''}`}</span></label>
            <label className="text-sm font-medium md:col-span-3">Lý do tạm ứng<input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: NCC yêu cầu ứng 30% để đặt thép phôi" className={`mt-1 w-full ${inputCls}`} /></label>
            <label className="text-sm font-medium">Hình thức<select value={method} onChange={e => setMethod(e.target.value as 'bank_transfer' | 'cash')} className={`mt-1 w-full ${inputCls}`}>
              <option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label>
            <label className="text-sm font-medium">Ngày dự kiến chi<input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
            <div className="text-sm"><span className="font-medium">Tài khoản NCC</span>
              <span className="mt-1 block rounded-lg border border-border bg-muted/30 px-2 py-1.5">{opt.supplier.bankAccount
                ? <><b className="tabular-nums">{opt.supplier.bankAccount}</b> · {opt.supplier.bankName}</> : <span className="text-amber-700 dark:text-amber-300">Chưa có</span>}</span></div>
          </section>

          <section className="rounded-xl border border-border p-3">
            <h3 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={16} className="text-teal-700" />Luồng duyệt
              <span className="font-normal text-muted-foreground">(ma trận đề nghị chi, cộng dồn 7 ngày cùng NCC)</span>
              {previewing && <Loader2 size={14} className="animate-spin text-muted-foreground" />}</h3>
            {previewError ? <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{previewError}</p>
              : !preview ? <p className="mt-1 text-sm text-muted-foreground">Chọn đơn / hợp đồng và số tiền để xem ai duyệt.</p> : <>
                {preview.route.priorAmount > 0 && <p className={`mt-2 rounded-lg border px-3 py-2 text-xs ${WARN}`}>Cộng dồn {preview.route.priorRequests.map(r => r.code).join(', ')} trong 7 ngày ({money(preview.route.priorAmount)} đ)
                  → xét ngưỡng theo {money(preview.route.thresholdAmount)} đ.</p>}
                <ol className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  {preview.route.steps.map((s, i) => <li key={i} className="flex items-center gap-2">{i > 0 && <span className="text-muted-foreground">→</span>}
                    <span className={`rounded-lg border px-2 py-1 ${!s.eligibleIds.length ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30' : s.extra ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : 'border-border'}`}><b>{i + 1}. {s.label}</b>
                      <span className="block text-xs text-muted-foreground">{s.eligibleNames.length ? s.eligibleNames.join(' hoặc ') : 'Không còn người hợp lệ'}</span></span></li>)}
                  <li className="flex items-center gap-2"><span className="text-muted-foreground">→</span><span className="rounded-lg border border-dashed border-border px-2 py-1"><b className="inline-flex items-center gap-1"><Banknote size={13} />Xác nhận đã chi</b>
                    <span className="block text-xs text-muted-foreground">kế toán khác người lập và người duyệt · UNC + file</span></span></li></ol>
                {preview.route.extraCovered && <p className="mt-2 text-xs text-muted-foreground">Vượt {preview.route.extraPercent}% nhưng người duyệt vượt ngưỡng đã có trong luồng — không thêm bước.</p>}
              </>}
          </section>
        </>}
    </Drawer>;
  };
