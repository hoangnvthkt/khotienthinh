import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, ArrowUpFromLine, ClipboardCheck, Trash2 } from 'lucide-react';
import { Badge, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney } from '../finance/financeUi';
import { INVENTORY_MODE_LABELS, catalogErrorMessage, wmsCatalogService, type ItemCard, type StockOverview, type StockRow } from '../../lib/wmsCatalogService';
import { BAD, GREY, Panel, Section, Stat, TEAL, WARN, dateVi, daysBetween, fmtQty } from './wmsUi';
import { SpecChips, SpecStockSection } from './SpecStockSection';

// Chi tiết một vật tư tại một kho (V2 Kho một màn): số lấy thẳng từ sổ kho — thẻ kho, quy cách, kho khác, cảnh báo; nút thao tác mở ngay trong màn Kho.

export const TT: Record<string, string> = {
  purchase_receipt: 'Nhập mua', transfer_receipt: 'Nhập chuyển kho', project_return_receipt: 'Nhập trả từ công trình', adjustment_in: 'Điều chỉnh tăng',
  project_issue: 'Xuất thi công', transfer_issue: 'Xuất chuyển kho', loss_issue: 'Xuất hủy', adjustment_out: 'Điều chỉnh giảm', reversal: 'Đảo chứng từ',
};
export const rowKey = (r: StockRow) => `${r.warehouseId}:${r.itemId}`;

export const flagsOf = (r: StockRow, today: string) => {
  const f: Array<{ k: string; label: string; cls: string; hint: string }> = [];
  if (r.orphan) f.push({ k: 'orphan', label: 'Mã không còn trong danh mục', cls: BAD, hint: 'Tồn của vật tư không còn trong danh mục. Báo người cấp mã kiểm tra.' });
  if (r.value < -1 || (r.qty === 0 && Math.abs(r.value) > 1)) f.push({ k: 'value', label: 'Giá trị lệch', cls: BAD, hint: `Số lượng ${fmtQty(r.qty)} nhưng giá trị ${money(r.value)} đ — kế toán điều chỉnh giá trị khi khóa kỳ.` });
  if (r.qty > 0 && r.value <= 0) f.push({ k: 'noprice', label: 'Chưa có giá', cls: WARN, hint: 'Hàng nhập không có đơn giá — kế toán bổ sung giá.' });
  if (r.qty > 0 && r.inventoryMode !== 'stock') f.push({ k: 'usenow', label: `${INVENTORY_MODE_LABELS[r.inventoryMode]} mà còn tồn`, cls: WARN, hint: 'Hàng dùng ngay / dịch vụ không nằm trong kho — xử lý bằng kiểm kê (ghi “đã dùng, chưa lập phiếu”).' });
  if (r.qty > 0 && r.lastMove && daysBetween(r.lastMove, today) > 60) f.push({ k: 'idle', label: `${daysBetween(r.lastMove, today)} ngày không biến động`, cls: GREY, hint: 'Chậm luân chuyển hoặc đã dùng mà chưa ghi xuất.' });
  if (r.minStock > 0 && r.qty <= r.minStock) f.push({ k: 'min', label: 'Dưới tồn tối thiểu', cls: WARN, hint: `Tồn tối thiểu ${fmtQty(r.minStock)}.` });
  return f;
};
export const needsCheck = (r: StockRow, today: string) => flagsOf(r, today).some(f => f.k === 'orphan' || f.k === 'value' || f.k === 'usenow');

export type StockAction = 'issue' | 'transfer' | 'loss' | 'count';

export const StockItemPanel: React.FC<{ row: StockRow; warehouses: StockOverview['warehouses']; today: string; onBack: () => void;
  onOpenRow: (key: string) => void; onAction: (kind: StockAction) => void }> = ({ row, warehouses, today, onBack, onOpenRow, onAction }) => {
  const navigate = useNavigate();
  const [card, setCard] = useState<{ data: ItemCard | null; error?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const whName = (id: string) => warehouses.find(w => w.id === id)?.name || id;
  const wh = warehouses.find(w => w.id === row.warehouseId);
  const load = () => {
    wmsCatalogService.card(row.itemId, row.warehouseId).then(d => setCard({ data: d }))
      .catch(e => setCard({ data: null, error: catalogErrorMessage(e, 'Chưa tải được thẻ kho.') }));
  };
  useEffect(() => { setCard(null); setShowAll(false); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [row.itemId, row.warehouseId]);
  const reloadCard = load;
  const entries = useMemo(() => {
    let bal = 0;
    return (card?.data?.entries || []).map(e => { bal += Number(e.qtyIn) - Number(e.qtyOut); return { ...e, bal }; });
  }, [card]);

  return <Panel onBack={onBack}
          head={<div><p className="text-xs text-muted-foreground">{whName(row.warehouseId)} · {row.sku || '—'}</p>
            <button type="button" disabled={row.orphan} onClick={() => navigate('/material-code-requests', { state: { itemId: row.itemId } })} title="Mở trong Danh mục vật tư"
              className={`text-left text-lg hover:underline disabled:no-underline ${row.orphan ? 'font-semibold text-rose-700' : ENT}`}>{row.name}</button>
            <span className="mt-1 flex flex-wrap gap-1"><Badge className={row.inventoryMode === 'stock' ? GREY : TEAL}>{INVENTORY_MODE_LABELS[row.inventoryMode]}</Badge>{row.unit && <Badge className={GREY}>{row.unit}</Badge>}{row.category && <Badge className={GREY}>{row.category}</Badge>}</span></div>}
          foot={wh?.canOperate ? <>
            <button type="button" className={secondaryBtn} onClick={() => onAction('count')}><ClipboardCheck size={15} />Kiểm đếm</button>
            <button type="button" className={secondaryBtn} disabled={row.qty <= 0} onClick={() => onAction('loss')}><Trash2 size={15} />Hủy</button>
            <button type="button" className={secondaryBtn} disabled={row.qty <= 0} onClick={() => onAction('transfer')}><ArrowRightLeft size={15} />Chuyển</button>
            <button type="button" className={primaryBtn} disabled={row.qty <= 0} onClick={() => onAction('issue')}><ArrowUpFromLine size={15} />Xuất</button>
          </> : <span className="text-xs text-muted-foreground">Chỉ xem</span>}>
          {flagsOf(row, today).length > 0 && <div className="flex flex-wrap gap-1">{flagsOf(row, today).map(f => <span key={f.k} title={f.hint}><Badge className={f.cls}>{f.label}</Badge></span>)}</div>}
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
              <li key={o.warehouseId} className="flex items-center justify-between px-3 py-1.5"><button type="button" onClick={() => onOpenRow(`${o.warehouseId}:${row.itemId}`)} className="hover:underline">{o.warehouseName}</button>
                <span><span className={NUM}>{fmtQty(Number(o.qty))}</span> <span className="text-xs text-muted-foreground">{row.unit}</span></span></li>)}</ul>
          </Section>}
          {card?.data && <SpecStockSection card={card.data} itemId={row.itemId} itemName={row.name} warehouseId={row.warehouseId} unit={row.unit} onChanged={reloadCard} />}
          <Section title="Thẻ kho">
            {card?.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{card.error}</p>
              : !card?.data ? <p className="text-sm text-muted-foreground">Đang tải thẻ kho…</p>
              : entries.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Chưa có dòng sổ.</p>
              : <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[22rem] text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="px-2 py-1.5 font-medium">Ngày</th><th className="px-2 py-1.5 font-medium">Chứng từ</th><th className="px-2 py-1.5 text-right font-medium">Nhập</th><th className="px-2 py-1.5 text-right font-medium">Xuất</th><th className="px-2 py-1.5 text-right font-medium">Tồn</th></tr></thead>
                <tbody>{(showAll ? entries : entries.slice(-12)).map((c, i) => <tr key={`${c.code}-${i}`} className="border-t border-border" title={c.description || undefined}>
                  <td className="!whitespace-nowrap px-2 py-1.5">{dateVi(c.date)}
                    {c.enteredAt && daysBetween(c.date, c.enteredAt) > 1 && <span className="block text-[10px] text-muted-foreground" title="Ngày nhập liệu vào hệ thống">nhập liệu {dateVi(c.enteredAt)}</span>}</td>
                  <td className="px-2 py-1.5"><span className={ENT}>{c.code}</span><span className="block"><SpecChips allocations={c.specAllocations} fallback={c.specification} /></span><span className="block text-muted-foreground">{c.fromSku && <span className="mr-1 rounded bg-teal-50 px-1 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">từ {c.fromSku}</span>}{c.event === 'direct_consumption' ? 'Xuất dùng thẳng (nhập–xuất thẳng)' : TT[c.type] || c.type}{Number(c.unitPrice) === 0 && <span className="ml-1 text-amber-700 dark:text-amber-300">· giá 0</span>}</span></td>
                  <td className="!whitespace-nowrap px-2 py-1.5 text-right">{Number(c.qtyIn) ? <span className={NUM}>{fmtQty(Number(c.qtyIn))}</span> : ''}</td>
                  <td className="!whitespace-nowrap px-2 py-1.5 text-right">{Number(c.qtyOut) ? <span className="font-semibold tabular-nums">{fmtQty(Number(c.qtyOut))}</span> : ''}</td>
                  <td className="!whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{fmtQty(c.bal)}</td></tr>)}</tbody></table></div>}
            {entries.length > 12 && <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1 text-xs font-semibold text-teal-700 dark:text-teal-300">{showAll ? 'Thu gọn' : `Xem đủ ${entries.length} dòng`}</button>}
          </Section>
        </Panel>;
};
