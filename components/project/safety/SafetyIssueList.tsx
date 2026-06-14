import React from 'react';
import { AlertTriangle, Edit2, Eye, Plus, Trash2 } from 'lucide-react';
import {
  SafetyIssue,
  SafetyIssueStatus,
  SafetyIssueType,
  SafetySeverity,
} from '../../../types';
import { EmptyState, FilterBar, MobileCardList, StatusBadge } from '../../erp';
import {
  SAFETY_ISSUE_STATUS_LABELS,
  SAFETY_ISSUE_TYPE_LABELS,
  SAFETY_SEVERITY_LABELS,
  getSafetyIssueStatusTone,
  getSafetySeverityTone,
} from '../../../lib/safetyWorkflow';

interface Props {
  issues: SafetyIssue[];
  loading?: boolean;
  filters: {
    search: string;
    status: SafetyIssueStatus | 'all';
    severity: SafetySeverity | 'all';
    type: SafetyIssueType | 'all';
  };
  onFiltersChange: (filters: Props['filters']) => void;
  onCreate: () => void;
  onOpen: (issue: SafetyIssue) => void;
  onEdit: (issue: SafetyIssue) => void;
  onDelete: (issue: SafetyIssue) => void;
  canManage?: boolean;
}

const statusOptions: Array<SafetyIssueStatus | 'all'> = ['all', 'new', 'assigned', 'in_progress', 'waiting_verification', 'resolved', 'closed', 'overdue', 'rejected'];
const severityOptions: Array<SafetySeverity | 'all'> = ['all', 'critical', 'high', 'medium', 'low'];
const typeOptions: Array<SafetyIssueType | 'all'> = ['all', 'hazard', 'violation', 'near_miss', 'minor_incident', 'serious_incident', 'corrective_action'];

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const SafetyIssueList: React.FC<Props> = ({
  issues,
  loading,
  filters,
  onFiltersChange,
  onCreate,
  onOpen,
  onEdit,
  onDelete,
  canManage,
}) => {
  const updateFilter = <K extends keyof Props['filters']>(key: K, value: Props['filters'][K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const renderActions = (issue: SafetyIssue) => (
    <div className="flex justify-end gap-1">
      <button type="button" onClick={() => onOpen(issue)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Xem">
        <Eye size={14} />
      </button>
      {canManage && (
        <button type="button" onClick={() => onEdit(issue)} className="rounded-lg border border-slate-200 p-2 text-blue-600 hover:bg-blue-50" title="Sửa">
          <Edit2 size={14} />
        </button>
      )}
      {canManage && issue.status === 'new' && (
        <button type="button" onClick={() => onDelete(issue)} className="rounded-lg border border-slate-200 p-2 text-red-600 hover:bg-red-50" title="Xóa">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );

  return (
    <section className="space-y-4">
      <FilterBar
        searchValue={filters.search}
        onSearchChange={value => updateFilter('search', value)}
        searchPlaceholder="Tìm mã, tiêu đề, khu vực..."
        canClear={filters.search !== '' || filters.status !== 'all' || filters.severity !== 'all' || filters.type !== 'all'}
        onClear={() => onFiltersChange({ search: '', status: 'all', severity: 'all', type: 'all' })}
        filters={
          <>
            <select value={filters.status} onChange={event => updateFilter('status', event.target.value as SafetyIssueStatus | 'all')} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">
              {statusOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'Tất cả trạng thái' : SAFETY_ISSUE_STATUS_LABELS[option]}</option>)}
            </select>
            <select value={filters.severity} onChange={event => updateFilter('severity', event.target.value as SafetySeverity | 'all')} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">
              {severityOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'Tất cả mức độ' : SAFETY_SEVERITY_LABELS[option]}</option>)}
            </select>
            <select value={filters.type} onChange={event => updateFilter('type', event.target.value as SafetyIssueType | 'all')} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">
              {typeOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'Tất cả loại' : SAFETY_ISSUE_TYPE_LABELS[option]}</option>)}
            </select>
            {canManage && (
              <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800">
                <Plus size={14} /> Ghi nhận
              </button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map(index => <div key={index} className="h-20 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : issues.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle size={18} />}
          title="Chưa có nguy cơ/sự cố phù hợp"
          message="Ghi nhận nguy cơ mới hoặc thay đổi bộ lọc để xem dữ liệu khác."
          action={canManage ? (
            <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800">
              <Plus size={14} /> Ghi nhận nguy cơ
            </button>
          ) : undefined}
        />
      ) : (
        <>
          <MobileCardList
            items={issues}
            getKey={issue => issue.id}
            renderItem={issue => (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] font-black text-orange-600">{issue.code}</div>
                    <h3 className="mt-1 text-sm font-black text-slate-800">{issue.title}</h3>
                    <p className="mt-1 text-xs font-medium text-slate-500">{issue.area || 'Chưa rõ khu vực'}</p>
                  </div>
                  <StatusBadge status={issue.severity} label={SAFETY_SEVERITY_LABELS[issue.severity]} tone={getSafetySeverityTone(issue.severity)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={issue.status} label={SAFETY_ISSUE_STATUS_LABELS[issue.status]} tone={getSafetyIssueStatusTone(issue.status)} />
                  <StatusBadge status={issue.type} label={SAFETY_ISSUE_TYPE_LABELS[issue.type]} tone="neutral" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-500">
                  <div>Người xử lý: {issue.assignedToName || '-'}</div>
                  <div>Hạn: {formatDate(issue.dueAt)}</div>
                </div>
                {renderActions(issue)}
              </div>
            )}
          />

          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-black uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Mã / Tiêu đề</th>
                  <th className="px-4 py-3">Loại</th>
                  <th className="px-4 py-3">Mức độ</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Người xử lý</th>
                  <th className="px-4 py-3">Hạn</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issues.map(issue => (
                  <tr key={issue.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-mono text-[10px] font-black text-orange-600">{issue.code}</div>
                      <button type="button" onClick={() => onOpen(issue)} className="mt-1 text-left font-black text-slate-800 hover:text-orange-700">{issue.title}</button>
                      <div className="mt-0.5 text-xs font-medium text-slate-400">{issue.area || '-'}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={issue.type} label={SAFETY_ISSUE_TYPE_LABELS[issue.type]} tone="neutral" /></td>
                    <td className="px-4 py-3"><StatusBadge status={issue.severity} label={SAFETY_SEVERITY_LABELS[issue.severity]} tone={getSafetySeverityTone(issue.severity)} /></td>
                    <td className="px-4 py-3"><StatusBadge status={issue.status} label={SAFETY_ISSUE_STATUS_LABELS[issue.status]} tone={getSafetyIssueStatusTone(issue.status)} /></td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-600">{issue.assignedToName || '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-600">{formatDate(issue.dueAt)}</td>
                    <td className="px-4 py-3">{renderActions(issue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

export default SafetyIssueList;
