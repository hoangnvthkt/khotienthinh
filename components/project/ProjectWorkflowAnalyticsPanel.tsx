import React, { useMemo } from 'react';
import { Activity, AlertTriangle, BarChart3, Clock, UserRound } from 'lucide-react';
import { MaterialRequest, ProjectWorkflowSubject, User } from '../../types';
import { getMaterialRequestSlaState } from '../../lib/materialRequestService';

interface Props {
  requests: MaterialRequest[];
  subjectsByRequestId: Record<string, ProjectWorkflowSubject>;
  users: User[];
}

const ProjectWorkflowAnalyticsPanel: React.FC<Props> = ({ requests, subjectsByRequestId, users }) => {
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const summary = useMemo(() => {
    const runningSubjects = requests
      .map(request => ({ request, subject: subjectsByRequestId[request.id] }))
      .filter(row => row.subject?.status === 'RUNNING');
    const overdueCount = runningSubjects.filter(row => getMaterialRequestSlaState(row.request) === 'overdue').length;
    const returnedCount = requests.filter(request => subjectsByRequestId[request.id]?.status === 'RETURNED' || request.workflowStep === 'returned_to_creator').length;
    const byStep = new Map<string, { label: string; count: number; overdueCount: number }>();
    const workload = new Map<string, { pendingCount: number; overdueCount: number }>();

    runningSubjects.forEach(({ request, subject }) => {
      const label = subject?.currentRuntimeNode?.label || subject?.currentNode?.label || request.workflowStep || 'Không rõ bước';
      const step = byStep.get(label) || { label, count: 0, overdueCount: 0 };
      step.count += 1;
      if (getMaterialRequestSlaState(request) === 'overdue') step.overdueCount += 1;
      byStep.set(label, step);

      const assigneeIds = subject?.currentAssigneeUserIds?.length
        ? subject.currentAssigneeUserIds
        : subject?.currentAssigneeUserId
          ? [subject.currentAssigneeUserId]
          : [];
      assigneeIds.forEach(userId => {
        const row = workload.get(userId) || { pendingCount: 0, overdueCount: 0 };
        row.pendingCount += 1;
        if (getMaterialRequestSlaState(request) === 'overdue') row.overdueCount += 1;
        workload.set(userId, row);
      });
    });

    return {
      runningCount: runningSubjects.length,
      overdueCount,
      returnedCount,
      byStep: [...byStep.values()].sort((a, b) => b.count - a.count).slice(0, 4),
      workload: [...workload.entries()]
        .map(([userId, row]) => ({ userId, ...row, name: userById.get(userId)?.name || userId }))
        .sort((a, b) => b.pendingCount - a.pendingCount)
        .slice(0, 4),
    };
  }, [requests, subjectsByRequestId, userById]);

  if (requests.length === 0) return null;

  return (
    <div className="border-b border-border bg-muted/40 px-5 py-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-black text-foreground">
        <BarChart3 size={15} className="text-purple-500" /> Theo dõi workflow
      </div>
      <div className="grid gap-3 lg:grid-cols-[0.8fr_1fr_1fr]">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase text-muted-foreground"><Activity size={11} /> Đang chạy</div>
            <div className="mt-1 text-lg font-black text-foreground">{summary.runningCount}</div>
          </div>
          <div className="rounded-xl border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase text-muted-foreground"><Clock size={11} /> Quá hạn</div>
            <div className="mt-1 text-lg font-black text-red-600">{summary.overdueCount}</div>
          </div>
          <div className="rounded-xl border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase text-muted-foreground"><AlertTriangle size={11} /> Trả lại</div>
            <div className="mt-1 text-lg font-black text-orange-600">{summary.returnedCount}</div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2">
          <div className="mb-2 text-[10px] font-black uppercase text-muted-foreground">Đang chờ xử lý</div>
          <div className="space-y-1.5">
            {summary.byStep.map(step => (
              <div key={step.label} className="flex items-center justify-between gap-2 text-[10px] font-bold text-muted-foreground">
                <span className="truncate">{step.label}</span>
                <span className={step.overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground/60'}>{step.count} phiếu{step.overdueCount ? ` • ${step.overdueCount} trễ` : ''}</span>
              </div>
            ))}
            {summary.byStep.length === 0 && <div className="text-[10px] font-bold text-muted-foreground/30">Không có bước đang chạy.</div>}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2">
          <div className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase text-muted-foreground"><UserRound size={11} /> Người nhận việc</div>
          <div className="space-y-1.5">
            {summary.workload.map(row => (
              <div key={row.userId} className="flex items-center justify-between gap-2 text-[10px] font-bold text-muted-foreground">
                <span className="truncate">{row.name}</span>
                <span className={row.overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground/60'}>{row.pendingCount} việc{row.overdueCount ? ` • ${row.overdueCount} trễ` : ''}</span>
              </div>
            ))}
            {summary.workload.length === 0 && <div className="text-[10px] font-bold text-muted-foreground/30">Chưa có người đang chờ xử lý.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectWorkflowAnalyticsPanel;
