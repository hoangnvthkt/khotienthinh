import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import {
  procurementInboxService,
  type ProcurementInboxDetail, type ProcurementOrderDetail, type ProcurementSourceRef, type ProcurementVendor,
} from '../../../lib/procurementInboxService';
import { dateVi, fmt, parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

// Lập / sửa đơn hàng từ một hoặc nhiều phiếu nhu cầu cùng dự án. Mỗi vật tư là một
// dòng đơn hàng; SL đặt phân về từng dòng nhu cầu để theo dõi còn thiếu.

interface Row { key: string; sourceType: ProcurementSourceRef['sourceType']; sourceId: string; code: string; lineId: string; needQty: number; orderedElsewhere: number; available: number; qty: string }
interface Item {
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

const VAT_CHOICES = [0, 8, 10];

const buildItems = (docs: ProcurementInboxDetail[], order: ProcurementOrderDetail | null): Item[] => {
  const mine = new Map<string, { qty: number; price: number }>();
  order?.lines.forEach(line => line.allocations.forEach(a => mine.set(`${a.sourceType}:${a.sourceId}:${a.lineId}`, { qty: a.qty, price: line.unitPrice })));
  const ownLine = new Map((order?.lines || []).map(line => [line.itemId, line]));
  const byItem = new Map<string, Item>();
  docs.forEach(doc => doc.lines.forEach(line => {
    if (!line.itemId) return;
    const key = `${doc.sourceType}:${doc.sourceId}:${line.lineId}`;
    const own = mine.get(key);
    const orderedElsewhere = Math.max(0, line.orderedQty - (own?.qty || 0));
    const available = Math.max(0, line.needQty - orderedElsewhere);
    if (!own && available <= 0) return;
    const prev = ownLine.get(line.itemId);
    const prevAlt = Boolean(prev && prev.stockUnit && prev.unit && prev.unit !== prev.stockUnit);
    const item = byItem.get(line.itemId) || { itemId: line.itemId, name: line.itemName, sku: line.sku, unit: line.unit,
      altUnit: prevAlt || Boolean(line.purchaseUnit),
      purchaseUnit: (prevAlt ? prev?.unit : line.purchaseUnit) || '',
      factor: prevAlt && prev ? prev.factor : line.purchaseFactor && line.purchaseFactor > 0 ? line.purchaseFactor : 1,
      purchaseQty: prevAlt && prev ? qtyInput(prev.qty) : '', price: '', rows: [] };
    if (own && !item.price) item.price = qtyInput(own.price);
    item.rows.push({ key, sourceType: doc.sourceType, sourceId: doc.sourceId, code: doc.code, lineId: line.lineId,
      needQty: line.needQty, orderedElsewhere, available, qty: qtyInput(own ? own.qty : available) });
    byItem.set(line.itemId, item);
  }));
  return Array.from(byItem.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
};

export const OrderEditor: React.FC<{
  sources: ProcurementSourceRef[];
  order?: ProcurementOrderDetail | null;
  onClose: () => void;
  onSaved: (purchaseOrderId: string, poNumber: string) => void;
}> = ({ sources, order = null, onClose, onSaved }) => {
  const [docs, setDocs] = useState<ProcurementInboxDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(order?.vendorId ? { id: order.vendorId, name: order.vendorName || '' } : null);
  const [vendorQuery, setVendorQuery] = useState('');
  const [vendors, setVendors] = useState<ProcurementVendor[] | null>(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [expected, setExpected] = useState(order?.expectedDeliveryDate || '');
  const [vat, setVat] = useState(String(order?.vatRate ?? 10));
  const [note, setNote] = useState(order?.note || '');
  const [mode, setMode] = useState<'single' | 'multiple'>(order?.purchaseMode || 'single');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceKey = sources.map(s => `${s.sourceType}:${s.sourceId}`).join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(sources.map(s => procurementInboxService.get(s.sourceType, s.sourceId)))
      .then(result => {
        if (!alive) return;
        setDocs(result); setItems(buildItems(result, order));
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

  useEffect(() => {
    if (!vendorOpen) return;
    setVendors(null);
    const t = setTimeout(() => { procurementInboxService.vendors(vendorQuery).then(setVendors).catch(() => setVendors([])); }, 250);
    return () => clearTimeout(t);
  }, [vendorQuery, vendorOpen]);

  const project = docs?.[0];
  const mixedScope = Boolean(docs && new Set(docs.map(d => `${d.projectId}|${d.constructionSiteId}`)).size > 1);
  const warehouses = Array.from(new Set((docs || []).map(d => d.warehouseName).filter(Boolean)));

  const totals = useMemo(() => {
    let subtotal = 0; let invalid = 0; let over = 0; let lines = 0; let unpriced = 0;
    items.forEach(item => {
      const price = parseQty(item.price);
      const stockQty = item.rows.reduce((sum, row) => {
        const q = parseQty(row.qty);
        if (q != null && Number.isNaN(q)) invalid += 1;
        if (q != null && q > row.available * 1.0001 + 0.001) over += 1;
        return sum + (q && q > 0 ? q : 0);
      }, 0);
      const qty = purchaseQtyOf(item, stockQty);
      if (item.altUnit && (qty == null || Number.isNaN(qty) || (stockQty > 0 && qty <= 0))) invalid += 1;
      if (stockQty > 0 && qty > 0) { lines += 1; if (price != null && (Number.isNaN(price) || price < 0)) invalid += 1; else if (!price) unpriced += 1; else subtotal += qty * price; }
    });
    const vatRate = parseQty(vat) ?? 0;
    return { subtotal, vatAmount: subtotal * (Number.isNaN(vatRate) ? 0 : vatRate) / 100, invalid, over, lines, unpriced };
  }, [items, vat]);

  const setRowQty = (itemId: string, key: string, qty: string) =>
    setItems(cur => cur.map(i => i.itemId !== itemId ? i : { ...i, rows: i.rows.map(r => r.key === key ? { ...r, qty } : r) }));
  const setPrice = (itemId: string, price: string) => setItems(cur => cur.map(i => i.itemId === itemId ? { ...i, price } : i));
  const patchItem = (itemId: string, patch: Partial<Item>) => setItems(cur => cur.map(i => i.itemId === itemId ? { ...i, ...patch } : i));

  const save = async () => {
    setError(null);
    if (!vendor) { setError('Chọn nhà cung cấp.'); return; }
    if (totals.invalid) { setError('Còn số lượng hoặc đơn giá chưa hợp lệ (ô tô đỏ).'); return; }
    if (!totals.lines) { setError('Nhập SL đặt cho ít nhất một vật tư.'); return; }
    const vatRate = parseQty(vat);
    if (vatRate == null || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) { setError('Thuế VAT phải từ 0 đến 100%.'); return; }
    const payload = items.map(item => ({
      itemId: item.itemId, unitPrice: parseQty(item.price) || 0,
      ...(item.altUnit ? {
        purchaseUnit: item.purchaseUnit.trim() || undefined,
        purchaseQty: purchaseQtyOf(item, item.rows.reduce((sum, r) => sum + Math.max(0, parseQty(r.qty) || 0), 0)),
      } : {}),
      allocations: item.rows.map(r => ({ sourceType: r.sourceType, sourceId: r.sourceId, lineId: r.lineId, qty: parseQty(r.qty) || 0 })).filter(a => a.qty > 0),
    })).filter(item => item.allocations.length > 0);
    setSaving(true);
    try {
      const result = await procurementInboxService.saveOrder({
        purchaseOrderId: order?.id, expectedRowVersion: order?.rowVersion, vendorId: vendor.id, purchaseMode: mode,
        expectedDeliveryDate: expected || null, vatRate, note: note.trim(), items: payload,
      });
      onSaved(result.purchaseOrderId, result.poNumber);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return <Drawer wide label={order ? `Sửa ${order.poNumber}` : 'Lập đơn hàng'} onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{order ? `Sửa đơn ${order.poNumber}` : 'Lập đơn hàng'}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{project ? [project.projectCode, project.projectName].filter(Boolean).join(' — ') : 'Đang tải…'}</h2>
      <p className="text-sm text-muted-foreground">{docs ? `Từ ${docs.map(d => d.code).join(', ')}` : ''}{warehouses.length ? ` · Kho nhận: ${warehouses.join(', ')}` : ''}</p>
    </>}
    footer={docs && !mixedScope ? <>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" onClick={() => void save()} disabled={saving} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}{order ? 'Lưu thay đổi' : 'Lưu đơn nháp'}</button>
    </> : undefined}>
    {loadError ? <StateBox kind="error" message={loadError} />
      : !docs ? <StateBox kind="loading" title="Đang tải phiếu nhu cầu…" />
        : mixedScope ? <StateBox kind="error" title="Các phiếu thuộc nhiều dự án/công trường" message="Một đơn hàng chỉ gồm phiếu của cùng một dự án và công trường. Chọn lại phiếu." />
          : <>
            <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="relative">
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="po-vendor">Nhà cung cấp</label>
                {vendor && !vendorOpen
                  ? <button id="po-vendor" type="button" onClick={() => { setVendorOpen(true); setVendorQuery(''); }} className={`mt-1 flex w-full items-center justify-between text-left ${inputCls}`}>
                    <span className="truncate font-semibold">{vendor.name}</span><span className="text-xs text-teal-700 dark:text-teal-300">Đổi</span></button>
                  : <div className="relative mt-1">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input id="po-vendor" autoFocus value={vendorQuery} onFocus={() => setVendorOpen(true)} onBlur={() => setTimeout(() => setVendorOpen(false), 150)} onChange={e => { setVendorQuery(e.target.value); setVendorOpen(true); }}
                      placeholder="Tìm tên hoặc mã số thuế NCC…" className={`w-full pl-8 ${inputCls}`} />
                  </div>}
                {vendorOpen && <ul role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                  {vendors == null && <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Đang tìm NCC…</li>}
                  {vendors?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy NCC. Khai NCC mới ở Hợp đồng — Đối tác.</li>}
                  {vendors?.map(v => <li key={v.id}><button type="button" role="option" aria-selected={vendor?.id === v.id}
                    onClick={() => { setVendor({ id: v.id, name: v.name }); setVendorOpen(false); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="truncate">{v.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{v.recentOrders ? `${v.recentOrders} đơn` : v.taxCode && v.taxCode !== '0' ? v.taxCode : ''}</span></button></li>)}
                </ul>}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="po-expected">Ngày cần giao</label>
                <input id="po-expected" type="date" value={expected} onChange={e => setExpected(e.target.value)} className={`mt-1 w-full ${inputCls}`} />
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground">Thuế VAT</span>
                <div className="mt-1 flex items-center gap-1">
                  {VAT_CHOICES.map(v => <button key={v} type="button" aria-pressed={vat === String(v)} onClick={() => setVat(String(v))}
                    className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${vat === String(v) ? 'border-teal-600 bg-teal-700 text-white' : 'border-border hover:bg-muted'}`}>{v}%</button>)}
                  <input aria-label="VAT khác (%)" inputMode="decimal" value={VAT_CHOICES.map(String).includes(vat) ? '' : vat} onChange={e => setVat(e.target.value)} placeholder="Khác" className={`w-16 ${inputCls}`} />
                </div>
              </div>
            </section>

            <section role="radiogroup" aria-label="Hình thức giao" className="grid gap-2 md:grid-cols-2">
              {([['single', 'Giao 1 lần', 'Đặt đơn nào về đơn ấy. Duyệt xong có ngay phiếu nhập kho cho thủ kho.'],
                ['multiple', 'Giao nhiều đợt', 'Hàng về nhiều lần (VD thép tấm). Mua hàng lập từng đợt với SL, giá và VAT riêng.']] as const).map(([key, label, hint]) =>
                <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key)}
                  className={`rounded-2xl border p-3 text-left transition ${mode === key ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20 dark:bg-teal-950/20' : 'border-border bg-card hover:border-teal-300'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className={`h-3.5 w-3.5 rounded-full border-2 ${mode === key ? 'border-teal-600 bg-teal-600' : 'border-muted-foreground'}`} />{label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
                </button>)}
            </section>

            {items.length === 0
              ? <StateBox kind="empty" title="Các phiếu đã đặt đủ" message="Không còn dòng nhu cầu nào cần đặt thêm." />
              : <section className="space-y-3">
                <div className="flex items-baseline justify-between"><h3 className="font-semibold text-foreground">Vật tư đặt mua</h3>
                  <span className="text-xs text-muted-foreground">{items.length} vật tư · SL gợi ý = phần còn thiếu của phiếu</span></div>
                {items.map((item, i) => {
                  const price = parseQty(item.price);
                  const stockQty = item.rows.reduce((s, r) => s + Math.max(0, parseQty(r.qty) || 0), 0);
                  const qty = purchaseQtyOf(item, stockQty);
                  const typed = item.altUnit && item.purchaseQty.trim() !== '';
                  const unitLabel = item.altUnit ? item.purchaseUnit || '?' : item.unit || '';
                  const priceBad = qty > 0 && price != null && (Number.isNaN(price) || price < 0);
                  return <div key={item.itemId} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 border-l-teal-500 bg-teal-50/60 px-3 py-2.5 dark:bg-teal-950/20">
                      <span className="w-5 text-sm font-bold tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] md:basis-auto"><span className="font-semibold text-foreground">{item.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{[item.sku, item.unit].filter(Boolean).join(' · ')}</span></span>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Đơn giá{unitLabel ? ` / ${unitLabel}` : ''}
                        <input inputMode="decimal" value={item.price} onChange={e => setPrice(item.itemId, e.target.value)} placeholder="0"
                          aria-label={`Đơn giá ${item.name}`} aria-invalid={priceBad}
                          className={`w-28 text-right tabular-nums ${inputCls} ${priceBad ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} /></label>
                      <span className="ml-auto w-32 text-right text-sm font-semibold tabular-nums text-foreground">{price && price > 0 && qty > 0 ? `${money(qty * price)} đ` : 'Chưa có giá'}</span>
                    </div>
                    {item.altUnit
                      ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-amber-50/50 px-3 py-2 pl-11 text-xs text-muted-foreground dark:bg-amber-950/10">
                        <label className="flex items-center gap-1.5">SL mua
                          <input inputMode="decimal" value={typed ? item.purchaseQty : qtyInput(autoPurchase(item, stockQty))}
                            onChange={e => patchItem(item.itemId, { purchaseQty: e.target.value })} aria-label={`SL mua ${item.name}`}
                            className={`w-24 text-right tabular-nums ${inputCls} ${typed ? 'border-amber-400' : ''}`} />
                          <input value={item.purchaseUnit} onChange={e => patchItem(item.itemId, { purchaseUnit: e.target.value })} aria-label={`Đơn vị mua ${item.name}`}
                            placeholder="ĐV mua" className={`w-16 ${inputCls}`} /></label>
                        <span aria-hidden>⇄</span>
                        <span>SL kho <b className="text-foreground tabular-nums">{fmt(stockQty, 3)} {item.unit}</b></span>
                        {qty > 0 && stockQty > 0 && <span>· 1 {item.purchaseUnit || 'ĐV mua'} = {fmt(stockQty / qty, 4)} {item.unit}</span>}
                        {typed ? <button type="button" onClick={() => patchItem(item.itemId, { purchaseQty: '' })} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Tự quy đổi</button>
                          : <span className="italic">tự quy đổi theo hệ số vật tư — sửa được</span>}
                        {!item.purchaseUnit && <button type="button" onClick={() => patchItem(item.itemId, { altUnit: false, purchaseQty: '' })} className="ml-auto text-muted-foreground hover:underline">Bỏ</button>}
                      </div>
                      : <div className="px-3 pt-1.5 pl-11"><button type="button" onClick={() => patchItem(item.itemId, { altUnit: true, factor: 1 })}
                        className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">+ Mua theo đơn vị khác (VD kg ↔ cây)</button></div>}
                    <ul className="divide-y divide-border">{item.rows.map(row => {
                      const q = parseQty(row.qty);
                      const bad = q != null && Number.isNaN(q);
                      const over = q != null && !bad && q > row.available * 1.0001 + 0.001;
                      return <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 pl-11 text-sm">
                        <span className="min-w-[8rem] font-medium text-foreground">{row.code}</span>
                        <span className="text-xs text-muted-foreground">Cần {fmt(row.needQty)}{row.orderedElsewhere > 0 ? ` · đã đặt đơn khác ${fmt(row.orderedElsewhere)}` : ''} · còn {fmt(row.available)}</span>
                        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">{item.altUnit ? 'SL kho' : 'SL đặt'}
                          <input inputMode="decimal" value={row.qty} onChange={e => setRowQty(item.itemId, row.key, e.target.value)}
                            aria-label={`SL đặt ${item.name} cho ${row.code}`} aria-invalid={bad}
                            className={`w-24 text-right tabular-nums ${inputCls} ${bad ? 'border-rose-400 ring-2 ring-rose-400/30' : over ? 'border-amber-400' : ''}`} />
                          <span className="w-10">{item.unit}</span></label>
                        {over && <span className="w-full text-right text-xs text-amber-700 dark:text-amber-300">Vượt phần còn thiếu {fmt((q || 0) - row.available)} {item.unit}</span>}
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
                {totals.unpriced > 0 && <p className="pt-1 text-xs text-amber-700 dark:text-amber-300">{totals.unpriced} vật tư chưa có đơn giá — lưu nháp được, cần đủ giá mới gửi duyệt.</p>}
                {totals.over > 0 && <p className="pt-1 text-xs text-amber-700 dark:text-amber-300">{totals.over} dòng đặt vượt phần còn thiếu — vẫn lưu được.</p>}
                {expected && <p className="pt-1 text-xs text-muted-foreground">Cần giao trước {dateVi(expected)}</p>}
              </dl>
            </section>
            <p className="text-xs text-muted-foreground">Sau khi lưu, đơn ở trạng thái Nháp. Mở đơn để gửi người có quyền Mua hàng — Quản trị duyệt.</p>
          </>}
  </Drawer>;
};

export default OrderEditor;
