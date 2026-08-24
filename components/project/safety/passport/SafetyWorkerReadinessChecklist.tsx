import React from 'react';
import { CircleCheck, CircleX, ShieldAlert } from 'lucide-react';
import type {
  SafetyCertificateType,
  SafetyProjectAssignment,
  SafetyWorkerDetailPayload,
} from '../../../../types';

interface Props {
  detail: SafetyWorkerDetailPayload;
  certificateTypes: SafetyCertificateType[];
  certificateTypesLoaded?: boolean;
}

interface CheckItem {
  label: string;
  complete: boolean;
}

const appliesToRole = (certificateType: SafetyCertificateType, roleName?: string | null): boolean => (
  certificateType.appliesToRoles.length === 0
  || Boolean(roleName && certificateType.appliesToRoles.includes(roleName))
);

const certificateIsUsable = (detail: SafetyWorkerDetailPayload, certificateTypeId: string): boolean => detail.certificates.some(certificate => (
  certificate.certificateTypeId === certificateTypeId
  && ['approved', 'submitted'].includes(certificate.status)
  && !['rejected', 'revoked', 'expired'].includes(certificate.computedStatus)
));

const activeAssignment = (detail: SafetyWorkerDetailPayload): SafetyProjectAssignment | null => (
  detail.assignments.find(assignment => assignment.assignmentStatus === 'active')
  || detail.rosterItem.activeAssignment
);

export const safetyCardReadinessItems = (
  detail: SafetyWorkerDetailPayload,
  certificateTypes: SafetyCertificateType[],
  certificateTypesLoaded = true,
): CheckItem[] => {
  const assignment = activeAssignment(detail);
  const requiredTypes = certificateTypes.filter(certificateType => (
    certificateType.isActive && certificateType.isRequiredDefault && appliesToRole(certificateType, detail.profile.roleName)
  ));
  return [
    { label: 'Hồ sơ cá nhân', complete: detail.rosterItem.profileStatus === 'valid' },
    { label: 'Giấy khám sức khỏe', complete: detail.rosterItem.healthStatus === 'valid' },
    { label: 'Bảo hiểm', complete: detail.rosterItem.insuranceStatus === 'valid' },
    { label: 'Chứng chỉ bắt buộc', complete: certificateTypesLoaded && requiredTypes.every(certificateType => certificateIsUsable(detail, certificateType.id)) },
    { label: 'Huấn luyện tại công trường', complete: assignment?.siteTrainingStatus === 'completed' },
    { label: 'Cam kết an toàn', complete: assignment?.commitmentStatus === 'signed' },
    { label: 'Trang bị bảo hộ', complete: assignment?.ppeStatus === 'complete' },
    { label: 'Toolbox talk', complete: assignment?.toolboxStatus === 'completed' },
  ];
};

export const SafetyWorkerReadinessChecklist: React.FC<Props> = ({ detail, certificateTypes, certificateTypesLoaded = true }) => {
  const items = safetyCardReadinessItems(detail, certificateTypes, certificateTypesLoaded);
  const ready = items.every(item => item.complete);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2"><ShieldAlert className={ready ? 'text-emerald-600' : 'text-amber-500'} size={16} /><h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Điều kiện cấp thẻ</h3></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map(item => <div key={item.label} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">{item.complete ? <CircleCheck className="shrink-0 text-emerald-600" size={15} /> : <CircleX className="shrink-0 text-amber-500" size={15} />}{item.label}</div>)}
      </div>
    </section>
  );
};

export default SafetyWorkerReadinessChecklist;
