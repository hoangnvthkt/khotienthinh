import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, GitBranch, RotateCcw, Send, Undo2, UserRound, XCircle } from 'lucide-react';
import {
  Employee,
  OrgUnit,
  ProjectWorkflowAction,
  ProjectWorkflowActionContext,
  ProjectWorkflowSubject,
  ProjectWorkflowSubjectStatus,
  User,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowStepAssignment,
} from '../../types';
import ProjectWorkflowActionDialog from './ProjectWorkflowActionDialog';
import ProjectWorkflowTimeline from './ProjectWorkflowTimeline';

interface Props {
  subject?: ProjectWorkflowSubject | null;
  documentName: string;
  requesterUserId?: string | null;
  currentUserId?: string | null;
  users: User[];
  employees?: Employee[];
  orgUnits?: OrgUnit[];
  nodes: WorkflowNode[];
  assignments?: WorkflowStepAssignment[];
  nextNode?: WorkflowNode | null;
  returnTargetNode?: WorkflowNode | null;
  canAct?: boolean;
  canReassign?: boolean;
  canResubmit?: boolean;
  canRollback?: boolean;
  completionHandoff?: {
    required: boolean;
    eligiblePermissionCodes: string[];
    actionLabel?: string;
    assigneeLabel?: string;
    helperText?: string;
  };
  disabled?: boolean;
  onAction: (context: ProjectWorkflowActionContext) => Promise<void> | void;
}

const subjectStatusLabel: Record<ProjectWorkflowSubjectStatus, string> = {
  RUNNING: 'Đang xử lý',
  RETURNED: 'Đã trả lại',
  COMPLETED: 'Hoàn thành',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

const statusTone: Record<ProjectWorkflowSubjectStatus, string> = {
  RUNNING: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  RETURNED: 'border-orange-200 bg-orange-50 text-orange-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-red-200 bg-red-50 text-red-700',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-500',
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

const ProjectWorkflowPanel: React.FC<Props> = ({
  subject,
  documentName,
  requesterUserId,
  currentUserId,
  users,
  employees = [],
  orgUnits = [],
  nodes,
  assignments = [],
  nextNode,
  returnTargetNode,
  canAct = false,
  canReassign = false,
  canResubmit = false,
  canRollback = false,
  completionHandoff,
  disabled = false,
  onAction,
}) => {
  const [activeAction, setActiveAction] = useState<ProjectWorkflowAction | null>(null);
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);

  if (!subject) {
    return (
      <div className="mb-6 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-400">
        Phiếu này chưa chạy workflow động. Hệ thống sẽ dùng luồng duyệt cũ nếu chưa cấu hình binding.
      </div>
    );
  }

  const currentNode = subject.currentNode || (subject.currentNodeId ? nodes.find(node => node.id === subject.currentNodeId) || null : null);
  const assigneeIds = subject.currentAssigneeUserIds?.length
    ? subject.currentAssigneeUserIds
    : subject.currentAssigneeUserId
      ? [subject.currentAssigneeUserId]
      : [];
  const assigneeNames = assigneeIds.map(id => userById.get(id)?.name || id);
  const returnedBy = subject.returnedByUserId ? userById.get(subject.returnedByUserId) : null;
  const nodeConfig = currentNode?.config || {};
  const allowReject = nodeConfig.allowReject !== false;
  const allowReassign = nodeConfig.allowReassign !== false;
  const canShowRunningActions = subject.status === 'RUNNING' && canAct && currentNode?.type !== WorkflowNodeType.END;
  const shouldShowApprove = canShowRunningActions;
  const shouldShowReturn = canShowRunningActions;
  const shouldShowReject = canShowRunningActions && allowReject;
  const shouldShowReassign = subject.status === 'RUNNING'
    && canReassign
    && currentNode?.type !== WorkflowNodeType.END
    && allowReassign;
  const shouldShowResubmit = subject.status === 'RETURNED' && canResubmit;
  const shouldShowRollback = subject.status === 'COMPLETED' && canRollback;
  const targetLabel = nextNode?.type === WorkflowNodeType.END
    ? completionHandoff?.actionLabel || 'Hoàn tất phê duyệt'
    : nextNode?.label
      ? `Chuyển ${nextNode.label}`
      : 'Duyệt bước';

  const handleConfirm = async (context: ProjectWorkflowActionContext) => {
    await onAction(context);
    setActiveAction(null);
  };

  return (
    <div className="mb-6 space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Workflow đề xuất</div>
          <h4 className="mt-1 text-sm font-black text-slate-800">
            {subject.workflowInstance?.title || subject.workflowInstance?.code || documentName}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-slate-500">
            <span className="inline-flex items-center gap-1"><GitBranch size={12} /> {currentNode?.label || 'Chưa xác định bước'}</span>
            <span className="inline-flex items-center gap-1"><Clock size={12} /> Cập nhật {formatDateTime(subject.updatedAt)}</span>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[10px] font-black ${statusTone[subject.status]}`}>
          {subjectStatusLabel[subject.status]}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white bg-white/80 px-3 py-2">
          <div className="text-[10px] font-black uppercase text-slate-400">Bước hiện tại</div>
          <div className="mt-1 text-xs font-black text-slate-800">{currentNode?.label || '-'}</div>
          {nodeConfig.slaHours ? <div className="mt-1 text-[10px] font-bold text-indigo-500">SLA {nodeConfig.slaHours} giờ</div> : null}
        </div>
        <div className="rounded-xl border border-white bg-white/80 px-3 py-2">
          <div className="text-[10px] font-black uppercase text-slate-400">Pool đang xử lý</div>
          <div className="mt-1 flex items-start gap-1.5 text-xs font-black text-slate-800">
            <UserRound size={14} className="text-slate-400" />
            <span>{assigneeNames.length > 0 ? assigneeNames.join(', ') : '-'}</span>
          </div>
          {currentUserId && assigneeIds.includes(currentUserId) && <div className="mt-1 text-[10px] font-bold text-emerald-600">Đang giao cho bạn</div>}
        </div>
        <div className="rounded-xl border border-white bg-white/80 px-3 py-2">
          <div className="text-[10px] font-black uppercase text-slate-400">Trả lại gần nhất</div>
          <div className="mt-1 text-xs font-black text-slate-800">{returnedBy?.name || '-'}</div>
          <div className="mt-1 text-[10px] font-bold text-slate-400">{formatDateTime(subject.returnedAt)}</div>
        </div>
      </div>

      {(canShowRunningActions || shouldShowReassign || shouldShowResubmit || shouldShowRollback) && (
        <div className="flex flex-wrap gap-2">
          {shouldShowReturn && (
            <button
              disabled={disabled}
              onClick={() => setActiveAction('return')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-black text-orange-700 hover:bg-orange-50 disabled:opacity-50"
            >
              <RotateCcw size={14} /> Trả lại
            </button>
          )}
          {shouldShowReject && (
            <button
              disabled={disabled}
              onClick={() => setActiveAction('reject')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <XCircle size={14} /> Từ chối
            </button>
          )}
          {shouldShowReassign && (
            <button
              disabled={disabled}
              onClick={() => setActiveAction('reassign')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <UserRound size={14} /> Đổi người
            </button>
          )}
          {shouldShowApprove && (
            <button
              disabled={disabled}
              onClick={() => setActiveAction('approve')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <CheckCircle2 size={14} /> {targetLabel}
            </button>
          )}
          {shouldShowResubmit && (
            <button
              disabled={disabled}
              onClick={() => setActiveAction('resubmit')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send size={14} /> Gửi lại
            </button>
          )}
          {shouldShowRollback && (
            <button
              disabled={disabled}
              onClick={() => setActiveAction('rollback')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              <Undo2 size={14} /> Rollback bước duyệt cuối
            </button>
          )}
        </div>
      )}

      {!canShowRunningActions && subject.status === 'RUNNING' && (
        <div className="flex items-start gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-bold text-slate-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-slate-300" />
          Chỉ người đang được gán bước mới có quyền duyệt, trả lại hoặc từ chối. Quản trị workflow chỉ được đổi người xử lý.
        </div>
      )}

      <ProjectWorkflowTimeline assignments={assignments} nodes={nodes} users={users} />

      {activeAction && (
        <ProjectWorkflowActionDialog
          action={activeAction}
          subject={subject}
          users={users}
          employees={employees}
          orgUnits={orgUnits}
          currentNode={currentNode}
          nextNode={nextNode}
          returnTargetNode={returnTargetNode}
          requesterUserId={requesterUserId}
          documentName={documentName}
          completionHandoff={completionHandoff}
          onCancel={() => setActiveAction(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
};

export default ProjectWorkflowPanel;
