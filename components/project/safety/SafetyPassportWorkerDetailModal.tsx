import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, FileUp, Loader2, Pencil, RefreshCw, Save, UserRound, X } from 'lucide-react';
import type {
  SafetyWorkerDetailPayload,
  SafetyWorkerDocument,
  SafetyWorkerDocumentPatch,
  SafetyWorkerDocumentType,
} from '../../../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../../../lib/safetyWorkforceApi';
import { useSafetyWorkerDetail } from '../../../hooks/useSafetyWorkforce';
import SafetyWorkerCardSection from './passport/SafetyWorkerCardSection';
import SafetyWorkerHistory from './passport/SafetyWorkerHistory';

interface Props {
  scope: SafetyWorkforceRequestScope;
  membershipId: string;
  onClose: () => void;
}

const membershipLabel = (status: string): string => {
  if (status === 'active') return 'Đang tham gia';
  if (status === 'candidate') return 'Chờ gán';
  return 'Đã rời công trường';
};

const assignmentLabel = (status?: string): string => {
  if (status === 'active') return 'Đang làm tại công trường';
  if (status === 'suspended') return 'Tạm dừng';
  return 'Chưa được gán';
};

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const documentLabels: Partial<Record<SafetyWorkerDocumentType, string>> = {
  identity_front: 'CCCD mặt trước',
  identity_back: 'CCCD mặt sau',
  health_check: 'Giấy khám sức khỏe',
  insurance: 'Bảo hiểm',
};

const documentPatch = (
  existing: SafetyWorkerDocument | undefined,
  documentType: SafetyWorkerDocumentType,
  attachment: SafetyWorkerDocument['attachments'][number],
): SafetyWorkerDocumentPatch => ({
  id: existing?.id,
  documentType,
  name: existing?.name || documentLabels[documentType] || documentType,
  issueDate: existing?.issueDate || null,
  expiryDate: existing?.expiryDate || null,
  attachments: [attachment],
  status: 'submitted',
  isRequired: existing?.isRequired ?? true,
});

const SafetyPassportWorkerDetailModal: React.FC<Props> = ({ scope, membershipId, onClose }) => {
  const basicState = useSafetyWorkerDetail(scope, membershipId, false);
  const basicDetail = basicState.data;
  const canLoadSensitive = Boolean(basicDetail && (
    basicDetail.capabilities.canManageWorker || basicDetail.capabilities.canVerifyDocuments
  ));
  const [sensitiveOpen, setSensitiveOpen] = useState(false);
  const sensitiveMembershipId = sensitiveOpen && canLoadSensitive ? membershipId : null;
  const sensitiveState = useSafetyWorkerDetail(scope, sensitiveMembershipId, true);
  const [commandDetail, setCommandDetail] = useState<SafetyWorkerDetailPayload | null>(null);
  const [sensitiveNotice, setSensitiveNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleName, setRoleName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');

  const operationalDetail = commandDetail || basicDetail;
  const detail = sensitiveOpen && sensitiveState.data ? sensitiveState.data : operationalDetail;
  const item = detail?.rosterItem;

  useEffect(() => {
    const profile = operationalDetail?.profile;
    if (!profile) return;
    setFullName(profile.fullName);
    setPhone(profile.phone || '');
    setRoleName(profile.roleName || '');
    setDateOfBirth(profile.dateOfBirth?.slice(0, 10) || '');
  }, [operationalDetail?.profile]);

  useEffect(() => {
    if (!sensitiveState.error) return;
    setSensitiveOpen(false);
    setSensitiveNotice('Không có quyền tải giấy tờ và chứng chỉ của hồ sơ này.');
  }, [sensitiveState.error]);

  const saveProfile = async (): Promise<void> => {
    if (!operationalDetail || !fullName.trim()) return;
    setSaving(true);
    try {
      const updated = await safetyWorkforceApi.updateProfile(scope, membershipId, {
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        roleName: roleName.trim() || null,
        dateOfBirth: dateOfBirth || null,
      });
      setCommandDetail(updated);
      setEditing(false);
    } catch (error) {
      setSensitiveNotice(error instanceof Error ? error.message : 'Không lưu được hồ sơ nhân công.');
    } finally {
      setSaving(false);
    }
  };

  const replaceDocument = async (
    documentType: SafetyWorkerDocumentType,
    file: File,
  ): Promise<void> => {
    const sensitiveDetail = sensitiveState.data;
    if (!sensitiveDetail) return;
    setSaving(true);
    try {
      const attachment = await safetyWorkforceApi.uploadWorkerAttachment(
        sensitiveDetail.profile.id,
        documentType,
        file,
      );
      const existing = sensitiveDetail.documents.find(document => document.documentType === documentType);
      const updated = await safetyWorkforceApi.saveDocuments(
        scope,
        membershipId,
        [documentPatch(existing, documentType, attachment)],
      );
      setCommandDetail(updated);
      await sensitiveState.reload();
    } catch (error) {
      setSensitiveNotice(error instanceof Error ? error.message : 'Không lưu được giấy tờ nhân công.');
    } finally {
      setSaving(false);
    }
  };

  const toggleSensitive = (): void => {
    if (!canLoadSensitive) return;
    setSensitiveNotice(null);
    setSensitiveOpen(value => !value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-3 py-5" role="dialog" aria-modal="true" aria-labelledby="safety-worker-detail-title">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-orange-600">Hồ sơ nhân công</div>
            <h2 id="safety-worker-detail-title" className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">Chi tiết tại công trường</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">Hồ sơ gốc, lịch sử làm việc và thẻ an toàn trong cùng một nơi.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-5 dark:bg-slate-950/40">
          {basicState.loading && !basicDetail && (
            <div className="space-y-3" aria-label="Đang tải chi tiết hồ sơ"><div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" /><div className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" /></div>
          )}

          {basicState.error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              <div className="min-w-0 flex-1"><div className="text-xs font-black">Không tải được hồ sơ nhân công</div><p className="mt-1 text-xs">{basicState.error.message}</p></div>
              <button type="button" onClick={() => { void basicState.reload(); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-black text-red-700 dark:bg-slate-950 dark:text-red-200"><RefreshCw size={13} /> Thử lại</button>
            </div>
          )}

          {sensitiveNotice && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">{sensitiveNotice}</div>}

          {detail && item && (
            <div className="space-y-4">
              <section className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">{item.worker.photoUrl ? <img src={item.worker.photoUrl} alt={`Ảnh ${item.worker.fullName}`} className="h-full w-full object-cover" /> : <UserRound size={22} />}</div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-black text-slate-900 dark:text-slate-100">{detail.profile.fullName}</h3>
                  <div className="mt-1 font-mono text-xs font-bold text-orange-700 dark:text-orange-300">{detail.profile.workerCode}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold"><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{membershipLabel(item.membership.status)}</span><span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{assignmentLabel(item.activeAssignment?.assignmentStatus)}</span></div>
                </div>
                {detail.capabilities.canManageWorker && <button type="button" onClick={() => setEditing(value => !value)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 dark:border-slate-700 dark:text-slate-300"><Pencil size={13} /> {editing ? 'Hủy sửa' : 'Sửa hồ sơ'}</button>}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Thông tin cơ bản</h3>
                {editing ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label><span className="mb-1 block text-[11px] font-black text-slate-500">Họ và tên</span><input className={inputClass} value={fullName} disabled={saving} onChange={event => setFullName(event.target.value)} /></label>
                    <label><span className="mb-1 block text-[11px] font-black text-slate-500">Điện thoại</span><input className={inputClass} value={phone} disabled={saving} onChange={event => setPhone(event.target.value)} /></label>
                    <label><span className="mb-1 block text-[11px] font-black text-slate-500">Chức danh</span><input className={inputClass} value={roleName} disabled={saving} onChange={event => setRoleName(event.target.value)} /></label>
                    <label><span className="mb-1 block text-[11px] font-black text-slate-500">Ngày sinh</span><input type="date" className={inputClass} value={dateOfBirth} disabled={saving} onChange={event => setDateOfBirth(event.target.value)} /></label>
                    <div className="sm:col-span-2"><button type="button" onClick={() => { void saveProfile(); }} disabled={saving || !fullName.trim()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">{saving ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />} Lưu thay đổi</button></div>
                  </div>
                ) : (
                  <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <div><dt className="font-bold text-slate-400">Loại nhân sự</dt><dd className="mt-1 font-black text-slate-700 dark:text-slate-200">{detail.profile.workerKind === 'company_staff' ? 'Cán bộ công ty' : 'Nhân công nhà thầu'}</dd></div>
                    <div><dt className="font-bold text-slate-400">Điện thoại</dt><dd className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">{detail.profile.phone || '-'}</dd></div>
                    <div><dt className="font-bold text-slate-400">Nhà thầu phụ</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{item.subcontractor?.name || '-'}</dd></div>
                    <div><dt className="font-bold text-slate-400">Tổ đội</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{item.team?.name || '-'}</dd></div>
                    <div><dt className="font-bold text-slate-400">CCCD</dt><dd className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">{item.identityNumberMasked}</dd></div>
                    <div><dt className="font-bold text-slate-400">Chức danh</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{detail.profile.roleName || '-'}</dd></div>
                  </dl>
                )}
              </section>

              <SafetyWorkerCardSection scope={scope} detail={operationalDetail || detail} onChanged={setCommandDetail} />
              <SafetyWorkerHistory membershipId={item.membership.id} assignments={(operationalDetail || detail).assignments} cards={(operationalDetail || detail).cards} />

              {canLoadSensitive && (
                <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <button type="button" onClick={toggleSensitive} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-xs font-black text-slate-800 dark:text-slate-100"><span>{'Giấy tờ & chứng chỉ'}</span><ChevronDown size={15} className={sensitiveOpen ? 'rotate-180' : ''} /></button>
                  {sensitiveOpen && (
                    <div className="border-t border-slate-200 p-4 dark:border-slate-800">
                      {sensitiveState.loading && !sensitiveState.data ? <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Loader2 className="animate-spin" size={14} /> Đang tải dữ liệu được bảo vệ</div> : sensitiveState.data ? (
                        <div className="space-y-4">
                          <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                            <div><dt className="font-bold text-slate-400">Số CCCD</dt><dd className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">{sensitiveState.data.profile.identityNumber || '-'}</dd></div>
                            <div><dt className="font-bold text-slate-400">Ngày cấp</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{sensitiveState.data.profile.identityIssueDate || '-'}</dd></div>
                            <div><dt className="font-bold text-slate-400">Nơi cấp</dt><dd className="mt-1 font-bold text-slate-700 dark:text-slate-200">{sensitiveState.data.profile.identityIssuePlace || '-'}</dd></div>
                          </dl>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {(['identity_front', 'identity_back', 'health_check', 'insurance'] as SafetyWorkerDocumentType[]).map(documentType => {
                              const document = sensitiveState.data?.documents.find(entry => entry.documentType === documentType);
                              return <div key={documentType} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><div className="text-xs font-black text-slate-700 dark:text-slate-200">{documentLabels[documentType]}</div><div className="mt-1 text-[11px] font-medium text-slate-500">{document?.status || 'missing'}{document?.expiryDate ? ` | Hết hạn ${document.expiryDate}` : ''}</div><div className="mt-2 flex flex-wrap gap-2">{document?.attachments.map((attachment, index) => <a key={`${attachment.url}-${index}`} href={attachment.previewUrl || attachment.url} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-bold text-blue-700 dark:border-slate-700 dark:text-blue-300">Xem file</a>)}{detail.capabilities.canManageWorker && <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-black text-slate-600 dark:border-slate-700 dark:text-slate-300"><FileUp size={12} /> Tải file<input type="file" className="sr-only" disabled={saving} onChange={event => { const file = event.target.files?.[0]; if (file) void replaceDocument(documentType, file); }} /></label>}</div></div>;
                            })}
                          </div>
                          <div><h4 className="text-xs font-black text-slate-700 dark:text-slate-200">Chứng chỉ</h4>{sensitiveState.data.certificates.length === 0 ? <p className="mt-2 text-xs font-medium text-slate-500">Chưa có chứng chỉ.</p> : <div className="mt-2 space-y-2">{sensitiveState.data.certificates.map(certificate => <div key={certificate.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700"><span className="font-black text-slate-700 dark:text-slate-200">{certificate.certificateNo || 'Chứng chỉ'}</span><span className="ml-2 font-bold text-slate-500">{certificate.computedStatus}</span></div>)}</div>}</div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t border-slate-200 px-5 py-4 dark:border-slate-800"><button type="button" onClick={onClose} className="min-h-10 rounded-lg bg-slate-900 px-4 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900">Đóng</button></footer>
      </div>
    </div>
  );
};

export default SafetyPassportWorkerDetailModal;
