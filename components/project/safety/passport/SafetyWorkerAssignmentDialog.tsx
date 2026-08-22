import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Loader2, Search, UserPlus, X } from 'lucide-react';
import type {
  SafetySiteWorkforceOptions,
  SafetyWorkerDetailPayload,
  SafetyWorkerLookupResult,
  SafetyWorkerRosterItem,
} from '../../../../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../../../../lib/safetyWorkforceApi';
import { parseSafetyWorkforceError } from '../../../../lib/safetyWorkforceModel';

type DialogMode = 'assign' | 'end';

interface Props {
  scope: SafetyWorkforceRequestScope;
  mode: DialogMode;
  item?: SafetyWorkerRosterItem | null;
  onClose: () => void;
  onCompleted: (detail: SafetyWorkerDetailPayload) => void;
}

type EndErrors = Partial<Record<'endedAt' | 'reason', string>>;

export const selectableAssignmentCandidates = (
  items: SafetyWorkerRosterItem[],
): SafetyWorkerRosterItem[] => items.filter(item => (
  (item.membership.status === 'candidate' || item.membership.status === 'inactive')
  && item.activeAssignment?.assignmentStatus !== 'active'
));

export const validateSafetyAssignmentEnd = (
  startedAt: string,
  endedAt: string,
  reason: string,
): EndErrors => {
  const errors: EndErrors = {};
  if (!reason.trim()) errors.reason = 'Vui lòng nhập lý do kết thúc';
  const startTime = new Date(startedAt).getTime();
  const endTime = new Date(endedAt).getTime();
  if (!endedAt || Number.isNaN(endTime) || (!Number.isNaN(startTime) && endTime < startTime)) {
    errors.endedAt = 'Thời điểm kết thúc phải sau thời điểm bắt đầu';
  }
  return errors;
};

export const canOfferSafetyTransfer = (
  lookup: Pick<SafetyWorkerLookupResult, 'canTransfer' | 'activeAssignmentId'> | null,
): boolean => Boolean(lookup?.canTransfer && lookup.activeAssignmentId);

const localDateTimeValue = (value = new Date()): string => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const toIso = (value: string): string => new Date(value).toISOString();

const errorCopy = (error: unknown): string => {
  const parsed = parseSafetyWorkforceError(error);
  if (parsed.code === 'SAFETY_WORKER_ACTIVE_ELSEWHERE') {
    return 'Nhân công đang làm tại công trường khác. Hãy kết thúc công việc cũ hoặc điều chuyển nếu anh có quyền ở cả hai công trường.';
  }
  if (parsed.code === 'SAFETY_TRANSFER_PERMISSION_REQUIRED') {
    return 'Cần quyền quản lý ở cả công trường nguồn và công trường đích để điều chuyển.';
  }
  if (parsed.code === 'SAFETY_CONTRACTOR_SCOPE_MISMATCH') return 'Nhà thầu phụ không thuộc công trường đích.';
  if (parsed.code === 'SAFETY_TEAM_SCOPE_MISMATCH') return 'Tổ đội không thuộc nhà thầu phụ hoặc công trường đích.';
  return parsed.message;
};

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-orange-400 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const Field: React.FC<{
  label: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, error, children }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-black text-slate-600 dark:text-slate-300">{label}</span>
    {children}
    {error && <span className="mt-1 block text-[11px] font-bold text-red-600">{error}</span>}
  </label>
);

export const SafetyWorkerAssignmentDialog: React.FC<Props> = ({
  scope,
  mode,
  item,
  onClose,
  onCompleted,
}) => {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<SafetyWorkerRosterItem[]>([]);
  const [selected, setSelected] = useState<SafetyWorkerRosterItem | null>(null);
  const [options, setOptions] = useState<SafetySiteWorkforceOptions>({ subcontractors: [], teams: [] });
  const [loading, setLoading] = useState(mode === 'assign');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lookupType, setLookupType] = useState<'worker_code' | 'identity'>('worker_code');
  const [lookupValue, setLookupValue] = useState('');
  const [lookup, setLookup] = useState<SafetyWorkerLookupResult | null>(null);
  const [lookupChecked, setLookupChecked] = useState(false);
  const [startedAt, setStartedAt] = useState(localDateTimeValue());
  const [endedAt, setEndedAt] = useState(localDateTimeValue());
  const [reason, setReason] = useState('');
  const [roleName, setRoleName] = useState('');
  const [workType, setWorkType] = useState('');
  const [subcontractorId, setSubcontractorId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [endErrors, setEndErrors] = useState<EndErrors>({});

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (mode !== 'assign') return;
    let active = true;
    setLoading(true);
    setMessage(null);
    Promise.all([
      safetyWorkforceApi.listRoster(scope, { membershipStatus: 'candidate', search: search || undefined, limit: 50 }),
      safetyWorkforceApi.listRoster(scope, { membershipStatus: 'inactive', search: search || undefined, limit: 50 }),
      safetyWorkforceApi.listOptions(scope),
    ]).then(([candidatePage, inactivePage, nextOptions]) => {
      if (!active) return;
      setCandidates(selectableAssignmentCandidates([...candidatePage.items, ...inactivePage.items]));
      setOptions(nextOptions);
    }).catch(error => {
      if (active) setMessage(errorCopy(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [mode, scope.constructionSiteId, scope.projectId, scope.userId, search]);

  const workerKind = selected?.worker.workerKind || lookup?.workerKind || null;
  const teams = useMemo(
    () => options.teams.filter(team => team.subcontractorId === subcontractorId),
    [options.teams, subcontractorId],
  );

  const chooseCandidate = (candidate: SafetyWorkerRosterItem): void => {
    setSelected(candidate);
    setLookup(null);
    setLookupChecked(false);
    setSubcontractorId(candidate.membership.defaultSubcontractorId || candidate.subcontractor?.id || '');
    setTeamId(candidate.membership.defaultTeamId || candidate.team?.id || '');
    setRoleName(candidate.activeAssignment?.roleName || '');
    setMessage(null);
  };

  const findExactWorker = async (): Promise<void> => {
    if (!lookupValue.trim()) return;
    setLoading(true);
    setMessage(null);
    setSelected(null);
    try {
      const result = await safetyWorkforceApi.lookupExact(scope, lookupType === 'worker_code'
        ? { workerCode: lookupValue }
        : { identityType: 'cccd', identityNumber: lookupValue });
      setLookup(result);
      setLookupChecked(true);
      if (result?.targetMembershipId) {
        const matching = candidates.find(candidate => candidate.membership.id === result.targetMembershipId);
        if (matching) chooseCandidate(matching);
      }
    } catch (error) {
      setMessage(errorCopy(error));
    } finally {
      setLoading(false);
    }
  };

  const validateTarget = (): boolean => {
    if (workerKind === 'contractor_worker' && !subcontractorId) {
      setMessage('Vui lòng chọn nhà thầu phụ tại công trường đích.');
      return false;
    }
    return true;
  };

  const assignWorker = async (): Promise<void> => {
    if (!validateTarget()) return;
    setSaving(true);
    setMessage(null);
    try {
      let membershipId = selected?.membership.id || lookup?.targetMembershipId || null;
      if (!membershipId && lookup && !lookup.activeAssignmentId) {
        const membership = await safetyWorkforceApi.createProfile(scope, {
          workerKind: lookup.workerKind,
          profile: {
            workerCode: lookup.workerCode,
            fullName: lookup.fullName,
            identityType: 'cccd',
          },
          subcontractorId: lookup.workerKind === 'contractor_worker' ? subcontractorId : null,
          teamId: lookup.workerKind === 'contractor_worker' ? teamId || null : null,
        });
        membershipId = membership.rosterItem.membership.id;
      }
      if (!membershipId) {
        setMessage(lookup?.activeAssignmentId
          ? 'Nhân công đang làm tại công trường khác. Hãy kết thúc hoặc điều chuyển công việc hiện tại.'
          : 'Vui lòng chọn hoặc tra cứu chính xác một hồ sơ nhân công.');
        return;
      }
      const detail = await safetyWorkforceApi.assign(scope, {
        membershipId,
        startedAt: toIso(startedAt),
        subcontractorId: workerKind === 'contractor_worker' ? subcontractorId : null,
        teamId: workerKind === 'contractor_worker' ? teamId || null : null,
        roleName: roleName.trim() || null,
        workType: workType.trim() || null,
      });
      onCompleted(detail);
      onClose();
    } catch (error) {
      setMessage(errorCopy(error));
    } finally {
      setSaving(false);
    }
  };

  const transferWorker = async (): Promise<void> => {
    if (!lookup || !canOfferSafetyTransfer(lookup) || !lookup.activeProjectId || !lookup.activeConstructionSiteId || !validateTarget()) return;
    setSaving(true);
    setMessage(null);
    try {
      const detail = await safetyWorkforceApi.transfer(scope, {
        assignmentId: lookup.activeAssignmentId as string,
        sourceProjectId: lookup.activeProjectId,
        sourceConstructionSiteId: lookup.activeConstructionSiteId,
        targetProjectId: scope.projectId,
        targetConstructionSiteId: scope.constructionSiteId,
        startedAt: toIso(startedAt),
        subcontractorId: lookup.workerKind === 'contractor_worker' ? subcontractorId : null,
        teamId: lookup.workerKind === 'contractor_worker' ? teamId || null : null,
      });
      onCompleted(detail);
      onClose();
    } catch (error) {
      setMessage(errorCopy(error));
    } finally {
      setSaving(false);
    }
  };

  const endAssignment = async (): Promise<void> => {
    const assignment = item?.activeAssignment;
    if (!assignment) return;
    const errors = validateSafetyAssignmentEnd(assignment.startedAt, endedAt, reason);
    setEndErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const detail = await safetyWorkforceApi.endAssignment(scope, assignment.id, toIso(endedAt), reason.trim());
      onCompleted(detail);
      onClose();
    } catch (error) {
      setMessage(errorCopy(error));
    } finally {
      setSaving(false);
    }
  };

  const activeElsewhere = Boolean(lookup?.activeAssignmentId && (
    lookup.activeProjectId !== scope.projectId
    || lookup.activeConstructionSiteId !== scope.constructionSiteId
  ));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-3 py-5" role="dialog" aria-modal="true" aria-labelledby="assignment-dialog-title">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-orange-600">Phân công công trường</div>
            <h2 id="assignment-dialog-title" className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">{mode === 'end' ? 'Kết thúc làm việc' : 'Gán nhân công'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5 dark:bg-slate-950/40">
          {message && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={15} />{message}</div>}

          {mode === 'end' ? (
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-slate-100">{item?.worker.fullName || 'Nhân công'}</div>
                <div className="mt-1 font-mono text-[11px] font-bold text-orange-700">{item?.worker.workerCode}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Thời điểm kết thúc" error={endErrors.endedAt}><input type="datetime-local" className={inputClass} value={endedAt} disabled={saving} onChange={event => setEndedAt(event.target.value)} /></Field>
                <Field label="Lý do" error={endErrors.reason}><input className={inputClass} value={reason} disabled={saving} onChange={event => setReason(event.target.value)} placeholder="Ví dụ: Hoàn thành công việc" /></Field>
              </div>
              <p className="text-[11px] font-medium text-slate-500">Kết thúc phân công sẽ thu hồi thẻ an toàn đang còn hiệu lực tại công trường này.</p>
            </section>
          ) : (
            <>
              <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
                  <select className={inputClass} value={lookupType} disabled={saving} onChange={event => setLookupType(event.target.value as typeof lookupType)}>
                    <option value="worker_code">Mã nhân công</option>
                    <option value="identity">CCCD</option>
                  </select>
                  <input className={inputClass} value={lookupValue} disabled={saving} onChange={event => setLookupValue(event.target.value)} placeholder={lookupType === 'worker_code' ? 'Nhập đúng mã nhân công' : 'Nhập đúng số CCCD'} />
                  <button type="button" onClick={() => { void findExactWorker(); }} disabled={loading || saving || !lookupValue.trim()} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"><Search size={14} /> Tra cứu</button>
                </div>
                {lookupChecked && !lookup && <div className="mt-3 text-xs font-bold text-slate-500">Không tìm thấy hồ sơ gốc. Hãy tạo hồ sơ nhân công trước.</div>}
                {lookup && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                    <div className="font-black">{lookup.fullName} <span className="font-mono">{lookup.workerCode}</span></div>
                    <div className="mt-1 font-mono text-[11px]">{lookup.identityNumberMasked}</div>
                    {activeElsewhere && <div className="mt-2 font-bold">Đang làm tại {lookup.activeSiteName || 'một công trường khác'}.</div>}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Hồ sơ chờ gán tại công trường</h3>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">Chỉ gồm membership chờ gán hoặc đã rời công trường.</p>
                  </div>
                  {loading && <Loader2 className="animate-spin text-slate-400" size={15} />}
                </div>
                <label className="relative block">
                  <span className="sr-only">Tìm hồ sơ chờ gán</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input className={`${inputClass} pl-9`} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Tìm tên, mã hoặc điện thoại" />
                </label>
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                  {candidates.map(candidate => (
                    <button key={candidate.membership.id} type="button" onClick={() => chooseCandidate(candidate)} className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left ${selected?.membership.id === candidate.membership.id ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                      <span className="min-w-0"><span className="block truncate text-xs font-black text-slate-800 dark:text-slate-100">{candidate.worker.fullName}</span><span className="mt-1 block font-mono text-[11px] font-bold text-orange-700">{candidate.worker.workerCode}</span></span>
                      <span className="shrink-0 text-[10px] font-bold text-slate-500">{candidate.membership.status === 'candidate' ? 'Chờ gán' : 'Đã rời'}</span>
                    </button>
                  ))}
                  {!loading && candidates.length === 0 && <div className="py-5 text-center text-xs font-bold text-slate-400">Không có hồ sơ chờ gán phù hợp.</div>}
                </div>
              </section>

              {(selected || lookup) && (
                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Thông tin phân công đích</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Thời điểm bắt đầu"><input type="datetime-local" className={inputClass} value={startedAt} disabled={saving} onChange={event => setStartedAt(event.target.value)} /></Field>
                    <Field label="Chức danh"><input className={inputClass} value={roleName} disabled={saving} onChange={event => setRoleName(event.target.value)} /></Field>
                    <Field label="Loại công việc"><input className={inputClass} value={workType} disabled={saving} onChange={event => setWorkType(event.target.value)} /></Field>
                    {workerKind === 'contractor_worker' && <Field label="Nhà thầu phụ"><select className={inputClass} value={subcontractorId} disabled={saving} onChange={event => { setSubcontractorId(event.target.value); setTeamId(''); }}><option value="">Chọn nhà thầu phụ</option>{options.subcontractors.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>}
                    {workerKind === 'contractor_worker' && <Field label="Tổ đội"><select className={inputClass} value={teamId} disabled={saving || !subcontractorId} onChange={event => setTeamId(event.target.value)}><option value="">Không chọn tổ đội</option>{teams.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-10 rounded-lg px-4 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Đóng</button>
          {mode === 'end' ? (
            <button type="button" onClick={() => { void endAssignment(); }} disabled={saving || !item?.activeAssignment} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-xs font-black text-white disabled:opacity-50">{saving && <Loader2 className="animate-spin" size={14} />} Kết thúc làm việc</button>
          ) : canOfferSafetyTransfer(lookup) && activeElsewhere ? (
            <button type="button" onClick={() => { void transferWorker(); }} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-orange-600 px-4 text-xs font-black text-white disabled:opacity-50"><ArrowRightLeft size={14} /> Điều chuyển về công trường này</button>
          ) : (
            <button type="button" onClick={() => { void assignWorker(); }} disabled={saving || (!selected && !lookup) || activeElsewhere} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-black text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"><UserPlus size={14} /> Gán nhân công</button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default SafetyWorkerAssignmentDialog;
