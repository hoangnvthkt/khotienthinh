import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import type { VerifiedResourceUsageEvidence } from '../../../types';

const formatNumber = (value: number | null | undefined) => value == null
  ? 'Chưa xác định' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

export const dailyLogEvidenceHref = (row: VerifiedResourceUsageEvidence): string => {
  const query = new URLSearchParams({ tab: 'dailylog', dailyLogId: row.dailyLogId });
  if (row.projectId) query.set('projectId', row.projectId);
  if (row.constructionSiteId) query.set('siteId', row.constructionSiteId);
  return `/da?${query.toString()}`;
};

interface ResourceUsageEvidenceDrawerProps {
  row: VerifiedResourceUsageEvidence;
  onClose: () => void;
}

export const ResourceUsageEvidenceDrawer: React.FC<ResourceUsageEvidenceDrawerProps> = ({ row, onClose }) => (
  <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="presentation" onClick={onClose}>
    <aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-2xl dark:bg-zinc-950 sm:p-7"
      role="dialog" aria-modal="true" aria-label="Chi tiết bằng chứng nguồn lực" onClick={event => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Bằng chứng đã xác nhận</p>
          <h3 className="mt-1 text-xl font-bold text-zinc-950 dark:text-white">{row.taskName}</h3>
          <p className="mt-1 text-sm text-zinc-500">{row.logDate} · Nhật ký #{row.dailyLogId.slice(0, 8)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng chi tiết" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-teal-50 p-4 dark:bg-teal-950/30">
          <p className="text-xs text-teal-800 dark:text-teal-300">Số lượng</p>
          <p className="mt-1 text-lg font-bold text-teal-950 dark:text-teal-100">{row.resourceType === 'labor' ? `${formatNumber(row.peopleCount)} người` : `${formatNumber(row.machineCount)} máy`}</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-4 dark:bg-sky-950/30">
          <p className="text-xs text-sky-800 dark:text-sky-300">Tổng thời gian</p>
          <p className="mt-1 text-lg font-bold text-sky-950 dark:text-sky-100">{row.resourceType === 'labor' ? `${formatNumber(row.totalLaborHours)} giờ công` : `${formatNumber(row.totalMachineHours)} giờ máy`}</p>
        </div>
      </div>
      <dl className="mt-6 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {[
          ['Nguồn cung cấp', row.provider.entryMode === 'catalog' ? row.provider.providerNameSnapshot : row.provider.manualProviderName],
          ['Loại nguồn', row.provider.entryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'],
          ['Khu vực', `${row.workAreaCode || '—'} · ${row.workAreaName || 'Chưa ghi khu vực'}`],
          ['WBS', `${row.wbsCode || '—'} · ${row.taskName}`],
          ['Đóng góp', row.contributionId],
          ['Người báo cáo', row.sourceUserName || 'Chưa ghi nhận'],
          ['Người xác nhận', row.verifiedByName || 'Chưa ghi nhận'],
          ['Lần xác nhận', row.verifiedAt],
          ['Phiên bản', `Lần ${row.revisionNo} · ${row.revisionState === 'current' ? 'Hiện hành' : 'Đã thay thế'}`],
        ].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-zinc-500">{label}</dt><dd className="text-right font-medium text-zinc-900 dark:text-zinc-100">{value}</dd></div>)}
      </dl>
      <Link to={dailyLogEvidenceHref(row)} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white hover:bg-teal-800">
        Mở Nhật ký gốc <ArrowUpRight size={16} />
      </Link>
    </aside>
  </div>
);
