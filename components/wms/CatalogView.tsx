import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, Boxes, Plus, ChevronDown, ChevronRight, CircleSlash, CopyCheck, Hash, History, ListChecks, PencilLine, RefreshCw, RotateCcw, Search, Tags } from 'lucide-react';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney } from '../finance/financeUi';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useModuleData } from '../../hooks/useModuleData';
import { materialCodeRequestService } from '../../lib/materialCodeRequestService';
import {
  INVENTORY_MODE_HINTS, INVENTORY_MODE_LABELS, catalogErrorMessage, catalogSkuProblem, changedFields, catalogNameKey, foldVi, guessInventoryMode, similarCatalogItems, wmsCatalogService,
  type CatalogItemDetail, type CatalogOverview, type CatalogRename, type InventoryMode,
} from '../../lib/wmsCatalogService';
import type { InventoryItem, MaterialCodeRequest } from '../../types';
import { BAD, EmptyPanel, GREY, OK, Panel, Section, Split, Stat, TEAL, Tile, WARN, dateVi, fmtQty } from './wmsUi';
import { CatalogMergePanel, VERDICT_CLS } from './CatalogMergePanel';
import { QuickCreateItemDialog } from './QuickCreateItemDialog';
import { VERDICT_LABEL, sortGroups, suggestKeep, type DuplicatesData } from '../../lib/wmsCatalogMerge';
import { SPEC_SOURCE_LABELS, itemSpecService, specSizeConflict, type PendingItemSpec } from '../../lib/itemSpecService';
import { ItemSpecsSection } from './ItemSpecsSection';

// Danh mục vật tư (V1): một cửa cấp mã. Không có nút Xóa — chỉ Ngừng dùng. Mã đã có chứng từ chỉ sửa chính tả tên (server chặn đổi bản chất).

type Queue = 'all' | 'requests' | 'specs' | 'dupes' | 'mode' | 'renames' | 'retired';
const MODES: InventoryMode[] = ['stock', 'use', 'service'];
const ACTION_LABEL: Record<string, string> = {
  issue: 'cấp mã', update: 'sửa thông tin', rename: 'đổi tên', retire: 'ngừng dùng', reactivate: 'mở lại', mode: 'đổi cách quản lý kho',
  use_existing: 'trả lời đề xuất: dùng mã này', insert: 'tạo mã', update_legacy: 'sửa', merge: 'gộp vào mã khác', merge_into: 'nhận mã gộp vào', spec: 'quy cách',
};
const SPEC_OP: Record<string, string> = { add: 'thêm', approve: 'giữ', rename: 'sửa chữ', merge: 'gộp', retire: 'ngừng dùng', reactivate: 'dùng lại' };
const usedOf = (u?: { ledger: number; transactions: number; purchaseOrders: number; requests: number; stockQty: number }) =>
  !!u && (Number(u.stockQty) > 0 || u.ledger > 0 || u.transactions > 0 || u.purchaseOrders > 0 || u.requests > 0);

const useCatalogLists = () => {
  const { items, categories, units } = useApp();
  const categoryOptions = useMemo(() => [...new Set([...categories.map(c => c.name), ...items.map(i => i.category)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [categories, items]);
  const unitOptions = useMemo(() => [...new Set([...units.map(u => u.name), ...items.map(i => i.unit)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [units, items]);
  return { categoryOptions, unitOptions };
};

// ---------- Chi tiết một mã ----------
const ItemDetail: React.FC<{ itemId: string; canIssue: boolean; canEdit: boolean; onChanged: (ids: string[]) => void; onBack: () => void; onOpen: (id: string) => void }> = ({ itemId, canIssue, canEdit, onChanged, onBack, onOpen }) => {
  const toast = useToast(); const confirm = useConfirm(); const reasonConfirm = useReasonConfirm();
  const { categoryOptions, unitOptions } = useCatalogLists();
  const [d, setD] = useState<CatalogItemDetail | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', unit: '', category: '', purchaseUnit: '', factor: '1', minStock: '0', reason: '' });
  const load = useCallback(async () => {
    setErr('');
    try { const x = await wmsCatalogService.item(itemId); setD(x); setForm({ name: x.item.name, unit: x.item.unit, category: x.item.category, purchaseUnit: x.item.purchaseUnit || '',
      factor: String(x.item.purchaseConversionFactor ?? 1), minStock: String(x.item.minStock ?? 0), reason: '' }); }
    catch (e) { setErr(catalogErrorMessage(e, 'Chưa tải được mã vật tư.')); }
  }, [itemId]);
  useEffect(() => { setD(null); setEdit(false); void load(); }, [load]);
  if (err) return <Panel onBack={onBack} head={<h2 className="text-lg font-bold">Mã vật tư</h2>}><StateBox kind="error" message={err} onRetry={() => void load()} /></Panel>;
  if (!d) return <Panel onBack={onBack} head={<h2 className="text-lg font-bold">Mã vật tư</h2>}><p className="text-sm text-muted-foreground">Đang tải…</p></Panel>;
  const it = d.item; const used = usedOf(d.usage);
  const blockRetire = Number(d.usage.stockQty) > 0 ? `còn tồn ${fmtQty(Number(d.usage.stockQty))} ${it.unit}` : d.usage.openPurchaseOrders > 0 ? 'đang nằm trong đơn mua chưa xong' : '';
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success('Đã lưu', ok); await load(); onChanged([itemId]); return true; }
    catch (e) { toast.error('Chưa lưu được', catalogErrorMessage(e)); return false; }
    finally { setBusy(false); }
  };
  const saveEdit = async () => {
    const renamed = form.name.trim() !== it.name;
    if (!form.reason.trim()) { toast.warning('Cần lý do', 'Mọi lần sửa mã đều ghi lịch sử — ghi lý do sửa.'); return; }
    const ok = await run(() => wmsCatalogService.update({ itemId: it.id, name: form.name.trim(), unit: form.unit, category: form.category,
      purchaseUnit: form.purchaseUnit || null, purchaseConversionFactor: Number(form.factor.replace(',', '.')) || 1, minStock: Number(form.minStock) || 0, reason: form.reason.trim() || undefined }),
      `${it.sku}${renamed ? `: “${it.name}” → “${form.name.trim()}”` : ''}`);
    if (ok) setEdit(false);
  };
  const setMode = async (m: InventoryMode) => {
    if (m === it.inventoryMode) return;
    const yes = await confirm({ title: 'Đổi cách quản lý kho?', targetName: `${it.sku} · ${it.name}`, intent: 'warning', countdownSeconds: 0, confirmText: 'Đổi', actionLabel: 'Đổi',
      warningText: `${INVENTORY_MODE_LABELS[it.inventoryMode]} → ${INVENTORY_MODE_LABELS[m]}. Áp dụng cho lần nhận hàng sau; tồn đang có không tự đổi (xử lý qua kiểm kê).` });
    if (yes) await run(() => wmsCatalogService.setMode({ itemIds: [it.id], mode: m }), `${it.sku} → ${INVENTORY_MODE_LABELS[m]}`);
  };
  const toggleStatus = async () => {
    const retire = it.status === 'active';
    const reason = await reasonConfirm({ title: retire ? 'Ngừng dùng mã này?' : 'Mở lại mã này?', targetName: `${it.sku} · ${it.name}`, intent: retire ? 'warning' : 'success', countdownSeconds: 0,
      warningText: retire ? 'Mã không chọn được khi lập đề xuất, đơn mua, phiếu kho mới. Lịch sử và báo cáo giữ nguyên. Mở lại được.' : 'Mã chọn lại được ở mọi màn.',
      reasonLabel: 'Lý do', actionLabel: retire ? 'Ngừng dùng' : 'Mở lại' });
    if (reason) await run(() => wmsCatalogService.setStatus({ itemId: it.id, action: retire ? 'retire' : 'reactivate', reason }), `${it.sku} ${retire ? 'đã ngừng dùng' : 'đã mở lại'}`);
  };
  const renamedChanged = form.name.trim() !== it.name;
  return <Panel onBack={onBack}
    head={<div><p className="text-xs text-muted-foreground">{it.sku} · tạo {dateVi(it.createdAt)}</p><h2 className={`text-lg ${it.status === 'retired' ? 'text-muted-foreground line-through' : ENT}`}>{it.name}</h2>
      <span className="mt-1 flex flex-wrap gap-1"><Badge className={it.status === 'retired' ? GREY : OK}>{it.mergedIntoId ? 'Đã gộp' : it.status === 'retired' ? 'Ngừng dùng' : 'Đang dùng'}</Badge>
        <Badge className={it.inventoryMode === 'stock' ? GREY : TEAL}>{INVENTORY_MODE_LABELS[it.inventoryMode]}</Badge><Badge className={GREY}>{it.category}</Badge>
        {used && <Badge className={GREY} title="Đã có sổ kho / phiếu kho / đơn mua / đề xuất">đã có chứng từ</Badge>}</span></div>}
    foot={canIssue || canEdit ? <>
      {canEdit && !edit && <button type="button" className={secondaryBtn} onClick={() => setEdit(true)} disabled={busy}><PencilLine size={15} />Sửa</button>}
      {canIssue && (it.status === 'active'
        ? <button type="button" className={secondaryBtn} disabled={busy || !!blockRetire} title={blockRetire ? `Không ngừng dùng được: ${blockRetire}` : undefined} onClick={() => void toggleStatus()}><CircleSlash size={15} />Ngừng dùng</button>
        : !it.mergedIntoId && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void toggleStatus()}><RotateCcw size={15} />Mở lại</button>)}
      <span className="w-full text-xs text-muted-foreground sm:w-auto">{canIssue && blockRetire && it.status === 'active' ? `Ngừng dùng bị khóa: ${blockRetire}. ` : ''}{canEdit ? 'Mọi lần sửa ghi lịch sử. ' : ''}Không có Xóa — mã đã tạo chỉ ngừng dùng.</span>
    </> : <span className="text-xs text-muted-foreground">Sửa mã cần ô quyền nhạy cảm “Sửa mã vật tư”.</span>}>
    {edit && <section className="space-y-3 rounded-xl border border-teal-300 bg-teal-50/40 p-3 dark:bg-teal-950/20">
      <label className="block text-sm font-medium">Tên vật tư<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={`mt-1 w-full ${inputCls}`} /></label>
      {used && renamedChanged && <p className={`rounded-lg border px-3 py-2 text-xs ${WARN}`}><b>Mã đã có chứng từ</b> — chỉ sửa chính tả / ghi rõ thêm, giữ nguyên bản chất. Đổi kích thước hoặc thành vật tư khác sẽ bị chặn: hãy đề xuất mã mới.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">ĐVT kho<select value={form.unit} disabled={used} title={used ? 'Mã đã có chứng từ — không đổi ĐVT' : undefined} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}>{unitOptions.map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium">Nhóm<select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={`mt-1 w-full ${inputCls}`}>{categoryOptions.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm font-medium">ĐV mua<select value={form.purchaseUnit} onChange={e => setForm(f => ({ ...f, purchaseUnit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}><option value="">(như ĐVT kho)</option>{unitOptions.map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium">1 ĐV mua = ? ĐVT kho<input inputMode="decimal" disabled={!form.purchaseUnit} value={form.factor} onChange={e => setForm(f => ({ ...f, factor: e.target.value }))} className={`mt-1 w-full text-right ${inputCls}`} /></label>
        <label className="text-sm font-medium">Tồn tối thiểu<input inputMode="numeric" value={form.minStock} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} className={`mt-1 w-full text-right ${inputCls}`} /></label>
        <label className="text-sm font-medium">Lý do sửa <span className="text-rose-700">*</span><input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="VD: sửa chính tả, NCC đổi quy cách đóng gói" className={`mt-1 w-full ${inputCls}`} /></label>
      </div>
      <div className="flex justify-end gap-2"><button type="button" className={secondaryBtn} onClick={() => { setEdit(false); void load(); }} disabled={busy}>Hủy</button>
        <button type="button" className={primaryBtn} onClick={() => void saveEdit()} disabled={busy || !form.name.trim() || !form.reason.trim()} title={!form.reason.trim() ? 'Ghi lý do sửa' : undefined}>Lưu</button></div>
    </section>}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="ĐVT kho"><b>{it.unit}</b></Stat>
      <Stat label="ĐV mua · hệ số">{it.purchaseUnit && it.purchaseUnit !== it.unit ? <><b>{it.purchaseUnit}</b> = {fmtQty(Number(it.purchaseConversionFactor))} {it.unit}</> : <span className="text-muted-foreground">như ĐVT kho</span>}</Stat>
      <Stat label="Tồn tối thiểu">{it.minStock > 0 ? <span className={NUM}>{fmtQty(it.minStock)}</span> : <span className="text-muted-foreground">chưa đặt</span>}</Stat>
      <Stat label="Tồn mọi kho"><span className={NUM}>{fmtQty(d.stock.reduce((s, x) => s + Number(x.qty), 0))}</span> {it.unit}</Stat>
      <Stat label="Sổ kho · phiếu kho"><span className={NUM}>{d.usage.ledger}</span> · <span className={NUM}>{d.usage.transactions}</span></Stat>
      <Stat label="Đơn mua · đề xuất"><span className={NUM}>{d.usage.purchaseOrders}</span> · <span className={NUM}>{d.usage.requests}</span></Stat>
    </div>
    <Section title="Cách quản lý kho">
      <div className="grid gap-2 sm:grid-cols-3">{MODES.map(m =>
        <label key={m} className={`rounded-xl border px-3 py-2 text-sm ${it.inventoryMode === m ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'} ${canIssue && !busy ? 'cursor-pointer' : 'opacity-70'}`}>
          <input type="radio" className="mr-1.5" disabled={!canIssue || busy} checked={it.inventoryMode === m} onChange={() => void setMode(m)} /><b>{INVENTORY_MODE_LABELS[m]}</b>
          <span className="block text-xs text-muted-foreground">{INVENTORY_MODE_HINTS[m]}</span></label>)}</div>
    </Section>
    {d.stock.length > 0 && <Section title="Tồn theo kho"><ul className="divide-y divide-border rounded-xl border border-border text-sm">{d.stock.map(s =>
      <li key={s.warehouseId} className="flex items-center justify-between px-3 py-1.5"><span>{s.warehouseName}</span><span><span className={NUM}>{fmtQty(Number(s.qty))}</span> <span className="text-xs text-muted-foreground">{it.unit} · {Number(s.value) > 0 ? shortMoney(Number(s.value)) : 'chưa có giá'}</span></span></li>)}</ul></Section>}
    {it.mergedIntoId ? <div className={`rounded-xl border px-3 py-2 text-sm ${TEAL}`}>Đã gộp vào mã khác {dateVi(it.retiredAt)}. Tồn và kế hoạch đã chuyển sang mã giữ; lịch sử của mã này giữ nguyên.
        <button type="button" className="ml-1 font-semibold underline" onClick={() => onOpen(it.mergedIntoId!)}>Mở mã giữ</button></div>
      : it.status === 'retired' && <p className={`rounded-xl border px-3 py-2 text-sm ${GREY}`}>Ngừng dùng {dateVi(it.retiredAt)}{it.retiredReason ? ` — ${it.retiredReason}` : ''}.</p>}
    {!it.mergedIntoId && <ItemSpecsSection itemId={it.id} itemName={it.name} unit={it.unit} onChanged={() => void load()} />}
    <Section title={<span className="inline-flex items-center gap-1"><History size={14} />Nhật ký</span>}>
      {d.events.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có thay đổi nào được ghi.</p>
        : <ul className="space-y-1.5 text-xs">{d.events.map((ev, i) => <li key={i} className="flex gap-2"><span className="w-20 shrink-0 text-muted-foreground">{dateVi(ev.at)}</span>
          <span className="min-w-0"><span className={ENT}>{ev.by || '—'}</span> {ACTION_LABEL[ev.action] || (ev.fields?.length ? `sửa ${ev.fields.join(', ')}` : ev.action)}
            {ev.action === 'spec' ? <span className="block text-muted-foreground">{SPEC_OP[ev.before?.op] || ev.before?.op}: “{ev.before?.spec}”{ev.after?.target ? ` → “${ev.after.target}”` : ev.after?.spec && ev.after.spec !== ev.before?.spec ? ` → “${ev.after.spec}”` : ''}{Number(ev.after?.moved) > 0 ? ` · chuyển tồn ${ev.after.moved} kho` : ''}</span>
              : ev.before && ev.after && changedFields(ev.before, ev.after).map(c => <span key={c.label} className="block text-muted-foreground">{c.label}: “{c.from}” → “{c.to}”</span>)}
            {ev.reason && <span className="block text-muted-foreground">Lý do: {ev.reason}</span>}</span></li>)}</ul>}
    </Section>
  </Panel>;
};

// Mã người cấp tự nhập: trùng mọi mã đã có (kể cả ngừng dùng), không phân biệt hoa thường; gợi ý VT + 7 số tiếp theo.
const skuTakenIn = (items: InventoryItem[], sku: string) => items.find(i => (i.sku || '').toUpperCase() === sku.trim().toUpperCase())?.sku;
const nextVtSku = (items: InventoryItem[]) =>
  `VT${String(items.reduce((m, i) => Math.max(m, /^VT\d{7}$/.test(i.sku || '') ? Number(i.sku.slice(2)) : 0), 0) + 1).padStart(7, '0')}`;

// ---------- Xử lý đề xuất cấp mã ----------
const RequestDetail: React.FC<{ req: MaterialCodeRequest; items: InventoryItem[]; canIssue: boolean; onDone: (ids: string[]) => void; onBack: () => void }> = ({ req, items, canIssue, onDone, onBack }) => {
  const toast = useToast(); const reasonConfirm = useReasonConfirm();
  const { categoryOptions, unitOptions } = useCatalogLists();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => ({ sku: '', name: req.proposedName, unit: unitOptions.find(u => foldVi(u) === foldVi(String(req.proposedUnit || '').split(' ')[0])) || '',
    category: req.proposedCategory && categoryOptions.includes(req.proposedCategory) ? req.proposedCategory : '', purchaseUnit: '', factor: '1',
    mode: guessInventoryMode(req.proposedName, req.proposedUnit, req.proposedCategory) as InventoryMode }));
  const active = items.filter(i => i.status !== 'retired');
  const sims = similarCatalogItems(active, req.proposedName, 5);
  const exact = active.find(i => catalogNameKey(i.name) === catalogNameKey(form.name));
  const pending = req.status === 'pending';
  const nextSku = nextVtSku(items);
  const skuProblem = catalogSkuProblem(form.sku, sku => skuTakenIn(items, sku));
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { const r = await fn() as { id?: string } | null; toast.success('Đã xử lý đề xuất', ok); onDone(r?.id ? [r.id] : []); }
    catch (e) { toast.error('Chưa xử lý được', catalogErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    const reason = await reasonConfirm({ title: 'Từ chối đề xuất cấp mã?', targetName: `${req.code} · ${req.proposedName}`, intent: 'danger', countdownSeconds: 0,
      warningText: `${req.requestedByName || 'Người đề xuất'} nhận thông báo kèm lý do.`, reasonLabel: 'Lý do từ chối', actionLabel: 'Từ chối' });
    if (reason) await act(() => wmsCatalogService.resolveRequest({ requestId: req.id, action: 'reject', reason }), `Đã từ chối ${req.code}`);
  };
  return <Panel onBack={onBack}
    head={<div><p className="text-xs text-muted-foreground">{req.code} · <span className={ENT}>{req.requestedByName || '—'}</span> · {dateVi(req.createdAt)}</p><h2 className={`text-lg ${ENT}`}>{req.proposedName}</h2>
      <span className="mt-1 flex flex-wrap gap-1"><Badge className={GREY}>ĐVT đề xuất: {req.proposedUnit || '—'}</Badge>
        {pending ? <Badge className={BAD}>Chờ cấp mã</Badge> : <Badge className={req.status === 'approved' ? OK : GREY}>{req.status === 'approved' ? `${req.resolution === 'existing' ? 'Dùng mã có sẵn' : 'Đã cấp'} ${req.approvedSku || ''}` : 'Từ chối'}</Badge>}</span></div>}
    foot={!pending ? <span className="text-xs text-muted-foreground">{req.status === 'rejected' ? `Lý do: ${req.rejectionReason || '—'}` : `${req.approvedByName || ''} · ${dateVi(req.approvedAt)}`}</span>
      : canIssue ? <>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void reject()}>Từ chối</button>
        <button type="button" className={primaryBtn} disabled={busy || !!skuProblem || !form.name.trim() || !form.unit || !form.category || !!exact} title={skuProblem || (exact ? `Trùng tên ${exact.sku}` : undefined)}
          onClick={() => void act(() => wmsCatalogService.issue({ requestId: req.id, sku: form.sku.trim(), name: form.name.trim(), unit: form.unit, category: form.category, purchaseUnit: form.purchaseUnit || null,
            purchaseConversionFactor: Number(form.factor.replace(',', '.')) || 1, inventoryMode: form.mode }), `Đã cấp mã ${form.sku.trim()} cho “${form.name.trim()}”`)}><Hash size={15} />Cấp mã</button></>
      : <span className="text-xs text-muted-foreground">Chỉ người có ô quyền “Cấp mã” xử lý đề xuất.</span>}>
    {(req.proposedSpecification || req.reason) && <Stat label="Quy cách / lý do">{[req.proposedSpecification, req.reason].filter(Boolean).join(' — ')}</Stat>}
    <section className={`rounded-xl border p-3 text-sm ${sims.length ? 'border-amber-300 bg-amber-50/70 dark:bg-amber-950/30' : 'border-border'}`}>
      <p className="font-semibold">{sims.length ? <><AlertTriangle size={14} className="mr-1 inline text-amber-700" />Mã gần giống đã có</> : 'Không thấy mã gần giống'}</p>
      {sims.length > 0 && <ul className="mt-2 space-y-1.5">{sims.map(({ item }) => <li key={item.id} className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1"><span className={ENT}>{item.sku}</span> · {item.name} <span className="text-xs text-muted-foreground">({item.unit})</span></span>
        {pending && canIssue && <button type="button" disabled={busy} className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-xs font-semibold dark:bg-slate-900"
          onClick={() => void act(() => wmsCatalogService.resolveRequest({ requestId: req.id, action: 'use_existing', itemId: item.id }), `Trả lời ${req.requestedByName || ''}: dùng ${item.sku}`)}>Dùng mã này</button>}</li>)}</ul>}
    </section>
    {pending && canIssue && <section className="space-y-3 rounded-xl border border-border p-3">
      <h3 className="text-sm font-bold">Cấp mã mới</h3>
      <div><label className="block text-sm font-medium">Mã vật tư<input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value.replace(/\s/g, '') }))} placeholder={`VD: ${nextSku}`}
        autoCapitalize="characters" spellCheck={false} aria-invalid={!!(form.sku.trim() && skuProblem)} className={`mt-1 w-full font-mono sm:max-w-[14rem] ${inputCls} ${form.sku.trim() && skuProblem ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} /></label>
        {form.sku.trim() && skuProblem ? <span className="mt-1 block text-xs font-semibold text-rose-700">{skuProblem}</span>
          : form.sku.trim() !== nextSku && <button type="button" onClick={() => setForm(f => ({ ...f, sku: nextSku }))} className="mt-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">Dùng mã gợi ý {nextSku}</button>}</div>
      <label className="block text-sm font-medium">Tên chuẩn<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={`mt-1 w-full ${inputCls}`} />
        {exact && <span className="mt-1 block text-xs font-semibold text-rose-700">Trùng tên với {exact.sku} · {exact.name} (so sau khi bỏ dấu, khoảng trắng).</span>}</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Nhóm<select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={`mt-1 w-full ${inputCls}`}><option value="">Chọn…</option>{categoryOptions.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm font-medium">ĐVT kho<select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}><option value="">Chọn…</option>{unitOptions.map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium">ĐV mua<select value={form.purchaseUnit} onChange={e => setForm(f => ({ ...f, purchaseUnit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}><option value="">(như ĐVT kho)</option>{unitOptions.map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium">1 ĐV mua = ? ĐVT kho<input inputMode="decimal" disabled={!form.purchaseUnit} value={form.factor} onChange={e => setForm(f => ({ ...f, factor: e.target.value }))} className={`mt-1 w-full text-right ${inputCls}`} /></label>
      </div>
      <div><p className="text-sm font-medium">Cách quản lý kho</p><div className="mt-1 grid gap-2 sm:grid-cols-3">{MODES.map(m =>
        <label key={m} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${form.mode === m ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}><input type="radio" className="mr-1.5" checked={form.mode === m} onChange={() => setForm(f => ({ ...f, mode: m }))} /><b>{INVENTORY_MODE_LABELS[m]}</b>
          <span className="block text-xs text-muted-foreground">{INVENTORY_MODE_HINTS[m]}</span></label>)}</div></div>
    </section>}
  </Panel>;
};

// ---------- Đề xuất mã mới (mọi người có quyền đề xuất) ----------
export const NewCodeDrawer: React.FC<{ onClose: () => void; onCreated: (ids: string[]) => void }> = ({ onClose, onCreated }) => {
  const { user, items } = useApp(); const toast = useToast();
  const { unitOptions } = useCatalogLists();
  const [f, setF] = useState({ name: '', unit: '', spec: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const active = items.filter(i => i.status !== 'retired');
  const sims = f.name.trim().length >= 3 ? similarCatalogItems(active, f.name, 6) : [];
  const exact = sims.find(s => s.score === 99);
  const submit = async () => {
    setBusy(true);
    try {
      await materialCodeRequestService.create({ id: `mcr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, code: `MCR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
        requestedByUserId: user.id, requestedByName: user.name || user.username, proposedName: f.name.trim(), proposedUnit: f.unit, proposedCategory: null,
        proposedSpecification: f.spec.trim() || null, proposedSupplierId: null, reason: f.reason.trim(), approvedSku: null, approvedItemId: null, approvedByUserId: null,
        approvedByName: null, approvedAt: null, rejectionReason: null } as any);
      toast.success('Đã gửi đề xuất mã', `Người cấp mã nhận ngay “${f.name.trim()}”.`); onCreated([]); onClose();
    } catch (e) { toast.error('Chưa gửi được', catalogErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Drawer label="Đề xuất mã mới" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Danh mục vật tư</p><h2 className="text-lg font-bold">Đề xuất mã mới</h2><p className="text-sm text-muted-foreground">Kiểm tra mã gần giống trước khi gửi.</p></>}
    footer={<><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || !f.name.trim() || !f.unit || !!exact} onClick={() => void submit()}><Hash size={15} />Gửi đề xuất</button></>}>
    <label className="block text-sm font-medium">Tên vật tư<input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="VD: Thép hình chấn U250x250x10" className={`mt-1 w-full ${inputCls}`} /></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-medium">Đơn vị tính<select value={f.unit} onChange={e => setF(x => ({ ...x, unit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}><option value="">Chọn…</option>{unitOptions.map(u => <option key={u}>{u}</option>)}</select></label>
      <label className="block text-sm font-medium">Quy cách (nếu có)<input value={f.spec} onChange={e => setF(x => ({ ...x, spec: e.target.value }))} maxLength={60} placeholder="VD: Hòa Phát CB240" className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    <label className="block text-sm font-medium">Dùng cho việc gì<input value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} placeholder="VD: Đề xuất vật tư nhà xưởng 3" className={`mt-1 w-full ${inputCls}`} /></label>
    {exact && <p className={`rounded-xl border px-3 py-2 text-sm ${BAD}`}>Đã có mã <b>{exact.item.sku}</b> trùng tên — dùng mã này, không gửi đề xuất.</p>}
    {sims.length > 0 && !exact && <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/30"><p className="font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle size={14} className="mr-1 inline" />Có thể đã có — kiểm tra trước khi gửi</p>
      <ul className="mt-2 space-y-1">{sims.map(({ item }) => <li key={item.id}><span className={ENT}>{item.sku}</span> · {item.name} <span className="text-xs text-muted-foreground">({item.unit})</span></li>)}</ul></section>}
    <p className="text-xs text-muted-foreground">Khác kích thước, khác giá hoặc khác hệ số quy đổi với mã có sẵn → mã mới. Chỉ khác thương hiệu / màu / xuất xứ → ghi ở ô Quy cách.</p>
  </Drawer>;
};

// ---------- Màn chính ----------
export const CatalogView: React.FC = () => {
  useModuleData('wms');
  const { items, refreshWmsRecords } = useApp();
  const location = useLocation() as { state?: { itemId?: string } };
  const toast = useToast(); const confirm = useConfirm();
  const [ov, setOv] = useState<CatalogOverview | null>(null);
  const [reqs, setReqs] = useState<MaterialCodeRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [queue, setQueue] = useState<Queue>(location.state?.itemId ? 'all' : 'requests');
  const [sel, setSel] = useState<string | null>(location.state?.itemId || null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyStock, setOnlyStock] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [newCode, setNewCode] = useState(false);
  const [quickCreate, setQuickCreate] = useState(false);
  /** Hai ô quyền nhạy cảm: Tạo mã vật tư (không qua đề xuất), Sửa mã vật tư (ghi lịch sử). */
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<DuplicatesData | null>(null);
  const [showAuto, setShowAuto] = useState(false);
  const [specQ, setSpecQ] = useState<{ canManage: boolean; specs: PendingItemSpec[] } | null>(null);

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const [o, r, dp, co, sq] = await Promise.all([wmsCatalogService.overview(), materialCodeRequestService.list(), wmsCatalogService.duplicates().catch(() => null),
        wmsCatalogService.createOptions().catch(() => null), itemSpecService.pending().catch(() => null)]);
      setOv(o); setReqs(r); setDupes(dp); setCanCreate(Boolean(co?.canCreate)); setCanEdit(Boolean(co?.canEdit)); setSpecQ(sq); setState('ready');
    }
    catch (e) { setMessage(catalogErrorMessage(e, 'Chưa tải được danh mục.')); setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (location.state?.itemId) { setQueue('all'); setSel(location.state.itemId); } }, [location.state?.itemId]);
  const changed = (ids: string[] = []) => { void load(); if (ids.length) void refreshWmsRecords({ itemIds: ids }).catch(() => undefined); };

  const pending = reqs.filter(r => r.status === 'pending');
  const qtyOf = (id: string) => Number(ov?.usage[id]?.[1] || 0);
  const modeCands = items.filter(i => i.status !== 'retired' && (i.inventoryMode || 'stock') === 'stock' && guessInventoryMode(i.name, i.unit, i.category) !== 'stock');
  const risky: CatalogRename[] = (ov?.renames || []).filter(r => r.usedBefore);
  const retired = items.filter(i => i.status === 'retired');
  const groups = sortGroups(dupes?.groups || []);
  const openDupes = groups.filter(g => g.verdict.v !== 'diffnum');
  const autoDupes = groups.filter(g => g.verdict.v === 'diffnum');
  const skuOf = (id: string) => items.find(i => i.id === id)?.sku || '';
  const today = new Date().toISOString().slice(0, 10);
  const tiles: Array<{ k: Queue; label: string; icon: React.ElementType; value: number; hint: string; tone: string; ic: string; blink?: boolean }> = [
    { k: 'all', label: 'Tất cả mã', icon: Boxes, value: items.length, hint: `${items.filter(i => qtyOf(i.id) > 0).length} mã đang có tồn`, tone: 'text-leaf-700 dark:text-leaf-300', ic: 'bg-leaf-600' },
    { k: 'requests', label: 'Đề xuất chờ cấp mã', icon: Hash, value: pending.length, hint: pending.length ? `cũ nhất ${Math.max(...pending.map(r => Math.floor((Date.parse(today) - Date.parse(String(r.createdAt).slice(0, 10))) / 864e5)))} ngày` : 'không còn', tone: 'text-rose-700 dark:text-rose-300', ic: 'bg-rose-500', blink: pending.length > 0 },
    { k: 'specs', label: 'Quy cách chờ rà', icon: ListChecks, value: specQ?.specs.length || 0, hint: specQ ? `${specQ.specs.filter(s => specSizeConflict(s.itemName, s.name)).length} có thể là vật tư khác` : 'chưa tải được', tone: 'text-teal-700 dark:text-teal-300', ic: 'bg-teal-600' },
    { k: 'dupes', label: 'Có thể trùng', icon: CopyCheck, value: openDupes.length, hint: dupes ? `${openDupes.filter(g => g.verdict.v === 'dup').length} trùng rõ · ${openDupes.filter(g => g.verdict.v !== 'dup').length} cần xem` : 'chưa tải được', tone: 'text-amber-700 dark:text-amber-300', ic: 'bg-amber-500' },
    { k: 'mode', label: 'Cần đặt cách quản lý', icon: Tags, value: modeCands.length, hint: 'bê tông, Base, dầu, dịch vụ…', tone: 'text-amber-700 dark:text-amber-300', ic: 'bg-amber-500' },
    { k: 'renames', label: 'Đổi tên khi đã có chứng từ', icon: PencilLine, value: risky.length, hint: `trên ${(ov?.renames || []).length} lần đổi tên`, tone: 'text-amber-700 dark:text-amber-300', ic: 'bg-amber-500' },
    { k: 'retired', label: 'Ngừng dùng', icon: CircleSlash, value: retired.length, hint: 'mở lại được', tone: 'text-slate-700 dark:text-slate-200', ic: 'bg-slate-500' },
  ];
  const categories = useMemo(() => [...new Set(items.map(i => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [items]);
  const allList = useMemo(() => items.filter(i => (!category || i.category === category) && (!onlyStock || qtyOf(i.id) > 0)
    && (!search.trim() || foldVi(`${i.sku} ${i.name}`).includes(foldVi(search.trim())))).sort((a, b) => a.sku.localeCompare(b.sku)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, category, onlyStock, search, ov]);

  if (state === 'loading' && !ov) return <StateBox kind="loading" title="Đang tải danh mục vật tư…" />;
  if (state === 'error' && !ov) return <StateBox kind={/quyền/.test(message) ? 'denied' : 'error'} title="Chưa mở được Danh mục vật tư" message={message} onRetry={() => void load()} />;
  if (!ov) return null;
  const canIssue = ov.can.issueCode;
  const selReq = reqs.find(r => r.id === sel);
  const selRename = sel?.startsWith('rn:') ? (ov.renames[+sel.slice(3)] || null) : null;
  const selDup = sel?.startsWith('dup:') ? groups.find(g => g.key === sel.slice(4)) || null : null;
  const selSpec = sel?.startsWith('spec:') ? (specQ?.specs.find(s => s.id === sel.slice(5)) || null) : null;
  const selItem = !selReq && !selRename && !selDup && sel && !sel.startsWith('dup:') && !sel.startsWith('spec:') ? sel : null;
  const pickedIds = Object.keys(picked).filter(k => picked[k]);

  const rowBtn = (id: string, title: React.ReactNode, sub: React.ReactNode, badge?: React.ReactNode, pre?: React.ReactNode) =>
    <li key={id} className={`flex items-start gap-2 px-3 py-2.5 ${sel === id ? 'bg-teal-50/70 dark:bg-teal-950/30' : 'hover:bg-muted/40'}`}>{pre}
      <button type="button" onClick={() => setSel(id)} className="flex min-w-0 flex-1 items-start gap-2 text-left"><span className="min-w-0 flex-1"><span className={ENT}>{title}</span><span className="block truncate text-xs text-muted-foreground">{sub}</span></span>{badge}</button></li>;
  const box = (children: React.ReactNode, top?: React.ReactNode) => <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{top}{children}</div>;
  const itemRow = (i: InventoryItem, pre?: React.ReactNode, badge?: React.ReactNode) => rowBtn(i.id,
    <span className={i.status === 'retired' ? 'text-muted-foreground line-through' : ''}>{i.name}</span>, `${i.sku} · ${i.unit} · ${i.category}`,
    badge || <span className="flex shrink-0 flex-col items-end gap-1">{qtyOf(i.id) > 0 && <span className={`text-xs ${NUM}`}>{fmtQty(qtyOf(i.id))}</span>}
      {(i.inventoryMode || 'stock') !== 'stock' && <Badge className={TEAL}>{INVENTORY_MODE_LABELS[i.inventoryMode || 'stock']}</Badge>}{i.status === 'retired' && <Badge className={GREY}>{i.mergedIntoId ? `Đã gộp → ${skuOf(i.mergedIntoId)}` : 'Ngừng dùng'}</Badge>}</span>, pre);

  const list = queue === 'all' ? box(<ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{allList.slice(0, 200).map(i => itemRow(i))}
    {allList.length > 200 && <li className="px-3 py-2 text-center text-xs text-muted-foreground">Còn {allList.length - 200} mã — gõ để tìm.</li>}
    {allList.length === 0 && <li className="px-3 py-10 text-center text-sm text-muted-foreground">Không có mã khớp bộ lọc.</li>}</ul>,
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-2"><label className="relative min-w-[10rem] flex-1"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mã, tên (không cần dấu)…" className={`w-full pl-8 ${inputCls}`} /></label>
      <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Nhóm" className={`max-w-[9rem] ${inputCls}`}><option value="">Mọi nhóm</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
      <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} />Có tồn</label>
      <span className="w-full text-xs text-muted-foreground">{allList.length} mã</span></div>)
    : queue === 'requests' ? box(pending.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không còn đề xuất chờ cấp mã.</p>
      : <ul className="divide-y divide-border">{pending.map(r => rowBtn(r.id, r.proposedName, `${r.code} · ${r.requestedByName || '—'} · ${r.proposedUnit || ''}`, <Badge className={`${BAD} overdue-blink`}>{dateVi(r.createdAt)}</Badge>))}</ul>)
    : queue === 'specs' ? box(!specQ ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Chưa tải được quy cách chờ rà. Bấm Làm mới.</p>
      : specQ.specs.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không còn quy cách mới chờ rà.</p>
      : <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{specQ.specs.map(s => rowBtn(`spec:${s.id}`, s.name, `${s.sku} · ${s.itemName} · ${SPEC_SOURCE_LABELS[s.source]}${s.createdByName ? ` · ${s.createdByName}` : ''}`,
        specSizeConflict(s.itemName, s.name) ? <Badge className={WARN}>khác kích thước?</Badge> : <Badge className={TEAL}>mới</Badge>))}</ul>,
      <p className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Quy cách Mua hàng / thủ kho gõ mới trên chứng từ. Giữ, sửa chữ, gộp vào quy cách có sẵn, hoặc ngừng dùng (là ghi chú / vật tư khác).</p>)
    : queue === 'dupes' ? box(!dupes ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Chưa tải được danh sách mã trùng. Bấm Làm mới.</p>
      : <>{openDupes.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không còn nhóm mã nào có thể trùng.</p>
        : <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{openDupes.map(g => rowBtn(`dup:${g.key}`, suggestKeep(g).name, g.items.map(i => `${i.sku} (${i.unit})`).join(' · '),
          <span className="flex shrink-0 flex-col items-end gap-1"><Badge className={VERDICT_CLS[g.verdict.v]}>{VERDICT_LABEL[g.verdict.v]}</Badge>{g.items.some(i => i.stock.some(s => Number(s.qty) > 0)) && <span className="text-[11px] text-muted-foreground">có tồn</span>}</span>))}</ul>}
        {autoDupes.length > 0 && <><button type="button" onClick={() => setShowAuto(v => !v)} className="flex w-full items-center gap-1 border-t border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{showAuto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Tự loại vì khác số ({autoDupes.length})</button>
          {showAuto && <ul className="divide-y divide-border border-t border-border">{autoDupes.map(g => rowBtn(`dup:${g.key}`, g.items.map(i => i.name).join(' / '), g.verdict.why, <Badge className={GREY}>khác số</Badge>))}</ul>}</>}</>,
      <p className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">So tên sau khi bỏ dấu, hoa thường, dấu cách, “*” / “x”. Hệ thống tự phân loại; người Cấp mã quyết định gộp hay không.</p>)
    : queue === 'mode' ? box(modeCands.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không còn mã cần đặt cách quản lý.</p>
      : <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{modeCands.map(i => itemRow(i, canIssue ? <input type="checkbox" className="mt-1.5 h-4 w-4 accent-teal-600" aria-label={`Chọn ${i.name}`} checked={!!picked[i.id]}
        onChange={e => setPicked(p => ({ ...p, [i.id]: e.target.checked }))} /> : undefined, <Badge className={TEAL}>gợi ý: {INVENTORY_MODE_LABELS[guessInventoryMode(i.name, i.unit, i.category)]}</Badge>))}</ul>,
      <p className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Gợi ý theo tên / ĐVT / nhóm. Tick rồi đặt hàng loạt — chỉ đổi cách nhận hàng lần sau.</p>)
    : queue === 'renames' ? box(risky.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không có lần đổi tên nào xảy ra khi mã đã có chứng từ — lịch sử không bị hiện sai tên.</p>
      : <ul className="divide-y divide-border">{(ov.renames).map((r, idx) => r.usedBefore ? rowBtn(`rn:${idx}`, <span>{r.old} <span className="text-muted-foreground">→</span> {r.new}</span>,
        `${items.find(i => i.id === r.itemId)?.sku || r.itemId} · ${dateVi(r.at)} · ${r.by || '—'}`, <Badge className={WARN}>đã dùng</Badge>) : null)}</ul>)
    : box(retired.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Chưa có mã nào ngừng dùng.</p> : <ul className="divide-y divide-border">{retired.map(i => itemRow(i))}</ul>);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-sm text-muted-foreground">Một cửa cấp mã. Không xóa mã — chỉ <b>Ngừng dùng</b>.{canCreate ? ' Thiếu mã thì tạo ngay, không cần đề xuất.' : ' Bạn có thể đề xuất mã mới; người có quyền Cấp mã xử lý.'}</p>
      {canCreate ? <button type="button" className={primaryBtn} onClick={() => setQuickCreate(true)}><Plus size={15} />Tạo mã mới</button>
        : ov.can.request && <button type="button" className={`${secondaryBtn} bg-card`} onClick={() => setNewCode(true)}><Hash size={15} />Đề xuất mã mới</button>}
      <button type="button" className={`${secondaryBtn} bg-card`} onClick={() => void load()}><RefreshCw size={15} />Làm mới</button>
    </div>
    <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">{tiles.map(x => <Tile key={x.k} active={queue === x.k} onClick={() => { setQueue(x.k); setSel(null); }} icon={x.icon} label={x.label} value={x.value} hint={x.hint} tone={x.tone} ic={x.ic} blink={x.blink && queue !== x.k} />)}</div>
    <Split open={!!sel} selKey={sel} list={list}
      detail={selItem ? <ItemDetail key={selItem} itemId={selItem} canIssue={canIssue} canEdit={canEdit} onChanged={changed} onBack={() => setSel(null)} onOpen={id => { setQueue('all'); setSel(id); }} />
        : selSpec ? <Panel onBack={() => setSel(null)} head={<div><p className="text-xs text-muted-foreground">{selSpec.sku} · quy cách chờ rà</p><h2 className={`text-lg ${ENT}`}>{selSpec.itemName}</h2></div>}
          foot={<button type="button" className={secondaryBtn} onClick={() => { setQueue('all'); setSel(selSpec.itemId); }}>Mở mã {selSpec.sku}</button>}>
          <ItemSpecsSection key={selSpec.itemId} itemId={selSpec.itemId} itemName={selSpec.itemName} unit={selSpec.unit} focusId={selSpec.id}
            onChanged={() => void itemSpecService.pending().then(sq => { setSpecQ(sq); if (!sq.specs.some(x => x.id === selSpec.id)) {
              const next = sq.specs.find(x => x.itemId === selSpec.itemId) || sq.specs[0]; setSel(next ? `spec:${next.id}` : null); } }).catch(() => undefined)} />
        </Panel>
        : selDup ? <CatalogMergePanel key={selDup.key} group={selDup} canMerge={!!dupes?.can.merge} onBack={() => setSel(null)} onOpenItem={id => { setQueue('all'); setSel(id); }}
          onDone={ids => { setSel(null); changed(ids); }} />
        : selReq ? <RequestDetail key={selReq.id} req={selReq} items={items} canIssue={canIssue} onDone={ids => { setSel(null); changed(ids); }} onBack={() => setSel(null)} />
        : selRename ? <Panel onBack={() => setSel(null)} head={<div><p className="text-xs text-muted-foreground">{dateVi(selRename.at)} · {selRename.by || '—'}</p><h2 className="text-lg font-bold">Đổi tên khi mã đã có chứng từ</h2></div>}>
          <div className="grid gap-2 sm:grid-cols-2"><Stat label="Tên cũ"><b>{selRename.old}</b></Stat><Stat label="Tên mới"><b className={ENT}>{selRename.new}</b></Stat></div>
          <div className="grid grid-cols-3 gap-2"><Stat label="Sổ kho"><span className={NUM}>{selRename.usage.ledger}</span></Stat><Stat label="Đơn mua"><span className={NUM}>{selRename.usage.purchaseOrders}</span></Stat><Stat label="Đề xuất"><span className={NUM}>{selRename.usage.requests}</span></Stat></div>
          <p className={`rounded-xl border px-3 py-2 text-sm ${WARN}`}>Mã đã có chứng từ trước lần đổi tên nên chứng từ cũ đang hiện tên mới. Từ bản này: mã đã có chứng từ chỉ được sửa chính tả; đổi kích thước hoặc thành vật tư khác bị chặn.</p>
          <button type="button" className={secondaryBtn} onClick={() => setSel(selRename.itemId)}>Mở mã {items.find(i => i.id === selRename.itemId)?.sku || ''}</button>
        </Panel>
        : <EmptyPanel icon={Hash} title="Chọn một dòng bên trái" text={queue === 'mode' ? 'Hoặc tick nhiều mã rồi đặt cách quản lý hàng loạt.' : queue === 'dupes' ? 'So từng mã (ĐVT, tồn, chứng từ, kế hoạch), chọn mã giữ rồi gộp — hoặc ghi “không phải trùng”.' : 'Cấp mã, sửa, ngừng dùng — làm ngay tại đây.'} />} />
    {queue === 'mode' && canIssue && pickedIds.length > 0 && <div className="sticky bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-card px-3 py-2.5 shadow-lg dark:border-teal-900">
      <span className="mr-auto text-sm">Đã chọn <b className={NUM}>{pickedIds.length}</b> mã</span>
      {(['use', 'service'] as InventoryMode[]).map(m => <button key={m} type="button" disabled={busy} className={m === 'use' ? primaryBtn : secondaryBtn} onClick={() => void (async () => {
        const yes = await confirm({ title: `Đặt “${INVENTORY_MODE_LABELS[m]}”?`, targetName: `${pickedIds.length} mã`, intent: 'warning', countdownSeconds: 0, confirmText: 'Đặt', actionLabel: 'Đặt',
          warningText: `${INVENTORY_MODE_HINTS[m]}. Áp dụng cho lần nhận hàng sau; tồn đang có xử lý qua kiểm kê.` });
        if (!yes) return;
        setBusy(true);
        try { const r = await wmsCatalogService.setMode({ itemIds: pickedIds, mode: m, reason: 'Đặt hàng loạt ở Danh mục vật tư' }); toast.success('Đã đặt cách quản lý', `${r.updated} mã → ${INVENTORY_MODE_LABELS[m]}`); setPicked({}); changed(pickedIds); }
        catch (e) { toast.error('Chưa đặt được', catalogErrorMessage(e)); }
        finally { setBusy(false); }
      })()}>Đặt “{INVENTORY_MODE_LABELS[m]}”</button>)}
    </div>}
    {newCode && <NewCodeDrawer onClose={() => setNewCode(false)} onCreated={changed} />}
    {quickCreate && <QuickCreateItemDialog initialName={search.trim()} isSkuTaken={sku => skuTakenIn(items, sku)}
      findSimilar={name => similarCatalogItems(items.filter(i => i.status !== 'retired'), name, 5).map(s => s.item)}
      useExistingLabel="Mở mã này" onUseExisting={item => { setQuickCreate(false); setQueue('all'); setSel(item.id); }}
      onClose={() => setQuickCreate(false)}
      onCreated={item => { setQuickCreate(false); changed([item.id]); setQueue('all'); setSel(item.id); }} />}
  </div>;
};
