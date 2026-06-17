import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Edit2, Eye, Plus, Trash2 } from 'lucide-react';
import { SafetyAttachment, SafetyInspection, SafetyInspectionItem, SafetyInspectionResult } from '../../../types';
import { EmptyState, StatusBadge } from '../../erp';
import {
  SAFETY_INSPECTION_STATUS_LABELS,
  getSafetyInspectionStatusTone,
  getSafetyResultTone,
  getSafetySeverityTone,
} from '../../../lib/safetyWorkflow';
import SafetyAttachmentList from './SafetyAttachmentList';

interface Props {
  inspections: SafetyInspection[];
  getItems: (inspectionId: string) => Promise<SafetyInspectionItem[]>;
  onUpdateItem: (itemId: string, updates: Partial<SafetyInspectionItem>) => Promise<void>;
  onComplete: (inspection: SafetyInspection) => Promise<void>;
  onGenerateIssue: (inspection: SafetyInspection, item: SafetyInspectionItem) => Promise<void>;
  onCreate: () => void;
  onEdit?: (inspection: SafetyInspection) => void;
  onDelete?: (inspection: SafetyInspection) => void;
  onPreviewAttachment?: (attachments: SafetyAttachment[], index: number) => void;
  canManage?: boolean;
  loading?: boolean;
}

const resultLabels: Record<SafetyInspectionResult, string> = {
  pass: 'Đạt',
  fail: 'Không đạt',
  na: 'N/A',
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const InspectionDetail: React.FC<{
  inspection: SafetyInspection;
  getItems: Props['getItems'];
  onUpdateItem: Props['onUpdateItem'];
  onComplete: Props['onComplete'];
  onGenerateIssue: Props['onGenerateIssue'];
  onEdit?: Props['onEdit'];
  onDelete?: Props['onDelete'];
  onPreviewAttachment?: Props['onPreviewAttachment'];
  canManage?: boolean;
}> = ({ inspection, getItems, onUpdateItem, onComplete, onGenerateIssue, onEdit, onDelete, onPreviewAttachment, canManage }) => {
  const [items, setItems] = useState<SafetyInspectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && items.length === 0) {
      setLoading(true);
      try {
        setItems(await getItems(inspection.id));
      } finally {
        setLoading(false);
      }
    }
  };

  const updateResult = async (item: SafetyInspectionItem, result: SafetyInspectionResult) => {
    await onUpdateItem(item.id, { result });
    setItems(prev => prev.map(row => row.id === item.id ? { ...row, result } : row));
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div onClick={toggle} className="flex w-full cursor-pointer items-start justify-between gap-3 p-4 hover:bg-slate-50">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-black text-orange-600">{inspection.code}</div>
          <h3 className="mt-1 text-sm font-black text-slate-800">{inspection.area || 'Kiểm tra hiện trường'}</h3>
          <p className="mt-1 text-xs font-medium text-slate-500">{formatDate(inspection.inspectionDate)} • {inspection.inspectorName || '-'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex flex-col items-end gap-1.5">
            <StatusBadge status={inspection.status} label={SAFETY_INSPECTION_STATUS_LABELS[inspection.status]} tone={getSafetyInspectionStatusTone(inspection.status)} />
            {inspection.score !== null && inspection.score !== undefined && <span className="text-xs font-black text-slate-500">{inspection.score}%</span>}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void toggle();
            }}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            title="Xem chi tiết"
          >
            <Eye size={13} />
          </button>
          {canManage && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(inspection);
                }}
                className="rounded-lg border border-slate-200 p-1.5 text-blue-600 hover:bg-blue-50"
                title="Sửa"
              >
                <Edit2 size={13} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(inspection);
                }}
                className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                title="Xóa"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          <SafetyAttachmentList
            label="Ảnh/file kiểm tra"
            attachments={inspection.attachments}
            onPreview={onPreviewAttachment}
          />

          {loading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs font-bold text-slate-400">Checklist chưa có tiêu chí.</div>
          ) : items.map(item => (
            <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800">{item.itemName}</div>
                  {item.requirement && <div className="mt-1 text-xs text-slate-500">{item.requirement}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={item.riskLevel} label={item.riskLevel} tone={getSafetySeverityTone(item.riskLevel)} />
                  <StatusBadge status={item.result} label={resultLabels[item.result]} tone={getSafetyResultTone(item.result)} />
                </div>
              </div>
              <SafetyAttachmentList
                compact
                label="Ảnh tiêu chí"
                attachments={item.photos}
                onPreview={onPreviewAttachment}
              />
              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['pass', 'fail', 'na'] as SafetyInspectionResult[]).map(result => (
                    <button key={result} type="button" onClick={() => updateResult(item, result)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50">
                      {resultLabels[result]}
                    </button>
                  ))}
                  {item.result === 'fail' && !item.generatedIssueId && (
                    <button type="button" onClick={() => onGenerateIssue(inspection, item)} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-[11px] font-black text-red-600 hover:bg-red-100">
                      <AlertTriangle size={12} /> Tạo issue
                    </button>
                  )}
                  {item.generatedIssueId && <StatusBadge status="generated" label="Đã sinh issue" tone="info" />}
                </div>
              )}
            </div>
          ))}
          {canManage && inspection.status !== 'completed' && (
            <button type="button" onClick={() => onComplete(inspection)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700">
              <CheckCircle2 size={14} /> Hoàn thành checklist
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const SafetyInspectionList: React.FC<Props> = ({
  inspections,
  getItems,
  onUpdateItem,
  onComplete,
  onGenerateIssue,
  onCreate,
  onEdit,
  onDelete,
  onPreviewAttachment,
  canManage,
  loading,
}) => {
  if (loading) {
    return <div className="grid gap-3">{[0, 1].map(index => <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  }

  if (inspections.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck size={18} />}
        title="Chưa có checklist an toàn"
        message="Tạo checklist để ghi nhận kết quả kiểm tra hiện trường."
        action={canManage ? (
          <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800">
            <Plus size={14} /> Tạo checklist
          </button>
        ) : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canManage && (
          <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800">
            <Plus size={14} /> Tạo checklist
          </button>
        )}
      </div>
      <div className="grid gap-3 md:hidden">
        {inspections.map(inspection => (
          <InspectionDetail
            key={inspection.id}
            inspection={inspection}
            getItems={getItems}
            onUpdateItem={onUpdateItem}
            onComplete={onComplete}
            onGenerateIssue={onGenerateIssue}
            onEdit={onEdit}
            onDelete={onDelete}
            onPreviewAttachment={onPreviewAttachment}
            canManage={canManage}
          />
        ))}
      </div>
      <div className="hidden space-y-3 md:block">
        {inspections.map(inspection => (
          <InspectionDetail
            key={inspection.id}
            inspection={inspection}
            getItems={getItems}
            onUpdateItem={onUpdateItem}
            onComplete={onComplete}
            onGenerateIssue={onGenerateIssue}
            onEdit={onEdit}
            onDelete={onDelete}
            onPreviewAttachment={onPreviewAttachment}
            canManage={canManage}
          />
        ))}
      </div>
    </div>
  );
};

export default SafetyInspectionList;
