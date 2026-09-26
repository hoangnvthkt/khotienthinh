import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Clock, Eye, Info, Loader2, PackageCheck, Plus, RefreshCw, ShieldCheck, Trash2,
} from 'lucide-react';
import { Employee, OrgUnit, ProjectWorkflowNodeConfig, User, WorkflowNode, WorkflowTemplate } from '../../types';
import SearchableCheckboxSelect from '../workflow/SearchableCheckboxSelect';
import {
  appendStep,
  buildAssignmentTargets,
  buildLinearTemplateStructure,
  createStep,
  moveStep,
  orderSteps,
  removeStep,
  updateStep,
  updateStepConfig,
} from '../../lib/workflowStepDraft';
import {
  STEP_ASSIGNEE_KIND_LABELS,
  StepAssigneeKind,
  StepRecipientCheck,
  checkStepRecipients,
  getPreservedTargets,
  getStepAssigneeKind,
  validateStepDraft,
  withStepAssigneeKind,
} from '../../lib/projectWorkflowStepEditor';
import {
  buildUserNameById,
  describeStepAssignment,
  getTargetDepartmentIds,
  getTargetUserIds,
  isConcurrentApprovalStep,
} from '../../lib/workflowStepSummary';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import { projectPermissionRoomService } from '../../lib/projectPermissionRoomService';
import type { useConfirm } from '../../context/ConfirmContext';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  template: WorkflowTemplate;
  /** Live nodes of the project-owned template, START/END included. */
  initialNodes: WorkflowNode[];
  users: User[];
  orgUnits: OrgUnit[];
  employees: Employee[];
  /** The panel's confirm, so Escape in the confirm modal does not close the panel. */
  confirm: ReturnType<typeof useConfirm>;
  onCancel: () => void;
  onSaved: (nodes: WorkflowNode[]) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

type RecipientState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; eligibleUserIds: Set<string> };

const ASSIGNEE_KINDS: StepAssigneeKind[] = ['transition', 'fixed', 'pool', 'creator'];

const generateId = () => crypto.randomUUID();

/** Key-order independent snapshot, so toggling a field back does not count as a change. */
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort()
      .filter(key => record[key] !== undefined)
      .map(key => [key, normalize(record[key])]));
  }
  return value;
};

const snapshot = (nodes: WorkflowNode[]) =>
  JSON.stringify(normalize(orderSteps(nodes).map(step => ({ id: step.id, label: step.label, config: step.config || {} }))));

const replaceConfig = (nodes: WorkflowNode[], stepId: string, config: ProjectWorkflowNodeConfig) =>
  nodes.map(node => (node.id === stepId ? { ...node, config } : node));

const describeSaveError = (err: any): string => {
  if (err?.code === '42501') return 'Bạn không còn quyền Sửa + Xem trong room Đề xuất vật tư của dự án.';
  return err?.message || 'Không lưu được các bước duyệt.';
};

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
const fieldLabelClass = 'mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-400';

const ProjectWorkflowStepEditor: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  template,
  initialNodes,
  users,
  orgUnits,
  employees,
  confirm,
  onCancel,
  onSaved,
  onDirtyChange,
}) => {
  const [draft, setDraft] = useState<WorkflowNode[]>(initialNodes);
  const [baseline] = useState(() => snapshot(initialNodes));
  const [expandedId, setExpandedId] = useState<string | null>(() => orderSteps(initialNodes)[0]?.id || null);
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientState>({ status: 'loading' });
  const [recipientReloadKey, setRecipientReloadKey] = useState(0);

  const steps = useMemo(() => orderSteps(draft), [draft]);
  const dirty = useMemo(() => snapshot(draft) !== baseline, [baseline, draft]);
  const issues = useMemo(() => validateStepDraft(draft), [draft]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // The server lets a step go only to people with room `approve` + `view`
  // (app_private.assert_material_request_room_recipients).
  useEffect(() => {
    let cancelled = false;
    setRecipients({ status: 'loading' });
    const siteId = constructionSiteId || null;
    Promise.all([
      projectPermissionRoomService.listRecipients(projectId, siteId, 'material_request', 'approve'),
      projectPermissionRoomService.listRecipients(projectId, siteId, 'material_request', 'view'),
    ])
      .then(([approvers, viewers]) => {
        if (cancelled) return;
        const viewerIds = new Set(viewers.map(staff => staff.userId).filter(Boolean));
        const eligibleUserIds = new Set(approvers.map(staff => staff.userId).filter(id => id && viewerIds.has(id)) as string[]);
        setRecipients({ status: 'ready', eligibleUserIds });
      })
      .catch(err => {
        if (!cancelled) setRecipients({ status: 'error', message: err?.message || 'Không đọc được danh sách quyền trong room.' });
      });
    return () => { cancelled = true; };
  }, [constructionSiteId, projectId, recipientReloadKey]);

  const eligibleUserIds = recipients.status === 'ready' ? recipients.eligibleUserIds : null;

  const activeUsers = useMemo(() => users
    .filter(user => user.isActive !== false)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi')), [users]);
  const lookups = useMemo(() => ({ userNameById: buildUserNameById(users), orgUnits }), [orgUnits, users]);
  const userOptions = useMemo(() => activeUsers.map(user => ({
    id: user.id,
    label: user.name || user.username || user.email,
    sublabel: eligibleUserIds && !eligibleUserIds.has(user.id) ? 'Chưa có quyền Duyệt + Xem trong room' : user.email,
  })), [activeUsers, eligibleUserIds]);
  const departmentOptions = useMemo(() => orgUnits.map(unit => ({ id: unit.id, label: unit.name })), [orgUnits]);

  const recipientChecks = useMemo(() => new Map<string, StepRecipientCheck>(steps.map(step => [
    step.id,
    checkStepRecipients(step.config || {}, eligibleUserIds, employees),
  ])), [eligibleUserIds, employees, steps]);

  const nameOf = useCallback((userId: string) => lookups.userNameById.get(userId) || 'Người dùng không xác định', [lookups]);

  const setConfig = (stepId: string, config: ProjectWorkflowNodeConfig) => setDraft(nodes => replaceConfig(nodes, stepId, config));

  const addStep = () => {
    const step = createStep({ id: generateId(), templateId: template.id, existingSteps: steps.length, label: `Bước duyệt ${steps.length + 1}` });
    setDraft(nodes => appendStep(nodes, step));
    setExpandedId(step.id);
  };

  const deleteStep = async (step: WorkflowNode) => {
    const persisted = initialNodes.some(node => node.id === step.id);
    if (persisted) {
      const ok = await confirm({
        title: 'Xóa bước duyệt',
        targetName: step.label || 'bước chưa đặt tên',
        confirmText: 'Xóa bước',
        warningText: 'Phiếu đang nằm ở bước này vẫn chạy tiếp theo cấu hình cũ. Lịch sử duyệt không bị mất. Thay đổi chỉ có hiệu lực khi bạn bấm Lưu.',
        actionLabel: 'Xóa bước',
        intent: 'danger',
        countdownSeconds: 0,
      });
      if (!ok) return;
    }
    setDraft(nodes => removeStep(nodes, step.id));
    if (expandedId === step.id) setExpandedId(null);
  };

  const save = async () => {
    if (issues.count > 0) {
      setShowIssues(true);
      const firstWithIssue = steps.find(step => issues.byStepId[step.id]);
      if (firstWithIssue) setExpandedId(firstWithIssue.id);
      return;
    }
    const stuck = steps.filter(step => {
      const check = recipientChecks.get(step.id);
      return check?.state === 'blocked' || check?.state === 'empty_room';
    });
    if (stuck.length > 0) {
      const ok = await confirm({
        title: 'Có bước không ai nhận được',
        targetName: stuck.map(step => step.label).join(', '),
        confirmText: 'Chưa ai đủ quyền Duyệt + Xem ở',
        warningText: 'Phiếu mới sẽ dừng ở các bước này cho tới khi được cấp quyền trong room Đề xuất vật tư. Vẫn lưu?',
        actionLabel: 'Vẫn lưu',
        intent: 'warning',
        countdownSeconds: 0,
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const structure = buildLinearTemplateStructure(template.id, draft, generateId);
      await projectWorkflowService.saveTemplateStructure({ template, ...structure });
      await onSaved(structure.nodes);
    } catch (err: any) {
      setError(describeSaveError(err));
    } finally {
      setSaving(false);
    }
  };

  const renderRecipientStatus = () => {
    if (recipients.status === 'loading') {
      return <span className="flex items-center gap-1.5 text-slate-500"><Loader2 size={13} className="animate-spin" /> Đang kiểm tra quyền trong room...</span>;
    }
    if (recipients.status === 'error') {
      return (
        <span className="flex flex-wrap items-center gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={13} /> Chưa kiểm tra được quyền người xử lý: {recipients.message}
          <button type="button" onClick={() => setRecipientReloadKey(key => key + 1)} className="inline-flex items-center gap-1 font-black underline">
            <RefreshCw size={11} /> Thử lại
          </button>
        </span>
      );
    }
    if (recipients.eligibleUserIds.size === 0) {
      return <span className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300"><AlertTriangle size={13} /> Room Đề xuất vật tư chưa có ai có quyền Duyệt + Xem{constructionSiteId ? ' ở công trường này' : ''}.</span>;
    }
    return (
      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
        <ShieldCheck size={13} className="text-emerald-600" />
        {recipients.eligibleUserIds.size} người có quyền Duyệt + Xem trong room{constructionSiteId ? ' (công trường đang chọn)' : ''}
      </span>
    );
  };

  const renderRecipientWarning = (check: StepRecipientCheck | undefined) => {
    if (!check) return null;
    if (check.state === 'empty_room') {
      return <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">Chưa ai có quyền Duyệt + Xem trong room, phiếu sẽ dừng ở bước này.</p>;
    }
    if (check.state === 'blocked') {
      return (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
          Không ai được chọn có quyền Duyệt + Xem trong room: {check.ineligibleUserIds.map(nameOf).join(', ')}. Phiếu sẽ dừng ở bước này.
        </p>
      );
    }
    if (check.state === 'partial') {
      return (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {check.ineligibleUserIds.length} người chưa có quyền Duyệt + Xem nên sẽ không nhận được bước này: {check.ineligibleUserIds.map(nameOf).join(', ')}.
        </p>
      );
    }
    return null;
  };

  const renderAssigneeFields = (step: WorkflowNode, kind: StepAssigneeKind) => {
    const config = step.config || {};
    if (kind === 'fixed') {
      const eligible = eligibleUserIds ? activeUsers.filter(user => eligibleUserIds.has(user.id)) : activeUsers;
      const others = eligibleUserIds ? activeUsers.filter(user => !eligibleUserIds.has(user.id)) : [];
      return (
        <div>
          <label htmlFor={`step-fixed-${step.id}`} className={fieldLabelClass}>Người xử lý</label>
          <select
            id={`step-fixed-${step.id}`}
            value={config.assigneeUserId || ''}
            onChange={event => setDraft(nodes => updateStepConfig(nodes, step.id, 'assigneeUserId', event.target.value))}
            className={inputClass}
          >
            <option value="">Chọn một người</option>
            {eligibleUserIds ? (
              <>
                <optgroup label="Có quyền Duyệt + Xem trong room">
                  {eligible.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                </optgroup>
                {others.length > 0 && (
                  <optgroup label="Chưa có quyền trong room">
                    {others.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                  </optgroup>
                )}
              </>
            ) : eligible.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </div>
      );
    }
    if (kind === 'pool') {
      const targets = config.assignmentTargets || [];
      const preserved = getPreservedTargets(targets);
      const setTargets = (userIds: string[], departmentIds: string[]) => {
        const next = [...buildAssignmentTargets(userIds, departmentIds), ...preserved];
        setConfig(step.id, { ...config, assignmentTargets: next.length ? next : undefined });
      };
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className={fieldLabelClass}>Người trong nhóm</span>
              <SearchableCheckboxSelect
                options={userOptions}
                selectedValues={getTargetUserIds(targets)}
                onChange={ids => setTargets(ids, getTargetDepartmentIds(targets))}
                placeholder="Tìm người..."
              />
            </div>
            <div>
              <span className={fieldLabelClass}>Phòng ban</span>
              <SearchableCheckboxSelect
                options={departmentOptions}
                selectedValues={getTargetDepartmentIds(targets)}
                onChange={ids => setTargets(getTargetUserIds(targets), ids)}
                placeholder="Tìm phòng ban..."
              />
            </div>
          </div>
          {preserved.length > 0 && (
            <p className="text-[11px] text-slate-500">Giữ nguyên {preserved.length} điều kiện theo quyền dự án đã cấu hình trước đó.</p>
          )}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
            <input
              type="checkbox"
              checked={isConcurrentApprovalStep(config)}
              onChange={event => setDraft(nodes => updateStepConfig(nodes, step.id, 'assigneeSelectionMode', event.target.checked ? 'multiple' : ''))}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>
              <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">Duyệt đồng thời</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Giao cùng lúc cho nhiều người trong nhóm, chỉ cần một người chuyển bước là xong. Tắt: người chuyển bước chọn một người trong nhóm.
              </span>
            </span>
          </label>
        </div>
      );
    }
    if (kind === 'creator') {
      return <p className="text-[11px] text-slate-500 dark:text-slate-400">Người gửi đề xuất cũng cần quyền Duyệt + Xem trong room để xử lý bước này.</p>;
    }
    return null;
  };

  const renderStep = (step: WorkflowNode, index: number) => {
    const config = step.config || {};
    const kind = getStepAssigneeKind(config);
    const expanded = expandedId === step.id;
    const stepIssues = issues.byStepId[step.id] || [];
    const check = recipientChecks.get(step.id);
    const hasProblem = (showIssues && stepIssues.length > 0) || check?.state === 'blocked' || check?.state === 'empty_room';
    const hasWarning = check?.state === 'partial';
    const watcherUserIds = getTargetUserIds(config.stepWatcherTargets);
    const watcherOthers = (config.stepWatcherTargets || []).filter(target => target.type !== 'user');
    const bodyId = `step-body-${step.id}`;

    return (
      <li
        key={step.id}
        className={`rounded-xl border bg-white dark:bg-slate-800 ${hasProblem ? 'border-red-300 dark:border-red-800' : expanded ? 'border-indigo-300 dark:border-indigo-700' : 'border-slate-200 dark:border-slate-700'}`}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white dark:bg-slate-100 dark:text-slate-900">
            {index + 1}
          </span>
          <button
            type="button"
            onClick={() => setExpandedId(expanded ? null : step.id)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`truncate text-sm font-bold ${step.label.trim() ? 'text-slate-800 dark:text-slate-100' : 'italic text-red-600'}`}>
                  {step.label.trim() || 'Chưa đặt tên'}
                </span>
                {isConcurrentApprovalStep(config) && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Duyệt đồng thời</span>
                )}
                {config.slaHours ? <span className="text-[10px] font-medium text-slate-400">⏱ {config.slaHours}h</span> : null}
                {(hasProblem || hasWarning) && (
                  <AlertTriangle size={13} className={hasProblem ? 'text-red-500' : 'text-amber-500'} aria-label={hasProblem ? 'Bước có lỗi' : 'Bước cần xem lại'} />
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{describeStepAssignment(config, lookups)}</span>
            </span>
            <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex shrink-0 items-center">
            <button type="button" onClick={() => setDraft(nodes => moveStep(nodes, step.id, 'up'))} disabled={index === 0} aria-label={`Đưa "${step.label}" lên trên`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700"><ArrowUp size={14} /></button>
            <button type="button" onClick={() => setDraft(nodes => moveStep(nodes, step.id, 'down'))} disabled={index === steps.length - 1} aria-label={`Đưa "${step.label}" xuống dưới`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700"><ArrowDown size={14} /></button>
            <button type="button" onClick={() => deleteStep(step)} disabled={steps.length <= 1} title={steps.length <= 1 ? 'Quy trình cần ít nhất một bước duyệt' : undefined} aria-label={`Xóa bước "${step.label}"`} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40"><Trash2 size={14} /></button>
          </div>
        </div>

        {!expanded && renderRecipientWarning(check) && <div className="px-3 pb-2.5">{renderRecipientWarning(check)}</div>}

        {expanded && (
          <div id={bodyId} className="space-y-4 border-t border-slate-100 px-3 py-3 dark:border-slate-700 sm:px-4">
            <div>
              <label htmlFor={`step-label-${step.id}`} className={fieldLabelClass}>Tên bước</label>
              <input
                id={`step-label-${step.id}`}
                value={step.label}
                onChange={event => setDraft(nodes => updateStep(nodes, step.id, { label: event.target.value }))}
                placeholder="Ví dụ: Chỉ huy trưởng duyệt"
                maxLength={120}
                className={inputClass}
              />
            </div>

            <fieldset>
              <legend className={fieldLabelClass}>Ai xử lý bước này</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ASSIGNEE_KINDS.map(option => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${kind === option ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'}`}
                  >
                    <input
                      type="radio"
                      name={`step-kind-${step.id}`}
                      checked={kind === option}
                      onChange={() => setConfig(step.id, withStepAssigneeKind(config, option))}
                      className="mt-0.5 h-4 w-4 text-indigo-600"
                    />
                    <span>
                      <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">{STEP_ASSIGNEE_KIND_LABELS[option].label}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{STEP_ASSIGNEE_KIND_LABELS[option].hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {renderAssigneeFields(step, kind)}
            {renderRecipientWarning(check)}

            <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
              <div>
                <label htmlFor={`step-sla-${step.id}`} className={fieldLabelClass}><Clock size={10} className="mr-1 inline" />Hạn xử lý (giờ)</label>
                <input
                  id={`step-sla-${step.id}`}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={config.slaHours ?? ''}
                  onChange={event => {
                    const hours = Number(event.target.value);
                    setDraft(nodes => updateStepConfig(nodes, step.id, 'slaHours', event.target.value && hours > 0 ? hours : ''));
                  }}
                  placeholder="Không giới hạn"
                  className={inputClass}
                />
              </div>
              <div>
                <span className={fieldLabelClass}><Eye size={10} className="mr-1 inline" />Người theo dõi bước (tùy chọn)</span>
                <SearchableCheckboxSelect
                  options={userOptions}
                  selectedValues={watcherUserIds}
                  onChange={ids => {
                    const next = [...buildAssignmentTargets(ids, []), ...watcherOthers];
                    setConfig(step.id, { ...config, stepWatcherTargets: next.length ? next : undefined });
                  }}
                  placeholder="Tìm người theo dõi..."
                  maxHeightClass="h-28"
                />
              </div>
            </div>

            {showIssues && stepIssues.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg bg-red-50 py-2 pl-7 pr-3 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {stepIssues.map(item => <li key={item}>{item}</li>)}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>Bạn đang sửa <b>bản riêng của dự án</b>. Phiếu đang chạy giữ các bước cũ; chỉ phiếu gửi sau khi lưu mới đi theo các bước dưới đây.</span>
        </div>

        <div className="text-xs">{renderRecipientStatus()}</div>

        <ol className="space-y-2" aria-label="Các bước duyệt">
          {steps.map(renderStep)}
          <li className="flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800/50">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              <PackageCheck size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-bold text-slate-600 dark:text-slate-200">Người phụ trách tạo đợt cấp / đặt mua</span>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Bước bàn giao cố định, luôn nằm cuối. Người nhận cần quyền Xác nhận trong room.</p>
            </div>
          </li>
        </ol>

        <button
          type="button"
          onClick={addStep}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-indigo-300 px-3 py-2.5 text-xs font-black text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
        >
          <Plus size={14} /> Thêm bước duyệt
        </button>

        {showIssues && issues.general.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {issues.general.join(' ')}
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400" aria-live="polite">
          {showIssues && issues.count > 0
            ? <span className="text-red-600 dark:text-red-300">Còn {issues.count} lỗi cần sửa trước khi lưu</span>
            : dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi'}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-lg px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 sm:flex-none"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 sm:flex-none"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Đang lưu...' : 'Lưu các bước duyệt'}
          </button>
        </div>
      </div>
    </>
  );
};

export default ProjectWorkflowStepEditor;
