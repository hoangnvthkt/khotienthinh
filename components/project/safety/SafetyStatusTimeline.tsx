import React from 'react';
import { Clock } from 'lucide-react';
import { SafetyStatusLog } from '../../../types';
import { StatusBadge } from '../../erp';
import { SAFETY_ISSUE_STATUS_LABELS, getSafetyIssueStatusTone } from '../../../lib/safetyWorkflow';

interface Props {
  logs: SafetyStatusLog[];
}

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN');
};

const SafetyStatusTimeline: React.FC<Props> = ({ logs }) => {
  if (!logs.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs font-bold text-slate-400">
        Chưa có lịch sử trạng thái.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map(log => {
        const status = log.toStatus as keyof typeof SAFETY_ISSUE_STATUS_LABELS;
        return (
          <div key={log.id} className="flex gap-3 rounded-lg border border-slate-100 bg-white p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Clock size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={log.toStatus}
                  label={SAFETY_ISSUE_STATUS_LABELS[status] || log.toStatus}
                  tone={getSafetyIssueStatusTone(log.toStatus)}
                />
                <span className="text-[11px] font-bold text-slate-400">{formatDateTime(log.createdAt)}</span>
              </div>
              {log.reason && <p className="mt-1 text-xs font-medium text-slate-600">{log.reason}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SafetyStatusTimeline;
