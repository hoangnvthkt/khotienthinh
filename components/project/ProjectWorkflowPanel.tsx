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
import type { ProjectPermissionRoomCode, ProjectRoomActionCode } from '../../lib/permissions/projectPermissionRooms';

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
    recipientAction?: ProjectRoomActionCode;
    actionLabel?: string;
    assigneeLabel?: string;
    helperText?: string;
  };
  recipientRoomCode?: ProjectPermissionRoomCode;
  recipientAction?: ProjectRoomActionCode;
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
  RUNNING: 'border-emerald-200 bg-emerald-50 text-emerald-700',
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
  recipientRoomCode,
  recipientAction,
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
  const nodeConfig = currentNode?.config || {};
  const allowReject = nodeConfig.allowReject !== false;
  const allowReassign = nodeConfig.allowReassign !== false;
  const currentParticipantRole = subject.participants?.find(participant =>
    participant.isActive && participant.userId === currentUserId
  )?.role;
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
  const permissionLabel = currentUserId && assigneeIds.includes(currentUserId)
    ? 'Bạn là người đang được giao xử lý bước này.'
    : currentParticipantRole === 'ADMIN'
      ? 'Bạn là quản trị workflow, có thể đổi người nhưng không duyệt thay.'
      : currentParticipantRole === 'WATCHER'
        ? 'Bạn là người theo dõi, chỉ có quyền xem.'
        : subject.createdBy === currentUserId
          ? subject.status === 'RETURNED'
            ? 'Bạn là người tạo, có thể sửa và gửi lại phiếu.'
            : 'Bạn là người tạo phiếu.'
          : 'Bạn đang có quyền xem phiếu theo quyền dự án hoặc workflow.';

  const handleConfirm = async (context: ProjectWorkflowActionContext) => {
    await onAction(context);
    setActiveAction(null);
  };

  return (
    <div className="mb-5 space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Thao tác workflow</div>
          <h4 className="mt-0.5 text-sm font-black text-slate-800">
            {nextNode?.type === WorkflowNodeType.END
              ? completionHandoff?.actionLabel || 'Hoàn tất phê duyệt'
              : currentNode?.label || subject.workflowInstance?.title || subject.workflowInstance?.code || documentName}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1"><GitBranch size={12} /> {currentNode?.label || 'Chưa xác định bước'}</span>
            {assigneeNames.length > 0 && <span className="inline-flex items-center gap-1"><UserRound size={12} /> {assigneeNames.join(', ')}</span>}
            <span className="inline-flex items-center gap-1"><Clock size={12} /> {formatDateTime(subject.updatedAt)}</span>
            {nodeConfig.slaHours ? <span>SLA {nodeConfig.slaHours} giờ</span> : null}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">{permissionLabel}</div>
        </div>
        <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black ${statusTone[subject.status]}`}>
          {subjectStatusLabel[subject.status]}
        </span>
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
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
        <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-slate-300" />
          Chỉ người đang được gán bước mới có quyền duyệt, trả lại hoặc từ chối. Quản trị workflow chỉ được đổi người xử lý.
        </div>
      )}

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
          recipientRoomCode={recipientRoomCode}
          recipientAction={recipientAction}
          onCancel={() => setActiveAction(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
};

export default ProjectWorkflowPanel;
