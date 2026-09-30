import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock, ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, ChevronDown, Inbox, Plus, Search, Trash2, Truck, UserCheck, X,
} from 'lucide-react';
import { TransactionStatus, TransactionType, type InventoryItem, type Transaction, type User, type Warehouse } from '../../types';
import { getTransactionNextAction } from '../../lib/erpWorkflow';

// Nhập xuất kho — một màn hình: danh sách phiếu cần xử lý bên trái, chi tiết + thao tác ngay bên phải.

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const money = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(n));
const ageDays = (tx: Transaction) => {
  const d = new Date(tx.date);
  const now = new Date();
  return Number.isNaN(d.getTime()) ? 0 : Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
};

type Kind = 'import' | 'export' | 'transfer';
const kindOf = (tx: Transaction): Kind => tx.type === TransactionType.IMPORT ? 'import' : tx.type === TransactionType.TRANSFER ? 'transfer' : 'export';
const KIND_STYLE: Record<Kind, { label: string; chip: string; icon: React.ComponentType<{ size?: number }> }> = {
  import: { label: 'Nhập', chip: 'bg-mint-50 text-mint-700 border-mint-200 dark:bg-mint-900/30 dark:text-mint-200 dark:border-mint-800', icon: ArrowDownToLine },
  export: { label: 'Xuất', chip: 'bg-leaf-50 text-leaf-700 border-leaf-200 dark:bg-leaf-900/30 dark:text-leaf-200 dark:border-leaf-800', icon: ArrowUpFromLine },
  transfer: { label: 'Chuyển', chip: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800', icon: ArrowRightLeft },
};

/** Bước hiện tại của phiếu, bằng lời người dùng hiểu. */
export const wmsStepLabel = (tx: Transaction) => {
  const po = tx.sourceType === 'po_delivery_batch';
  if (tx.status === TransactionStatus.COMPLETED) return 'Hoàn tất';
  if (tx.status === TransactionStatus.CANCELLED) return 'Đã hủy';
  if (tx.status === TransactionStatus.APPROVED) {
    if (tx.type === TransactionType.TRANSFER) return 'Đang chuyển — chờ kho nhận';
    return po ? 'Đã kiểm, chưa nhập kho' : 'Đã duyệt, chờ nhập kho';
  }
  if (tx.type === TransactionType.IMPORT) return po ? 'Chờ nhận hàng NCC' : 'Chờ duyệt nhập';
  if (tx.type === TransactionType.TRANSFER) return 'Chờ duyệt chuyển';
  if (tx.type === TransactionType.LIQUIDATION) return 'Chờ duyệt xuất hủy';
  return tx.items.some(item => !!item.materialIssueOrderId) ? 'Chờ kho xuất cấp' : 'Chờ duyệt xuất';
};

type CreateKind = 'IMPORT' | 'MATERIAL_ISSUE' | 'TRANSFER' | 'LIQUIDATION';
const CREATE_OPTIONS: Array<{ kind: CreateKind; label: string; hint: string; Icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = [
  { kind: 'IMPORT', label: 'Phiếu nhập', hint: 'Tồn đầu kỳ, hàng tặng, thu hồi…', Icon: ArrowDownToLine, color: 'text-mint-600' },
  { kind: 'MATERIAL_ISSUE', label: 'Xuất vật tư thi công', hint: 'Cấp cho tổ đội / hạng mục', Icon: ArrowUpFromLine, color: 'text-leaf-600' },
  { kind: 'TRANSFER', label: 'Chuyển kho', hint: 'Sang kho khác', Icon: ArrowRightLeft, color: 'text-sky-600' },
  { kind: 'LIQUIDATION', label: 'Xuất hủy', hint: 'Hàng hỏng, mất', Icon: Trash2, color: 'text-rose-600' },
];

type Tile = 'mine' | 'receive' | 'export' | 'transfer' | 'late';
type Sort = 'oldest' | 'newest' | 'value';

export interface WmsWorkspaceProps {
  user: User;
  open: Transaction[];
  done: Transaction[];
  users: User[];
  warehouses: Warehouse[];
  items: InventoryItem[];
  partnerName: (tx: Transaction) => string | null;
  selectedId: string | null;
  onSelect: (tx: Transaction) => void;
  onCreate?: (kind: CreateKind) => void;
  canLiquidate?: boolean;
  /** Chi tiết phiếu đang chọn (render ở cột phải). */
  detail: React.ReactNode;
  onBack: () => void;
}

export const WmsWorkspace: React.FC<WmsWorkspaceProps> = ({
  user, open, done, users, warehouses, items, partnerName, selectedId, onSelect, onCreate, canLiquidate, detail, onBack,
}) => {
  const [view, setView] = useState<'open' | 'done'>('open');
  const [tile, setTile] = useState<Tile | null>('mine');
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [partner, setPartner] = useState('');
  const [sort, setSort] = useState<Sort>('oldest');
  const [menu, setMenu] = useState(false);

  const whName = (id?: string) => warehouses.find(w => w.id === id)?.name || '';
  const userName = (id?: string) => users.find(u => u.id === id)?.name || '';
  const itemName = (id: string) => items.find(i => i.id === id)?.name || '';
  const value = (tx: Transaction) => tx.items.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.price || 0), 0);
  const mainWh = (tx: Transaction) => tx.type === TransactionType.IMPORT ? tx.targetWarehouseId : tx.sourceWarehouseId;
  const actionable = (tx: Transaction) => getTransactionNextAction(tx, user).isActionable;

  const source = view === 'open' ? open : done;
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return source.filter(tx => (!warehouseId || tx.targetWarehouseId === warehouseId || tx.sourceWarehouseId === warehouseId)
      && (!kind || kindOf(tx) === kind) && (!partner || partnerName(tx) === partner)
      && (!q || q.split(/\s+/).every(w => [tx.id, tx.note, partnerName(tx), whName(tx.sourceWarehouseId), whName(tx.targetWarehouseId),
        userName(tx.requesterId), wmsStepLabel(tx), ...tx.items.map(l => itemName(l.itemId))].join(' ').toLowerCase().includes(w))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, search, warehouseId, kind, partner, users, warehouses, items]);

  const tiles: Array<{ key: Tile; label: string; icon: React.ReactNode; test: (tx: Transaction) => boolean; box: string; ic: string; num: string; blink?: boolean }> = [
    { key: 'mine', label: 'Cần bạn xử lý', icon: <UserCheck size={16} />, test: actionable,
      box: 'border-teal-200 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30', ic: 'bg-teal-600', num: 'text-teal-800 dark:text-teal-200' },
    { key: 'receive', label: 'Nhận hàng / nhập kho', icon: <Truck size={16} />, test: tx => tx.type === TransactionType.IMPORT,
      box: 'border-mint-200 bg-mint-50/70 dark:border-mint-900 dark:bg-mint-950/30', ic: 'bg-mint-500', num: 'text-mint-800 dark:text-mint-200' },
    { key: 'export', label: 'Xuất / cấp', icon: <ArrowUpFromLine size={16} />, test: tx => kindOf(tx) === 'export',
      box: 'border-leaf-200 bg-leaf-50/70 dark:border-leaf-900 dark:bg-leaf-950/30', ic: 'bg-leaf-600', num: 'text-leaf-800 dark:text-leaf-200' },
    { key: 'transfer', label: 'Chuyển kho', icon: <ArrowRightLeft size={16} />, test: tx => tx.type === TransactionType.TRANSFER,
      box: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30', ic: 'bg-sky-500', num: 'text-sky-800 dark:text-sky-200' },
    { key: 'late', label: 'Treo quá 3 ngày', icon: <AlarmClock size={16} />, test: tx => ageDays(tx) >= 3,
      box: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30', ic: 'bg-rose-500', num: 'text-rose-700 dark:text-rose-300' },
  ];
  const partners = useMemo(() => [...new Set(source.map(partnerName).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi')), [source, partnerName]);
  const shown = useMemo(() => {
    const t = view === 'open' && tile ? tiles.find(x => x.key === tile) : null;
    const base = t ? scoped.filter(t.test) : scoped;
    const by: Record<Sort, (a: Transaction, b: Transaction) => number> = {
      oldest: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      newest: (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      value: (a, b) => value(b) - value(a),
    };
    return [...base].sort(view === 'done' && sort === 'oldest' ? by.newest : by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, tile, sort, view]);
  const selected = selectedId ? [...open, ...done].find(tx => tx.id === selectedId) : null;
  const detailRef = useRef<HTMLElement>(null);
  // Điện thoại: mở phiếu thì cuộn tới chi tiết.
  useEffect(() => {
    if (selectedId && window.innerWidth < 1024) detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedId]);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Phiếu">
        {([['open', `Cần xử lý ${open.length}`], ['done', 'Đã xong gần đây']] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{l}</button>)}
      </div>
      {onCreate && <div className="relative ml-auto">
        <button type="button" onClick={() => setMenu(v => !v)} aria-expanded={menu}
          className="inline-flex items-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-leaf-700">
          <Plus size={16} />Lập phiếu<ChevronDown size={14} /></button>
        {menu && <div className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-lg" role="menu">
          {CREATE_OPTIONS.filter(o => o.kind !== 'LIQUIDATION' || canLiquidate).map(({ kind: k, label: l, hint: d, Icon, color: c }) =>
            <button key={k} type="button" role="menuitem" onClick={() => { setMenu(false); onCreate(k); }}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted">
              <Icon size={16} className={`mt-0.5 ${c}`} /><span><span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted-foreground">{d}</span></span></button>)}
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Hàng mua theo đơn: nhận ngay ở ô "Nhận hàng / nhập kho".</p>
        </div>}
      </div>}
    </div>

    {view === 'open' && <div className={`${selected ? 'hidden lg:grid' : 'grid'} grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5`}>
      {tiles.map(t => {
        const n = scoped.filter(t.test).length;
        return <button key={t.key} type="button" aria-pressed={tile === t.key} onClick={() => setTile(cur => cur === t.key ? null : t.key)}
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition hover:shadow-sm ${t.box} ${tile === t.key ? 'ring-2 ring-teal-500/60' : ''}`}>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${t.ic} ${t.key === 'late' && n > 0 ? 'overdue-blink' : ''}`}>{t.icon}</span>
          <span className="min-w-0"><span className={`block text-xl font-bold leading-tight tabular-nums ${t.num}`}>{n}</span>
            <span className="block truncate text-xs text-muted-foreground">{t.label}</span></span>
        </button>;
      })}
    </div>}

    <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2`}>
      <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
        <Search size={15} className="text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Tìm kiếm phiếu" placeholder="Tìm PO, NCC, vật tư, kho, người lập…"
          className="w-full bg-transparent py-1.5 text-sm focus:outline-none" />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm" className="text-muted-foreground"><X size={14} /></button>}
      </label>
      {warehouses.length > 1 && <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} aria-label="Kho" className="min-w-[9rem] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm sm:max-w-[12rem] sm:flex-none">
        <option value="">Tất cả kho</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
      <select value={kind} onChange={e => setKind(e.target.value as Kind | '')} aria-label="Loại phiếu" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
        <option value="">Mọi loại</option><option value="import">Nhập</option><option value="export">Xuất / cấp</option><option value="transfer">Chuyển</option></select>
      <select value={partner} onChange={e => setPartner(e.target.value)} aria-label="Đối tác" className="min-w-[9rem] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm sm:max-w-[14rem] sm:flex-none">
        <option value="">Mọi NCC / đối tác</option>{partners.map(p => <option key={p} value={p}>{p}</option>)}</select>
      <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sắp xếp" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
        <option value="oldest">{view === 'done' ? 'Mới nhất' : 'Treo lâu nhất'}</option><option value="newest">Mới nhất</option><option value="value">Giá trị lớn nhất</option></select>
    </div>

    <div className="grid gap-3 lg:grid-cols-[400px_minmax(0,1fr)]">
      <section className={`${selected ? 'hidden lg:block' : ''} overflow-hidden rounded-2xl border border-border bg-card`} aria-label="Danh sách phiếu">
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{shown.length} phiếu{tile && view === 'open' ? ` · ${tiles.find(t => t.key === tile)?.label}` : ''}</p>
        {shown.length === 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground"><Inbox size={24} className="mx-auto mb-2 text-mint-500" />
          {search || warehouseId || kind || partner ? 'Không có phiếu khớp bộ lọc.' : view === 'open' ? 'Không còn phiếu nào cần xử lý.' : 'Chưa có phiếu hoàn tất.'}</div>
          : <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
          {shown.map(tx => {
            const k = kindOf(tx); const K = KIND_STYLE[k]; const Icon = K.icon; const age = ageDays(tx); const late = view === 'open' && age >= 3;
            const act = view === 'open' && actionable(tx); const v = value(tx); const p = partnerName(tx);
            return <li key={tx.id}>
              <button type="button" onClick={() => onSelect(tx)} aria-current={selectedId === tx.id}
                className={`flex w-full gap-3 border-l-4 px-3 py-3 text-left hover:bg-mint-50/60 dark:hover:bg-mint-950/20 ${selectedId === tx.id ? 'border-l-teal-600 bg-mint-50 dark:bg-mint-950/30' : act ? 'border-l-leaf-500' : 'border-l-transparent'}`}>
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${K.chip}`}><Icon size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-2">
                    <span className={`line-clamp-2 text-sm font-semibold ${late ? 'text-rose-600 dark:text-rose-400' : 'text-mint-700 dark:text-mint-300'}`}>{tx.note || `${K.label} ${tx.id}`}</span>
                    <span className="ml-auto shrink-0">{late
                      ? <span className="overdue-blink rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Treo {age} ngày</span>
                      : <span className="text-xs text-muted-foreground">{new Date(tx.date).toLocaleDateString('vi-VN')}</span>}</span>
                  </span>
                  {p && <span className={`block truncate text-sm ${ENT}`}>{p}</span>}
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    <span className={ENT}>{whName(mainWh(tx))}</span>{tx.type === TransactionType.TRANSFER && <> → <span className={ENT}>{whName(tx.targetWarehouseId)}</span></>}
                    {' · '}{tx.items.length} dòng{userName(tx.requesterId) && <> · <span className={ENT}>{userName(tx.requesterId)}</span></>}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${act ? 'bg-leaf-100 text-leaf-800 dark:bg-leaf-900/40 dark:text-leaf-100' : 'bg-muted text-muted-foreground'}`}>{act ? `${wmsStepLabel(tx)} · bạn xử lý` : wmsStepLabel(tx)}</span>
                    {v > 0 && <span className={`ml-auto whitespace-nowrap ${NUM}`}>{money(v)} đ</span>}
                  </span>
                </span>
              </button>
            </li>;
          })}
        </ul>}
      </section>

      <section ref={detailRef} className={`${selected ? '' : 'hidden lg:block'} min-w-0 scroll-mt-4`} aria-label="Chi tiết phiếu">
        {selected ? <div className="space-y-2">
          <button type="button" onClick={onBack} className="text-sm font-semibold text-teal-700 hover:underline lg:hidden dark:text-teal-300">← Danh sách phiếu</button>
          {detail}
        </div> : <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          <Inbox size={28} className="mb-2 text-mint-500" />Chọn một phiếu bên trái để xem và xử lý ngay tại đây.</div>}
      </section>
    </div>
  </div>;
};

export default WmsWorkspace;
