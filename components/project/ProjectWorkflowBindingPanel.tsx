import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, GitBranch, Info, Loader2, Lock, PackageCheck, Pencil, Settings2, X,
} from 'lucide-react';
import {
  ProjectWorkflowBindingScope,
  ProjectWorkflowConfiguration,
  User,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTemplate,
} from '../../types';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import { useApp } from '../../context/AppContext';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';
import { buildUserNameById, describeStepAssignment, isConcurrentApprovalStep } from '../../lib/workflowStepSummary';
import { useConfirm } from '../../context/ConfirmContext';
import { useWorkflow } from '../../context/WorkflowContext';
import ProjectWorkflowStepEditor from './ProjectWorkflowStepEditor';

interface Props {
  projectId?: string | null;
  constructionSiteId?: string | null;
  templates: WorkflowTemplate[];
  /** Nodes of the effective template, as already loaded by the material tab. */
  templateNodes?: WorkflowNode[];
  users?: User[];
  onConfigurationChange?: (configuration: ProjectWorkflowConfiguration) => void;
}

const scopeLabel: Record<ProjectWorkflowBindingScope, string> = {
  global: 'Mặc định toàn hệ thống',
  project: 'Riêng dự án',
  site: 'Riêng công trường',
};

const scopeBadgeClass: Record<ProjectWorkflowBindingScope, string> = {
  global: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
  project: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200',
  site: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
};

const isRemovedNode = (node: WorkflowNode) => {
  const flag = (node.config as Record<string, unknown> | undefined)?.__templateRemoved;
  return flag === true || flag === 'true';
};

// Mirrors app_private.project_workflow_binding_can_manage so a read-only user
// knows who to ask instead of facing a vanished button.
const READ_ONLY_REASON = 'Bạn đang xem ở chế độ chỉ đọc. Đổi quy trình áp dụng cần một trong các quyền: quản trị hệ thống, quản trị module Quy trình, hoặc quyền Sửa của dự án kèm quản trị module Dự án / quản trị mẫu quy trình này.';

const CHANGE_TEMPLATE_REASON = 'Đổi sang một mẫu quy trình khác cần quyền quản trị module Dự án hoặc quản trị mẫu quy trình này. Bạn vẫn sửa được các bước duyệt của dự án ở trên.';

const describeEditError = (err: any): string => {
  if (err?.code === '42501') return 'Bạn cần quyền Sửa + Xem ở cấp dự án (không chỉ công trường) trong room Đề xuất vật tư.';
  return err?.message || 'Không mở được trình sửa bước duyệt.';
};

type EditSession = { template: WorkflowTemplate; nodes: WorkflowNode[] };

const ProjectWorkflowBindingPanel: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  templates,
  templateNodes = [],
  users,
  onConfigurationChange,
}) => {
  const { users: appUsers, orgUnits, employees } = useApp();
  const { refreshData: refreshWorkflowData } = useWorkflow();
  const confirm = useConfirm();
  const [configuration, setConfiguration] = useState<ProjectWorkflowConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadDenied, setLoadDenied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [targetScope, setTargetScope] = useState<'project' | 'site'>(constructionSiteId ? 'site' : 'project');
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [enteringEdit, setEnteringEdit] = useState(false);
  const draftDirtyRef = useRef(false);
  const confirmingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onConfigurationChange);
  onChangeRef.current = onConfigurationChange;

  const templateById = useMemo(() => new Map(templates.map(template => [template.id, template])), [templates]);
  const activeTemplates = useMemo(() => templates.filter(template => template.isActive), [templates]);

  const applyConfiguration = useCallback((next: ProjectWorkflowConfiguration) => {
    setConfiguration(next);
    onChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoadDenied(false);
    projectWorkflowService.getConfiguration('material_request', projectId || null, constructionSiteId || null)
      .then(next => { if (!cancelled) applyConfiguration(next); })
      .catch(err => {
        if (cancelled) return;
        setLoadDenied(err?.code === '42501');
        setLoadError(err?.message || 'Không tải được cấu hình quy trình duyệt.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyConfiguration, constructionSiteId, projectId, reloadKey]);

  const effectiveTemplateId = configuration?.binding?.workflowTemplateId || '';
  const effectiveTemplateName = effectiveTemplateId
    ? configuration?.templateName || templateById.get(effectiveTemplateId)?.name || 'Mẫu quy trình (không đọc được tên)'
    : null;
  const scope = configuration?.scope || null;
  const canManage = Boolean(configuration?.canManage);
  const canCustomize = Boolean(configuration?.canCustomize);
  const ownedByProject = Boolean(configuration?.templateOwnedByProject);
  // A site override outranks the project binding, so a project copy would not reach this site.
  const editBlockedReason = !configuration?.binding
    ? 'Chưa có quy trình nào để sửa.'
    : !canCustomize
      ? 'Cần quyền Sửa + Xem trong room Đề xuất vật tư của dự án.'
      : scope === 'site'
        ? 'Công trường này đang dùng mẫu riêng của công trường. Bỏ cấu hình riêng công trường để sửa bước ở cấp dự án.'
        : null;
  const taskCount = configuration?.validation?.taskCount;

  const steps = useMemo(() => templateNodes
    .filter(node => node.templateId === effectiveTemplateId
      && node.type !== WorkflowNodeType.START
      && node.type !== WorkflowNodeType.END
      && !isRemovedNode(node))
    .sort((a, b) => a.positionY - b.positionY), [effectiveTemplateId, templateNodes]);

  const lookups = useMemo(() => ({
    userNameById: buildUserNameById(users && users.length > 0 ? users : appUsers || []),
    orgUnits: orgUnits || [],
  }), [appUsers, orgUnits, users]);

  // Every confirm opened from here goes through this, so Escape inside the
  // confirm modal does not also close the panel behind it.
  const guardedConfirm = useCallback<typeof confirm>(options => {
    confirmingRef.current = true;
    return confirm(options).finally(() => { confirmingRef.current = false; });
  }, [confirm]);

  const confirmDiscard = useCallback(async () => {
    if (!draftDirtyRef.current) return true;
    return guardedConfirm({
      title: 'Bỏ thay đổi chưa lưu?',
      targetName: 'các bước duyệt đang sửa',
      confirmText: 'Thoát và bỏ',
      warningText: 'Những thay đổi chưa lưu sẽ mất. Quy trình đang áp dụng giữ nguyên.',
      actionLabel: 'Bỏ thay đổi',
      cancelLabel: 'Tiếp tục sửa',
      intent: 'warning',
      countdownSeconds: 0,
    });
  }, [guardedConfirm]);

  const exitEdit = useCallback(() => {
    draftDirtyRef.current = false;
    setEditSession(null);
  }, []);

  const cancelEdit = useCallback(async () => {
    if (await confirmDiscard()) exitEdit();
  }, [confirmDiscard, exitEdit]);

  const close = useCallback(async () => {
    // Escape inside the confirm modal must not also close this dialog.
    if (confirmingRef.current) return;
    if (!(await confirmDiscard())) return;
    exitEdit();
    setOpen(false);
  }, [confirmDiscard, exitEdit]);
  useDialogFocusTrap(open, dialogRef, close);
  const handleDirtyChange = useCallback((dirty: boolean) => { draftDirtyRef.current = dirty; }, []);

  const openDialog = () => {
    setTemplateId(effectiveTemplateId || activeTemplates[0]?.id || '');
    setTargetScope(constructionSiteId ? 'site' : 'project');
    setShowChange(false);
    setError(null);
    setNotice(null);
    exitEdit();
    setOpen(true);
  };

  const refresh = async () => {
    const next = await projectWorkflowService.getConfiguration('material_request', projectId || null, constructionSiteId || null);
    applyConfiguration(next);
  };

  const startEdit = async () => {
    if (!projectId || editBlockedReason) return;
    setError(null);
    setNotice(null);
    if (!ownedByProject) {
      const ok = await guardedConfirm({
        title: 'Tạo bản riêng cho dự án',
        targetName: effectiveTemplateName || 'quy trình đang áp dụng',
        confirmText: 'Sao chép các bước của',
        subtitle: 'thành bản riêng để dự án tự thêm, bớt, đổi thứ tự bước duyệt.',
        warningText: 'Mẫu dùng chung trong module Quy trình giữ nguyên. Từ nay thay đổi ở đó không còn tự áp dụng cho dự án này. Phiếu đang chạy không bị ảnh hưởng.',
        actionLabel: 'Tạo bản riêng',
        intent: 'warning',
        countdownSeconds: 0,
      });
      if (!ok) return;
    }
    setEnteringEdit(true);
    try {
      const result = await projectWorkflowService.cloneProjectTemplate({ subjectType: 'material_request', projectId });
      if (!result) {
        setError('Máy chủ chưa cập nhật tính năng này (cần áp migration 20260926090000). Liên hệ quản trị hệ thống.');
        return;
      }
      const { nodes } = await projectWorkflowService.getTemplateStartContext(result.template.id);
      if (result.cloned) await Promise.all([refresh(), refreshWorkflowData()]);
      draftDirtyRef.current = false;
      setEditSession({ template: result.template, nodes });
    } catch (err: any) {
      setError(describeEditError(err));
    } finally {
      setEnteringEdit(false);
    }
  };

  const handleStepsSaved = async () => {
    try {
      await Promise.all([refresh(), refreshWorkflowData()]);
    } catch {
      // The save itself succeeded; stale lists only last until the next reload.
    }
    exitEdit();
    setNotice('Đã lưu các bước duyệt. Phiếu đang chạy giữ các bước cũ; phiếu gửi mới đi theo cấu hình này.');
  };

  const save = async () => {
    if (!templateId || !projectId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await projectWorkflowService.setBinding({
        subjectType: 'material_request',
        workflowTemplateId: templateId,
        projectId,
        constructionSiteId: targetScope === 'site' ? constructionSiteId || null : null,
      });
      await refresh();
      setShowChange(false);
      setNotice('Đã áp dụng mẫu quy trình. Phiếu đang chạy vẫn đi theo các bước cũ; phiếu gửi mới sẽ theo mẫu này.');
    } catch (err: any) {
      setError(err?.message || 'Không lưu được cấu hình quy trình.');
    } finally {
      setSaving(false);
    }
  };

  const removeOverride = async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await projectWorkflowService.removeBinding({
        subjectType: 'material_request',
        projectId,
        constructionSiteId: targetScope === 'site' ? constructionSiteId || null : null,
      });
      await refresh();
      setShowChange(false);
      setNotice('Đã bỏ cấu hình riêng. Dự án quay về quy trình cấp trên.');
    } catch (err: any) {
      setError(err?.message || 'Không xóa được cấu hình riêng.');
    } finally {
      setSaving(false);
    }
  };

  const selectedScopeMatchesEffective = scope === targetScope;
  const hasIssue = (Boolean(loadError) && !loadDenied) || Boolean(configuration && !configuration.valid);

  const renderSteps = () => {
    if (!configuration?.binding) {
      return (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {configuration?.errors?.[0] || 'Chưa cấu hình quy trình duyệt cho đề xuất vật tư.'}
        </div>
      );
    }
    if (steps.length === 0) {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            {typeof taskCount === 'number' && taskCount > 0
              ? `Quy trình có ${taskCount} bước duyệt. Tài khoản của bạn chưa đọc được chi tiết từng bước.`
              : 'Chưa đọc được danh sách bước duyệt của mẫu này.'}
          </span>
        </div>
      );
    }
    return (
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white dark:bg-slate-100 dark:text-slate-900">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{step.label || `Bước ${index + 1}`}</span>
                {isConcurrentApprovalStep(step.config || {}) && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    Duyệt đồng thời
                  </span>
                )}
                {step.config?.slaHours ? (
                  <span className="text-[10px] font-medium text-slate-400">⏱ {step.config.slaHours}h</span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {describeStepAssignment(step.config || {}, lookups)}
              </p>
            </div>
          </li>
        ))}
        <li className="flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800/50">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            <PackageCheck size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-bold text-slate-600 dark:text-slate-200">Người phụ trách tạo đợt cấp / đặt mua</span>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Bước bàn giao cố định sau khi duyệt xong, chọn khi chuyển bước cuối.</p>
          </div>
        </li>
      </ol>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        title={loadDenied ? 'Bạn chưa có quyền xem quy trình duyệt của dự án này' : hasIssue ? 'Quy trình duyệt đang có vấn đề, bấm để xem' : 'Xem các bước duyệt đang áp dụng'}
        className={`flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[10px] font-bold transition-colors ${
          hasIssue
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
        }`}
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : loadDenied ? <Lock size={12} /> : hasIssue ? <AlertTriangle size={12} /> : <Settings2 size={12} />}
        Quy trình duyệt
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-950/45 sm:items-center sm:px-4 sm:py-6"
          onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-workflow-panel-title"
            className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-xl ${editSession ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-300"><GitBranch size={13} /> Đề xuất vật tư</div>
                <h3 id="project-workflow-panel-title" className="mt-1 text-base font-black text-slate-800 dark:text-slate-100">
                  {editSession ? 'Sửa bước duyệt của dự án' : 'Quy trình duyệt đang áp dụng'}
                </h3>
                {editSession && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{editSession.template.name}</p>}
              </div>
              <button type="button" onClick={close} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={17} /></button>
            </div>

            {editSession && projectId ? (
              <ProjectWorkflowStepEditor
                projectId={projectId}
                constructionSiteId={constructionSiteId}
                template={editSession.template}
                initialNodes={editSession.nodes}
                users={users && users.length > 0 ? users : appUsers || []}
                orgUnits={orgUnits || []}
                employees={employees || []}
                confirm={guardedConfirm}
                onCancel={cancelEdit}
                onSaved={handleStepsSaved}
                onDirtyChange={handleDirtyChange}
              />
            ) : (
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {loading && !configuration ? (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Đang tải cấu hình...</div>
              ) : loadError && !configuration && loadDenied ? (
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <Lock size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <span><span className="font-bold">{loadError}</span> Liên hệ quản lý dự án để được cấp quyền.</span>
                </div>
              ) : loadError && !configuration ? (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  <p className="font-bold">{loadError}</p>
                  <button type="button" onClick={() => setReloadKey(key => key + 1)} className="mt-2 font-black underline">Thử lại</button>
                </div>
              ) : (
                <>
                  <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-slate-800 dark:text-slate-100">{effectiveTemplateName || 'Chưa có mẫu quy trình'}</span>
                      {scope && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${scopeBadgeClass[scope]}`}>{scopeLabel[scope]}</span>
                      )}
                      {ownedByProject && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Bản riêng dự án</span>
                      )}
                    </div>
                    {configuration?.valid ? (
                      <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 size={13} /> Hợp lệ, sẵn sàng nhận phiếu mới
                      </p>
                    ) : configuration?.binding ? (
                      <div className="mt-1.5 text-xs text-red-700 dark:text-red-300">
                        <p className="flex items-center gap-1 font-semibold"><AlertTriangle size={13} /> Chưa gửi phiếu mới được</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {(configuration.errors.length ? configuration.errors : ['Mẫu quy trình chưa hợp lệ.']).map(item => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </section>

                  {scope === 'global' && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>Dự án đang dùng quy trình chung toàn hệ thống. Sửa ở đây sẽ tạo bản riêng cho dự án, mẫu chung giữ nguyên.</span>
                    </div>
                  )}

                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-[10px] font-black uppercase tracking-wide text-slate-400">Các bước duyệt theo thứ tự</h4>
                      <button
                        type="button"
                        onClick={startEdit}
                        disabled={Boolean(editBlockedReason) || enteringEdit || !projectId}
                        title={editBlockedReason || undefined}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                      >
                        {enteringEdit ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
                        Sửa bước duyệt
                      </button>
                    </div>
                    {editBlockedReason && configuration?.binding && (
                      <p className="mb-2 flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <Lock size={12} className="mt-0.5 shrink-0" /> {editBlockedReason}
                      </p>
                    )}
                    {error && !showChange && (
                      <div role="alert" className="mb-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>
                    )}
                    {renderSteps()}
                  </section>

                  {notice && (
                    <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {notice}
                    </div>
                  )}

                  {canManage ? (
                    <section className="rounded-xl border border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => setShowChange(value => !value)}
                        aria-expanded={showChange}
                        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-black text-slate-700 dark:text-slate-200"
                      >
                        Đổi mẫu quy trình áp dụng
                        <ChevronDown size={15} className={`text-slate-400 transition-transform ${showChange ? 'rotate-180' : ''}`} />
                      </button>
                      {showChange && (
                        <div className="space-y-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                          {constructionSiteId && (
                            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Phạm vi áp dụng">
                              {(['site', 'project'] as const).map(option => (
                                <button
                                  key={option}
                                  type="button"
                                  aria-pressed={targetScope === option}
                                  onClick={() => setTargetScope(option)}
                                  className={`rounded-lg border px-3 py-2 text-xs font-black ${targetScope === option ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}
                                >
                                  {scopeLabel[option]}
                                </button>
                              ))}
                            </div>
                          )}
                          <div>
                            <label htmlFor="project-workflow-template" className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Mẫu quy trình</label>
                            <select
                              id="project-workflow-template"
                              value={templateId}
                              onChange={event => setTemplateId(event.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              <option value="">Chọn mẫu quy trình</option>
                              {activeTemplates.map(template => (
                                <option key={template.id} value={template.id}>{template.name}</option>
                              ))}
                            </select>
                            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">Phiếu đang chạy giữ nguyên các bước cũ. Chỉ phiếu gửi sau khi lưu mới theo mẫu được chọn.</p>
                          </div>
                          {error && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
                          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                            <button
                              type="button"
                              disabled={saving || !selectedScopeMatchesEffective}
                              onClick={removeOverride}
                              title={selectedScopeMatchesEffective ? undefined : 'Phạm vi này chưa có cấu hình riêng'}
                              className="rounded-lg px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40"
                            >
                              Xóa cấu hình riêng
                            </button>
                            <button
                              type="button"
                              disabled={saving || !templateId || !projectId}
                              onClick={save}
                              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                            >
                              {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
                            </button>
                          </div>
                        </div>
                      )}
                    </section>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      <Lock size={14} className="mt-0.5 shrink-0 text-slate-400" />
                      <span>{canCustomize ? CHANGE_TEMPLATE_REASON : READ_ONLY_REASON}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ProjectWorkflowBindingPanel;
