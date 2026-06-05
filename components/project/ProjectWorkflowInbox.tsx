import React, { useMemo } from 'react';
import { ArrowRight, Clock, Inbox, UserRound } from 'lucide-react';
import { MaterialRequest, ProjectWorkflowSubject, User } from '../../types';
import { getMaterialRequestSlaState } from '../../lib/materialRequestService';

interface Props {
  requests: MaterialRequest[];
  subjectsByRequestId: Record<string, ProjectWorkflowSubject>;
  users: User[];
  currentUserId: string;
  onOpenRequest: (request: MaterialRequest) => void;
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ProjectWorkflowInbox: React.FC<Props> = ({
  requests,
  subjectsByRequestId,
  users,
  currentUserId,
  onOpenRequest,
}) => {
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const pendingRequests = useMemo(() => {
    return requests
      .filter(request => {
        const subject = subjectsByRequestId[request.id];
        const assigneeIds = subject?.currentAssigneeUserIds?.length
          ? subject.currentAssigneeUserIds
          : subject?.currentAssigneeUserId
            ? [subject.currentAssigneeUserId]
            : request.submittedToUserId
              ? [request.submittedToUserId]
              : [];
        return subject?.status === 'RUNNING' && assigneeIds.includes(currentUserId);
      })
      .sort((a, b) => {
        const aOverdue = getMaterialRequestSlaState(a) === 'overdue' ? 1 : 0;
        const bOverdue = getMaterialRequestSlaState(b) === 'overdue' ? 1 : 0;
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        return (a.workflowStepDueAt || a.createdDate || '').localeCompare(b.workflowStepDueAt || b.createdDate || '');
      });
  }, [currentUserId, requests, subjectsByRequestId]);

  if (pendingRequests.length === 0) return null;

  return (
    <div className="border-b border-slate-100 bg-white px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-slate-700">
            <Inbox size={15} className="text-indigo-500" /> Việc cần tôi xử lý
          </div>
          <p className="mt-0.5 text-[10px] font-bold text-slate-400">Các phiếu đang gán trực tiếp cho tài khoản hiện tại.</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-600">{pendingRequests.length} phiếu</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {pendingRequests.slice(0, 6).map(request => {
          const subject = subjectsByRequestId[request.id];
          const requester = userById.get(request.requesterId);
          const slaState = getMaterialRequestSlaState(request);
          return (
            <button
              key={request.id}
              type="button"
              onClick={() => onOpenRequest(request)}
              className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-left transition hover:border-indigo-200 hover:bg-indigo-50/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-black text-indigo-600">{request.code}</div>
                  <div className="mt-1 truncate text-[10px] font-black text-slate-700">{subject?.currentRuntimeNode?.label || subject?.currentNode?.label || request.workflowStep || '-'}</div>
                </div>
                <ArrowRight size={13} className="mt-0.5 shrink-0 text-slate-300" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold">
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <UserRound size={11} /> {requester?.name || request.requesterId}
                </span>
                <span className={`inline-flex items-center gap-1 ${slaState === 'overdue' ? 'text-red-600' : slaState === 'urgent' ? 'text-amber-600' : 'text-slate-400'}`}>
                  <Clock size={11} /> {formatDateTime(request.workflowStepDueAt)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectWorkflowInbox;
