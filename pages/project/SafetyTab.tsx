import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, ClipboardCheck, HardHat, IdCard, Plus, RefreshCw, ShieldCheck, Truck, UserRound, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { getSafetyEquipmentDocumentsStatus, safetyService, SafetyIssueFilters } from '../../lib/safetyService';
import { supabase } from '../../lib/supabase';
import {
  SafetyAttachment,
  SafetyDashboardSummary,
  SafetyEquipment,
  SafetyEquipmentDocument,
  SafetyInspection,
  SafetyInspectionItem,
  SafetyIssue,
  SafetyIssueStatus,
  SafetySubcontractor,
  SafetyTeam,
} from '../../types';
import { ActionBar, PageHeader, StatusBadge } from '../../components/erp';
import SafetyOverview from '../../components/project/safety/SafetyOverview';
import SafetyIssueList from '../../components/project/safety/SafetyIssueList';
import SafetyIssueFormModal from '../../components/project/safety/SafetyIssueFormModal';
import SafetyIssueDetailModal from '../../components/project/safety/SafetyIssueDetailModal';
import SafetyInspectionList from '../../components/project/safety/SafetyInspectionList';
import SafetyInspectionFormModal from '../../components/project/safety/SafetyInspectionFormModal';
import SafetyContractorPanel from '../../components/project/safety/SafetyContractorPanel';
import SafetyEquipmentPanel from '../../components/project/safety/SafetyEquipmentPanel';
import SafetyTeamPanel from '../../components/project/safety/SafetyTeamPanel';
import SafetyAttachmentPreviewModal from '../../components/project/safety/SafetyAttachmentPreviewModal';
import SafetyPassportPanel from '../../components/project/safety/SafetyPassportPanel';

interface SafetyTabProps {
  projectId: string;
  constructionSiteId?: string | null;
  canManageTab?: boolean;
}

type SafetyView = 'overview' | 'passport' | 'passportContractors' | 'passportWorkers' | 'passportAssignments' | 'passportCards' | 'issues' | 'inspections' | 'contractors' | 'teams' | 'equipment';

const VIEW_CONFIG: Record<SafetyView, { label: string; icon: React.ReactNode }> = {
  overview: { label: 'Tổng quan', icon: <ShieldCheck size={14} /> },
  passport: { label: 'Passport', icon: <BadgeCheck size={14} /> },
  passportContractors: { label: 'NTP/Tổ đội', icon: <HardHat size={14} /> },
  passportWorkers: { label: 'Hồ sơ nhân công', icon: <UserRound size={14} /> },
  passportAssignments: { label: 'Nhân công CT', icon: <Users size={14} /> },
  passportCards: { label: 'Thẻ an toàn', icon: <IdCard size={14} /> },
  issues: { label: 'Sự cố / nguy cơ', icon: <AlertTriangle size={14} /> },
  inspections: { label: 'Kiểm tra hiện trường', icon: <ClipboardCheck size={14} /> },
  contractors: { label: 'Nhà thầu phụ', icon: <HardHat size={14} /> },
  teams: { label: 'Tổ đội', icon: <Users size={14} /> },
  equipment: { label: 'Máy móc / thiết bị', icon: <Truck size={14} /> },
};

const VIEW_GROUPS: Array<{ label: string; views: SafetyView[] }> = [
  { label: 'Tổng quan', views: ['overview'] },
  { label: 'Safety Passport', views: ['passport', 'passportWorkers', 'passportAssignments', 'passportCards', 'passportContractors'] },
  { label: 'Hiện trường', views: ['issues', 'inspections'] },
  { label: 'Nguồn lực', views: ['contractors', 'teams', 'equipment'] },
];

const defaultIssueFilters: SafetyIssueFilters & { search: string; status: any; severity: any; type: any } = {
  search: '',
  status: 'all',
  severity: 'all',
  type: 'all',
};

const SafetyTab: React.FC<SafetyTabProps> = ({ projectId, constructionSiteId, canManageTab = true }) => {
  const { user, users } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const location = useLocation();

  const [view, setView] = useState<SafetyView>('overview');
  const [summary, setSummary] = useState<SafetyDashboardSummary | null>(null);
  const [issues, setIssues] = useState<SafetyIssue[]>([]);
  const [issueCount, setIssueCount] = useState(0);
  const [issueHasNextPage, setIssueHasNextPage] = useState(false);
  const [inspections, setInspections] = useState<SafetyInspection[]>([]);
  const [contractors, setContractors] = useState<SafetySubcontractor[]>([]);
  const [teams, setTeams] = useState<SafetyTeam[]>([]);
  const [equipment, setEquipment] = useState<SafetyEquipment[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingView, setLoadingView] = useState(false);
  const [issueFilters, setIssueFilters] = useState(defaultIssueFilters);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [editingIssue, setEditingIssue] = useState<SafetyIssue | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<SafetyIssue | null>(null);
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [editingInspection, setEditingInspection] = useState<SafetyInspection | null>(null);
  const [previewAttachments, setPreviewAttachments] = useState<SafetyAttachment[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  const availableUsers = useMemo(() => {
    const rows = users.length ? users : [user];
    return rows.filter(row => row?.id);
  }, [user, users]);

  const openAttachmentPreview = useCallback((attachments: SafetyAttachment[], index: number) => {
    if (!attachments.length) return;
    setPreviewAttachments(attachments);
    setPreviewIndex(Math.max(0, Math.min(index, attachments.length - 1)));
  }, []);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      setSummary(await safetyService.getDashboardSummary(projectId, constructionSiteId));
    } catch (error: any) {
      logApiError('SafetyTab.loadSummary', error);
      toast.error('Không tải được tổng quan an toàn', getApiErrorMessage(error));
    } finally {
      setLoadingSummary(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const loadIssues = useCallback(async () => {
    setLoadingView(true);
    try {
      const result = await safetyService.listIssues({ projectId, constructionSiteId, filters: issueFilters, page: 1, pageSize: 100 });
      setIssues(result.items);
      setIssueCount(result.count);
      setIssueHasNextPage(result.hasNextPage);
    } catch (error: any) {
      logApiError('SafetyTab.loadIssues', error);
      toast.error('Không tải được sự cố/nguy cơ', getApiErrorMessage(error));
    } finally {
      setLoadingView(false);
    }
  }, [constructionSiteId, issueFilters, projectId, toast]);

  const loadInspections = useCallback(async () => {
    setLoadingView(true);
    try {
      setInspections(await safetyService.listInspections(projectId, constructionSiteId));
    } catch (error: any) {
      logApiError('SafetyTab.loadInspections', error);
      toast.error('Không tải được checklist an toàn', getApiErrorMessage(error));
    } finally {
      setLoadingView(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const loadContractors = useCallback(async () => {
    setLoadingView(true);
    try {
      setContractors(await safetyService.listContractors(projectId, constructionSiteId));
    } catch (error: any) {
      logApiError('SafetyTab.loadContractors', error);
      toast.error('Không tải được nhà thầu phụ', getApiErrorMessage(error));
    } finally {
      setLoadingView(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const loadTeams = useCallback(async () => {
    setLoadingView(true);
    try {
      setTeams(await safetyService.listTeams(projectId, constructionSiteId));
    } catch (error: any) {
      logApiError('SafetyTab.loadTeams', error);
      toast.error('Không tải được tổ đội an toàn', getApiErrorMessage(error));
    } finally {
      setLoadingView(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const loadEquipment = useCallback(async () => {
    setLoadingView(true);
    try {
      setEquipment(await safetyService.listEquipment(projectId, constructionSiteId));
    } catch (error: any) {
      logApiError('SafetyTab.loadEquipment', error);
      toast.error('Không tải được thiết bị an toàn', getApiErrorMessage(error));
    } finally {
      setLoadingView(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const refreshCurrentView = useCallback(async () => {
    if (view === 'issues') await loadIssues();
    if (view === 'inspections') await loadInspections();
    if (view === 'contractors') await loadContractors();
    if (view === 'teams') await loadTeams();
    if (view === 'equipment') await loadEquipment();
  }, [loadContractors, loadEquipment, loadInspections, loadIssues, loadTeams, view]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void refreshCurrentView();
  }, [refreshCurrentView]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetView = params.get('safetyView') as SafetyView | null;
    const safetyId = params.get('safetyId');
    if (targetView && VIEW_CONFIG[targetView]) setView(targetView);
    if (safetyId && targetView === 'issues') {
      setView('issues');
      safetyService.listIssues({ projectId, constructionSiteId, filters: { status: 'all', severity: 'all', type: 'all' }, pageSize: 100 })
        .then(result => {
          setIssues(result.items);
          const found = result.items.find(item => item.id === safetyId);
          if (found) setSelectedIssue(found);
        })
        .catch(error => console.warn('Cannot deep-link safety issue', error));
    }
  }, [constructionSiteId, location.search, projectId]);

  const refreshAll = async () => {
    await Promise.all([loadSummary(), refreshCurrentView()]);
  };

  const openAction = (sourceType: string, id: string) => {
    if (sourceType === 'safety_issue') {
      setView('issues');
      const found = issues.find(item => item.id === id);
      if (found) setSelectedIssue(found);
      else void loadIssues();
      return;
    }
    if (sourceType === 'safety_equipment') setView('equipment');
    else if (sourceType === 'safety_subcontractor') setView('contractors');
    else if (sourceType === 'safety_inspection') setView('inspections');
  };

  const saveIssue = async (input: Partial<SafetyIssue> & { title: string; projectId: string; actorName?: string }) => {
    if (input.id) {
      const updated = await safetyService.updateIssue(input.id, input);
      setIssues(prev => prev.map(item => item.id === updated.id ? updated : item));
      if (selectedIssue?.id === updated.id) setSelectedIssue(updated);
      toast.success('Đã cập nhật ghi nhận an toàn');
    } else {
      const created = await safetyService.createIssue(input);
      setIssues(prev => [created, ...prev]);
      setIssueCount(prev => prev + 1);
      toast.success('Đã ghi nhận nguy cơ/sự cố');
    }
    await loadSummary();
  };

  const deleteIssue = async (issue: SafetyIssue) => {
    const ok = await confirm({
      title: 'Xóa ghi nhận an toàn',
      targetName: `${issue.code} - ${issue.title}`,
      warningText: 'Chỉ nên xóa ghi nhận mới tạo và chưa phát sinh xử lý.',
      actionLabel: 'Xóa ghi nhận',
      intent: 'danger',
    });
    if (!ok) return;
    try {
      await safetyService.removeDraftIssue(issue.id);
      setIssues(prev => prev.filter(item => item.id !== issue.id));
      setIssueCount(prev => Math.max(0, prev - 1));
      await loadSummary();
      toast.success('Đã xóa ghi nhận an toàn');
    } catch (error: any) {
      logApiError('SafetyTab.deleteIssue', error);
      toast.error('Không xóa được ghi nhận', getApiErrorMessage(error));
    }
  };

  const changeSelectedIssueStatus = async (status: SafetyIssueStatus) => {
    if (!selectedIssue) return;
    const updated = await safetyService.setIssueStatus(selectedIssue.id, status, user.id);
    setSelectedIssue(updated);
    setIssues(prev => prev.map(item => item.id === updated.id ? updated : item));
    await loadSummary();
    toast.success('Đã cập nhật trạng thái an toàn');
  };

  const saveInspection = async (input: any) => {
    try {
      if (input.id) {
        const updated = await safetyService.updateInspection(input.id, {
          inspectionDate: input.inspectionDate,
          area: input.area,
          summary: input.summary,
          attachments: input.attachments,
        });

        const oldItems = await safetyService.getInspectionItems(input.id);
        const oldItemsMap = new Map(oldItems.map(item => [item.id, item]));

        const newItems = input.items || [];

        for (const item of newItems) {
          if (item.id) {
            await safetyService.updateInspectionItem(item.id, item);
            oldItemsMap.delete(item.id);
          } else {
            const { error: insertErr } = await supabase.from('safety_inspection_items').insert({
              project_id: projectId,
              construction_site_id: constructionSiteId || null,
              inspection_id: input.id,
              item_name: item.itemName,
              requirement: item.requirement,
              risk_level: item.riskLevel,
              result: item.result || 'na',
              sort_order: item.sortOrder,
              created_by: user.id,
            });
            if (insertErr) throw insertErr;
          }
        }

        for (const remainingId of oldItemsMap.keys()) {
          const { error: delErr } = await supabase.from('safety_inspection_items').delete().eq('id', remainingId);
          if (delErr) throw delErr;
        }

        setInspections(prev => prev.map(item => item.id === updated.id ? updated : item));
        toast.success('Đã cập nhật checklist an toàn');
      } else {
        const result = await safetyService.createInspection(input);
        setInspections(prev => [result.inspection, ...prev]);
        toast.success('Đã tạo checklist an toàn');
      }
      await loadSummary();
    } catch (error: any) {
      logApiError('SafetyTab.saveInspection', error);
      toast.error('Không lưu được checklist', getApiErrorMessage(error));
    }
  };

  const deleteInspection = async (inspection: SafetyInspection) => {
    const ok = await confirm({
      title: 'Xóa checklist an toàn',
      targetName: inspection.code,
      warningText: 'Mọi tiêu chí và dữ liệu liên quan sẽ bị xóa vĩnh viễn. Bạn có chắc chắn?',
      actionLabel: 'Xóa',
      intent: 'danger',
    });
    if (!ok) return;
    try {
      await safetyService.deleteInspection(inspection.id);
      setInspections(prev => prev.filter(item => item.id !== inspection.id));
      await loadSummary();
      toast.success('Đã xóa checklist an toàn');
    } catch (error: any) {
      logApiError('SafetyTab.deleteInspection', error);
      toast.error('Không xóa được checklist', getApiErrorMessage(error));
    }
  };

  const updateInspectionItem = async (itemId: string, updates: Partial<SafetyInspectionItem>) => {
    await safetyService.updateInspectionItem(itemId, updates);
  };

  const completeInspection = async (inspection: SafetyInspection) => {
    const updated = await safetyService.completeInspection(inspection.id);
    setInspections(prev => prev.map(item => item.id === updated.id ? updated : item));
    await loadSummary();
    toast.success('Đã hoàn thành checklist');
  };

  const generateIssueFromItem = async (inspection: SafetyInspection, item: SafetyInspectionItem) => {
    const created = await safetyService.createIssueFromInspectionItem(inspection, item, user.id);
    setIssues(prev => [created, ...prev]);
    await Promise.all([loadInspections(), loadSummary()]);
    toast.success('Đã sinh issue từ tiêu chí không đạt');
  };

  const saveContractor = async (input: Partial<SafetySubcontractor> & { projectId: string; name: string }) => {
    const saved = await safetyService.upsertContractor(input);
    setContractors(prev => [saved, ...prev.filter(item => item.id !== saved.id)]);
    await loadSummary();
    toast.success('Đã lưu nhà thầu phụ');
  };

  const deleteContractor = async (contractor: SafetySubcontractor) => {
    const ok = await confirm({
      title: 'Xóa nhà thầu phụ',
      targetName: contractor.name,
      warningText: 'Bạn có chắc chắn muốn xóa nhà thầu này khỏi danh sách theo dõi an toàn?',
      actionLabel: 'Xóa',
      intent: 'danger',
    });
    if (!ok) return;
    try {
      await safetyService.deleteContractor(contractor.id);
      setContractors(prev => prev.filter(item => item.id !== contractor.id));
      toast.success('Đã xóa nhà thầu phụ');
    } catch (error: any) {
      logApiError('SafetyTab.deleteContractor', error);
      toast.error('Không xóa được nhà thầu phụ', getApiErrorMessage(error));
    }
  };

  const saveEquipment = async (input: Partial<SafetyEquipment> & { projectId: string; name: string }) => {
    const saved = await safetyService.upsertEquipment(input);
    setEquipment(prev => [saved, ...prev.filter(item => item.id !== saved.id)]);
    await loadSummary();
    toast.success('Đã lưu thiết bị');
  };

  const toggleEquipmentDocument = async (
    item: SafetyEquipment,
    document: SafetyEquipmentDocument,
    nextDone: boolean,
  ) => {
    try {
      const savedDocument = await safetyService.toggleEquipmentDocumentChecklistItem(document, nextDone, user.id);
      setEquipment(prev => prev.map(row => {
        if (row.id !== item.id) return row;
        const nextChecklist = (row.documentChecklist || []).map(entry => entry.id === savedDocument.id ? savedDocument : entry);
        return { ...row, documentsStatus: getSafetyEquipmentDocumentsStatus(nextChecklist), documentChecklist: nextChecklist };
      }));
      await loadSummary();
    } catch (error: any) {
      logApiError('SafetyTab.toggleEquipmentDocument', error);
      toast.error('Không cập nhật được checklist hồ sơ', getApiErrorMessage(error));
    }
  };

  const deleteEquipment = async (item: SafetyEquipment) => {
    const ok = await confirm({
      title: 'Xóa thiết bị',
      targetName: item.name,
      warningText: 'Bạn có chắc chắn muốn xóa thiết bị này khỏi danh sách an toàn?',
      actionLabel: 'Xóa',
      intent: 'danger',
    });
    if (!ok) return;
    try {
      await safetyService.deleteEquipment(item.id);
      setEquipment(prev => prev.filter(row => row.id !== item.id));
      toast.success('Đã xóa thiết bị');
    } catch (error: any) {
      logApiError('SafetyTab.deleteEquipment', error);
      toast.error('Không xóa được thiết bị', getApiErrorMessage(error));
    }
  };

  const saveTeam = async (input: Partial<SafetyTeam> & { projectId: string; name: string }) => {
    const saved = await safetyService.upsertTeam(input);
    setTeams(prev => [saved, ...prev.filter(item => item.id !== saved.id)]);
    toast.success('Đã lưu tổ đội an toàn');
  };

  const deleteTeam = async (team: SafetyTeam) => {
    const ok = await confirm({
      title: 'Xóa tổ đội',
      targetName: team.name,
      warningText: 'Bạn có chắc chắn muốn xóa tổ đội này khỏi danh sách theo dõi an toàn?',
      actionLabel: 'Xóa',
      intent: 'danger',
    });
    if (!ok) return;
    try {
      await safetyService.deleteTeam(team.id);
      setTeams(prev => prev.filter(item => item.id !== team.id));
      toast.success('Đã xóa tổ đội thành công');
    } catch (error: any) {
      logApiError('SafetyTab.deleteTeam', error);
      toast.error('Không xóa được tổ đội', getApiErrorMessage(error));
    }
  };

  const primaryAction = !canManageTab ? undefined : view === 'issues'
    ? { label: 'Ghi nhận nguy cơ', icon: <Plus size={15} />, onClick: () => { setEditingIssue(null); setShowIssueForm(true); } }
    : view === 'inspections'
      ? { label: 'Kiểm tra checklist', icon: <Plus size={15} />, onClick: () => { setEditingInspection(null); setShowInspectionForm(true); } }
      : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Dự án / An toàn"
        title="An toàn công trường"
        description="Theo dõi Safety Passport nhân công, nguy cơ, checklist hiện trường, nhà thầu phụ và thiết bị vào công trường."
        meta={
          <>
            <StatusBadge status="score" label={`Score ${summary?.safetyScore ?? '-'}`} tone={(summary?.safetyScore || 0) >= 80 ? 'success' : 'warning'} size="md" />
            <StatusBadge status="issues" label={`${summary?.openIssues || 0} issue mở`} tone={(summary?.openIssues || 0) > 0 ? 'attention' : 'success'} size="md" />
            <StatusBadge status="critical" label={`${summary?.criticalIssues || 0} nghiêm trọng`} tone={(summary?.criticalIssues || 0) > 0 ? 'danger' : 'neutral'} size="md" />
          </>
        }
        primaryAction={primaryAction}
        secondaryActions={[{
          label: 'Làm mới',
          icon: <RefreshCw size={15} />,
          onClick: refreshAll,
        }]}
      />

      <ActionBar
        stickyOnMobile
      >
        <div className="space-y-2">
          {VIEW_GROUPS.map(group => (
            <div key={group.label} className="flex flex-wrap items-center gap-2">
              <div className="w-full text-[10px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500 sm:w-28">
                {group.label}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {group.views.map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-black transition ${
                      view === key
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {VIEW_CONFIG[key].icon} {VIEW_CONFIG[key].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ActionBar>

      {view === 'overview' && (
        <SafetyOverview
          summary={summary}
          loading={loadingSummary}
          onOpenView={setView}
          onOpenAction={openAction}
        />
      )}

      {view === 'issues' && (
        <SafetyIssueList
          issues={issues}
          loading={loadingView}
          filters={issueFilters}
          onFiltersChange={setIssueFilters}
          onCreate={() => { setEditingIssue(null); setShowIssueForm(true); }}
          onOpen={setSelectedIssue}
          onEdit={issue => { setEditingIssue(issue); setShowIssueForm(true); }}
          onDelete={deleteIssue}
          canManage={canManageTab}
        />
      )}

      {view === 'passport' && (
        <SafetyPassportPanel
          mode="passport"
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={user}
          canManage={canManageTab}
        />
      )}

      {view === 'passportContractors' && (
        <SafetyPassportPanel
          mode="passportContractors"
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={user}
          canManage={canManageTab}
        />
      )}

      {view === 'passportWorkers' && (
        <SafetyPassportPanel
          mode="passportWorkers"
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={user}
          canManage={canManageTab}
        />
      )}

      {view === 'passportAssignments' && (
        <SafetyPassportPanel
          mode="passportAssignments"
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={user}
          canManage={canManageTab}
        />
      )}

      {view === 'passportCards' && (
        <SafetyPassportPanel
          mode="passportCards"
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={user}
          canManage={canManageTab}
        />
      )}

      {view === 'inspections' && (
        <SafetyInspectionList
          inspections={inspections}
          loading={loadingView}
          getItems={safetyService.getInspectionItems}
          onUpdateItem={updateInspectionItem}
          onComplete={completeInspection}
          onGenerateIssue={generateIssueFromItem}
          onEdit={inspection => { setEditingInspection(inspection); setShowInspectionForm(true); }}
          onDelete={deleteInspection}
          onPreviewAttachment={openAttachmentPreview}
          onCreate={() => { setEditingInspection(null); setShowInspectionForm(true); }}
          canManage={canManageTab}
        />
      )}

      {view === 'contractors' && (
        <SafetyContractorPanel
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          contractors={contractors}
          currentUser={user}
          canManage={canManageTab}
          loading={loadingView}
          onSave={saveContractor}
          onDelete={deleteContractor}
          onPreviewAttachment={openAttachmentPreview}
        />
      )}

      {view === 'teams' && (
        <SafetyTeamPanel
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          teams={teams}
          currentUser={user}
          canManage={canManageTab}
          loading={loadingView}
          onSave={saveTeam}
          onDelete={deleteTeam}
          onPreviewAttachment={openAttachmentPreview}
        />
      )}

      {view === 'equipment' && (
        <SafetyEquipmentPanel
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          equipment={equipment}
          currentUser={user}
          canManage={canManageTab}
          loading={loadingView}
          onSave={saveEquipment}
          onToggleDocument={toggleEquipmentDocument}
          onDelete={deleteEquipment}
          onPreviewAttachment={openAttachmentPreview}
        />
      )}

      {showIssueForm && (
        <SafetyIssueFormModal
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          issue={editingIssue}
          users={availableUsers}
          currentUser={user}
          onClose={() => { setShowIssueForm(false); setEditingIssue(null); }}
          onSave={saveIssue}
        />
      )}

      {selectedIssue && (
        <SafetyIssueDetailModal
          issue={selectedIssue}
          currentUser={user}
          canManage={canManageTab}
          onClose={() => setSelectedIssue(null)}
          onStatusChange={changeSelectedIssueStatus}
          onChanged={refreshAll}
        />
      )}

      {showInspectionForm && (
        <SafetyInspectionFormModal
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          currentUser={user}
          inspection={editingInspection}
          onPreviewAttachment={openAttachmentPreview}
          onClose={() => { setShowInspectionForm(false); setEditingInspection(null); }}
          onSave={saveInspection}
        />
      )}

      {issueCount > issues.length && view === 'issues' && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-xs font-bold text-slate-500">
          Đang hiển thị {issues.length}/{issueHasNextPage ? `${issueCount}+` : issueCount} ghi nhận mới nhất.
        </div>
      )}

      {previewAttachments && (
        <SafetyAttachmentPreviewModal
          attachments={previewAttachments}
          currentIndex={previewIndex}
          onClose={() => setPreviewAttachments(null)}
          onIndexChange={setPreviewIndex}
        />
      )}
    </div>
  );
};

export default SafetyTab;
