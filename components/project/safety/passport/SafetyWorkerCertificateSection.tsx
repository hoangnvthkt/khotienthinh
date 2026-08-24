import React, { useEffect, useMemo, useState } from 'react';
import { FileUp, Loader2, Save, ShieldCheck } from 'lucide-react';
import type {
  SafetyCertificateType,
  SafetyWorkerCertificate,
  SafetyWorkerDetailPayload,
} from '../../../../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../../../../lib/safetyWorkforceApi';

interface Props {
  scope: SafetyWorkforceRequestScope;
  membershipId: string;
  workerId: string;
  certificates: SafetyWorkerCertificate[];
  certificateTypes: SafetyCertificateType[];
  canManage: boolean;
  onChanged: (detail: SafetyWorkerDetailPayload) => void;
}

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-orange-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const statusLabel = (certificate: SafetyWorkerCertificate): string => {
  if (certificate.computedStatus === 'valid') return 'Còn hiệu lực';
  if (certificate.computedStatus === 'expiring_soon') return 'Sắp hết hạn';
  if (certificate.computedStatus === 'expired') return 'Đã hết hạn';
  if (certificate.computedStatus === 'rejected') return 'Không hợp lệ';
  return 'Đã thu hồi';
};

export const SafetyWorkerCertificateSection: React.FC<Props> = ({
  scope,
  membershipId,
  workerId,
  certificates,
  certificateTypes,
  canManage,
  onChanged,
}) => {
  const activeTypes = useMemo(
    () => certificateTypes.filter(certificateType => certificateType.isActive),
    [certificateTypes],
  );
  const [certificateTypeId, setCertificateTypeId] = useState(activeTypes[0]?.id || '');
  const [certificateNo, setCertificateNo] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeTypes.some(certificateType => certificateType.id === certificateTypeId)) {
      setCertificateTypeId(activeTypes[0]?.id || '');
    }
  }, [activeTypes, certificateTypeId]);

  const save = async (): Promise<void> => {
    if (!certificateTypeId || !file) {
      setMessage('Chọn loại chứng chỉ và tải tệp chứng chỉ trước khi lưu.');
      return;
    }
    if (issueDate && expiryDate && expiryDate < issueDate) {
      setMessage('Ngày hết hạn không được trước ngày cấp.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const attachment = await safetyWorkforceApi.uploadWorkerAttachment(workerId, 'certificate', file);
      const detail = await safetyWorkforceApi.saveCertificate(scope, membershipId, {
        certificateTypeId,
        certificateNo: certificateNo.trim() || null,
        issueDate: issueDate || null,
        expiryDate: expiryDate || null,
        attachments: [attachment],
      });
      onChanged(detail);
      setCertificateNo('');
      setIssueDate('');
      setExpiryDate('');
      setFile(null);
      setMessage('Đã lưu chứng chỉ và xác nhận ngay bởi người quản lý an toàn.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không lưu được chứng chỉ.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-emerald-600" size={15} />
        <h4 className="text-xs font-black text-slate-700 dark:text-slate-200">Chứng chỉ an toàn</h4>
      </div>
      <p className="mt-1 text-[11px] font-medium text-slate-500">Tệp được tải lên bởi người quản lý an toàn sẽ được xác nhận ngay, không cần bước duyệt riêng.</p>
      {message && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] font-bold text-amber-800">{message}</div>}

      {certificates.length === 0 ? <p className="mt-3 text-xs font-medium text-slate-500">Chưa có chứng chỉ.</p> : (
        <div className="mt-3 space-y-2">
          {certificates.map(certificate => (
            <div key={certificate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950">
              <div><span className="font-black text-slate-700 dark:text-slate-200">{certificate.certificateType?.name || certificate.certificateNo || 'Chứng chỉ'}</span>{certificate.certificateNo && <span className="ml-2 font-mono font-bold text-slate-500">{certificate.certificateNo}</span>}</div>
              <span className="font-bold text-slate-500">{statusLabel(certificate)}{certificate.expiryDate ? ` · Hết hạn ${certificate.expiryDate}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mt-3 grid gap-3 rounded-md border border-dashed border-slate-300 p-3 sm:grid-cols-2 dark:border-slate-600">
          <label><span className="mb-1 block text-[11px] font-black text-slate-500">Loại chứng chỉ</span><select className={inputClass} value={certificateTypeId} disabled={saving || activeTypes.length === 0} onChange={event => setCertificateTypeId(event.target.value)}>{activeTypes.length === 0 ? <option value="">Chưa có loại chứng chỉ</option> : activeTypes.map(certificateType => <option key={certificateType.id} value={certificateType.id}>{certificateType.name}</option>)}</select></label>
          <label><span className="mb-1 block text-[11px] font-black text-slate-500">Số chứng chỉ</span><input className={inputClass} value={certificateNo} disabled={saving} onChange={event => setCertificateNo(event.target.value)} /></label>
          <label><span className="mb-1 block text-[11px] font-black text-slate-500">Ngày cấp</span><input type="date" className={inputClass} value={issueDate} disabled={saving} onChange={event => setIssueDate(event.target.value)} /></label>
          <label><span className="mb-1 block text-[11px] font-black text-slate-500">Ngày hết hạn</span><input type="date" className={inputClass} value={expiryDate} disabled={saving} onChange={event => setExpiryDate(event.target.value)} /></label>
          <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 dark:border-slate-700 dark:text-slate-200"><FileUp size={14} /> {file ? file.name : 'Tải chứng chỉ'}<input type="file" className="sr-only" disabled={saving} onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <button type="button" onClick={() => { void save(); }} disabled={saving || activeTypes.length === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Lưu chứng chỉ</button>
        </div>
      )}
    </section>
  );
};

export default SafetyWorkerCertificateSection;
