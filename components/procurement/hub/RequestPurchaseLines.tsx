import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, PackageCheck, ShoppingCart } from 'lucide-react';
import { procurementInboxService, type ProcurementCatalogItem, type ProcurementInboxDetail } from '../../../lib/procurementInboxService';
import { requestPurchaseService, type RequestPurchaseLine } from '../../../lib/requestPurchaseService';
import { dateVi, fmt } from '../../project/work-plan/workPlanUi';
import { inputCls, money, primaryBtn, secondaryBtn } from './hubUi';
import { VendorPicker, VatPicker, type VendorValue } from './OrderFormParts';

const RequestLineOrder: React.FC<{ detail: ProcurementInboxDetail; line: RequestPurchaseLine; onCancel: () => void; onSaved: (id: string) => void }> = ({ detail, line, onCancel, onSaved }) => {
 const [key] = useState(() => crypto.randomUUID()); const [qty, setQty] = useState(String(Math.max(0, line.qty - line.orderedQty)));
 const [query, setQuery] = useState(line.name); const [results, setResults] = useState<ProcurementCatalogItem[] | null>(null);
 const [item, setItem] = useState<ProcurementCatalogItem | null>(null); const [vendor, setVendor] = useState<VendorValue>(null);
 const [price, setPrice] = useState(''); const [vat, setVat] = useState('10'); const [note, setNote] = useState(''); const [error, setError] = useState(''); const [searchError, setSearchError] = useState(''); const [saving, setSaving] = useState(false);
 useEffect(() => { let active = true; setResults(null); setSearchError(''); const timer = setTimeout(() => {
  procurementInboxService.searchItems(null, query).then(r => { if (active) setResults(r); }).catch(e => { if (active) setSearchError(e.message); });
 }, 250); return () => { active = false; clearTimeout(timer); }; }, [query]);
 const save = async () => {
  setError(''); const q = Number(qty), p = Number(price), v = Number(vat);
  if (!item || !vendor) { setError('Chọn hàng trong danh mục và nhà cung cấp.'); return; }
  if (!Number.isFinite(q) || q <= 0 || q > line.qty - line.orderedQty || (line.kind === 'asset' && !Number.isInteger(q))) { setError('Số lượng đặt phải hợp lệ và không vượt phần còn thiếu.'); return; }
  if (!price.trim() || !Number.isFinite(p) || p <= 0 || !Number.isFinite(v) || v < 0 || v > 100) { setError('Nhập đơn giá lớn hơn 0 và VAT từ 0 đến 100%.'); return; }
  setSaving(true); try { const r = await requestPurchaseService.order({ requestId: detail.sourceId, revision: detail.sourceRevision!, lineId: line.id, itemId: item.id, qty: q, vendorId: vendor.id, unitPrice: p, vatRate: v, key, note }); onSaved(r.purchaseOrderId); } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được đơn.'); } finally { setSaving(false); }
 };
 return <div className="mt-3 space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20">
  <p className="text-sm font-semibold text-foreground">Lập đơn cho {line.name}</p><p className="text-xs text-muted-foreground">Nhận tại {line.warehouseName} · cần {dateVi(line.neededDate)}. Đơn sẽ lưu nháp để gửi duyệt, có thể nhận nhiều đợt.</p>
  <label className="block text-xs font-semibold text-muted-foreground">Hàng trong danh mục<input aria-label="Tìm hàng trong danh mục" value={query} onChange={e => { setQuery(e.target.value); setItem(null); }} className={`mt-1 w-full ${inputCls}`} /></label>
  {item ? <p className="text-sm font-medium text-teal-800 dark:text-teal-200">Đã chọn: {item.name} · {item.unit}</p> : searchError ? <p role="alert" className="text-sm text-rose-700">{searchError}</p> : results === null ? <p role="status" className="text-xs text-muted-foreground">Đang tìm hàng…</p> : <ul className="max-h-44 overflow-y-auto rounded-lg border border-border bg-card">{results.length ? results.map(r => <li key={r.id}><button type="button" onClick={() => setItem(r)} disabled={r.unit?.trim().toLowerCase() !== line.unit.trim().toLowerCase()} className="w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40">{r.name} · {r.sku} · {r.unit}{r.unit?.trim().toLowerCase() !== line.unit.trim().toLowerCase() && ' (khác đơn vị phiếu)'}</button></li>) : <li className="p-3 text-xs text-muted-foreground">Chưa có hàng phù hợp. Thêm vào Danh mục hàng hóa rồi tìm lại.</li>}</ul>}
  <VendorPicker value={vendor} onChange={setVendor} autoFocus={false} />
  <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-muted-foreground">Số lượng ({line.unit})<input aria-label="Số lượng đặt" type="number" min="0.001" step={line.kind === 'asset' ? '1' : 'any'} value={qty} onChange={e => setQty(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label><label className="text-xs font-semibold text-muted-foreground">Đơn giá / {line.unit}<input aria-label="Đơn giá" type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label></div>
  <VatPicker value={vat} onChange={setVat} /><label className="block text-xs font-semibold text-muted-foreground">Ghi chú cho người duyệt<textarea value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
  <p className="text-sm text-foreground">Tạm tính gồm VAT: <b>{price && Number.isFinite(Number(price) * Number(qty)) ? money(Number(price) * Number(qty) * (1 + Number(vat) / 100)) : 'Chưa có đơn giá'}</b></p>
  {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
  <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onCancel} disabled={saving} className={secondaryBtn}>Đóng</button><button type="button" onClick={() => void save()} disabled={saving} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}Lưu đơn nháp</button></div>
 </div>;
};
export const RequestPurchaseLines: React.FC<{ detail: ProcurementInboxDetail; canManage: boolean; onChanged: () => void; onOpenOrder: (id: string) => void }> = ({ detail, canManage, onChanged, onOpenOrder }) => {
 const [editing, setEditing] = useState<string | null>(null); const active = detail.intakeState !== 'withdrawn' && !detail.closure;
 return <section className="space-y-3"><div><h3 className="font-semibold text-foreground">Nhu cầu đã duyệt</h3><p className="mt-1 text-xs text-muted-foreground">Theo dõi từ số lượng được duyệt đến thực nhận. Mỗi đơn giữ liên kết về dòng nguồn.</p></div>
 {(detail.purchaseLines || []).map(l => <article key={l.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
  <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold text-foreground">{l.name}</h4><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{l.specification || 'Không có quy cách bổ sung'}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">{l.kind === 'asset' ? 'Tài sản' : 'Vật tư'}</span></div>
  <dl className="my-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Kho nhận</dt><dd>{l.warehouseName}</dd></div><div><dt className="text-xs text-muted-foreground">Ngày cần</dt><dd>{dateVi(l.neededDate)}</dd></div>{l.kind === 'asset' && <><div><dt className="text-xs text-muted-foreground">Nhóm tài sản</dt><dd>{l.categoryName}</dd></div><div><dt className="text-xs text-muted-foreground">Dự kiến cấp cho</dt><dd>{l.recipientName || 'Chọn khi bàn giao'}</dd></div></>}</dl>
  <div className="grid grid-cols-3 rounded-lg bg-muted/50 p-3 text-center text-xs text-muted-foreground">{[['Được duyệt', l.qty], ['Đã đặt', l.orderedQty], ['Thực nhận', l.receivedQty]].map(([label, q]) => <div key={String(label)}>{label}<strong className="mt-1 block text-base text-foreground">{fmt(Number(q))} <span className="text-xs font-normal">{l.unit}</span></strong></div>)}</div>
  {l.orders.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{l.orders.map(o => <button type="button" key={o.id} onClick={() => onOpenOrder(o.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300">{o.code}<ArrowUpRight size={13} /></button>)}</div>}
  {l.assets.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-teal-700 dark:text-teal-300"><PackageCheck size={15} className="mr-1 inline" />{l.assets.length} tài sản đã nhập</summary><ul className="mt-2 space-y-1 text-xs">{l.assets.map(a => <li key={a.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"><a href={`#/ts/assignment?q=${encodeURIComponent(a.code)}`} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">{a.code}</a><span>{a.holder ? `Đã cấp: ${a.holder}` : 'Chờ cấp phát'}</span></li>)}</ul><a href="#/ts/assignment" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700">Mở cấp phát tài sản <ArrowUpRight size={14} /></a></details>}
  {editing === l.id ? <RequestLineOrder key={l.id} detail={detail} line={l} onCancel={() => setEditing(null)} onSaved={id => { setEditing(null); onChanged(); onOpenOrder(id); }} /> : canManage && active && l.orderedQty < l.qty && <button type="button" onClick={() => setEditing(l.id)} className={`${primaryBtn} mt-3`}><ShoppingCart size={15} />Mua {fmt(l.qty - l.orderedQty)} {l.unit} còn thiếu</button>}
 </article>)}
 </section>;
};
