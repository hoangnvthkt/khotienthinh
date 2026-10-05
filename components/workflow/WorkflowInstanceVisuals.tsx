import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { User, WorkflowInstanceStatus } from '../../types';
import { formatWaitDuration, type WorkflowInstanceInsight } from '../../lib/workflowInstanceInsight';

// Small, props-only pieces shared by the Quy trình list, Kanban cards and the quick-look panel.

export const WfBadge: React.FC<{ className: string; title?: string; children: React.ReactNode }> = ({ className, title, children }) => (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
);

export const WORKFLOW_STATUS_STYLE: Record<WorkflowInstanceStatus, { label: string; className: string }> = {
    [WorkflowInstanceStatus.DRAFT]: { label: 'Bản nháp', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    [WorkflowInstanceStatus.RUNNING]: { label: 'Đang xử lý', className: 'border-sky-200 bg-sky-50 text-sky-700' },
    [WorkflowInstanceStatus.COMPLETED]: { label: 'Hoàn thành', className: 'border-mint-200 bg-mint-50 text-mint-800' },
    [WorkflowInstanceStatus.REJECTED]: { label: 'Từ chối', className: 'border-rose-200 bg-rose-50 text-rose-700' },
    [WorkflowInstanceStatus.CANCELLED]: { label: 'Đã hủy', className: 'border-slate-200 bg-slate-100 text-slate-500' },
};

export const WorkflowStatusBadge: React.FC<{ status: WorkflowInstanceStatus }> = ({ status }) => (
    <WfBadge className={WORKFLOW_STATUS_STYLE[status].className}>{WORKFLOW_STATUS_STYLE[status].label}</WfBadge>
);

/** "Chờ bạn duyệt": the call to action of the whole module, so it breathes slowly. */
export const WaitingForYouBadge: React.FC<{ short?: boolean }> = ({ short }) => (
    <WfBadge className="wf-pulse border-amber-200 bg-amber-50 text-amber-700">{short ? 'Chờ bạn' : 'Chờ bạn duyệt'}</WfBadge>
);

const AVATAR_TONES = ['bg-mint-100 text-mint-800', 'bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-teal-100 text-teal-800'];
const avatarTone = (id: string) => AVATAR_TONES[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length];
const initials = (name = '?') => name.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase();

export const WorkflowAvatar: React.FC<{ user?: Pick<User, 'id' | 'name' | 'avatar'>; fallbackId: string; size?: number }> = ({ user, fallbackId, size = 24 }) => (
    <span
        title={user?.name}
        style={{ width: size, height: size }}
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white text-[10px] font-bold dark:border-slate-800 ${avatarTone(fallbackId)}`}
    >
        {user?.avatar ? <img src={user.avatar} alt={user.name} className="h-full w-full object-cover" /> : initials(user?.name)}
    </span>
);

/** Who is holding the ticket right now. An empty list is a problem worth showing, not a blank. */
export const WorkflowHandlers: React.FC<{ handlerIds: string[]; users: User[]; compact?: boolean }> = ({ handlerIds, users, compact }) => {
    if (handlerIds.length === 0) {
        return <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600"><AlertTriangle size={12} />Chưa giao người xử lý</span>;
    }
    const people = handlerIds.map(id => ({ id, user: users.find(item => item.id === id) }));
    const first = people[0].user;
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex shrink-0 -space-x-1.5">
                {people.slice(0, 3).map(person => <WorkflowAvatar key={person.id} user={person.user} fallbackId={person.id} size={compact ? 22 : 26} />)}
            </span>
            <span className="min-w-0 truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={people.map(person => person.user?.name).filter(Boolean).join(', ')}>
                {first?.name || 'Người dùng'}{people.length > 1 ? ` +${people.length - 1}` : ''}
            </span>
        </span>
    );
};

/** Dots along the ticket's path: done, current (ringed), still to come. */
export const WorkflowStepper: React.FC<{ stepLabels: string[]; stepIndex: number; running: boolean; overdue?: boolean }> = ({ stepLabels, stepIndex, running, overdue }) => (
    <span className="flex items-center" aria-hidden>
        {stepLabels.map((label, index) => {
            const done = index < stepIndex;
            const current = running && index === stepIndex;
            const tone = current
                ? (overdue ? 'bg-rose-500 ring-4 ring-rose-100' : 'bg-mint-600 ring-4 ring-mint-100')
                : done ? 'bg-mint-400' : 'border-2 border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800';
            return (
                <React.Fragment key={`${label}-${index}`}>
                    <span title={label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
                    {index < stepLabels.length - 1 && <span className={`h-0.5 w-5 ${index < stepIndex ? 'bg-mint-300' : 'bg-slate-200 dark:bg-slate-600'}`} />}
                </React.Fragment>
            );
        })}
    </span>
);

/** How long the ticket has waited at this step, or why it needs attention. */
export const WorkflowWaitChip: React.FC<{ insight: WorkflowInstanceInsight; status: WorkflowInstanceStatus }> = ({ insight, status }) => {
    if (status !== WorkflowInstanceStatus.RUNNING) return null;
    const sla = insight.currentNode?.config?.slaHours;
    if (insight.overdue) {
        return <WfBadge className="wf-pulse border-rose-200 bg-rose-50 text-rose-700">Quá hạn {formatWaitDuration(insight.sinceHours - (sla as number))}</WfBadge>;
    }
    if (insight.stale) {
        return <WfBadge className="wf-pulse border-amber-200 bg-amber-50 text-amber-700">Đứng yên {formatWaitDuration(insight.sinceHours)}</WfBadge>;
    }
    return (
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Clock size={12} />{formatWaitDuration(insight.sinceHours)}{sla ? ` · hạn ${sla}h` : ''}
        </span>
    );
};
