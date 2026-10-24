import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  procurementInboxService,
  type ProcurementInboxDetail, type ProcurementOrderDetail, type ProcurementSourceRef, type ProcurementVendorPrefill,
} from '../../../lib/procurementInboxService';
import { splitLinesForOrder } from '../../../lib/procurementLineAssignment';
import { duplicateItemSpecProblems, specKey } from '../../../lib/materialLineDescription';
import { dateVi, fmt, parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';
import { SpecInput } from '../../material/SpecInput';
import { businessDateIssue, vnToday } from '../../../lib/businessDate';
import { DeliveryModePicker, OrderDateField, VatPicker, VendorPicker, useCanBackdate } from './OrderFormParts';
import { PrefillGhost, ghostInput } from '../../common/PrefillGhost';
import {
  PRICE_DEVIATION_WARN_PERCENT, headerGhostRows, matchPrefillLine, prefillSourceLabel, priceDeviationPercent, priceGhost, recordPrefillOutcome, specGhost,
} from '../../../lib/procurementPrefill';
import { recordSuggestionEvent } from '../../../lib/uiSuggestionEvents';

// Lập / sửa đơn hàng từ một hoặc nhiều phiếu nhu cầu. Mỗi mã + quy cách là một dòng đơn hàng (một mã nhiều
// quy cách, mỗi quy cách một giá — chủ SP 09/10); người mua tách thêm dòng được. SL đặt phân về từng dòng nhu cầu
// để theo dõi còn thiếu. Phiếu của nhiều dự án → đơn gom: một NCC, mỗi đợt giao về một công trường, nợ + chi phí
// theo dự án nhận (việc 2).

interface Row { key: string; sourceType: ProcurementSourceRef['sourceType']; sourceId: string; code: string; lineId: string; needQty: number; orderedElsewhere: number; available: number; qty: string;
  projectCode: string | null; warehouseName: string | null;
  /** Lý do đặt vượt phần còn thiếu — bắt buộc khi gửi duyệt (K2, máy chủ kiểm cộng các đơn trước, dung sai 2%). */
  excessReason: string }
const EXCESS_REASONS = ['Hao hụt thi công', 'NCC bán theo cuộn / bó', 'Dự phòng đợt sau'];
/** Đặt vượt phần còn thiếu của dòng nhu cầu. */
const rowOver = (row: Pick<Row, 'qty' | 'available'>) => { const q = parseQty(row.qty); return q != null && !Number.isNaN(q) && q > row.available * 1.0001 + 0.001; };
interface Item {
  /** Dòng đơn: mã + quy cách (hoặc dòng của đơn đang sửa, hoặc dòng người mua tách ra). */
  key: string; specification: string;
  itemId: string; name: string; sku: string | null; unit: string | null;
  /** Buy in another unit than the stock unit (e.g. kg vs cây); quantity can be typed by hand. */
  altUnit: boolean; purchaseUnit: string; factor: number; purchaseQty: string;
  price: string; rows: Row[];
}

/** Need quantities are in the stock unit; orders and prices use the purchase unit (stock = purchase × factor). */
const autoPurchase = (item: Pick<Item, 'altUnit' | 'factor'>, stockQty: number) => item.altUnit ? Math.round(stockQty / item.factor * 1000) / 1000 : stockQty;
const purchaseQtyOf = (item: Item, stockQty: number) => {
  if (!item.altUnit) return stockQty;
  const typed = parseQty(item.purchaseQty);
  return typed == null ? autoPurchase(item, stockQty) : typed;
};

const buildItems = (docs: ProcurementInboxDetail[], order: ProcurementOrderDetail | null, include?: ReadonlySet<string>): Item[] => {
  const mine = new Map<string, { qty: number; price: number; poLineId: string; excessReason: string }>();
  order?.lines.forEach(line => line.allocations.forEach(a => mine.set(`${a.sourceType}:${a.sourceId}:${a.lineId}`, { qty: a.qty, price: line.unitPrice, poLineId: line.lineId, excessReason: a.excessReason || '' })));
  const ownLineById = new Map((order?.lines || []).map(line => [line.lineId, line]));
  const ownLineByItem = new Map((order?.lines || []).map(line => [line.itemId, line]));
  const byItem = new Map<string, Item>();
  docs.forEach(doc => doc.lines.forEach(line => {
    if (!line.itemId) return;
    const key = `${doc.sourceType}:${doc.sourceId}:${line.lineId}`;
    const own = mine.get(key);
    if (!own && include && !include.has(key)) return;
    const orderedElsewhere = Math.max(0, line.orderedQty - (own?.qty || 0));
    const available = Math.max(0, line.needQty - orderedElsewhere);
    if (!own && available <= 0) return;
    const prev = own ? ownLineById.get(own.poLineId) : ownLineByItem.get(line.itemId);
    const prevAlt = Boolean(prev && prev.stockUnit && prev.unit && prev.unit !== prev.stockUnit);
    const spec = own ? prev?.specification || '' : line.specification || '';
    const groupKey = own ? `po:${own.poLineId}` : `${line.itemId}|${specKey(spec)}`;
    const item = byItem.get(groupKey) || { key: groupKey, specification: spec.trim(), itemId: line.itemId, name: line.itemName, sku: line.sku, unit: line.unit,
      altUnit: prevAlt || Boolean(line.purchaseUnit),
      purchaseUnit: (prevAlt ? prev?.unit : line.purchaseUnit) || '',
      factor: prevAlt && prev ? prev.factor : line.purchaseFactor && line.purchaseFactor > 0 ? line.purchaseFactor : 1,
      purchaseQty: prevAlt && prev ? qtyInput(prev.qty) : '', price: '', rows: [] };
    if (own && !item.price) item.price = qtyInput(own.price);
    item.rows.push({ key, sourceType: doc.sourceType, sourceId: doc.sourceId, code: doc.code, lineId: line.lineId,
      needQty: line.needQty, orderedElsewhere, available, qty: qtyInput(own ? own.qty : available),
      projectCode: doc.projectCode, warehouseName: doc.warehouseName, excessReason: own?.excessReason || '' });
    byItem.set(groupKey, item);
  }));
  return Array.from(byItem.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.specification.localeCompare(b.specification, 'vi'));
};

export const OrderEditor: React.FC<{
  sources: ProcurementSourceRef[];
  order?: ProcurementOrderDetail | null;
  /** Dòng đã tick trong phiếu (`sourceType:sourceId:lineId`). Không truyền = mọi dòng còn thiếu trừ dòng người khác phụ trách. */
  lineKeys?: string[];
  currentUserId?: string;
  onClose: () => void;
  onSaved: (purchaseOrderId: string, poNumber: string) => void;
}> = ({ sources, order = null, lineKeys, currentUserId = '', onClose, onSaved }) => {
  const [docs, setDocs] = useState<ProcurementInboxDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(order?.vendorId ? { id: order.vendorId, name: order.vendorName || '' } : null);
  const [expected, setExpected] = useState(order?.expectedDeliveryDate || '');
  const [orderDate, setOrderDate] = useState(order?.orderDate || vnToday());
  const [orderDateTouched, setOrderDateTouched] = useState(false);
  // Đơn đã lưu trong phiên này: bấm Lưu lại là SỬA đơn đó, không đẻ thêm đơn nháp (24/10, PO-703/704/705).
  const [saved, setSaved] = useState<{ id: string; rowVersion: number } | null>(null);
  const [vat, setVat] = useState(String(order?.vatRate ?? 10));
  const [note, setNote] = useState(order?.note || '');
  const [mode, setMode] = useState<'single' | 'multiple'>(order?.purchaseMode || 'single');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Array<{ name: string | null; count: number }>>([]);
  // "Như đơn trước" cùng NCC (chỉ khi lập mới): đầu đơn một khối, quy cách / đơn giá in mờ trong ô.
  const [prefill, setPrefill] = useState<ProcurementVendorPrefill | null>(null);
  const [headerTouched, setHeaderTouched] = useState(false);
  const [headerDismissed, setHeaderDismissed] = useState(false);
  const vendorId = vendor?.id || '';
  useEffect(() => {
    setPrefill(null); setHeaderDismissed(false);
    if (order || !vendorId) return;
    let alive = true;
    procurementInboxService.vendorPrefill(vendorId).then(r => { if (alive) setPrefill(r); }).catch(() => { if (alive) setPrefill(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const sourceKey = sources.map(s => `${s.sourceType}:${s.sourceId}`).join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(sources.map(s => procurementInboxService.get(s.sourceType, s.sourceId)))
      .then(result => {
        if (!alive) return;
        const split = order ? null : splitLinesForOrder(result, currentUserId, lineKeys ? new Set(lineKeys) : undefined);
        setDocs(result); setItems(buildItems(result, order, split?.include)); setSkipped(split?.skipped || []);
        if (!order) {
          const dates = result.map(d => d.neededDate).filter((d): d is string => Boolean(d)).sort();
          const today = new Date().toISOString().slice(0, 10);
          if (dates[0] && dates[0] >= today) setExpected(dates[0]);
        }
      })
      .catch(e => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const project = docs?.[0];
  const isGroup = Boolean(docs && new Set(docs.map(d => `${d.projectId}|${d.constructionSiteId}`)).size > 1);
  const groupProjects = Array.from(new Set((docs || []).map(d => d.projectCode || d.projectName || '—')));
  const warehouses = Array.from(new Set((docs || []).map(d => d.warehouseName).filter(Boolean)));
  // Đơn gom: tiền hàng tạm tính theo dự án (SL phân bổ × đơn giá), để biết nợ + chi phí mỗi dự án.
  const perProject = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(item => {
      const price = parseQty(item.price) || 0;
      const stockQty = item.rows.reduce((sum, r) => sum + Math.max(0, parseQty(r.qty) || 0), 0);
      const qty = purchaseQtyOf(item, stockQty);
      item.rows.forEach(r => { const q = Math.max(0, parseQty(r.qty) || 0); if (stockQty > 0) map.set(r.projectCode || '—', (map.get(r.projectCode || '—') || 0) + qty * price * q / stockQty); });
    });
    return Array.from(map.entries());
  }, [items]);

  const totals = useMemo(() => {
    let subtotal = 0; let invalid = 0; let over = 0; let overNoReason = 0; let lines = 0; let unpriced = 0;
    items.forEach(item => {
      const price = parseQty(item.price);
      const stockQty = item.rows.reduce((sum, row) => {
        const q = parseQty(row.qty);
        if (q != null && Number.isNaN(q)) invalid += 1;
        if (rowOver(row)) { over += 1; if (!row.excessReason.trim()) overNoReason += 1; }
        return sum + (q && q > 0 ? q : 0);
      }, 0);
      const qty = purchaseQtyOf(item, stockQty);
      if (item.altUnit && (qty == null || Number.isNaN(qty) || (stockQty > 0 && qty <= 0))) invalid += 1;
      if (stockQty > 0 && qty > 0) { lines += 1; if (price != null && (Number.isNaN(price) || price < 0)) invalid += 1; else if (!price) unpriced += 1; else subtotal += qty * price; }
    });
    const vatRate = parseQty(vat) ?? 0;
    return { subtotal, vatAmount: subtotal * (Number.isNaN(vatRate) ? 0 : vatRate) / 100, invalid, over, overNoReason, lines, unpriced };
  }, [items, vat]);

  const patchRow = (itemKey: string, key: string, patch: Partial<Row>) =>
    setItems(cur => cur.map(i => i.key !== itemKey ? i : { ...i, rows: i.rows.map(r => r.key === key ? { ...r, ...patch } : r) }));
  const setRowQty = (itemKey: string, key: string, qty: string) => patchRow(itemKey, key, { qty });
  const setPrice = (itemKey: string, price: string) => setItems(cur => cur.map(i => i.key === itemKey ? { ...i, price } : i));
  const patchItem = (itemKey: string, patch: Partial<Item>) => setItems(cur => cur.map(i => i.key === itemKey ? { ...i, ...patch } : i));
  // Tách một dòng nhu cầu ra dòng đơn riêng (quy cách + giá riêng), đặt ngay dưới dòng gốc.
  const splitRow = (itemKey: string, rowKey: string) => setItems(cur => cur.flatMap(i => {
    if (i.key !== itemKey || i.rows.length < 2) return [i];
    const row = i.rows.find(r => r.key === rowKey);
    if (!row) return [i];
    return [{ ...i, rows: i.rows.filter(r => r.key !== rowKey) },
      { ...i, key: `${i.key}#${rowKey}`, specification: '', price: '', purchaseQty: '', rows: [row] }];
  }));
  const specProblems = useMemo(() => duplicateItemSpecProblems(
    items.filter(i => i.rows.some(r => (parseQty(r.qty) || 0) > 0)).map(i => ({ key: i.key, itemId: i.itemId, specification: i.specification }))), [items]);
  const canBackdate = useCanBackdate();
  const dateIssue = useMemo(() => businessDateIssue(orderDate, canBackdate), [orderDate, canBackdate]);

  const save = async () => {
    setError(null);
    if (!vendor) { setError('Chọn nhà cung cấp.'); return; }
    if (totals.invalid) { setError('Còn số lượng hoặc đơn giá chưa hợp lệ (ô tô đỏ).'); return; }
    if (specProblems.size) { setError('Có mã vật tư nhiều dòng chưa ghi quy cách khác nhau (ô tô đỏ).'); return; }
    if (!totals.lines) { setError('Nhập SL đặt cho ít nhất một vật tư.'); return; }
    if (dateIssue?.blocked) { setError(dateIssue.text); return; }
    const vatRate = parseQty(vat);
    if (vatRate == null || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) { setError('Thuế VAT phải từ 0 đến 100%.'); return; }
    const payload = items.map(item => ({
      itemId: item.itemId, unitPrice: parseQty(item.price) || 0, specification: item.specification.trim() || undefined,
      ...(item.altUnit ? {
        purchaseUnit: item.purchaseUnit.trim() || undefined,
        purchaseQty: purchaseQtyOf(item, item.rows.reduce((sum, r) => sum + Math.max(0, parseQty(r.qty) || 0), 0)),
      } : {}),
      allocations: item.rows.map(r => ({ sourceType: r.sourceType, sourceId: r.sourceId, lineId: r.lineId, qty: parseQty(r.qty) || 0,
        excessReason: rowOver(r) ? r.excessReason.trim() || undefined : undefined })).filter(a => a.qty > 0),
    })).filter(item => item.allocations.length > 0);
    setSaving(true);
    try {
      const result = await procurementInboxService.saveOrder({
        purchaseOrderId: saved?.id || order?.id, expectedRowVersion: saved?.rowVersion ?? order?.rowVersion, vendorId: vendor.id, purchaseMode: mode,
        expectedDeliveryDate: expected || null, vatRate, note: note.trim(), items: payload,
      });
      if (!order && !saved) recordPrefillOutcome(prefill, items.map(i => ({ itemId: i.itemId, specification: i.specification, price: parseQty(i.price) })), { vendorId: vendor.id, poNumber: result.poNumber });
      setSaved({ id: result.purchaseOrderId, rowVersion: result.rowVersion });
      if (orderDateTouched) {
        await procurementInboxService.setOrderDate(result.purchaseOrderId, orderDate);
        setOrderDateTouched(false);
        // Đổi ngày đặt hàng tăng phiên bản đơn — lấy phiên bản mới để lần lưu sau không báo xung đột.
        setSaved({ id: result.purchaseOrderId, rowVersion: (await procurementInboxService.getOrder(result.purchaseOrderId)).rowVersion });
      }
      onSaved(result.purchaseOrderId, result.poNumber);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  const headerRows = prefill?.order && !headerTouched && !headerDismissed ? headerGhostRows(prefill.order, { vat, mode, allowMode: !isGroup }) : [];
  const acceptHeader = () => {
    const last = prefill?.order;
    if (!last) return;
    if (last.vatRate != null) setVat(String(last.vatRate));
    if (!isGroup && last.purchaseMode) setMode(last.purchaseMode);
    setHeaderTouched(true);
    recordSuggestionEvent({ screen: 'purchase_order', field: 'header', outcome: 'accepted', suggested: headerRows.length, accepted: headerRows.length, source: { vendorId, poNumber: last.poNumber } });
  };
  const dismissHeader = () => {
    setHeaderDismissed(true);
    recordSuggestionEvent({ screen: 'purchase_order', field: 'header', outcome: 'dismissed', suggested: headerRows.length, source: { vendorId, poNumber: prefill?.order?.poNumber } });
  };

  return <Drawer xl label={order ? `Sửa ${order.poNumber}` : 'Lập đơn hàng'} onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{order ? `Sửa đơn ${order.poNumber}` : 'Lập đơn hàng'}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{!project ? 'Đang tải…' : isGroup ? <>Đơn gom {groupProjects.length} dự án <span className="font-medium text-muted-foreground">· {groupProjects.join(', ')}</span></>
        : [project.projectCode, project.projectName].filter(Boolean).join(' — ')}</h2>
      <p className="text-sm text-muted-foreground">{docs ? `Từ ${docs.map(d => d.code).join(', ')}` : ''}{warehouses.length ? ` · Kho nhận: ${warehouses.join(', ')}` : ''}</p>
    </>}
    footer={docs ? <>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" onClick={() => void save()} disabled={saving} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}{order ? 'Lưu thay đổi' : 'Lưu đơn nháp'}</button>
    </> : undefined}>
    {loadError ? <StateBox kind="error" message={loadError} />
      : !docs ? <StateBox kind="loading" title="Đang tải phiếu nhu cầu…" />
          : <>
            {isGroup && <p className="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2.5 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-100">
              <b>Đơn gom nhiều dự án:</b> một NCC, một đơn giá mỗi dòng. Sau khi duyệt, mỗi đợt giao chọn <b>một công trường</b>; thủ kho công trường đó nhận, công nợ NCC và chi phí ghi cho dự án của công trường.</p>}
            <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <VendorPicker value={vendor} onChange={setVendor} />
              <OrderDateField value={orderDate} canBackdate={canBackdate} issue={dateIssue}
                onChange={v => { setOrderDate(v); setOrderDateTouched(true); }} />
              <div>
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="po-expected">Ngày cần giao</label>
                <input id="po-expected" type="date" value={expected} onChange={e => setExpected(e.target.value)} className={`mt-1 w-full ${inputCls}`} />
              </div>
              <VatPicker value={vat} onChange={v => { setVat(v); setHeaderTouched(true); }} />
            </section>

            {headerRows.length > 0 && prefill?.order && <PrefillGhost heading="Như đơn trước" title="đầu đơn" rows={headerRows}
              sourceLabel={prefillSourceLabel(prefill.order)} onAccept={acceptHeader} onDismiss={dismissHeader} />}

            {!isGroup && <DeliveryModePicker value={mode} onChange={v => { setMode(v); setHeaderTouched(true); }} />}

            {skipped.length > 0 && <p className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
              Không đưa vào đơn {skipped.reduce((s, x) => s + x.count, 0)} dòng do người khác mua: <b className="text-foreground">{skipped.map(x => `${x.name || '—'} (${x.count})`).join(', ')}</b>.
              Cần đặt luôn thì tick các dòng đó trong phiếu rồi bấm Lập đơn.</p>}

            {items.length === 0
              ? <StateBox kind="empty" title={skipped.length ? 'Không còn dòng nào của bạn' : 'Các phiếu đã đặt đủ'} message={skipped.length ? 'Các dòng còn thiếu đều do người khác mua.' : 'Không còn dòng nhu cầu nào cần đặt thêm.'} />
              : <section className="space-y-3">
                <div className="flex items-baseline justify-between"><h3 className="font-semibold text-foreground">Vật tư đặt mua</h3>
                  <span className="text-xs text-muted-foreground">{items.length} dòng · SL gợi ý = phần còn thiếu của phiếu · cùng mã khác quy cách tách dòng, giá riêng</span></div>
                {items.map((item, i) => {
                  const price = parseQty(item.price);
                  const stockQty = item.rows.reduce((s, r) => s + Math.max(0, parseQty(r.qty) || 0), 0);
                  const qty = purchaseQtyOf(item, stockQty);
                  const typed = item.altUnit && item.purchaseQty.trim() !== '';
                  const unitLabel = item.altUnit ? item.purchaseUnit || '?' : item.unit || '';
                  const priceBad = qty > 0 && price != null && (Number.isNaN(price) || price < 0);
                  const specProblem = specProblems.get(item.key);
                  // Dòng mua gần nhất của NCC cho mã + quy cách này: quy cách và đơn giá in mờ, Tab để dùng; giá lệch > 5% báo cam.
                  const last = prefill ? matchPrefillLine(prefill.lines, item.itemId, item.specification) : null;
                  const priceHint = ghostInput(last ? priceGhost(last) : null, item.price, v => patchItem(item.key, {
                    price: v, ...(last && !item.altUnit && last.unit && last.stockUnit && last.unit !== last.stockUnit ? { altUnit: true, purchaseUnit: last.unit, factor: last.factor || 1 } : {}) }));
                  const specHint = ghostInput(last ? specGhost(last) : null, item.specification, v => patchItem(item.key, { specification: v }));
                  const deviation = last ? priceDeviationPercent(price, last.unitPrice) : null;
                  return <div key={item.key} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 border-l-teal-500 bg-teal-50/60 px-3 py-2.5 dark:bg-teal-950/20">
                      <span className="w-5 text-sm font-bold tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] md:basis-auto"><span className="font-semibold text-foreground">{item.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{[item.sku, item.unit].filter(Boolean).join(' · ')}</span>
                        <SpecInput itemId={item.itemId} itemName={item.name} hideHint={Boolean(specProblem)} value={item.specification} onChange={v => patchItem(item.key, { specification: v })} maxLength={160}
                          placeholder="Quy cách / cấu hình (VD loại 1, tôn biên 13 sóng)" aria-label={`Quy cách ${item.name}`} aria-invalid={Boolean(specProblem)}
                          className={`mt-1 block w-full max-w-md text-sm ${inputCls} ${specProblem ? 'border-rose-400 ring-2 ring-rose-400/30' : ''} ${specHint.className}`} {...specHint.props} />
                        {specProblem && <span className="mt-0.5 block text-xs font-semibold text-rose-700 dark:text-rose-300">{specProblem}</span>}</span>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Đơn giá{unitLabel ? ` / ${unitLabel}` : ''}
                        <input inputMode="decimal" value={item.price} onChange={e => setPrice(item.key, e.target.value)} placeholder="0"
                          aria-label={`Đơn giá ${item.name}`} aria-invalid={priceBad}
                          className={`w-28 text-right tabular-nums ${inputCls} ${priceBad ? 'border-rose-400 ring-2 ring-rose-400/30' : ''} ${priceHint.className}`} {...priceHint.props} /></label>
                      {last && deviation != null && Math.abs(deviation) > PRICE_DEVIATION_WARN_PERCENT && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                        Lệch {deviation > 0 ? '+' : ''}{deviation}% so với {prefillSourceLabel(last, true)}</span>}
                      <span className="ml-auto w-32 text-right text-sm font-semibold tabular-nums text-foreground">{price && price > 0 && qty > 0 ? `${money(qty * price)} đ` : 'Chưa có giá'}</span>
                    </div>
                    {item.altUnit
                      ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-amber-50/50 px-3 py-2 pl-11 text-xs text-muted-foreground dark:bg-amber-950/10">
                        <label className="flex items-center gap-1.5">SL mua
                          <input inputMode="decimal" value={typed ? item.purchaseQty : qtyInput(autoPurchase(item, stockQty))}
                            onChange={e => patchItem(item.key, { purchaseQty: e.target.value })} aria-label={`SL mua ${item.name}`}
                            className={`w-24 text-right tabular-nums ${inputCls} ${typed ? 'border-amber-400' : ''}`} />
                          <input value={item.purchaseUnit} onChange={e => patchItem(item.key, { purchaseUnit: e.target.value })} aria-label={`Đơn vị mua ${item.name}`}
                            placeholder="ĐV mua" className={`w-16 ${inputCls}`} /></label>
                        <span aria-hidden>⇄</span>
                        <span>SL kho <b className="text-foreground tabular-nums">{fmt(stockQty, 3)} {item.unit}</b></span>
                        {qty > 0 && stockQty > 0 && <span>· 1 {item.purchaseUnit || 'ĐV mua'} = {fmt(stockQty / qty, 4)} {item.unit}</span>}
                        {typed ? <button type="button" onClick={() => patchItem(item.key, { purchaseQty: '' })} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Tự quy đổi</button>
                          : <span className="italic">tự quy đổi theo hệ số vật tư — sửa được</span>}
                        {!item.purchaseUnit && <button type="button" onClick={() => patchItem(item.key, { altUnit: false, purchaseQty: '' })} className="ml-auto text-muted-foreground hover:underline">Bỏ</button>}
                      </div>
                      : <div className="px-3 pt-1.5 pl-11"><button type="button" onClick={() => patchItem(item.key, { altUnit: true, factor: 1 })}
                        className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">+ Mua theo đơn vị khác (VD kg ↔ cây)</button></div>}
                    <ul className="divide-y divide-border">{item.rows.map(row => {
                      const q = parseQty(row.qty);
                      const bad = q != null && Number.isNaN(q);
                      const over = rowOver(row);
                      return <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 pl-11 text-sm">
                        <span className="min-w-[8rem] font-medium text-foreground">{row.code}
                          {isGroup && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{row.projectCode} · {row.warehouseName || 'chưa có kho'}</span>}</span>
                        <span className="text-xs text-muted-foreground">Cần {fmt(row.needQty)}{row.orderedElsewhere > 0 ? ` · đã đặt đơn khác ${fmt(row.orderedElsewhere)}` : ''} · còn {fmt(row.available)}</span>
                        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">{item.altUnit ? 'SL kho' : 'SL đặt'}
                          <input inputMode="decimal" value={row.qty} onChange={e => setRowQty(item.key, row.key, e.target.value)}
                            aria-label={`SL đặt ${item.name} cho ${row.code}`} aria-invalid={bad}
                            className={`w-24 text-right tabular-nums ${inputCls} ${bad ? 'border-rose-400 ring-2 ring-rose-400/30' : over ? 'border-amber-400' : ''}`} />
                          <span className="w-10">{item.unit}</span></label>
                        {item.rows.length > 1 && <button type="button" onClick={() => splitRow(item.key, row.key)} title="Tách dòng nhu cầu này thành dòng đơn riêng — quy cách và giá riêng"
                          className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">Tách dòng</button>}
                        {over && <div className="flex w-full flex-wrap items-center justify-end gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                          <span className="font-semibold">Vượt {fmt((q || 0) - row.available)} {item.unit} · lý do</span>
                          {EXCESS_REASONS.map(t => <button key={t} type="button" aria-pressed={row.excessReason === t} onClick={() => patchRow(item.key, row.key, { excessReason: t })}
                            className={`rounded-full border px-2 py-0.5 ${row.excessReason === t ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card hover:bg-muted'}`}>{t}</button>)}
                          <input value={row.excessReason} onChange={e => patchRow(item.key, row.key, { excessReason: e.target.value })} placeholder="hoặc ghi lý do"
                            aria-label={`Lý do đặt vượt ${item.name} cho ${row.code}`} className={`w-48 ${inputCls} ${row.excessReason.trim() ? '' : 'border-amber-400'}`} />
                        </div>}
                      </li>;
                    })}</ul>
                  </div>;
                })}
              </section>}

            <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <label className="text-xs font-semibold text-muted-foreground">Ghi chú cho NCC / nội bộ
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={`mt-1 w-full ${inputCls}`} placeholder="Điều kiện giao, liên hệ nhận hàng…" /></label>
              <dl className="space-y-1 rounded-2xl border border-border bg-card p-4 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Tiền hàng</dt><dd className="tabular-nums">{money(totals.subtotal)} đ</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">VAT {vat}%</dt><dd className="tabular-nums">{money(totals.vatAmount)} đ</dd></div>
                <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>Tổng cộng</dt><dd className="tabular-nums">{money(totals.subtotal + totals.vatAmount)} đ</dd></div>
                {isGroup && perProject.map(([code, amount]) => <div key={code} className="flex justify-between text-xs text-muted-foreground"><dt>{code} (trước VAT)</dt><dd className="tabular-nums">{money(amount)} đ</dd></div>)}
                {totals.unpriced > 0 && <p className="pt-1 text-xs text-amber-700 dark:text-amber-300">{totals.unpriced} vật tư chưa có đơn giá — lưu nháp được, cần đủ giá mới gửi duyệt.</p>}
                {totals.over > 0 && <p className="pt-1 text-xs text-amber-700 dark:text-amber-300">{totals.over} dòng đặt vượt phần còn thiếu{totals.overNoReason > 0 ? ` — ${totals.overNoReason} dòng chưa ghi lý do: lưu nháp được, ghi lý do mới gửi duyệt` : ''}.</p>}
                {expected && <p className="pt-1 text-xs text-muted-foreground">Cần giao trước {dateVi(expected)}</p>}
              </dl>
            </section>
            <p className="text-xs text-muted-foreground">Sau khi lưu, đơn ở trạng thái Nháp. Mở đơn để gửi người có quyền Mua hàng — Quản trị duyệt.</p>
          </>}
  </Drawer>;
};

export default OrderEditor;
