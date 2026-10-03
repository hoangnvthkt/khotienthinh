import React, { useState } from 'react';
import { Loader2, Truck } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { procurementInboxService, type ProcurementInboxDocument, type ProcurementInboxLine } from '../../../lib/procurementInboxService';
import { fmt } from '../../project/work-plan/workPlanUi';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from './hubUi';

// Cần mua → Cấp từ kho: lập phiếu chuyển từ kho đang có hàng về kho công trường, gắn với dòng đề xuất.
// Thủ kho gửi xuất, thủ kho công trường nhận như phiếu chuyển thường; nhận xong dòng tính là đã nhận.

export const TRANSFER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ kho gửi xuất', APPROVED: 'Đang chuyển', COMPLETED: 'Đã nhận', CANCELLED: 'Đã hủy',
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const SupplyFromStockDrawer: React.FC<{
  doc: ProcurementInboxDocument; line: ProcurementInboxLine; onClose: () => void; onDone: () => void;
}> = ({ doc, line, onClose, onDone }) => {
  const toast = useToast();
  const stock = line.otherStock || [];
  const short = line.remainingQty;
  const first = stock.find(s => s.transferReady);
  const [wh, setWh] = useState(first?.warehouseId || '');
  const src = stock.find(s => s.warehouseId === wh);
  const [qty, setQty] = useState(String(round3(Math.min(short, first?.qty || 0))));
  const [saving, setSaving] = useState(false);
  const q = Number(qty.replace(',', '.')) || 0;
  const invalid = !src || !src.transferReady || q <= 0 || q > src.qty + 0.0005 || q > short + 0.0005;
  const submit = async () => {
    if (!src || invalid) return;
    setSaving(true);
    try {
      const r = await procurementInboxService.supplyFromStock({ requestId: doc.sourceId, lineId: line.lineId, sourceWarehouseId: src.warehouseId, qty: q });
      toast.success(`Đã lập phiếu chuyển ${fmt(r.qty, 3)} ${line.unit || ''} ${line.itemName}`,
        `${r.sourceWarehouseName} → ${r.targetWarehouseName}. Thủ kho gửi xuất, kho công trường nhận xong thì dòng tính là đã nhận.`);
      onDone();
    } catch (e) { toast.error('Chưa lập được phiếu chuyển', e instanceof Error ? e.message : ''); } finally { setSaving(false); }
  };
  return <Drawer label="Cấp từ kho" onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cấp từ kho</p>
      <h2 className="text-lg font-semibold text-mint-700 dark:text-mint-300">{line.itemName}</h2>
      <p className="text-sm text-muted-foreground">{doc.code} · {doc.projectCode || doc.projectName || ''} · còn thiếu {fmt(short, 3)} {line.unit} → {doc.warehouseName || 'kho công trường'}</p>
    </>}
    footer={<>
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={invalid || saving} onClick={() => void submit()}>
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />}Lập phiếu chuyển {q > 0 ? `${fmt(q, 3)} ${line.unit || ''}` : ''}</button>
    </>}>
    <p className="text-sm font-medium text-foreground">Kho đang có hàng</p>
    <ul className="space-y-2">{stock.map(s => <li key={s.warehouseId}>
      <label className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${s.transferReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'} ${wh === s.warehouseId ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
        <input type="radio" name="supply-source" disabled={!s.transferReady} checked={wh === s.warehouseId}
          onChange={() => { setWh(s.warehouseId); setQty(String(round3(Math.min(short, s.qty)))); }} className="accent-teal-600" />
        <span className="min-w-0 flex-1"><b className="text-foreground">{s.warehouseName}</b>
          <span className="block text-xs text-muted-foreground">{s.warehouseType === 'GENERAL' ? 'Kho Tổng' : 'Kho công trường khác'}
            {!s.transferReady && <span className="text-amber-700 dark:text-amber-300"> · chưa bật chuyển kho 2 bước</span>}</span></span>
        <span className="!whitespace-nowrap font-semibold tabular-nums text-leaf-700 dark:text-leaf-300">{fmt(s.qty, 3)} {line.unit}</span>
      </label></li>)}</ul>
    {stock.length > 0 && !stock.some(s => s.transferReady) && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      Các kho này chưa bật chuyển kho 2 bước nên thủ kho chưa xuất/nhận được. Nhờ quản trị bật, hoặc dùng <b>Lập đơn hàng</b> để mua mới.</p>}
    <label className="block text-sm font-medium text-foreground">Số lượng chuyển
      <span className="mt-1 flex items-center gap-2"><input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} className={`w-40 text-right ${inputCls}`} />
        <span className="text-sm text-muted-foreground">{line.unit}</span></span>
      {src && q > src.qty + 0.0005 && <span className="mt-1 block text-xs text-rose-700 dark:text-rose-300">Vượt tồn khả dụng của {src.warehouseName}.</span>}
      {q > short + 0.0005 && <span className="mt-1 block text-xs text-rose-700 dark:text-rose-300">Vượt phần còn thiếu ({fmt(short, 3)} {line.unit}).</span>}
    </label>
    <section className="rounded-xl border border-border p-3 text-sm">
      <h3 className="font-semibold text-foreground">Hệ thống sẽ</h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        <li>Lập phiếu chuyển {src?.warehouseName || 'kho gửi'} → {doc.warehouseName || 'kho công trường'}, gắn với dòng {line.itemName} của {doc.code}.</li>
        <li>Kho gửi xuất, kho công trường nhận như phiếu chuyển hiện nay. Nhận xong thì dòng đề xuất tính là đã nhận.</li>
        <li>Chi phí đi theo hàng theo giá vốn bình quân kho gửi (giá bất thường thì chờ kế toán xác nhận).</li>
        <li>Phần còn thiếu sau khi chuyển ({fmt(Math.max(0, short - q), 3)} {line.unit}) vẫn ở Cần mua để mua mới.</li>
      </ul>
    </section>
  </Drawer>;
};
