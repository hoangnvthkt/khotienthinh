import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, LoaderCircle, Save } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import RequestTemplateSettingsNav, { type RequestTemplateSection } from '../../components/request/template/RequestTemplateSettingsNav';
import RequestTemplateGeneralSection from '../../components/request/template/RequestTemplateGeneralSection';
import RequestTemplateScopeEditor from '../../components/request/template/RequestTemplateScopeEditor';
import RequestFormBuilder from '../../components/request/template/RequestFormBuilder';
import RequestApprovalBuilder from '../../components/request/template/RequestApprovalBuilder';
import RequestTemplateWatcherSection from '../../components/request/template/RequestTemplateWatcherSection';
import RequestTemplatePrintSection from '../../components/request/template/RequestTemplatePrintSection';
import RequestTemplateNotificationSection from '../../components/request/template/RequestTemplateNotificationSection';
import RequestTemplatePreview from '../../components/request/template/RequestTemplatePreview';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { buildRequestTemplateSaveInput, createEmptyRequestTemplateDraft, requestTemplateDraftReducer, shouldScheduleRequestTemplateAutosave, validateRequestTemplateForPublish, validateRequestTemplateForSave, type RequestTemplateDraft } from '../../lib/requestTemplateEditorModel';
import { formatRequestTemplateSaveError } from '../../lib/requestTemplateError';
import { requestTemplateService, type RequestTemplateDraftRecord } from '../../lib/requestTemplateService';

const fromRecord = (record: RequestTemplateDraftRecord): RequestTemplateDraft => ({
  id: record.id,
  name: record.payload.name,
  description: record.payload.description,
  status: record.status,
  requestSlaHours: record.payload.requestSlaHours ?? null,
  flowMode: record.payload.flowMode,
  completionPolicy: record.payload.completionPolicy,
  fields: record.payload.formSchema,
  approverBlocks: record.payload.blocks,
  scopes: [
    ...(record.payload.usageScope.companyWide ? [{ kind: 'COMPANY' as const, targetId: null }] : []),
    ...record.payload.usageScope.orgUnitIds.map(targetId => ({ kind: 'ORG_UNIT' as const, targetId })),
    ...record.payload.usageScope.permissionCodes.map(targetId => ({ kind: 'PERMISSION_GROUP' as const, targetId })),
    ...record.payload.usageScope.userIds.map(targetId => ({ kind: 'USER' as const, targetId })),
  ],
  fixedWatcherIds: record.payload.watcherUserIds,
  print: record.payload.printConfig,
  notificationEvents: Object.entries(record.payload.notificationConfig).filter(([, enabled]) => enabled).map(([event]) => event as RequestTemplateDraft['notificationEvents'][number]),
});

const isStructurallySaveable = (draft: RequestTemplateDraft) => draft.name.trim().length > 0
  && draft.fields.every(field => field.key.trim() && field.label.trim())
  && draft.approverBlocks.every(block => block.key.trim() && block.name.trim());

const RequestTemplateEditor: React.FC = () => {
  const navigate = useNavigate();
  const { templateId } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, dispatch] = useReducer(requestTemplateDraftReducer, undefined, createEmptyRequestTemplateDraft);
  const [activeSection, setActiveSection] = useState<RequestTemplateSection>('GENERAL');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(templateId));
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isAutosaveBlocked, setIsAutosaveBlocked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (!templateId) return;
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const record = await requestTemplateService.getDraft(templateId);
        if (!active) return;
        dispatch({ type: 'REPLACE_DRAFT', draft: fromRecord(record) });
        setUpdatedAt(record.updatedAt);
        setDraftVersionId(record.draftVersionId ?? null);
        setIsDirty(false);
        setIsAutosaveBlocked(false);
      } catch (cause) {
        console.error('Load request template draft failed:', cause);
        if (active) setSaveError('Không thể tải bản nháp mẫu yêu cầu.');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [templateId]);

  const apply = useCallback((action: Parameters<typeof requestTemplateDraftReducer>[1]) => {
    dispatch(action);
    setIsDirty(true);
    setSaveError(null);
  }, []);

  const save = useCallback(async (automatic = false) => {
    if (saveInFlightRef.current || !isStructurallySaveable(draft)) return false;
    const saveIssues = validateRequestTemplateForSave(draft);
    if (saveIssues.length) {
      const issue = saveIssues[0];
      setActiveSection(issue.section === 'SCOPE' ? 'GENERAL' : issue.section);
      setSaveError(issue.message);
      if (!automatic) toast.error('Chưa thể lưu bản nháp', issue.message);
      return false;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const record = await requestTemplateService.saveDraft(
        buildRequestTemplateSaveInput(draft, updatedAt),
      );
      dispatch({ type: 'REPLACE_DRAFT', draft: fromRecord(record) });
      setUpdatedAt(record.updatedAt);
      setDraftVersionId(record.draftVersionId ?? null);
      setIsDirty(false);
      setIsAutosaveBlocked(false);
      if (!automatic) toast.success('Đã lưu bản nháp', 'Các thay đổi của mẫu yêu cầu đã được lưu.');
      if (!templateId) navigate(`/rq/templates/${record.id}`, { replace: true });
      return true;
    } catch (cause) {
      console.error('Save request template draft failed:', cause);
      if (automatic) setIsAutosaveBlocked(true);
      const isAbort = (cause as { name?: string; message?: string })?.name === 'AbortError' || String((cause as { message?: string })?.message).includes('aborted');
      if (automatic && isAbort) {
        // Silently ignore aborted automatic saves
        return false;
      }
      const message = formatRequestTemplateSaveError(cause);
      setSaveError(message);
      if (!automatic) toast.error('Lưu bản nháp thất bại', message);
      return false;
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [draft, navigate, templateId, toast, updatedAt]);

  useEffect(() => {
    if (!shouldScheduleRequestTemplateAutosave({
      hasTemplateId: Boolean(draft.id),
      isDirty,
      isBlocked: isAutosaveBlocked,
      isStructurallySaveable: isStructurallySaveable(draft),
      hasValidationIssues: validateRequestTemplateForSave(draft).length > 0,
    })) return;
    const timer = window.setTimeout(() => { void save(true); }, 1500);
    return () => window.clearTimeout(timer);
  }, [draft, isAutosaveBlocked, isDirty, save]);

  useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [isDirty]);

  const validationIssues = useMemo(() => validateRequestTemplateForPublish(draft), [draft]);
  const publish = async () => {
    if (validationIssues.length) {
      const section = validationIssues[0].section;
      setActiveSection(section === 'SCOPE' ? 'GENERAL' : section);
      setSaveError(validationIssues[0].message);
      return;
    }
    const accepted = await confirm({ title: 'Phát hành phiên bản mẫu?', targetName: draft.name, subtitle: `Luồng ${draft.flowMode === 'SEQUENTIAL' ? 'duyệt lần lượt' : 'duyệt đồng thời'} · ${draft.approverBlocks.length} khối duyệt · phiên bản phát hành sẽ bất biến.`, actionLabel: 'Phát hành', intent: 'success' });
    if (!accepted) return;
    setIsPublishing(true); setSaveError(null);
    try {
      const saved = await requestTemplateService.saveDraft(
        buildRequestTemplateSaveInput(draft, updatedAt),
      );
      const templateId = saved.id;
      const expectedUpdatedAt = saved.updatedAt;
      const result = await requestTemplateService.publish({ templateId, expectedUpdatedAt });
      setIsDirty(false);
      toast.success('Đã phát hành mẫu', `Phiên bản v${result.versionNumber} đã sẵn sàng để tạo đề xuất.`);
      navigate('/rq/templates', { replace: true });
    } catch (cause) {
      console.error('Publish request template failed:', cause);
      const message = formatRequestTemplateSaveError(cause);
      setSaveError(message); toast.error('Phát hành thất bại', message);
    } finally { setIsPublishing(false); }
  };
  const saveHint = useMemo(() => isSaving ? 'Đang lưu...' : saveError ? 'Lưu thất bại' : isDirty ? 'Chưa lưu' : updatedAt ? 'Đã lưu' : 'Bản nháp mới', [isDirty, isSaving, saveError, updatedAt]);
  if (isLoading) return <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle size={20} className="animate-spin" /> Đang tải bản nháp...</div>;

  const general = <><RequestTemplateGeneralSection draft={draft} updatedAt={updatedAt} dispatch={apply} issues={validationIssues} /><RequestTemplateScopeEditor scopes={draft.scopes} dispatch={apply} /></>;
  const form = <RequestFormBuilder fields={draft.fields} dispatch={apply} issues={validationIssues} />;
  const approval = <RequestApprovalBuilder draft={draft} dispatch={apply} issues={validationIssues} />;
  const watchers = <RequestTemplateWatcherSection watcherIds={draft.fixedWatcherIds} dispatch={apply} />;
  const print = <RequestTemplatePrintSection draft={draft} draftVersionId={draftVersionId} dispatch={apply} />;
  const notifications = <RequestTemplateNotificationSection draft={draft} dispatch={apply} />;

  return <div className="-m-4 flex min-h-[calc(100vh-5rem)] flex-col bg-slate-50 dark:bg-slate-950 sm:-m-6">
    <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between"><div><button onClick={() => navigate('/rq/templates')} className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-accent"><ArrowLeft size={14} /> Danh sách mẫu</button><h1 className="text-xl font-bold text-slate-800 dark:text-white">{draft.name.trim() || 'Mẫu yêu cầu mới'}</h1><p className="mt-0.5 text-sm text-slate-400">{saveHint}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setShowPreview(value => !value)} className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-accent hover:text-accent dark:border-slate-700 dark:text-slate-300"><Eye size={17} className="mr-2" /> Xem trước</button><button disabled={isSaving || !isStructurallySaveable(draft)} onClick={() => void save()} className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? <LoaderCircle size={17} className="mr-2 animate-spin" /> : <Save size={17} className="mr-2" />} Lưu nháp</button><button disabled={isPublishing} onClick={() => void publish()} className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{isPublishing ? <LoaderCircle size={17} className="mr-2 animate-spin" /> : <Check size={17} className="mr-2" />} Phát hành</button></div></header>
    {saveError && <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{saveError}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]"><RequestTemplateSettingsNav active={activeSection} onChange={setActiveSection} /><main className="min-w-0 overflow-y-auto"><div className="mx-auto max-w-5xl space-y-4 p-5">{showPreview && <RequestTemplatePreview draft={draft} />}{activeSection === 'GENERAL' ? general : activeSection === 'FORM' ? form : activeSection === 'APPROVAL' ? approval : activeSection === 'WATCHERS' ? watchers : activeSection === 'PRINT' ? print : notifications}</div></main></div>
  </div>;
};

export default RequestTemplateEditor;
