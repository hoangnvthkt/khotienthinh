import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { committedDeliveryAmount, procurementInboxService, type ProcurementDelivery, type ProcurementOrderDetail } from '../../../lib/procurementInboxService';
import { fmt, parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

// Một đợt giao của đơn hàng: SL theo đơn vị mua và đơn vị kho (nhập tay được), đơn giá và
// VAT riêng của đợt. Trong giá trị đơn đã duyệt → có ngay phiếu nhập kho; vượt → cần duyệt bổ sung.

interface Row { lineId: string; name: string; unit: string; stockUnit: string; factor: number; remaining: number; include: boolean; purchaseQty: string; stockQty: string; stockTyped: boolean; price: string }

const today = () => new Date().toISOString().slice(0, 10);

export const DeliveryEditor: React.FC<{
  order: ProcurementOrderDetail; delivery?: ProcurementDelivery | null; onClose: () => void; onSaved: (needsApproval: boolean) => void;
}> = ({ order, delivery = null, onClose, onSaved }) => {
  const [rows, setRows] = useState<Row[]>(() => order.lines.map(line => {
    const own = delivery?.lines.find(l => l.lineId === line.lineId);
    const unit = line.unit || '';
    const stockUnit = line.stockUnit || unit;
    const remaining = line.remainingToDeliver + (own?.plannedQty || 0);
    const qty = own ? own.plannedQty : remaining;
    return { lineId: line.lineId, name: line.name, unit, stockUnit, factor: line.factor || 1, remaining,
      include: own ? true : remaining > 0, purchaseQty: qty > 0 ? qtyInput(qty) : '',
      stockQty: own ? qtyInput(own.stockPlannedQty) : qty > 0 ? qtyInput(qty * (line.factor || 1)) : '', stockTyped: Boolean(own),
      price: qtyInput(own ? own.unitPrice : line.unitPrice) };
  }));
  const [vat, setVat] = useState(String(delivery?.vatRate ?? order.vatRate));
  const [date, setDate] = useState(delivery?.plannedDate || order.expectedDeliveryDate || today());
  const [note, setNote] = useState(delivery?.note || '');
  const [approver, setApprover] = useState(delivery?.approvalAssigneeId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (lineId: string, p: Partial<Row>) => setRows(cur => cur.map(r => r.lineId === lineId ? { ...r, ...p } : r));
  const setPurchase = (row: Row, value: string) => {
    const q = parseQty(value);
    patch(row.lineId, { purchaseQty: value, ...(row.stockTyped || q == null || Number.isNaN(q) ? {} : { stockQty: qtyInput(Math.round(q * row.factor * 1000) / 1000) }) });
  };

  const calc = useMemo(() => {
    let amount = 0; let invalid = 0; let count = 0; let over = 0;
    rows.filter(r => r.include).forEach(r => {
      const pq = parseQty(r.purchaseQty); const sq = parseQty(r.stockQty); const price = parseQty(r.price);
      if (pq == null || sq == null || Number.isNaN(pq) || Number.isNaN(sq) || pq <= 0 || sq <= 0 || (price != null && (Number.isNaN(price) || price < 0))) { invalid += 1; return; }
      if (pq > r.remaining * 1.0001 + 0.001) over += 1;
      count += 1; amount += pq * (price || 0);
    });
    const committed = committedDeliveryAmount(order.deliveries, delivery?.id);
    const budget = order.approvedTotalAmount || order.totalAmount;
    return { amount, invalid, count, over, committed, budget, exceeds: committed + amount > budget * 1.0001 + 1 };
  }, [rows, order, delivery]);
  const vatRate = parseQty(vat) ?? 0;

  const save = async () => {
    setError(null);
    if (calc.invalid) { setError('Còn SL hoặc đơn giá chưa hợp lệ ở các dòng đã chọn.'); return; }
    if (!calc.count) { setError('Chọn ít nhất một vật tư có SL giao.'); return; }
    if (Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) { setError('Thuế VAT phải từ 0 đến 100%.'); return; }
    if (calc.exceeds && !approver) { setError('Đợt này làm vượt giá trị đơn đã duyệt — chọn người duyệt bổ sung.'); return; }
    setSaving(true);
    try {
      const result = await procurementInboxService.saveDelivery({
        purchaseOrderId: order.id, deliveryId: delivery?.id, plannedDate: date || null, vatRate, note: note.trim(),
        approverUserId: calc.exceeds ? approver : undefined,
        lines: rows.filter(r => r.include).map(r => ({ purchaseOrderLineId: r.lineId, purchaseQty: parseQty(r.purchaseQty) || 0, stockQty: parseQty(r.stockQty) || 0, unitPrice: parseQty(r.price) || 0 })),
      });
      onSaved(result.needsApproval);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  const nextNo = delivery?.deliveryNo || order.deliveries.filter(d => d.status !== 'cancelled').length + 1;
  return <Drawer wide label={`Đợt giao ${nextNo}`} onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{delivery ? 'Sửa' : 'Lập'} đợt giao {nextNo} · {order.poNumber}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{order.vendorName}</h2>
      <p className="text-sm text-muted-foreground">{[order.projectCode, order.warehouseName && `Kho nhận: ${order.warehouseName}`].filter(Boolean).join(' · ')}</p>
    </>}
    footer={<>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}
        {calc.exceeds ? 'Gửi duyệt bổ sung' : 'Tạo đợt & phiếu nhập kho'}</button>
    </>}>
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-3">
      <label className="text-xs font-semibold text-muted-foreground">Ngày giao dự kiến
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
      <div>
        <span className="text-xs font-semibold text-muted-foreground">VAT của đợt</span>
        <div className="mt-1 flex items-center gap-1">
          {[0, 8, 10].map(v => <button key={v} type="button" aria-pressed={vat === String(v)} onClick={() => setVat(String(v))}
            className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${vat === String(v) ? 'border-teal-600 bg-teal-700 text-white' : 'border-border hover:bg-muted'}`}>{v}%</button>)}
          <input aria-label="VAT khác (%)" inputMode="decimal" value={['0', '8', '10'].includes(vat) ? '' : vat} onChange={e => setVat(e.target.value)} placeholder="Khác" className={`w-16 ${inputCls}`} />
        </div>
      </div>
      <label className="text-xs font-semibold text-muted-foreground">Ghi chú (số phiếu NCC, xe…)
        <input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
    </section>

    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <p className="border-b border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">SL mua theo đơn vị NCC giao; SL kho tự quy đổi theo đơn hàng — sửa tay nếu thực tế khác (VD 100 kg = 10 cây).</p>
      <ul className="divide-y divide-border">{rows.map(r => {
        const pq = parseQty(r.purchaseQty); const price = parseQty(r.price);
        const over = r.include && pq != null && !Number.isNaN(pq) && pq > r.remaining * 1.0001 + 0.001;
        return <li key={r.lineId} className={`px-3 py-2.5 ${r.include ? '' : 'opacity-60'}`}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={r.include} onChange={e => patch(r.lineId, { include: e.target.checked })} className="h-4 w-4 accent-teal-600" />
            <span className="font-medium text-foreground">{r.name}</span>
            <span className="text-xs text-muted-foreground">còn phải giao {fmt(r.remaining, 3)} {r.unit}</span>
          </label>
          {r.include && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-6 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">SL mua
              <input inputMode="decimal" value={r.purchaseQty} onChange={e => setPurchase(r, e.target.value)} aria-label={`SL mua ${r.name}`}
                className={`w-24 text-right tabular-nums ${inputCls} ${over ? 'border-amber-400' : ''}`} />{r.unit}</label>
            {r.stockUnit !== r.unit && <label className="flex items-center gap-1.5">⇄ SL kho
              <input inputMode="decimal" value={r.stockQty} onChange={e => patch(r.lineId, { stockQty: e.target.value, stockTyped: true })} aria-label={`SL kho ${r.name}`}
                className={`w-24 text-right tabular-nums ${inputCls} ${r.stockTyped ? 'border-amber-400' : ''}`} />{r.stockUnit}</label>}
            <label className="flex items-center gap-1.5">Đơn giá / {r.unit}
              <input inputMode="decimal" value={r.price} onChange={e => patch(r.lineId, { price: e.target.value })} aria-label={`Đơn giá ${r.name}`}
                className={`w-28 text-right tabular-nums ${inputCls}`} /></label>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{pq && price ? `${money(pq * price)} đ` : ''}</span>
            {over && <span className="w-full text-amber-700 dark:text-amber-300">Vượt phần còn phải giao {fmt((pq || 0) - r.remaining, 3)} {r.unit}</span>}
          </div>}
        </li>;
      })}</ul>
    </section>

    <section className={`grid gap-2 rounded-2xl border p-4 text-sm md:grid-cols-2 ${calc.exceeds ? 'border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' : 'border-border bg-card'}`}>
      <dl className="space-y-0.5">
        <div className="flex justify-between"><dt className="text-muted-foreground">Tiền hàng đợt này</dt><dd className="tabular-nums">{money(calc.amount)} đ</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">VAT {vat}%</dt><dd className="tabular-nums">{money(calc.amount * (Number.isNaN(vatRate) ? 0 : vatRate) / 100)} đ</dd></div>
        <div className="flex justify-between font-bold"><dt>Tổng đợt</dt><dd className="tabular-nums">{money(calc.amount * (1 + (Number.isNaN(vatRate) ? 0 : vatRate) / 100))} đ</dd></div>
      </dl>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Đã giao/đang giao: <b className="text-foreground">{money(calc.committed)} đ</b> · giá trị đơn đã duyệt: <b className="text-foreground">{money(calc.budget)} đ</b> (trước VAT)</p>
        {calc.exceeds
          ? <>
            <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle size={14} />Vượt {money(calc.committed + calc.amount - calc.budget)} đ — cần duyệt bổ sung trước khi tạo phiếu nhập kho.</p>
            <select aria-label="Người duyệt bổ sung" value={approver} onChange={e => setApprover(e.target.value)} className={`w-full ${inputCls}`}>
              <option value="">Chọn người duyệt bổ sung…</option>
              {order.approvers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
          : <p>Trong giá trị đơn đã duyệt — tạo luôn phiếu nhập kho (QR) cho thủ kho.</p>}
      </div>
    </section>
  </Drawer>;
};

export default DeliveryEditor;
