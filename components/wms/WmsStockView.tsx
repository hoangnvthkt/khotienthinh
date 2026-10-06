import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRightLeft, ArrowUpFromLine, Boxes, CalendarCheck, ClipboardCheck, FileSpreadsheet, PackageSearch, RefreshCw, Search, Tags, Truck } from 'lucide-react';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { loadXlsx } from '../../lib/loadXlsx';
import { INVENTORY_MODE_LABELS, catalogErrorMessage, foldVi, wmsCatalogService, type ItemCard, type StockOverview, type StockRow } from '../../lib/wmsCatalogService';
import { BAD, EmptyPanel, GREY, Panel, Section, Split, Stat, TEAL, Tile, WARN, dateVi, daysBetween, fmtQty } from './wmsUi';

// Tồn kho (V1): số lấy thẳng từ sổ kho, không từ bản sao trong danh mục. Bấm một dòng → thẻ kho, kho khác, cảnh báo kèm cách xử lý.

type Filter = 'all' | 'incoming' | 'idle' | 'noprice' | 'check';
const TT: Record<string, string> = {
  purchase_receipt: 'Nhập mua', transfer_receipt: 'Nhập chuyển kho', project_return_receipt: 'Nhập trả từ công trình', adjustment_in: 'Điều chỉnh tăng',
  project_issue: 'Xuất thi công', transfer_issue: 'Xuất chuyển kho', loss_issue: 'Xuất hủy', adjustment_out: 'Điều chỉnh giảm', reversal: 'Đảo chứng từ',
};
const rowKey = (r: StockRow) => `${r.warehouseId}:${r.itemId}`;

const flagsOf = (r: StockRow, today: string) => {
  const f: Array<{ k: string; label: string; cls: string; hint: string }> = [];
  if (r.orphan) f.push({ k: 'orphan', label: 'Mã không còn trong danh mục', cls: BAD, hint: 'Tồn của vật tư không còn trong danh mục. Báo người cấp mã kiểm tra.' });
  if (r.value < -1 || (r.qty === 0 && Math.abs(r.value) > 1)) f.push({ k: 'value', label: 'Giá trị lệch', cls: BAD, hint: `Số lượng ${fmtQty(r.qty)} nhưng giá trị ${money(r.value)} đ — kế toán điều chỉnh giá trị khi khóa kỳ.` });
  if (r.qty > 0 && r.value <= 0) f.push({ k: 'noprice', label: 'Chưa có giá', cls: WARN, hint: 'Hàng nhập không có đơn giá — kế toán bổ sung giá.' });
  if (r.qty > 0 && r.inventoryMode !== 'stock') f.push({ k: 'usenow', label: `${INVENTORY_MODE_LABELS[r.inventoryMode]} mà còn tồn`, cls: WARN, hint: 'Hàng dùng ngay / dịch vụ không nằm trong kho — xử lý bằng kiểm kê (ghi “đã dùng, chưa lập phiếu”).' });
  if (r.qty > 0 && r.lastMove && daysBetween(r.lastMove, today) > 60) f.push({ k: 'idle', label: `${daysBetween(r.lastMove, today)} ngày không biến động`, cls: GREY, hint: 'Chậm luân chuyển hoặc đã dùng mà chưa ghi xuất.' });
  if (r.minStock > 0 && r.qty <= r.minStock) f.push({ k: 'min', label: 'Dưới tồn tối thiểu', cls: WARN, hint: `Tồn tối thiểu ${fmtQty(r.minStock)}.` });
  return f;
};
const needsCheck = (r: StockRow, today: string) => flagsOf(r, today).some(f => f.k === 'orphan' || f.k === 'value' || f.k === 'usenow');

export const WmsStockView: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<StockOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [card, setCard] = useState<{ key: string; data: ItemCard | null; error?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try { setData(await wmsCatalogService.stock()); setState('ready'); }
    catch (e) { setMessage(catalogErrorMessage(e, 'Chưa tải được tồn kho.')); setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = data?.today || new Date().toISOString().slice(0, 10);
  const whName = (id: string) => data?.warehouses.find(w => w.id === id)?.name || id;
  const scoped = useMemo(() => (data?.rows || []).filter(r => scope === 'all' || r.warehouseId === scope), [data, scope]);
  const pos = scoped.filter(r => r.qty > 0);
  const tiles: Array<{ k: Filter; label: string; icon: React.ElementType; value: React.ReactNode; hint: string; tone: string; ic: string; test: (r: StockRow) => boolean }> = [
    { k: 'all', label: 'Giá trị tồn (tạm tính)', icon: Boxes, value: shortMoney(pos.reduce((s, r) => s + Math.max(0, r.value), 0)), hint: `${pos.length} dòng có tồn`, tone: 'text-leaf-700 dark:text-leaf-300', ic: 'bg-leaf-600', test: () => true },
    { k: 'incoming', label: 'Đang về', icon: Truck, value: scoped.filter(r => r.incoming > 0).length, hint: 'đợt giao kho chưa nhận', tone: 'text-teal-700 dark:text-teal-300', ic: 'bg-teal-600', test: r => r.incoming > 0 },
    { k: 'idle', label: 'Chậm luân chuyển', icon: CalendarCheck, value: pos.filter(r => r.lastMove && daysBetween(r.lastMove, today) > 60).length, hint: '> 60 ngày không biến động', tone: 'text-slate-700 dark:text-slate-200', ic: 'bg-slate-500', test: r => r.qty > 0 && !!r.lastMove && daysBetween(r.lastMove, today) > 60 },
    { k: 'noprice', label: 'Chưa có giá', icon: Tags, value: pos.filter(r => r.value <= 0).length, hint: 'kế toán bổ sung giá', tone: 'text-amber-700 dark:text-amber-300', ic: 'bg-amber-500', test: r => r.qty > 0 && r.value <= 0 },
    { k: 'check', label: 'Cần kiểm tra', icon: AlertTriangle, value: scoped.filter(r => needsCheck(r, today)).length, hint: 'tồn ảo, giá trị lệch', tone: 'text-rose-700 dark:text-rose-300', ic: 'bg-rose-500', test: r => needsCheck(r, today) },
  ];
  const t = tiles.find(x => x.k === filter)!;
  const categories = useMemo(() => [...new Set(scoped.map(r => r.category || '—'))].sort((a, b) => a.localeCompare(b, 'vi')), [scoped]);
  const list = scoped.filter(t.test).filter(r => !category || (r.category || '—') === category)
    .filter(r => !search.trim() || foldVi(`${r.name} ${r.sku} ${r.category} ${whName(r.warehouseId)}`).includes(foldVi(search.trim())))
    .sort((a, b) => b.value - a.value);
  const row = (data?.rows || []).find(r => rowKey(r) === sel) || null;
  const wh = row ? data?.warehouses.find(w => w.id === row.warehouseId) : undefined;

  useEffect(() => {
    if (!row) return;
    const key = rowKey(row);
    if (card?.key === key) return;
    setCard({ key, data: null });
    setShowAll(false);
    wmsCatalogService.card(row.itemId, row.warehouseId)
      .then(d => setCard(c => c?.key === key ? { key, data: d } : c))
      .catch(e => setCard(c => c?.key === key ? { key, data: null, error: catalogErrorMessage(e, 'Chưa tải được thẻ kho.') } : c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const entries = useMemo(() => {
    let bal = 0;
    return (card?.data?.entries || []).map(e => { bal += Number(e.qtyIn) - Number(e.qtyOut); return { ...e, bal }; });
  }, [card]);

  const exportExcel = async () => {
    try {
      const XLSX = await loadXlsx();
      const sheet = XLSX.utils.json_to_sheet(list.map(r => ({ 'Kho': whName(r.warehouseId), 'Mã': r.sku, 'Vật tư': r.name, 'ĐVT': r.unit, 'Nhóm': r.category,
        'Tồn': r.qty, 'Giá trị (tạm tính)': r.value, 'Đang về': r.incoming, 'Biến động cuối': dateVi(r.lastMove), 'Cách quản lý': INVENTORY_MODE_LABELS[r.inventoryMode] })));
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Tồn kho');
      XLSX.writeFile(book, `ton-kho-${today}.xlsx`);
    } catch (e) { toast.error('Chưa xuất được Excel', catalogErrorMessage(e)); }
  };

  if (state === 'loading' && !data) return <StateBox kind="loading" title="Đang tải tồn kho từ sổ kho…" />;
  if (state === 'error' && !data) return <StateBox kind="error" title="Chưa tải được tồn kho" message={message} onRetry={() => void load()} />;
  if (!data) return null;
  if (data.warehouses.length === 0) return <StateBox kind="denied" title="Bạn chưa được xem kho nào" message="Nhờ Admin cấp quyền Tồn kho — Xem cho kho bạn phụ trách." />;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="scrollbar-hide flex max-w-full gap-1.5 overflow-x-auto" role="group" aria-label="Kho">
        {[{ id: 'all', name: 'Mọi kho' }, ...data.warehouses].map(w => <button key={w.id} type="button" onClick={() => { setScope(w.id); setSel(null); }} aria-pressed={scope === w.id}
          className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold ${scope === w.id ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card hover:border-teal-300'}`}>{w.name}</button>)}
      </div>
      <button type="button" onClick={() => void load()} disabled={state === 'loading'} className={`ml-auto ${secondaryBtn} bg-card`}><RefreshCw size={15} className={state === 'loading' ? 'animate-spin' : ''} />Làm mới</button>
    </div>
    <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">{tiles.map(x => <Tile key={x.k} active={filter === x.k} onClick={() => setFilter(x.k)} icon={x.icon} label={x.label} value={x.value} hint={x.hint} tone={x.tone} ic={x.ic} />)}</div>
    <Split wide open={!!row} selKey={sel} list={<div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <label className="relative min-w-[12rem] flex-1"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm vật tư, mã, nhóm, kho (không cần dấu)…" className={`w-full pl-8 ${inputCls}`} /></label>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Nhóm vật tư" className={`max-w-[11rem] ${inputCls}`}><option value="">Mọi nhóm</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
        <button type="button" className={secondaryBtn} onClick={() => void exportExcel()} disabled={!list.length}><FileSpreadsheet size={15} />Excel</button>
      </div>
      <p className="border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">{list.length} dòng · số lấy thẳng từ <b>sổ kho</b> · xếp theo giá trị</p>
      {list.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Không có vật tư khớp bộ lọc.</p>
        : <ul className="divide-y divide-border">{list.slice(0, 300).map(r => { const fl = flagsOf(r, today); const k = rowKey(r); return <li key={k}>
          <button type="button" onClick={() => setSel(k)} className={`flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-left ${sel === k ? 'bg-teal-50/70 dark:bg-teal-950/30' : 'hover:bg-muted/40'}`}>
            <span className="min-w-0 flex-1 basis-56"><span className={r.orphan ? 'font-semibold text-rose-700' : ENT}>{r.name}</span>
              <span className="block text-xs text-muted-foreground">{r.sku || '—'}{scope === 'all' && ` · ${whName(r.warehouseId)}`}{r.inventoryMode !== 'stock' && ` · ${INVENTORY_MODE_LABELS[r.inventoryMode]}`}</span>
              {fl.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{fl.slice(0, 2).map(f => <Badge key={f.k} className={f.cls}>{f.label}</Badge>)}</span>}</span>
            <span className="text-right text-sm"><span className={NUM}>{fmtQty(r.qty)}</span> <span className="text-xs text-muted-foreground">{r.unit}</span>
              {r.incoming > 0 && <span className="block text-xs text-teal-700 dark:text-teal-300">+{fmtQty(r.incoming)} đang về</span>}
              <span className="block text-xs">{r.value < -1 ? <span className="font-semibold text-rose-700">{shortMoney(r.value)}</span> : r.qty > 0 && r.value <= 0 ? <span className="font-semibold text-amber-700 dark:text-amber-300">chưa có giá</span> : <span className={NUM}>{shortMoney(r.value)}</span>}</span></span>
          </button></li>; })}
          {list.length > 300 && <li className="px-3 py-2 text-center text-xs text-muted-foreground">Còn {list.length - 300} dòng — gõ để tìm.</li>}</ul>}
    </div>}
      detail={!row ? <EmptyPanel icon={PackageSearch} title="Chọn một vật tư" text="Thẻ kho, tồn ở kho khác và cảnh báo kèm cách xử lý hiện ngay tại đây." />
        : <Panel onBack={() => setSel(null)}
          head={<div><p className="text-xs text-muted-foreground">{whName(row.warehouseId)} · {row.sku || '—'}</p>
            <button type="button" disabled={row.orphan} onClick={() => navigate('/material-code-requests', { state: { itemId: row.itemId } })} title="Mở trong Danh mục vật tư"
              className={`text-left text-lg hover:underline disabled:no-underline ${row.orphan ? 'font-semibold text-rose-700' : ENT}`}>{row.name}</button>
            <span className="mt-1 flex flex-wrap gap-1"><Badge className={row.inventoryMode === 'stock' ? GREY : TEAL}>{INVENTORY_MODE_LABELS[row.inventoryMode]}</Badge>{row.unit && <Badge className={GREY}>{row.unit}</Badge>}{row.category && <Badge className={GREY}>{row.category}</Badge>}</span></div>}
          foot={wh?.canOperate ? <>
            <button type="button" className={secondaryBtn} onClick={() => navigate('/audit')}><ClipboardCheck size={15} />Kiểm đếm</button>
            <button type="button" className={secondaryBtn} disabled={row.qty <= 0} onClick={() => navigate('/operations', { state: { tab: 'TRANSFER', prefillItemId: row.itemId, warehouseId: row.warehouseId } })}><ArrowRightLeft size={15} />Chuyển</button>
            <button type="button" className={primaryBtn} disabled={row.qty <= 0} onClick={() => navigate('/operations', { state: { tab: 'MATERIAL_ISSUE', prefillItemId: row.itemId, warehouseId: row.warehouseId } })}><ArrowUpFromLine size={15} />Xuất</button>
          </> : <span className="text-xs text-muted-foreground">Bạn chỉ xem được kho này. Thủ kho của kho mới ghi phiếu.</span>}>
          {flagsOf(row, today).filter(f => f.k !== 'idle').map(f => <div key={f.k} className={`rounded-xl border px-3 py-2 text-sm ${f.cls}`}><b>{f.label}.</b> {f.hint}</div>)}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Tồn"><span className={NUM}>{fmtQty(row.qty)}</span> {row.unit}</Stat>
            <Stat label="Giá bình quân (tạm tính)">{row.qty > 0 && row.value > 0 ? <span className={NUM}>{money(row.value / row.qty)} đ</span> : <span className="font-semibold text-amber-700 dark:text-amber-300">chưa có giá</span>}</Stat>
            <Stat label="Giá trị"><span title={`${money(row.value)} đ`} className={row.value < -1 ? 'font-semibold text-rose-700' : NUM}>{shortMoney(row.value)}</span></Stat>
            <Stat label="Đang về">{row.incoming > 0 ? <span className="font-semibold text-teal-700 dark:text-teal-300">{fmtQty(row.incoming)}</span> : '—'}</Stat>
            <Stat label="Xuất 30 ngày">{row.out30 > 0 ? <span className={NUM}>{fmtQty(row.out30)}</span> : <span className="text-muted-foreground">0</span>}</Stat>
            <Stat label="Biến động cuối">{dateVi(row.lastMove)}</Stat>
          </div>
          {(card?.data?.otherWarehouses.length || 0) > 0 && <Section title="Kho khác đang có">
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">{card!.data!.otherWarehouses.map(o =>
              <li key={o.warehouseId} className="flex items-center justify-between px-3 py-1.5"><button type="button" onClick={() => setSel(`${o.warehouseId}:${row.itemId}`)} className="hover:underline">{o.warehouseName}</button>
                <span><span className={NUM}>{fmtQty(Number(o.qty))}</span> <span className="text-xs text-muted-foreground">{row.unit}</span></span></li>)}</ul>
          </Section>}
          <Section title="Thẻ kho" right={<span className="text-xs text-muted-foreground">theo ngày chứng từ</span>}>
            {card?.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{card.error}</p>
              : !card?.data ? <p className="text-sm text-muted-foreground">Đang tải thẻ kho…</p>
              : entries.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Chưa có dòng sổ.</p>
              : <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[22rem] text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="px-2 py-1.5 font-medium">Ngày</th><th className="px-2 py-1.5 font-medium">Chứng từ</th><th className="px-2 py-1.5 text-right font-medium">Nhập</th><th className="px-2 py-1.5 text-right font-medium">Xuất</th><th className="px-2 py-1.5 text-right font-medium">Tồn</th></tr></thead>
                <tbody>{(showAll ? entries : entries.slice(-12)).map((c, i) => <tr key={`${c.code}-${i}`} className="border-t border-border" title={c.description || undefined}>
                  <td className="!whitespace-nowrap px-2 py-1.5">{dateVi(c.date)}
                    {c.enteredAt && daysBetween(c.date, c.enteredAt) > 1 && <span className="block text-[10px] text-muted-foreground" title="Ngày nhập liệu vào hệ thống">nhập liệu {dateVi(c.enteredAt)}</span>}</td>
                  <td className="px-2 py-1.5"><span className={ENT}>{c.code}</span><span className="block text-muted-foreground">{c.fromSku && <span className="mr-1 rounded bg-teal-50 px-1 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">từ {c.fromSku}</span>}{c.event === 'direct_consumption' ? 'Xuất dùng thẳng (nhập–xuất thẳng)' : TT[c.type] || c.type}{Number(c.unitPrice) === 0 && <span className="ml-1 text-amber-700 dark:text-amber-300">· giá 0</span>}</span></td>
                  <td className="!whitespace-nowrap px-2 py-1.5 text-right">{Number(c.qtyIn) ? <span className={NUM}>{fmtQty(Number(c.qtyIn))}</span> : ''}</td>
                  <td className="!whitespace-nowrap px-2 py-1.5 text-right">{Number(c.qtyOut) ? <span className="font-semibold tabular-nums">{fmtQty(Number(c.qtyOut))}</span> : ''}</td>
                  <td className="!whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{fmtQty(c.bal)}</td></tr>)}</tbody></table></div>}
            {entries.length > 12 && <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1 text-xs font-semibold text-teal-700 dark:text-teal-300">{showAll ? 'Thu gọn' : `Xem đủ ${entries.length} dòng`}</button>}
          </Section>
        </Panel>} />
  </div>;
};
