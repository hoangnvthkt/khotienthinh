import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Save, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { mapRequestRpcError, requestRuntimeService, type RequestDetail } from '../../lib/requestRuntimeService';
import { validateRequestSubmission } from '../../lib/requestCreateModel';
import { RequestFormFields } from './RequestFormFields';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';

const createKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const RequestEditDialog: React.FC<{
  detail: RequestDetail;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}> = ({ detail, isOpen, onClose, onSaved }) => {
  const { users } = useApp();
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const [formData, setFormData] = useState(detail.formData);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const keyRef = useRef(createKey());
  const payloadRef = useRef<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(detail.title); setDescription(detail.description); setFormData(detail.formData);
    setErrors([]); setStale(false); keyRef.current=createKey(); payloadRef.current=undefined;
  }, [isOpen, detail.id]);

  const dirty = title !== detail.title || description !== detail.description || JSON.stringify(formData) !== JSON.stringify(detail.formData);
  const close = () => { if (!dirty || window.confirm('Bỏ các thay đổi chưa lưu?')) onClose(); };
  useDialogFocusTrap(isOpen, dialogRef, close);
  if (!isOpen) return null;
  const save = async () => {
    const validationErrors = validateRequestSubmission({ title, formData, fields: detail.formSchema, dynamicApproversByBlock: {}, approvalBlocks: [], creatorUserId: detail.creator.id });
    if (validationErrors.length) { setErrors(validationErrors); return; }
    const payload=JSON.stringify({title:title.trim(),description:description.trim(),formData,expectedUpdatedAt:detail.updatedAt});
    if(payloadRef.current!==undefined&&payloadRef.current!==payload)keyRef.current=createKey();
    payloadRef.current=payload;
    setSaving(true); setErrors([]);
    try {
      await requestRuntimeService.updateContent({ requestId: detail.id, title: title.trim(), description: description.trim(), formData, expectedUpdatedAt: detail.updatedAt, idempotencyKey: keyRef.current });
      await onSaved(); onClose();
    } catch (cause) {
      const error = mapRequestRpcError(cause);
      if (error.code === 'REQUEST_STALE_STATE') setStale(true);
      setErrors([error.code === 'REQUEST_STALE_STATE' ? 'Đề xuất vừa được cập nhật ở nơi khác. Bản nhập của anh/chị vẫn được giữ để đối chiếu.' : error.message]);
    } finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/60 backdrop-blur-sm md:items-center md:p-4" role="dialog" aria-modal="true" aria-labelledby="request-edit-title">
    <div ref={dialogRef} className="flex h-[100dvh] w-full max-w-[920px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 md:h-auto md:max-h-[92vh] md:rounded-3xl">
      <header className="flex shrink-0 items-start justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-7">
        <div className="min-w-0"><p className="mb-1 text-xs font-bold text-emerald-700">{detail.code} · Phiên bản {detail.contentRevision}</p><h2 id="request-edit-title" className="break-words text-xl font-extrabold text-slate-900 dark:text-white">Chỉnh sửa đề xuất</h2><p className="mt-1 text-sm text-slate-500">Nội dung mới sẽ được lưu thành một phiên bản riêng.</p></div>
        <button type="button" onClick={close} disabled={saving} className="ml-3 shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={19} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-7">
        <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${detail.status === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'}`}><div className="flex gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><span>{detail.status === 'PENDING' ? 'Khi lưu, lượt duyệt đang chờ sẽ kết thúc và phiên bản mới bắt đầu duyệt lại từ đầu. Lịch sử quyết định cũ vẫn được giữ.' : 'Đề xuất đang được trả lại. Anh/chị có thể lưu nội dung trước khi gửi lại.'}</span></div></div>
        {errors.length>0 && <ul className="list-disc space-y-1 rounded-2xl border border-rose-200 bg-rose-50 px-9 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{errors.map(item=><li key={item} className="break-words">{item}</li>)}</ul>}
        {stale && <button type="button" onClick={() => { if(window.confirm('Tải bản mới và bỏ bản nhập hiện tại?')) void onSaved().then(onClose); }} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200"><RefreshCw size={16}/>Tải bản mới</button>}
        <div className="grid gap-2 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-7"><label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tên đề xuất <span className="text-rose-500">*</span></label><input autoFocus value={title} onChange={event=>setTitle(event.target.value)} disabled={saving} className="min-w-0 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
        <div className="grid gap-2 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-7"><label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nội dung đề xuất</label><textarea value={description} onChange={event=>setDescription(event.target.value)} disabled={saving} rows={5} className="min-w-0 resize-y rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
        <RequestFormFields fields={detail.formSchema} values={formData} onChange={setFormData} users={users} disabled={saving}/>
      </div>
      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 dark:border-slate-800 sm:flex-row sm:justify-end sm:px-7"><button type="button" onClick={close} disabled={saving} className="min-h-11 rounded-xl px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button><button type="button" onClick={() => void save()} disabled={saving || !dirty} className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50">{saving?<Loader2 className="animate-spin" size={17}/>:<Save size={17}/>} {detail.status==='PENDING'?'Lưu và duyệt lại':'Lưu thay đổi'}</button></footer>
    </div>
  </div>;
};
