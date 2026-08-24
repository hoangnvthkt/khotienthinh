import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, Upload, X } from 'lucide-react';
import type {
  SafetyAttachment,
  SafetyCreateWorkerForSiteInput,
  SafetySiteWorkforceOptions,
  SafetyWorkerDetailPayload,
  SafetyWorkerDocumentPatch,
  SafetyWorkerKind,
  SafetyWorkerLookupResult,
} from '../../../../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../../../../lib/safetyWorkforceApi';

type ProfileDraft = {
  workerKind: SafetyWorkerKind;
  workerCode: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  identityNumber: string;
  identityIssueDate: string;
  identityIssuePlace: string;
  permanentAddress: string;
  roleName: string;
  subcontractorId: string;
  teamId: string;
};

type FormFiles = {
  photo: File | null;
  identityFront: File | null;
  identityBack: File | null;
  healthCheck: File | null;
  insurance: File | null;
};

export type SafetyWorkerProfileValidationInput = Pick<ProfileDraft, 'workerKind' | 'fullName' | 'subcontractorId'>;

export const validateSafetyWorkerProfileInput = (
  input: SafetyWorkerProfileValidationInput,
): Partial<Record<keyof SafetyWorkerProfileValidationInput, string>> => {
  const errors: Partial<Record<keyof SafetyWorkerProfileValidationInput, string>> = {};
  if (!input.fullName.trim()) errors.fullName = 'Vui lòng nhập họ và tên';
  if (input.workerKind === 'contractor_worker' && !input.subcontractorId.trim()) {
    errors.subcontractorId = 'Vui lòng chọn nhà thầu phụ';
  }
  return errors;
};

export const filterSafetyTeamsBySubcontractor = (
  options: SafetySiteWorkforceOptions,
  subcontractorId: string,
): SafetySiteWorkforceOptions['teams'] => {
  if (!subcontractorId.trim()) return [];
  return options.teams.filter(team => team.subcontractorId === subcontractorId);
};

interface Props {
  scope: SafetyWorkforceRequestScope;
  options: SafetySiteWorkforceOptions | null;
  optionsLoading: boolean;
  initialValue?: Partial<ProfileDraft>;
  onClose: () => void;
  onCreated: (detail: SafetyWorkerDetailPayload) => void;
}

const emptyFiles: FormFiles = {
  photo: null,
  identityFront: null,
  identityBack: null,
  healthCheck: null,
  insurance: null,
};

const initialDraft: ProfileDraft = {
  workerKind: 'company_staff',
  workerCode: '',
  fullName: '',
  phone: '',
  dateOfBirth: '',
  identityNumber: '',
  identityIssueDate: '',
  identityIssuePlace: '',
  permanentAddress: '',
  roleName: '',
  subcontractorId: '',
  teamId: '',
};

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-950';

const Field: React.FC<{
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, error, className = '', children }) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-[11px] font-black text-slate-600 dark:text-slate-300">{label}</span>
    {children}
    {error && <span className="mt-1 block text-[11px] font-bold text-red-600">{error}</span>}
  </label>
);

const FileField: React.FC<{
  label: string;
  file: File | null;
  disabled: boolean;
  accept?: string;
  onChange: (file: File | null) => void;
}> = ({ label, file, disabled, accept, onChange }) => (
  <label className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
    <span className="block text-[11px] font-black text-slate-600 dark:text-slate-300">{label}</span>
    <span className="mt-1 block truncate text-[11px] font-medium text-slate-400">{file?.name || 'Chưa chọn file'}</span>
    <span className="mt-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <Upload size={13} /> Chọn file
    </span>
    <input
      className="sr-only"
      type="file"
      accept={accept}
      disabled={disabled}
      onChange={event => onChange(event.target.files?.[0] || null)}
    />
  </label>
);

const attachmentDocument = (
  documentType: SafetyWorkerDocumentPatch['documentType'],
  name: string,
  attachment: SafetyAttachment,
): SafetyWorkerDocumentPatch => ({
  documentType,
  name,
  issueDate: null,
  expiryDate: null,
  attachments: [attachment],
  status: 'submitted',
  isRequired: true,
});

const lookupSummary = (lookup: SafetyWorkerLookupResult): string => {
  const parts = [lookup.workerCode, lookup.fullName, lookup.identityNumberMasked].filter(Boolean);
  return parts.join(' | ');
};

export const SafetyWorkerProfileForm: React.FC<Props> = ({
  scope,
  options,
  optionsLoading,
  initialValue,
  onClose,
  onCreated,
}) => {
  const [draft, setDraft] = useState<ProfileDraft>({ ...initialDraft, ...initialValue });
  const [files, setFiles] = useState<FormFiles>(emptyFiles);
  const [errors, setErrors] = useState<Partial<Record<keyof SafetyWorkerProfileValidationInput, string>>>({});
  const [lookup, setLookup] = useState<SafetyWorkerLookupResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'warning'; text: string } | null>(null);

  const safeOptions = options || { subcontractors: [], teams: [] };
  const availableTeams = useMemo(
    () => filterSafetyTeamsBySubcontractor(safeOptions, draft.subcontractorId),
    [draft.subcontractorId, safeOptions],
  );

  const setValue = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
  };

  const changeWorkerKind = (workerKind: SafetyWorkerKind): void => {
    setDraft(current => ({
      ...current,
      workerKind,
      ...(workerKind === 'company_staff' ? { subcontractorId: '', teamId: '' } : {}),
    }));
    setErrors(current => ({ ...current, subcontractorId: undefined }));
  };

  const changeSubcontractor = (subcontractorId: string): void => {
    setDraft(current => ({ ...current, subcontractorId, teamId: '' }));
    setErrors(current => ({ ...current, subcontractorId: undefined }));
  };

  const runExactLookup = async (): Promise<SafetyWorkerLookupResult | null> => {
    if (!draft.workerCode.trim() && !draft.identityNumber.trim()) {
      setLookup(null);
      return null;
    }
    setChecking(true);
    try {
      const result = await safetyWorkforceApi.lookupExact(scope, {
        workerCode: draft.workerCode,
        identityType: 'cccd',
        identityNumber: draft.identityNumber,
      });
      setLookup(result);
      return result;
    } finally {
      setChecking(false);
    }
  };

  const checkExisting = (): void => {
    void runExactLookup().catch(error => {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Không kiểm tra được hồ sơ trùng',
      });
    });
  };

  const uploadDocuments = async (
    detail: SafetyWorkerDetailPayload,
  ): Promise<SafetyWorkerDetailPayload> => {
    const workerId = detail.profile.id;
    const membershipId = detail.rosterItem.membership.id;
    let latest = detail;
    const documentPatches: SafetyWorkerDocumentPatch[] = [];

    if (files.photo) {
      const photoAttachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'photo', files.photo);
      latest = await safetyWorkforceApi.updateProfile(scope, membershipId, { photoAttachment });
    }
    if (files.identityFront) {
      const attachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'identity_front', files.identityFront);
      documentPatches.push(attachmentDocument('identity_front', 'CCCD mặt trước', attachment));
    }
    if (files.identityBack) {
      const attachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'identity_back', files.identityBack);
      documentPatches.push(attachmentDocument('identity_back', 'CCCD mặt sau', attachment));
    }
    if (files.healthCheck) {
      const attachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'health_check', files.healthCheck);
      documentPatches.push(attachmentDocument('health_check', 'Giấy khám sức khỏe', attachment));
    }
    if (files.insurance) {
      const attachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'insurance', files.insurance);
      documentPatches.push(attachmentDocument('insurance', 'Bảo hiểm', attachment));
    }
    if (documentPatches.length > 0) {
      latest = await safetyWorkforceApi.saveDocuments(scope, membershipId, documentPatches);
    }
    return latest;
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const nextErrors = validateSafetyWorkerProfileInput(draft);
    setErrors(nextErrors);
    setMessage(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    let created: SafetyWorkerDetailPayload | null = null;
    try {
      await runExactLookup();
      const input: SafetyCreateWorkerForSiteInput = {
        workerKind: draft.workerKind,
        profile: {
          workerCode: draft.workerCode.trim() || undefined,
          fullName: draft.fullName.trim(),
          phone: draft.phone.trim() || null,
          dateOfBirth: draft.dateOfBirth || null,
          identityType: 'cccd',
          identityNumber: draft.identityNumber.trim() || null,
          identityIssueDate: draft.identityIssueDate || null,
          identityIssuePlace: draft.identityIssuePlace.trim() || null,
          permanentAddress: draft.permanentAddress.trim() || null,
          roleName: draft.roleName.trim() || null,
        },
        subcontractorId: draft.workerKind === 'contractor_worker' ? draft.subcontractorId : null,
        teamId: draft.workerKind === 'contractor_worker' ? draft.teamId || null : null,
      };
      created = await safetyWorkforceApi.createProfile(scope, input);
      const completed = await uploadDocuments(created);
      onCreated(completed);
      onClose();
    } catch (error) {
      if (created) {
        setMessage({ type: 'warning', text: 'Hồ sơ đã tạo, còn file chưa tải xong' });
        onCreated(created);
      } else {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Không tạo được hồ sơ nhân công',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || (draft.workerKind === 'contractor_worker' && optionsLoading);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-3 py-5" role="dialog" aria-modal="true" aria-labelledby="safety-worker-form-title">
      <form onSubmit={submit} className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-orange-600">Hồ sơ gốc</div>
            <h2 id="safety-worker-form-title" className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">Tạo hồ sơ nhân công</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">Hồ sơ được dùng lại khi nhân công chuyển sang công trường khác.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5 dark:bg-slate-950/40">
          {message && (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs font-bold ${message.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {message.text}
            </div>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Phân loại nhân sự</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                ['company_staff', 'Cán bộ công ty', 'Thuộc biên chế công ty, không gắn nhà thầu phụ'],
                ['contractor_worker', 'Nhân công nhà thầu', 'Lấy nhà thầu và tổ đội từ danh mục công trường'],
              ] as const).map(([value, label, description]) => (
                <label key={value} className={`cursor-pointer rounded-lg border p-3 ${draft.workerKind === value ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
                  <span className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
                    <input type="radio" name="workerKind" value={value} checked={draft.workerKind === value} disabled={saving} onChange={() => changeWorkerKind(value)} />
                    {label}
                  </span>
                  <span className="mt-1 block pl-5 text-[11px] font-medium text-slate-500">{description}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Thông tin cá nhân</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Field label="Mã nhân công"><input className={inputClass} value={draft.workerCode} disabled={saving} placeholder="Tự sinh nếu bỏ trống" onChange={event => setValue('workerCode', event.target.value)} onBlur={checkExisting} /></Field>
              <Field label="Họ và tên" error={errors.fullName} className="md:col-span-2"><input className={inputClass} value={draft.fullName} disabled={saving} required onChange={event => setValue('fullName', event.target.value)} /></Field>
              <Field label="Số điện thoại"><input className={inputClass} value={draft.phone} disabled={saving} inputMode="tel" onChange={event => setValue('phone', event.target.value)} /></Field>
              <Field label="Ngày sinh"><input className={inputClass} type="date" value={draft.dateOfBirth} disabled={saving} onChange={event => setValue('dateOfBirth', event.target.value)} /></Field>
              <Field label="Số CCCD"><input className={inputClass} value={draft.identityNumber} disabled={saving} inputMode="numeric" onChange={event => setValue('identityNumber', event.target.value)} onBlur={checkExisting} /></Field>
              <Field label="Ngày cấp"><input className={inputClass} type="date" value={draft.identityIssueDate} disabled={saving} onChange={event => setValue('identityIssueDate', event.target.value)} /></Field>
              <Field label="Nơi cấp"><input className={inputClass} value={draft.identityIssuePlace} disabled={saving} onChange={event => setValue('identityIssuePlace', event.target.value)} /></Field>
              <Field label="Chức danh"><input className={inputClass} value={draft.roleName} disabled={saving} onChange={event => setValue('roleName', event.target.value)} /></Field>
              <Field label="Địa chỉ thường trú" className="md:col-span-3"><input className={inputClass} value={draft.permanentAddress} disabled={saving} onChange={event => setValue('permanentAddress', event.target.value)} /></Field>
            </div>

            {checking && <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-slate-500"><Loader2 className="animate-spin" size={13} /> Đang kiểm tra hồ sơ trùng</div>}
            {!checking && lookup && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                <div className="font-black">Đã tìm thấy hồ sơ gốc</div>
                <div className="mt-1 font-mono text-[11px]">{lookupSummary(lookup)}</div>
                <div className="mt-1 font-medium">Hệ thống sẽ dùng lại hồ sơ này tại công trường hiện tại.</div>
              </div>
            )}
          </section>

          {draft.workerKind === 'contractor_worker' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Nhà thầu phụ và tổ đội</h3>
              <p className="mt-1 text-[11px] font-medium text-slate-500">Danh mục chỉ lấy trong công trường đang chọn.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Nhà thầu phụ" error={errors.subcontractorId}>
                  <select className={inputClass} value={draft.subcontractorId} disabled={disabled} onChange={event => changeSubcontractor(event.target.value)}>
                    <option value="">Chọn nhà thầu phụ</option>
                    {safeOptions.subcontractors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="Tổ đội">
                  <select className={inputClass} value={draft.teamId} disabled={disabled || !draft.subcontractorId} onChange={event => setValue('teamId', event.target.value)}>
                    <option value="">Không chọn tổ đội</option>
                    {availableTeams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Ảnh và hồ sơ đính kèm</h3>
            <p className="mt-1 text-[11px] font-medium text-slate-500">Hồ sơ gốc được tạo trước, file sẽ tải lên theo đúng mã nhân công sau đó.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <FileField label="Ảnh nhân công" file={files.photo} disabled={saving} accept="image/*" onChange={file => setFiles(current => ({ ...current, photo: file }))} />
              <FileField label="CCCD mặt trước" file={files.identityFront} disabled={saving} accept="image/*,.pdf" onChange={file => setFiles(current => ({ ...current, identityFront: file }))} />
              <FileField label="CCCD mặt sau" file={files.identityBack} disabled={saving} accept="image/*,.pdf" onChange={file => setFiles(current => ({ ...current, identityBack: file }))} />
              <FileField label="Giấy khám sức khỏe" file={files.healthCheck} disabled={saving} accept="image/*,.pdf" onChange={file => setFiles(current => ({ ...current, healthCheck: file }))} />
              <FileField label="Bảo hiểm" file={files.insurance} disabled={saving} accept="image/*,.pdf" onChange={file => setFiles(current => ({ ...current, insurance: file }))} />
            </div>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-10 rounded-lg px-4 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Đóng</button>
          <button type="submit" disabled={disabled} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-black text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {saving ? 'Đang lưu' : 'Lưu hồ sơ'}
          </button>
        </footer>
      </form>
    </div>
  );
};

export default SafetyWorkerProfileForm;
