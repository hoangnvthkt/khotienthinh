import React from 'react';
import { Clock3 } from 'lucide-react';
import type { SafetyCard, SafetyProjectAssignment } from '../../../../types';

interface Props {
  membershipId: string;
  assignments: SafetyProjectAssignment[];
  cards: SafetyCard[];
}

export const currentMembershipHistory = (
  membershipId: string,
  assignments: SafetyProjectAssignment[],
): SafetyProjectAssignment[] => assignments
  .filter(assignment => assignment.membershipId === membershipId)
  .sort((left, right) => (
    new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  ));

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
};

const statusLabel = (status: SafetyProjectAssignment['assignmentStatus']): string => {
  if (status === 'active') return 'Đang làm việc';
  if (status === 'ended') return 'Đã kết thúc';
  if (status === 'suspended') return 'Tạm dừng';
  return 'Đã hủy';
};

export const SafetyWorkerHistory: React.FC<Props> = ({ membershipId, assignments, cards }) => {
  const history = currentMembershipHistory(membershipId, assignments);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Clock3 className="text-slate-400" size={15} />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Lịch sử làm việc tại công trường</h3>
      </div>
      {history.length === 0 ? (
        <p className="mt-3 text-xs font-medium text-slate-500">Chưa có lịch sử phân công tại công trường này.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {history.map(assignment => {
            const assignmentCards = cards.filter(card => card.assignmentId === assignment.id);
            return (
              <article key={assignment.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-black text-slate-800 dark:text-slate-100">{formatDate(assignment.startedAt)} đến {formatDate(assignment.endedAt)}</div>
                    <div className="mt-1 text-[11px] font-medium text-slate-500">{assignment.subcontractorName || assignment.teamName || 'Cán bộ công ty'}{assignment.workType ? ` | ${assignment.workType}` : ''}</div>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{statusLabel(assignment.assignmentStatus)}</span>
                </div>
                {assignment.endedReason && <div className="mt-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">Lý do: {assignment.endedReason}</div>}
                {assignmentCards.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {assignmentCards.map(card => <span key={card.id} className="rounded-md border border-slate-200 px-2 py-1 font-mono text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">{card.cardCode} | {card.status}</span>)}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default SafetyWorkerHistory;
