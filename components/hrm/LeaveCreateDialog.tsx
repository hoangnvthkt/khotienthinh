import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, FileText, Paperclip, Send, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  LEAVE_MAX_ATTACHMENTS, type LeavePreview, leaveService, type LeaveSession, type LeaveSettings, type LeaveTypeOption,
} from '../../lib/leaveService';
import { PAID_BY_LABEL, subtypeProblem } from '../../lib/leavePolicy';

// Form "Tạo đơn" nghỉ phép / đi muộn về sớm / xác nhận tăng ca. Tách từ pages/hrm/LeaveManagement.tsx (07/10/2026)
// để Trung tâm điều hành mở được ngay trong màn; máy chủ vẫn tính xem trước và tuyến duyệt (preview / submit).
const today = () => new Date().toLocaleDateString('sv-SE');

const LeaveCreateDialog: React.FC<{
  employeeId: string;
  types: LeaveTypeOption[];
  settings: LeaveSettings | null;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}> = ({ employeeId, types, settings, onClose, onSubmitted }) => {
  const toast = useToast();
  const [typeCode, setTypeCode] = useState(types[0]?.code || 'annual');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [startSession, setStartSession] = useState<LeaveSession>('full');
  const [endSession, setEndSession] = useState<LeaveSession>('full');
  const [minutes, setMinutes] = useState(30);
  const [subtype, setSubtype] = useState('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [sending, setSending] = useState(false);

  const type = types.find(item => item.code === typeCode);
  const isMinute = type?.unit === 'minute';
  const singleDay = start === end;
  const subtypes = type?.subtypes || [];
  const payload = {
    type: typeCode,
    start,
    end: isMinute ? start : end,
    startSession: isMinute ? 'full' as const : startSession,
    endSession: isMinute ? 'full' as const : singleDay ? startSession : endSession,
    minutes: isMinute ? minutes : null,
    subtype: subtype || null,
  };

  useEffect(() => {
    if (!start || (!isMinute && !end)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      leaveService.preview(payload)
        .then(result => { if (!cancelled) { setPreview(result); setPreviewError(''); } })
        .catch(error => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Không xem trước được.'); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeCode, start, end, startSession, endSession, minutes, isMinute, subtype]);

  const submit = async () => {
    setSending(true);
    try {
      await leaveService.submit({ ...payload, reason, employeeId, files });
      toast.success('Đã gửi đơn', preview?.steps[0] ? `Chờ ${preview.steps[0].name || preview.steps[0].label} duyệt.` : undefined);
      await onSubmitted();
    } catch (error) {
      toast.error('Chưa gửi được đơn', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSending(false);
    }
  };

  const reasonProblem = type && preview ? subtypeProblem(type, subtype, preview.days) : null;
  const missingPaper = !!type?.requiresAttachment && files.length === 0;
  const missing = [
    ...(subtypes.length > 0 && !subtype ? ['chọn lý do nghỉ'] : []),
    ...(reason.trim().length < 3 ? ['ghi lý do'] : []),
    ...(missingPaper ? ['giấy tờ đính kèm'] : []),
  ];
  const blocked = !preview || preview.problems.length > 0 || reason.trim().length < 3 || !!reasonProblem || missingPaper;
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).filter(file => file.type.startsWith('image/') || file.type === 'application/pdf');
    setFiles(current => [...current, ...picked].slice(0, LEAVE_MAX_ATTACHMENTS));
  };
  const sessionButtons = (value: LeaveSession, onChange: (value: LeaveSession) => void, options: LeaveSession[]) => (
    <div className="flex gap-1">
      {options.map(option => (
        <button key={option} type="button" onClick={() => onChange(option)}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${value === option ? 'bg-mint-600 text-white' : 'bg-muted text-muted-foreground'}`}>
          {option === 'full' ? 'Cả ngày' : option === 'morning' ? 'Sáng' : 'Chiều'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h3 className="text-lg font-black text-foreground">Tạo đơn</h3>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">1. Loại đơn</p>
            <div className="grid grid-cols-2 gap-2">
              {types.map(item => (
                <button key={item.code} type="button" onClick={() => { setTypeCode(item.code); setSubtype(''); setFiles([]); }}
                  className={`rounded-xl border p-2.5 text-left ${typeCode === item.code ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30' : 'border-border'}`}>
                  <p className="text-xs font-black text-foreground">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">{PAID_BY_LABEL[item.paidBy]}</p>
                </button>
              ))}
            </div>
            {type?.description && <p className="mt-2 text-[11px] text-muted-foreground">{type.description}</p>}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">2. Thời gian</p>
            {typeCode === 'overtime' ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-muted-foreground">Tháng
                  <input type="month" value={start.slice(0, 7)} onChange={event => setStart(`${event.target.value}-01`)}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-bold text-muted-foreground">Số phút xác nhận
                  <input type="number" min={1} value={minutes}
                    onChange={event => setMinutes(Math.max(0, parseInt(event.target.value, 10) || 0))}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
                {preview?.unclaimedMinutes !== null && preview?.unclaimedMinutes !== undefined && (
                  <p className="col-span-2 text-[11px] text-muted-foreground">
                    Tháng này còn <b>{preview.unclaimedMinutes} phút</b> đến sớm / về muộn chưa xác nhận.{' '}
                    {preview.unclaimedMinutes > 0 && minutes !== preview.unclaimedMinutes && (
                      <button type="button" className="font-bold text-mint-700 underline" onClick={() => setMinutes(preview.unclaimedMinutes || 0)}>Dùng hết</button>
                    )}
                  </p>
                )}
              </div>
            ) : isMinute ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-muted-foreground">Ngày
                  <input type="date" value={start} onChange={event => setStart(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-bold text-muted-foreground">Số phút (tối đa {settings?.lateEarlyMaxMinutes ?? 60})
                  <input type="number" min={1} max={settings?.lateEarlyMaxMinutes ?? 60} value={minutes}
                    onChange={event => setMinutes(Math.max(0, parseInt(event.target.value, 10) || 0))}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs font-bold text-muted-foreground">Từ ngày
                    <input type="date" value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); }}
                      className="mt-1 block rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                  </label>
                  {sessionButtons(startSession, setStartSession, singleDay ? ['full', 'morning', 'afternoon'] : ['full', 'afternoon'])}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs font-bold text-muted-foreground">Đến ngày
                    <input type="date" value={end} min={start} onChange={event => setEnd(event.target.value)}
                      className="mt-1 block rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                  </label>
                  {!singleDay && sessionButtons(endSession, setEndSession, ['full', 'morning'])}
                </div>
              </div>
            )}
            {subtypes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-bold text-muted-foreground">Lý do nghỉ</p>
                <div className="flex flex-wrap gap-1.5">
                  {subtypes.map(item => (
                    <button key={item.name} type="button" onClick={() => setSubtype(item.name === subtype ? '' : item.name)} aria-pressed={subtype === item.name}
                      className={`rounded-full border px-3 py-1 text-[11px] font-bold ${subtype === item.name ? 'border-mint-500 bg-mint-50 text-mint-700 dark:bg-mint-900/30' : 'border-border text-muted-foreground'}`}>
                      {item.name}{item.maxDays !== null && !isMinute ? <span className="font-normal"> · tối đa {item.maxDays.toLocaleString('vi-VN')} ngày</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">3. Lý do</p>
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2}
              placeholder={isMinute ? 'Ví dụ: đi xử lý hồ sơ tại sở xây dựng' : 'Ví dụ: về quê có việc gia đình'}
              className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm" />
          </div>

          {!isMinute && (
            <div>
              <p className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
                4. Giấy tờ {type?.requiresAttachment ? <span className="text-rose-600">(bắt buộc)</span> : <span className="font-bold normal-case">(không bắt buộc)</span>}
              </p>
              {type?.requiresAttachment && type.attachmentHint && <p className="mb-2 text-xs text-foreground">{type.attachmentHint}</p>}
              {files.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-1.5 text-xs">
                      <FileText size={13} className="shrink-0 text-mint-600" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <button type="button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))} aria-label={`Bỏ ${file.name}`}
                        className="rounded p-0.5 text-muted-foreground hover:text-rose-600"><X size={13} /></button>
                    </li>
                  ))}
                </ul>
              )}
              {files.length < LEAVE_MAX_ATTACHMENTS && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-mint-400 px-3 py-2 text-xs font-bold text-mint-700 hover:bg-mint-50 dark:text-mint-300 dark:hover:bg-mint-900/20">
                  <Paperclip size={14} /> Chụp ảnh / chọn file
                  <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
                </label>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-border bg-muted/40 p-3">
            {previewError ? (
              <p className="text-xs font-bold text-rose-600">{previewError}</p>
            ) : !preview ? (
              <p className="text-xs text-muted-foreground">Đang tính…</p>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="font-bold text-foreground">
                  {isMinute ? `${minutes} phút` : `${preview.days.toLocaleString('vi-VN')} ngày làm việc`}
                  {' · '}{PAID_BY_LABEL[preview.paidBy]}
                  {preview.annualRemaining !== null && type?.deductsAnnual
                    ? ` · phép còn ${preview.annualRemaining.toLocaleString('vi-VN')} → ${(preview.annualRemaining - preview.days).toLocaleString('vi-VN')} ngày`
                    : ''}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Send size={12} className="text-mint-600" />
                  {preview.steps.map((step, index) => (
                    <React.Fragment key={step.order}>
                      {index > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
                      <span className="rounded-lg bg-card px-2 py-0.5 font-bold text-mint-700 dark:text-mint-300">
                        {step.name} <span className="font-normal text-muted-foreground">({step.label})</span>
                      </span>
                    </React.Fragment>
                  ))}
                </div>
                {reasonProblem && subtype && <p className="flex items-start gap-1 font-bold text-rose-600"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{reasonProblem}</p>}
                {preview.problems.map(problem => (
                  <p key={problem} className="flex items-start gap-1 font-bold text-rose-600"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{problem}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-border p-4">
          {preview && preview.problems.length === 0 && missing.length > 0 && (
            <p className="mb-2 text-xs font-bold text-muted-foreground">Còn thiếu: {missing.join(', ')}.</p>
          )}
          <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-muted">Đóng</button>
          <button type="button" onClick={() => void submit()} disabled={blocked || sending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2.5 text-sm font-black text-white hover:bg-leaf-700 disabled:opacity-40">
            <Send size={16} /> {sending ? 'Đang gửi…' : 'Gửi đơn'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeaveCreateDialog;
