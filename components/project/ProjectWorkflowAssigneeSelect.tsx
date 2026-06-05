import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Loader2, UserRound } from 'lucide-react';
import { Employee, OrgUnit, ProjectStaff, ProjectWorkflowSubject, User, WorkflowNode } from '../../types';
import { projectWorkflowService } from '../../lib/projectWorkflowService';

interface Props {
  subject: ProjectWorkflowSubject;
  node?: WorkflowNode | null;
  users: User[];
  employees?: Employee[];
  orgUnits?: OrgUnit[];
  value?: string[] | string | null;
  creatorUserId?: string | null;
  label?: string;
  selectionMode?: 'single' | 'multiple';
  disabled?: boolean;
  onChange: (userIds: string[]) => void;
}

const ProjectWorkflowAssigneeSelect: React.FC<Props> = ({
  subject,
  node,
  users,
  employees = [],
  orgUnits = [],
  value,
  creatorUserId,
  label = 'Người xử lý',
  selectionMode = 'multiple',
  disabled = false,
  onChange,
}) => {
  const [candidates, setCandidates] = useState<ProjectStaff[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const selectedUserIds = useMemo(
    () => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [],
    [value],
  );

  const fixedUserId = node?.config?.assigneeUserId || null;
  const creatorModeUserId = node?.config?.assignmentMode === 'creator' ? creatorUserId || null : null;
  const lockedUserId = fixedUserId || creatorModeUserId;
  const activeEmployees = useMemo(
    () => employees.filter(employee => employee.status === 'Đang làm việc' && employee.userId),
    [employees],
  );
  const configuredDepartmentIds = useMemo(
    () => new Set(
      (node?.config?.assignmentTargets || [])
        .filter(target => target.type === 'department' && target.orgUnitId)
        .map(target => target.orgUnitId!),
    ),
    [node?.config?.assignmentTargets],
  );
  const candidateUserIds = useMemo(
    () => new Set(candidates.map(candidate => candidate.userId)),
    [candidates],
  );
  const departments = useMemo(
    () => orgUnits
      .filter(unit => unit.type === 'department')
      .filter(unit =>
        configuredDepartmentIds.has(unit.id)
        || activeEmployees.some(employee =>
          candidateUserIds.has(employee.userId!)
          && (employee.departmentId === unit.id || employee.orgUnitId === unit.id)
        )
      ),
    [activeEmployees, candidateUserIds, configuredDepartmentIds, orgUnits],
  );

  const setDistinctSelection = (ids: string[]) => {
    onChange(Array.from(new Set(ids.filter(Boolean))));
  };

  useEffect(() => {
    if (lockedUserId) {
      onChange([lockedUserId]);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    projectWorkflowService
      .getAssigneeCandidates(subject, node)
      .then(rows => {
        if (!alive) return;
        const role = node?.config?.assigneeRole || null;
        const filtered = role ? rows.filter(staff => userById.get(staff.userId)?.role === role) : rows;
        setCandidates(filtered);
      })
      .catch(err => {
        if (!alive) return;
        setError(err?.message || 'Không tải được danh sách người xử lý.');
        setCandidates([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [creatorUserId, lockedUserId, node?.id, node?.config?.assigneeRole, onChange, selectedUserIds.length, subject.id, userById]);

  useEffect(() => {
    if (lockedUserId) return;
    const configuredTargets = node?.config?.assignmentTargets || [];
    const configuredUserIds = projectWorkflowService.resolveAssignmentTargetUserIds({
      selectedUserIds: [],
      targets: configuredTargets,
      employees,
      orgUnits,
      creatorUserId,
    });
    if (configuredUserIds.length > 0) {
      setDistinctSelection([...selectedUserIds, ...configuredUserIds]);
    }
  }, [creatorUserId, employees, lockedUserId, node?.config?.assignmentTargets, orgUnits]);

  const toggleUser = (userId: string) => {
    if (disabled || loading) return;
    const next = selectedUserIds.includes(userId)
      ? selectedUserIds.filter(id => id !== userId)
      : selectionMode === 'single'
        ? [userId]
        : [...selectedUserIds, userId];
    setDistinctSelection(next);
  };

  const toggleDepartment = (departmentId: string) => {
    if (disabled || loading) return;
    const exists = selectedDepartmentIds.includes(departmentId);
    const nextDepartments = exists
      ? selectedDepartmentIds.filter(id => id !== departmentId)
      : [...selectedDepartmentIds, departmentId];
    setSelectedDepartmentIds(nextDepartments);

    const departmentUserIds = activeEmployees
      .filter(employee => employee.departmentId === departmentId || employee.orgUnitId === departmentId)
      .map(employee => employee.userId!)
      .filter(userId => configuredDepartmentIds.has(departmentId) || candidateUserIds.has(userId));

    const nextUserIds = exists
      ? selectedUserIds.filter(id => !departmentUserIds.includes(id))
      : [...selectedUserIds, ...departmentUserIds];
    setDistinctSelection(nextUserIds);
  };

  if (lockedUserId) {
    const lockedUser = userById.get(lockedUserId);
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <div className="mb-1 text-[10px] font-black uppercase text-slate-400">{label}</div>
        <div className="flex items-center gap-2 font-black text-slate-700">
          <UserRound size={14} className="text-slate-400" />
          {lockedUser?.name || lockedUserId}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-[10px] font-black uppercase text-slate-400">{label}</label>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-600">
          {selectedUserIds.length} người
        </span>
      </div>

      {selectionMode === 'multiple' && departments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {departments.map(department => {
            const checked = selectedDepartmentIds.includes(department.id);
            return (
              <button
                key={department.id}
                type="button"
                disabled={disabled || loading}
                onClick={() => toggleDepartment(department.id)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black disabled:opacity-50 ${checked ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                <Building2 size={11} /> {department.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-[10px] font-black uppercase text-slate-400">
          <span>Danh sách ứng viên</span>
          {loading && <Loader2 size={13} className="animate-spin text-slate-300" />}
        </div>
        <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto">
          {candidates.map(staff => {
            const checked = selectedUserIds.includes(staff.userId);
            return (
              <button
                key={staff.id}
                type="button"
                disabled={disabled || loading}
                onClick={() => toggleUser(staff.userId)}
                className={`grid w-full grid-cols-[2rem_1fr] items-center gap-2 px-3 py-2 text-left text-xs disabled:opacity-50 ${checked ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-200 text-transparent'}`}>
                  <CheckCircle2 size={13} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-black text-slate-700">{staff.userName || userById.get(staff.userId)?.name || staff.userId}</span>
                  <span className="block truncate text-[10px] font-bold text-slate-400">{staff.positionName || staff.userId}</span>
                </span>
              </button>
            );
          })}
          {loading && <div className="px-3 py-4 text-center text-xs font-bold text-slate-400">Đang tải người xử lý...</div>}
        </div>
      </div>

      {!loading && candidates.length === 0 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-[10px] font-bold text-amber-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Chưa có nhân sự phù hợp với cấu hình bước này.
        </div>
      )}
      {error && <div className="mt-2 text-[10px] font-bold text-red-600">{error}</div>}
    </div>
  );
};

export default ProjectWorkflowAssigneeSelect;
