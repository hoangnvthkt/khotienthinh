import React from 'react';
import { ArrowRightLeft, Building2, UserRoundCog } from 'lucide-react';
import type { HrmEmployeeOrganizationSummary } from '../../../types/hrmSharedCatalog';

export interface HrmEmployeeOrganizationCardProps {
  summary: HrmEmployeeOrganizationSummary | null;
  unitName?: string | null;
  positionName?: string | null;
  positionGroup?: string | null;
  managerName?: string | null;
  canManage: boolean;
  onManage(): void;
}

const HrmEmployeeOrganizationCard: React.FC<HrmEmployeeOrganizationCardProps> = ({
  summary,
  unitName,
  positionName,
  positionGroup,
  managerName,
  canManage,
  onManage,
}) => {
  const assigned = summary?.status === 'ASSIGNED';

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800/50 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300">
            <Building2 size={19} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">Cơ cấu tổ chức</h3>
              <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${assigned ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                {assigned ? 'Đã phân bổ' : 'Chờ phân bổ'}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              Thông tin này được quản lý từ Sơ đồ tổ chức và định biên.
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={onManage}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-indigo-700 px-3.5 py-2.5 text-xs font-black text-white transition hover:bg-indigo-800 active:scale-[0.98]"
          >
            <ArrowRightLeft size={14} /> Phân bổ / Chuyển vị trí
          </button>
        )}
      </div>

      {assigned ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-bold text-slate-500">Đơn vị trực thuộc</dt>
            <dd className="mt-0.5 text-sm font-black text-slate-800 dark:text-slate-100">{unitName || 'Chưa xác định'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-slate-500">Vị trí công việc</dt>
            <dd className="mt-0.5 text-sm font-black text-slate-800 dark:text-slate-100">{positionName || 'Chưa xác định'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-slate-500">Cấp bậc và nhóm VTCV</dt>
            <dd className="mt-0.5 text-sm font-black text-slate-800 dark:text-slate-100">
              {summary.levelCode || 'Chưa cấp bậc'}{positionGroup ? ` (${positionGroup})` : ''}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-[11px] font-bold text-slate-500"><UserRoundCog size={13} /> Quản lý trực tiếp</dt>
            <dd className="mt-0.5 text-sm font-black text-slate-800 dark:text-slate-100">{managerName || 'Chưa có người đảm nhiệm'}</dd>
          </div>
        </dl>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-white/70 px-4 py-4 text-sm font-semibold text-amber-900 dark:bg-slate-900/40 dark:text-amber-200">
          Nhân sự chưa thuộc định biên chính thức. Hồ sơ cá nhân vẫn có thể được lưu trước khi phân bổ.
        </div>
      )}
    </section>
  );
};

export default HrmEmployeeOrganizationCard;
