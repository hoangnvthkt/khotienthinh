import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, X } from 'lucide-react';
import { primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { fmtQ, type ReceiptGuardIssue, type ReceiptGuardResult } from '../../lib/receiptGuards';
import { BAD, GREY, TEAL, WARN } from './wmsUi';

const ISSUE_STYLE: Record<ReceiptGuardIssue['level'], { cls: string; icon: React.ReactNode }> = {
  block: { cls: BAD, icon: <ShieldAlert size={15} className="mt-0.5 shrink-0" /> },
  confirm: { cls: BAD, icon: <AlertTriangle size={15} className="mt-0.5 shrink-0" /> },
  warn: { cls: WARN, icon: <AlertTriangle size={15} className="mt-0.5 shrink-0" /> },
  info: { cls: GREY, icon: <Info size={15} className="mt-0.5 shrink-0" /> },
};

/** Hộp kiểm lại trước khi kho ghi sổ nhận hàng theo đơn: hiện đúng con số sẽ ghi, tình huống bất thường phải tích xác nhận. */
const ReceiptConfirmDialog: React.FC<{
  title: string;
  subtitle: React.ReactNode;
  result: ReceiptGuardResult;
  processing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, subtitle, result, processing, onCancel, onConfirm }) => {
  const [ack, setAck] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !processing) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, processing]);

  const single = result.rows.length === 1 ? result.rows[0] : null;
  const confirmLabel = single ? `Nhập kho ${fmtQ(single.actualQty)} ${single.unit}` : `Nhập kho ${result.rows.length} dòng`;
  const disabled = processing || result.blocked || (result.needsAck && !ack);
  const disabledReason = result.blocked ? 'Còn điểm phải sửa trước khi nhập kho' : result.needsAck && !ack ? 'Tích xác nhận đã kiểm tra các điểm cảnh báo' : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-confirm-title">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="min-w-0">
            <h3 id="receipt-confirm-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h3>
            <div className="mt-0.5 text-xs font-semibold text-slate-500">{subtitle}</div>
          </div>
          <button type="button" onClick={onCancel} disabled={processing} aria-label="Đóng" className="text-slate-400 hover:text-slate-600"><X size={22} /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800">
                <tr><th className="px-3 py-2 text-left">Vật tư</th><th className="px-3 py-2 text-right">Trên phiếu</th><th className="px-3 py-2 text-right">Thực nhận</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.rows.map(row => {
                  const tone = !Number.isFinite(row.diff) ? 'text-rose-700' : row.diff < -1e-9 ? 'text-amber-700' : row.diff > 1e-9 ? 'text-rose-700' : 'text-leaf-700';
                  return (
                    <tr key={row.index}>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{row.name}</div>
                        {row.orderedQty !== null && <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                          Đơn đặt {fmtQ(row.orderedQty)} · đã nhận {fmtQ(row.receivedBefore ?? 0)} → {fmtQ(row.receivedAfter ?? 0)}
                          {row.remainingAfter !== null && (row.remainingAfter > 1e-9
                            ? <> · còn {fmtQ(row.remainingAfter)}</>
                            : row.remainingAfter < -1e-9 ? <span className="text-rose-700"> · vượt {fmtQ(-row.remainingAfter)}</span> : <> · đủ đơn</>)} {row.purchaseUnit || row.unit}
                        </div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums text-slate-600">{fmtQ(row.plannedQty)} <span className="text-[10px]">{row.unit}</span></td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right align-top text-base font-black tabular-nums ${tone}`}>
                        {fmtQ(row.actualQty)} <span className="text-[10px] font-bold">{row.unit}</span>
                        {Number.isFinite(row.diff) && Math.abs(row.diff) > 1e-9 && <div className="text-[11px] font-bold">{row.diff < 0 ? 'thiếu' : 'dư'} {fmtQ(Math.abs(row.diff))}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2" aria-label="Điểm cần kiểm tra">
            {result.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold ${ISSUE_STYLE[issue.level].cls}`}>
                {issue.code === 'full' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : ISSUE_STYLE[issue.level].icon}
                <span>{issue.text}</span>
              </li>
            ))}
          </ul>

          {result.needsAck && !result.blocked && (
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-bold ${TEAL}`}>
              <input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} disabled={processing} className="mt-0.5 h-4 w-4 accent-teal-700" />
              Tôi đã cân/đếm lại và kiểm tra các điểm cảnh báo ở trên
            </label>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={processing} className={`${secondaryBtn} flex-1 sm:flex-none`}>Xem lại</button>
          <button type="button" onClick={onConfirm} disabled={disabled} title={disabledReason} className={`${primaryBtn} flex-1 sm:flex-none`}>
            {processing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ReceiptConfirmDialog;
