import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import { getPurchasePackageSummary } from '../../lib/purchasePackageDomain';

const money = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
const qty = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });

interface PurchasePackageSummaryProps {
  purchaseOrder: PurchaseOrder;
  deliveryBatches?: PurchaseOrderDeliveryBatch[];
}

export default function PurchasePackageSummary({
  purchaseOrder,
  deliveryBatches = [],
}: PurchasePackageSummaryProps) {
  const summary = getPurchasePackageSummary(purchaseOrder, deliveryBatches);
  const hasVariance = Math.abs(summary.releasedVarianceQty) > 0.000001
    || Math.abs(summary.releasedGrossVariance) > 0.5;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="grid gap-2 text-[11px] sm:grid-cols-4">
        <div>
          <div className="font-black uppercase text-slate-400">Nhu cầu gốc</div>
          <div className="font-black text-slate-800">{qty(summary.referenceQty)}</div>
          <div className="font-bold text-slate-500">{money(summary.referenceGross)} đ</div>
        </div>
        <div>
          <div className="font-black uppercase text-slate-400">Đã lập đợt</div>
          <div className="font-black text-blue-700">{qty(summary.releasedQty)}</div>
          <div className="font-bold text-blue-600">{money(summary.releasedGross)} đ</div>
        </div>
        <div>
          <div className="font-black uppercase text-slate-400">Thực nhận net</div>
          <div className="font-black text-emerald-700">{qty(summary.receivedNetQty)}</div>
          <div className="font-bold text-emerald-600">{money(summary.receivedGross)} đ</div>
        </div>
        <div>
          <div className="font-black uppercase text-slate-400">Còn nhu cầu</div>
          <div className="font-black text-slate-800">{qty(summary.remainingNeedQty)}</div>
          <div className="font-bold text-slate-500">{summary.uiStatus}</div>
        </div>
      </div>
      {hasVariance && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-bold text-amber-800">
          Đợt giao đang lệch baseline Gói mua hàng. Hệ thống chỉ cảnh báo để đối soát, không khóa lưu/gửi duyệt.
        </div>
      )}
    </div>
  );
}
