import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Link2, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import {
  PROACTIVE_REASON_LABELS, boqStatusOf, procurementInboxService,
  type ProcurementBoqSnapshot, type ProcurementCatalogItem, type ProcurementOrderDetail, type ProcurementProactiveProject,
  type ProcurementProactiveReason,
} from '../../../lib/procurementInboxService';
import { dateVi, fmt, parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';
import { backdateHint, vnToday } from '../../../lib/businessDate';
import { DeliveryModePicker, VatPicker, VendorPicker, type VendorValue } from './OrderFormParts';
import PoExcelImport from './PoExcelImport';
import type { ImportedPoLine } from '../../../lib/procurementExcelImport';
import { duplicateItemSpecProblems, specKey } from '../../../lib/materialLineDescription';
import { QuickCreateItemDialog } from '../../wms/QuickCreateItemDialog';
import { wmsCatalogService } from '../../../lib/wmsCatalogService';

// Đơn chủ động: Mua hàng tự lập PO khi chưa có phiếu nhu cầu (chốt giá, hàng đặt dài ngày, bù tồn…).
// Vẫn gửi duyệt như đơn thường. Vượt hoặc ngoài BOQ dự án thì phải ghi lý do. Nhu cầu đến sau
// được gắn vào phần chưa phân bổ của đơn này (ở phiếu nhu cầu) thay vì lập đơn mới.

interface Line {
  key: string; lineId?: string; itemId: string; name: string; spec: string; sku: string | null; unit: string | null;
  altUnit: boolean; purchaseUnit: string; factor: number; purchaseQty: string;
  stockQty: string; price: string; allocatedQty: number;
  boq: { inBoq: boolean; boqQty: number; orderedQty: number };
}

const BOQ_TONE: Record<ProcurementBoqSnapshot['status'], string> = {
  within: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200',
  over: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  outside: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  stock: 'border-slate-200 bg-slate-100 text-slate-700',
};
const boqLabel = (l: Pick<Line, 'boq' | 'unit'>, qty: number) => {
  const status = boqStatusOf(l.boq, qty);
  const left = l.boq.boqQty - l.boq.orderedQty;
  return status === 'outside' ? 'Ngoài BOQ dự án'
    : status === 'over' ? `Vượt BOQ ${fmt(l.boq.orderedQty + qty - l.boq.boqQty, 3)} ${l.unit || ''}`
      : `Trong BOQ · còn ${fmt(left - qty, 3)} ${l.unit || ''}`;
};

const priceCell = (text: string) => { const p = parseQty(text); return p == null || Number.isNaN(p) ? '' : p; };

const purchaseQtyOf = (l: Line, stock: number) => {
  if (!l.altUnit) return stock;
  const typed = parseQty(l.purchaseQty);
  return typed == null ? Math.round(stock / l.factor * 1000) / 1000 : typed;
};

let lineSeq = 0;
/** Mỗi dòng một khóa riêng: một mã có thể nhiều dòng (mỗi dòng một quy cách, một giá). */
const newLineKey = (itemId: string) => `${itemId}#${++lineSeq}`;

/** BOQ của mã cộng dồn các dòng cùng mã đứng trước trong đơn (một mã nhiều quy cách). */
const withPriorSameItem = (lines: Line[]): Line[] => {
  const seen = new Map<string, number>();
  return lines.map(l => {
    const prior = seen.get(l.itemId) || 0;
    const stock = parseQty(l.stockQty);
    seen.set(l.itemId, prior + (stock != null && !Number.isNaN(stock) && stock > 0 ? stock : 0));
    return prior ? { ...l, boq: { ...l.boq, orderedQty: l.boq.orderedQty + prior } } : l;
  });
};

const fromOrder = (order: ProcurementOrderDetail): Line[] => {
  // Máy chủ lưu "đã đặt trước" của dòng sau đã gồm các dòng cùng mã đứng trước — trừ ra để còn số ngoài đơn này.
  const prior = new Map<string, number>();
  return order.lines.map(l => {
  const alt = Boolean(l.stockUnit && l.unit && l.unit !== l.stockUnit);
  const before = prior.get(l.itemId) || 0;
  prior.set(l.itemId, before + (l.stockQty || 0));
  return {
    key: l.lineId, lineId: l.lineId, itemId: l.itemId, name: l.name, spec: l.specification || '', sku: l.sku, unit: l.stockUnit || l.unit,
    altUnit: alt, purchaseUnit: alt ? l.unit || '' : '', factor: l.factor || 1, purchaseQty: alt ? qtyInput(l.qty) : '',
    stockQty: qtyInput(l.stockQty), price: qtyInput(l.unitPrice), allocatedQty: l.allocatedQty,
    boq: { inBoq: l.boq ? l.boq.status !== 'outside' : true, boqQty: l.boq?.boqQty ?? 0, orderedQty: Math.max(0, (l.boq?.orderedBefore ?? 0) - before) },
  };
  });
};

export const ProactiveOrderEditor: React.FC<{
  order?: ProcurementOrderDetail | null;
  onClose: () => void;
  onSaved: (purchaseOrderId: string, poNumber: string) => void;
}> = ({ order = null, onClose, onSaved }) => {
  const [projects, setProjects] = useState<ProcurementProactiveProject[] | null>(null);
  const [stockWarehouses, setStockWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [purpose, setPurpose] = useState<'project' | 'stock'>(order?.proactive?.purpose === 'stock' ? 'stock' : 'project');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(order?.projectId || '');
  const [warehouseId, setWarehouseId] = useState(order?.targetWarehouseId || '');
  const [vendor, setVendor] = useState<VendorValue>(order?.vendorId ? { id: order.vendorId, name: order.vendorName || '' } : null);
  const [expected, setExpected] = useState(order?.expectedDeliveryDate || '');
  const [orderDate, setOrderDate] = useState(order?.orderDate || vnToday());
  const [orderDateTouched, setOrderDateTouched] = useState(false);
  const [vat, setVat] = useState(String(order?.vatRate ?? 10));
  const [mode, setMode] = useState<'single' | 'multiple'>(order?.purchaseMode || 'single');
  const [note, setNote] = useState(order?.note || '');
  const [reasonCode, setReasonCode] = useState<ProcurementProactiveReason | ''>(order?.proactive?.reasonCode || '');
  const [reason, setReason] = useState(order?.proactive?.reason || '');
  const [overReason, setOverReason] = useState(order?.proactive?.overBoqReason || '');
  const [lines, setLines] = useState<Line[]>(() => (order ? fromOrder(order) : []));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProcurementCatalogItem[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Vật tư chưa có trong danh mục: tạo mã ngay tại đây (null = đóng hộp thoại).
  const [createName, setCreateName] = useState<string | null>(null);
  // Ô quyền nhạy cảm "Tạo mã vật tư": không có thì không hiện nút tạo.
  const [canCreateItem, setCanCreateItem] = useState(false);
  useEffect(() => { wmsCatalogService.createOptions().then(o => setCanCreateItem(o.canCreate)).catch(() => setCanCreateItem(false)); }, []);

  useEffect(() => {
    procurementInboxService.proactiveOptions().then(r => { setProjects(r.projects); setStockWarehouses(r.stockWarehouses || []); })
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);
  const project = projects?.find(p => p.id === projectId) || null;
  useEffect(() => {
    if (purpose === 'stock') { if (!stockWarehouses.some(w => w.id === warehouseId)) setWarehouseId(stockWarehouses[0]?.id || ''); return; }
    if (project && !project.warehouses.some(w => w.id === warehouseId)) setWarehouseId(project.warehouses[0]?.id || '');
  }, [project, warehouseId, purpose, stockWarehouses]);
  const stock = purpose === 'stock';
  const scopeReady = stock ? Boolean(warehouseId) : Boolean(projectId);
  useEffect(() => {
    if (!searchOpen || !scopeReady) return;
    if (stock && !query.trim()) { setResults([]); return; }
    setResults(null);
    const t = setTimeout(() => { procurementInboxService.searchItems(stock ? null : projectId, query).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [query, searchOpen, projectId, stock, scopeReady]);

  const addItem = (item: ProcurementCatalogItem) => {
    // Mã đã có trong đơn vẫn thêm được dòng nữa — ghi quy cách khác để đặt giá riêng.
    setLines(cur => [...cur, {
      key: newLineKey(item.id), itemId: item.id, name: item.name, spec: '', sku: item.sku, unit: item.unit,
      altUnit: Boolean(item.purchaseUnit), purchaseUnit: item.purchaseUnit || '', factor: item.purchaseFactor && item.purchaseFactor > 0 ? item.purchaseFactor : 1,
      purchaseQty: '', stockQty: '', price: '', allocatedQty: 0,
      boq: { inBoq: item.inBoq, boqQty: item.boqQty, orderedQty: item.orderedQty },
    }]);
    setQuery(''); setSearchOpen(false);
  };
  const patch = (key: string, p: Partial<Line>) => setLines(cur => cur.map(l => l.key === key ? { ...l, ...p } : l));
  /** Từ Excel: vật tư mới thì thêm dòng, vật tư đã có thì cập nhật SL, đơn giá (và quy cách nếu file có). */
  const importLines = (imported: ImportedPoLine[]) => setLines(cur => {
    const next = [...cur];
    imported.forEach(({ item, spec, stockQty, altUnit, price }) => {
      const values = {
        // Đơn giá trong file đi theo ĐVT trong file → cách tính đơn vị của dòng phải theo file.
        stockQty: qtyInput(stockQty), price: price == null ? '' : qtyInput(price), purchaseQty: '', altUnit,
        ...(altUnit ? { purchaseUnit: item.purchaseUnit || '', factor: item.purchaseFactor && item.purchaseFactor > 0 ? item.purchaseFactor : 1 } : {}),
      };
      // File có quy cách → khớp đúng dòng cùng mã + quy cách, khác quy cách thì thêm dòng mới.
      const at = next.findIndex(l => l.itemId === item.id && (!spec || specKey(l.spec) === specKey(spec)));
      if (at >= 0) { next[at] = { ...next[at], ...values, ...(spec ? { spec } : {}) }; return; }
      next.push({
        key: newLineKey(item.id), itemId: item.id, name: item.name, spec, sku: item.sku, unit: item.unit,
        purchaseUnit: item.purchaseUnit || '', factor: item.purchaseFactor && item.purchaseFactor > 0 ? item.purchaseFactor : 1,
        allocatedQty: 0, boq: { inBoq: item.inBoq, boqQty: item.boqQty, orderedQty: item.orderedQty }, ...values,
      });
    });
    return next;
  });

  const boqLines = useMemo(() => withPriorSameItem(lines), [lines]);
  const specProblems = useMemo(() => duplicateItemSpecProblems(lines.map(l => ({ key: l.key, itemId: l.itemId, specification: l.spec }))), [lines]);
  const totals = useMemo(() => {
    let subtotal = 0; let invalid = 0; let unpriced = 0; let overBoq = 0; let belowAllocated = 0;
    boqLines.forEach(l => {
      const stock = parseQty(l.stockQty);
      const price = parseQty(l.price);
      if (stock == null || Number.isNaN(stock) || stock <= 0) { invalid += 1; return; }
      if (stock < l.allocatedQty - 0.0005) belowAllocated += 1;
      const qty = purchaseQtyOf(l, stock);
      if (!(qty > 0)) invalid += 1;
      if (price != null && (Number.isNaN(price) || price < 0)) invalid += 1; else if (!price) unpriced += 1; else subtotal += qty * price;
      if (purpose === 'project' && boqStatusOf(l.boq, stock) !== 'within') overBoq += 1;
    });
    const vatRate = parseQty(vat) ?? 0;
    return { subtotal, vatAmount: subtotal * (Number.isNaN(vatRate) ? 0 : vatRate) / 100, invalid, unpriced, overBoq, belowAllocated };
  }, [boqLines, vat, purpose]);

  const save = async () => {
    setError(null);
    if (!scopeReady || !warehouseId) { setError(stock ? 'Chọn Kho Tổng nhận hàng.' : 'Chọn dự án và kho nhận.'); return; }
    if (!vendor) { setError('Chọn nhà cung cấp.'); return; }
    if (!reasonCode) { setError('Chọn lý do mua chủ động.'); return; }
    if (reasonCode === 'other' && !reason.trim()) { setError('Chọn "Khác" thì ghi rõ lý do.'); return; }
    if (!lines.length) { setError('Thêm ít nhất một vật tư.'); return; }
    if (totals.invalid) { setError('Còn SL hoặc đơn giá chưa hợp lệ (ô viền đỏ).'); return; }
    if (specProblems.size) { setError('Có vật tư nhiều dòng chưa ghi quy cách khác nhau (ô viền đỏ).'); return; }
    if (totals.belowAllocated) { setError('Có dòng nhỏ hơn phần đã gắn nhu cầu. Gỡ gắn ở đơn trước rồi mới giảm SL.'); return; }
    if (totals.overBoq && !overReason.trim()) { setError('Có vật tư vượt hoặc ngoài BOQ — ghi lý do mua vượt.'); return; }
    const vatRate = parseQty(vat);
    if (vatRate == null || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) { setError('Thuế VAT phải từ 0 đến 100%.'); return; }
    setSaving(true);
    try {
      const result = await procurementInboxService.saveProactiveOrder({
        purchaseOrderId: order?.id, expectedRowVersion: order?.rowVersion, purpose, projectId: stock ? null : projectId, targetWarehouseId: warehouseId, vendorId: vendor.id,
        purchaseMode: mode, expectedDeliveryDate: expected || null, vatRate, note: note.trim(),
        reasonCode, reason: reason.trim() || undefined, overBoqReason: totals.overBoq ? overReason.trim() : undefined,
        items: lines.map(l => {
          const stock = parseQty(l.stockQty) || 0;
          return {
            lineId: l.lineId, itemId: l.itemId, stockQty: stock, unitPrice: parseQty(l.price) || 0, specification: l.spec.trim() || undefined,
            ...(l.altUnit ? { purchaseUnit: l.purchaseUnit.trim() || undefined, purchaseQty: purchaseQtyOf(l, stock) } : {}),
          };
        }),
      });
      if (orderDateTouched) await procurementInboxService.setOrderDate(result.purchaseOrderId, orderDate);
      onSaved(result.purchaseOrderId, result.poNumber);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return <Drawer xl label={order ? `Sửa đơn chủ động ${order.poNumber}` : 'Lập đơn chủ động'} onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{order ? `Sửa đơn chủ động ${order.poNumber}` : 'Đơn chủ động'}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{order ? [order.projectCode, order.projectName].filter(Boolean).join(' — ') : 'Lập đơn khi chưa có phiếu nhu cầu'}</h2>
      <p className="text-sm text-muted-foreground">Vẫn gửi người có quyền Mua hàng — Quản trị duyệt. Nhu cầu đến sau sẽ được gắn vào đơn này thay vì mua thêm.</p>
    </>}
    footer={projects ? <>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" onClick={() => void save()} disabled={saving} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}{order ? 'Lưu thay đổi' : 'Lưu đơn nháp'}</button>
    </> : undefined}>
    {loadError ? <StateBox kind="error" message={loadError} />
      : !projects ? <StateBox kind="loading" title="Đang tải dự án và kho…" />
        : projects.length === 0 ? <StateBox kind="empty" title="Chưa có dự án nào có kho công trường" message="Đơn chủ động nhận vào kho công trường của dự án. Mua dự trữ Kho Tổng sẽ mở cùng phần Công nợ NCC (K3a)." />
          : <>
            <section role="radiogroup" aria-label="Mục đích mua" className="grid gap-2 md:grid-cols-2">
              {([['project', 'Cho một dự án', 'Nhận vào kho công trường; chi phí ghi cho dự án khi nhận hàng; so với BOQ dự án.'],
                ['stock', 'Dự trữ Kho Tổng', 'Nhận vào Kho Tổng; công nợ ghi cấp công ty; chi phí vào dự án khi chuyển kho sang công trường.']] as const).map(([k, label, hint]) =>
                <button key={k} type="button" role="radio" aria-checked={purpose === k} disabled={Boolean(order) && purpose !== k}
                  onClick={() => { if (purpose !== k) { setPurpose(k); setLines([]); setWarehouseId(''); } }}
                  className={`rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${purpose === k ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20 dark:bg-teal-950/20' : 'border-border bg-card hover:border-teal-300'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className={`h-3.5 w-3.5 rounded-full border-2 ${purpose === k ? 'border-teal-600 bg-teal-600' : 'border-muted-foreground'}`} />{label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{hint}</span></button>)}
            </section>
            <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
              {stock ? <label className="text-xs font-semibold text-muted-foreground md:col-span-2">Kho nhận
                <select value={warehouseId} disabled={Boolean(order)} onChange={e => setWarehouseId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
                  {stockWarehouses.length === 0 && <option value="">Chưa có Kho Tổng</option>}
                  {stockWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></label> : <>
              <label className="text-xs font-semibold text-muted-foreground">Dự án nhận hàng
                <select value={projectId} disabled={Boolean(order)} onChange={e => { setProjectId(e.target.value); setLines([]); }} className={`mt-1 w-full ${inputCls}`}>
                  <option value="">Chọn dự án…</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' — ')}</option>)}
                </select>
                {order && <span className="mt-1 block font-normal">Không đổi được dự án của đơn đã lập.</span>}
              </label>
              <label className="text-xs font-semibold text-muted-foreground">Kho nhận
                <select value={warehouseId} disabled={!project} onChange={e => setWarehouseId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
                  {!project && <option value="">Chọn dự án trước</option>}
                  {project?.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label></>}
              <VendorPicker value={vendor} onChange={setVendor} autoFocus={false} />
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="text-xs font-semibold text-muted-foreground">Ngày đặt hàng
                  <input type="date" value={orderDate} max={vnToday()} onChange={e => { setOrderDate(e.target.value); setOrderDateTouched(true); }} className={`mt-1 w-full ${inputCls}`} />
                  {backdateHint(orderDate) && <span className="mt-0.5 block text-[11px] font-normal text-amber-700 dark:text-amber-300">{backdateHint(orderDate)}</span>}</label>
                <label className="text-xs font-semibold text-muted-foreground">Ngày cần giao
                  <input type="date" value={expected} onChange={e => setExpected(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
                <VatPicker value={vat} onChange={setVat} />
              </div>
            </section>

            <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Vì sao mua khi chưa có phiếu nhu cầu?</h3>
              <div role="radiogroup" aria-label="Lý do mua chủ động" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(PROACTIVE_REASON_LABELS) as ProcurementProactiveReason[]).map(code => {
                  const active = reasonCode === code;
                  return <button key={code} type="button" role="radio" aria-checked={active} onClick={() => setReasonCode(code)}
                    className={`rounded-xl border px-3 py-2 text-left transition ${active ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20 dark:bg-teal-950/20' : 'border-border hover:border-teal-300'}`}>
                    <span className="block text-sm font-semibold text-foreground">{PROACTIVE_REASON_LABELS[code].label}</span>
                    <span className="block text-xs text-muted-foreground">{PROACTIVE_REASON_LABELS[code].hint}</span></button>;
                })}
              </div>
              <input value={reason} onChange={e => setReason(e.target.value)} aria-label="Diễn giải lý do"
                placeholder={reasonCode === 'other' ? 'Ghi rõ lý do (bắt buộc)' : 'Diễn giải thêm (không bắt buộc) — VD: NCC báo tăng giá thép từ 15/10'}
                className={`w-full ${inputCls} ${reasonCode === 'other' && !reason.trim() ? 'border-amber-400' : ''}`} />
            </section>

            <DeliveryModePicker value={mode} onChange={setMode} />

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">Vật tư đặt mua</h3>
                  <span className="text-xs text-muted-foreground">SL theo đơn vị kho · đơn giá theo đơn vị mua</span>
                </div>
                <PoExcelImport projectId={stock ? null : projectId || null} disabled={!scopeReady} existingItemIds={lines.map(l => l.itemId)}
                  templateRows={lines.map(l => {
                    const qty = parseQty(l.stockQty);
                    const alt = l.altUnit && l.purchaseUnit;
                    return [l.sku || '', l.name, l.spec, alt ? l.purchaseUnit : l.unit || '',
                      qty == null || Number.isNaN(qty) ? '' : alt ? purchaseQtyOf(l, qty) : qty, priceCell(l.price)];
                  })}
                  onImport={importLines} />
              </div>
              <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input ref={searchRef} value={query} disabled={!scopeReady} onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  onChange={e => { setQuery(e.target.value); setSearchOpen(true); }} aria-label="Thêm vật tư"
                  placeholder={!scopeReady ? 'Chọn dự án trước khi thêm vật tư' : stock ? 'Thêm vật tư — gõ tên hoặc mã' : 'Thêm vật tư — gõ tên hoặc mã (để trống: gợi ý vật tư trong BOQ dự án)'}
                  className={`w-full pl-8 ${inputCls}`} />
                {searchOpen && scopeReady && (!stock || query.trim()) && <ul role="listbox" className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                  {results == null && <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Đang tìm vật tư…</li>}
                  {results?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{query ? (canCreateItem ? 'Không tìm thấy vật tư trong danh mục.' : 'Không tìm thấy vật tư. Gửi Đề xuất mã mới ở Vật tư → Danh mục, hoặc nhờ người có quyền Tạo mã vật tư.') : 'Dự án chưa có BOQ vật tư — gõ tên để tìm trong danh mục.'}</li>}
                  {results?.map(item => {
                    const added = lines.filter(l => l.itemId === item.id).length;
                    return <li key={item.id}><button type="button" role="option" aria-selected={false} onMouseDown={e => e.preventDefault()} onClick={() => addItem(item)}
                      title={added ? 'Thêm một dòng nữa của mã này — ghi quy cách khác để đặt giá riêng' : undefined}
                      className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="min-w-0"><span className="font-medium text-mint-700 dark:text-mint-300">{item.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{[item.sku, item.unit].filter(Boolean).join(' · ')}</span></span>
                      <span className="text-xs text-muted-foreground">{added ? <b className="text-teal-700 dark:text-teal-300">Đã có {added} dòng · thêm quy cách khác</b> : stock ? (item.unit || '') : item.inBoq
                        ? <>BOQ <b className="text-leaf-700 dark:text-leaf-300">{fmt(item.boqQty, 3)}</b> · đã đặt {fmt(item.orderedQty, 3)}</>
                        : 'Ngoài BOQ'}</span></button></li>;
                  })}
                  {canCreateItem && results != null && query.trim() && <li className="border-t border-border"><button type="button" onMouseDown={e => e.preventDefault()}
                    onClick={() => { setCreateName(query.trim()); setSearchOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">
                    <Plus size={15} />Tạo vật tư mới “{query.trim()}”</button></li>}
                </ul>}
              </div>
              {canCreateItem && <button type="button" disabled={!scopeReady} onClick={() => { setCreateName(query.trim()); setSearchOpen(false); }}
                title={scopeReady ? 'Vật tư chưa có trong danh mục? Tạo mã mới ngay' : 'Chọn dự án trước'} aria-label="Tạo vật tư mới"
                className={`${secondaryBtn} shrink-0 bg-card`}><Plus size={15} /><span className="hidden sm:inline">Vật tư mới</span></button>}
              </div>

              {lines.length === 0
                ? <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {scopeReady ? 'Chưa có vật tư. Bấm ô tìm ở trên để thêm.' : 'Chọn dự án nhận hàng rồi thêm vật tư.'}</p>
                : <ul className="space-y-3">{boqLines.map((l, i) => {
                  const specProblem = specProblems.get(l.key);
                  const stock = parseQty(l.stockQty);
                  const stockBad = stock == null || Number.isNaN(stock) || stock <= 0;
                  const price = parseQty(l.price);
                  const priceBad = price != null && (Number.isNaN(price) || price < 0);
                  const qty = stockBad ? 0 : purchaseQtyOf(l, stock as number);
                  const status = boqStatusOf(l.boq, stockBad ? 0 : stock as number);
                  const typed = l.altUnit && l.purchaseQty.trim() !== '';
                  const unitLabel = l.altUnit ? l.purchaseUnit || '?' : l.unit || '';
                  return <li key={l.key} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 border-l-teal-500 bg-teal-50/60 px-3 py-2.5 dark:bg-teal-950/20">
                      <span className="w-5 text-sm font-bold tabular-nums">{i + 1}</span>
                      <span className="flex min-w-0 flex-1 basis-[calc(100%-2.5rem)] flex-wrap items-center gap-x-2 gap-y-1 md:basis-auto">
                        <span className="font-semibold text-mint-700 dark:text-mint-300">{l.name}</span>
                        <input value={l.spec} onChange={e => patch(l.key, { spec: e.target.value })} maxLength={160} aria-label={`Quy cách ${l.name}`} aria-invalid={Boolean(specProblem)}
                          placeholder="Quy cách / cấu hình (VD KT 30x30)" title="Hiển thị trên đơn và mẫu in; mỗi quy cách một giá — kho vẫn theo mã vật tư gốc"
                          className={`min-w-[10rem] flex-1 py-1 text-xs md:max-w-[16rem] ${inputCls} ${specProblem ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} />
                        {specProblem && <span className="w-full text-xs font-semibold text-rose-700 dark:text-rose-300">{specProblem}</span>}
                        <span className="w-full text-xs text-muted-foreground">{[l.sku, l.unit].filter(Boolean).join(' · ')}</span></span>
                      {purpose === 'project' && <Badge className={BOQ_TONE[status]}>{boqLabel(l, stockBad ? 0 : stock as number)}</Badge>}
                      <button type="button" disabled={l.allocatedQty > 0} title={l.allocatedQty > 0 ? 'Dòng đã gắn nhu cầu — gỡ gắn ở đơn trước' : 'Bỏ vật tư'}
                        aria-label={`Bỏ ${l.name}`} onClick={() => setLines(cur => cur.filter(x => x.key !== l.key))}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-700 disabled:opacity-40"><Trash2 size={15} /></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 pl-11 text-xs text-muted-foreground">
                      <label className="flex items-center gap-1.5">SL kho
                        <input inputMode="decimal" value={l.stockQty} onChange={e => patch(l.key, { stockQty: e.target.value })} aria-label={`SL ${l.name}`} aria-invalid={stockBad && l.stockQty !== ''}
                          className={`w-24 text-right tabular-nums ${inputCls} ${(stockBad && l.stockQty !== '') || (!stockBad && (stock as number) < l.allocatedQty - 0.0005) ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} />
                        <span className="w-10">{l.unit}</span></label>
                      {l.altUnit
                        ? <span className="flex flex-wrap items-center gap-1.5">⇄ SL mua
                          <input inputMode="decimal" value={typed ? l.purchaseQty : qtyInput(qty)} onChange={e => patch(l.key, { purchaseQty: e.target.value })} aria-label={`SL mua ${l.name}`}
                            className={`w-20 text-right tabular-nums ${inputCls} ${typed ? 'border-amber-400' : ''}`} />
                          <input value={l.purchaseUnit} onChange={e => patch(l.key, { purchaseUnit: e.target.value })} aria-label={`Đơn vị mua ${l.name}`} placeholder="ĐV mua" className={`w-16 ${inputCls}`} />
                          {typed && <button type="button" onClick={() => patch(l.key, { purchaseQty: '' })} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Tự quy đổi</button>}</span>
                        : <button type="button" onClick={() => patch(l.key, { altUnit: true, factor: 1 })} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">+ Mua theo đơn vị khác</button>}
                      <label className="flex items-center gap-1.5">Đơn giá{unitLabel ? ` / ${unitLabel}` : ''}
                        <input inputMode="decimal" value={l.price} onChange={e => patch(l.key, { price: e.target.value })} placeholder="0" aria-label={`Đơn giá ${l.name}`} aria-invalid={priceBad}
                          className={`w-28 text-right tabular-nums ${inputCls} ${priceBad ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} /></label>
                      <span className="ml-auto whitespace-nowrap text-sm font-semibold tabular-nums text-leaf-700 dark:text-leaf-300">{price && price > 0 && qty > 0 ? `${money(qty * price)} đ` : 'Chưa có giá'}</span>
                      {l.allocatedQty > 0 && <span className="flex w-full items-center gap-1 text-teal-700 dark:text-teal-300"><Link2 size={12} />Đã gắn {fmt(l.allocatedQty, 3)} {l.unit} cho phiếu nhu cầu — không giảm SL dưới mức này.</span>}
                    </div>
                  </li>;
                })}</ul>}
              {scopeReady && lines.length > 0 && <button type="button" onClick={() => { searchRef.current?.focus(); setSearchOpen(true); }} className={`${secondaryBtn} bg-card`}><Plus size={15} />Thêm vật tư</button>}
            </section>

            {totals.overBoq > 0 && <section className="space-y-1.5 rounded-2xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-100"><AlertTriangle size={15} />{totals.overBoq} vật tư vượt hoặc ngoài BOQ dự án</p>
              <textarea value={overReason} onChange={e => setOverReason(e.target.value)} rows={2} aria-label="Lý do mua vượt BOQ"
                placeholder="Lý do (bắt buộc) — VD: BOQ chưa khai dầu cho máy ép cọc; thép dự phòng đợt 2…" className={`w-full ${inputCls} ${!overReason.trim() ? 'border-amber-400' : ''}`} />
              <p className="text-xs text-muted-foreground">Người duyệt đơn sẽ thấy lý do này cùng số BOQ và số đã đặt lúc lập đơn.</p>
            </section>}

            <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <label className="text-xs font-semibold text-muted-foreground">Ghi chú cho NCC / nội bộ
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={`mt-1 w-full ${inputCls}`} placeholder="Điều kiện giao, liên hệ nhận hàng…" /></label>
              <dl className="space-y-1 rounded-2xl border border-border bg-card p-4 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Tiền hàng</dt><dd className="tabular-nums">{money(totals.subtotal)} đ</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">VAT {vat}%</dt><dd className="tabular-nums">{money(totals.vatAmount)} đ</dd></div>
                <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>Tổng cộng</dt><dd className="tabular-nums text-leaf-700 dark:text-leaf-300">{money(totals.subtotal + totals.vatAmount)} đ</dd></div>
                {totals.unpriced > 0 && <p className="pt-1 text-xs text-amber-700 dark:text-amber-300">{totals.unpriced} vật tư chưa có đơn giá — lưu nháp được, cần đủ giá mới gửi duyệt.</p>}
                {expected && <p className="pt-1 text-xs text-muted-foreground">Cần giao trước {dateVi(expected)}</p>}
              </dl>
            </section>
            {stock && <p className="text-xs text-muted-foreground">Đơn dự trữ: công nợ NCC ghi cấp công ty (module Tài chính, nhóm "Kho công ty"); chi phí vào dự án khi chuyển kho sang kho công trường, theo giá vốn sổ kho.</p>}
          </>}
    {createName !== null && <QuickCreateItemDialog<ProcurementCatalogItem> initialName={createName}
      findSimilar={name => procurementInboxService.searchItems(stock ? null : projectId, name)}
      useExistingLabel="Thêm vào đơn" onUseExisting={item => { addItem(item); setCreateName(null); }}
      onClose={() => setCreateName(null)}
      onCreated={item => {
        addItem({ id: item.id, name: item.name, sku: item.sku, unit: item.unit, purchaseUnit: item.purchaseUnit,
          purchaseFactor: item.purchaseConversionFactor, inBoq: false, boqQty: 0, orderedQty: 0 });
        setCreateName(null);
      }} />}
  </Drawer>;
};

export default ProactiveOrderEditor;
