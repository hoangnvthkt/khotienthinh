import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { SafetyAttachment, SafetyInspection, SafetyInspectionItem, SafetySeverity, User } from '../../../types';
import SafetyAttachmentUploader from './SafetyAttachmentUploader';
import { safetyService } from '../../../lib/safetyService';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  currentUser: User;
  inspection?: SafetyInspection | null;
  onPreviewAttachment?: (attachments: SafetyAttachment[], index: number) => void;
  onClose: () => void;
  onSave: (input: Partial<SafetyInspection> & {
    projectId: string;
    items: Array<Partial<SafetyInspectionItem> & { itemName: string }>;
  }) => Promise<void>;
}

const SafetyInspectionFormModal: React.FC<Props> = ({ projectId, constructionSiteId, currentUser, inspection, onPreviewAttachment, onClose, onSave }) => {
  const tempId = useState(() => `draft-${crypto.randomUUID()}`)[0];
  const [area, setArea] = useState('');
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState('');
  const [attachments, setAttachments] = useState<SafetyAttachment[]>([]);
  const [items, setItems] = useState<Array<{ id?: string; itemName: string; requirement?: string; riskLevel: SafetySeverity; result?: any; generatedIssueId?: any; createdBy?: any }>>([
    { itemName: 'Khu vực làm việc sạch sẽ, không có nguy cơ vấp ngã', riskLevel: 'medium' },
    { itemName: 'Công nhân sử dụng PPE đúng quy định', riskLevel: 'medium' },
    { itemName: 'Thiết bị/máy móc có hồ sơ kiểm định hợp lệ', riskLevel: 'high' },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (inspection) {
      setArea(inspection.area || '');
      setInspectionDate(inspection.inspectionDate || new Date().toISOString().slice(0, 10));
      setSummary(inspection.summary || '');
      setAttachments(inspection.attachments || []);

      safetyService.getInspectionItems(inspection.id).then(rows => {
        setItems(rows.map(r => ({
          id: r.id,
          itemName: r.itemName,
          requirement: r.requirement || undefined,
          riskLevel: r.riskLevel,
          result: r.result,
          generatedIssueId: r.generatedIssueId,
          createdBy: r.createdBy,
        })));
      }).catch(error => {
        console.warn('Cannot load inspection items for edit form', error);
      });
    }
  }, [inspection]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        id: inspection?.id,
        projectId,
        constructionSiteId: constructionSiteId || null,
        inspectionDate,
        area: area.trim() || null,
        inspectorUserId: inspection?.inspectorUserId || currentUser.id,
        inspectorName: inspection?.inspectorName || currentUser.name || currentUser.username,
        summary: summary.trim() || null,
        attachments,
        createdBy: inspection?.createdBy || currentUser.id,
        status: inspection?.status || 'in_progress',
        items: items.filter(item => item.itemName.trim()).map((item, index) => ({
          id: item.id,
          itemName: item.itemName.trim(),
          requirement: item.requirement?.trim() || null,
          riskLevel: item.riskLevel,
          result: item.result || 'na',
          generatedIssueId: item.generatedIssueId || null,
          sortOrder: index + 1,
          createdBy: item.createdBy || currentUser.id,
        })),
      } as any);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (index: number, updates: Partial<typeof items[number]>) => {
    setItems(prev => prev.map((item, idx) => idx === index ? { ...item, ...updates } : item));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">Kiểm tra hiện trường</div>
            <h3 className="mt-1 text-base font-black text-slate-800">{inspection ? 'Sửa checklist an toàn' : 'Tạo checklist an toàn'}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{inspection ? 'Cập nhật lại checklist an toàn cho hiện trường.' : 'Checklist nhanh cho cán bộ an toàn đi hiện trường.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ngày kiểm tra</label>
              <input type="date" value={inspectionDate} onChange={event => setInspectionDate(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Khu vực</label>
              <input value={area} onChange={event => setArea(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="VD: Khu vực cẩu nâng" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ghi chú</label>
              <textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Mục tiêu kiểm tra, phạm vi, lưu ý..." />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400">Tiêu chí kiểm tra</div>
                <p className="text-[11px] font-bold text-slate-500">Có thể chỉnh nhanh từng tiêu chí trước khi bắt đầu.</p>
              </div>
              <button type="button" onClick={() => setItems(prev => [...prev, { itemName: '', riskLevel: 'medium' }])} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600">
                <Plus size={14} /> Thêm dòng
              </button>
            </div>
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_160px_40px]">
                <input value={item.itemName} onChange={event => updateItem(index, { itemName: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Tên tiêu chí" />
                <select value={item.riskLevel} onChange={event => updateItem(index, { riskLevel: event.target.value as SafetySeverity })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                  <option value="low">Thấp</option>
                  <option value="medium">Trung bình</option>
                  <option value="high">Cao</option>
                  <option value="critical">Nghiêm trọng</option>
                </select>
                <button type="button" onClick={() => setItems(prev => prev.filter((_, idx) => idx !== index))} className="rounded-lg border border-slate-200 bg-white p-2 text-red-500 hover:bg-red-50" title="Xóa dòng">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <SafetyAttachmentUploader
            projectId={projectId}
            recordType="inspections"
            recordId={tempId}
            attachments={attachments}
            onChange={setAttachments}
            uploadedBy={currentUser.name || currentUser.username}
            label="Ảnh/file ban đầu"
            onPreview={onPreviewAttachment}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button>
          <button type="submit" disabled={saving || items.every(item => !item.itemName.trim())} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Đang lưu...' : inspection ? 'Lưu thay đổi' : 'Tạo checklist'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SafetyInspectionFormModal;
