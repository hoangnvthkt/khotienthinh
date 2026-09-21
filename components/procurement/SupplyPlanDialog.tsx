import React, { useEffect, useRef } from 'react';
import { ArrowRight, Boxes, FileText, LockKeyhole, Truck, X } from 'lucide-react';

const unavailable = [
  { icon: Boxes, title: 'Cấp từ kho', reason: 'Chưa mở command giữ tồn theo demand allocation.' },
  { icon: Truck, title: 'Chuyển kho', reason: 'Chưa mở command hai chặng và trạng thái đang vận chuyển.' },
  { icon: FileText, title: 'Gọi hàng theo HĐ', reason: 'Chỉ mở khi revision, điều khoản và hạn mức được cấu hình ở server.' },
];

export const SupplyPlanDialog: React.FC<{
  open: boolean;
  demandLabel: string;
  onClose: () => void;
  onContinuePurchase: () => void;
}> = ({ open, demandLabel, onClose, onContinuePurchase }) => {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.requestAnimationFrame(() => previousFocusRef.current?.focus());
    };
  }, [onClose, open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[60] grid place-items-end bg-slate-950/55 p-0 sm:place-items-center sm:p-4">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="supply-plan-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-slate-900 sm:max-w-2xl sm:rounded-2xl sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Phương án cung ứng</p>
          <h2 id="supply-plan-title" className="mt-1 text-xl font-black">Chọn cách đáp ứng nhu cầu</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">{demandLabel}</p>
        </div>
        <button autoFocus type="button" aria-label="Đóng phương án" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:hover:bg-slate-800"><X size={19} /></button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onContinuePurchase} className="group rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-emerald-950/30">
          <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white"><FileText size={19} /></span><ArrowRight className="text-emerald-700 transition group-hover:translate-x-1" size={19} /></div>
          <h3 className="mt-3 font-black text-emerald-950 dark:text-emerald-100">Mua theo PO</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-emerald-800 dark:text-emerald-300">Tiếp tục tại màn lập PO tương thích. PO, liên kết nhu cầu và allocation được lưu trong một transaction.</p>
        </button>
        {unavailable.map(option => {
          const Icon = option.icon;
          return <div key={option.title} aria-disabled="true" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-200 text-slate-500 dark:bg-slate-800"><Icon size={19} /></span><LockKeyhole size={17} /></div>
            <h3 className="mt-3 font-black text-slate-700 dark:text-slate-200">{option.title}</h3>
            <p className="mt-1 text-xs font-semibold leading-5">{option.reason}</p>
          </div>;
        })}
      </div>
    </section>
  </div>;
};
