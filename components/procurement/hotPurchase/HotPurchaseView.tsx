import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, Building2, Camera, CheckCircle2, CircleSlash, Flame, Hammer, Loader2, Package, Pencil, Plus,
  RefreshCw, Send, Settings2, ShoppingCart, Trash2, Undo2, UserRound, Wallet,
} from 'lucide-react';
import { useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import {
  HOT_PURCHASE_LINE_LABELS, HOT_PURCHASE_PAYMENT_LABELS, hotPurchaseLineAmount, hotPurchaseService, isApPayment,
  type HotPurchaseDetail, type HotPurchaseLineInput, type HotPurchaseLineType, type HotPurchaseList, type HotPurchasePaymentSource,
  type HotPurchasePrefill, type HotPurchaseStatus, type HotPurchaseSummary,
} from '../../../lib/hotPurchaseService';
import type { InventoryItem } from '../../../types';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../hub/hubUi';

// Mua nóng / CCDC (M2c): danh sách theo bước, lập phiếu, CHT duyệt, ghi đã mua, nhận hàng, kế toán ghi nợ.
// Dùng ở Mua hàng (mọi dự án) và trong Vật tư của dự án (công trường, CHT).

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const WARN = 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const OK = 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200';
const GREY = 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
const TEAL = 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200';
const RED = 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200';

const tr = (n: number) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(Math.round(n / 1e5) / 10)} tr`;
const qtyFmt = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const viDate = (d: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '—';
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

const STATUS: Record<HotPurchaseStatus, [string, string]> = {
  draft: ['Nháp', GREY], submitted: ['Chờ CHT duyệt', WARN], approved_to_buy: ['Được mua', TEAL], purchased: ['Đã mua · chờ nhận', TEAL],
  received: ['Đã nhận', OK], finance_review: ['Chờ kế toán', TEAL], reconciled: ['Xong', OK], closed: ['Xong', OK],
  rejected: ['Từ chối', RED], cancelled: ['Đã hủy', GREY],
};
const statusLabel = (p: HotPurchaseSummary): [string, string] => p.status === 'finance_review'
  ? [HOT_PURCHASE_PAYMENT_LABELS[p.paymentSource].settle, TEAL]
  : p.status === 'draft' && p.returnReason ? ['CHT trả lại', RED]
    : p.status === 'purchased' && p.overrunStatus === 'pending' ? ['Vượt duyệt · chờ CHT', WARN] : STATUS[p.status];

type StageKey = 'all' | 'draft' | 'submitted' | 'approved_to_buy' | 'purchased' | 'finance_review' | 'done';
const STAGES: Array<[StageKey, string, (p: HotPurchaseSummary) => boolean]> = [
  ['all', 'Tất cả', p => p.status !== 'cancelled'],
  ['draft', 'Nháp / trả lại', p => p.status === 'draft'],
  ['submitted', 'Chờ CHT duyệt', p => p.status === 'submitted' || (p.status === 'purchased' && p.overrunStatus === 'pending')],
  ['approved_to_buy', 'Được mua', p => p.status === 'approved_to_buy'],
  ['purchased', 'Đã mua · chờ nhận', p => p.status === 'purchased' && p.overrunStatus !== 'pending'],
  ['finance_review', 'Chờ kế toán / quyết toán', p => p.status === 'finance_review'],
  ['done', 'Xong', p => p.status === 'reconciled' || p.status === 'closed' || p.status === 'cancelled'],
];
const LINE_ICON: Record<HotPurchaseLineType, React.ElementType> = { stock_item: Package, expense_only: Flame, small_tool: Hammer };

// ---------------------------------------------------------------------------
// Lập / sửa phiếu
// ---------------------------------------------------------------------------
type DraftLine = HotPurchaseLineInput & { key: string; requestCode?: string | null };
const blankLine = (): DraftLine => ({ key: Math.random().toString(36).slice(2), name: '', unit: '', qty: 1, unitPrice: 0, vatRate: 10, lineType: 'expense_only' });

const Editor: React.FC<{
  list: HotPurchaseList; items: InventoryItem[]; fixedProjectId: string | null; fixedSiteId: string | null; detail: HotPurchaseDetail | null; prefill: HotPurchasePrefill | null;
  onClose: () => void; onSaved: (id: string, submitted: boolean) => void;
}> = ({ list, items, fixedProjectId, fixedSiteId, detail, prefill, onClose, onSaved }) => {
  const toast = useToast();
  const projects = list.projects;
  const [projectId, setProjectId] = useState(detail?.projectId || prefill?.projectId || fixedProjectId || projects[0]?.id || '');
  const project = projects.find(p => p.id === projectId);
  const [warehouseId, setWarehouseId] = useState(detail?.targetWarehouseId || prefill?.targetWarehouseId || project?.warehouses[0]?.id || '');
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [supplierId, setSupplierId] = useState<string | null>(detail?.supplierId || null);
  const [supplierName, setSupplierName] = useState(detail?.supplierName || '');
  const [pay, setPay] = useState<HotPurchasePaymentSource>(detail?.paymentSource || 'site_cash');
  const [invoiceNumber, setInvoiceNumber] = useState(detail?.invoiceNumber || '');
  const [purchaseDate, setPurchaseDate] = useState(detail?.purchaseDate || today());
  const [note, setNote] = useState(detail?.note || '');
  const [lines, setLines] = useState<DraftLine[]>(() => detail
    ? detail.lines.map(l => ({ key: l.id, itemId: l.itemId, name: l.name, unit: l.unit || '', qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate,
      lineType: l.lineType, holderName: l.holderName, materialRequestId: l.materialRequestId, requestLineId: l.requestLineId, requestCode: l.requestCode, note: l.note }))
    : prefill ? [{ ...blankLine(), itemId: prefill.line.itemId, name: prefill.line.name, unit: prefill.line.unit || '', qty: prefill.line.qty,
      unitPrice: items.find(i => i.id === prefill.line.itemId)?.priceIn || 0, materialRequestId: prefill.line.materialRequestId,
      requestLineId: prefill.line.requestLineId, requestCode: prefill.line.requestCode, lineType: 'expense_only' }]
      : [blankLine()]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    hotPurchaseService.vendors(projectId).then(setVendors).catch(() => setVendors([]));
  }, [projectId]);
  const total = lines.reduce((s, l) => s + hotPurchaseLineAmount(l), 0);
  const overThreshold = total >= list.threshold;
  const set = (key: string, patch: Partial<DraftLine>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));
  const pickItem = (key: string, value: string) => {
    const item = items.find(i => `${i.sku} · ${i.name}` === value || i.name === value);
    set(key, item ? { itemId: item.id, name: item.name, unit: item.unit, unitPrice: lines.find(l => l.key === key)?.unitPrice || item.priceIn || 0 } : { itemId: null, name: value });
  };
  const missing = !projectId ? 'Chọn dự án.'
    : !supplierName.trim() ? 'Nhập nhà cung cấp hoặc tên người bán.'
      : isApPayment(pay) && !supplierId ? 'Công ty chuyển khoản / NCC cho nợ phải chọn NCC trong danh mục.'
        : lines.some(l => !l.name.trim() || !(l.qty > 0)) ? 'Có dòng thiếu tên hoặc số lượng.'
          : lines.some(l => l.lineType === 'stock_item' && !l.itemId) ? 'Dòng Nhập kho phải chọn vật tư trong danh mục.'
            : lines.some(l => l.lineType === 'stock_item') && !warehouseId ? 'Chọn kho nhận cho dòng Nhập kho.'
              : lines.some(l => l.lineType === 'small_tool' && !l.holderName?.trim()) ? 'Dòng CCDC phải ghi người giữ.'
                : total <= 0 ? 'Nhập đơn giá.' : null;
  const save = async (submit: boolean) => {
    if (missing) { toast.error('Chưa lưu được', missing); return; }
    if (submit && !overThreshold && !invoiceNumber.trim()) { toast.error('Thiếu hóa đơn', 'Dưới ngưỡng là mua trước báo sau: ghi số hóa đơn / phiếu bán lẻ.'); return; }
    setSaving(true);
    try {
      const warehouse = project?.warehouses.find(w => w.id === warehouseId);
      const r = await hotPurchaseService.save({
        id: detail?.id, projectId, constructionSiteId: detail?.constructionSiteId || prefill?.constructionSiteId || warehouse?.constructionSiteId || fixedSiteId || null,
        targetWarehouseId: warehouseId || null, supplierId, supplierName: supplierName.trim(), paymentSource: pay, purchaseDate,
        invoiceNumber: invoiceNumber.trim() || null, note: note.trim() || null,
        lines: lines.map(({ key: _key, requestCode: _code, ...l }) => ({ ...l, holderName: l.lineType === 'small_tool' ? l.holderName : null })),
      });
      if (!submit) { toast.success(`Đã lưu nháp ${r.code}`); onSaved(r.id, false); return; }
      const s = await hotPurchaseService.submit(r.id);
      toast.success(s.requiresApproval ? `Đã gửi CHT duyệt ${r.code}` : `Đã ghi mua ${r.code}`,
        s.requiresApproval
          ? (s.total >= s.threshold ? `Tổng ${tr(s.total)} từ ngưỡng ${tr(s.threshold)} trở lên. Chờ CHT duyệt rồi mới mua.` : `Cộng dồn 7 ngày cùng NCC ${tr(s.total + s.cumulative)} chạm ngưỡng. Chờ CHT duyệt.`)
          : 'Dưới ngưỡng: đã báo CHT. Bước tiếp: nhận hàng.');
      onSaved(r.id, true);
    } catch (e) { toast.error('Chưa lưu được', e instanceof Error ? e.message : ''); } finally { setSaving(false); }
  };
  return <Drawer label="Phiếu mua nóng" wide onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mua nóng{prefill ? ' · từ Cần mua' : ''}</p>
      <h2 className="text-lg font-bold text-foreground">{detail ? <>Sửa phiếu <span className={ENT}>{detail.code}</span></> : 'Phiếu mua nóng mới'}</h2>
      {prefill && <p className="text-sm text-muted-foreground">Gắn dòng <b className={ENT}>{prefill.line.requestCode}</b> {prefill.line.name} (cần {qtyFmt(prefill.line.qty)} {prefill.line.unit}) — nhận hàng xong tính là đã nhận.</p>}
      {detail?.returnReason && <p className={`mt-2 rounded-lg border px-3 py-1.5 text-sm ${RED}`}>CHT trả lại: “{detail.returnReason}”</p>}
    </>}
    footer={<>
      <span className={`w-full rounded-lg border px-3 py-2 text-sm sm:w-auto sm:flex-1 ${overThreshold ? WARN : OK}`}>
        Tổng <b className="tabular-nums">{money(total)} đ</b> (gồm VAT) · {overThreshold
          ? <>từ {tr(list.threshold)} trở lên → <b>gửi CHT duyệt trước khi mua</b></>
          : <>dưới {tr(list.threshold)} → <b>mua trước, báo CHT sau</b><span className="hidden sm:inline"> (cộng dồn 7 ngày cùng NCC chạm ngưỡng thì vẫn phải duyệt)</span></>}</span>
      <button type="button" className={secondaryBtn} disabled={saving} onClick={() => void save(false)}>Lưu nháp</button>
      <button type="button" className={primaryBtn} disabled={saving} onClick={() => void save(true)}>
        {saving ? <Loader2 size={15} className="animate-spin" /> : overThreshold ? <Send size={15} /> : <ShoppingCart size={15} />}{overThreshold ? 'Gửi CHT duyệt' : 'Ghi đã mua'}</button>
    </>}>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="text-sm font-medium text-foreground">Dự án
        <select value={projectId} disabled={Boolean(fixedProjectId || detail || prefill)} onChange={e => { setProjectId(e.target.value); setWarehouseId(projects.find(p => p.id === e.target.value)?.warehouses[0]?.id || ''); }}
          className={`mt-1 w-full ${inputCls}`}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}</select></label>
      <label className="text-sm font-medium text-foreground">Kho nhận <span className="font-normal text-muted-foreground">(cho dòng Nhập kho)</span>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
          <option value="">— Không nhập kho —</option>
          {(project?.warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label className="text-sm font-medium text-foreground">Ngày mua
        <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm font-medium text-foreground">Nhà cung cấp / người bán
        <input list="hot-purchase-vendors" value={supplierName} placeholder="Chọn NCC hoặc ghi tên, SĐT người bán lẻ"
          onChange={e => { const v = vendors.find(x => x.name === e.target.value); setSupplierName(e.target.value); setSupplierId(v?.id || null); }}
          className={`mt-1 w-full ${inputCls}`} />
        <datalist id="hot-purchase-vendors">{vendors.map(v => <option key={v.id} value={v.name} />)}</datalist>
        <span className="mt-0.5 block text-xs text-muted-foreground">{supplierId ? 'NCC trong danh mục' : 'Người bán lẻ (không ghi công nợ)'}</span></label>
      <div className="text-sm font-medium text-foreground">Nguồn tiền
        <div className="mt-1 grid grid-cols-2 gap-1.5">{(Object.keys(HOT_PURCHASE_PAYMENT_LABELS) as HotPurchasePaymentSource[]).map(k =>
          <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}
            className={`rounded-lg border px-2 py-1.5 text-left text-xs ${pay === k ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-500/20 dark:bg-teal-950/30' : 'border-border hover:border-teal-300'}`}>
            <b className="block text-sm text-foreground">{HOT_PURCHASE_PAYMENT_LABELS[k].label}</b><span className="text-muted-foreground">{HOT_PURCHASE_PAYMENT_LABELS[k].hint}</span></button>)}</div></div>
    </div>

    <section className="space-y-2">
      <h3 className="font-semibold text-foreground">Vật tư</h3>
      <datalist id="hot-purchase-items">{items.slice(0, 2000).map(i => <option key={i.id} value={`${i.sku} · ${i.name}`} />)}</datalist>
      {lines.map((l, idx) => <div key={l.key} className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-5 text-xs font-bold text-muted-foreground">{idx + 1}</span>
          {(Object.keys(HOT_PURCHASE_LINE_LABELS) as HotPurchaseLineType[]).map(k => { const Icon = LINE_ICON[k];
            return <button key={k} type="button" title={HOT_PURCHASE_LINE_LABELS[k].hint} aria-pressed={l.lineType === k} onClick={() => set(l.key, { lineType: k })}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${l.lineType === k ? 'border-teal-600 bg-teal-600 text-white' : 'border-border text-foreground'}`}><Icon size={11} />{HOT_PURCHASE_LINE_LABELS[k].label}</button>; })}
          {l.requestCode && <Badge className={TEAL}>Đề xuất {l.requestCode}</Badge>}
          <button type="button" aria-label="Xóa dòng" disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
            className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-600 disabled:opacity-30"><Trash2 size={15} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_6rem]">
          <label className="col-span-2 sm:col-span-1">Vật tư
            <input list="hot-purchase-items" value={l.itemId ? `${items.find(i => i.id === l.itemId)?.sku || ''} · ${l.name}` : l.name}
              disabled={Boolean(l.requestLineId)} placeholder={l.lineType === 'stock_item' ? 'Chọn vật tư trong danh mục' : 'Tên vật tư / dịch vụ'}
              onChange={e => pickItem(l.key, e.target.value)} className={`mt-0.5 w-full ${inputCls}`} /></label>
          <label>ĐVT<input value={l.unit} disabled={Boolean(l.itemId)} placeholder="ĐVT" onChange={e => set(l.key, { unit: e.target.value })} className={`mt-0.5 w-full ${inputCls}`} /></label>
          <label>Số lượng<input inputMode="decimal" value={l.qty || ''} placeholder="SL" onChange={e => set(l.key, { qty: Number(e.target.value.replace(',', '.')) || 0 })} className={`mt-0.5 w-full text-right ${inputCls}`} /></label>
          <label>Đơn giá chưa VAT<input inputMode="numeric" value={l.unitPrice ? money(l.unitPrice) : ''} placeholder="0"
            onChange={e => set(l.key, { unitPrice: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={`mt-0.5 w-full text-right ${inputCls}`} /></label>
          <label>VAT<select value={l.vatRate} onChange={e => set(l.key, { vatRate: Number(e.target.value) })} className={`mt-0.5 w-full ${inputCls}`}>
            {[0, 5, 8, 10].map(v => <option key={v} value={v}>{v}%</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {l.lineType === 'small_tool' && <input aria-label="Người giữ CCDC" value={l.holderName || ''} placeholder="Người giữ CCDC (bắt buộc)"
            onChange={e => set(l.key, { holderName: e.target.value })} className={`min-w-[14rem] flex-1 ${inputCls}`} />}
          <span className="ml-auto text-sm">Thành tiền <b className={NUM}>{money(hotPurchaseLineAmount(l))} đ</b></span>
        </div>
      </div>)}
      <button type="button" className={secondaryBtn} onClick={() => setLines(ls => [...ls, blankLine()])}><Plus size={15} />Thêm dòng</button>
    </section>

    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm font-medium text-foreground">Số hóa đơn / phiếu bán lẻ {overThreshold ? <span className="font-normal text-muted-foreground">(ghi khi đã mua)</span> : <span className="font-normal text-rose-700 dark:text-rose-300">(bắt buộc — mua trước báo sau)</span>}
        <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="VD: HĐ 0001523 hoặc Phiếu bán lẻ" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="text-sm font-medium text-foreground">Ghi chú
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Lý do mua gấp, nơi dùng…" className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Chi tiết + thao tác theo bước
// ---------------------------------------------------------------------------
const Detail: React.FC<{ id: string; threshold: number; onClose: () => void; onEdit: (d: HotPurchaseDetail) => void; onChanged: () => void }> = ({ id, threshold, onClose, onEdit, onChanged }) => {
  const toast = useToast();
  const askReason = useReasonConfirm();
  const [d, setD] = useState<HotPurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState<{ invoice: string; lines: Record<string, { qty: number; unitPrice: number }> } | null>(null);
  const load = useCallback(() => { setError(null); hotPurchaseService.get(id).then(setD).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [id]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, ok: string, hint?: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok, hint); setBuying(null); load(); onChanged(); }
    catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  if (error) return <Drawer label="Phiếu mua nóng" onClose={onClose} header={<h2 className="font-bold">Phiếu mua nóng</h2>}><StateBox kind="error" message={error} onRetry={load} /></Drawer>;
  if (!d) return <Drawer label="Phiếu mua nóng" onClose={onClose} header={<h2 className="font-bold">Phiếu mua nóng</h2>}><StateBox kind="loading" title="Đang tải phiếu…" /></Drawer>;
  const perm = d.permissions;
  const total = d.lines.reduce((s, l) => s + l.amount, 0);
  const buyTotal = buying ? d.lines.reduce((s, l) => s + hotPurchaseLineAmount({ ...l, ...buying.lines[l.id] }), 0) : 0;
  const settleStep = isApPayment(d.paymentSource) ? 'Kế toán ghi nợ' : 'Quyết toán tháng';
  const steps = d.requiresApproval || d.status === 'submitted' || d.status === 'approved_to_buy'
    ? ['Lập', 'CHT duyệt', 'Mua', 'Nhận hàng', settleStep, 'Xong']
    : ['Lập', 'Đã mua · báo CHT', 'Nhận hàng', settleStep, 'Xong'];
  const at = d.requiresApproval || d.status === 'submitted' || d.status === 'approved_to_buy'
    ? { draft: 0, submitted: 1, approved_to_buy: 2, purchased: 3, received: 4, finance_review: 4, reconciled: 5, closed: 5 }[d.status as string] ?? 0
    : { draft: 0, purchased: 2, received: 3, finance_review: 3, reconciled: 4, closed: 4 }[d.status as string] ?? 0;
  const [label, tone] = statusLabel(d);
  const hasStock = d.lines.some(l => l.lineType === 'stock_item');
  return <Drawer label={`Phiếu ${d.code}`} wide onClose={onClose}
    header={<>
      <p className="flex flex-wrap items-center gap-2"><span className={`text-lg ${ENT}`}>{d.code}</span><Badge className={tone}>{label}</Badge>
        {d.status !== 'draft' && <Badge className={d.requiresApproval ? WARN : GREY}>{d.requiresApproval ? `CHT duyệt trước (ngưỡng ${tr(d.approvalThreshold || threshold)})` : 'Dưới ngưỡng · mua trước báo sau'}</Badge>}</p>
      <p className="text-sm text-muted-foreground"><Building2 size={12} className="mr-1 inline" />{d.projectCode || d.projectName} · {d.warehouseName || 'không nhập kho'} · {d.supplierName}</p>
      <p className="text-xs text-muted-foreground">Lập bởi {d.createdByName || '—'} {viDate(d.createdAt)} · ngày mua {viDate(d.purchaseDate)} · CHT dự án: {d.commanderName || <span className="text-amber-700 dark:text-amber-300">chưa có — Admin duyệt thay</span>}</p>
    </>}
    footer={<>
      <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1"><Wallet size={12} className="mr-1 inline" />{HOT_PURCHASE_PAYMENT_LABELS[d.paymentSource].label} — {HOT_PURCHASE_PAYMENT_LABELS[d.paymentSource].hint}.</span>
      {perm.canCancel && <button type="button" className={secondaryBtn} disabled={busy} onClick={async () => {
        const reason = await askReason({ title: `Hủy phiếu ${d.code}?`, targetName: d.code, subtitle: 'Chỉ hủy được khi chưa mua. Phiếu vẫn lưu lịch sử.', reasonLabel: 'Lý do hủy', actionLabel: 'Hủy phiếu', intent: 'warning' });
        if (reason) void run(() => hotPurchaseService.cancel(d.id, reason), `Đã hủy ${d.code}`);
      }}><CircleSlash size={15} />Hủy phiếu</button>}
      {perm.canEdit && <button type="button" className={secondaryBtn} onClick={() => onEdit(d)}><Pencil size={15} />Sửa</button>}
      {perm.canEdit && <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run(() => hotPurchaseService.submit(d.id), `Đã gửi ${d.code}`)}><Send size={15} />{total >= threshold ? 'Gửi CHT duyệt' : 'Ghi đã mua'}</button>}
      {perm.canDecide && <>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={async () => {
          const reason = await askReason({ title: `Trả lại ${d.code}?`, targetName: d.code, subtitle: 'Người lập sửa rồi gửi lại.', reasonLabel: 'Lý do trả lại', reasonPlaceholder: 'VD: hỏi thêm báo giá thứ 2, giảm số lượng…', actionLabel: 'Trả lại', intent: 'warning' });
          if (reason) void run(() => hotPurchaseService.decide(d.id, 'return', reason), `Đã trả lại ${d.code}`);
        }}><Undo2 size={15} />Trả lại</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run(() => hotPurchaseService.decide(d.id, 'approve'), `Đã duyệt mua ${d.code}`, 'Người lập được mua; vượt quá 10% phải xin xác nhận lại.')}>
          <CheckCircle2 size={15} />Duyệt mua {tr(total)}</button></>}
      {perm.canMarkPurchased && !buying && <button type="button" className={primaryBtn} onClick={() => setBuying({ invoice: d.invoiceNumber || '', lines: Object.fromEntries(d.lines.map(l => [l.id, { qty: l.qty, unitPrice: l.unitPrice }])) })}>
        <Camera size={15} />Ghi đã mua</button>}
      {perm.canConfirmOverrun && <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run(() => hotPurchaseService.confirmOverrun(d.id), 'Đã xác nhận phần vượt', 'Người mua nhận hàng như bình thường.')}><CheckCircle2 size={15} />Xác nhận phần vượt</button>}
      {perm.canReceive && <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run(() => hotPurchaseService.receive(d.id), `Đã nhận hàng ${d.code}`,
        hasStock ? 'Đã tạo và hoàn tất phiếu nhập kho cho dòng Nhập kho.' : undefined)}><Package size={15} />Xác nhận đã nhận hàng</button>}
      {perm.canPostPayable && <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run(() => hotPurchaseService.postPayable(d.id), `Đã ghi công nợ ${d.code}`, 'Chi phí dự án đã ghi. Lập đề nghị chi ở Tài chính.')}><Banknote size={15} />Ghi công nợ NCC</button>}
    </>}>
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Các bước">{steps.map((s, i) => <li key={s} className="flex items-center gap-2">{i > 0 && <ArrowRight size={12} className="text-muted-foreground" />}
      <span className={`rounded-full border px-2 py-0.5 font-semibold ${i < at || (i === at && ['reconciled', 'closed'].includes(d.status)) ? OK : i === at ? TEAL : GREY}`}>{s}</span></li>)}</ol>
    {d.status === 'cancelled' && <p className={`rounded-lg border px-3 py-2 text-sm ${GREY}`}>Phiếu đã hủy: “{d.events.filter(e => e.action === 'cancel').pop()?.reason}”.</p>}
    {d.status === 'draft' && d.returnReason && <p className={`rounded-lg border px-3 py-2 text-sm ${RED}`}>CHT trả lại: “{d.returnReason}”. Sửa rồi gửi lại.</p>}
    {!d.requiresApproval && d.status !== 'draft' && d.status !== 'cancelled' && <p className={`rounded-lg border px-3 py-2 text-sm ${GREY}`}><UserRound size={14} className="mr-1 inline" />Dưới ngưỡng: đã báo CHT {d.commanderName || '(dự án chưa có CHT)'}, không cần chờ duyệt.</p>}
    {d.requiresApproval && d.status === 'submitted' && <p className={`rounded-lg border px-3 py-2 text-sm ${WARN}`}>{(d.submittedAmount || 0) >= (d.approvalThreshold || threshold)
      ? `Tổng ${money(d.submittedAmount)} đ từ ngưỡng ${tr(d.approvalThreshold || threshold)} trở lên.`
      : `Cộng dồn 7 ngày cùng NCC ${money((d.submittedAmount || 0) + (d.cumulativeAmount || 0))} đ chạm ngưỡng (chống chia nhỏ phiếu).`} Chờ {d.commanderName || 'Admin'} duyệt trước khi mua.</p>}
    {d.approvedAt && <p className={`rounded-lg border px-3 py-2 text-sm ${OK}`}><CheckCircle2 size={14} className="mr-1 inline" />Duyệt mua {money(d.approvedAmount)} đ bởi {d.approverName} {viDate(d.approvedAt)}. Vượt quá 10% ({money((d.approvedAmount || 0) * 1.1)} đ) phải xin xác nhận lại.</p>}
    {d.overrunStatus === 'pending' && <p className={`rounded-lg border px-3 py-2 text-sm ${WARN}`}><AlertTriangle size={14} className="mr-1 inline" />Thực tế {money(total)} đ vượt số đã duyệt quá 10% → chờ CHT xác nhận lại rồi mới nhận hàng, ghi chi phí.</p>}
    {d.overrunStatus === 'confirmed' && <p className={`rounded-lg border px-3 py-2 text-sm ${OK}`}>CHT đã xác nhận phần vượt.</p>}

    {buying && <section className="space-y-2 rounded-xl border border-teal-300 bg-teal-50/50 p-3 dark:border-teal-800 dark:bg-teal-950/20">
      <h3 className="font-semibold text-foreground">Ghi số thực tế đã mua</h3>
      {d.lines.map(l => <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
        <span className="text-sm"><b>{l.name}</b> <span className="text-muted-foreground">({l.unit})</span></span>
        <input aria-label={`SL ${l.name}`} inputMode="decimal" value={buying.lines[l.id]?.qty || ''} onChange={e => setBuying(b => b && ({ ...b, lines: { ...b.lines, [l.id]: { ...b.lines[l.id], qty: Number(e.target.value.replace(',', '.')) || 0 } } }))} className={`text-right ${inputCls}`} />
        <input aria-label={`Đơn giá ${l.name}`} inputMode="numeric" value={money(buying.lines[l.id]?.unitPrice || 0)} onChange={e => setBuying(b => b && ({ ...b, lines: { ...b.lines, [l.id]: { ...b.lines[l.id], unitPrice: Number(e.target.value.replace(/\D/g, '')) || 0 } } }))} className={`text-right ${inputCls}`} />
      </div>)}
      <input aria-label="Số hóa đơn" value={buying.invoice} onChange={e => setBuying(b => b && ({ ...b, invoice: e.target.value }))} placeholder="Số hóa đơn / phiếu bán lẻ (bắt buộc)" className={`w-full ${inputCls}`} />
      <p className={`rounded-lg border px-3 py-1.5 text-sm ${buyTotal > (d.approvedAmount || 0) * 1.1 ? WARN : OK}`}>Thực tế {money(buyTotal)} đ{buyTotal > (d.approvedAmount || 0) * 1.1 ? ' — vượt số duyệt quá 10%, sẽ gửi CHT xác nhận lại.' : ' — trong số đã duyệt.'}</p>
      <div className="flex justify-end gap-2"><button type="button" className={secondaryBtn} onClick={() => setBuying(null)}>Đóng</button>
        <button type="button" className={primaryBtn} disabled={busy || !buying.invoice.trim()} onClick={() => void run(() => hotPurchaseService.markPurchased({ id: d.id, invoiceNumber: buying.invoice.trim(),
          lines: d.lines.map(l => ({ id: l.id, qty: buying.lines[l.id].qty, unitPrice: buying.lines[l.id].unitPrice, vatRate: l.vatRate })) }), `Đã ghi mua ${d.code}`)}><ShoppingCart size={15} />Lưu đã mua</button></div>
    </section>}

    <ul className="divide-y divide-border rounded-xl border border-border bg-card md:hidden">{d.lines.map(l => { const Icon = LINE_ICON[l.lineType];
      return <li key={l.id} className="space-y-1 px-3 py-2.5 text-sm">
        <div className="flex items-start justify-between gap-2"><b>{l.name}</b><Badge className={TEAL}><Icon size={11} />{HOT_PURCHASE_LINE_LABELS[l.lineType].label}</Badge></div>
        <p className="text-xs text-muted-foreground">{qtyFmt(l.qty)} {l.unit} × {money(l.unitPrice)} · VAT {l.vatRate}% = <span className={NUM}>{money(l.amount)} đ</span></p>
        {l.requestCode && <p className="text-xs text-muted-foreground">Đề xuất {l.requestCode} — nhận xong tính là đã nhận</p>}
        {l.holderName && <p className="text-xs text-muted-foreground">Người giữ: {l.holderName}</p>}
      </li>; })}</ul>
    <div className="hidden overflow-x-auto rounded-xl border border-border md:block"><table className="w-full text-sm">
      <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Vật tư</th><th className="px-2 py-2 font-medium">Loại</th>
        <th className="px-2 py-2 text-right font-medium">SL</th><th className="px-2 py-2 text-right font-medium">Đơn giá</th><th className="px-2 py-2 text-right font-medium">VAT</th><th className="px-3 py-2 text-right font-medium">Thành tiền</th></tr></thead>
      <tbody>{d.lines.map(l => { const Icon = LINE_ICON[l.lineType]; return <tr key={l.id} className="border-t border-border align-top">
        <td className="px-3 py-2"><b>{l.name}</b>{l.sku && <span className="block text-xs text-muted-foreground">{l.sku}</span>}
          {l.requestCode && <span className="block text-xs text-muted-foreground">Đề xuất {l.requestCode} — nhận xong tính là đã nhận</span>}
          {l.holderName && <span className="block text-xs text-muted-foreground">Người giữ: {l.holderName}</span>}</td>
        <td className="px-2 py-2"><Badge className={TEAL}><Icon size={11} />{HOT_PURCHASE_LINE_LABELS[l.lineType].label}</Badge></td>
        <td className="!whitespace-nowrap px-2 py-2 text-right tabular-nums">{qtyFmt(l.qty)} {l.unit}</td>
        <td className="!whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(l.unitPrice)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{l.vatRate}%</td>
        <td className={`!whitespace-nowrap px-3 py-2 text-right ${NUM}`}>{money(l.amount)}</td></tr>; })}</tbody></table></div>
    <p className="text-sm">Tổng <b className={NUM}>{money(total)} đ</b> (gồm VAT){d.invoiceNumber ? <> · {d.invoiceNumber}</> : null}
      {d.wmsTransactionId ? <span className="text-muted-foreground"> · phiếu nhập kho {d.wmsTransactionId}</span> : null}
      {d.payable ? <span className="text-muted-foreground"> · công nợ {d.payable.code}</span> : null}</p>
    {d.status === 'finance_review' && !isApPayment(d.paymentSource) && <p className={`rounded-lg border px-3 py-2 text-sm ${GREY}`}>Đã nhận hàng. Kế toán đưa phiếu vào bộ hoàn ứng / quỹ công trường cuối tháng (chi phí dự án ghi lúc quyết toán).</p>}
    {d.events.length > 0 && <details className="rounded-xl border border-border px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold">Lịch sử ({d.events.length})</summary>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{d.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString('vi-VN')} · <b className="text-foreground">{e.actorName || '—'}</b> · {EVENT_LABELS[e.action] || e.action}{e.reason ? ` — “${e.reason}”` : ''}</li>)}</ul></details>}
  </Drawer>;
};
const EVENT_LABELS: Record<string, string> = {
  create: 'lập phiếu', update: 'sửa phiếu', submit: 'gửi CHT duyệt', purchase_report: 'ghi đã mua (dưới ngưỡng, báo CHT)', approve: 'duyệt mua', return: 'trả lại',
  purchased: 'ghi đã mua', overrun_confirmed: 'xác nhận phần vượt', received: 'xác nhận đã nhận hàng', payable_posted: 'ghi công nợ NCC', cancel: 'hủy phiếu',
};

// ---------------------------------------------------------------------------
// Thiết lập ngưỡng
// ---------------------------------------------------------------------------
const SettingsDrawer: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const toast = useToast();
  const [s, setS] = useState<{ threshold: number; rowVersion: number; canEdit: boolean; updatedByName: string | null; updatedAt: string } | null>(null);
  const [value, setValue] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => { hotPurchaseService.settings().then(x => { setS(x); setValue(x.threshold); }).catch(e => toast.error('Chưa tải được thiết lập', e instanceof Error ? e.message : '')); }, [toast]);
  return <Drawer label="Thiết lập mua nóng" onClose={onClose} header={<h2 className="flex items-center gap-2 text-lg font-bold"><Settings2 size={18} />Thiết lập · Ngưỡng mua nóng</h2>}
    footer={s?.canEdit ? <><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={saving || !value || value === s.threshold} onClick={async () => {
        setSaving(true);
        try { await hotPurchaseService.saveSettings(value, s.rowVersion); toast.success(`Đã đổi ngưỡng thành ${money(value)} đ`, 'Áp dụng cho phiếu gửi từ bây giờ.'); onSaved(); onClose(); }
        catch (e) { toast.error('Chưa lưu được', e instanceof Error ? e.message : ''); } finally { setSaving(false); }
      }}>Lưu ngưỡng</button></> : undefined}>
    {!s ? <StateBox kind="loading" /> : <>
      <label className="block text-sm font-medium text-foreground">Phiếu mua nóng từ (gồm VAT) phải Chỉ huy trưởng duyệt trước khi mua
        <span className="mt-1 flex items-center gap-2"><input inputMode="numeric" disabled={!s.canEdit} value={money(value)} onChange={e => setValue(Number(e.target.value.replace(/\D/g, '')) || 0)} className={`w-44 text-right ${inputCls}`} /> đồng</span></label>
      <p className="text-sm text-muted-foreground">Dưới ngưỡng: mua trước, báo CHT sau. Cộng dồn 7 ngày cùng NCC cùng dự án chạm ngưỡng thì vẫn phải duyệt. Phiếu đã gửi giữ ngưỡng lúc gửi.</p>
      <p className="text-xs text-muted-foreground">Lần đổi gần nhất: {s.updatedByName || 'mặc định'} · {new Date(s.updatedAt).toLocaleString('vi-VN')}</p>
      {!s.canEdit && <p className={`rounded-lg border px-3 py-2 text-sm ${GREY}`}>Chỉ Admin hoặc Mua hàng — Quản trị sửa được ngưỡng.</p>}
    </>}
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Màn chính
// ---------------------------------------------------------------------------
export const HotPurchaseView: React.FC<{
  /** Danh mục vật tư cho dòng Nhập kho (chọn mã) — nơi gọi lấy từ useApp().items. */
  items: InventoryItem[];
  projectId?: string | null; constructionSiteId?: string | null; initialPurchaseId?: string | null;
  prefill?: HotPurchasePrefill | null; onPrefillUsed?: () => void; showSettings?: boolean;
}> = ({ items, projectId = null, constructionSiteId = null, initialPurchaseId = null, prefill = null, onPrefillUsed, showSettings = false }) => {
  const [list, setList] = useState<HotPurchaseList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<StageKey>('all');
  const [openId, setOpenId] = useState<string | null>(initialPurchaseId);
  const [editor, setEditor] = useState<{ detail: HotPurchaseDetail | null; prefill: HotPurchasePrefill | null } | null>(prefill ? { detail: null, prefill } : null);
  const [settings, setSettings] = useState(false);
  const load = useCallback(async () => {
    try { setList(await hotPurchaseService.list({ projectId, constructionSiteId })); setStatus('ready'); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); setStatus('error'); }
  }, [constructionSiteId, projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (prefill) { setEditor({ detail: null, prefill }); onPrefillUsed?.(); } }, [prefill, onPrefillUsed]);
  const purchases = useMemo(() => list?.purchases || [], [list]);
  const shown = purchases.filter(STAGES.find(s => s[0] === stage)![2]);
  const waitingMe = purchases.filter(p => p.canApprove).length;

  if (status === 'error' && !list) return <StateBox kind="error" title="Chưa tải được mua nóng" message={message} onRetry={() => void load()} />;
  if (!list) return <StateBox kind="loading" title="Đang tải phiếu mua nóng…" />;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="w-full text-sm text-muted-foreground sm:w-auto sm:flex-1">Công trường mua gấp / nhỏ lẻ. Từ <b className="text-foreground">{money(list.threshold)} đ</b> (gồm VAT) Chỉ huy trưởng duyệt trước khi mua; dưới ngưỡng mua trước, báo sau.</p>
      {showSettings && <button type="button" className={secondaryBtn} onClick={() => setSettings(true)}><Settings2 size={15} />Ngưỡng</button>}
      <button type="button" className={`${secondaryBtn} bg-card`} onClick={() => void load()}><RefreshCw size={15} />Làm mới</button>
      {list.canCreate && list.projects.length > 0 && <button type="button" className={primaryBtn} onClick={() => setEditor({ detail: null, prefill: null })}><Flame size={15} />Lập phiếu mua nóng</button>}
    </div>
    <nav aria-label="Các bước mua nóng" className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">{STAGES.map(([k, l, f], i) => {
      const n = purchases.filter(f).length;
      return <button key={k} type="button" aria-current={stage === k ? 'page' : undefined} onClick={() => setStage(k)}
        className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition ${stage === k ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i > 0 && <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i}</span>}{l}</span>
        <span className="mt-1 block text-2xl font-bold tabular-nums text-foreground">{n}</span></button>;
    })}</nav>
    {waitingMe > 0 && <button type="button" onClick={() => setStage('submitted')} className={`w-full rounded-2xl border px-4 py-3 text-left text-sm ${WARN}`}>
      <AlertTriangle size={15} className="mr-1 inline" /><b>{waitingMe} phiếu chờ bạn duyệt mua hoặc xác nhận phần vượt.</b> Phiếu dưới ngưỡng chỉ báo để biết.</button>}
    {shown.length === 0
      ? <StateBox kind="empty" title={purchases.length ? 'Không có phiếu ở bước này' : 'Chưa có phiếu mua nóng'}
        message={purchases.length ? 'Chọn bước khác ở dải trên.' : list.canCreate ? 'Bấm "Lập phiếu mua nóng", hoặc bấm Mua nóng ở dòng thiếu trong Cần mua.' : 'Phiếu do công trường lập sẽ hiện ở đây.'} />
      : <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{shown.map(p => { const [label, tone] = statusLabel(p);
        return <li key={p.id}><button type="button" onClick={() => setOpenId(p.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-muted/40">
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className={ENT}>{p.code}</span><Badge className={tone}>{label}</Badge>
            {p.status !== 'draft' && !p.requiresApproval && <Badge className={GREY}>dưới ngưỡng</Badge>}
            {p.canApprove && <Badge className={WARN}>{p.status === 'submitted' ? 'chờ bạn duyệt' : 'chờ bạn xác nhận'}</Badge>}</span>
            <span className="block truncate text-sm text-foreground">{p.lineSummary || '—'}</span>
            <span className="block text-xs text-muted-foreground"><Building2 size={11} className="mr-1 inline" />{p.projectCode || p.projectName} · {p.supplierName} · {p.createdByName} · {viDate(p.createdAt)}</span></span>
          <span className="text-right"><span className={NUM}>{money(p.totalAmount)} đ</span><span className="block text-xs text-muted-foreground"><Wallet size={11} className="mr-1 inline" />{HOT_PURCHASE_PAYMENT_LABELS[p.paymentSource].label}</span></span>
        </button></li>; })}</ul>}
    {openId && !editor && <Detail id={openId} threshold={list.threshold} onClose={() => setOpenId(null)} onEdit={d => setEditor({ detail: d, prefill: null })} onChanged={() => void load()} />}
    {editor && <Editor list={list} items={items} fixedProjectId={projectId} fixedSiteId={constructionSiteId} detail={editor.detail} prefill={editor.prefill}
      onClose={() => setEditor(null)} onSaved={id => { setEditor(null); setOpenId(id); void load(); }} />}
    {settings && <SettingsDrawer onClose={() => setSettings(false)} onSaved={() => void load()} />}
  </section>;
};

export default HotPurchaseView;
