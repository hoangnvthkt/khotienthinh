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
interface Item { itemId: string; name: string; sku: string | null; unit: string | null; purchaseUnit: string | null; factor: number; price: string; rows: Row[] }

/** Need quantities are in the stock unit; orders and prices use the purchase unit (stock = purchase × factor). */
const toPurchase = (item: Pick<Item, 'purchaseUnit' | 'factor'>, stockQty: number) => item.purchaseUnit ? stockQty / item.factor : stockQty;

const VAT_CHOICES = [0, 8, 10];

const buildItems = (docs: ProcurementInboxDetail[], order: ProcurementOrderDetail | null): Item[] => {
  const mine = new Map<string, { qty: number; price: number }>();
  order?.lines.forEach(line => line.allocations.forEach(a => mine.set(`${a.sourceType}:${a.sourceId}:${a.lineId}`, { qty: a.qty, price: line.unitPrice })));
  const byItem = new Map<string, Item>();
  docs.forEach(doc => doc.lines.forEach(line => {
    if (!line.itemId) return;
    const key = `${doc.sourceType}:${doc.sourceId}:${line.lineId}`;
    const own = mine.get(key);
    const orderedElsewhere = Math.max(0, line.orderedQty - (own?.qty || 0));
    const available = Math.max(0, line.needQty - orderedElsewhere);
    if (!own && available <= 0) return;
    const item = byItem.get(line.itemId) || { itemId: line.itemId, name: line.itemName, sku: line.sku, unit: line.unit,
      purchaseUnit: line.purchaseUnit, factor: line.purchaseFactor && line.purchaseFactor > 0 ? line.purchaseFactor : 1, price: '', rows: [] };
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
      const qty = toPurchase(item, stockQty);
      if (qty > 0) { lines += 1; if (price != null && (Number.isNaN(price) || price < 0)) invalid += 1; else if (!price) unpriced += 1; else subtotal += qty * price; }
    });
    const vatRate = parseQty(vat) ?? 0;
    return { subtotal, vatAmount: subtotal * (Number.isNaN(vatRate) ? 0 : vatRate) / 100, invalid, over, lines, unpriced };
  }, [items, vat]);

  const setRowQty = (itemId: string, key: string, qty: string) =>
    setItems(cur => cur.map(i => i.itemId !== itemId ? i : { ...i, rows: i.rows.map(r => r.key === key ? { ...r, qty } : r) }));
  const setPrice = (itemId: string, price: string) => setItems(cur => cur.map(i => i.itemId === itemId ? { ...i, price } : i));

  const save = async () => {
    setError(null);
    if (!vendor) { setError('Chọn nhà cung cấp.'); return; }
    if (totals.invalid) { setError('Còn số lượng hoặc đơn giá chưa hợp lệ (ô tô đỏ).'); return; }
    if (!totals.lines) { setError('Nhập SL đặt cho ít nhất một vật tư.'); return; }
    const vatRate = parseQty(vat);
    if (vatRate == null || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) { setError('Thuế VAT phải từ 0 đến 100%.'); return; }
    const payload = items.map(item => ({
      itemId: item.itemId, unitPrice: parseQty(item.price) || 0,
      allocations: item.rows.map(r => ({ sourceType: r.sourceType, sourceId: r.sourceId, lineId: r.lineId, qty: parseQty(r.qty) || 0 })).filter(a => a.qty > 0),
    })).filter(item => item.allocations.length > 0);
    setSaving(true);
    try {
      const result = await procurementInboxService.saveOrder({
        purchaseOrderId: order?.id, expectedRowVersion: order?.rowVersion, vendorId: vendor.id,
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

            {items.length === 0
              ? <StateBox kind="empty" title="Các phiếu đã đặt đủ" message="Không còn dòng nhu cầu nào cần đặt thêm." />
              : <section className="space-y-3">
                <div className="flex items-baseline justify-between"><h3 className="font-semibold text-foreground">Vật tư đặt mua</h3>
                  <span className="text-xs text-muted-foreground">{items.length} vật tư · SL gợi ý = phần còn thiếu của phiếu</span></div>
                {items.map((item, i) => {
                  const price = parseQty(item.price);
                  const stockQty = item.rows.reduce((s, r) => s + Math.max(0, parseQty(r.qty) || 0), 0);
                  const qty = toPurchase(item, stockQty);
                  const priceBad = qty > 0 && price != null && (Number.isNaN(price) || price < 0);
                  return <div key={item.itemId} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 border-l-teal-500 bg-teal-50/60 px-3 py-2.5 dark:bg-teal-950/20">
                      <span className="w-5 text-sm font-bold tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] md:basis-auto"><span className="font-semibold text-foreground">{item.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{[item.sku, item.unit].filter(Boolean).join(' · ')}</span></span>
                      {item.purchaseUnit && <span className="text-xs text-muted-foreground" title={`Mua theo ${item.purchaseUnit}, tồn kho theo ${item.unit}`}>
                        Đặt {fmt(qty, 3)} {item.purchaseUnit}</span>}
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Đơn giá{item.purchaseUnit ? ` / ${item.purchaseUnit}` : item.unit ? ` / ${item.unit}` : ''}
                        <input inputMode="decimal" value={item.price} onChange={e => setPrice(item.itemId, e.target.value)} placeholder="0"
                          aria-label={`Đơn giá ${item.name}`} aria-invalid={priceBad}
                          className={`w-28 text-right tabular-nums ${inputCls} ${priceBad ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} /></label>
                      <span className="ml-auto w-32 text-right text-sm font-semibold tabular-nums text-foreground">{price && price > 0 ? `${money(qty * price)} đ` : 'Chưa có giá'}</span>
                    </div>
                    <ul className="divide-y divide-border">{item.rows.map(row => {
                      const q = parseQty(row.qty);
                      const bad = q != null && Number.isNaN(q);
                      const over = q != null && !bad && q > row.available * 1.0001 + 0.001;
                      return <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 pl-11 text-sm">
                        <span className="min-w-[8rem] font-medium text-foreground">{row.code}</span>
                        <span className="text-xs text-muted-foreground">Cần {fmt(row.needQty)}{row.orderedElsewhere > 0 ? ` · đã đặt đơn khác ${fmt(row.orderedElsewhere)}` : ''} · còn {fmt(row.available)}</span>
                        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">SL đặt
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
