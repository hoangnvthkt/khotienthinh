import React from 'react';
import { Check, CheckCircle2, Clock3, RotateCcw, X, XCircle } from 'lucide-react';
import type { RequestAssignmentStatus } from '../../types';
import type { RequestListItem, RequestUserSnapshot } from '../../lib/requestRuntimeService';
import { REQUEST_ASSIGNMENT_STATUS_LABELS, REQUEST_STATUS_LABELS } from '../../lib/requestLabels';
import { useRequestHoverPreview } from './RequestHoverPreview';

const statusStyle: Record<RequestListItem['status'], { label: string; className: string; Icon: typeof Clock3 }> = {
  DRAFT: { label: REQUEST_STATUS_LABELS.DRAFT, className: 'bg-muted text-muted-foreground', Icon: Clock3 },
  PENDING: { label: REQUEST_STATUS_LABELS.PENDING, className: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900', Icon: Clock3 },
  RETURNED: { label: REQUEST_STATUS_LABELS.RETURNED, className: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-900', Icon: RotateCcw },
  APPROVED: { label: REQUEST_STATUS_LABELS.APPROVED, className: 'bg-leaf-600 text-white dark:bg-leaf-700', Icon: CheckCircle2 },
  REJECTED: { label: REQUEST_STATUS_LABELS.REJECTED, className: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900', Icon: XCircle },
  CANCELLED: { label: REQUEST_STATUS_LABELS.CANCELLED, className: 'bg-muted text-muted-foreground', Icon: XCircle },
};

const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export const RequestStatusBadge: React.FC<{ status: RequestListItem['status'] }> = ({ status }) => {
  const item = statusStyle[status];
  const Icon = item.Icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 badge-no-squeeze ${item.className}`}>
      <Icon size={12} className="shrink-0" />
      <span>{item.label}</span>
    </span>
  );
};

export const RequestUserAvatar: React.FC<{ user: RequestUserSnapshot; className?: string }> = ({ user, className = 'h-7 w-7' }) => {
  const initial = user.name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <span className={`relative inline-flex shrink-0 overflow-hidden rounded-full bg-mint-100 text-mint-800 dark:bg-mint-900/60 dark:text-mint-100 ${className}`}>
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
    <span className="truncate font-medium text-mint-700 dark:text-mint-300">{user.name}</span>
  </div>
);

type ApproverEntry = RequestUserSnapshot & { assignmentStatus: RequestAssignmentStatus };

// When one person approves several steps, show them once with the status
// that matters most to the reader.
const STATUS_WEIGHT: Record<RequestAssignmentStatus, number> = { REJECTED: 5, RETURNED: 4, PENDING: 3, APPROVED: 2, SKIPPED: 1, CANCELLED: 0 };
export const mergeApprovers = (entries: ApproverEntry[]): ApproverEntry[] => {
  const byId = new Map<string, ApproverEntry>();
  entries.forEach(entry => {
    const current = byId.get(entry.id);
    if (!current || STATUS_WEIGHT[entry.assignmentStatus] > STATUS_WEIGHT[current.assignmentStatus]) byId.set(entry.id, entry);
  });
  return [...byId.values()];
};

const BADGE: Partial<Record<RequestAssignmentStatus, { className: string; Icon: typeof Check }>> = {
  APPROVED: { className: 'bg-leaf-500', Icon: Check },
  REJECTED: { className: 'bg-rose-500', Icon: X },
  RETURNED: { className: 'bg-orange-500', Icon: RotateCcw },
};

/** Approver avatars with a status mark: ✓ approved, ✕ rejected, ↺ returned, amber ring = waiting. */
export const ApproverStack: React.FC<{ item: RequestListItem; max?: number }> = ({ item, max = 4 }) => {
  const approvers = mergeApprovers(item.approvers ?? item.activeApprovers);
  if (!approvers.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = approvers.slice(0, max);
  const summary = approvers.map(approver => `${approver.name}: ${REQUEST_ASSIGNMENT_STATUS_LABELS[approver.assignmentStatus]}`).join('\n');
  return (
    <div className="flex items-center gap-1.5" title={summary} aria-label={summary}>
      {shown.map(approver => {
        const badge = BADGE[approver.assignmentStatus];
        const waiting = approver.assignmentStatus === 'PENDING';
        return (
          <span key={approver.id} className={`relative inline-flex rounded-full ${approver.assignmentStatus === 'SKIPPED' ? 'opacity-40' : ''}`}>
            <span className={`rounded-full ${waiting ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-card' : ''}`}>
              <RequestUserAvatar user={approver} className="h-7 w-7" />
            </span>
            {badge && (
              <span className={`absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-white ring-2 ring-card ${badge.className}`}>
                <badge.Icon size={9} strokeWidth={3.5} />
              </span>
            )}
          </span>
        );
      })}
      {approvers.length > max && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white dark:bg-slate-600">{approvers.length - max}</span>}
    </div>
  );
};

export const RequestTable: React.FC<{
  items: RequestListItem[];
  onSelect: (requestId: string) => void;
}> = ({ items, onSelect }) => {
  const { bind, preview } = useRequestHoverPreview('below');
  return (
    <div className="hidden min-w-0 overflow-auto md:block">
      <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="border-b border-border px-4 py-2.5">Đề xuất</th>
            <th className="border-b border-border px-3 py-2.5">Trạng thái</th>
            <th className="border-b border-border px-3 py-2.5">Người tạo</th>
            <th className="border-b border-border px-3 py-2.5">Người duyệt</th>
            <th className="border-b border-border px-4 py-2.5 text-right">Cập nhật</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} onClick={() => onSelect(item.id)} className="group cursor-pointer text-sm transition-colors hover:bg-mint-50/60 dark:hover:bg-mint-900/20">
              <td className="max-w-xl border-b border-border px-4 py-3">
                <p className="flex min-w-0 items-baseline gap-2">
                  <span {...bind(item)} className="truncate font-semibold text-foreground group-hover:text-teal-700 dark:group-hover:text-teal-300">{item.title}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground"><span className="font-mono">{item.code}</span> · {item.templateName}</p>
              </td>
              <td className="border-b border-border px-3 py-3"><RequestStatusBadge status={item.status} /></td>
              <td className="border-b border-border px-3 py-3"><RequestUserIdentity user={item.creator} /></td>
              <td className="border-b border-border px-3 py-3"><ApproverStack item={item} /></td>
              <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">{dateTime(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview}
    </div>
  );
};
