import React, { useState } from 'react';
import { ClipboardCheck, Loader2, Save } from 'lucide-react';
import type {
  SafetyAssignmentReadinessPatch,
  SafetyProjectAssignment,
  SafetyWorkerDetailPayload,
} from '../../../../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../../../../lib/safetyWorkforceApi';

interface Props {
  scope: SafetyWorkforceRequestScope;
  assignment: SafetyProjectAssignment | null;
  canManage: boolean;
  onChanged: (detail: SafetyWorkerDetailPayload) => void;
}

const selectClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-orange-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const editablePatch = (assignment: SafetyProjectAssignment): SafetyAssignmentReadinessPatch => ({
  siteTrainingStatus: assignment.siteTrainingStatus,
  commitmentStatus: assignment.commitmentStatus,
  ppeStatus: assignment.ppeStatus,
  toolboxStatus: assignment.toolboxStatus,
});

export const SafetyWorkerSiteReadinessSection: React.FC<Props> = ({ scope, assignment, canManage, onChanged }) => {
  const [patch, setPatch] = useState<SafetyAssignmentReadinessPatch | null>(assignment ? editablePatch(assignment) : null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!assignment || assignment.assignmentStatus !== 'active') return null;
  const values = patch || editablePatch(assignment);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      const detail = await safetyWorkforceApi.updateAssignmentReadiness(scope, assignment.id, values);
      onChanged(detail);
      setMessage('Đã cập nhật yêu cầu an toàn tại công trường.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không lưu được yêu cầu an toàn công trường.');
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof SafetyAssignmentReadinessPatch>(key: K, value: SafetyAssignmentReadinessPatch[K]): void => setPatch(current => ({ ...(current || editablePatch(assignment)), [key]: value }));

  return (
    <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-center gap-2"><ClipboardCheck className="text-blue-600" size={15} /><h4 className="text-xs font-black text-slate-700 dark:text-slate-200">Yêu cầu an toàn công trường</h4></div>
      <p className="mt-1 text-[11px] font-medium text-slate-500">Các trạng thái này áp dụng riêng cho lần phân công hiện tại, không đi theo nhân công sang công trường khác.</p>
      {message && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] font-bold text-emerald-800">{message}</div>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label><span className="mb-1 block text-[11px] font-black text-slate-500">Huấn luyện tại công trường</span><select className={selectClass} value={values.siteTrainingStatus} disabled={!canManage || saving} onChange={event => set('siteTrainingStatus', event.target.value as SafetyAssignmentReadinessPatch['siteTrainingStatus'])}><option value="pending">Chưa hoàn thành</option><option value="completed">Đã huấn luyện tại công trường</option><option value="expired">Đã hết hạn</option></select></label>
        <label><span className="mb-1 block text-[11px] font-black text-slate-500">Cam kết an toàn</span><select className={selectClass} value={values.commitmentStatus} disabled={!canManage || saving} onChange={event => set('commitmentStatus', event.target.value as SafetyAssignmentReadinessPatch['commitmentStatus'])}><option value="pending">Chưa ký</option><option value="signed">Đã ký</option></select></label>
        <label><span className="mb-1 block text-[11px] font-black text-slate-500">Trang bị bảo hộ</span><select className={selectClass} value={values.ppeStatus} disabled={!canManage || saving} onChange={event => set('ppeStatus', event.target.value as SafetyAssignmentReadinessPatch['ppeStatus'])}><option value="missing">Chưa đủ</option><option value="partial">Đã cấp một phần</option><option value="complete">Đã cấp đủ</option></select></label>
        <label><span className="mb-1 block text-[11px] font-black text-slate-500">Toolbox talk</span><select className={selectClass} value={values.toolboxStatus} disabled={!canManage || saving} onChange={event => set('toolboxStatus', event.target.value as SafetyAssignmentReadinessPatch['toolboxStatus'])}><option value="pending">Chưa hoàn thành</option><option value="completed">Đã hoàn thành</option><option value="expired">Đã hết hạn</option></select></label>
      </div>
      {canManage && <button type="button" onClick={() => { void save(); }} disabled={saving} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />} Lưu yêu cầu công trường</button>}
    </section>
  );
};

export default SafetyWorkerSiteReadinessSection;
