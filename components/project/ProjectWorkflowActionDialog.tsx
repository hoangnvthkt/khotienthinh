import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, Send, Undo2, UserRound, X, XCircle } from 'lucide-react';
import {
  Employee,
  OrgUnit,
  ProjectWorkflowAction,
  ProjectWorkflowActionContext,
  ProjectWorkflowSubject,
  ProjectWorkflowRollbackDependencyResult,
  User,
  WorkflowNode,
  WorkflowNodeType,
} from '../../types';
import ProjectWorkflowAssigneeSelect from './ProjectWorkflowAssigneeSelect';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import ProjectWorkflowDependencyList from './ProjectWorkflowDependencyList';

interface Props {
  action: ProjectWorkflowAction;
  subject: ProjectWorkflowSubject;
  users: User[];
  employees?: Employee[];
  orgUnits?: OrgUnit[];
  currentNode?: WorkflowNode | null;
  nextNode?: WorkflowNode | null;
  returnTargetNode?: WorkflowNode | null;
  requesterUserId?: string | null;
  documentName: string;
  completionHandoff?: {
    required: boolean;
    eligiblePermissionCodes: string[];
    assigneeLabel?: string;
    helperText?: string;
  };
  onCancel: () => void;
  onConfirm: (context: ProjectWorkflowActionContext) => Promise<void> | void;
}

const actionTitle: Record<ProjectWorkflowAction, string> = {
  approve: 'Duyệt và chuyển bước',
  return: 'Trả lại người tạo',
  reject: 'Từ chối phiếu',
  resubmit: 'Gửi lại phiếu',
  reassign: 'Đổi người xử lý',
  rollback: 'Rollback về bước duyệt cuối',
};

const actionIcon: Record<ProjectWorkflowAction, React.ReactNode> = {
  approve: <CheckCircle2 size={18} />,
  return: <RotateCcw size={18} />,
  reject: <XCircle size={18} />,
  resubmit: <Send size={18} />,
  reassign: <UserRound size={18} />,
  rollback: <Undo2 size={18} />,
};

const requiresComment = (action: ProjectWorkflowAction) => action === 'return' || action === 'reject' || action === 'rollback';

const ProjectWorkflowActionDialog: React.FC<Props> = ({
  action,
  subject,
  users,
  employees = [],
  orgUnits = [],
  currentNode,
  nextNode,
  returnTargetNode,
  requesterUserId,
  documentName,
  completionHandoff,
  onCancel,
  onConfirm,
}) => {
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>(
    action === 'resubmit'
      ? subject.returnToAssigneeUserIds?.length
        ? subject.returnToAssigneeUserIds
        : subject.returnToAssigneeUserId
          ? [subject.returnToAssigneeUserId]
          : []
      : []
  );
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollbackDependencies, setRollbackDependencies] = useState<ProjectWorkflowRollbackDependencyResult | null>(null);

  const targetNode = useMemo(() => {
    if (action === 'approve') return nextNode || null;
    if (action === 'resubmit') return returnTargetNode || currentNode || null;
    if (action === 'reassign') return currentNode || null;
    return null;
  }, [action, currentNode, nextNode, returnTargetNode]);

  const isCompletionHandoff = action === 'approve'
    && targetNode?.type === WorkflowNodeType.END
    && completionHandoff?.required;
  const assigneeNode = useMemo(() => {
    if (!targetNode || !isCompletionHandoff) return targetNode;
    return {
      ...targetNode,
      config: {
        ...targetNode.config,
        assignmentTargets: [],
        eligiblePermissionCodes: completionHandoff?.eligiblePermissionCodes || [],
      },
    };
  }, [completionHandoff?.eligiblePermissionCodes, isCompletionHandoff, targetNode]);
  const needsAssignee = (action === 'approve' && !!targetNode && targetNode.type !== WorkflowNodeType.END)
    || isCompletionHandoff
    || action === 'resubmit'
    || action === 'reassign';

  const helperText = (() => {
    if (isCompletionHandoff) return completionHandoff?.helperText || 'Phiếu sẽ hoàn tất phần phê duyệt và bàn giao sang bước nghiệp vụ tiếp theo.';
    if (action === 'approve' && targetNode?.type === WorkflowNodeType.END) return 'Phiếu sẽ hoàn tất phần phê duyệt và chuyển sang bước nghiệp vụ tiếp theo.';
    if (action === 'approve') return `Phiếu sẽ chuyển sang bước "${targetNode?.label || 'kế tiếp'}".`;
    if (action === 'return') return 'Phiếu quay về Nháp để người tạo bổ sung, sau đó gửi lại đúng bước đã trả.';
    if (action === 'reject') return 'Phiếu sẽ kết thúc ở trạng thái từ chối.';
    if (action === 'resubmit') return `Phiếu sẽ gửi lại vào bước "${targetNode?.label || 'đã trả lại'}".`;
    if (action === 'rollback') return 'Phiếu hoàn thành sẽ quay lại bước duyệt cuối khi toàn bộ chứng từ downstream đã được reverse.';
    return 'Người xử lý hiện tại sẽ được thay bằng người mới trong cùng bước.';
  })();

  const resultText = (() => {
    if (isCompletionHandoff) return 'Sau khi xác nhận, workflow phê duyệt hoàn tất và phiếu chuyển sang bước lập đợt cấp hoặc đặt mua.';
    if (action === 'approve' && targetNode?.type === WorkflowNodeType.END) return 'Sau khi xác nhận, workflow hoàn thành và phiếu sang luồng nghiệp vụ tiếp theo.';
    if (action === 'approve') return `Sau khi xác nhận, phiếu chuyển tới "${targetNode?.label || 'bước kế tiếp'}" và giao cho người được chọn.`;
    if (action === 'return') return 'Sau khi xác nhận, phiếu quay về người tạo để sửa. Khi gửi lại, phiếu trở về đúng bước đã trả.';
    if (action === 'reject') return 'Sau khi xác nhận, phiếu bị từ chối và không còn người xử lý pending.';
    if (action === 'resubmit') return `Sau khi xác nhận, phiếu quay lại "${targetNode?.label || 'bước đã trả'}" với pool xử lý được chọn.`;
    if (action === 'rollback') return 'Sau khi xác nhận, phiếu hoàn thành quay về bước duyệt cuối nếu dependency downstream đã sạch.';
    return `Sau khi xác nhận, pool xử lý của bước "${targetNode?.label || currentNode?.label || 'hiện tại'}" được thay bằng người được chọn.`;
  })();

  React.useEffect(() => {
    if (action !== 'rollback' && action !== 'reject') return;
    projectWorkflowService.getRollbackDependencies(subject.subjectId)
      .then(setRollbackDependencies)
      .catch(err => setError(err?.message || 'Không kiểm tra được chứng từ downstream.'));
  }, [action, subject.subjectId]);

  const submit = async () => {
    const trimmed = comment.trim();
    if (requiresComment(action) && !trimmed) {
      setError('Vui lòng nhập lý do.');
      return;
    }
    if (needsAssignee && assigneeUserIds.length === 0) {
      setError('Vui lòng chọn ít nhất một người xử lý.');
      return;
    }
    if (isCompletionHandoff && assigneeUserIds.length !== 1) {
      setError('Vui lòng chọn đúng một người phụ trách tạo đợt cấp hoặc đặt mua.');
      return;
    }
    if (action === 'rollback' && rollbackDependencies && !rollbackDependencies.allowed) {
      setError('Rollback đang bị khóa vì còn chứng từ downstream chưa reverse.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        action,
        subject,
        nextNode: targetNode,
        assigneeUserId: needsAssignee ? assigneeUserIds[0] || null : null,
        assigneeUserIds: needsAssignee ? assigneeUserIds : [],
        assigneeNames: needsAssignee
          ? assigneeUserIds.map(id => users.find(user => user.id === id)?.name || id)
          : [],
        comment: trimmed,
      });
    } catch (err: any) {
      setError(err?.message || 'Không xử lý được workflow.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 sm:p-6">
      <div className="w-full max-w-xl flex flex-col max-h-[85vh] sm:max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-600">
              {actionIcon[action]} Workflow đề xuất
            </div>
            <h3 className="mt-1 text-base font-black text-slate-800">
              {isCompletionHandoff ? 'Duyệt và bàn giao xử lý' : actionTitle[action]}
            </h3>
            <p className="mt-1 text-xs font-bold text-slate-400">{documentName}</p>
          </div>
          <button onClick={onCancel} disabled={submitting} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5 overflow-y-auto flex-1 min-h-0 -webkit-overflow-scrolling-touch">
          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            <div>{helperText}</div>
            <div className="rounded-lg bg-white px-2 py-1.5">
              <div className="text-[10px] font-black uppercase text-slate-400">Kết quả sau khi xác nhận</div>
              <div className="mt-0.5 text-slate-700">{resultText}</div>
            </div>
          </div>

          {(action === 'rollback' || action === 'reject') && rollbackDependencies && (
            <ProjectWorkflowDependencyList
              dependencies={rollbackDependencies}
              title={action === 'rollback' ? 'Kiểm tra rollback' : 'Kiểm tra chứng từ liên quan'}
            />
          )}

          {needsAssignee && assigneeNode && (
            <ProjectWorkflowAssigneeSelect
              subject={subject}
              node={assigneeNode}
              users={users}
              employees={employees}
              orgUnits={orgUnits}
              value={assigneeUserIds}
              creatorUserId={requesterUserId}
              label={isCompletionHandoff ? completionHandoff?.assigneeLabel : undefined}
              selectionMode={isCompletionHandoff ? 'single' : 'multiple'}
              disabled={submitting}
              onChange={setAssigneeUserIds}
            />
          )}

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">
              {requiresComment(action) ? 'Lý do bắt buộc' : 'Ghi chú'}
            </label>
            <textarea
              rows={4}
              value={comment}
              onChange={event => setComment(event.target.value)}
              disabled={submitting}
              placeholder={requiresComment(action) ? 'Nhập lý do để người liên quan nắm được...' : 'Ghi chú xử lý nếu cần...'}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 shrink-0">
          <button onClick={onCancel} disabled={submitting} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            Hủy
          </button>
          <button
            onClick={submit}
            disabled={submitting || (action === 'rollback' && rollbackDependencies?.allowed === false)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {actionIcon[action]} {submitting ? 'Đang xử lý...' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectWorkflowActionDialog;
