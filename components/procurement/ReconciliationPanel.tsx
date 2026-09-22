import React from 'react';
import { AlertTriangle, DatabaseZap, X } from 'lucide-react';
import type { ProcurementWorkbenchRow } from '../../types/procurementWorkbench';

export const ReconciliationPanel: React.FC<{
  row: ProcurementWorkbenchRow;
  onClose: () => void;
}> = ({ row, onClose }) => (
  <aside aria-label="Chi tiết đối chiếu" className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-xl dark:border-amber-900 dark:bg-slate-900">
    <div className="flex items-start justify-between border-b border-amber-100 bg-amber-50/70 px-4 py-4 dark:border-amber-900 dark:bg-amber-950/30">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Dữ liệu cần đối chiếu</p>
        <h2 className="mt-1 text-lg font-black">{row.title}</h2>
        <p className="mt-1 font-mono text-xs font-bold text-slate-500">{row.sourceCode}</p>
      </div>
      <button type="button" aria-label="Đóng đối chiếu" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-amber-900/50"><X size={19} /></button>
    </div>

    <div className="flex-1 space-y-4 p-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
        <div className="flex items-center gap-2 font-black text-amber-900 dark:text-amber-200"><AlertTriangle size={18} />Chưa thể mở hồ sơ hoặc lập đơn mua</div>
        <p className="mt-2 text-sm font-semibold leading-6 text-amber-800 dark:text-amber-300">Dòng dữ liệu cũ này chưa có định danh nhu cầu và bằng chứng phân bổ nhận hàng. Hệ thống giữ số còn bố trí ở trạng thái “Chưa xác định” để tránh mua trùng.</p>
      </div>

      <dl className="grid gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
        <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">Nguồn</dt><dd className="mt-1 font-bold">{row.sourceCode}</dd></div>
        <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">Điểm nhận</dt><dd className="mt-1 font-bold">{row.destinationLabel || 'Chưa có điểm nhận'}</dd></div>
        <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">Trạng thái xử lý</dt><dd className="mt-1 font-bold text-amber-700 dark:text-amber-300">Chờ chủ dữ liệu xác minh nguồn và liên kết chứng từ</dd></div>
      </dl>

      <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950/60">
        <div className="flex items-center gap-2 font-black"><DatabaseZap size={17} className="text-slate-500" />Việc cần làm tiếp theo</div>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">Gửi mã nguồn trên cho người phụ trách đối chiếu dữ liệu. Chỉ khi nguồn được xác minh và tạo hồ sơ nhu cầu có phiên bản, Buyer mới có thể phân công hoặc lập phương án mua.</p>
      </div>
    </div>
  </aside>
);
