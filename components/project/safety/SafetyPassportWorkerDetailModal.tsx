import React, { useEffect, useMemo, useState } from 'react';
import { Save, Upload, X } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import {
  SafetyAttachment,
  SafetyPassportContractor,
  SafetyProjectAssignment,
  SafetyWorkerDocument,
  SafetyWorkerDocumentType,
  SafetyWorkerProfile,
  User,
} from '../../../types';
import { SAFETY_DOCUMENT_LABELS } from '../../../lib/safetyPassportConfig';
import { safetyPassportService } from '../../../lib/safetyPassportService';

type CanonicalDocs = Partial<Record<SafetyWorkerDocumentType, SafetyWorkerDocument>>;

type Props = {
  worker: SafetyWorkerProfile | null;
  assignment?: SafetyProjectAssignment | null;
  documents?: CanonicalDocs;
  projectId?: string;
  constructionSiteId?: string | null;
  contractors: SafetyPassportContractor[];
  currentUser: User;
  canManage?: boolean;
  onClose: () => void;
  onSaved: (result: { worker: SafetyWorkerProfile; assignment?: SafetyProjectAssignment }) => void;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const dateValue = (value?: string | null) => value ? String(value).slice(0, 10) : '';

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
    <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-orange-600">Safety Passport</div>
          <h3 className="mt-1 text-base font-black text-slate-800">{title}</h3>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50/70 p-5">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">{footer}</div>
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
    {children}
  </label>
);

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none disabled:bg-slate-100 disabled:text-slate-400';

const FilePicker: React.FC<{ label: string; disabled?: boolean; onPick: (file: File) => void }> = ({ label, disabled, onPick }) => (
  <label className={`inline-flex min-h-9 items-center gap-2 rounded-lg border border-dashed px-3 text-xs font-black transition ${disabled ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'cursor-pointer border-slate-300 bg-white text-slate-600 hover:border-orange-300 hover:bg-orange-50'}`}>
    <Upload size={14} /> {label}
    <input type="file" disabled={disabled} className="hidden" onChange={event => {
      const file = event.target.files?.[0];
      if (file) onPick(file);
      event.currentTarget.value = '';
    }} />
  </label>
);

const attachmentFromDocument = (document?: SafetyWorkerDocument | null): SafetyAttachment | null =>
  document?.attachments?.[0] || null;

const documentStatus = (attachment: SafetyAttachment | null, expiryDate: string): SafetyWorkerDocument['status'] => {
  if (!attachment) return 'missing';
  if (expiryDate && expiryDate < todayIso()) return 'expired';
  return 'submitted';
};

const documentName = (type: SafetyWorkerDocumentType, numberValue: string) =>
  numberValue.trim() ? `${SAFETY_DOCUMENT_LABELS[type] || type} - ${numberValue.trim()}` : SAFETY_DOCUMENT_LABELS[type] || type;

const imageUrl = (attachment?: SafetyAttachment | null) => attachment?.previewUrl || attachment?.url || '';

const ImageDocumentBox: React.FC<{
  label: string;
  attachment: SafetyAttachment | null;
  disabled?: boolean;
  onPick: (file: File) => void;
}> = ({ label, attachment, disabled, onPick }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
    <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-lg bg-slate-100">
      {imageUrl(attachment)
        ? <img src={imageUrl(attachment)} alt={label} className="h-full w-full object-contain" />
        : <span className="text-xs font-black text-slate-300">Chưa có ảnh</span>}
    </div>
    <div className="mt-2">
      <FilePicker label={attachment ? 'Đổi file' : 'Tải file'} disabled={disabled} onPick={onPick} />
    </div>
  </div>
);

const SafetyPassportWorkerDetailModal: React.FC<Props> = ({
  worker,
  assignment,
  documents,
  projectId,
  constructionSiteId,
  contractors,
  currentUser,
  canManage = true,
  onClose,
  onSaved,
}) => {
  const toast = useToast();
  const [loadedWorker, setLoadedWorker] = useState<SafetyWorkerProfile | null>(worker);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [workerCode, setWorkerCode] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [identityIssueDate, setIdentityIssueDate] = useState('');
  const [identityIssuePlace, setIdentityIssuePlace] = useState('');
  const [permanentAddress, setPermanentAddress] = useState('');
  const [roleName, setRoleName] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [photoAttachment, setPhotoAttachment] = useState<SafetyAttachment | null>(null);
  const [identityFrontAttachment, setIdentityFrontAttachment] = useState<SafetyAttachment | null>(null);
  const [identityBackAttachment, setIdentityBackAttachment] = useState<SafetyAttachment | null>(null);

  const [siteAccessCardCode, setSiteAccessCardCode] = useState('');
  const [workType, setWorkType] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [siteTrainingStatus, setSiteTrainingStatus] = useState<SafetyProjectAssignment['siteTrainingStatus']>('pending');
  const [commitmentStatus, setCommitmentStatus] = useState<SafetyProjectAssignment['commitmentStatus']>('pending');
  const [ppeStatus, setPpeStatus] = useState<SafetyProjectAssignment['ppeStatus']>('missing');
  const [toolboxStatus, setToolboxStatus] = useState<SafetyProjectAssignment['toolboxStatus']>('pending');
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState('');

  const [healthNo, setHealthNo] = useState('');
  const [healthIssueDate, setHealthIssueDate] = useState('');
  const [healthExpiryDate, setHealthExpiryDate] = useState('');
  const [healthAttachment, setHealthAttachment] = useState<SafetyAttachment | null>(null);
  const [insuranceNo, setInsuranceNo] = useState('');
  const [insuranceIssueDate, setInsuranceIssueDate] = useState('');
  const [insuranceExpiryDate, setInsuranceExpiryDate] = useState('');
  const [insuranceAttachment, setInsuranceAttachment] = useState<SafetyAttachment | null>(null);

  useEffect(() => {
    let active = true;
    setLoadedWorker(worker);
    if (!worker?.id) return () => { active = false; };
    setLoadingProfile(true);
    safetyPassportService.getWorkerProfile(worker.id)
      .then(profile => { if (active) setLoadedWorker(profile || worker); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoadingProfile(false); });
    return () => { active = false; };
  }, [worker?.id]);

  const canonicalDocuments = useMemo<CanonicalDocs>(() => {
    const fromProfile = (loadedWorker?.documents || []).reduce<CanonicalDocs>((acc, item) => {
      acc[item.documentType as SafetyWorkerDocumentType] = item;
      return acc;
    }, {});
    return { ...(documents || {}), ...fromProfile };
  }, [documents, loadedWorker?.documents]);

  useEffect(() => {
    const source = loadedWorker || worker;
    setFullName(source?.fullName || '');
    setWorkerCode(source?.workerCode || '');
    setPhone(source?.phone || '');
    setDateOfBirth(dateValue(source?.dateOfBirth));
    setIdentityNumber(source?.identityNumber || '');
    setIdentityIssueDate(dateValue(source?.identityIssueDate));
    setIdentityIssuePlace(source?.identityIssuePlace || '');
    setPermanentAddress(source?.permanentAddress || '');
    setRoleName(assignment?.roleName || source?.roleName || '');
    setContractorId(assignment?.contractorId || source?.contractorId || '');
    setTeamName(assignment?.teamName || source?.teamName || '');
    setPhotoAttachment(source?.photoAttachment || null);
    setIdentityFrontAttachment(attachmentFromDocument(canonicalDocuments.identity_front) || source?.identityAttachments?.[0] || null);
    setIdentityBackAttachment(attachmentFromDocument(canonicalDocuments.identity_back) || source?.identityAttachments?.[1] || null);

    setSiteAccessCardCode(assignment?.siteAccessCardCode || '');
    setWorkType(assignment?.workType || '');
    setStartDate(dateValue(assignment?.startDate) || todayIso());
    setSiteTrainingStatus(assignment?.siteTrainingStatus || 'pending');
    setCommitmentStatus(assignment?.commitmentStatus || 'pending');
    setPpeStatus(assignment?.ppeStatus || 'missing');
    setToolboxStatus(assignment?.toolboxStatus || 'pending');
    setIsLocked(!!assignment?.isLocked);
    setLockReason(assignment?.lockReason || '');

    const health = canonicalDocuments.health_check;
    setHealthNo(health?.name?.replace(/^Giấy khám sức khỏe\s*-\s*/i, '') || '');
    setHealthIssueDate(dateValue(health?.issueDate));
    setHealthExpiryDate(dateValue(health?.expiryDate));
    setHealthAttachment(attachmentFromDocument(health));

    const insurance = canonicalDocuments.insurance;
    setInsuranceNo(insurance?.name?.replace(/^Bảo hiểm\s*-\s*/i, '') || '');
    setInsuranceIssueDate(dateValue(insurance?.issueDate));
    setInsuranceExpiryDate(dateValue(insurance?.expiryDate));
    setInsuranceAttachment(attachmentFromDocument(insurance));
  }, [assignment, canonicalDocuments, loadedWorker, worker]);

  const upload = async (file: File, category: string) => safetyPassportService.uploadAttachment({
    workerId: loadedWorker?.id || worker?.id || 'draft',
    category,
    file,
    uploadedBy: currentUser.name || currentUser.username || currentUser.id,
  });

  const save = async () => {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      const identityAttachments = [identityFrontAttachment, identityBackAttachment].filter(Boolean) as SafetyAttachment[];
      const result = await safetyPassportService.saveWorkerDetail({
        worker: {
          id: loadedWorker?.id || worker?.id,
          fullName: fullName.trim(),
          workerCode: workerCode.trim() || undefined,
          phone: phone.trim() || null,
          dateOfBirth: dateOfBirth || null,
          identityNumber: identityNumber.trim() || null,
          identityIssueDate: identityIssueDate || null,
          identityIssuePlace: identityIssuePlace.trim() || null,
          permanentAddress: permanentAddress.trim() || null,
          identityType: 'cccd',
          identityAttachments,
          photoAttachment,
          contractorId: contractorId || null,
          teamName: teamName.trim() || null,
          roleName: roleName.trim() || null,
          status: loadedWorker?.status || worker?.status || 'active',
          createdBy: loadedWorker?.createdBy || worker?.createdBy || currentUser.id,
          updatedBy: currentUser.id,
        },
        assignment: (assignment || projectId) ? {
          id: assignment?.id,
          projectId: assignment?.projectId || projectId || '',
          constructionSiteId: assignment?.constructionSiteId || constructionSiteId || null,
          contractorId: contractorId || null,
          teamName: teamName.trim() || null,
          roleName: roleName.trim() || null,
          workType: workType.trim() || null,
          siteAccessCardCode: siteAccessCardCode.trim() || null,
          startDate,
          siteTrainingStatus,
          commitmentStatus,
          ppeStatus,
          toolboxStatus,
          isLocked,
          lockReason: isLocked ? lockReason.trim() || null : null,
          createdBy: assignment?.createdBy || currentUser.id,
        } : undefined,
        documents: [
          {
            id: canonicalDocuments.identity_front?.id,
            documentType: 'identity_front',
            name: SAFETY_DOCUMENT_LABELS.identity_front,
            attachments: identityFrontAttachment ? [identityFrontAttachment] : [],
            status: identityFrontAttachment ? 'submitted' : 'missing',
            isRequired: true,
            createdBy: currentUser.id,
          },
          {
            id: canonicalDocuments.identity_back?.id,
            documentType: 'identity_back',
            name: SAFETY_DOCUMENT_LABELS.identity_back,
            attachments: identityBackAttachment ? [identityBackAttachment] : [],
            status: identityBackAttachment ? 'submitted' : 'missing',
            isRequired: true,
            createdBy: currentUser.id,
          },
          {
            id: canonicalDocuments.health_check?.id,
            documentType: 'health_check',
            name: documentName('health_check', healthNo),
            issueDate: healthIssueDate || null,
            expiryDate: healthExpiryDate || null,
            attachments: healthAttachment ? [healthAttachment] : [],
            status: documentStatus(healthAttachment, healthExpiryDate),
            isRequired: true,
            createdBy: currentUser.id,
          },
          {
            id: canonicalDocuments.insurance?.id,
            documentType: 'insurance',
            name: documentName('insurance', insuranceNo),
            issueDate: insuranceIssueDate || null,
            expiryDate: insuranceExpiryDate || null,
            attachments: insuranceAttachment ? [insuranceAttachment] : [],
            status: documentStatus(insuranceAttachment, insuranceExpiryDate),
            isRequired: true,
            createdBy: currentUser.id,
          },
        ],
      });
      toast.success('Đã lưu hồ sơ nhân công');
      onSaved(result);
      onClose();
    } catch (error: any) {
      toast.error('Không lưu được hồ sơ nhân công', error?.message || 'Có lỗi xảy ra');
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canManage || saving || loadingProfile;
  const hasAssignmentContext = !!assignment || !!projectId;

  return (
    <ModalShell
      title={worker ? 'Chi tiết hồ sơ nhân công' : 'Tạo hồ sơ nhân công'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Đóng</button>
          {canManage && <button type="button" disabled={saving || !fullName.trim()} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Save size={14} /> Lưu hồ sơ</button>}
        </>
      }
    >
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Thông tin công nhân</div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Mã giới thiệu"><input disabled={disabled} value={workerCode} onChange={event => setWorkerCode(event.target.value)} className={inputClass} placeholder="Tự sinh nếu bỏ trống" /></Field>
            {hasAssignmentContext && <Field label="Mã thẻ vào ra"><input disabled={disabled} value={siteAccessCardCode} onChange={event => setSiteAccessCardCode(event.target.value)} className={inputClass} /></Field>}
            {hasAssignmentContext && <Field label="Ngày vào"><input disabled={disabled} type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className={inputClass} /></Field>}
            {hasAssignmentContext && <Field label="Loại công việc"><input disabled={disabled} value={workType} onChange={event => setWorkType(event.target.value)} className={inputClass} /></Field>}
            <Field label="Họ tên" className="md:col-span-2"><input disabled={disabled} value={fullName} onChange={event => setFullName(event.target.value)} className={inputClass} required /></Field>
            <Field label="Chức danh"><input disabled={disabled} value={roleName} onChange={event => setRoleName(event.target.value)} className={inputClass} /></Field>
            <Field label="Ngày sinh"><input disabled={disabled} type="date" value={dateOfBirth} onChange={event => setDateOfBirth(event.target.value)} className={inputClass} /></Field>
            <Field label="Số điện thoại"><input disabled={disabled} value={phone} onChange={event => setPhone(event.target.value)} className={inputClass} /></Field>
            <Field label="Nhà thầu / tổ đội">
              <select disabled={disabled} value={contractorId} onChange={event => setContractorId(event.target.value)} className={inputClass}>
                <option value="">Chưa chọn</option>
                {contractors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Tên tổ đội"><input disabled={disabled} value={teamName} onChange={event => setTeamName(event.target.value)} className={inputClass} /></Field>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Giấy tờ cá nhân</div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Số CMND/CCCD"><input disabled={disabled} value={identityNumber} onChange={event => setIdentityNumber(event.target.value)} className={inputClass} /></Field>
            <Field label="Ngày cấp"><input disabled={disabled} type="date" value={identityIssueDate} onChange={event => setIdentityIssueDate(event.target.value)} className={inputClass} /></Field>
            <Field label="Nơi cấp"><input disabled={disabled} value={identityIssuePlace} onChange={event => setIdentityIssuePlace(event.target.value)} className={inputClass} /></Field>
            <Field label="Hộ khẩu thường trú"><input disabled={disabled} value={permanentAddress} onChange={event => setPermanentAddress(event.target.value)} className={inputClass} /></Field>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <ImageDocumentBox label="CCCD mặt trước" disabled={disabled} attachment={identityFrontAttachment} onPick={async file => setIdentityFrontAttachment(await upload(file, 'identity_front'))} />
            <ImageDocumentBox label="CCCD mặt sau" disabled={disabled} attachment={identityBackAttachment} onPick={async file => setIdentityBackAttachment(await upload(file, 'identity_back'))} />
            <ImageDocumentBox label="Ảnh thẻ" disabled={disabled} attachment={photoAttachment} onPick={async file => setPhotoAttachment(await upload(file, 'photo'))} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Hồ sơ an toàn</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-black text-slate-700">Giấy khám sức khỏe</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input disabled={disabled} value={healthNo} onChange={event => setHealthNo(event.target.value)} className={inputClass} placeholder="Số giấy" />
                <input disabled={disabled} type="date" value={healthIssueDate} onChange={event => setHealthIssueDate(event.target.value)} className={inputClass} />
                <input disabled={disabled} type="date" value={healthExpiryDate} onChange={event => setHealthExpiryDate(event.target.value)} className={inputClass} />
              </div>
              <div className="mt-2"><FilePicker disabled={disabled} label={healthAttachment ? 'Đổi giấy khám' : 'Tải giấy khám'} onPick={async file => setHealthAttachment(await upload(file, 'health_check'))} /></div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-black text-slate-700">Bảo hiểm</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input disabled={disabled} value={insuranceNo} onChange={event => setInsuranceNo(event.target.value)} className={inputClass} placeholder="Số thẻ" />
                <input disabled={disabled} type="date" value={insuranceIssueDate} onChange={event => setInsuranceIssueDate(event.target.value)} className={inputClass} />
                <input disabled={disabled} type="date" value={insuranceExpiryDate} onChange={event => setInsuranceExpiryDate(event.target.value)} className={inputClass} />
              </div>
              <div className="mt-2"><FilePicker disabled={disabled} label={insuranceAttachment ? 'Đổi bảo hiểm' : 'Tải bảo hiểm'} onPick={async file => setInsuranceAttachment(await upload(file, 'insurance'))} /></div>
            </div>
          </div>
        </section>

        {hasAssignmentContext && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Kiểm soát vào công trường</div>
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Đào tạo nội quy"><select disabled={disabled} value={siteTrainingStatus} onChange={event => setSiteTrainingStatus(event.target.value as any)} className={inputClass}><option value="pending">Chưa xong</option><option value="completed">Đã xong</option><option value="expired">Hết hạn</option></select></Field>
              <Field label="Cam kết"><select disabled={disabled} value={commitmentStatus} onChange={event => setCommitmentStatus(event.target.value as any)} className={inputClass}><option value="pending">Chưa ký</option><option value="signed">Đã ký</option></select></Field>
              <Field label="PPE"><select disabled={disabled} value={ppeStatus} onChange={event => setPpeStatus(event.target.value as any)} className={inputClass}><option value="missing">Thiếu</option><option value="partial">Chưa đủ</option><option value="complete">Đã đủ</option></select></Field>
              <Field label="Toolbox"><select disabled={disabled} value={toolboxStatus} onChange={event => setToolboxStatus(event.target.value as any)} className={inputClass}><option value="pending">Chưa xong</option><option value="completed">Đã xong</option><option value="expired">Hết hạn</option></select></Field>
              <Field label="Tạm khóa"><select disabled={disabled} value={isLocked ? 'yes' : 'no'} onChange={event => setIsLocked(event.target.value === 'yes')} className={inputClass}><option value="no">Không</option><option value="yes">Có</option></select></Field>
              {isLocked && <Field label="Lý do khóa" className="md:col-span-5"><input disabled={disabled} value={lockReason} onChange={event => setLockReason(event.target.value)} className={inputClass} /></Field>}
            </div>
          </section>
        )}
      </div>
    </ModalShell>
  );
};

export default SafetyPassportWorkerDetailModal;
