import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, ArrowUpFromLine, ClipboardCheck, Loader2, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { TransactionStatus, TransactionType, type BusinessPartner, type SupplierContract, type Transaction } from '../../types';
import { inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM } from '../finance/financeUi';
import { foldVi, catalogErrorMessage, type StockOverview, type StockRow } from '../../lib/wmsCatalogService';
import { materialIssueService } from '../../lib/materialIssueService';
import { wmsTransferService } from '../../lib/wmsTransferService';
import { stockCountService, type StockCountDetail } from '../../lib/stockCountService';
import { useWarehouseSpecStock } from '../../lib/wmsSpecStockService';
import { buildMaterialIssueRecipientSource, type MaterialIssueRecipientSourceSelection } from '../../lib/materialIssueRecipientSource';
import { partnerService } from '../../lib/partnerService';
import { supplierContractService } from '../../lib/hdService';
import { dateInputToTransactionTimestamp } from '../../lib/transactionVoucherDates';
import { parseQuantityInput } from '../../lib/quantityInput';
import { supabase } from '../../lib/supabase';
import { IssueSpecSelect } from './IssueSpecSelect';
import { Panel, Section, fmtQty } from './wmsUi';

// V2 Kho một màn — các form mở ở cột phải: Xuất cấp (1 bước, ghi sổ ngay), Chuyển kho (Gửi hàng), Xuất hủy (chờ duyệt), Kiểm đếm.
// Chỉ tiêu đề + số liệu; ô nhập dùng text-[12px] vì index.css ép text-xs trong lưới thành một dòng trên mobile.

type Wh = StockOverview['warehouses'][number];
export type MoveKind = 'issue' | 'transfer' | 'loss';
const LOSS_REASONS = ['Hư hỏng', 'Mất mát', 'Hết hạn sử dụng', 'Hao hụt vượt định mức'];
const COUNT_REASONS = ['Kiểm nhanh', 'Cuối tháng', 'Chốt tiêu hao'];
const todayInput = () => new Date().toISOString().slice(0, 10);
const chip = (on: boolean, tone: 'teal' | 'rose' = 'teal') => `rounded-full border px-3 py-1 text-[13px] ${on
  ? tone === 'rose' ? 'border-rose-600 bg-rose-600 text-white' : 'border-teal-600 bg-teal-700 text-white'
  : 'border-border bg-card hover:bg-muted'}`;

const Head: React.FC<{ wh?: string; icon: React.ElementType; title: string }> = ({ wh, icon: Icon, title }) =>
  <div>{wh && <p className="text-[12px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{wh}</p>}
    <h2 className="flex items-center gap-2 text-lg font-bold"><Icon size={18} />{title}</h2></div>;

const WhSelect: React.FC<{ value: string; options: Wh[]; onChange: (id: string) => void; label?: string }> = ({ value, options, onChange, label = 'Kho' }) =>
  <label className="block text-sm font-semibold">{label}<select value={value} onChange={e => onChange(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
    <option value="">Chọn kho…</option>{options.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>;

export const ItemPick: React.FC<{ rows: StockRow[]; exclude: string[]; onPick: (r: StockRow) => void }> = ({ rows, exclude, onPick }) => {
  const [q, setQ] = useState('');
  const hits = q.trim() ? rows.filter(r => r.qty > 0 && !exclude.includes(r.itemId) && foldVi(`${r.name} ${r.sku || ''}`).includes(foldVi(q.trim()))).slice(0, 8) : [];
  return <div className="relative"><label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2"><Search size={15} className="text-muted-foreground" />
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Thêm vật tư — gõ tên / mã" aria-label="Thêm vật tư" className="w-full bg-transparent py-2 text-sm outline-none" /></label>
    {hits.length > 0 && <ul className="absolute z-20 mt-1 w-full divide-y divide-border rounded-xl border border-border bg-card shadow-lg">{hits.map(r =>
      <li key={r.itemId}><button type="button" onClick={() => { onPick(r); setQ(''); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
        <span className="min-w-0"><span className={ENT}>{r.name}</span><span className="block text-[12px] text-muted-foreground">{r.sku}</span></span>
        <span className="whitespace-nowrap text-[12px]">tồn <b className={NUM}>{fmtQty(r.qty)}</b> {r.unit}</span></button></li>)}</ul>}
    {q.trim() && hits.length === 0 && <p className="mt-1 text-[12px] text-muted-foreground">Không có vật tư còn tồn khớp “{q.trim()}”.</p>}
  </div>;
};

type FormLine = { row: StockRow; qty: string; spec: string };
const qtyOf = (l: FormLine) => parseQuantityInput(l.qty);

const FormLines: React.FC<{ whId: string; lines: FormLine[]; setLines: React.Dispatch<React.SetStateAction<FormLine[]>> }> = ({ whId, lines, setLines }) => {
  const specStock = useWarehouseSpecStock(whId, lines.map(l => l.row.itemId));
  const set = (i: number, patch: Partial<FormLine>) => setLines(ls => ls.map((x, j) => j === i ? { ...x, ...patch } : x));
  return <ul className="divide-y divide-border rounded-xl border border-border text-sm">
    {lines.length === 0 && <li className="px-3 py-6 text-center text-muted-foreground">Chưa có vật tư</li>}
    {lines.map((l, i) => { const n = qtyOf(l); const over = n > l.row.qty + 1e-9;
      return <li key={l.row.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="min-w-0 flex-1 basis-48"><span className={ENT}>{l.row.name}</span>
          <span className={`block text-[12px] ${over ? 'font-semibold text-rose-700' : 'text-muted-foreground'}`}>tồn {fmtQty(l.row.qty)} {l.row.unit}{over ? ' — vượt tồn' : ''}</span>
          <IssueSpecSelect className="mt-1" specs={specStock[l.row.itemId]} value={l.spec} qty={Number.isFinite(n) ? n : undefined} unit={l.row.unit}
            label={`Quy cách ${l.row.name}`} onChange={v => set(i, { spec: v })} /></span>
        <input inputMode="decimal" value={l.qty} onChange={e => set(i, { qty: e.target.value })} placeholder="SL" aria-label={`Số lượng ${l.row.name}`}
          className={`${inputCls} w-24 text-right tabular-nums ${over ? 'border-rose-400' : ''}`} />
        <span className="w-10 text-[12px] text-muted-foreground">{l.row.unit}</span>
        <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label={`Bỏ ${l.row.name}`} className="text-muted-foreground hover:text-rose-600"><X size={15} /></button>
      </li>; })}
  </ul>;
};

type Recipient = { id: string; label: string; search: string; selection: MaterialIssueRecipientSourceSelection };
let recipientCache: Promise<Recipient[]> | null = null;
const loadRecipients = () => {
  recipientCache ||= Promise.all([supplierContractService.list().catch(() => [] as SupplierContract[]), partnerService.list({ includeInactive: false }).catch(() => [] as BusinessPartner[])])
    .then(([contracts, partners]) => [
      ...contracts.map(c => ({ id: `c:${c.id}`, label: `${c.code} – ${c.supplierName || c.name}`, search: foldVi([c.code, c.name, c.supplierName].filter(Boolean).join(' ')),
        selection: { kind: 'supplier_contract', contract: c } as MaterialIssueRecipientSourceSelection })),
      ...partners.map(p => ({ id: `p:${p.id}`, label: `${p.code ? `${p.code} – ` : ''}${p.name}`, search: foldVi([p.code, p.name, p.taxCode, p.contactName].filter(Boolean).join(' ')),
        selection: { kind: 'business_partner', partner: p } as MaterialIssueRecipientSourceSelection })),
    ]);
  recipientCache.catch(() => { recipientCache = null; });
  return recipientCache;
};

const RecipientPick: React.FC<{ value: Recipient | null; onChange: (r: Recipient | null) => void }> = ({ value, onChange }) => {
  const [all, setAll] = useState<Recipient[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { let live = true; void loadRecipients().then(r => { if (live) setAll(r); }); return () => { live = false; }; }, []);
  const hits = (all || []).filter(r => !q.trim() || r.search.includes(foldVi(q.trim()))).slice(0, 30);
  if (value) return <div className="mt-1 flex items-center gap-2 rounded-lg border border-teal-300 bg-teal-50/60 px-3 py-2 text-sm dark:border-teal-800 dark:bg-teal-950/30">
    <span className={`min-w-0 flex-1 ${ENT}`}>{value.label}</span>
    <button type="button" onClick={() => onChange(null)} aria-label="Đổi người nhận" className="text-muted-foreground hover:text-rose-600"><X size={15} /></button></div>;
  return <div className="relative mt-1">
    <input value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={e => { setQ(e.target.value); setOpen(true); }}
      placeholder={all ? 'Gõ tên tổ đội / thầu phụ / HĐ' : 'Đang tải…'} aria-label="Người nhận" className={`w-full ${inputCls}`} />
    {open && all && <ul className="absolute z-20 mt-1 max-h-64 w-full divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
      {hits.length === 0 ? <li className="px-3 py-2 text-[12px] text-muted-foreground">Không có trong danh sách — nhờ Mua hàng thêm đối tác.</li>
        : hits.map(r => <li key={r.id}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(r); setQ(''); setOpen(false); }}
          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">{r.label}</button></li>)}</ul>}
  </div>;
};

export const MoveForm: React.FC<{
  kind: MoveKind; whId: string; warehouses: Wh[]; rows: StockRow[]; seed?: StockRow;
  onDone: (result: { transactionId: string; toast: [string, string?] }) => void; onBack: () => void;
}> = ({ kind, whId: initialWh, warehouses, rows, seed, onDone, onBack }) => {
  const { user, warehouses: allWarehouses, addTransaction, refreshWmsRecords } = useApp();
  const toast = useToast();
  const operable = warehouses.filter(w => w.canOperate);
  const [whId, setWhId] = useState(initialWh || (operable.length === 1 ? operable[0].id : ''));
  const [lines, setLines] = useState<FormLine[]>(seed ? [{ row: seed, qty: '', spec: '' }] : []);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayInput);
  const [busy, setBusy] = useState(false);
  const whRows = useMemo(() => rows.filter(r => r.warehouseId === whId), [rows, whId]);
  const wh = warehouses.find(w => w.id === whId);
  const linesOk = lines.length > 0 && lines.every(l => { const n = qtyOf(l); return n > 0 && n <= l.row.qty + 1e-9; });
  const ok = !!whId && linesOk && (kind !== 'issue' || !!recipient) && (kind !== 'transfer' || (!!to && to !== whId)) && (kind !== 'loss' || !!reason);
  const T = {
    issue: { title: 'Xuất cấp', icon: ArrowUpFromLine, btn: 'Xuất kho' },
    transfer: { title: 'Chuyển kho', icon: ArrowRightLeft, btn: 'Gửi hàng' },
    loss: { title: 'Xuất hủy', icon: Trash2, btn: 'Gửi duyệt' },
  }[kind];

  const changeWh = (id: string) => { setWhId(id); setLines([]); };
  const txItems = () => lines.map(l => ({ itemId: l.row.itemId, quantity: qtyOf(l), price: 0, ...(l.spec ? { specification: l.spec } : {}) }));

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      if (kind === 'issue') {
        const src = buildMaterialIssueRecipientSource(recipient!.selection);
        const w = allWarehouses.find(x => x.id === whId);
        const r = await materialIssueService.issueNow({
          sourceWarehouseId: whId, projectId: w?.projectId || null, constructionSiteId: w?.constructionSiteId || null, ...src,
          note: note.trim() || null, transactionDate: dateInputToTransactionTimestamp(date) || null,
          lines: lines.map(l => ({ itemId: l.row.itemId, quantity: qtyOf(l), unit: l.row.unit, specification: l.spec || null })),
        });
        await refreshWmsRecords({ transactionIds: [r.transactionId], itemIds: lines.map(l => l.row.itemId) });
        onDone({ transactionId: r.transactionId, toast: [`Đã xuất ${r.code || r.issueNo}`, src.recipientName] });
        return;
      }
      const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tx: Transaction = {
        id, type: kind === 'transfer' ? TransactionType.TRANSFER : TransactionType.LIQUIDATION,
        date: dateInputToTransactionTimestamp(date) || new Date().toISOString(), items: txItems(), requesterId: user.id, status: TransactionStatus.PENDING,
        note: kind === 'loss' ? [reason, note.trim()].filter(Boolean).join(' — ') : note.trim(),
        businessEventType: kind === 'transfer' ? 'warehouse_transfer' : 'warehouse_loss',
        businessEventReason: kind === 'loss' ? reason : undefined,
        sourceWarehouseId: whId, targetWarehouseId: kind === 'transfer' ? to : undefined,
      };
      await addTransaction(tx);
      if (kind === 'transfer') {
        const { data } = await supabase.from('transactions').select('row_version').eq('id', id).maybeSingle();
        await wmsTransferService.dispatch({ transactionId: id, expectedVersion: Number(data?.row_version || 1), idempotencyKey: `kho-send-${id}` });
        await refreshWmsRecords({ transactionIds: [id], itemIds: lines.map(l => l.row.itemId) });
        onDone({ transactionId: id, toast: [`Đã gửi sang ${warehouses.find(w => w.id === to)?.name || 'kho nhận'}`] });
      } else {
        onDone({ transactionId: id, toast: ['Đã gửi duyệt xuất hủy', reason] });
      }
    } catch (e) {
      toast.error(kind === 'issue' ? 'Chưa xuất được' : kind === 'transfer' ? 'Chưa gửi được' : 'Chưa gửi duyệt được', catalogErrorMessage(e));
    } finally { setBusy(false); }
  };

  return <Panel onBack={onBack} head={<Head wh={wh?.name} icon={T.icon} title={T.title} />}
    foot={<button type="button" disabled={!ok || busy} onClick={() => void submit()} className={kind === 'loss' ? `${secondaryBtn} border-rose-300 text-rose-700` : primaryBtn}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : <T.icon size={15} />}{T.btn}</button>}>
    {!seed && (!initialWh || operable.length > 1) && <WhSelect value={whId} options={operable} onChange={changeWh} label={kind === 'transfer' ? 'Kho gửi' : 'Kho xuất'} />}
    {kind === 'issue' && <label className="block text-sm font-semibold">Người nhận<RecipientPick value={recipient} onChange={setRecipient} /></label>}
    {kind === 'transfer' && <WhSelect value={to} options={allWarehouses.filter(w => !w.isArchived && w.id !== whId).map(w => ({ id: w.id, name: w.name, type: w.type, canOperate: false }))}
      onChange={setTo} label="Kho nhận" />}
    {kind === 'loss' && <Section title="Lý do"><div className="flex flex-wrap gap-1.5">{LOSS_REASONS.map(r =>
      <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={chip(reason === r, 'rose')}>{r}</button>)}</div></Section>}
    {whId && <ItemPick rows={whRows} exclude={lines.map(l => l.row.itemId)} onPick={r => setLines(ls => [...ls, { row: r, qty: '', spec: '' }])} />}
    <FormLines whId={whId} lines={lines} setLines={setLines} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-semibold">Ngày chứng từ<input type="date" value={date} max={todayInput()} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-semibold">Ghi chú<input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder={kind === 'issue' ? 'Hạng mục, tổ…' : ''} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
  </Panel>;
};

export const CountStartForm: React.FC<{ whId: string; warehouses: Wh[]; rows: StockRow[]; seed?: StockRow; onStarted: (d: StockCountDetail) => void; onBack: () => void }> =
  ({ whId: initialWh, warehouses, rows, seed, onStarted, onBack }) => {
  const toast = useToast();
  const operable = warehouses.filter(w => w.canOperate);
  const [whId, setWhId] = useState(seed?.warehouseId || initialWh || (operable.length === 1 ? operable[0].id : ''));
  const [scope, setScope] = useState<'one' | 'group' | 'all'>(seed ? 'one' : 'group');
  const whRows = rows.filter(r => r.warehouseId === whId && r.qty !== 0);
  const groups = [...new Set(whRows.map(r => r.category || '—'))].sort((a, b) => a.localeCompare(b, 'vi'));
  const [group, setGroup] = useState('');
  const [reason, setReason] = useState(seed ? COUNT_REASONS[0] : COUNT_REASONS[1]);
  const [blind, setBlind] = useState(true);
  const [busy, setBusy] = useState(false);
  const g = group || groups[0] || '';
  const ids = scope === 'one' && seed ? [seed.itemId] : scope === 'group' ? whRows.filter(r => (r.category || '—') === g).map(r => r.itemId) : undefined;
  const n = ids ? ids.length : whRows.length;
  const start = async () => {
    setBusy(true);
    try { onStarted(await stockCountService.start({ warehouseId: whId, reason: scope === 'group' ? `${reason} — ${g}` : reason, blind, ...(ids ? { itemIds: ids } : {}) })); }
    catch (e) { toast.error('Chưa lập được phiên đếm', (e as Error).message); }
    finally { setBusy(false); }
  };
  return <Panel onBack={onBack} head={<Head wh={warehouses.find(w => w.id === whId)?.name} icon={ClipboardCheck} title="Kiểm đếm" />}
    foot={<button type="button" disabled={!whId || n === 0 || busy} onClick={() => void start()} className={primaryBtn}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}Bắt đầu đếm {n} mã</button>}>
    {(!initialWh || operable.length > 1) && !seed && <WhSelect value={whId} options={operable} onChange={id => { setWhId(id); setGroup(''); }} />}
    <Section title="Phạm vi"><div className="grid gap-2 sm:grid-cols-3">{([['one', '1 mã', seed?.name || 'chọn từ Tồn kho'], ['group', 'Nhóm vật tư', `${groups.length} nhóm`], ['all', 'Cả kho', `${whRows.length} mã`]] as const).map(([k, t, h]) =>
      <button key={k} type="button" disabled={k === 'one' && !seed} onClick={() => setScope(k)} aria-pressed={scope === k}
        className={`rounded-xl border px-3 py-2 text-left text-sm disabled:opacity-50 ${scope === k ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
        <b>{t}</b><span className="block truncate text-[12px] text-muted-foreground">{h}</span></button>)}</div></Section>
    {scope === 'group' && <label className="block text-sm font-semibold">Nhóm<select value={g} onChange={e => setGroup(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
      {groups.map(x => <option key={x} value={x}>{x} ({whRows.filter(r => (r.category || '—') === x).length})</option>)}</select></label>}
    <Section title="Lý do"><div className="flex flex-wrap gap-1.5">{COUNT_REASONS.map(r =>
      <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={chip(reason === r)}>{r}</button>)}</div></Section>
    <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} className="h-4 w-4 accent-teal-700" />
      Đếm mù <span className="font-normal text-muted-foreground" title="Người đếm không thấy số sổ">(ẩn số sổ)</span></label>
  </Panel>;
};
