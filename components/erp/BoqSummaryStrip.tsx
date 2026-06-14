import React from 'react';
import StatusBadge from './StatusBadge';

type BoqSummaryStripProps = {
  budgetQty: number;
  reservedQty: number;
  currentQty?: number;
  availableQty: number;
  overBudgetQty?: number;
  unit?: string | null;
  pendingCount?: number;
  compact?: boolean;
};

const fmt = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const BoqSummaryStrip: React.FC<BoqSummaryStripProps> = ({
  budgetQty,
  reservedQty,
  currentQty = 0,
  availableQty,
  overBudgetQty = 0,
  unit,
  pendingCount = 0,
  compact = false,
}) => {
  const isOver = overBudgetQty > 0 || availableQty < 0;
  const unitLabel = unit || '';
  const cellClass = compact ? 'px-2 py-1.5' : 'px-3 py-2';

  return (
    <div className={`rounded-lg border ${isOver ? 'border-orange-200 bg-orange-50/60' : 'border-slate-200 bg-white'} dark:border-slate-700 dark:bg-slate-900`}>
      <div className={`grid grid-cols-2 gap-1 text-[10px] font-bold text-slate-500 ${compact ? 'md:grid-cols-4' : 'md:grid-cols-5'}`}>
        <div className={cellClass}>
          <div className="font-black uppercase text-slate-400">Định mức</div>
          <div className="mt-0.5 text-slate-800 dark:text-slate-100">{fmt(budgetQty)} {unitLabel}</div>
        </div>
        <div className={cellClass}>
          <div className="font-black uppercase text-slate-400">Đã giữ/nhận</div>
          <div className="mt-0.5 text-slate-800 dark:text-slate-100">{fmt(reservedQty)} {unitLabel}</div>
        </div>
        {!compact && (
          <div className={cellClass}>
            <div className="font-black uppercase text-slate-400">Dòng hiện tại</div>
            <div className="mt-0.5 text-slate-800 dark:text-slate-100">{fmt(currentQty)} {unitLabel}</div>
          </div>
        )}
        <div className={cellClass}>
          <div className="font-black uppercase text-slate-400">Khả dụng</div>
          <div className={`mt-0.5 ${availableQty < 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{fmt(Math.max(0, availableQty))} {unitLabel}</div>
        </div>
        <div className={`${cellClass} flex flex-col items-start gap-1`}>
          <div className="font-black uppercase text-slate-400">Kiểm soát</div>
          <StatusBadge
            status={isOver ? 'overdue' : 'completed'}
            label={isOver ? `Vượt ${fmt(Math.max(overBudgetQty, Math.abs(Math.min(availableQty, 0))))} ${unitLabel}` : 'Trong định mức'}
            tone={isOver ? 'attention' : 'success'}
          />
          {pendingCount > 0 && <span className="text-[9px] font-black text-amber-600">{pendingCount} phiếu giữ chỗ</span>}
        </div>
      </div>
    </div>
  );
};

export default BoqSummaryStrip;
