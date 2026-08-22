import React from 'react';
import { AlertTriangle, RefreshCw, Users } from 'lucide-react';
import type { SafetyWorkerRosterPage, User } from '../../../../types';
import type { SafetyWorkforceRequestScope } from '../../../../lib/safetyWorkforceApi';
import { useSafetyActiveWorkforce } from '../../../../hooks/useSafetyWorkforce';

interface ScopedViewProps {
  scope: SafetyWorkforceRequestScope;
  currentUser: User;
}

interface ActiveWorkforceContentProps {
  page: SafetyWorkerRosterPage | null;
  loading: boolean;
  error: { message: string } | null;
  onRetry: () => void;
}

const eligibilityLabel = (status?: string): string => {
  if (status === 'eligible') return 'Đủ điều kiện';
  if (status === 'suspended') return 'Tạm khóa';
  return 'Cần bổ sung';
};

export const SafetyActiveWorkforceContent: React.FC<ActiveWorkforceContentProps> = ({
  page,
  loading,
  error,
  onRetry,
}) => (
  <section className="space-y-4">
    <div>
      <h2 className="text-base font-black text-slate-900 dark:text-slate-100">Nhân công công trường</h2>
      <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Chỉ hiển thị nhân công đang được gán vào công trường này.</p>
    </div>

    {error && (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
        <AlertTriangle className="mt-0.5 text-red-600" size={17} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-red-900 dark:text-red-200">Không tải được nhân công công trường</div>
          <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error.message}</p>
        </div>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-700 active:translate-y-px dark:bg-slate-950">
          <RefreshCw size={13} /> Thử lại
        </button>
      </div>
    )}

    {loading && !page ? (
      <div className="space-y-2" aria-label="Đang tải nhân công công trường">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
        ))}
      </div>
    ) : !error && (page?.items.length || 0) === 0 ? (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
        <Users className="mx-auto text-slate-400" size={22} />
        <h3 className="mt-3 text-sm font-black text-slate-800 dark:text-slate-100">Chưa có nhân công đang làm việc</h3>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Gán hồ sơ nhân công vào công trường để bắt đầu theo dõi.</p>
      </div>
    ) : !error && page ? (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-black">Nhân công</th>
              <th className="px-4 py-3 font-black">Nhà thầu / Tổ đội</th>
              <th className="px-4 py-3 font-black">Ngày vào</th>
              <th className="px-4 py-3 font-black">Điều kiện</th>
              <th className="px-4 py-3 font-black">Thẻ an toàn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {page.items.map(item => (
              <tr key={item.membership.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3">
                  <div className="font-black text-slate-800 dark:text-slate-100">{item.worker.fullName}</div>
                  <div className="mt-0.5 font-mono text-[11px] font-bold text-orange-700 dark:text-orange-300">{item.worker.workerCode}</div>
                </td>
                <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">{item.team?.name || item.subcontractor?.name || 'Cán bộ công ty'}</td>
                <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{item.activeAssignment?.startDate || '-'}</td>
                <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{eligibilityLabel(item.activeAssignment?.eligibilityStatus)}</span></td>
                <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-300">{item.activeCard?.cardCode || 'Chưa cấp'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null}
  </section>
);

const SafetyActiveWorkforceView: React.FC<ScopedViewProps> = ({ scope }) => {
  const state = useSafetyActiveWorkforce(scope, { limit: 50 });
  return (
    <SafetyActiveWorkforceContent
      page={state.data}
      loading={state.loading}
      error={state.error}
      onRetry={() => { void state.reload(); }}
    />
  );
};

export default SafetyActiveWorkforceView;
