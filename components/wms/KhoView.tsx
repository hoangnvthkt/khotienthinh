import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlarmClock, ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Boxes, Camera, ClipboardCheck, FileSpreadsheet, FileText, MoreHorizontal, Printer, RefreshCw, Search, ShieldCheck, Trash2, Truck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { Role, TransactionStatus, TransactionType, type Transaction } from '../../types';
import TransactionDetailModal from '../TransactionDetailModal';
import { Badge, StateBox, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney } from '../finance/financeUi';
import { catalogErrorMessage, foldVi, wmsCatalogService, INVENTORY_MODE_LABELS, type StockOverview, type StockRow } from '../../lib/wmsCatalogService';
import { stockCountService, STOCK_COUNT_STATUS_LABEL, type StockCountDetail, type StockCountList, type StockCountSummary } from '../../lib/stockCountService';
import { canApproveWmsTransaction, canReceiveWmsTransaction, canViewWmsTransaction } from '../../lib/wmsPermissions';
import { getTransactionNextAction } from '../../lib/erpWorkflow';
import { loadXlsx } from '../../lib/loadXlsx';
import { wmsTransactionListService } from '../../lib/wmsTransactionListService';
import { printWmsVoucher } from '../../lib/wmsVoucherPrint';
import { useSearchParamPrefill } from '../../hooks/useSearchParamPrefill';
import { BAD, EmptyPanel, GREY, OK, Split, TEAL, Tile, WARN, dateVi, daysBetween, fmtQty } from './wmsUi';
import { StockItemPanel, flagsOf, needsCheck, rowKey, type StockAction } from './WmsStockView';
import { CountPanel } from './StockCountView';
import { CountStartForm, MoveForm } from './KhoForms';
import { wmsStepLabel } from './WmsWorkspace';
import { CaptureButton, KhoCapture } from './KhoCapture';
import { wmsDeliveryCaptureService, type DeliveryCapture } from '../../lib/wmsDeliveryCaptureService';

// V2 Kho một màn: Việc cần làm · Tồn kho · Sổ phiếu bên trái; nhận hàng, xuất, chuyển, hủy, kiểm đếm mở ngay cột phải.
// Hàng vào kho chỉ qua đợt giao Mua hàng, hàng chuyển đến, trả lại từ công trình hoặc kiểm đếm (đã bỏ phiếu nhập tự do).
// Đợt 1 (12/10): Chụp phiếu giao NCC ở cổng kho → AI điền / nhập tay → chọn đơn → nhận theo xe (KhoCapture).

type Mode = 'todo' | 'stock' | 'book';
type TileKey = 'receive' | 'approve' | 'stock' | 'check';
type Sel = { kind: 'tx'; id: string; tx?: Transaction } | { kind: 'item'; key: string } | { kind: 'count'; id: string }
  | { kind: 'capture'; key: string; id?: string; files?: File[] }
  | { kind: 'issue' | 'transfer' | 'loss' | 'newCount'; itemKey?: string } | null;

const ageDays = (iso: string, today: string) => daysBetween(iso, today);
const isReceive = (tx: Transaction) => tx.type === TransactionType.IMPORT || (tx.type === TransactionType.TRANSFER && tx.status === TransactionStatus.APPROVED);
const TX_ICON: Record<string, React.ElementType> = { IMPORT: ArrowDownToLine, TRANSFER: ArrowRightLeft, LIQUIDATION: Trash2 };
const TX_KIND: Record<string, string> = { IMPORT: 'NK', EXPORT: 'XK', TRANSFER: 'CK', LIQUIDATION: 'Hủy', ADJUSTMENT: 'ĐC' };

export const KhoView: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const toast = useToast();
  const { user, users, items, warehouses: allWarehouses, transactions } = useApp();
  const [data, setData] = useState<StockOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [counts, setCounts] = useState<StockCountList | null>(null);
  const [countDetail, setCountDetail] = useState<StockCountDetail | null>(null);
  const [wh, setWh] = useState('');
  const [mode, setMode] = useState<Mode>('todo');
  const [tile, setTile] = useState<TileKey | null>(null);
  const [q, setQ] = useState('');
  useSearchParamPrefill(v => { setQ(v); setMode('stock'); });
  const [sel, setSel] = useState<Sel>(null);

  const loadStock = useCallback(async () => {
    setState(s => s === 'ready' ? s : 'loading');
    try { setData(await wmsCatalogService.stock()); setState('ready'); }
    catch (e) { setMessage(catalogErrorMessage(e, 'Chưa tải được tồn kho.')); setState('error'); }
  }, []);
  const loadCounts = useCallback(() => stockCountService.list().then(setCounts).catch(() => setCounts(c => c)), []);
  const [caps, setCaps] = useState<DeliveryCapture[]>([]);
  const loadCaps = useCallback(() => wmsDeliveryCaptureService.list().then(setCaps).catch(() => setCaps(c => c)), []);
  useEffect(() => { void loadStock(); void loadCounts(); void loadCaps(); }, [loadStock, loadCounts, loadCaps]);
  const reload = () => { void loadStock(); void loadCounts(); void loadCaps(); };
  const onCapSaved = useCallback((c: DeliveryCapture) => {
    setCaps(list => [c, ...list.filter(x => x.id !== c.id)]);
    setSel(s => s?.kind === 'capture' && (s.id === c.id || !s.id) ? { ...s, id: c.id } : s);
  }, []);

  // Mở đúng phiếu từ link (?tx= hoặc state.transactionId).
  useEffect(() => {
    const id = (location.state as { transactionId?: string } | null)?.transactionId || new URLSearchParams(location.search).get('tx');
    if (!id) return;
    setSel(s => s?.kind === 'tx' && s.id === id ? s : { kind: 'tx', id });
  }, [location.state, location.search]);

  // Phiếu chưa có trong dữ liệu đã tải (vừa lập / mở từ link): đọc thẳng.
  const missingTxId = sel?.kind === 'tx' && !sel.tx && !transactions.some(t => t.id === sel.id) ? sel.id : null;
  useEffect(() => {
    if (!missingTxId) return;
    let live = true;
    const timer = setTimeout(() => {
      wmsTransactionListService.getById(missingTxId)
        .then(tx => { if (live) setSel(s => s?.kind === 'tx' && s.id === missingTxId ? (tx ? { kind: 'tx', id: tx.id, tx } : null) : s); })
        .catch(() => { if (live) setSel(null); });
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [missingTxId]);

  // Một phiên đếm đang mở: tải chi tiết.
  const countId = sel?.kind === 'count' ? sel.id : null;
  useEffect(() => {
    if (!countId) { setCountDetail(null); return; }
    let live = true;
    setCountDetail(d => d?.id === countId ? d : null);
    stockCountService.get(countId).then(d => { if (live) setCountDetail(d); }).catch(e => toast.error('Không mở được phiên đếm', (e as Error).message));
    return () => { live = false; };
  }, [countId, toast]);

  const today = data?.today || new Date().toISOString().slice(0, 10);
  const whs = data?.warehouses || [];
  const whName = (id?: string | null) => whs.find(w => w.id === id)?.name || allWarehouses.find(w => w.id === id)?.name || '—';
  const inWh = (...ids: Array<string | null | undefined>) => !wh || ids.includes(wh);
  const fq = foldVi(q.trim());
  const match = (s: string) => !fq || foldVi(s).includes(fq);
  const itemName = (id: string) => items.find(i => i.id === id)?.name || '';
  const txLabel = (tx: Transaction) => tx.note || tx.businessPartnerNameSnapshot || `${TX_KIND[tx.type] || 'Phiếu'} ${tx.id.slice(-6)}`;
  const txText = (tx: Transaction) => [tx.code, tx.note, tx.businessPartnerNameSnapshot, whName(tx.sourceWarehouseId), whName(tx.targetWarehouseId), ...tx.items.map(l => l.itemNameSnapshot || itemName(l.itemId))].join(' ');

  // Phiếu cần xử lý: giống màn Phiếu kho cũ — chờ duyệt (người có quyền) + chờ nhận (kho đích).
  const isAdmin = user.role === Role.ADMIN;
  const openTx = useMemo(() => transactions.filter(t =>
    (t.status === TransactionStatus.PENDING && (isAdmin || canApproveWmsTransaction(user, t) || t.requesterId === user.id))
    || (t.status === TransactionStatus.APPROVED && (isAdmin || canReceiveWmsTransaction(user, t)))), [transactions, user, isAdmin]);
  const doneTx = useMemo(() => transactions.filter(t => (t.status === TransactionStatus.COMPLETED || t.status === TransactionStatus.CANCELLED)
    && (isAdmin || canViewWmsTransaction(user, t))).sort((a, b) => b.date.localeCompare(a.date)), [transactions, user, isAdmin]);
  const openCounts = (counts?.counts || []).filter(c => c.status === 'counting' || c.status === 'submitted');
  const openCaps = caps.filter(c => c.status === 'new' || c.status === 'read');

  const myOpen = openTx.filter(t => inWh(t.targetWarehouseId, t.sourceWarehouseId));
  const myCounts = openCounts.filter(c => inWh(c.warehouseId));
  const myCaps = openCaps.filter(c => inWh(c.warehouseId));
  const receive = myOpen.filter(isReceive);
  const late = receive.filter(t => ageDays(t.date, today) >= 3);
  const approve = [...myOpen.filter(t => !isReceive(t)), ...myCounts.filter(c => c.status === 'submitted')];
  const stock = (data?.rows || []).filter(r => inWh(r.warehouseId) && r.qty !== 0);
  const pos = stock.filter(r => r.qty > 0);
  const check = stock.filter(r => needsCheck(r, today));

  const todoTx = myOpen.filter(t => (tile !== 'receive' || isReceive(t)) && (tile !== 'approve' || !isReceive(t)) && match(txText(t)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const todoCaps = tile === 'approve' ? [] : myCaps.filter(c => match(`${c.supplierName || ''} ${c.docNo || ''} ${c.truckNo || ''} ${c.lines.map(l => l.name).join(' ')}`));
  const todoCounts = myCounts.filter(c => (tile !== 'receive') && (tile !== 'approve' || c.status === 'submitted') && match(`${c.countNo} ${c.reason} ${c.warehouseName}`));
  const listStock = (tile === 'check' ? check : stock).filter(r => match(`${r.name} ${r.sku || ''} ${r.category || ''}`)).sort((a, b) => b.value - a.value);
  const listBook = doneTx.filter(t => inWh(t.targetWarehouseId, t.sourceWarehouseId) && match(txText(t)));

  const rowOf = (key?: string) => key ? (data?.rows || []).find(r => rowKey(r) === key) : undefined;
  const pick = (t: TileKey) => {
    const next = tile === t ? null : t;
    setTile(next);
    setMode(t === 'stock' || t === 'check' ? 'stock' : 'todo');
  };
  const onTxDone = (transactionId: string, msg: [string, string?]) => {
    toast.success(msg[0], msg[1]);
    reload();
    setSel({ kind: 'tx', id: transactionId });
  };
  const exportExcel = async () => {
    try {
      const XLSX = await loadXlsx();
      const sheet = XLSX.utils.json_to_sheet(listStock.map(r => ({ 'Kho': whName(r.warehouseId), 'Mã': r.sku, 'Vật tư': r.name, 'ĐVT': r.unit, 'Nhóm': r.category,
        'Tồn': r.qty, 'Giá trị (tạm tính)': r.value, 'Đang về': r.incoming, 'Biến động cuối': dateVi(r.lastMove), 'Cách quản lý': INVENTORY_MODE_LABELS[r.inventoryMode] })));
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Tồn kho');
      XLSX.writeFile(book, `ton-kho-${today}.xlsx`);
    } catch (e) { toast.error('Chưa xuất được Excel', catalogErrorMessage(e)); }
  };

  if (state === 'loading' && !data) return <StateBox kind="loading" title="Đang tải kho…" />;
  if (state === 'error' && !data) return <StateBox kind="error" title="Chưa tải được kho" message={message} onRetry={() => void loadStock()} />;
  if (!data) return null;
  if (whs.length === 0) return <StateBox kind="denied" title="Bạn chưa được xem kho nào" message="Nhờ Admin cấp quyền kho." />;
  const canOperate = whs.some(w => w.canOperate && (!wh || w.id === wh));

  const tiles: Array<{ k: TileKey; label: string; icon: React.ElementType; value: React.ReactNode; hint: string; tone: string; ic: string; blink?: boolean }> = [
    { k: 'receive', label: 'Hàng về chờ nhận', icon: Truck, value: receive.length + myCaps.length, hint: [myCaps.length ? `${myCaps.length} phiếu chụp` : '', late.length ? `${late.length} treo ≥ 3 ngày` : myCaps.length ? '' : 'không treo'].filter(Boolean).join(' · '), tone: 'text-teal-800 dark:text-teal-200', ic: 'bg-teal-600', blink: late.length > 0 },
    { k: 'approve', label: 'Chờ duyệt', icon: ShieldCheck, value: approve.length, hint: 'hủy · kiểm đếm · phiếu cũ', tone: 'text-amber-700 dark:text-amber-300', ic: 'bg-amber-500' },
    { k: 'stock', label: 'Đang có tồn', icon: Boxes, value: pos.length, hint: `${shortMoney(pos.reduce((s, r) => s + Math.max(0, r.value), 0))} tạm tính`, tone: 'text-leaf-700 dark:text-leaf-300', ic: 'bg-leaf-600' },
    { k: 'check', label: 'Cần kiểm tra', icon: AlarmClock, value: check.length, hint: 'tồn ảo · giá lệch', tone: 'text-rose-700 dark:text-rose-300', ic: 'bg-rose-500' },
  ];

  const selRow = sel?.kind === 'item' ? rowOf(sel.key) : undefined;
  const formWh = (itemKey?: string) => rowOf(itemKey)?.warehouseId || (whs.find(w => w.id === wh)?.canOperate ? wh : '');
  const detail = (() => {
    if (!sel) return <EmptyPanel icon={Boxes} title={wh ? whName(wh) : 'Mọi kho'} text={<>{receive.length} đợt hàng chờ nhận{myCaps.length > 0 && ` · ${myCaps.length} phiếu chụp`} · {pos.length} mã có tồn</>} />;
    if (sel.kind === 'tx') {
      const tx = sel.tx || transactions.find(t => t.id === sel.id);
      if (!tx) return <StateBox kind="loading" title="Đang mở phiếu…" />;
      const print = async (mode: 'print' | 'pdf') => {
        const ok = await printWmsVoucher(tx, { items, users, warehouses: allWarehouses, supplyName: tx.businessPartnerNameSnapshot }, mode);
        if (!ok) toast.error('Không mở được cửa sổ in', 'Trình duyệt đang chặn cửa sổ bật lên.');
        else if (mode === 'pdf') toast.info('Lưu PDF', 'Chọn "Save as PDF" trong hộp thoại in.');
      };
      // Phiếu nhận thiếu đã ghi sổ (kể cả sau khi sửa số nhận): nút "NCC giao tiếp" nằm ở khối Tiến độ đơn trong phiếu.
      return <TransactionDetailModal key={tx.id} variant="panel" isOpen transaction={tx}
        footerExtra={<>
          <button type="button" onClick={() => void print('pdf')} className={secondaryBtn}><FileText size={15} />PDF</button>
          <button type="button" onClick={() => void print('print')} className={secondaryBtn}><Printer size={15} />In phiếu</button></>}
        onClose={() => setSel(null)} onUpdated={next => { setSel({ kind: 'tx', id: next.id, tx: next }); void loadStock(); }} />;
    }
    if (sel.kind === 'capture') return <KhoCapture key={sel.key} initial={sel.id ? caps.find(c => c.id === sel.id) : undefined} files={sel.files}
      warehouseId={wh} warehouses={whs} onBack={() => setSel(null)} onSaved={onCapSaved}
      onOpenTx={id => { reload(); setSel({ kind: 'tx', id }); }} />;
    if (sel.kind === 'item') {
      if (!selRow) return <EmptyPanel icon={Boxes} title="Không còn dòng tồn này" text="Tải lại để xem số mới." />;
      return <StockItemPanel key={sel.key} row={selRow} warehouses={whs} today={today} onBack={() => setSel(null)}
        onOpenRow={key => setSel({ kind: 'item', key })} onAction={(k: StockAction) => setSel({ kind: k === 'count' ? 'newCount' : k, itemKey: sel.key })} />;
    }
    if (sel.kind === 'count') return countDetail
      ? <div className="min-w-0"><button type="button" onClick={() => setSel(null)} className="mb-2 text-sm font-semibold text-teal-700 hover:underline lg:hidden dark:text-teal-300">← Danh sách</button>
        <CountPanel key={`${countDetail.id}-${countDetail.revision}`} detail={countDetail} items={items}
          onChange={d => { setCountDetail(d); void loadCounts(); if (d.status === 'posted') void loadStock(); }} onStale={() => { setSel(null); void loadCounts(); }} /></div>
      : <StateBox kind="loading" title="Đang mở phiên đếm…" />;
    if (sel.kind === 'newCount') return <CountStartForm key={`count-${sel.itemKey || wh}`} whId={formWh(sel.itemKey)} warehouses={whs} rows={data.rows} seed={rowOf(sel.itemKey)}
      onBack={() => setSel(null)} onStarted={d => { toast.success(`Đã lập ${d.countNo}`, `${d.lines.length} mã`); setCountDetail(d); setSel({ kind: 'count', id: d.id }); void loadCounts(); }} />;
    return <MoveForm key={`${sel.kind}-${sel.itemKey || wh}`} kind={sel.kind} whId={formWh(sel.itemKey)} warehouses={whs} rows={data.rows} seed={rowOf(sel.itemKey)}
      onBack={() => setSel(null)} onDone={r => onTxDone(r.transactionId, r.toast)} />;
  })();

  const seg = (k: Mode, label: string, n: number) => <button key={k} type="button" onClick={() => { setMode(k); setTile(null); }} aria-pressed={mode === k}
    className={`flex-1 whitespace-nowrap rounded-lg px-1 py-1.5 text-[13px] font-semibold sm:px-2 sm:text-sm ${mode === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
    {label} <span className="tabular-nums opacity-80">{n}</span></button>;
  const active = (on: boolean) => on ? 'bg-teal-50/70 dark:bg-teal-950/30' : 'hover:bg-muted/40';
  const empty = (t: string) => <li className="px-4 py-10 text-center text-sm text-muted-foreground">{t}</li>;

  const txRow = (t: Transaction, done: boolean) => {
    const Icon = TX_ICON[t.type] || ArrowUpFromLine;
    const age = ageDays(t.date, today);
    const actionable = !done && getTransactionNextAction(t, user).isActionable;
    const lines = t.items.map(l => l.itemNameSnapshot || itemName(l.itemId)).filter(Boolean);
    return <li key={t.id}><button type="button" onClick={() => setSel({ kind: 'tx', id: t.id })}
      className={`flex w-full items-start gap-2 border-l-4 px-3 py-2.5 text-left ${active(sel?.kind === 'tx' && sel.id === t.id)} ${actionable ? 'border-l-leaf-500' : 'border-l-transparent'}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${t.type === TransactionType.LIQUIDATION ? 'text-rose-600' : 'text-teal-600'}`} />
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 ${ENT}`}>{done && t.code ? t.code : txLabel(t)}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{done ? txLabel(t) : wmsStepLabel(t)}{!wh && ` · ${whName(isReceive(t) ? t.targetWarehouseId : t.sourceWarehouseId)}`}</span>
        <span className="block truncate text-[12px]">{lines.slice(0, 2).join(', ')}{lines.length > 2 ? ` +${lines.length - 2}` : ''}</span></span>
      {done ? <span className="flex flex-col items-end gap-1"><Badge className={t.status === TransactionStatus.CANCELLED ? GREY : t.type === TransactionType.IMPORT ? OK : TEAL}>
        {t.status === TransactionStatus.CANCELLED ? 'Hủy' : TX_KIND[t.type] || t.type}</Badge><span className="text-[12px] text-muted-foreground">{dateVi(t.date)}</span></span>
        : <Badge className={age >= 3 ? BAD : TEAL}>{age >= 3 ? `treo ${age} ngày` : dateVi(t.date)}</Badge>}
    </button></li>;
  };
  const capRow = (c: DeliveryCapture) => { const age = ageDays(c.createdAt, today); const names = c.lines.map(l => l.name).filter(Boolean);
    return <li key={c.id}><button type="button" onClick={() => setSel({ kind: 'capture', key: c.id, id: c.id })}
      className={`flex w-full items-start gap-2 border-l-4 border-l-leaf-500 px-3 py-2.5 text-left ${active(sel?.kind === 'capture' && sel.id === c.id)}`}>
      <Camera size={16} className="mt-0.5 shrink-0 text-teal-600" />
      <span className="min-w-0 flex-1"><span className={`line-clamp-2 ${ENT}`}>{c.supplierName || 'Phiếu giao chụp'}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{[c.docNo && `Số ${c.docNo}`, c.truckNo, !wh && whName(c.warehouseId)].filter(Boolean).join(' · ') || dateVi(c.createdAt)}</span>
        <span className="block truncate text-[12px]">{names.length ? <>{names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}</> : <span className="text-muted-foreground">Chưa nhập hàng</span>}</span></span>
      <Badge className={age >= 3 ? BAD : TEAL}>{age >= 3 ? `treo ${age} ngày` : 'Phiếu chụp'}</Badge>
    </button></li>; };
  const countRow = (c: StockCountSummary) => <li key={c.id}><button type="button" onClick={() => setSel({ kind: 'count', id: c.id })}
    className={`flex w-full items-start gap-2 px-3 py-2.5 text-left ${active(sel?.kind === 'count' && sel.id === c.id)}`}>
    <ClipboardCheck size={16} className="mt-0.5 shrink-0 text-teal-600" />
    <span className="min-w-0 flex-1"><span className={ENT}>{c.countNo}</span><span className="block truncate text-[12px] text-muted-foreground">{c.reason}{!wh && ` · ${c.warehouseName}`}</span>
      <span className="block text-[12px]">đã đếm <b className="tabular-nums">{c.countedCount}/{c.lineCount}</b></span></span>
    <Badge className={c.status === 'submitted' ? WARN : TEAL}>{c.rejected && c.status === 'counting' ? 'Đếm lại' : STOCK_COUNT_STATUS_LABEL[c.status]}</Badge></button></li>;
  const stockRow = (r: StockRow) => { const fl = flagsOf(r, today); const k = rowKey(r);
    return <li key={k}><button type="button" onClick={() => setSel({ kind: 'item', key: k })} className={`flex w-full items-start gap-2 px-3 py-2 text-left ${active(sel?.kind === 'item' && sel.key === k)}`}>
      <span className="min-w-0 flex-1"><span className={r.orphan ? 'font-semibold text-rose-700' : ENT}>{r.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{r.sku || '—'}{!wh && ` · ${whName(r.warehouseId)}`}{r.category && ` · ${r.category}`}</span>
        {fl.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{fl.slice(0, 2).map(f => <span key={f.k} title={f.hint}><Badge className={f.cls}>{f.label}</Badge></span>)}</span>}</span>
      <span className="text-right"><b className={NUM}>{fmtQty(r.qty)}</b> <span className="text-[12px] text-muted-foreground">{r.unit}</span>
        {r.incoming > 0 && <span className="block text-[12px] text-teal-700 dark:text-teal-300">+{fmtQty(r.incoming)} đang về</span>}
        <span className="block text-[12px]">{r.value < -1 ? <span className="font-semibold text-rose-700">{shortMoney(r.value)}</span>
          : r.qty > 0 && r.value <= 0 ? <span className="font-semibold text-amber-700 dark:text-amber-300">chưa có giá</span>
          : <span className="text-muted-foreground" title={`${money(r.value)} đ`}>{shortMoney(r.value)}</span>}</span></span></button></li>; };

  const list = <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="space-y-2 border-b border-border p-2">
      <div className="flex gap-1 rounded-xl bg-muted/60 p-1" role="group" aria-label="Xem">
        {seg('todo', 'Việc cần làm', myOpen.length + myCounts.length + myCaps.length)}{seg('stock', 'Tồn kho', stock.length)}{seg('book', 'Sổ phiếu', listBook.length)}</div>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2"><Search size={15} className="text-muted-foreground" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" placeholder={mode === 'stock' ? 'Tìm vật tư, mã, nhóm' : mode === 'todo' ? 'Tìm PO, NCC, vật tư' : 'Tìm số phiếu, nội dung'}
            className="w-full bg-transparent py-1.5 text-sm outline-none" /></label>
        {mode === 'stock' && <button type="button" onClick={() => void exportExcel()} disabled={!listStock.length} className={secondaryBtn} title="Xuất Excel"><FileSpreadsheet size={15} /></button>}
      </div>
    </div>
    <ul className="max-h-[68vh] divide-y divide-border overflow-y-auto">
      {mode === 'todo' && (todoCaps.length + todoTx.length + todoCounts.length === 0 ? empty(tile === 'receive' ? 'Không có hàng chờ nhận' : 'Không có việc cần làm')
        : <>{todoCaps.map(capRow)}{todoTx.map(t => txRow(t, false))}{todoCounts.map(countRow)}</>)}
      {mode === 'stock' && (listStock.length === 0 ? empty('Không có vật tư khớp') : <>{listStock.slice(0, 300).map(stockRow)}
        {listStock.length > 300 && <li className="px-3 py-2 text-center text-[12px] text-muted-foreground">+{listStock.length - 300} dòng — gõ để tìm</li>}</>)}
      {mode === 'book' && (listBook.length === 0 ? empty('Chưa có phiếu') : <>{listBook.slice(0, 200).map(t => txRow(t, true))}
        {listBook.length > 200 && <li className="px-3 py-2 text-center text-[12px] text-muted-foreground">+{listBook.length - 200} phiếu — gõ để tìm</li>}</>)}
    </ul>
  </div>;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="scrollbar-hide flex min-w-0 flex-1 gap-1.5 overflow-x-auto" role="group" aria-label="Kho">
        {[{ id: '', name: 'Mọi kho' }, ...whs].map(w => { const n = w.id ? openTx.filter(t => isReceive(t) && t.targetWarehouseId === w.id).length + openCaps.filter(c => c.warehouseId === w.id).length : 0;
          return <button key={w.id || 'all'} type="button" onClick={() => { setWh(w.id); setSel(null); }} aria-pressed={wh === w.id}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${wh === w.id ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card hover:border-teal-300'}`}>
            {w.name}{n > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${wh === w.id ? 'bg-white/20' : 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100'}`}>{n}</span>}</button>; })}
      </div>
      {canOperate && <div className="relative">
        <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} className={`${secondaryBtn} bg-card`} aria-label="Việc khác"><MoreHorizontal size={15} /></button>
        {more && <div className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-lg" role="menu" onMouseLeave={() => setMore(false)}>
          {([['Trả lại · quyết toán xuất cấp', 'MATERIAL_ISSUE'], ['Đối chiếu nhận hàng', 'RECONCILE']] as const).map(([label, tab]) =>
            <button key={tab} type="button" role="menuitem" onClick={() => navigate('/operations', { state: { tab } })} className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted">{label}</button>)}
        </div>}
      </div>}
      <button type="button" onClick={reload} disabled={state === 'loading'} className={`${secondaryBtn} bg-card`} aria-label="Tải lại"><RefreshCw size={15} className={state === 'loading' ? 'animate-spin' : ''} /></button>
    </div>
    {canOperate && <div className={`${sel ? 'hidden lg:flex' : 'flex'} flex-col gap-1.5 sm:flex-row sm:justify-end sm:gap-2`}>
      <CaptureButton onFiles={files => setSel({ kind: 'capture', key: `new-${Date.now()}`, files })} className={`${primaryBtn} !py-2.5 sm:order-last sm:!py-2`} />
      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
        {([['newCount', 'Kiểm đếm', ClipboardCheck], ['loss', 'Xuất hủy', Trash2], ['transfer', 'Chuyển kho', ArrowRightLeft], ['issue', 'Xuất cấp', ArrowUpFromLine]] as const).map(([k, label, Icon]) =>
          <button key={k} type="button" onClick={() => setSel({ kind: k })}
            className={`${secondaryBtn} bg-card flex-col !gap-0.5 !px-1 !py-1.5 text-[12px] sm:flex-row sm:!gap-1.5 sm:!px-3 sm:!py-2 sm:text-sm`}><Icon size={15} />{label}</button>)}
      </div>
    </div>}
    <div className={`${sel ? 'hidden lg:flex' : 'flex'} scrollbar-hide gap-2 overflow-x-auto pb-1`}>{tiles.map(t => <Tile key={t.k} active={tile === t.k} onClick={() => pick(t.k)}
      icon={t.icon} label={t.label} value={t.value} hint={t.hint} tone={t.tone} ic={t.ic} blink={t.blink && tile !== t.k} />)}</div>
    <Split open={!!sel} selKey={sel ? `${sel.kind}:${sel.kind === 'capture' ? sel.key : 'id' in sel ? sel.id : 'key' in sel ? sel.key : sel.itemKey || ''}` : null} list={list} detail={detail} />
  </div>;
};

export default KhoView;
