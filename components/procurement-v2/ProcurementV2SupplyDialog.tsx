import React, { useEffect, useRef } from 'react';
import { ArrowRight, Boxes, FileText, LockKeyhole, Truck, X } from 'lucide-react';

const unavailable = [
  { title: 'Cấp từ kho', icon: Boxes, reason: 'Chưa có lệnh giữ hàng từ kho cho hồ sơ này.' },
  { title: 'Điều chuyển', icon: Truck, reason: 'Chưa có lệnh điều chuyển gắn với nhu cầu này.' },
  { title: 'Gọi theo hợp đồng', icon: FileText, reason: 'Cần xác nhận hiệu lực, đơn giá và hạn mức hợp đồng.' },
];

export const ProcurementV2SupplyDialog: React.FC<{
  open: boolean;
  demandLabel: string;
  canPurchase: boolean;
  onClose: () => void;
  onPurchase: () => void;
}> = ({ open, demandLabel, canPurchase, onClose, onPurchase }) => {
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href]'));
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault(); controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault(); controls[0].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[60] grid place-items-end bg-slate-950/60 sm:place-items-center sm:p-4">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="procurement-v2-supply-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:max-w-2xl sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Phương án cung ứng</p>
          <h2 id="procurement-v2-supply-title" className="mt-1 text-xl font-bold">Chọn cách đáp ứng nhu cầu</h2>
          <p className="mt-1 text-sm text-slate-500">{demandLabel}</p></div>
        <button type="button" aria-label="Đóng phương án" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800"><X size={20} /></button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {unavailable.map(({ title, icon: Icon, reason }) => <div key={title} aria-disabled="true" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-500 dark:border-slate-700 dark:bg-slate-950/60">
          <div className="flex justify-between"><Icon size={21} /><LockKeyhole size={16} /></div>
          <h3 className="mt-3 font-semibold text-slate-700 dark:text-slate-200">{title}</h3><p className="mt-1 text-sm leading-6">{reason}</p>
        </div>)}
        <div className={`rounded-2xl border-2 p-4 ${canPurchase ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60'}`}>
          <div className="flex justify-between text-emerald-700"><FileText size={21} />{!canPurchase && <LockKeyhole size={16} />}</div>
          <h3 className="mt-3 font-semibold">Mua theo PO</h3>
          <p className="mt-1 text-sm leading-6">{canPurchase ? 'Chọn các dòng, nhà cung cấp và số lượng trên màn lập đơn mua.' : 'Hồ sơ cần đối chiếu trước khi lập PO.'}</p>
          {canPurchase && <button type="button" onClick={onPurchase} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">Tiếp tục lập PO<ArrowRight size={16} /></button>}
        </div>
      </div>
    </section>
  </div>;
};
