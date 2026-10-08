import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Send, Trash2, Truck } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import {
  procurementContractService, type ContractDetail, type ContractOrder, type ContractSummary,
} from '../../../lib/procurementContractService';
import type { Warehouse } from '../../../types';
import { backdateHint, vnToday } from '../../../lib/businessDate';
import { procurementInboxService } from '../../../lib/procurementInboxService';
import { fmt, parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

// Gọi hàng theo HĐ nguyên tắc: giá lấy từ bảng giá HĐ theo ngày giao, không duyệt từng đơn.
// Gửi xong thủ kho kho nhận thấy phiếu nhập như đơn PO; nhận xong chờ đối soát tháng (chưa ghi nợ).

type Mode = 'RECEIVE_TO_STOCK' | 'DIRECT_CONSUMPTION';
const MODES: Array<[Mode, string, string]> = [
  ['RECEIVE_TO_STOCK', 'Nhập lưu kho', 'Thủ kho nhận → tồn kho tăng, xuất dần khi dùng'],
  ['DIRECT_CONSUMPTION', 'Nhập–xuất thẳng', 'Thủ kho nhận 1 lần → ghi nhập và dùng ngay, tồn kho không đổi'],
];
interface Row { lineId?: string; itemId: string; name: string; unit: string; qty: string; price: string; contractPrice: number | null; vatRate: number }
const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const priceAt = (c: ContractDetail, itemId: string, date: string) => c.priceLines
  .filter(l => l.itemId === itemId && (!l.effectiveFrom || l.effectiveFrom <= date) && (!l.effectiveTo || l.effectiveTo >= date))
  .sort((a, b) => (b.effectiveFrom || '').localeCompare(a.effectiveFrom || ''))[0] || null;

export const ContractOrderEditor: React.FC<{
  contracts: ContractSummary[];
  warehouses: Warehouse[];
  contractId?: string | null;
  order?: ContractOrder | null;
  onClose: () => void;
  onSaved: (contractId: string) => void;
}> = ({ contracts, warehouses, contractId = null, order = null, onClose, onSaved }) => {
  const toast = useToast();
  const choices = contracts.filter(c => c.canOrder || c.id === contractId);
  const [cid, setCid] = useState(contractId || (choices.length === 1 ? choices[0].id : ''));
  const [c, setC] = useState<ContractDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState(order?.targetWarehouseId || '');
  const [date, setDate] = useState(order?.expectedDeliveryDate || today());
  const [orderDate, setOrderDate] = useState(order?.orderDate || vnToday());
  const [orderDateTouched, setOrderDateTouched] = useState(false);
  const [mode, setMode] = useState<Mode>(order?.fulfillmentMode || 'RECEIVE_TO_STOCK');
  const [multiple, setMultiple] = useState(order?.purchaseMode === 'multiple');
  const [note, setNote] = useState(order?.note || '');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Array<{ id: string; name: string; sku: string | null; unit: string | null }>>([]);
  const [approver, setApprover] = useState('');
  const [needApprover, setNeedApprover] = useState(false);
  const [saved, setSaved] = useState<{ id: string; rowVersion: number } | null>(order ? { id: order.id, rowVersion: order.rowVersion } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cid) { setC(null); return; }
    setC(null); setLoadError(null);
    procurementContractService.get(cid).then(detail => {
      setC(detail);
      if (order) {
        setRows(order.items.map(it => ({ lineId: it.lineId, itemId: it.itemId, name: it.name, unit: it.unit, qty: qtyInput(it.qty),
          price: qtyInput(it.unitPrice), contractPrice: it.priceSource === 'contract' ? it.unitPrice : null, vatRate: order.vatRate })));
      } else {
        setRows([]);
      }
    }).catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [cid, order]);
  useEffect(() => {
    if (!search.trim() || !c?.isBuyer) { setFound([]); return; }
    const t = setTimeout(() => { procurementContractService.searchItems(search).then(setFound).catch(() => setFound([])); }, 250);
    return () => clearTimeout(t);
  }, [search, c?.isBuyer]);

  // Kho nhận: HĐ của một dự án → kho công trường của dự án đó; HĐ dùng chung → mọi kho công trường, Kho Tổng (Mua hàng).
  const whOptions = useMemo(() => warehouses.filter(w => !w.isArchived && (c?.projectId
    ? w.type === 'SITE' && (w.projectId === c.projectId || (!!c.constructionSiteId && w.constructionSiteId === c.constructionSiteId))
    : w.type === 'SITE' || (w.type === 'GENERAL' && c?.isBuyer))), [warehouses, c]);
  useEffect(() => { if (!warehouseId && whOptions.length === 1) setWarehouseId(whOptions[0].id); }, [whOptions, warehouseId]);

  // Bảng giá áp tại ngày giao.
  const priced = useMemo(() => {
    if (!c) return [];
    const seen = new Set<string>();
    return c.priceLines.filter(l => { if (seen.has(l.itemId)) return false; seen.add(l.itemId); return true; })
      .map(l => ({ line: l, at: priceAt(c, l.itemId, date) })).filter(x => x.at);
  }, [c, date]);
  // Đổi ngày giao → giá HĐ theo ngày mới.
  useEffect(() => {
    if (!c) return;
    setRows(cur => cur.map(r => { const p = priceAt(c, r.itemId, date); return p ? { ...r, price: qtyInput(p.unitPrice), contractPrice: p.unitPrice, vatRate: p.vatRate } : { ...r, contractPrice: null }; }));
  }, [c, date]);

  const addItem = (it: { itemId: string; name: string; unit: string | null }) => {
    if (!c || rows.some(r => r.itemId === it.itemId)) return;
    const p = priceAt(c, it.itemId, date);
    setRows(cur => [...cur, { itemId: it.itemId, name: it.name, unit: it.unit || '', qty: '', price: p ? qtyInput(p.unitPrice) : '',
      contractPrice: p ? p.unitPrice : null, vatRate: p ? p.vatRate : (cur[0]?.vatRate ?? 8) }]);
  };
  const patch = (i: number, p: Partial<Row>) => setRows(cur => cur.map((r, j) => j === i ? { ...r, ...p } : r));
  const vats = Array.from(new Set(rows.map(r => r.vatRate)));
  const total = rows.reduce((s, r) => s + (parseQty(r.qty) || 0) * (parseQty(r.price) || 0), 0);
  const vat = vats.length === 1 ? vats[0] : null;

  const persist = async () => {
    if (!c) throw new Error('Chọn hợp đồng.');
    if (!warehouseId) throw new Error('Chọn kho nhận.');
    if (!rows.length) throw new Error('Thêm ít nhất một vật tư.');
    const bad = rows.find(r => !(parseQty(r.qty)! > 0) || !(parseQty(r.price)! > 0));
    if (bad) throw new Error(`Nhập số lượng${bad.contractPrice == null ? ' và giá tạm' : ''} cho ${bad.name}.`);
    if (vats.length > 1) throw new Error('Các vật tư có VAT khác nhau — tách thành đơn riêng theo từng mức VAT.');
    const r = await procurementContractService.saveOrder({ purchaseOrderId: saved?.id, expectedRowVersion: saved?.rowVersion, contractId: c.id,
      targetWarehouseId: warehouseId, expectedDeliveryDate: date || null, fulfillmentMode: mode, purchaseMode: multiple ? 'multiple' : 'single',
      vatRate: vat ?? undefined, note: note.trim(), items: rows.map(x => ({ lineId: x.lineId, itemId: x.itemId, qty: parseQty(x.qty) || 0,
        unitPrice: x.contractPrice == null ? parseQty(x.price) : undefined })) });
    if (orderDateTouched) { await procurementInboxService.setOrderDate(r.purchaseOrderId, orderDate); setOrderDateTouched(false); }
    const next = { id: r.purchaseOrderId, rowVersion: r.rowVersion };
    setSaved(next);
    return { ...r, next };
  };

  const run = async (send: boolean) => {
    setError(null); setBusy(true);
    try {
      const r = await persist();
      if (!send) { toast.success(`Đã lưu nháp ${r.poNumber}`); onSaved(c!.id); return; }
      try {
        const s = await procurementContractService.transitionOrder({ purchaseOrderId: r.next.id, expectedRowVersion: r.next.rowVersion, action: 'send',
          approverUserId: needApprover ? approver || undefined : undefined });
        toast.success(s.status === 'sent' ? `${r.poNumber} vượt hạn mức — đã gửi Mua hàng duyệt` : `Đã gửi ${r.poNumber}`,
          s.status === 'sent' ? 'Duyệt xong thủ kho mới thấy phiếu nhập.' : 'Thủ kho kho nhận đã có phiếu nhập; nhận xong chờ đối soát tháng.');
        onSaved(c!.id);
      } catch (e) {
        if ((e as { code?: string }).code === 'PROCUREMENT_CONTRACT_LIMIT_APPROVAL') setNeedApprover(true);
        // Đơn đã lưu nháp; lần gửi sau dùng phiên bản mới.
        throw e;
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const label = 'text-xs font-semibold text-muted-foreground';
  return <Drawer wide label="Gọi hàng theo HĐ" onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Gọi hàng theo hợp đồng nguyên tắc{order ? ` · ${order.poNumber}` : ''}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{c ? <span className="text-mint-700 dark:text-mint-300">{c.supplierName}</span> : 'Đơn mới'}</h2>
      <p className="text-sm text-muted-foreground">Giá lấy theo bảng giá HĐ tại ngày giao · không cần duyệt{c?.value ? ` (vượt ${money(c.value)} đ giá trị HĐ thì Mua hàng duyệt)` : ''}</p>
    </>}
    footer={<>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      {!error && <span className="mr-auto text-sm">Tạm tính <b className="tabular-nums text-leaf-700 dark:text-leaf-300">{money(total)} đ</b>{vat != null && total > 0 ? ` + VAT ${fmt(vat)}%` : ''} · ghi nợ khi chốt đối soát tháng</span>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
      <button type="button" disabled={busy || !c} onClick={() => void run(false)} className={secondaryBtn}>Lưu nháp</button>
      <button type="button" disabled={busy || !c || (needApprover && !approver)} onClick={() => void run(true)} className={primaryBtn}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{needApprover ? 'Gửi Mua hàng duyệt' : 'Gửi NCC'}</button>
    </>}>
    <div className="grid gap-3 md:grid-cols-4">
      <label className={`${label} md:col-span-2`}>Hợp đồng
        <select value={cid} disabled={!!contractId || !!order} onChange={e => { setCid(e.target.value); setWarehouseId(''); }} className={`mt-1 w-full ${inputCls}`}>
          <option value="">Chọn HĐ…</option>
          {choices.map(x => <option key={x.id} value={x.id}>{x.code} · {x.supplierName}{x.projectCode ? ` · ${x.projectCode}` : ''}</option>)}</select></label>
      <label className={label}>Kho nhận
        <select value={warehouseId} disabled={!c} onChange={e => setWarehouseId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
          <option value="">Chọn kho…</option>
          {whOptions.map(w => <option key={w.id} value={w.id}>{w.name}{w.type === 'GENERAL' ? ' (hàng tồn công ty)' : ''}</option>)}</select></label>
      <label className={label}>Ngày đặt hàng
                  <input type="date" value={orderDate} max={vnToday()} onChange={e => { setOrderDate(e.target.value); setOrderDateTouched(true); }} className={`mt-1 w-full ${inputCls}`} />
                  {backdateHint(orderDate) && <span className="mt-0.5 block text-[11px] font-normal text-amber-700 dark:text-amber-300">{backdateHint(orderDate)}</span>}</label>
      <label className={label}>Ngày cần giao <span className="font-normal">(giá HĐ lấy theo ngày này)</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    {loadError ? <StateBox kind="error" message={loadError} /> : !cid ? <StateBox kind="empty" title="Chọn hợp đồng để gọi hàng" message={choices.length ? 'Chỉ hiện HĐ còn hiệu lực bạn được gọi hàng.' : 'Chưa có HĐ nào bạn được gọi hàng. Nhờ Mua hàng khai HĐ hoặc cấp quyền.'} />
      : !c ? <StateBox kind="loading" title="Đang tải bảng giá HĐ…" /> : <>
        <section role="radiogroup" aria-label="Hình thức nhận" className="grid gap-2 md:grid-cols-2">
          {MODES.map(([k, l, hint]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
            className={`rounded-2xl border p-3 text-left transition ${mode === k ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20 dark:bg-teal-950/20' : 'border-border bg-card hover:border-teal-300'}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className={`h-3.5 w-3.5 rounded-full border-2 ${mode === k ? 'border-teal-600 bg-teal-600' : 'border-muted-foreground'}`} />{l}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{hint}</span></button>)}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-foreground">Vật tư</h3>
          {rows.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Chọn vật tư từ bảng giá HĐ bên dưới.</p>}
          <ul className="space-y-2">{rows.map((r, i) => { const qty = parseQty(r.qty) || 0; const price = parseQty(r.price) || 0;
            return <li key={r.itemId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
              <span className="min-w-[10rem] flex-1 font-medium text-foreground">{r.name}</span>
              <input aria-label={`SL ${r.name}`} inputMode="decimal" value={r.qty} onChange={e => patch(i, { qty: e.target.value })} placeholder="SL" className={`w-24 text-right tabular-nums ${inputCls}`} />
              <span className="w-10 text-muted-foreground">{r.unit}</span>
              {r.contractPrice != null
                ? <span className="text-muted-foreground">× giá HĐ <b className="tabular-nums text-foreground">{money(r.contractPrice)}</b></span>
                : <label className="flex items-center gap-1 text-amber-800 dark:text-amber-300">× giá tạm
                  <input aria-label={`Giá tạm ${r.name}`} inputMode="decimal" value={r.price} onChange={e => patch(i, { price: e.target.value })} className={`w-24 text-right tabular-nums ${inputCls}`} /></label>}
              <span className="w-28 text-right font-semibold tabular-nums text-leaf-700 dark:text-leaf-300">{money(qty * price)} đ</span>
              <span className="text-xs text-muted-foreground">VAT {fmt(r.vatRate)}%</span>
              <button type="button" aria-label={`Bỏ ${r.name}`} onClick={() => setRows(cur => cur.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted"><Trash2 size={14} /></button>
            </li>; })}</ul>
          {vats.length > 1 && <p className="text-sm text-amber-800 dark:text-amber-300">Các vật tư có VAT khác nhau — tách thành đơn riêng theo từng mức VAT.</p>}
          {rows.some(r => r.contractPrice == null) && <p className="text-xs text-amber-800 dark:text-amber-300">Vật tư chưa có giá trong HĐ: nhập giá tạm, Mua hàng chốt giá khi đối soát tháng.</p>}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Bảng giá HĐ tại {date ? date.split('-').reverse().join('/') : 'hôm nay'}</h3>
          {priced.length === 0 ? <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            HĐ chưa có giá hiệu lực ở ngày này.{c.isBuyer ? ' Thêm vật tư bằng ô tìm kiếm (giá tạm) hoặc khai bảng giá HĐ.' : ' Nhờ Mua hàng khai bảng giá HĐ.'}</p>
            : <div className="flex flex-wrap gap-1.5">{priced.map(({ line, at }) => { const on = rows.some(r => r.itemId === line.itemId);
              return <button key={line.itemId} type="button" disabled={on} onClick={() => addItem({ itemId: line.itemId, name: line.name, unit: line.unit })}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card text-foreground hover:border-teal-300'}`}>
                {!on && <Plus size={12} />}{line.name} · {money(at!.unitPrice)}/{line.unit}</button>; })}</div>}
          {c.isBuyer && <div className="relative max-w-md">
            <Plus size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Vật tư khác (chưa có giá HĐ, nhập giá tạm)…" className={`w-full pl-8 ${inputCls}`} />
            {found.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">{found.map(f => <li key={f.id}>
              <button type="button" onClick={() => { addItem({ itemId: f.id, name: f.name, unit: f.unit }); setSearch(''); }}
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"><span>{f.name}</span><span className="text-xs text-muted-foreground">{[f.sku, f.unit].filter(Boolean).join(' · ')}</span></button></li>)}</ul>}
          </div>}
        </section>

        <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
          <label className={label}>Ghi chú cho NCC / thủ kho<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={`mt-1 w-full ${inputCls}`} /></label>
          <div className="space-y-2 text-sm">
            {c.isBuyer && <label className="flex items-start gap-2 text-muted-foreground"><input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-600" />
              <span>Hàng về nhiều chuyến — Mua hàng lập từng đợt giao (mặc định: giao 1 lần, có ngay phiếu nhập cho thủ kho)</span></label>}
            {needApprover && <label className={label}>Người duyệt (Mua hàng)
              <select value={approver} onChange={e => setApprover(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
                <option value="">Chọn người duyệt…</option>{c.approvers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Truck size={14} className="mt-0.5 shrink-0" />Gửi xong thủ kho kho nhận thấy phiếu nhập; SL thực nhận có thể thiếu.</p>
          </div>
        </section>
      </>}
  </Drawer>;
};

export default ContractOrderEditor;
