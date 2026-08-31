import React from 'react';
import { CheckCircle2, Clock3, RotateCcw, XCircle } from 'lucide-react';
import type { RequestListItem, RequestUserSnapshot } from '../../lib/requestRuntimeService';

const statusStyle: Record<RequestListItem['status'], { label: string; className: string; Icon: typeof Clock3 }> = {
  DRAFT: { label: 'Nháp', className: 'bg-slate-100 text-slate-600', Icon: Clock3 },
  PENDING: { label: 'Chờ duyệt', className: 'bg-amber-100 text-amber-800', Icon: Clock3 },
  RETURNED: { label: 'Đã trả lại', className: 'bg-orange-100 text-orange-800', Icon: RotateCcw },
  APPROVED: { label: 'Đã chấp thuận', className: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
  REJECTED: { label: 'Đã từ chối', className: 'bg-rose-100 text-rose-800', Icon: XCircle },
  CANCELLED: { label: 'Đã hủy', className: 'bg-slate-100 text-slate-600', Icon: XCircle },
};

const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export const RequestStatusBadge: React.FC<{ status: RequestListItem['status'] }> = ({ status }) => {
  const item = statusStyle[status];
  const Icon = item.Icon;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs font-semibold ${item.className}`}><Icon size={13} />{item.label}</span>;
};

const RequestUserAvatar: React.FC<{ user: RequestUserSnapshot; className?: string }> = ({ user, className = 'h-7 w-7' }) => {
  const initial = user.name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden rounded-full bg-emerald-100 text-emerald-800 ${className}`}>
      {user.avatarUrl && (
        <img
          src={user.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={event => {
            event.currentTarget.classList.add('hidden');
            event.currentTarget.nextElementSibling?.classList.remove('hidden');
          }}
        />
      )}
      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${user.avatarUrl ? 'hidden' : ''}`} aria-hidden="true">
        {initial}
      </span>
    </span>
  );
};

const RequestUserIdentity: React.FC<{ user: RequestUserSnapshot }> = ({ user }) => (
  <div className="flex min-w-0 items-center gap-2">
    <RequestUserAvatar user={user} />
    <span className="truncate">{user.name}</span>
  </div>
);

const ApproverProgress: React.FC<{ item: RequestListItem }> = ({ item }) => (
  <div className="flex -space-x-2" aria-label={`${item.activeApprovers.length} người đang duyệt`}>
    {item.activeApprovers.slice(0, 4).map(approver => (
      <span key={approver.id} title={approver.name} className="rounded-full border-2 border-white dark:border-slate-900">
        <RequestUserAvatar user={approver} className="h-6 w-6" />
      </span>
    ))}
    {item.activeApprovers.length > 4 && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-bold text-slate-600 dark:border-slate-900">+{item.activeApprovers.length - 4}</span>}
  </div>
);

export const RequestTable: React.FC<{
  items: RequestListItem[];
  onSelect: (requestId: string) => void;
}> = ({ items, onSelect }) => (
  <div className="hidden min-w-0 overflow-auto md:block">
    <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left">
      <thead className="sticky top-0 z-10 bg-white shadow-sm dark:bg-slate-900"><tr className="text-xs font-semibold uppercase tracking-wide text-slate-400"><th className="w-12 px-4 py-3"><input aria-label="Chọn tất cả đề xuất" type="checkbox" disabled /></th><th className="px-3 py-3">Đề xuất</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3">Người tạo</th><th className="px-3 py-3">Người duyệt</th><th className="px-4 py-3">Cập nhật</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.id} onClick={() => onSelect(item.id)} className="cursor-pointer border-b border-slate-100 text-sm hover:bg-emerald-50/70 dark:border-slate-800 dark:hover:bg-emerald-950/20"><td className="border-b border-slate-100 px-4 py-3 dark:border-slate-800" onClick={event => event.stopPropagation()}><input aria-label={`Chọn ${item.title}`} type="checkbox" /></td><td className="max-w-xl border-b border-slate-100 px-3 py-3 dark:border-slate-800"><p className="truncate font-semibold text-slate-800 dark:text-white">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.code} · {item.templateName}</p></td><td className="border-b border-slate-100 px-3 py-3 dark:border-slate-800"><RequestStatusBadge status={item.status} /></td><td className="border-b border-slate-100 px-3 py-3 text-slate-600 dark:border-slate-800 dark:text-slate-300"><RequestUserIdentity user={item.creator} /></td><td className="border-b border-slate-100 px-3 py-3 dark:border-slate-800"><ApproverProgress item={item} /></td><td className="whitespace-nowrap border-b border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">{dateTime(item.updatedAt)}</td></tr>)}</tbody>
    </table>
  </div>
);
