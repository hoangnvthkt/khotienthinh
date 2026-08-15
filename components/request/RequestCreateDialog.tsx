import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Send, Trash2, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  mapRequestRpcError,
  requestRuntimeService,
  type UsableRequestTemplate,
} from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';
import { normalizeDynamicApprovers, validateRequestSubmission } from '../../lib/requestCreateModel';

import type { User } from '../../types';
import UserSearchSelect from '../common/UserSearchSelect';

const newIdempotencyKey = () => (
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const FieldInput: React.FC<{
  field: UsableRequestTemplate['formSchema'][number];
  value: unknown;
  onChange: (value: unknown) => void;
  users: User[];
  isSubmitting?: boolean;
}> = ({ field, value, onChange, users, isSubmitting }) => {
  const className = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const stringValue = typeof value === 'string' ? value : '';

  if (field.fieldType === 'textarea') {
    return <textarea rows={3} value={stringValue} onChange={event => onChange(event.target.value)} className={className} disabled={isSubmitting} />;
  }
  if (field.fieldType === 'select') {
    return (
      <select value={stringValue} onChange={event => onChange(event.target.value)} className={className} disabled={isSubmitting}>
        <option value="">Chọn {field.label}</option>
        {field.options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'table') {
    const cols = field.options.filter(Boolean).length > 0 ? field.options.filter(Boolean) : ['Nội dung', 'Số lượng', 'Ghi chú'];
    const rows = (Array.isArray(value) && value.length > 0) ? (value as Array<Record<string, string>>) : [Object.fromEntries(cols.map(c => [c, '']))];
    const updateCell = (rowIndex: number, col: string, val: string) => {
      const next = rows.map((r, i) => i === rowIndex ? { ...r, [col]: val } : r);
      onChange(next);
    };
    const addRow = () => {
      onChange([...rows, Object.fromEntries(cols.map(c => [c, '']))]);
    };
    const removeRow = (rowIndex: number) => {
      const next = rows.filter((_, i) => i !== rowIndex);
      onChange(next.length > 0 ? next : [Object.fromEntries(cols.map(c => [c, '']))]);
    };

    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                <th className="w-8 px-2 py-2 text-center text-slate-400">#</th>
                {cols.map(col => (
                  <th key={col} className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{col}</th>
                ))}
                <th className="w-8 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  <td className="px-2 py-2 text-center font-medium text-slate-400">{rIdx + 1}</td>
                  {cols.map(col => (
                    <td key={col} className="p-1">
                      <input
                        type="text"
                        value={row[col] ?? ''}
                        onChange={e => updateCell(rIdx, col, e.target.value)}
                        disabled={isSubmitting}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        placeholder={`Nhập ${col.toLowerCase()}`}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(rIdx)}
                      disabled={rows.length <= 1 || isSubmitting}
                      className="rounded p-1 text-slate-400 hover:text-rose-500 disabled:opacity-30"
                      title="Xóa dòng"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 p-2 dark:border-slate-700">
          <button
            type="button"
            onClick={addRow}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-950/40"
          >
            <Plus size={14} /> Thêm dòng
          </button>
        </div>
      </div>
    );
  }
  if (field.fieldType === 'date') {
    return <input type="date" value={stringValue} onChange={event => onChange(event.target.value)} className={className} disabled={isSubmitting} />;
  }
  if (field.fieldType === 'number') {
    return <input type="number" value={stringValue} onChange={event => onChange(event.target.value)} className={className} disabled={isSubmitting} />;
  }
  if (field.fieldType === 'user') {
    return (
      <UserSearchSelect
        users={users}
        value={stringValue}
        onChange={userId => onChange(userId || '')}
        placeholder="Gõ tên hoặc vị trí để tìm người dùng..."
        disabled={isSubmitting}
      />
    );
  }
  if (field.fieldType === 'file') {
    return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">Tệp đính kèm sẽ được hỗ trợ khi hoàn tất hợp đồng lưu trữ tệp của Module Yêu cầu.</p>;
  }
  return <input type="text" value={stringValue} onChange={event => onChange(event.target.value)} className={className} disabled={isSubmitting} />;
};

export const RequestCreateDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { users, user } = useApp();
  const toast = useToast();
  const idempotencyKeyRef = useRef<string | undefined>(undefined);
  const [templates, setTemplates] = useState<UsableRequestTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [dynamicApprovers, setDynamicApprovers] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedTemplate = useMemo(() => templates.find(template => template.templateVersionId === selectedTemplateVersionId), [templates, selectedTemplateVersionId]);
  const dynamicBlocks = useMemo(() => (selectedTemplate?.approvalBlocks ?? []).filter(block => block.source === 'DYNAMIC_CREATOR_SELECT'), [selectedTemplate]);

  useEffect(() => {
    if (!isOpen) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    setSelectedTemplateVersionId('');
    setTitle('');
    setDescription('');
    setFormData({});
    setDynamicApprovers({});
    setErrors([]);
    setTemplateError(null);
    setIsLoadingTemplates(true);
    requestRuntimeService.listUsableTemplates()
      .then(setTemplates)
      .catch(error => setTemplateError(mapRequestRpcError(error).message))
      .finally(() => setIsLoadingTemplates(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async () => {
    if (!selectedTemplate) {
      setErrors(['Vui lòng chọn mẫu đề xuất.']);
      return;
    }
    const normalizedApprovers = normalizeDynamicApprovers(dynamicApprovers, selectedTemplate.approvalBlocks);
    const validationErrors = validateRequestSubmission({
      title,
      formData,
      fields: selectedTemplate.formSchema,
      dynamicApproversByBlock: normalizedApprovers,
      approvalBlocks: selectedTemplate.approvalBlocks,
      creatorUserId: user.id,
    });
    if (validationErrors.length) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    setErrors([]);
    try {
      const result = await requestRuntimeService.submit({
        requestTemplateVersionId: selectedTemplate.templateVersionId,
        title: title.trim(),
        description: description.trim(),
        formData,
        dynamicApproversByBlock: normalizedApprovers,
        idempotencyKey: idempotencyKeyRef.current ?? (idempotencyKeyRef.current = newIdempotencyKey()),
      });
      toast.success('Đã gửi đề xuất', `${result.requestCode} đã được tạo.`);
      onClose();
      navigate(buildRequestRoute(result.requestId));
    } catch (error) {
      const mapped = mapRequestRpcError(error);
      setErrors([mapped.message]);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Tạo đề xuất mới">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Tạo đề xuất mới</h2>
            <p className="text-xs text-slate-500">Gửi theo mẫu đã phát hành và luồng duyệt tự động.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
        </header>
        <div className="space-y-5 p-6">
          {templateError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Không tải được danh sách mẫu: {templateError}</p>}
          {errors.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-rose-50 px-8 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Mẫu đề xuất <span className="text-rose-500">*</span></span>
            <select value={selectedTemplateVersionId} onChange={event => setSelectedTemplateVersionId(event.target.value)} disabled={isLoadingTemplates || isSubmitting} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="">{isLoadingTemplates ? 'Đang tải mẫu...' : 'Chọn mẫu đề xuất'}</option>
              {templates.map(template => <option key={template.templateVersionId} value={template.templateVersionId}>{template.name} · v{template.versionNumber}</option>)}
            </select>
            {selectedTemplate?.description && <span className="mt-1 block text-xs text-slate-500">{selectedTemplate.description}</span>}
          </label>
          {selectedTemplate && <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Tiêu đề <span className="text-rose-500">*</span></span>
              <input value={title} onChange={event => setTitle(event.target.value)} disabled={isSubmitting} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="Nhập tiêu đề đề xuất" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Mô tả</span>
              <textarea value={description} onChange={event => setDescription(event.target.value)} disabled={isSubmitting} rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="Bổ sung nội dung nếu cần" />
            </label>
            {selectedTemplate.formSchema.length > 0 && <section className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Thông tin đề xuất</h3>
              {[...selectedTemplate.formSchema].sort((left, right) => left.sortOrder - right.sortOrder).map(field => <label key={field.key} className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{field.label}{field.required && <span className="ml-1 text-rose-500">*</span>}</span>
                <FieldInput field={field} value={formData[field.key]} onChange={value => setFormData(previous => ({ ...previous, [field.key]: value }))} users={users} isSubmitting={isSubmitting} />
              </label>)}
            </section>}
            {dynamicBlocks.length > 0 && <section className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
              <div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Người duyệt được chọn khi gửi</h3><p className="text-xs text-slate-500">Các khối sau sẽ được kích hoạt theo cấu hình luồng duyệt của mẫu.</p></div>
              {dynamicBlocks.map(block => <div key={block.key} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-3 flex items-center gap-2"><UserRound size={16} className="text-violet-600" /><div><p className="text-sm font-semibold text-slate-800 dark:text-white">{block.name}</p><p className="text-xs text-slate-500">Tối thiểu {block.minimumDynamicApprovers ?? 1} người duyệt</p></div></div>
                <UserSearchSelect
                  users={users}
                  excludeUserIds={[user.id]}
                  multiple
                  values={dynamicApprovers[block.key] ?? []}
                  onValuesChange={userIds => setDynamicApprovers(previous => ({ ...previous, [block.key]: userIds }))}
                  placeholder="Gõ tên hoặc vị trí để tìm người duyệt..."
                  disabled={isSubmitting}
                />
              </div>)}
            </section>}
          </>}
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
          <button type="button" onClick={submit} disabled={!selectedTemplate || isSubmitting} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}Gửi đề xuất</button>
        </footer>
      </div>
    </div>
  );
};
