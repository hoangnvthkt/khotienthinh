import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, FileText, Loader2, Send, X } from 'lucide-react';
import {
  EDITOR_META, REQUEST_KINDS, missingRequired,
  type EditorField, type ProfileChangeKind,
} from '../../lib/hrmProfileFields';
import { hrmProfileChangeService } from '../../lib/hrmProfileChangeService';

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export const ProfileFieldInput: React.FC<{
  field: EditorField;
  value: unknown;
  onChange: (value: string | boolean) => void;
}> = ({ field, value, onChange }) => {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-sky-700" />
        {field.label}
      </label>
    );
  }
  return (
    <label className="block space-y-2">
      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{field.label}{field.required ? ' *' : ''}</span>
      {field.type === 'select' ? (
        <select value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass}>
          <option value="">— Chọn —</option>
          {(field.options || []).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      ) : (
        <input
          type={field.type || 'text'}
          inputMode={field.type === 'number' ? 'numeric' : undefined}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={event => onChange(event.target.value)}
          className={inputClass}
        />
      )}
      {field.hint && <span className="block text-xs font-medium text-slate-500">{field.hint}</span>}
    </label>
  );
};

/** Employee asks HR to change a verified part of their own profile, with photos as evidence. */
const ProfileChangeRequestDialog: React.FC<{
  employeeId: string;
  initialKind?: ProfileChangeKind | null;
  onClose: () => void;
  onSubmitted: () => void;
}> = ({ employeeId, initialKind = null, onClose, onSubmitted }) => {
  const [kind, setKind] = useState<ProfileChangeKind | null>(initialKind);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const previews = useMemo(() => files.map(file => ({
    file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
  })), [files]);
  useEffect(() => () => previews.forEach(preview => preview.url && URL.revokeObjectURL(preview.url)), [previews]);

  const meta = kind ? REQUEST_KINDS.find(item => item.kind === kind) : null;
  const fields = kind && kind !== 'other' ? EDITOR_META[kind].fields.filter(field => !field.hiddenOnRequest) : [];
  const missing = kind === 'other'
    ? (note.trim().length < 5 ? ['Nội dung cần sửa'] : [])
    : missingRequired(fields, form);

  const pickKind = (next: ProfileChangeKind) => {
    setKind(next);
    setForm(next === 'address' ? { addressType: 'CURRENT' } : {});
    setError('');
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = Array.from(list).filter(file => file.type.startsWith('image/') || file.type === 'application/pdf');
    setFiles(current => [...current, ...accepted].slice(0, hrmProfileChangeService.MAX_ATTACHMENTS));
  };

  const submit = async () => {
    if (!kind || missing.length > 0) return;
    setSaving(true);
    setError('');
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '' && value != null));
      await hrmProfileChangeService.submit({ employeeId, kind, payload, note, files });
      onSubmitted();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không gửi được đề nghị.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Đề nghị cập nhật hồ sơ">
      <div className="flex max-h-[92svh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          {kind && !initialKind && (
            <button type="button" onClick={() => setKind(null)} className="-ml-1 rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Chọn loại khác">
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950 dark:text-white">{meta ? meta.label : 'Bạn muốn cập nhật gì?'}</h2>
            <p className="mt-0.5 text-sm font-semibold text-slate-500">
              {meta ? 'HR đối chiếu giấy tờ rồi cập nhật vào hồ sơ. Bạn sẽ nhận thông báo khi có kết quả.' : 'Chọn một mục. Điện thoại và email cá nhân bạn tự sửa được ngay.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!kind ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {REQUEST_KINDS.map(item => (
                <button key={item.kind} type="button" onClick={() => pickKind(item.kind)}
                  className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-sky-400 hover:bg-sky-50 active:scale-[0.99] dark:border-slate-700 dark:hover:bg-slate-800">
                  <p className="text-sm font-black text-slate-900 dark:text-white">{item.label}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">{item.hint}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {fields.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map(field => (
                    <ProfileFieldInput key={field.key} field={field} value={form[field.key]}
                      onChange={value => setForm(current => ({ ...current, [field.key]: value }))} />
                  ))}
                </div>
              )}

              <div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Ảnh giấy tờ</p>
                <p className="text-xs font-medium text-slate-500">{meta?.evidence}. Tối đa {hrmProfileChangeService.MAX_ATTACHMENTS} ảnh hoặc PDF, ảnh được nén trước khi gửi.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {previews.map(({ file, url }, index) => (
                    <div key={`${file.name}-${index}`} className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      {url ? <img src={url} alt={file.name} className="h-full w-full object-cover" />
                        : <div className="flex h-full flex-col items-center justify-center gap-1 p-1 text-[10px] font-bold text-slate-500"><FileText size={18} /><span className="w-full truncate text-center">{file.name}</span></div>}
                      <button type="button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}
                        className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-0.5 text-white" aria-label="Bỏ ảnh"><X size={12} /></button>
                    </div>
                  ))}
                  {files.length < hrmProfileChangeService.MAX_ATTACHMENTS && (
                    <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-[11px] font-bold text-slate-500 hover:border-sky-500 hover:text-sky-700 dark:border-slate-600">
                      <Camera size={18} /> Thêm ảnh
                      <input type="file" accept="image/*,application/pdf" multiple className="sr-only"
                        onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
                    </label>
                  )}
                </div>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{kind === 'other' ? 'Nội dung cần sửa *' : 'Ghi chú cho HR'}</span>
                <textarea value={note} onChange={event => setNote(event.target.value)} rows={3}
                  placeholder={kind === 'other' ? 'Ví dụ: Ngày sinh đúng là 12/03/1990, hồ sơ đang ghi 21/03/1990' : 'Không bắt buộc'}
                  className={`${inputClass} resize-none`} />
              </label>
              {error && <p className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
            </div>
          )}
        </div>

        {kind && (
          <div className="flex items-center gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-500">
              {missing.length > 0 ? `Còn thiếu: ${missing.join(', ')}` : 'Sẵn sàng gửi'}
            </p>
            <button type="button" onClick={() => void submit()} disabled={saving || missing.length > 0}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]">
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Gửi HR duyệt
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileChangeRequestDialog;
