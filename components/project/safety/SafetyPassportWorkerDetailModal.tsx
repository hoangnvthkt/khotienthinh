import React from 'react';
import { AlertTriangle, RefreshCw, UserRound, X } from 'lucide-react';
import type { SafetyWorkforceRequestScope } from '../../../lib/safetyWorkforceApi';
import { useSafetyWorkerDetail } from '../../../hooks/useSafetyWorkforce';

interface Props {
  scope: SafetyWorkforceRequestScope;
  membershipId: string;
  onClose: () => void;
}

const membershipLabel = (status: string): string => {
  if (status === 'active') return 'Đang tham gia';
  if (status === 'candidate') return 'Chờ gán';
  return 'Đã rời công trường';
};

const assignmentLabel = (status?: string): string => {
  if (status === 'active') return 'Đang làm tại công trường';
  if (status === 'suspended') return 'Tạm dừng';
  return 'Chưa được gán';
};

const SafetyPassportWorkerDetailModal: React.FC<Props> = ({ scope, membershipId, onClose }) => {
  const state = useSafetyWorkerDetail(scope, membershipId, false);
  const detail = state.data;
  const item = detail?.rosterItem;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-3 py-5" role="dialog" aria-modal="true" aria-labelledby="safety-worker-detail-title">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-orange-600">Hồ sơ nhân công</div>
            <h2 id="safety-worker-detail-title" className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">Chi tiết tại công trường</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">Thông tin cơ bản được giới hạn theo công trường đang chọn.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-5 dark:bg-slate-950/40">
          {state.loading && !detail && (
            <div className="space-y-3" aria-label="Đang tải chi tiết hồ sơ">
              <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              <div className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
            </div>
          )}

          {state.error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black">Không tải được hồ sơ nhân công</div>
                <p className="mt-1 text-xs">{state.error.message}</p>
              </div>
              <button type="button" onClick={() => { void state.reload(); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-black text-red-700 dark:bg-slate-950 dark:text-red-200">
                <RefreshCw size={13} /> Thử lại
              </button>
            </div>
          )}

          {detail && item && (
            <div className="space-y-4">
              <section className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">
                  {item.worker.photoUrl
                    ? <img src={item.worker.photoUrl} alt={`Ảnh ${item.worker.fullName}`} className="h-full w-full object-cover" />
                    : <UserRound size={22} />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-black text-slate-900 dark:text-slate-100">{item.worker.fullName}</h3>
                  <div className="mt-1 font-mono text-xs font-bold text-orange-700 dark:text-orange-300">{item.worker.workerCode}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{membershipLabel(item.membership.status)}</span>
                    <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{assignmentLabel(item.activeAssignment?.assignmentStatus)}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Thông tin cơ bản</h3>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="font-bold text-slate-400">Loại nhân sự</dt><dd className="mt-1 font-black text-slate-700 dark:text-slate-200">{detail.profile.workerKind === 'company_staff' ? 'Cán bộ công ty' : 'Nhân công nhà thầu'}</dd></div>
                  <div><dt className="font-bold text-slate-400">Điện thoại</dt><dd className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">{detail.profile.phone || '-'}</dd></div>
                  <div><dt className="font-bold text-slate-400">Nhà thầu phụ</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{item.subcontractor?.name || '-'}</dd></div>
                  <div><dt className="font-bold text-slate-400">Tổ đội</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{item.team?.name || '-'}</dd></div>
                  <div><dt className="font-bold text-slate-400">CCCD</dt><dd className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">{item.identityNumberMasked}</dd></div>
                  <div><dt className="font-bold text-slate-400">Chức danh</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{detail.profile.roleName || '-'}</dd></div>
                </dl>
              </section>
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg bg-slate-900 px-4 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900">Đóng</button>
        </footer>
      </div>
    </div>
  );
};

export default SafetyPassportWorkerDetailModal;
