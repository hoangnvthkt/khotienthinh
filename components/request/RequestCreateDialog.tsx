import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, UserRound, X } from 'lucide-react';
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

import UserSearchSelect from '../common/UserSearchSelect';
import { RequestFormFields } from './RequestFormFields';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';

const newIdempotencyKey = () => (
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export const RequestCreateDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { users, user } = useApp();
  const toast = useToast();
  const idempotencyKeyRef = useRef<string | undefined>(undefined);
  const payloadRef = useRef<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
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
  const dirty = Boolean(selectedTemplateVersionId || title || description || Object.keys(formData).length || Object.keys(dynamicApprovers).length);
  const requestClose = () => { if (!dirty || window.confirm('Bỏ các thay đổi chưa gửi?')) onClose(); };
  useDialogFocusTrap(isOpen, dialogRef, requestClose);

  const selectedTemplate = useMemo(() => templates.find(template => template.templateVersionId === selectedTemplateVersionId), [templates, selectedTemplateVersionId]);
  const dynamicBlocks = useMemo(() => (selectedTemplate?.approvalBlocks ?? []).filter(block => block.source === 'DYNAMIC_CREATOR_SELECT'), [selectedTemplate]);

  useEffect(() => {
    if (!isOpen) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    payloadRef.current = undefined;
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
      const payload=JSON.stringify({requestTemplateVersionId:selectedTemplate.templateVersionId,title:title.trim(),description:description.trim(),formData,dynamicApproversByBlock:normalizedApprovers});
      if(payloadRef.current!==undefined&&payloadRef.current!==payload)idempotencyKeyRef.current=newIdempotencyKey();
      payloadRef.current=payload;
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
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm md:items-center md:p-4" role="dialog" aria-modal="true" aria-label="Tạo đề xuất mới">
      <div ref={dialogRef} className="flex h-[100dvh] w-full max-w-[920px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 md:h-auto md:max-h-[92vh] md:rounded-3xl md:border md:border-white/20">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Tạo đề xuất mới</h2>
            <p className="text-xs text-slate-500">Gửi theo mẫu đã phát hành và luồng duyệt tự động.</p>
          </div>
          <button type="button" onClick={requestClose} disabled={isSubmitting} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-7">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">Điền đầy đủ nội dung để hệ thống tự chuyển đề xuất tới đúng người duyệt. Các trường có dấu <span className="font-bold text-rose-500">*</span> là bắt buộc.</div>
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
              <RequestFormFields fields={selectedTemplate.formSchema} values={formData} onChange={setFormData} users={users} disabled={isSubmitting} />
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
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:justify-end sm:px-7">
          <button type="button" onClick={requestClose} disabled={isSubmitting} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
          <button type="button" onClick={submit} disabled={!selectedTemplate || isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}Gửi đề xuất</button>
        </footer>
      </div>
    </div>
  );
};
