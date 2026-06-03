import React, { useMemo } from 'react';
import { CheckCircle2, Clock, GitBranch, RotateCcw, UserRound, XCircle } from 'lucide-react';
import { User, WorkflowNode, WorkflowStepAssignment, WorkflowStepAssignmentStatus } from '../../types';

interface Props {
  assignments: WorkflowStepAssignment[];
  nodes: WorkflowNode[];
  users: User[];
}

const statusLabel: Record<WorkflowStepAssignmentStatus, string> = {
  PENDING: 'Đang chờ',
  APPROVED: 'Đã xử lý',
  RETURNED: 'Đã trả lại',
  REJECTED: 'Đã từ chối',
  SKIPPED: 'Đã đổi người',
};

const statusTone: Record<WorkflowStepAssignmentStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  RETURNED: 'border-orange-200 bg-orange-50 text-orange-700',
  REJECTED: 'border-red-200 bg-red-50 text-red-700',
  SKIPPED: 'border-slate-200 bg-slate-50 text-slate-500',
};

const statusIcon: Record<WorkflowStepAssignmentStatus, React.ReactNode> = {
  PENDING: <Clock size={14} />,
  APPROVED: <CheckCircle2 size={14} />,
  RETURNED: <RotateCcw size={14} />,
  REJECTED: <XCircle size={14} />,
  SKIPPED: <GitBranch size={14} />,
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ProjectWorkflowTimeline: React.FC<Props> = ({ assignments, nodes, users }) => {
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const sortedAssignments = useMemo(
    () => [...assignments].sort((a, b) => (a.assignedAt || '').localeCompare(b.assignedAt || '')),
    [assignments],
  );

  if (sortedAssignments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs font-bold text-slate-400">
        Chưa có lịch sử gán bước.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Timeline xử lý</div>
      <div className="space-y-2">
        {sortedAssignments.map(assignment => {
          const node = assignment.nodeId ? nodeById.get(assignment.nodeId) : null;
          const assignee = assignment.assigneeUserId ? userById.get(assignment.assigneeUserId) : null;
          const assignedBy = assignment.assignedBy ? userById.get(assignment.assignedBy) : null;
          const metadata = assignment.metadata || {};
          const suffix = metadata.resubmitted
            ? 'Gửi lại'
            : metadata.reassigned
              ? 'Đổi người'
              : metadata.returnedToCreator
                ? 'Trả về người tạo'
                : '';

          return (
            <div key={assignment.id} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-black text-slate-800">{node?.label || 'Bước workflow'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <UserRound size={12} />
                      {assignee?.name || assignment.assigneeUserId || '-'}
                    </span>
                    {assignedBy && <span>Gán bởi {assignedBy.name}</span>}
                    {suffix && <span className="text-indigo-500">{suffix}</span>}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black ${statusTone[assignment.status]}`}>
                  {statusIcon[assignment.status]}
                  {statusLabel[assignment.status]}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-1 text-[10px] font-bold text-slate-400 sm:grid-cols-2">
                <div>Gán lúc: {formatDateTime(assignment.assignedAt)}</div>
                <div>Xử lý lúc: {formatDateTime(assignment.actedAt)}</div>
              </div>

              {assignment.actionComment && (
                <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-600">
                  {assignment.actionComment}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectWorkflowTimeline;
