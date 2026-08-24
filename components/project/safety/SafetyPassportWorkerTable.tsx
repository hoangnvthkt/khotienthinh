import React from 'react';
import { CreditCard, Eye, LogOut, Plus, Users } from 'lucide-react';
import type { SafetyWorkerRosterItem } from '../../../types';

interface Props {
  items: SafetyWorkerRosterItem[];
  loading?: boolean;
  canManage?: boolean;
  onCreateAssignment: () => void;
  onOpenDetail: (item: SafetyWorkerRosterItem) => void;
  onEnd: (item: SafetyWorkerRosterItem) => void;
  onTransfer?: (item: SafetyWorkerRosterItem) => void;
  onIssueCard: (item: SafetyWorkerRosterItem) => void;
}

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN');
};

const readinessLabel = (status: string): string => {
  if (status === 'valid') return 'Đã đủ';
  if (status === 'expired') return 'Hết hạn';
  if (status === 'rejected') return 'Từ chối';
  return 'Thiếu';
};

const eligibilityLabel = (status?: string): string => {
  if (status === 'eligible') return 'Đủ điều kiện';
  if (status === 'suspended') return 'Tạm khóa';
  return 'Cần bổ sung';
};

const SafetyPassportWorkerTable: React.FC<Props> = ({
  items,
  loading = false,
  canManage = true,
  onCreateAssignment,
  onOpenDetail,
  onEnd,
  onTransfer,
  onIssueCard,
}) => {
  if (!loading && items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
        <Users className="mx-auto text-slate-400" size={22} />
        <h3 className="mt-3 text-sm font-black text-slate-800 dark:text-slate-100">Chưa có nhân công đang làm việc</h3>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Gán hồ sơ nhân công vào công trường để bắt đầu theo dõi.</p>
        {canManage && <button type="button" onClick={onCreateAssignment} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900"><Plus size={14} /> Gán nhân công</button>}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[1180px] text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-black">Nhân công</th>
            <th className="px-4 py-3 font-black">Nhà thầu / Tổ đội</th>
            <th className="px-4 py-3 font-black">Ngày vào</th>
            <th className="px-4 py-3 font-black">Hồ sơ</th>
            <th className="px-4 py-3 font-black">Sức khỏe</th>
            <th className="px-4 py-3 font-black">Bảo hiểm</th>
            <th className="px-4 py-3 font-black">Điều kiện</th>
            <th className="px-4 py-3 font-black">Thẻ an toàn</th>
            <th className="px-4 py-3 text-right font-black">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map(item => (
            <tr key={item.membership.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <td className="px-4 py-3"><div className="font-black text-slate-800 dark:text-slate-100">{item.worker.fullName}</div><div className="mt-0.5 font-mono text-[11px] font-bold text-orange-700 dark:text-orange-300">{item.worker.workerCode}</div></td>
              <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">{item.team?.name || item.subcontractor?.name || 'Cán bộ công ty'}</td>
              <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{formatDate(item.activeAssignment?.startedAt)}</td>
              <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-300">{readinessLabel(item.profileStatus)}</td>
              <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-300">{readinessLabel(item.healthStatus)}</td>
              <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-300">{readinessLabel(item.insuranceStatus)}</td>
              <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{eligibilityLabel(item.activeAssignment?.eligibilityStatus)}</span></td>
              <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-300">{item.activeCard?.cardCode || 'Chưa cấp'}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => onOpenDetail(item)} aria-label={`Xem ${item.worker.fullName}`} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Eye size={14} /></button>
                  {canManage && item.activeAssignment?.eligibilityStatus === 'eligible' && !item.activeCard && <button type="button" onClick={() => onIssueCard(item)} aria-label={`Cấp thẻ ${item.worker.fullName}`} className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700"><CreditCard size={14} /></button>}
                  {canManage && onTransfer && <button type="button" onClick={() => onTransfer(item)} className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 text-[11px] font-black text-orange-700">Điều chuyển</button>}
                  {canManage && item.activeAssignment && <button type="button" onClick={() => onEnd(item)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 text-[11px] font-black text-red-700"><LogOut size={13} /> Kết thúc</button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SafetyPassportWorkerTable;
