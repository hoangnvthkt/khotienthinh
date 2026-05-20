import React, { Suspense, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
    Project,
    ProjectFinance,
    ProjectTransaction,
    ProjectCostCategory,
    ProjectTxType,
    ProjectTxSource,
    Attachment,
    ProjectProgressCalculationMode,
    ProjectGroup,
    ProjectTypeMaster,
    ProjectSector,
    ProjectMasterCategory,
    WorkGroupWithMembers,
    ProjectDeleteImpact,
} from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { loadXlsx } from '../lib/loadXlsx';
import ExcelImportReviewModal from '../components/ExcelImportReviewModal';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, getExcelCell, parseExcelRows } from '../lib/excelImport';
import { useModuleData } from '../hooks/useModuleData';
import { useWorkflow } from '../context/WorkflowContext';
import { useToast } from '../context/ToastContext';
import { usePermission } from '../hooks/usePermission';
import { taskService } from '../lib/projectService';
import { calculateProjectProgress } from '../lib/projectScheduleRules';
import { projectMasterService } from '../lib/projectMasterService';
import { projectMasterDataService } from '../lib/projectMasterDataService';
import { projectPermissionTypeService, projectStaffService } from '../lib/projectStaffService';
import { workGroupService } from '../lib/workGroupService';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import {
    BarChart3, TrendingUp, TrendingDown, DollarSign, Target, Percent,
    Plus, Edit2, Trash2, X, Check, Save, ChevronDown, FileText,
    Building2, HardHat, AlertCircle, ArrowUpRight, ArrowDownRight,
    Upload, Download, Filter, Calendar, Tag, List, Paperclip, Eye, Image,
    Users, UserPlus, Loader2, RefreshCcw, Search, EyeOff, ArchiveRestore
} from 'lucide-react';

const CashFlowTab = React.lazy(() => import('./project/CashFlowTab'));
const ContractTab = React.lazy(() => import('./project/ContractTab'));
const GanttTab = React.lazy(() => import('./project/GanttTab'));
const DailyLogTab = React.lazy(() => import('./project/DailyLogTab'));
const SubcontractTab = React.lazy(() => import('./project/SubcontractTab'));
const MaterialTab = React.lazy(() => import('./project/MaterialTab'));
const SupplyChainTab = React.lazy(() => import('./project/SupplyChainTab'));
const ReportTab = React.lazy(() => import('./project/ReportTab'));
const DocumentsTab = React.lazy(() => import('./project/DocumentsTab'));
const ProjectOrgTab = React.lazy(() => import('./project/ProjectOrgTab'));

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    planning: { label: 'Lập kế hoạch', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    active: { label: 'Đang thi công', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    paused: { label: 'Tạm dừng', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    completed: { label: 'Hoàn thành', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200' },
    cancelled: { label: 'Đã huỷ', color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' },
};

const CATEGORY_CONFIG: Record<ProjectCostCategory, { label: string; icon: string; color: string }> = {
    materials: { label: 'Vật tư', icon: '🧱', color: '#f97316' },
    labor: { label: 'Nhân công', icon: '👷', color: '#0ea5e9' },
    subcontract: { label: 'Thầu phụ', icon: '🏗️', color: '#8b5cf6' },
    machinery: { label: 'Máy móc', icon: '⚙️', color: '#10b981' },
    overhead: { label: 'Quản lý chung', icon: '📋', color: '#6366f1' },
    other: { label: 'Phát sinh khác', icon: '📦', color: '#ec4899' },
};

const TX_TYPE_CONFIG: Record<ProjectTxType, { label: string; color: string }> = {
    expense: { label: 'Chi phí', color: 'text-red-600' },
    revenue_received: { label: 'Thu (đã TT)', color: 'text-emerald-600' },
    revenue_pending: { label: 'Thu (chờ NT)', color: 'text-amber-600' },
};

const SOURCE_CONFIG: Record<ProjectTxSource, { label: string; icon: string }> = {
    manual: { label: 'Thủ công', icon: '✍️' },
    import: { label: 'Import', icon: '📊' },
    workflow: { label: 'Workflow', icon: '🔄' },
};

const PROGRESS_MODE_OPTIONS: { value: ProjectProgressCalculationMode; label: string }[] = [
    { value: 'gantt_weighted', label: 'Theo Gantt có trọng số' },
    { value: 'budget', label: 'Theo ngân sách công việc' },
    { value: 'duration', label: 'Theo thời gian thực hiện' },
    { value: 'task_count', label: 'Theo số lượng công việc hoàn thành' },
    { value: 'manual', label: 'Nhập thủ công' },
];

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return n.toLocaleString('vi-VN');
};
const fmtFull = (n: number) => n.toLocaleString('vi-VN') + ' đ';

const emptyFinance = (siteId: string): ProjectFinance => ({
    id: crypto.randomUUID(),
    constructionSiteId: siteId,
    contractValue: 0,
    budgetMaterials: 0, budgetLabor: 0, budgetSubcontract: 0, budgetMachinery: 0, budgetOverhead: 0,
    actualMaterials: 0, actualLabor: 0, actualSubcontract: 0, actualMachinery: 0, actualOverhead: 0,
    revenueReceived: 0, revenuePending: 0,
    progressPercent: 0, status: 'planning',
    updatedAt: new Date().toISOString(),
});

type ProjectFormState = {
    name: string;
    code: string;
    projectGroupId: string;
    projectTypeId: string;
    projectSectorId: string;
    workflowTemplateId: string;
    clientName: string;
    constructionSiteId: string;
    managerId: string;
    adminUserIds: string[];
    adminGroupIds: string[];
    executorUserIds: string[];
    executorGroupIds: string[];
    watcherUserIds: string[];
    watcherGroupIds: string[];
    defaultPositionId: string;
    status: Project['status'];
    startDate: string;
    endDate: string;
    progressCalculationMode: ProjectProgressCalculationMode;
    manualProgressPercent: string;
    description: string;
};

type ProjectImportRecord = Project & {
    adminImportUsers?: string;
    executorImportUsers?: string;
    watcherImportUsers?: string;
    defaultPositionImportId?: string;
};

type ProjectHiddenFilter = 'active' | 'hidden' | 'all';
type ProjectSiteFilter = 'all' | 'linked' | 'unlinked';
type ProjectSortKey = 'updatedAt' | 'code' | 'name' | 'startDate' | 'contractValue' | 'actualCost' | 'profit' | 'progress';

type ProjectFilterState = {
    query: string;
    status: Project['status'] | 'all';
    groupId: string;
    typeId: string;
    sectorId: string;
    workflowId: string;
    siteLink: ProjectSiteFilter;
    startFrom: string;
    startTo: string;
    endFrom: string;
    endTo: string;
    hidden: ProjectHiddenFilter;
};

const emptyProjectFilters = (): ProjectFilterState => ({
    query: '',
    status: 'all',
    groupId: 'all',
    typeId: 'all',
    sectorId: 'all',
    workflowId: 'all',
    siteLink: 'all',
    startFrom: '',
    startTo: '',
    endFrom: '',
    endTo: '',
    hidden: 'active',
});

const emptyProjectForm = (): ProjectFormState => ({
    name: '',
    code: '',
    projectGroupId: '',
    projectTypeId: '',
    projectSectorId: '',
    workflowTemplateId: '',
    clientName: '',
    constructionSiteId: '',
    managerId: '',
    adminUserIds: [],
    adminGroupIds: [],
    executorUserIds: [],
    executorGroupIds: [],
    watcherUserIds: [],
    watcherGroupIds: [],
    defaultPositionId: '',
    status: 'planning',
    startDate: '',
    endDate: '',
    progressCalculationMode: 'gantt_weighted',
    manualProgressPercent: '0',
    description: '',
});

const normalizeLookup = (value: unknown): string =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

const findByNameCodeId = <T extends { id: string; code?: string; name?: string }>(items: T[], value: unknown): T | undefined => {
    const key = normalizeLookup(value);
    if (!key) return undefined;
    return items.find(item => [item.id, item.code, item.name].some(candidate => normalizeLookup(candidate) === key));
};

const parseProjectDate = (value: unknown): string | undefined => {
    if (!value) return undefined;
    if (typeof value === 'number') {
        const date = new Date((value - 25569) * 86400 * 1000);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return undefined;
    const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const ymd = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString().slice(0, 10);
};

const parseProjectNumber = (value: unknown): number => {
    if (typeof value === 'number') return value;
    const cleaned = String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    return Number(cleaned) || 0;
};

const STATUS_IMPORT_ALIASES: Record<string, Project['status']> = {
    planning: 'planning',
    'lap ke hoach': 'planning',
    active: 'active',
    'dang thi cong': 'active',
    paused: 'paused',
    'tam dung': 'paused',
    completed: 'completed',
    'hoan thanh': 'completed',
    cancelled: 'cancelled',
    'da huy': 'cancelled',
};

const normalizeProjectStatus = (value: unknown): Project['status'] => {
    const raw = normalizeLookup(value);
    return STATUS_IMPORT_ALIASES[raw] || 'planning';
};

const PROGRESS_IMPORT_ALIASES: Record<string, ProjectProgressCalculationMode> = {
    gantt_weighted: 'gantt_weighted',
    gantt: 'gantt_weighted',
    'theo gantt co trong so': 'gantt_weighted',
    budget: 'budget',
    'theo ngan sach cong viec': 'budget',
    duration: 'duration',
    'theo thoi gian thuc hien': 'duration',
    task_count: 'task_count',
    'theo so luong cong viec hoan thanh': 'task_count',
    manual: 'manual',
    'nhap thu cong': 'manual',
};

const normalizeProgressMode = (value: unknown): ProjectProgressCalculationMode => {
    const raw = normalizeLookup(value);
    return PROGRESS_IMPORT_ALIASES[raw] || 'gantt_weighted';
};

const siteToProjectFallback = (site: { id: string; name: string; address?: string; description?: string; managerId?: string; createdAt?: string }): Project => ({
    id: site.id,
    code: `PRJ-${site.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    name: site.name,
    description: site.address || site.description,
    projectType: 'construction',
    status: 'active',
    constructionSiteId: site.id,
    managerId: site.managerId,
    progressCalculationMode: 'gantt_weighted',
    manualProgressPercent: 0,
    source: 'backfill',
    createdAt: site.createdAt,
});

const ProjectDashboard: React.FC = () => {
    const location = useLocation();
    const {
        hrmConstructionSites, projectFinances, addProjectFinance, updateProjectFinance, removeProjectFinance,
        projectTransactions, addProjectTransaction, addProjectTransactions, updateProjectTransaction, removeProjectTransaction,
        user, users, employees, hrmPositions
    } = useApp();
    const toast = useToast();
    const { canManage, isAdmin } = usePermission();
    const canManageProjects = canManage('/da');
    const { templates: workflowTemplates } = useWorkflow();
    useModuleData('da');

    const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<'list' | 'overview'>('list');
    const [overviewTab, setOverviewTab] = useState<'org' | 'budget' | 'cashflow' | 'contract' | 'gantt' | 'dailylog' | 'subcontract' | 'material' | 'supply' | 'report' | 'documents'>('org');
    const [showBudgetForm, setShowBudgetForm] = useState(false);
    const [showTxForm, setShowTxForm] = useState(false);
    const [budgetData, setBudgetData] = useState<ProjectFinance | null>(null);
    const [txFilter, setTxFilter] = useState<ProjectCostCategory | 'all'>('all');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const projectImportInputRef = useRef<HTMLInputElement>(null);
    const projectImportModeRef = useRef<ExcelImportMode>('create');
    // TX form state
    const [txType, setTxType] = useState<ProjectTxType>('expense');
    const [txCategory, setTxCategory] = useState<ProjectCostCategory>('materials');
    const [txAmount, setTxAmount] = useState('');
    const [txDesc, setTxDesc] = useState('');
    const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
    const [txFiles, setTxFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [editingTx, setEditingTx] = useState<ProjectTransaction | null>(null);
    const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
    const [taskProgressBySite, setTaskProgressBySite] = useState<Record<string, { progressPercent: number; leafTaskCount: number }>>({});
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
    const [projectFilters, setProjectFilters] = useState<ProjectFilterState>(emptyProjectFilters);
    const [projectSort, setProjectSort] = useState<ProjectSortKey>('updatedAt');
    const [projectSortAsc, setProjectSortAsc] = useState(false);
    const [showProjectAdvancedFilters, setShowProjectAdvancedFilters] = useState(false);
    const [projectImportMode, setProjectImportMode] = useState<ExcelImportMode>('create');
    const [projectImportPreview, setProjectImportPreview] = useState<ExcelImportPreview<ProjectImportRecord> | null>(null);
    const [projectImporting, setProjectImporting] = useState(false);
    const [projectExporting, setProjectExporting] = useState(false);
    const [hideProjectTarget, setHideProjectTarget] = useState<Project | null>(null);
    const [hideProjectImpact, setHideProjectImpact] = useState<ProjectDeleteImpact | null>(null);
    const [hideProjectImpactLoading, setHideProjectImpactLoading] = useState(false);
    const [hideProjectReason, setHideProjectReason] = useState('');
    const [hideProjectCodeConfirm, setHideProjectCodeConfirm] = useState('');
    const [hidingProject, setHidingProject] = useState(false);
    const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null);
    const [deleteTxConfirmId, setDeleteTxConfirmId] = useState<string | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [showProjectForm, setShowProjectForm] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [savingProject, setSavingProject] = useState(false);
    const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
    const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
    const [projectTypes, setProjectTypes] = useState<ProjectTypeMaster[]>([]);
    const [projectSectors, setProjectSectors] = useState<ProjectSector[]>([]);
    const [projectMasterDataLoading, setProjectMasterDataLoading] = useState(false);
    const [workGroups, setWorkGroups] = useState<WorkGroupWithMembers[]>([]);
    const [workGroupsLoading, setWorkGroupsLoading] = useState(false);
    const [showProjectAdvanced, setShowProjectAdvanced] = useState(false);
    const [quickCategoryKind, setQuickCategoryKind] = useState<'group' | 'type' | 'sector' | null>(null);
    const [quickCategoryForm, setQuickCategoryForm] = useState({ code: '', name: '', description: '' });

    const loadProjects = useCallback(async () => {
        setProjectsLoading(true);
        try {
            const data = await projectMasterService.list({ includeHidden: true });
            setProjects(data);
            setProjectLoadError(null);
        } catch (err) {
            logApiError('ProjectDashboard.loadProjects', err);
            setProjects([]);
            setProjectLoadError(getApiErrorMessage(err, 'Không tải được danh sách dự án'));
        } finally {
            setProjectsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    const loadProjectMasterData = async () => {
        setProjectMasterDataLoading(true);
        try {
            const [groups, types, sectors] = await Promise.all([
                projectMasterDataService.listGroups(),
                projectMasterDataService.listTypes(),
                projectMasterDataService.listSectors(),
            ]);
            setProjectGroups(groups);
            setProjectTypes(types);
            setProjectSectors(sectors);
        } catch (err: any) {
            logApiError('ProjectDashboard.loadProjectMasterData', err);
            toast.error('Không thể tải danh mục dự án', getApiErrorMessage(err, 'Không thể tải nhóm, loại hoặc lĩnh vực dự án.'));
        } finally {
            setProjectMasterDataLoading(false);
        }
    };

    useEffect(() => {
        loadProjectMasterData();
    }, []);

    const loadWorkGroups = async () => {
        setWorkGroupsLoading(true);
        try {
            const groups = await workGroupService.listGroupsWithMembers({ activeOnly: false, memberActiveOnly: false });
            setWorkGroups(groups);
        } catch (err: any) {
            logApiError('ProjectDashboard.loadWorkGroups', err);
            toast.error('Không thể tải nhóm làm việc', getApiErrorMessage(err, 'Không thể tải nhóm làm việc để phân quyền dự án.'));
        } finally {
            setWorkGroupsLoading(false);
        }
    };

    useEffect(() => {
        loadWorkGroups();
    }, []);

    const projectRows = useMemo(() => {
        if (projects.length > 0) return projects;
        return hrmConstructionSites.map(siteToProjectFallback);
    }, [projects, hrmConstructionSites]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab') as typeof overviewTab | null;
        const projectIdParam = params.get('projectId');
        const siteIdParam = params.get('siteId') || params.get('constructionSiteId');
        const validTabs = new Set(['org', 'budget', 'cashflow', 'contract', 'gantt', 'dailylog', 'subcontract', 'material', 'supply', 'report', 'documents']);
        if (!projectIdParam && !siteIdParam && (!tab || !validTabs.has(tab))) return;

        const targetProject = projectIdParam
            ? projectRows.find(project => project.id === projectIdParam)
            : siteIdParam
                ? projectRows.find(project => project.constructionSiteId === siteIdParam || project.id === siteIdParam)
                : null;

        if (targetProject) {
            setSelectedProjectId(targetProject.id);
            setSelectedSiteId(targetProject.constructionSiteId || siteIdParam || null);
        } else if (siteIdParam) {
            setSelectedSiteId(siteIdParam);
        }

        if (tab && validTabs.has(tab)) setOverviewTab(tab);
        setActiveView('overview');
    }, [location.search, projectRows]);

    const selectedProject = useMemo(
        () => projectRows.find(project => project.id === selectedProjectId) || null,
        [projectRows, selectedProjectId]
    );
    const projectGroupMap = useMemo(() => new Map(projectGroups.map(item => [item.id, item])), [projectGroups]);
    const projectTypeMap = useMemo(() => new Map(projectTypes.map(item => [item.id, item])), [projectTypes]);
    const projectSectorMap = useMemo(() => new Map(projectSectors.map(item => [item.id, item])), [projectSectors]);
    const workflowTemplateMap = useMemo(() => new Map(workflowTemplates.map(item => [item.id, item])), [workflowTemplates]);
    const workGroupMap = useMemo(() => new Map(workGroups.map(item => [item.id, item])), [workGroups]);
    const activeProjectGroups = useMemo(() => projectGroups.filter(item => item.isActive || item.id === projectForm.projectGroupId), [projectGroups, projectForm.projectGroupId]);
    const activeProjectTypes = useMemo(() => projectTypes.filter(item => item.isActive || item.id === projectForm.projectTypeId), [projectTypes, projectForm.projectTypeId]);
    const activeProjectSectors = useMemo(() => projectSectors.filter(item => item.isActive || item.id === projectForm.projectSectorId), [projectSectors, projectForm.projectSectorId]);
    const activeWorkflowTemplates = useMemo(() => workflowTemplates.filter(template => template.isActive || template.id === projectForm.workflowTemplateId), [workflowTemplates, projectForm.workflowTemplateId]);

    const effectiveSiteId = selectedProject?.constructionSiteId || selectedSiteId || null;
    const selectedSite = effectiveSiteId ? hrmConstructionSites.find(s => s.id === effectiveSiteId) || null : null;
    const selectedFinance = useMemo(() =>
        effectiveSiteId ? projectFinances.find(pf => pf.constructionSiteId === effectiveSiteId) || null : null,
        [effectiveSiteId, projectFinances]
    );

    // === AUTO-AGGREGATE from transactions ===
    const getAggregated = (siteId: string) => {
        const txs = projectTransactions.filter(t => t.constructionSiteId === siteId);
        const sumExpense = (cat: ProjectCostCategory) => txs.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.amount, 0);
        return {
            actualMaterials: sumExpense('materials'),
            actualLabor: sumExpense('labor'),
            actualSubcontract: sumExpense('subcontract'),
            actualMachinery: sumExpense('machinery'),
            actualOverhead: sumExpense('overhead'),
            actualOther: sumExpense('other'),
            revenueReceived: txs.filter(t => t.type === 'revenue_received').reduce((s, t) => s + t.amount, 0),
            revenuePending: txs.filter(t => t.type === 'revenue_pending').reduce((s, t) => s + t.amount, 0),
            totalExpense: txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
            txCount: txs.length,
        };
    };

    const getDisplayProgress = (finance?: ProjectFinance | null) => {
        if (!finance) return 0;
        return taskProgressBySite[finance.constructionSiteId]?.progressPercent ?? finance.progressPercent;
    };

    const getProjectSite = (project: Project) =>
        project.constructionSiteId ? hrmConstructionSites.find(site => site.id === project.constructionSiteId) || null : null;

    const getProjectFinance = (project: Project) => {
        const site = getProjectSite(project);
        return projectFinances.find(finance =>
            (project.id && finance.projectId === project.id) ||
            (site && finance.constructionSiteId === site.id)
        ) || null;
    };

    const getProjectAggregated = (project: Project) => {
        const site = getProjectSite(project);
        const txs = projectTransactions.filter(tx =>
            (project.id && tx.projectId === project.id) ||
            (site && tx.constructionSiteId === site.id)
        );
        return {
            totalExpense: txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
            totalRevenue: txs.filter(t => t.type === 'revenue_received').reduce((s, t) => s + t.amount, 0),
            txCount: txs.length,
        };
    };

    const getProjectListMetrics = (project: Project) => {
        const finance = getProjectFinance(project);
        const site = getProjectSite(project);
        const agg = getProjectAggregated(project);
        const progress = finance ? getDisplayProgress(finance) : (project.progressCalculationMode === 'manual' ? Number(project.manualProgressPercent || 0) : 0);
        const contractValue = finance?.contractValue || 0;
        return {
            site,
            finance,
            actualCost: agg.totalExpense,
            totalRevenue: agg.totalRevenue,
            txCount: agg.txCount,
            contractValue,
            profit: contractValue - agg.totalExpense,
            progress,
        };
    };

    useEffect(() => {
        if (!isAdmin && projectFilters.hidden !== 'active') {
            setProjectFilters(prev => ({ ...prev, hidden: 'active' }));
        }
    }, [isAdmin, projectFilters.hidden]);

    const projectAdvancedFilterCount = useMemo(() => {
        let count = 0;
        if (projectFilters.status !== 'all') count += 1;
        if (projectFilters.groupId !== 'all') count += 1;
        if (projectFilters.typeId !== 'all') count += 1;
        if (projectFilters.sectorId !== 'all') count += 1;
        if (projectFilters.workflowId !== 'all') count += 1;
        if (projectFilters.siteLink !== 'all') count += 1;
        if (projectFilters.startFrom) count += 1;
        if (projectFilters.startTo) count += 1;
        if (projectFilters.endFrom) count += 1;
        if (projectFilters.endTo) count += 1;
        if (isAdmin && projectFilters.hidden !== 'active') count += 1;
        if (projectSort !== 'updatedAt') count += 1;
        if (projectSortAsc) count += 1;
        return count;
    }, [isAdmin, projectFilters, projectSort, projectSortAsc]);

    const filteredProjectRows = useMemo(() => {
        const keyword = normalizeLookup(projectFilters.query);
        let rows = projectRows.filter(project => {
            const metrics = getProjectListMetrics(project);
            const haystack = [
                project.code,
                project.name,
                project.clientName,
                project.description,
                metrics.site?.name,
            ].map(normalizeLookup).join(' ');

            if (!isAdmin && project.isHidden) return false;
            if (isAdmin && projectFilters.hidden === 'active' && project.isHidden) return false;
            if (isAdmin && projectFilters.hidden === 'hidden' && !project.isHidden) return false;
            if (keyword && !haystack.includes(keyword)) return false;
            if (projectFilters.status !== 'all' && project.status !== projectFilters.status) return false;
            if (projectFilters.groupId !== 'all' && project.projectGroupId !== projectFilters.groupId) return false;
            if (projectFilters.typeId !== 'all' && project.projectTypeId !== projectFilters.typeId) return false;
            if (projectFilters.sectorId !== 'all' && project.projectSectorId !== projectFilters.sectorId) return false;
            if (projectFilters.workflowId !== 'all' && project.workflowTemplateId !== projectFilters.workflowId) return false;
            if (projectFilters.siteLink === 'linked' && !project.constructionSiteId) return false;
            if (projectFilters.siteLink === 'unlinked' && project.constructionSiteId) return false;
            if (projectFilters.startFrom && (!project.startDate || project.startDate < projectFilters.startFrom)) return false;
            if (projectFilters.startTo && (!project.startDate || project.startDate > projectFilters.startTo)) return false;
            if (projectFilters.endFrom && (!project.endDate || project.endDate < projectFilters.endFrom)) return false;
            if (projectFilters.endTo && (!project.endDate || project.endDate > projectFilters.endTo)) return false;
            return true;
        });

        rows = [...rows].sort((a, b) => {
            const aMetrics = getProjectListMetrics(a);
            const bMetrics = getProjectListMetrics(b);
            const getSortValue = (project: Project, metrics: ReturnType<typeof getProjectListMetrics>) => {
                switch (projectSort) {
                    case 'code': return project.code || '';
                    case 'name': return project.name || '';
                    case 'startDate': return project.startDate || '';
                    case 'contractValue': return metrics.contractValue;
                    case 'actualCost': return metrics.actualCost;
                    case 'profit': return metrics.profit;
                    case 'progress': return metrics.progress;
                    case 'updatedAt':
                    default: return project.updatedAt || project.createdAt || '';
                }
            };
            const aValue = getSortValue(a, aMetrics);
            const bValue = getSortValue(b, bMetrics);
            const result = typeof aValue === 'number' && typeof bValue === 'number'
                ? aValue - bValue
                : String(aValue).localeCompare(String(bValue), 'vi');
            return projectSortAsc ? result : -result;
        });

        return rows;
    }, [projectRows, projectFilters, projectSort, projectSortAsc, projectFinances, projectTransactions, hrmConstructionSites, isAdmin, taskProgressBySite]);

    const selectedAgg = effectiveSiteId ? getAggregated(effectiveSiteId) : null;
    const siteTxs = useMemo(() => {
        if (!effectiveSiteId) return [];
        let txs = projectTransactions.filter(t => t.constructionSiteId === effectiveSiteId);
        if (txFilter !== 'all') txs = txs.filter(t => t.category === txFilter);
        return txs.sort((a, b) => b.date.localeCompare(a.date));
    }, [effectiveSiteId, projectTransactions, txFilter]);

    const employeeByUserId = useMemo(() => {
        const map = new Map<string, typeof employees[number]>();
        employees.forEach(employee => {
            if (employee.userId) map.set(employee.userId, employee);
        });
        return map;
    }, [employees]);

    const activeUsers = useMemo(() => users.filter(u => u.isActive !== false), [users]);
    const activeUserIdSet = useMemo(() => new Set(activeUsers.map(u => u.id)), [activeUsers]);
    const selectedWorkGroupIds = useMemo(() => new Set([
        ...projectForm.adminGroupIds,
        ...projectForm.executorGroupIds,
        ...projectForm.watcherGroupIds,
    ]), [projectForm.adminGroupIds, projectForm.executorGroupIds, projectForm.watcherGroupIds]);
    const activeWorkGroups = useMemo(
        () => workGroups.filter(group => group.isActive || selectedWorkGroupIds.has(group.id)),
        [workGroups, selectedWorkGroupIds]
    );
    const sortedPositions = useMemo(() => [...hrmPositions].sort((a, b) => (a.level || 99) - (b.level || 99)), [hrmPositions]);

    const expandParticipantUserIds = (manualUserIds: string[], groupIds: string[]): string[] => {
        const userIds = new Set(manualUserIds.filter(Boolean));
        groupIds.forEach(groupId => {
            const group = workGroupMap.get(groupId);
            group?.members
                .filter(member => member.isActive && activeUserIdSet.has(member.userId))
                .forEach(member => userIds.add(member.userId));
        });
        return [...userIds];
    };

    const getAllProjectParticipantUserIds = (): string[] => [
        ...new Set([
            ...expandParticipantUserIds(projectForm.adminUserIds, projectForm.adminGroupIds),
            ...expandParticipantUserIds(projectForm.executorUserIds, projectForm.executorGroupIds),
            ...expandParticipantUserIds(projectForm.watcherUserIds, projectForm.watcherGroupIds),
        ]),
    ];

    const financeSiteKey = useMemo(() =>
        projectFinances.map(p => `${p.constructionSiteId}:${p.progressPercent}`).sort().join('|'),
        [projectFinances]
    );

    useEffect(() => {
        if (!isSupabaseConfigured) {
            setTaskProgressBySite({});
            return;
        }
        const siteIds = Array.from(new Set(projectFinances.map(p => p.constructionSiteId).filter(Boolean)));
        if (siteIds.length === 0) {
            setTaskProgressBySite({});
            return;
        }

        let cancelled = false;
        taskService.listBySites(siteIds)
            .then(allTasks => {
                if (cancelled) return;
                const next: Record<string, { progressPercent: number; leafTaskCount: number }> = {};
                for (const siteId of siteIds) {
                    const summary = calculateProjectProgress(allTasks.filter(task => task.constructionSiteId === siteId));
                    if (summary.leafTaskCount > 0) {
                        next[siteId] = {
                            progressPercent: summary.progressPercent,
                            leafTaskCount: summary.leafTaskCount,
                        };
                    }
                }
                setTaskProgressBySite(next);
            })
            .catch(console.error);

        return () => { cancelled = true; };
    }, [financeSiteKey, projectFinances]);

    const getProjectMetaChips = (project: Project): { label: string; tone: string }[] => {
        const group = project.projectGroupId ? projectGroupMap.get(project.projectGroupId) : undefined;
        const type = project.projectTypeId ? projectTypeMap.get(project.projectTypeId) : undefined;
        const sector = project.projectSectorId ? projectSectorMap.get(project.projectSectorId) : undefined;
        const workflowTemplate = project.workflowTemplateId ? workflowTemplateMap.get(project.workflowTemplateId) : undefined;
        return [
            group ? { label: group.name, tone: 'bg-orange-50 text-orange-600 border-orange-100' } : null,
            type ? { label: type.name, tone: 'bg-blue-50 text-blue-600 border-blue-100' } : null,
            sector ? { label: sector.name, tone: 'bg-emerald-50 text-emerald-600 border-emerald-100' } : null,
            workflowTemplate ? { label: workflowTemplate.name, tone: 'bg-violet-50 text-violet-600 border-violet-100' } : null,
        ].filter(Boolean) as { label: string; tone: string }[];
    };

    // === BUDGET CATEGORIES for chart ===
    const BUDGET_CATS = [
        { key: 'Materials', label: 'Vật tư', icon: '🧱', color: '#f97316', aggKey: 'actualMaterials' as const, filterKey: 'materials' as ProjectCostCategory },
        { key: 'Labor', label: 'Nhân công', icon: '👷', color: '#0ea5e9', aggKey: 'actualLabor' as const, filterKey: 'labor' as ProjectCostCategory },
        { key: 'Subcontract', label: 'Thầu phụ', icon: '🏗️', color: '#8b5cf6', aggKey: 'actualSubcontract' as const, filterKey: 'subcontract' as ProjectCostCategory },
        { key: 'Machinery', label: 'Máy móc', icon: '⚙️', color: '#10b981', aggKey: 'actualMachinery' as const, filterKey: 'machinery' as ProjectCostCategory },
        { key: 'Overhead', label: 'Quản lý chung', icon: '📋', color: '#6366f1', aggKey: 'actualOverhead' as const, filterKey: 'overhead' as ProjectCostCategory },
        { key: 'Other', label: 'Phát sinh', icon: '📦', color: '#ec4899', aggKey: 'actualOther' as const, filterKey: 'other' as ProjectCostCategory },
    ];

    // === ALL-PROJECT AGGREGATE ===
    const allStats = useMemo(() => {
        const metrics = filteredProjectRows.map(getProjectListMetrics);
        const totalContract = metrics.reduce((s, item) => s + item.contractValue, 0);
        const totalBudget = metrics.reduce((s, item) => s + (item.finance ? item.finance.budgetMaterials + item.finance.budgetLabor + item.finance.budgetSubcontract + item.finance.budgetMachinery + item.finance.budgetOverhead : 0), 0);
        const totalActual = metrics.reduce((s, item) => s + item.actualCost, 0);
        const totalRevenue = metrics.reduce((s, item) => s + item.totalRevenue, 0);
        const avgProgress = metrics.length > 0 ? metrics.reduce((s, item) => s + item.progress, 0) / metrics.length : 0;
        return { totalContract, totalBudget, totalActual, totalRevenue, avgProgress, profit: totalContract - totalActual };
    }, [filteredProjectRows, projectFinances, projectTransactions, taskProgressBySite]);

    // === HANDLERS ===
    const openProjectDetail = (project: Project) => {
        setSelectedProjectId(project.id);
        setSelectedSiteId(project.constructionSiteId || null);
        setOverviewTab('org');
        setActiveView('overview');
    };

    const openCreateProject = () => {
        setEditingProject(null);
        setProjectForm(emptyProjectForm());
        setShowProjectAdvanced(false);
        setShowProjectForm(true);
        loadWorkGroups();
    };

    const openEditProject = (project: Project) => {
        setEditingProject(project);
        setProjectForm({
            name: project.name || '',
            code: project.code || '',
            projectGroupId: project.projectGroupId || '',
            projectTypeId: project.projectTypeId || '',
            projectSectorId: project.projectSectorId || '',
            workflowTemplateId: project.workflowTemplateId || '',
            clientName: project.clientName || '',
            constructionSiteId: project.constructionSiteId || '',
            managerId: project.managerId || '',
            adminUserIds: [],
            adminGroupIds: [],
            executorUserIds: [],
            executorGroupIds: [],
            watcherUserIds: [],
            watcherGroupIds: [],
            defaultPositionId: '',
            status: project.status || 'planning',
            startDate: project.startDate || '',
            endDate: project.endDate || '',
            progressCalculationMode: project.progressCalculationMode || 'gantt_weighted',
            manualProgressPercent: String(project.manualProgressPercent ?? 0),
            description: project.description || '',
        });
        setShowProjectAdvanced(false);
        setShowProjectForm(true);
    };

    const selectedProjectType = () => projectForm.projectTypeId ? projectTypeMap.get(projectForm.projectTypeId) : undefined;

    const seedProjectStaff = async (project: Project) => {
        const roleRank: Record<'admin' | 'executor' | 'watcher', number> = { watcher: 1, executor: 2, admin: 3 };
        const userRoles = new Map<string, 'admin' | 'executor' | 'watcher'>();
        const mergeRole = (userId: string, role: 'admin' | 'executor' | 'watcher') => {
            if (!userId) return;
            const current = userRoles.get(userId);
            if (!current || roleRank[role] > roleRank[current]) userRoles.set(userId, role);
        };
        expandParticipantUserIds(projectForm.watcherUserIds, projectForm.watcherGroupIds).forEach(id => mergeRole(id, 'watcher'));
        expandParticipantUserIds(projectForm.executorUserIds, projectForm.executorGroupIds).forEach(id => mergeRole(id, 'executor'));
        expandParticipantUserIds(projectForm.adminUserIds, projectForm.adminGroupIds).forEach(id => mergeRole(id, 'admin'));
        if (userRoles.size === 0) return;

        const missingPositionUsers = [...userRoles.keys()].filter(userId => !employeeByUserId.get(userId)?.positionId && !projectForm.defaultPositionId);
        if (missingPositionUsers.length > 0) {
            const names = missingPositionUsers
                .map(userId => users.find(u => u.id === userId)?.name || users.find(u => u.id === userId)?.email || userId)
                .join(', ');
            throw new Error(`Các thành viên chưa có chức danh HRM: ${names}. Vui lòng chọn vị trí mặc định trong "Thông tin khác".`);
        }

        const permissionTypes = await projectPermissionTypeService.list();
        const permissionIdByCode = new Map(permissionTypes.map(permission => [permission.code, permission.id]));
        const codeSets: Record<'admin' | 'executor' | 'watcher', string[]> = {
            admin: ['view', 'edit', 'submit', 'verify', 'confirm', 'approve'],
            executor: ['view', 'edit', 'submit'],
            watcher: ['view'],
        };

        for (const [userId, role] of userRoles.entries()) {
            const permissionTypeIds = codeSets[role].map(code => permissionIdByCode.get(code)).filter(Boolean) as string[];
            if (permissionTypeIds.length === 0) throw new Error('Chưa có dữ liệu quyền PBAC. Vui lòng kiểm tra migration project_permission_types.');
            await projectStaffService.add({
                projectId: project.id,
                constructionSiteId: project.constructionSiteId || null,
                userId,
                positionId: employeeByUserId.get(userId)?.positionId || projectForm.defaultPositionId,
                permissionTypeIds,
                startDate: project.startDate || new Date().toISOString().slice(0, 10),
                note: role === 'admin' ? 'Seed từ form tạo dự án: Quản trị dự án' : role === 'executor' ? 'Seed từ form tạo dự án: Thực hiện dự án' : 'Seed từ form tạo dự án: Người theo dõi',
                grantedBy: user.id,
                operatorName: user.name || user.username,
            });
        }
    };

    const findImportUser = (value: string) => {
        const key = normalizeLookup(value);
        return activeUsers.find(item => [item.id, item.email, item.username, item.name].some(candidate => normalizeLookup(candidate) === key));
    };

    const splitImportValues = (value?: string): string[] =>
        String(value || '').split(/[;,]/).map(item => item.trim()).filter(Boolean);

    const seedImportedProjectStaff = async (project: Project, record: ProjectImportRecord) => {
        const roleRank: Record<'admin' | 'executor' | 'watcher', number> = { watcher: 1, executor: 2, admin: 3 };
        const userRoles = new Map<string, 'admin' | 'executor' | 'watcher'>();
        const mergeRole = (rawValue: string, role: 'admin' | 'executor' | 'watcher') => {
            const matchedUser = findImportUser(rawValue);
            if (!matchedUser) throw new Error(`Không tìm thấy user "${rawValue}" khi seed nhân sự dự án ${project.code}.`);
            const current = userRoles.get(matchedUser.id);
            if (!current || roleRank[role] > roleRank[current]) userRoles.set(matchedUser.id, role);
        };

        splitImportValues(record.watcherImportUsers).forEach(value => mergeRole(value, 'watcher'));
        splitImportValues(record.executorImportUsers).forEach(value => mergeRole(value, 'executor'));
        splitImportValues(record.adminImportUsers).forEach(value => mergeRole(value, 'admin'));
        if (userRoles.size === 0) return;

        const permissionTypes = await projectPermissionTypeService.list();
        const permissionIdByCode = new Map(permissionTypes.map(permission => [permission.code, permission.id]));
        const codeSets: Record<'admin' | 'executor' | 'watcher', string[]> = {
            admin: ['view', 'edit', 'submit', 'verify', 'confirm', 'approve'],
            executor: ['view', 'edit', 'submit'],
            watcher: ['view'],
        };

        for (const [userId, role] of userRoles.entries()) {
            const positionId = employeeByUserId.get(userId)?.positionId || record.defaultPositionImportId;
            if (!positionId) {
                const displayName = users.find(u => u.id === userId)?.name || users.find(u => u.id === userId)?.email || userId;
                throw new Error(`User ${displayName} chưa có chức danh HRM. Vui lòng nhập cột "Vị trí mặc định".`);
            }
            const permissionTypeIds = codeSets[role].map(code => permissionIdByCode.get(code)).filter(Boolean) as string[];
            if (permissionTypeIds.length === 0) throw new Error('Chưa có dữ liệu quyền PBAC. Vui lòng kiểm tra migration project_permission_types.');
            await projectStaffService.add({
                projectId: project.id,
                constructionSiteId: project.constructionSiteId || null,
                userId,
                positionId,
                permissionTypeIds,
                startDate: project.startDate || new Date().toISOString().slice(0, 10),
                note: `Seed từ import Excel dự án: ${role}`,
                grantedBy: user.id,
                operatorName: user.name || user.username,
            });
        }
    };

    const buildProjectImportPreview = (mode: ExcelImportMode, rows: Record<string, unknown>[]) => buildImportPreview<ProjectImportRecord>({
        mode,
        keyLabel: 'Mã dự án',
        keyAliases: ['Mã dự án *', 'Mã dự án', 'Ma du an', 'Project Code', 'code'],
        existingRecords: projectRows as ProjectImportRecord[],
        getRecordKey: project => project.code,
        createBaseRecord: code => ({
            id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            code: code.trim().toUpperCase(),
            name: '',
            projectType: 'construction',
            status: 'planning',
            progressCalculationMode: 'gantt_weighted',
            manualProgressPercent: 0,
            source: 'manual',
            isHidden: false,
        }),
        validateKey: value => {
            const normalized = String(value || '').trim();
            if (!normalized) return 'Mã dự án là bắt buộc.';
            if (normalized.length > 60) return 'Mã dự án không nên dài quá 60 ký tự.';
            return undefined;
        },
        fields: [
            { key: 'name', label: 'Tên dự án', aliases: ['Tên dự án *', 'Tên dự án', 'Ten du an', 'Project Name', 'name'], requiredOnCreate: true },
            { key: 'clientName', label: 'Khách hàng', aliases: ['Khách hàng', 'Chủ đầu tư', 'Chu dau tu', 'clientName'], clearable: true },
            { key: 'description', label: 'Mô tả', aliases: ['Mô tả', 'Mo ta', 'description'], clearable: true },
            {
                key: 'projectGroupId',
                label: 'Nhóm dự án',
                aliases: ['Nhóm dự án', 'Nhom du an'],
                clearable: true,
                normalize: value => findByNameCodeId(projectGroups, value)?.id,
                validate: (value, row) => {
                    const raw = getExcelCell(row, ['Nhóm dự án', 'Nhom du an']);
                    return raw && !value ? `Nhóm dự án "${raw}" không tồn tại.` : undefined;
                },
                format: value => projectGroupMap.get(String(value || ''))?.name || String(value || '-'),
            },
            {
                key: 'projectTypeId',
                label: 'Loại dự án',
                aliases: ['Loại dự án', 'Loai du an'],
                clearable: true,
                normalize: value => findByNameCodeId(projectTypes, value)?.id,
                validate: (value, row) => {
                    const raw = getExcelCell(row, ['Loại dự án', 'Loai du an']);
                    return raw && !value ? `Loại dự án "${raw}" không tồn tại.` : undefined;
                },
                format: value => projectTypeMap.get(String(value || ''))?.name || String(value || '-'),
            },
            {
                key: 'projectSectorId',
                label: 'Lĩnh vực',
                aliases: ['Lĩnh vực', 'Linh vuc'],
                clearable: true,
                normalize: value => findByNameCodeId(projectSectors, value)?.id,
                validate: (value, row) => {
                    const raw = getExcelCell(row, ['Lĩnh vực', 'Linh vuc']);
                    return raw && !value ? `Lĩnh vực "${raw}" không tồn tại.` : undefined;
                },
                format: value => projectSectorMap.get(String(value || ''))?.name || String(value || '-'),
            },
            {
                key: 'workflowTemplateId',
                label: 'Quy trình',
                aliases: ['Quy trình', 'Quy trinh', 'Workflow'],
                clearable: true,
                normalize: value => findByNameCodeId(workflowTemplates.map(template => ({ ...template, code: template.id })), value)?.id,
                validate: (value, row) => {
                    const raw = getExcelCell(row, ['Quy trình', 'Quy trinh', 'Workflow']);
                    return raw && !value ? `Quy trình "${raw}" không tồn tại.` : undefined;
                },
                format: value => workflowTemplateMap.get(String(value || ''))?.name || String(value || '-'),
            },
            {
                key: 'constructionSiteId',
                label: 'Công trường',
                aliases: ['Công trường', 'Cong truong', 'Địa điểm thi công', 'Dia diem thi cong'],
                clearable: true,
                normalize: value => {
                    const key = normalizeLookup(value);
                    return hrmConstructionSites.find(site => normalizeLookup(site.id) === key || normalizeLookup(site.name) === key)?.id;
                },
                validate: (value, row) => {
                    const raw = getExcelCell(row, ['Công trường', 'Cong truong', 'Địa điểm thi công', 'Dia diem thi cong']);
                    return raw && !value ? `Công trường "${raw}" không tồn tại.` : undefined;
                },
                format: value => hrmConstructionSites.find(site => site.id === value)?.name || String(value || '-'),
            },
            { key: 'status', label: 'Trạng thái', aliases: ['Trạng thái', 'Trang thai', 'status'], normalize: normalizeProjectStatus, format: value => STATUS_CONFIG[String(value)]?.label || String(value || '-') },
            { key: 'startDate', label: 'Ngày bắt đầu', aliases: ['Ngày bắt đầu', 'Ngay bat dau', 'startDate'], clearable: true, normalize: parseProjectDate },
            { key: 'endDate', label: 'Ngày kết thúc', aliases: ['Ngày kết thúc', 'Ngay ket thuc', 'endDate'], clearable: true, normalize: parseProjectDate },
            { key: 'progressCalculationMode', label: 'Cách tính tiến độ', aliases: ['Cách tính tiến độ', 'Cach tinh tien do', 'progressCalculationMode'], normalize: normalizeProgressMode, format: value => PROGRESS_MODE_OPTIONS.find(option => option.value === value)?.label || String(value || '-') },
            {
                key: 'manualProgressPercent',
                label: '% tiến độ thủ công',
                aliases: ['% tiến độ thủ công', 'Tien do thu cong', 'manualProgressPercent'],
                normalize: parseProjectNumber,
                validate: value => Number(value) >= 0 && Number(value) <= 100 ? undefined : 'Tiến độ thủ công phải nằm trong khoảng 0-100%.',
                format: value => `${Number(value || 0)}%`,
            },
            ...(mode === 'create' ? [
                {
                    key: 'adminImportUsers' as const,
                    label: 'Quản trị dự án',
                    aliases: ['Quản trị dự án', 'Quan tri du an'],
                    clearable: true,
                    validate: (value: unknown) => {
                        const missing = splitImportValues(String(value || '')).filter(item => !findImportUser(item));
                        return missing.length > 0 ? `Không tìm thấy user: ${missing.join(', ')}.` : undefined;
                    },
                },
                {
                    key: 'executorImportUsers' as const,
                    label: 'Thực hiện dự án',
                    aliases: ['Thực hiện dự án', 'Thuc hien du an'],
                    clearable: true,
                    validate: (value: unknown) => {
                        const missing = splitImportValues(String(value || '')).filter(item => !findImportUser(item));
                        return missing.length > 0 ? `Không tìm thấy user: ${missing.join(', ')}.` : undefined;
                    },
                },
                {
                    key: 'watcherImportUsers' as const,
                    label: 'Người theo dõi',
                    aliases: ['Người theo dõi', 'Nguoi theo doi'],
                    clearable: true,
                    validate: (value: unknown) => {
                        const missing = splitImportValues(String(value || '')).filter(item => !findImportUser(item));
                        return missing.length > 0 ? `Không tìm thấy user: ${missing.join(', ')}.` : undefined;
                    },
                },
                {
                    key: 'defaultPositionImportId' as const,
                    label: 'Vị trí mặc định',
                    aliases: ['Vị trí mặc định', 'Vi tri mac dinh'],
                    clearable: true,
                    normalize: (value: unknown) => {
                        const key = normalizeLookup(value);
                        return hrmPositions.find(position => normalizeLookup(position.id) === key || normalizeLookup(position.name) === key)?.id;
                    },
                    validate: (value: unknown, row: Record<string, unknown>) => {
                        const raw = getExcelCell(row, ['Vị trí mặc định', 'Vi tri mac dinh']);
                        return raw && !value ? `Vị trí mặc định "${raw}" không tồn tại.` : undefined;
                    },
                    format: value => hrmPositions.find(position => position.id === value)?.name || String(value || '-'),
                },
            ] : []),
        ],
    }, rows);

    const downloadBlob = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleDownloadProjectTemplate = async () => {
        setProjectExporting(true);
        try {
            const XLSX = await loadXlsx();
            const sampleGroup = projectGroups[0]?.name || 'Dự án thi công';
            const sampleType = projectTypes[0]?.name || 'Thi công xây dựng';
            const sampleSector = projectSectors[0]?.name || 'Dân dụng';
            const sampleWorkflow = workflowTemplates[0]?.name || '';
            const sampleSite = hrmConstructionSites[0]?.name || '';
            const sampleUser = activeUsers[0]?.email || activeUsers[0]?.username || activeUsers[0]?.name || '';
            const samplePosition = hrmPositions[0]?.name || '';

            const createRows = [
                {
                    'Mã dự án *': 'DA-001',
                    'Tên dự án *': 'Dự án mẫu',
                    'Khách hàng': 'Công ty ABC',
                    'Mô tả': 'Mô tả ngắn của dự án',
                    'Nhóm dự án': sampleGroup,
                    'Loại dự án': sampleType,
                    'Lĩnh vực': sampleSector,
                    'Quy trình': sampleWorkflow,
                    'Công trường': sampleSite,
                    'Trạng thái': 'Lập kế hoạch',
                    'Ngày bắt đầu': '01/06/2026',
                    'Ngày kết thúc': '31/12/2026',
                    'Cách tính tiến độ': 'Theo Gantt có trọng số',
                    '% tiến độ thủ công': 0,
                    'Quản trị dự án': sampleUser,
                    'Thực hiện dự án': '',
                    'Người theo dõi': '',
                    'Vị trí mặc định': samplePosition,
                },
            ];
            const updateRows = [
                {
                    'Mã dự án *': projects[0]?.code || 'DA-001',
                    'Tên dự án': '',
                    'Khách hàng': 'Tên khách hàng mới',
                    'Trạng thái': 'Đang thi công',
                    'Ngày kết thúc': '31/12/2026',
                },
            ];
            const guideRows = [
                ['Chức năng', 'Cách dùng'],
                ['Nhập mới', 'Dùng sheet Nhap_moi. Mã dự án đã tồn tại sẽ bị báo lỗi.'],
                ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã dự án và các cột muốn sửa.'],
                ['Ô trống', 'Ở chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
                ['Xoá giá trị', 'Dùng __CLEAR__ cho cột cho phép xoá như mô tả, khách hàng, công trường, ngày.'],
                ['User dự án', 'Các cột Quản trị/Thực hiện/Người theo dõi chỉ dùng khi Nhập mới; nhập email, username, tên hoặc id, phân tách bằng dấu ;'],
                ['Cập nhật tổ chức', 'Cập nhật Excel không chỉnh nhân sự/quyền dự án. Vui lòng dùng tab Tổ chức.'],
            ];
            const maxRows = Math.max(projectGroups.length, projectTypes.length, projectSectors.length, workflowTemplates.length, hrmConstructionSites.length, activeUsers.length, hrmPositions.length, Object.keys(STATUS_CONFIG).length, PROGRESS_MODE_OPTIONS.length, 1);
            const catalogRows = Array.from({ length: maxRows }).map((_, index) => ({
                'Nhóm dự án': projectGroups[index]?.name || '',
                'Loại dự án': projectTypes[index]?.name || '',
                'Lĩnh vực': projectSectors[index]?.name || '',
                'Quy trình': workflowTemplates[index]?.name || '',
                'Công trường': hrmConstructionSites[index]?.name || '',
                'User hợp lệ': activeUsers[index] ? `${activeUsers[index].name || activeUsers[index].username || activeUsers[index].email} | ${activeUsers[index].email || activeUsers[index].username || activeUsers[index].id}` : '',
                'Vị trí HRM': hrmPositions[index]?.name || '',
                'Trạng thái': Object.values(STATUS_CONFIG)[index]?.label || '',
                'Cách tính tiến độ': PROGRESS_MODE_OPTIONS[index]?.label || '',
            }));

            const wb = XLSX.utils.book_new();
            const createSheet = XLSX.utils.json_to_sheet(createRows);
            createSheet['!cols'] = Object.keys(createRows[0]).map(key => ({ wch: Math.max(18, key.length + 4) }));
            XLSX.utils.book_append_sheet(wb, createSheet, 'Nhap_moi');
            const updateSheet = XLSX.utils.json_to_sheet(updateRows);
            updateSheet['!cols'] = Object.keys(updateRows[0]).map(key => ({ wch: Math.max(18, key.length + 4) }));
            XLSX.utils.book_append_sheet(wb, updateSheet, 'Cap_nhat');
            const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
            guideSheet['!cols'] = [{ wch: 24 }, { wch: 110 }];
            XLSX.utils.book_append_sheet(wb, guideSheet, 'Huong_dan');
            const catalogSheet = XLSX.utils.json_to_sheet(catalogRows);
            catalogSheet['!cols'] = Object.keys(catalogRows[0]).map(key => ({ wch: Math.max(20, key.length + 8) }));
            XLSX.utils.book_append_sheet(wb, catalogSheet, 'Danh_muc');

            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            downloadBlob(new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Mau_nhap_du_an.xlsx');
            toast.success('Đã xuất file mẫu', 'File mẫu nhập/cập nhật dự án đã được tải về.');
        } catch (error) {
            logApiError('ProjectDashboard.downloadProjectTemplate', error);
            toast.error('Không thể xuất file mẫu', getApiErrorMessage(error, 'Không thể tạo file Excel mẫu dự án.'));
        } finally {
            setProjectExporting(false);
        }
    };

    const openProjectImport = (mode: ExcelImportMode) => {
        projectImportModeRef.current = mode;
        setProjectImportMode(mode);
        projectImportInputRef.current?.click();
    };

    const handleProjectImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setProjectImporting(true);
        try {
            const rows = await parseExcelRows(file, projectImportModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
            if (rows.length === 0) {
                toast.warning('File Excel trống', 'Không có dòng dự án nào để nhập.');
                return;
            }
            const preview = buildProjectImportPreview(projectImportModeRef.current, rows);
            if (preview.totalRows === 0) {
                toast.warning('File Excel trống', 'Không có dòng dự án hợp lệ để nhập.');
                return;
            }
            setProjectImportPreview(preview);
        } catch (error) {
            logApiError('ProjectDashboard.projectImport.read', error);
            toast.error('Không thể đọc file Excel', getApiErrorMessage(error, 'Không thể đọc file Excel dự án. Vui lòng dùng file mẫu.'));
        } finally {
            setProjectImporting(false);
        }
    };

    const handleConfirmProjectImport = async ({ validOnly }: { validOnly: boolean }) => {
        if (!projectImportPreview) return;
        const records = applyImportChanges(projectImportPreview);
        if (records.length === 0) {
            toast.warning('Không có dữ liệu cần ghi', 'File không có dòng thêm mới hoặc cập nhật hợp lệ.');
            return;
        }

        setProjectImporting(true);
        try {
            let created = 0;
            let updated = 0;
            if (projectImportPreview.mode === 'create') {
                const createRows = projectImportPreview.rows.filter(row => row.status === 'create' && row.nextRecord);
                for (const row of createRows) {
                    const record = row.nextRecord!;
                    const projectType = record.projectTypeId ? projectTypeMap.get(record.projectTypeId) : undefined;
                    const createdProject = await projectMasterService.create({
                        name: record.name,
                        code: record.code,
                        description: record.description,
                        clientName: record.clientName,
                        projectType: projectType?.code || record.projectType || 'construction',
                        projectGroupId: record.projectGroupId || null,
                        projectTypeId: record.projectTypeId || null,
                        projectSectorId: record.projectSectorId || null,
                        workflowTemplateId: record.workflowTemplateId || null,
                        constructionSiteId: record.constructionSiteId || null,
                        status: record.status,
                        startDate: record.startDate,
                        endDate: record.endDate,
                        progressCalculationMode: record.progressCalculationMode,
                        manualProgressPercent: Number(record.manualProgressPercent || 0),
                        createdBy: user.id,
                    });
                    await seedImportedProjectStaff(createdProject, record);
                    created += 1;
                }
            } else {
                const updateRows = projectImportPreview.rows.filter(row => row.status === 'update' && row.existingRecord && row.nextRecord);
                for (const row of updateRows) {
                    const record = row.nextRecord!;
                    const projectType = record.projectTypeId ? projectTypeMap.get(record.projectTypeId) : undefined;
                    await projectMasterService.update({
                        ...row.existingRecord!,
                        ...record,
                        projectType: projectType?.code || record.projectType || row.existingRecord!.projectType || 'construction',
                    });
                    updated += 1;
                }
            }
            await loadProjects();
            setProjectImportPreview(null);
            toast.success(
                projectImportPreview.mode === 'create' ? 'Đã nhập mới dự án' : 'Đã cập nhật dự án',
                `Thêm mới ${created}, cập nhật ${updated} dự án${validOnly ? ' từ các dòng hợp lệ' : ''}.`
            );
        } catch (error) {
            logApiError('ProjectDashboard.projectImport.apply', error);
            toast.error('Không thể ghi dữ liệu dự án', getApiErrorMessage(error, 'Không thể lưu dữ liệu import dự án lên Supabase.'));
        } finally {
            setProjectImporting(false);
        }
    };

    const handleExportProjectList = async () => {
        setProjectExporting(true);
        try {
            const XLSX = await loadXlsx();
            const rows = filteredProjectRows.map(project => {
                const metrics = getProjectListMetrics(project);
                return {
                    'Mã dự án': project.code,
                    'Tên dự án': project.name,
                    'Khách hàng': project.clientName || '',
                    'Nhóm dự án': project.projectGroupId ? projectGroupMap.get(project.projectGroupId)?.name || '' : '',
                    'Loại dự án': project.projectTypeId ? projectTypeMap.get(project.projectTypeId)?.name || '' : '',
                    'Lĩnh vực': project.projectSectorId ? projectSectorMap.get(project.projectSectorId)?.name || '' : '',
                    'Quy trình': project.workflowTemplateId ? workflowTemplateMap.get(project.workflowTemplateId)?.name || '' : '',
                    'Công trường': metrics.site?.name || '',
                    'Trạng thái': STATUS_CONFIG[project.status]?.label || project.status,
                    'Ngày bắt đầu': project.startDate || '',
                    'Ngày kết thúc': project.endDate || '',
                    'Giá trị HĐ': metrics.contractValue,
                    'Tổng chi thực tế': metrics.actualCost,
                    'Lợi nhuận tạm tính': metrics.profit,
                    'Tiến độ (%)': metrics.progress,
                    'Số giao dịch': metrics.txCount,
                    'Trạng thái ẩn': project.isHidden ? 'Đã ẩn' : 'Đang hoạt động',
                    'Lý do ẩn': project.hiddenReason || '',
                };
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = Object.keys(rows[0] || { 'Mã dự án': '' }).map(key => ({ wch: Math.max(16, key.length + 6) }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Danh_sach_du_an');
            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            downloadBlob(new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Danh_sach_du_an_${new Date().toISOString().slice(0, 10)}.xlsx`);
            toast.success('Đã xuất danh sách', `${rows.length} dự án theo bộ lọc hiện tại đã được xuất Excel.`);
        } catch (error) {
            logApiError('ProjectDashboard.exportProjectList', error);
            toast.error('Không thể xuất danh sách', getApiErrorMessage(error, 'Không thể xuất danh sách dự án.'));
        } finally {
            setProjectExporting(false);
        }
    };

    const openHideProject = async (project: Project) => {
        setHideProjectTarget(project);
        setHideProjectReason('');
        setHideProjectCodeConfirm('');
        setHideProjectImpact(null);
        setHideProjectImpactLoading(true);
        try {
            const impact = await projectMasterService.getDeleteImpact(project.id, project.constructionSiteId);
            setHideProjectImpact(impact);
        } catch (error) {
            logApiError('ProjectDashboard.hideImpact', error);
            toast.error('Không thể kiểm tra phát sinh', getApiErrorMessage(error, 'Không thể kiểm tra dữ liệu phát sinh của dự án.'));
        } finally {
            setHideProjectImpactLoading(false);
        }
    };

    const closeHideProject = () => {
        setHideProjectTarget(null);
        setHideProjectImpact(null);
        setHideProjectReason('');
        setHideProjectCodeConfirm('');
    };

    const handleConfirmHideProject = async () => {
        if (!hideProjectTarget || !hideProjectImpact) return;
        if (!hideProjectReason.trim()) {
            toast.warning('Thiếu lý do', 'Vui lòng nhập lý do ẩn dự án.');
            return;
        }
        if (hideProjectImpact.hasImpact && !isAdmin) {
            toast.warning('Không thể xoá dự án', 'Dự án đã có phát sinh chi phí. Cần làm ngược các bước xoá chi phí trước.');
            return;
        }
        if (hideProjectImpact.hasImpact && hideProjectCodeConfirm.trim() !== hideProjectTarget.code) {
            toast.warning('Xác nhận chưa đúng', `Vui lòng nhập đúng mã dự án ${hideProjectTarget.code} để force ẩn.`);
            return;
        }

        setHidingProject(true);
        try {
            const updated = await projectMasterService.hide(hideProjectTarget.id, {
                reason: hideProjectReason,
                hiddenBy: user.name || user.username || user.email || user.id,
                force: isAdmin && hideProjectImpact.hasImpact,
                constructionSiteId: hideProjectTarget.constructionSiteId,
            });
            setProjects(prev => prev.map(project => project.id === updated.id ? updated : project));
            if (selectedProjectId === updated.id) {
                setActiveView('list');
                setSelectedProjectId(null);
                setSelectedSiteId(null);
            }
            closeHideProject();
            toast.success(updated.isHidden ? 'Đã ẩn dự án' : 'Đã cập nhật dự án', `${hideProjectTarget.code} đã được ẩn khỏi vận hành mặc định.`);
        } catch (error) {
            logApiError('ProjectDashboard.hideProject', error);
            toast.error('Không thể ẩn dự án', getApiErrorMessage(error, 'Không thể ẩn dự án trên Supabase.'));
        } finally {
            setHidingProject(false);
        }
    };

    const handleRestoreProject = async (project: Project) => {
        setRestoringProjectId(project.id);
        try {
            const restored = await projectMasterService.restore(project.id);
            setProjects(prev => prev.map(item => item.id === restored.id ? restored : item));
            toast.success('Đã khôi phục dự án', `${project.code} đã hiển thị lại trong danh sách vận hành.`);
        } catch (error) {
            logApiError('ProjectDashboard.restoreProject', error);
            toast.error('Không thể khôi phục dự án', getApiErrorMessage(error, 'Không thể khôi phục dự án trên Supabase.'));
        } finally {
            setRestoringProjectId(null);
        }
    };

    const saveProject = async (openAfterCreate = true) => {
        if (!projectForm.name.trim()) {
            toast.warning('Thiếu tên dự án', 'Vui lòng nhập tên dự án.');
            return;
        }
        if (!editingProject) {
            const selectedUserIds = getAllProjectParticipantUserIds();
            const hasMissingPosition = selectedUserIds.some(userId => !employeeByUserId.get(userId)?.positionId && !projectForm.defaultPositionId);
            if (hasMissingPosition) {
                toast.warning('Thiếu chức danh HRM', 'Có thành viên chưa liên kết chức danh. Vui lòng chọn vị trí mặc định trong Thông tin khác.');
                setShowProjectAdvanced(true);
                return;
            }
        }
        const manualProgressPercent = Math.max(0, Math.min(100, Number(projectForm.manualProgressPercent) || 0));
        const projectType = selectedProjectType();
        const adminUserIds = expandParticipantUserIds(projectForm.adminUserIds, projectForm.adminGroupIds);
        setSavingProject(true);
        try {
            if (editingProject) {
                const updated = await projectMasterService.update({
                    ...editingProject,
                    name: projectForm.name.trim(),
                    code: projectForm.code.trim() || editingProject.code,
                    clientName: projectForm.clientName.trim() || undefined,
                    projectType: projectType?.code || editingProject.projectType || 'construction',
                    projectGroupId: projectForm.projectGroupId || null,
                    projectTypeId: projectForm.projectTypeId || null,
                    projectSectorId: projectForm.projectSectorId || null,
                    workflowTemplateId: projectForm.workflowTemplateId || null,
                    constructionSiteId: projectForm.constructionSiteId || null,
                    managerId: adminUserIds[0] || projectForm.managerId || undefined,
                    status: projectForm.status,
                    startDate: projectForm.startDate || undefined,
                    endDate: projectForm.endDate || undefined,
                    progressCalculationMode: projectForm.progressCalculationMode,
                    manualProgressPercent,
                    description: projectForm.description.trim() || undefined,
                });
                setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                if (selectedProjectId === updated.id) {
                    setSelectedSiteId(updated.constructionSiteId || null);
                }
                toast.success('Đã cập nhật dự án', updated.name);
            } else {
                const created = await projectMasterService.create({
                    name: projectForm.name.trim(),
                    code: projectForm.code.trim() || undefined,
                    clientName: projectForm.clientName.trim() || undefined,
                    projectType: projectType?.code || 'construction',
                    projectGroupId: projectForm.projectGroupId || null,
                    projectTypeId: projectForm.projectTypeId || null,
                    projectSectorId: projectForm.projectSectorId || null,
                    workflowTemplateId: projectForm.workflowTemplateId || null,
                    constructionSiteId: projectForm.constructionSiteId || null,
                    managerId: adminUserIds[0] || projectForm.managerId || undefined,
                    status: projectForm.status,
                    startDate: projectForm.startDate || undefined,
                    endDate: projectForm.endDate || undefined,
                    progressCalculationMode: projectForm.progressCalculationMode,
                    manualProgressPercent,
                    description: projectForm.description.trim() || undefined,
                    createdBy: user.id,
                });
                await seedProjectStaff(created);
                setProjects(prev => [created, ...prev.filter(p => p.id !== created.id)]);
                if (openAfterCreate) openProjectDetail(created);
                toast.success('Đã tạo dự án', created.name);
            }
            setShowProjectForm(false);
            setEditingProject(null);
        } catch (err: any) {
            logApiError('ProjectDashboard.saveProject', err);
            toast.error('Lưu dự án thất bại', getApiErrorMessage(err, 'Không thể lưu dự án trên Supabase.'));
        } finally {
            setSavingProject(false);
        }
    };

    const openQuickCategory = (kind: 'group' | 'type' | 'sector') => {
        setQuickCategoryKind(kind);
        setQuickCategoryForm({ code: '', name: '', description: '' });
    };

    const saveQuickCategory = async () => {
        if (!quickCategoryKind || !quickCategoryForm.name.trim()) return;
        try {
            let created: ProjectMasterCategory;
            if (quickCategoryKind === 'group') {
                created = await projectMasterDataService.createGroup(quickCategoryForm);
                setProjectGroups(prev => [...prev, created as ProjectGroup]);
                setProjectForm(prev => ({ ...prev, projectGroupId: created.id }));
            } else if (quickCategoryKind === 'type') {
                created = await projectMasterDataService.createType(quickCategoryForm);
                setProjectTypes(prev => [...prev, created as ProjectTypeMaster]);
                setProjectForm(prev => ({ ...prev, projectTypeId: created.id }));
            } else {
                created = await projectMasterDataService.createSector(quickCategoryForm);
                setProjectSectors(prev => [...prev, created as ProjectSector]);
                setProjectForm(prev => ({ ...prev, projectSectorId: created.id }));
            }
            setQuickCategoryKind(null);
            setQuickCategoryForm({ code: '', name: '', description: '' });
            await loadProjectMasterData();
            toast.success('Đã thêm danh mục dự án', created.name);
        } catch (err: any) {
            logApiError('ProjectDashboard.saveQuickCategory', err);
            toast.error('Không thêm nhanh được danh mục', getApiErrorMessage(err, 'Không thể thêm danh mục dự án.'));
        }
    };

    const openBudgetForm = (siteId: string) => {
        const existing = projectFinances.find(pf => pf.constructionSiteId === siteId);
        setBudgetData(existing ? { ...existing } : emptyFinance(siteId));
        setShowBudgetForm(true);
    };

    const saveBudget = () => {
        if (!budgetData) return;
        const derivedProgress = taskProgressBySite[budgetData.constructionSiteId]?.progressPercent;
        const nextBudgetData = {
            ...budgetData,
            progressPercent: derivedProgress ?? budgetData.progressPercent,
            updatedAt: new Date().toISOString(),
        };
        const existing = projectFinances.find(pf => pf.id === nextBudgetData.id);
        if (existing) updateProjectFinance(nextBudgetData);
        else addProjectFinance(nextBudgetData);
        setShowBudgetForm(false);
        setSelectedSiteId(nextBudgetData.constructionSiteId);
        setActiveView('overview');
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const uploadFiles = async (files: File[]): Promise<Attachment[]> => {
        if (files.length === 0) return [];
        const results: Attachment[] = [];

        for (const file of files) {
            let uploaded = false;

            // Try Supabase Storage first
            if (isSupabaseConfigured) {
                try {
                    const ext = file.name.split('.').pop();
                    const path = `tx/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
                    console.log('[Attachment] Uploading to storage:', path, 'size:', file.size);
                    const { data, error } = await supabase.storage.from('project-attachments').upload(path, file, {
                        cacheControl: '3600',
                        upsert: false,
                    });
                    if (error) {
                        console.error('[Attachment] Storage upload error:', error.message);
                    } else {
                        const { data: urlData } = supabase.storage.from('project-attachments').getPublicUrl(path);
                        console.log('[Attachment] Upload OK, URL:', urlData.publicUrl);
                        results.push({ name: file.name, url: urlData.publicUrl, fileType: file.type });
                        uploaded = true;
                    }
                } catch (err: any) {
                    console.error('[Attachment] Storage exception:', err.message);
                }
            }

            // Fallback: convert to base64 data URL
            if (!uploaded) {
                try {
                    console.log('[Attachment] Falling back to base64 for:', file.name);
                    const base64 = await fileToBase64(file);
                    results.push({ name: file.name, url: base64, fileType: file.type });
                } catch (err: any) {
                    console.error('[Attachment] Base64 conversion failed:', err.message);
                }
            }
        }

        if (results.length > 0) {
            console.log(`[Attachment] ${results.length}/${files.length} files processed`);
        }
        return results;
    };

    const openEditTx = (tx: ProjectTransaction) => {
        setEditingTx(tx);
        setTxType(tx.type);
        setTxCategory(tx.category);
        setTxAmount(String(tx.amount));
        setTxDesc(tx.description);
        setTxDate(tx.date);
        setTxFiles([]);
        setExistingAttachments(tx.attachments || []);
        setShowTxForm(true);
    };

    const resetTxForm = () => {
        setEditingTx(null);
        setTxType('expense');
        setTxCategory('materials');
        setTxAmount('');
        setTxDesc('');
        setTxDate(new Date().toISOString().slice(0, 10));
        setTxFiles([]);
        setExistingAttachments([]);
        setShowTxForm(false);
    };

    const handleAddTx = async () => {
        if (!effectiveSiteId || !txAmount || Number(txAmount) <= 0) {
            toast.warning('Thiếu dữ liệu giao dịch', 'Vui lòng chọn dự án có công trường và nhập số tiền hợp lệ.');
            return;
        }
        setUploading(true);
        try {
            let financeId = selectedFinance?.id;
            if (!financeId) {
                const newFin = emptyFinance(effectiveSiteId);
                addProjectFinance(newFin);
                financeId = newFin.id;
            }
            const newAttachments = await uploadFiles(txFiles);
            const allAttachments = [...existingAttachments, ...newAttachments];

            if (editingTx) {
                const updated: ProjectTransaction = {
                    ...editingTx,
                    type: txType,
                    category: txCategory,
                    amount: Number(txAmount),
                    description: txDesc,
                    date: txDate,
                    attachments: allAttachments,
                };
                updateProjectTransaction(updated);
                toast.success('Đã cập nhật giao dịch', txDesc || 'Giao dịch dự án đã được cập nhật.');
            } else {
                const tx: ProjectTransaction = {
                    id: crypto.randomUUID(),
                    projectId: selectedProject?.id || null,
                    projectFinanceId: financeId,
                    constructionSiteId: effectiveSiteId,
                    type: txType,
                    category: txCategory,
                    amount: Number(txAmount),
                    description: txDesc,
                    date: txDate,
                    source: 'manual',
                    attachments: allAttachments,
                    createdBy: user.id,
                    createdAt: new Date().toISOString(),
                };
                addProjectTransaction(tx);
                toast.success('Đã thêm giao dịch', txDesc || 'Giao dịch dự án đã được tạo.');
            }
            resetTxForm();
        } catch (error) {
            logApiError('ProjectDashboard.saveTransaction', error);
            toast.error('Không thể lưu giao dịch', getApiErrorMessage(error, 'Không thể lưu giao dịch dự án.'));
        } finally {
            setUploading(false);
        }
    };

    const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!effectiveSiteId) {
            toast.warning('Chưa liên kết công trường', 'Dự án cần liên kết công trường trước khi import giao dịch.');
            e.target.value = '';
            return;
        }
        let financeId = selectedFinance?.id;
        if (!financeId) {
            const newFin = emptyFinance(effectiveSiteId);
            addProjectFinance(newFin);
            financeId = newFin.id;
        }

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const XLSX = await loadXlsx();
                const data = new Uint8Array(ev.target?.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];

                // ===== SMART HEADER DETECTION =====
                const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                console.log('[DA Import] Sheet:', wb.SheetNames[0], 'Total raw rows:', rawRows.length);

                const headerKeywords = ['thành tiền', 'thanh tien', 'đơn giá', 'don gia', 'số tiền', 'so tien', 'amount', 'số lượng', 'so luong', 'tên hàng', 'ten hang', 'stt', 'hạng mục', 'mô tả', 'nội dung'];
                let headerRowIdx = -1;
                let headerCols: string[] = [];
                for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
                    const row = rawRows[r];
                    if (!row || row.length < 2) continue;
                    const cellTexts = row.map((c: any) => String(c || '').toLowerCase().trim());
                    const matchCount = cellTexts.filter((t: string) => headerKeywords.some(kw => t.includes(kw))).length;
                    if (matchCount >= 2) {
                        headerRowIdx = r;
                        headerCols = row.map((c: any) => String(c || '').trim());
                        console.log(`[DA Import] Found header at row ${r}:`, headerCols);
                        break;
                    }
                }

                let rows: any[];
                if (headerRowIdx >= 0) {
                    rows = [];
                    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
                        const rawRow = rawRows[r];
                        if (!rawRow || rawRow.every((c: any) => !c && c !== 0)) continue;
                        const obj: any = {};
                        headerCols.forEach((col, i) => { if (col) obj[col] = rawRow[i] ?? ''; });
                        rows.push(obj);
                    }
                    console.log('[DA Import] Parsed rows with detected header:', rows.length);
                } else {
                    rows = XLSX.utils.sheet_to_json(ws);
                    console.log('[DA Import] Fallback: standard header, rows:', rows.length);
                }

                if (rows.length > 0) console.log('[DA Import] First data row keys:', Object.keys(rows[0]), 'values:', rows[0]);
                if (rows.length === 0) {
                    toast.warning('File rỗng', 'File không có dữ liệu giao dịch.');
                    return;
                }

                // Fuzzy column finder
                const findCol = (row: any, patterns: string[]) => {
                    const keys = Object.keys(row);
                    for (const p of patterns) {
                        const exact = keys.find(k => k.toLowerCase().trim() === p);
                        if (exact) return row[exact];
                    }
                    for (const p of patterns) {
                        const partial = keys.find(k => k.toLowerCase().trim().includes(p) || p.includes(k.toLowerCase().trim()));
                        if (partial) return row[partial];
                    }
                    return undefined;
                };

                const catMap: Record<string, ProjectCostCategory> = {
                    'vật tư': 'materials', 'vat tu': 'materials', 'materials': 'materials', 'vt': 'materials',
                    'nhân công': 'labor', 'nhan cong': 'labor', 'labor': 'labor', 'nc': 'labor',
                    'thầu phụ': 'subcontract', 'thau phu': 'subcontract', 'subcontract': 'subcontract', 'tp': 'subcontract',
                    'máy móc': 'machinery', 'may moc': 'machinery', 'machinery': 'machinery', 'mm': 'machinery', 'máy': 'machinery',
                    'quản lý chung': 'overhead', 'quan ly chung': 'overhead', 'overhead': 'overhead', 'qlc': 'overhead', 'quản lý': 'overhead',
                    'phát sinh': 'other', 'phat sinh': 'other', 'other': 'other', 'khác': 'other', 'khac': 'other', 'ps': 'other',
                };
                const typeMap: Record<string, ProjectTxType> = {
                    'chi phí': 'expense', 'chi phi': 'expense', 'expense': 'expense', 'chi': 'expense',
                    'thu': 'revenue_received', 'doanh thu': 'revenue_received', 'revenue': 'revenue_received',
                    'chờ thu': 'revenue_pending', 'cho thu': 'revenue_pending', 'pending': 'revenue_pending',
                };

                const parseDate = (val: any): string => {
                    if (!val) return new Date().toISOString().slice(0, 10);
                    if (typeof val === 'number') {
                        // XLSX date serial number
                        const d = new Date((val - 25569) * 86400 * 1000);
                        return d.toISOString().slice(0, 10);
                    }
                    const s = String(val).trim();
                    // Try DD/MM/YYYY
                    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
                    return s || new Date().toISOString().slice(0, 10);
                };

                const parseAmount = (val: any): number => {
                    if (typeof val === 'number') return val;
                    if (!val) return 0;
                    // Remove currency symbols, dots as thousand separators, spaces
                    const cleaned = String(val).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
                    return Number(cleaned) || 0;
                };

                // Detect "total" summary rows vs detail rows
                const totalKeywords = ['tổng số', 'tong so', 'tổng cộng', 'tong cong', 'tổng số tiền', 'tong so tien', 'total', 'tổng', 'tong', 'cộng', 'cong', 'sum', 'grand total', 'subtotal'];

                const isTotalRow = (row: any): boolean => {
                    // Check all string values in the row for total keywords
                    for (const val of Object.values(row)) {
                        if (typeof val === 'string') {
                            const lower = val.toLowerCase().trim();
                            if (totalKeywords.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.startsWith(kw + ':') || lower.startsWith(kw + '(') || lower.endsWith(' ' + kw) || lower.includes('tổng') || lower.includes('total'))) return true;
                        }
                    }
                    return false;
                };

                const allParsed = rows.map((row, i) => {
                    const rawAmount = findCol(row, ['thành tiền', 'thanh tien', 'số tiền', 'so tien', 'amount', 'tiền', 'tien', 'giá trị', 'gia tri', 'value', 'số tiền (vnđ)', 'money', 'đơn giá', 'don gia']);
                    const rawCat = String(findCol(row, ['hạng mục', 'hang muc', 'category', 'loại chi phí', 'loai chi phi', 'mục', 'muc']) || 'other').toLowerCase().trim();
                    const rawType = String(findCol(row, ['loại', 'loai', 'type', 'loại giao dịch']) || 'expense').toLowerCase().trim();
                    const rawDesc = findCol(row, ['mô tả', 'mo ta', 'description', 'diễn giải', 'dien giai', 'nội dung', 'noi dung', 'ghi chú', 'ghi chu', 'note', 'tên hàng hóa', 'ten hang hoa', 'tên hàng', 'ten hang', 'hàng hóa', 'hang hoa']);
                    const rawDate = findCol(row, ['ngày', 'ngay', 'date', 'ngày giao dịch', 'ngay giao dich']);
                    const amount = parseAmount(rawAmount);
                    const isTotal = isTotalRow(row);
                    console.log(`[DA Import] Row ${i}: amount=${amount}, cat=${rawCat}, type=${rawType}, desc=${rawDesc}, isTotal=${isTotal}`);

                    return {
                        tx: {
                            id: crypto.randomUUID(),
                            projectId: selectedProject?.id || null,
                            projectFinanceId: financeId!,
                            constructionSiteId: effectiveSiteId,
                            type: typeMap[rawType] || 'expense',
                            category: catMap[rawCat] || 'other',
                            amount,
                            description: String(rawDesc || ''),
                            date: parseDate(rawDate),
                            source: 'import' as ProjectTxSource,
                            createdBy: user.id,
                            createdAt: new Date().toISOString(),
                        } as ProjectTransaction,
                        isTotal,
                    };
                }).filter(p => p.tx.amount > 0);

                // If there are total rows → use only those (avoid double-counting with details)
                const totalRows = allParsed.filter(p => p.isTotal);
                const detailRows = allParsed.filter(p => !p.isTotal);
                let txs: ProjectTransaction[];
                let importMode: string;

                if (totalRows.length > 0) {
                    // Merge all total rows into ONE transaction
                    const mergedAmount = totalRows.reduce((sum, p) => sum + p.tx.amount, 0);
                    const mergedDesc = totalRows.map(p => p.tx.description).filter(Boolean).join('; ') || 'Tổng import từ Excel';
                    const mergedTx: ProjectTransaction = {
                        ...totalRows[0].tx,
                        amount: mergedAmount,
                        description: mergedDesc,
                    };
                    txs = [mergedTx];
                    importMode = totalRows.length === 1
                        ? `Tìm thấy 1 dòng tổng → import dòng tổng (bỏ ${detailRows.length} dòng chi tiết)`
                        : `Tìm thấy ${totalRows.length} dòng tổng → cộng lại = ${mergedAmount.toLocaleString('vi-VN')}đ (bỏ ${detailRows.length} dòng chi tiết)`;
                } else {
                    txs = detailRows.map(p => p.tx);
                    importMode = `Không có dòng tổng → import ${txs.length} dòng chi tiết`;
                }
                console.log(`[DA Import] Mode: ${importMode}`);

                if (txs.length > 0) {
                    addProjectTransactions(txs);
                    toast.success(`Import thành công ${txs.length} giao dịch`, importMode);
                } else {
                    const sampleKeys = rows.length > 0 ? Object.keys(rows[0]).join(', ') : 'N/A';
                    toast.warning('Không tìm thấy giao dịch hợp lệ', `Cột trong file: ${sampleKeys}. Cần ít nhất cột Số tiền/Amount.`);
                }
            } catch (err: any) {
                logApiError('ProjectDashboard.transactionImport', err);
                toast.error('Lỗi đọc file giao dịch', getApiErrorMessage(err, 'Không thể đọc file Excel giao dịch.'));
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    };

    const handleDeleteTx = (id: string) => {
        removeProjectTransaction(id);
        setDeleteTxConfirmId(null);
        toast.success('Đã xoá giao dịch', 'Giao dịch dự án đã được xoá.');
    };

    // ========== PROJECT FORM MODAL ==========
    const renderProjectForm = () => {
        if (!showProjectForm) return null;
        const linkedSiteProject = projectForm.constructionSiteId
            ? projectRows.find(p => p.constructionSiteId === projectForm.constructionSiteId && p.id !== editingProject?.id)
            : null;
        const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white';
        const labelCls = 'text-[10px] font-black text-slate-500 uppercase block mb-1';
        const categoryTitle = quickCategoryKind === 'group'
            ? 'Thêm nhóm dự án'
            : quickCategoryKind === 'type'
                ? 'Thêm loại dự án'
                : 'Thêm lĩnh vực';

        const renderCategorySelect = (
            label: string,
            value: string,
            onChange: (value: string) => void,
            items: ProjectMasterCategory[],
            kind: 'group' | 'type' | 'sector',
            placeholder: string,
        ) => (
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className={labelCls}>{label}</label>
                    <button
                        type="button"
                        onClick={() => openQuickCategory(kind)}
                        className="w-6 h-6 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 flex items-center justify-center"
                        title={`Thêm ${label.toLowerCase()}`}
                    >
                        <Plus size={12} />
                    </button>
                </div>
                <select value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} font-bold`}>
                    <option value="">{placeholder}</option>
                    {items.map(item => (
                        <option key={item.id} value={item.id}>{item.name}{item.isActive ? '' : ' (đã ẩn)'}</option>
                    ))}
                </select>
            </div>
        );

        const renderUserMultiSelect = (
            label: string,
            selectedIds: string[],
            onChange: (ids: string[]) => void,
            icon: React.ReactNode,
            selectedGroupIds: string[],
            onGroupChange: (ids: string[]) => void,
        ) => {
            const selectedUsers = selectedIds.map(id => activeUsers.find(u => u.id === id)).filter(Boolean) as typeof activeUsers;
            const availableUsers = activeUsers.filter(u => !selectedIds.includes(u.id));
            const selectedGroups = selectedGroupIds.map(id => workGroupMap.get(id)).filter(Boolean) as WorkGroupWithMembers[];
            const availableGroups = activeWorkGroups.filter(group => !selectedGroupIds.includes(group.id));
            const expandedFromGroups = expandParticipantUserIds([], selectedGroupIds);
            const getGroupMemberCount = (group: WorkGroupWithMembers) =>
                group.members.filter(member => member.isActive && activeUserIdSet.has(member.userId)).length;

            return (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className={labelCls}>{label}</label>
                        {selectedGroups.length > 0 && (
                            <span className="text-[10px] font-black text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-lg">
                                {expandedFromGroups.length} người từ nhóm
                            </span>
                        )}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-2 py-2 min-h-[46px]">
                        <div className="flex flex-wrap gap-2 mb-2">
                            {selectedGroups.map(group => (
                                <span key={group.id} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700 border border-cyan-100">
                                    <Users size={12} />
                                    <span>{group.name}</span>
                                    <span className="text-[9px] text-cyan-500">{getGroupMemberCount(group)} người</span>
                                    <button type="button" onClick={() => onGroupChange(selectedGroupIds.filter(id => id !== group.id))} className="text-cyan-400 hover:text-red-500">
                                        <X size={11} />
                                    </button>
                                </span>
                            ))}
                            {selectedUsers.map(item => {
                                const employee = employeeByUserId.get(item.id);
                                const displayName = item.name || item.username || item.email;
                                return (
                                    <span key={item.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {item.avatar ? <img src={item.avatar} className="w-5 h-5 rounded-full object-cover" /> : <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-[9px]">{displayName?.charAt(0) || '?'}</span>}
                                        <span>{displayName}</span>
                                        {employee?.positionId && <span className="text-[9px] text-slate-400">{hrmPositions.find(p => p.id === employee.positionId)?.name || ''}</span>}
                                        <button type="button" onClick={() => onChange(selectedIds.filter(id => id !== item.id))} className="text-slate-400 hover:text-red-500">
                                            <X size={11} />
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div className="flex items-center gap-1 text-cyan-500 min-w-[170px] rounded-lg bg-cyan-50 px-2">
                                <Users size={13} />
                                <select
                                    value=""
                                    onChange={e => {
                                        if (e.target.value) onGroupChange([...selectedGroupIds, e.target.value]);
                                        e.target.value = '';
                                    }}
                                    className="flex-1 min-w-0 bg-transparent text-xs font-bold outline-none py-2"
                                >
                                    <option value="">{workGroupsLoading ? 'Đang tải nhóm...' : availableGroups.length === 0 ? 'Không còn nhóm' : 'Chọn nhóm làm việc'}</option>
                                    {availableGroups.map(group => (
                                        <option key={group.id} value={group.id}>{group.name} ({getGroupMemberCount(group)} người)</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-1 text-slate-400 min-w-[170px] rounded-lg bg-slate-50 px-2">
                                {icon}
                                <select
                                    value=""
                                    onChange={e => {
                                        if (e.target.value) onChange([...selectedIds, e.target.value]);
                                        e.target.value = '';
                                    }}
                                    className="flex-1 min-w-0 bg-transparent text-xs font-bold outline-none py-1"
                                >
                                    <option value="">{availableUsers.length === 0 ? 'Không còn người dùng' : 'Chọn thành viên'}</option>
                                    {availableUsers.map(item => (
                                        <option key={item.id} value={item.id}>{item.name || item.username || item.email}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            );
        };

        return (
            <>
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl mx-4 max-h-[92vh] overflow-y-auto">
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <span className="font-black text-2xl text-slate-800 block">{editingProject ? 'Cập nhật dự án' : 'Tạo dự án mới'}</span>
                                <span className="text-slate-400 text-sm">
                                    {editingProject ? 'Thông tin tổ chức dự án chỉnh tại tab Tổ chức' : 'Tạo dự án, gắn danh mục, quy trình và seed quyền dự án ngay từ đầu'}
                                </span>
                            </div>
                            <button onClick={() => setShowProjectForm(false)} className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 flex items-center justify-center"><X size={20} /></button>
                        </div>

                        <div className="p-6 space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-x-6 gap-y-4 items-start">
                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Mã dự án</label>
                                <input value={projectForm.code} onChange={e => setProjectForm({ ...projectForm, code: e.target.value })}
                                    placeholder="Nhập mã dự án" className={`${inputCls} font-bold uppercase`} />

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Tên dự án <span className="text-red-500">*</span></label>
                                <input value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })}
                                    placeholder="Nhập tên dự án" className={`${inputCls} font-bold`} />

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Mô tả</label>
                                <textarea value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })}
                                    rows={3} placeholder="Nhập mô tả dự án" className={`${inputCls} resize-y`} />

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Nhóm dự án</label>
                                {renderCategorySelect('Nhóm dự án', projectForm.projectGroupId, value => setProjectForm({ ...projectForm, projectGroupId: value }), activeProjectGroups, 'group', projectMasterDataLoading ? 'Đang tải...' : 'Chọn nhóm dự án')}

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Loại dự án</label>
                                {renderCategorySelect('Loại dự án', projectForm.projectTypeId, value => setProjectForm({ ...projectForm, projectTypeId: value }), activeProjectTypes, 'type', projectMasterDataLoading ? 'Đang tải...' : 'Chọn loại dự án')}

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Lĩnh vực</label>
                                {renderCategorySelect('Lĩnh vực', projectForm.projectSectorId, value => setProjectForm({ ...projectForm, projectSectorId: value }), activeProjectSectors, 'sector', projectMasterDataLoading ? 'Đang tải...' : 'Chọn lĩnh vực')}

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Quy trình</label>
                                <select value={projectForm.workflowTemplateId} onChange={e => setProjectForm({ ...projectForm, workflowTemplateId: e.target.value })} className={`${inputCls} font-bold`}>
                                    <option value="">Chọn quy trình</option>
                                    {activeWorkflowTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                                </select>

                                {!editingProject ? (
                                    <>
                                        <label className="text-sm font-black text-slate-700 md:text-right pt-3">Quản trị dự án</label>
                                        {renderUserMultiSelect('Quản trị dự án', projectForm.adminUserIds, ids => setProjectForm({ ...projectForm, adminUserIds: ids }), <Users size={13} />, projectForm.adminGroupIds, ids => setProjectForm({ ...projectForm, adminGroupIds: ids }))}

                                        <label className="text-sm font-black text-slate-700 md:text-right pt-3">Thực hiện dự án</label>
                                        {renderUserMultiSelect('Thực hiện dự án', projectForm.executorUserIds, ids => setProjectForm({ ...projectForm, executorUserIds: ids }), <UserPlus size={13} />, projectForm.executorGroupIds, ids => setProjectForm({ ...projectForm, executorGroupIds: ids }))}

                                        <label className="text-sm font-black text-slate-700 md:text-right pt-3">Người theo dõi</label>
                                        {renderUserMultiSelect('Người theo dõi', projectForm.watcherUserIds, ids => setProjectForm({ ...projectForm, watcherUserIds: ids }), <Eye size={13} />, projectForm.watcherGroupIds, ids => setProjectForm({ ...projectForm, watcherGroupIds: ids }))}
                                    </>
                                ) : (
                                    <>
                                        <label className="text-sm font-black text-slate-700 md:text-right pt-3">Tổ chức dự án</label>
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                                            Nhân sự, quyền PBAC và người theo dõi của dự án hiện hữu được chỉnh trong tab Tổ chức.
                                        </div>
                                    </>
                                )}

                                <label className="text-sm font-black text-slate-700 md:text-right pt-3">Trạng thái</label>
                                <select value={projectForm.status} onChange={e => setProjectForm({ ...projectForm, status: e.target.value as Project['status'] })} className={`${inputCls} font-bold`}>
                                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                            </div>

                            <div className="border-t border-slate-100 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowProjectAdvanced(prev => !prev)}
                                    className="ml-auto flex items-center gap-2 text-sm font-black text-teal-600 hover:text-teal-700"
                                >
                                    Thông tin khác <ChevronDown size={16} className={`transition-transform ${showProjectAdvanced ? 'rotate-180' : ''}`} />
                                </button>

                                {showProjectAdvanced && (
                                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl bg-slate-50 border border-slate-100 p-4">
                                        <div>
                                            <label className={labelCls}>Chủ đầu tư / Khách hàng</label>
                                            <input value={projectForm.clientName} onChange={e => setProjectForm({ ...projectForm, clientName: e.target.value })}
                                                placeholder="Tên chủ đầu tư" className={inputCls} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Công trường / Địa điểm thi công</label>
                                            <select value={projectForm.constructionSiteId} onChange={e => setProjectForm({ ...projectForm, constructionSiteId: e.target.value })} className={`${inputCls} font-bold`}>
                                                <option value="">Không liên kết công trường</option>
                                                {hrmConstructionSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
                                            </select>
                                            {linkedSiteProject && <p className="text-[10px] text-amber-600 font-bold mt-1">Công trường này đang được liên kết với {linkedSiteProject.name}</p>}
                                        </div>
                                        <div>
                                            <label className={labelCls}>Ngày bắt đầu</label>
                                            <input type="date" value={projectForm.startDate} onChange={e => setProjectForm({ ...projectForm, startDate: e.target.value })} className={inputCls} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Ngày kết thúc dự kiến</label>
                                            <input type="date" value={projectForm.endDate} onChange={e => setProjectForm({ ...projectForm, endDate: e.target.value })} className={inputCls} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Cách tính tiến độ</label>
                                            <select value={projectForm.progressCalculationMode} onChange={e => setProjectForm({ ...projectForm, progressCalculationMode: e.target.value as ProjectProgressCalculationMode })} className={`${inputCls} font-bold`}>
                                                {PROGRESS_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                            </select>
                                        </div>
                                        {projectForm.progressCalculationMode === 'manual' && (
                                            <div>
                                                <label className={labelCls}>Tiến độ thủ công (%)</label>
                                                <input type="number" min={0} max={100} value={projectForm.manualProgressPercent}
                                                    onChange={e => setProjectForm({ ...projectForm, manualProgressPercent: e.target.value })}
                                                    className={`${inputCls} font-bold`} />
                                            </div>
                                        )}
                                        {!editingProject && (
                                            <div className={projectForm.progressCalculationMode === 'manual' ? '' : 'md:col-span-2'}>
                                                <label className={labelCls}>Vị trí mặc định cho thành viên chưa có chức danh</label>
                                                <select value={projectForm.defaultPositionId} onChange={e => setProjectForm({ ...projectForm, defaultPositionId: e.target.value })} className={`${inputCls} font-bold`}>
                                                    <option value="">Chưa chọn</option>
                                                    {sortedPositions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <button onClick={() => setShowProjectForm(false)} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 flex items-center gap-2 w-fit">
                                <X size={15} /> Đóng
                            </button>
                            <div className="flex justify-end gap-2">
                                {editingProject ? (
                                    <button onClick={() => saveProject(true)} disabled={savingProject || !projectForm.name.trim()}
                                        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                        {savingProject ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang lưu...</> : <><Save size={16} /> Lưu dự án</>}
                                    </button>
                                ) : (
                                    <>
                                        <button onClick={() => saveProject(false)} disabled={savingProject || !projectForm.name.trim()}
                                            className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-500 hover:bg-teal-600 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                            {savingProject ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={16} />}
                                            Tạo dự án
                                        </button>
                                        <button onClick={() => saveProject(true)} disabled={savingProject || !projectForm.name.trim()}
                                            className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                            {savingProject ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={16} />}
                                            Tạo và mở chi tiết
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {quickCategoryKind && (
                    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
                        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4 overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <div className="text-base font-black text-slate-800">{categoryTitle}</div>
                                <button onClick={() => setQuickCategoryKind(null)} className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 flex items-center justify-center"><X size={16} /></button>
                            </div>
                            <div className="p-5 space-y-3">
                                <div>
                                    <label className={labelCls}>Tên</label>
                                    <input value={quickCategoryForm.name} onChange={e => setQuickCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                                        className={inputCls} placeholder="Nhập tên danh mục" />
                                </div>
                                <div>
                                    <label className={labelCls}>Mã</label>
                                    <input value={quickCategoryForm.code} onChange={e => setQuickCategoryForm(prev => ({ ...prev, code: e.target.value }))}
                                        className={inputCls} placeholder="Tự sinh nếu trống" />
                                </div>
                                <div>
                                    <label className={labelCls}>Mô tả</label>
                                    <textarea value={quickCategoryForm.description} onChange={e => setQuickCategoryForm(prev => ({ ...prev, description: e.target.value }))}
                                        rows={3} className={`${inputCls} resize-none`} placeholder="Mô tả ngắn" />
                                </div>
                            </div>
                            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
                                <button onClick={() => setQuickCategoryKind(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100">Hủy</button>
                                <button onClick={saveQuickCategory} disabled={!quickCategoryForm.name.trim()}
                                    className="px-5 py-2 rounded-xl text-sm font-black text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2">
                                    <Plus size={14} /> Thêm
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    };

    // ========== BUDGET FORM MODAL ==========
    const renderBudgetForm = () => {
        if (!showBudgetForm || !budgetData) return null;
        const site = hrmConstructionSites.find(s => s.id === budgetData.constructionSiteId);
        const derivedProgress = taskProgressBySite[budgetData.constructionSiteId]?.progressPercent;
        const progressValue = derivedProgress ?? budgetData.progressPercent;
        const budgetCats = [
            { key: 'Materials', label: 'Vật tư', icon: '🧱' },
            { key: 'Labor', label: 'Nhân công', icon: '👷' },
            { key: 'Subcontract', label: 'Thầu phụ', icon: '🏗️' },
            { key: 'Machinery', label: 'Máy móc', icon: '⚙️' },
            { key: 'Overhead', label: 'Quản lý chung', icon: '📋' },
        ];

        return (
            <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
                    <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-orange-500 to-amber-500 rounded-t-3xl flex items-center justify-between">
                        <div className="text-white">
                            <span className="font-bold text-lg block">Kế hoạch & Ngân sách</span>
                            <span className="text-white/80 text-sm">{site?.name}</span>
                        </div>
                        <button onClick={() => setShowBudgetForm(false)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                    </div>
                    <div className="p-6 space-y-5">
                        {/* Contract + Status */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Giá trị HĐ (VNĐ)</label>
                                <input type="number" value={budgetData.contractValue || ''} onChange={e => setBudgetData({ ...budgetData, contractValue: Number(e.target.value) })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày ký HĐ</label>
                                <input type="date" value={budgetData.contractSignDate || ''} onChange={e => setBudgetData({ ...budgetData, contractSignDate: e.target.value })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Dự kiến hoàn thành</label>
                                <input type="date" value={budgetData.estimatedEndDate || ''} onChange={e => setBudgetData({ ...budgetData, estimatedEndDate: e.target.value })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Trạng thái</label>
                                <select value={budgetData.status} onChange={e => setBudgetData({ ...budgetData, status: e.target.value as any })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none">
                                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                            </div>
                        </div>
                        {/* Budget */}
                        <div>
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Ngân sách dự toán (DT)</h3>
                            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2">
                                {budgetCats.map(c => (
                                    <div key={c.key} className="flex items-center gap-3">
                                        <span className="text-lg w-8">{c.icon}</span>
                                        <span className="text-sm font-bold text-slate-700 w-32">{c.label}</span>
                                        <input type="number" value={(budgetData as any)[`budget${c.key}`] || ''}
                                            onChange={e => setBudgetData({ ...budgetData, [`budget${c.key}`]: Number(e.target.value) })}
                                            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0" />
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Progress */}
                        <div className="flex items-center gap-4">
                            <label className="text-xs font-bold text-slate-500">Tiến độ:</label>
                            <input type="range" min={0} max={100} value={progressValue}
                                disabled={derivedProgress !== undefined}
                                onChange={e => setBudgetData({ ...budgetData, progressPercent: Number(e.target.value) })}
                                className="flex-1 accent-orange-500 disabled:opacity-60" />
                            <span className="text-lg font-black text-orange-600 w-14 text-right">{progressValue}%</span>
                        </div>
                        {/* Notes */}
                        <textarea value={budgetData.notes || ''} onChange={e => setBudgetData({ ...budgetData, notes: e.target.value })}
                            placeholder="Ghi chú..." rows={2} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none" />
                    </div>
                    <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                        <button onClick={() => setShowBudgetForm(false)} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                        <button onClick={saveBudget} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl flex items-center gap-2">
                            <Save size={16} /> Lưu
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ========== ADD TX FORM MODAL ==========
    const renderTxForm = () => {
        if (!showTxForm) return null;
        return (
            <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
                    <div className={`px-6 py-4 border-b border-slate-100 rounded-t-3xl flex items-center justify-between ${editingTx ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`}>
                        <span className="font-bold text-lg text-white flex items-center gap-2">{editingTx ? <><Edit2 size={20} /> Chỉnh sửa giao dịch</> : <><Plus size={20} /> Thêm giao dịch</>}</span>
                        <button onClick={resetTxForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                    </div>
                    <div className="p-6 space-y-4 overflow-y-auto flex-1">
                        {/* Type */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại giao dịch</label>
                            <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                                {Object.entries(TX_TYPE_CONFIG).map(([k, v]) => (
                                    <button key={k} onClick={() => setTxType(k as ProjectTxType)}
                                        className={`shrink-0 px-3 whitespace-nowrap py-2 rounded-xl text-xs font-bold border transition-all ${txType === k ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Category (only for expense) */}
                        {txType === 'expense' && (
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Hạng mục chi phí</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                                        <button key={k} onClick={() => setTxCategory(k as ProjectCostCategory)}
                                            className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1 ${txCategory === k ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                            <span>{v.icon}</span> {v.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* Amount + Date */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số tiền (VNĐ)</label>
                                <input type="number" value={txAmount} onChange={e => setTxAmount(e.target.value)} placeholder="0"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày</label>
                                <input type="date" value={txDate} onChange={e => setTxDate(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </div>
                        {/* Description */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                            <input value={txDesc} onChange={e => setTxDesc(e.target.value)} placeholder="VD: Thanh toán nhân công đợt 1..."
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        {/* Attachments */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tệp đính kèm</label>
                            <label
                                htmlFor="tx-file-input-field"
                                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50'); }}
                                onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); }}
                                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); const newFiles = Array.from(e.dataTransfer.files); setTxFiles(prev => [...prev, ...newFiles]); }}
                                className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all block"
                            >
                                <Paperclip size={20} className="mx-auto mb-1 text-slate-300" />
                                <p className="text-xs text-slate-400">Nhấn hoặc kéo thả file vào đây</p>
                                <p className="text-[10px] text-slate-300 mt-0.5">Hình ảnh CK, biên bản nghiệm thu, hoá đơn...</p>
                            </label>
                            <input id="tx-file-input-field" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; console.log('[Attachment] onChange fired, files:', files?.length); if (files && files.length > 0) { const arr: File[] = Array.from(files); console.log('[Attachment] Adding files:', arr.map((f: File) => f.name)); setTxFiles(prev => [...prev, ...arr]); } e.target.value = ''; }} />
                            {txFiles.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {txFiles.map((f, i) => (
                                        <div key={i} className="relative group">
                                            {f.type.startsWith('image/') ? (
                                                <img src={URL.createObjectURL(f)} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center">
                                                    <FileText size={18} className="text-slate-400" />
                                                    <span className="text-[8px] text-slate-400 mt-0.5 truncate w-14 text-center">{f.name.split('.').pop()?.toUpperCase()}</span>
                                                </div>
                                            )}
                                            <button onClick={e => { e.stopPropagation(); setTxFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Existing attachments (edit mode) */}
                    {editingTx && existingAttachments.length > 0 && (
                        <div className="px-6 pb-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tệp đã đính kèm</label>
                            <div className="flex flex-wrap gap-2">
                                {existingAttachments.map((att, i) => (
                                    <div key={i} className="relative group">
                                        {(att.fileType || '').startsWith('image/') ? (
                                            <img src={att.url} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                                        ) : (
                                            <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center">
                                                <FileText size={18} className="text-slate-400" />
                                                <span className="text-[8px] text-slate-400 mt-0.5 truncate w-14 text-center">{att.name.split('.').pop()?.toUpperCase()}</span>
                                            </div>
                                        )}
                                        <button onClick={() => setExistingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                        <button onClick={resetTxForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                        <button onClick={handleAddTx} disabled={!txAmount || Number(txAmount) <= 0 || uploading}
                            className={`px-6 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50 ${editingTx ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`}>
                            {uploading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang tải...</> : editingTx ? <><Save size={16} /> Lưu thay đổi</> : <><Check size={16} /> Thêm giao dịch</>}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderHideProjectModal = () => {
        if (!hideProjectTarget) return null;
        const hasImpact = Boolean(hideProjectImpact?.hasImpact);
        const canConfirm = Boolean(hideProjectImpact) && !hideProjectImpactLoading && hideProjectReason.trim()
            && (!hasImpact || (isAdmin && hideProjectCodeConfirm.trim() === hideProjectTarget.code));
        return (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                    <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
                        <div>
                            <div className="text-lg font-black text-slate-800 flex items-center gap-2">
                                <EyeOff size={20} className="text-red-500" /> Ẩn / Xoá dự án
                            </div>
                            <p className="text-xs font-bold text-slate-400 mt-1">
                                {hideProjectTarget.code} • {hideProjectTarget.name}
                            </p>
                        </div>
                        <button onClick={closeHideProject} disabled={hidingProject} className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 flex items-center justify-center disabled:opacity-50">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="p-6 space-y-4 overflow-y-auto">
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            <div className="font-black">Dữ liệu dự án sẽ không bị xoá vật lý.</div>
                            <div className="text-xs font-bold mt-1">
                                Dự án bị ẩn khỏi vận hành mặc định. Chi phí, nghiệm thu, PO, nhật ký và chứng từ liên quan vẫn được giữ nguyên để đối soát.
                            </div>
                        </div>

                        {hideProjectImpactLoading ? (
                            <div className="rounded-2xl border border-slate-100 p-6 text-center text-slate-400">
                                <Loader2 size={24} className="animate-spin mx-auto mb-2 text-orange-500" />
                                <p className="text-sm font-bold">Đang kiểm tra phát sinh chi phí...</p>
                            </div>
                        ) : hideProjectImpact ? (
                            <div className="rounded-2xl border border-slate-100 overflow-hidden">
                                <div className={`px-4 py-3 border-b border-slate-100 ${hasImpact ? 'bg-red-50' : 'bg-emerald-50'}`}>
                                    <div className={`text-sm font-black ${hasImpact ? 'text-red-700' : 'text-emerald-700'}`}>
                                        {hasImpact
                                            ? `Dự án đã có ${hideProjectImpact.totalRows.toLocaleString('vi-VN')} phát sinh liên quan`
                                            : 'Chưa phát hiện phát sinh chi phí liên quan'}
                                    </div>
                                    {hideProjectImpact.totalAmount > 0 && (
                                        <div className="text-xs font-bold text-red-600 mt-0.5">
                                            Tổng giá trị tham chiếu: {fmtFull(hideProjectImpact.totalAmount)}
                                        </div>
                                    )}
                                </div>
                                {hideProjectImpact.items.length > 0 && (
                                    <div className="divide-y divide-slate-100">
                                        {hideProjectImpact.items.map(item => (
                                            <div key={item.key} className="px-4 py-3 flex items-center justify-between gap-3">
                                                <div className="text-sm font-bold text-slate-700">{item.label}</div>
                                                <div className="text-right">
                                                    <div className="text-sm font-black text-slate-800">{item.count.toLocaleString('vi-VN')} dòng</div>
                                                    {item.totalAmount > 0 && <div className="text-xs font-bold text-slate-400">{fmtFull(item.totalAmount)}</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {hideProjectImpact.warnings.length > 0 && (
                                    <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-1">
                                        {hideProjectImpact.warnings.map(warning => (
                                            <div key={warning} className="text-xs font-bold text-slate-500 flex items-start gap-1.5">
                                                <AlertCircle size={12} className="mt-0.5 shrink-0" /> {warning}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
                                Không kiểm tra được phát sinh. Vui lòng thử lại trước khi ẩn dự án.
                            </div>
                        )}

                        {hasImpact && !isAdmin && (
                            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                                Dự án đã phát sinh chi phí nên tài khoản thường không được xoá/ẩn. Cần làm ngược các bước xoá chi phí trước.
                            </div>
                        )}

                        {hasImpact && isAdmin && (
                            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-red-600 block mb-1">Xác nhận mã dự án</label>
                                <input
                                    value={hideProjectCodeConfirm}
                                    onChange={e => setHideProjectCodeConfirm(e.target.value)}
                                    placeholder={`Nhập đúng mã ${hideProjectTarget.code}`}
                                    className="w-full px-3 py-2.5 rounded-xl border border-red-200 bg-white text-sm font-black outline-none focus:ring-2 focus:ring-red-400"
                                />
                                <p className="text-[11px] font-bold text-red-600 mt-2">
                                    Admin đang force ẩn dự án có phát sinh. Đây là thao tác ẩn khỏi vận hành, không xoá chi phí.
                                </p>
                            </div>
                        )}

                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Lý do ẩn dự án</label>
                            <textarea
                                value={hideProjectReason}
                                onChange={e => setHideProjectReason(e.target.value)}
                                rows={3}
                                placeholder="Nhập lý do để sau này đối soát/khôi phục..."
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                            />
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between gap-3">
                        <button onClick={closeHideProject} disabled={hidingProject} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50">
                            Huỷ
                        </button>
                        <button
                            onClick={handleConfirmHideProject}
                            disabled={!canConfirm || hidingProject || (hasImpact && !isAdmin)}
                            className="px-6 py-2.5 rounded-xl text-sm font-black text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {hidingProject ? <Loader2 size={16} className="animate-spin" /> : <EyeOff size={16} />}
                            {hasImpact && isAdmin ? 'Force ẩn dự án' : 'Ẩn dự án'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ========== OVERVIEW (project detail) ==========
    const renderOverview = () => {
        if (!selectedProject) return null;
        const hasSiteLink = Boolean(effectiveSiteId && selectedSite);
        const financeForRender = selectedFinance || (effectiveSiteId ? emptyFinance(effectiveSiteId) : null);
        const aggForRender = selectedAgg || {
            actualMaterials: 0,
            actualLabor: 0,
            actualSubcontract: 0,
            actualMachinery: 0,
            actualOverhead: 0,
            actualOther: 0,
            revenueReceived: 0,
            revenuePending: 0,
            totalExpense: 0,
            txCount: 0,
        };
        const totalBudget = financeForRender
            ? financeForRender.budgetMaterials + financeForRender.budgetLabor + financeForRender.budgetSubcontract + financeForRender.budgetMachinery + financeForRender.budgetOverhead
            : 0;
        const contractValue = financeForRender?.contractValue || 0;
        const estimatedMargin = contractValue - aggForRender.totalExpense;
        const estimatedMarginPct = contractValue > 0 ? (estimatedMargin / contractValue * 100) : 0;
        const budgetUsed = totalBudget > 0 ? (aggForRender.totalExpense / totalBudget * 100) : 0;
        const statusKey = financeForRender?.status || selectedProject.status || 'planning';
        const displayProgress = financeForRender ? getDisplayProgress(financeForRender) : 0;
        const metaChips = getProjectMetaChips(selectedProject);

        // Chart max value
        const maxVal = Math.max(...BUDGET_CATS.map(c =>
            Math.max((financeForRender as any)?.[`budget${c.key}`] || 0, (aggForRender as any)[c.aggKey] || 0)
        ), 1);
        const renderSiteRequired = (title: string) => (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-sm">
                <Building2 size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-black text-slate-600">{title} cần liên kết công trường HRM</p>
                <p className="text-xs text-slate-400 mt-1">Bấm "Dự án" để chọn công trường đã tạo tại HrmConstructionSite.</p>
            </div>
        );

        return (
            <div className="space-y-6">
                {/* Back + Actions */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <button onClick={() => { setActiveView('list'); setSelectedSiteId(null); setSelectedProjectId(null); }}
                        className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">← Danh sách dự án</button>
                    <div className="flex gap-2 flex-wrap">
                        <button onClick={() => openEditProject(selectedProject)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-all">
                            <Edit2 size={14} /> Dự án
                        </button>
                        {hasSiteLink && (
                            <>
                                <button onClick={() => { resetTxForm(); setShowTxForm(true); }}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all">
                                    <Plus size={14} /> Thêm giao dịch
                                </button>
                                <button onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-all">
                                    <Upload size={14} /> Import Excel
                                </button>
                                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportExcel} />
                                <button onClick={() => effectiveSiteId && openBudgetForm(effectiveSiteId)}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-all">
                                    <Edit2 size={14} /> Ngân sách
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Header Banner */}
                <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl p-6 text-white shadow-xl">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center"><HardHat size={24} /></div>
                            <div>
                                <h2 className="text-2xl font-black">{selectedProject.name}</h2>
                                <p className="text-white/70 text-sm">
                                    {selectedProject.code} • {selectedSite ? `Công trường: ${selectedSite.name}` : 'Chưa liên kết công trường HRM'}
                                </p>
                                {metaChips.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {metaChips.map(chip => (
                                            <span key={chip.label} className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-white/20 text-white border border-white/20">
                                                {chip.label}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="inline-block px-3 py-1 rounded-full text-sm font-bold bg-white/20 mb-1">{STATUS_CONFIG[statusKey]?.label || statusKey}</div>
                            <div className="text-3xl font-black">{displayProgress}%</div>
                        </div>
                    </div>
                    <div className="mt-4 h-3 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${displayProgress}%` }} />
                    </div>
                </div>

                {/* Overview Sub-tabs */}
                <div className="flex gap-1 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm overflow-x-auto [&::-webkit-scrollbar]:hidden">
                    {[
                        { key: 'org' as const, label: 'Tổ chức', icon: '👥' },
                        { key: 'budget' as const, label: 'Ngân sách', icon: '📊' },
                        { key: 'cashflow' as const, label: 'Dòng tiền', icon: '💰' },
                        { key: 'contract' as const, label: 'Hợp đồng', icon: '📋' },
                        { key: 'gantt' as const, label: 'Tiến độ', icon: '📐' },
                        { key: 'dailylog' as const, label: 'Nhật ký', icon: '📝' },
                        { key: 'subcontract' as const, label: 'Nhà thầu', icon: '🏗️' },
                        { key: 'material' as const, label: 'Vật tư', icon: '📦' },
                        { key: 'supply' as const, label: 'Cung ứng', icon: '🚛' },
                        { key: 'documents' as const, label: 'Tài liệu', icon: '📎' },
                        { key: 'report' as const, label: 'Báo cáo', icon: '📊' },
                    ].map(tab => (
                        <button key={tab.key} onClick={() => setOverviewTab(tab.key)}
                            className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                                overviewTab === tab.key ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25' : 'text-slate-500 hover:bg-slate-50'
                            }`}>
                            <span>{tab.icon}</span> {tab.label}
                        </button>
                    ))}
                </div>

                <Suspense fallback={
                    <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm font-bold text-slate-400">
                        <Loader2 size={22} className="mx-auto mb-2 animate-spin text-orange-500" />
                        Đang tải tab...
                    </div>
                }>
                    {overviewTab === 'org' ? (
                        <ProjectOrgTab projectId={selectedProject.id} constructionSiteId={effectiveSiteId} />
                    ) : overviewTab === 'cashflow' ? (
                        hasSiteLink ? (
                            <CashFlowTab
                                constructionSiteId={effectiveSiteId!}
                                transactions={projectTransactions.filter(t => t.constructionSiteId === effectiveSiteId)}
                                contractValue={contractValue}
                            />
                        ) : renderSiteRequired('Dòng tiền')
                    ) : overviewTab === 'contract' ? (
                        <ContractTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} />
                    ) : overviewTab === 'gantt' ? (
                        <GanttTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} />
                    ) : overviewTab === 'dailylog' ? (
                        <DailyLogTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} />
                    ) : overviewTab === 'subcontract' ? (
                        <SubcontractTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} />
                    ) : overviewTab === 'material' ? (
                        <MaterialTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} />
                    ) : overviewTab === 'supply' ? (
                        <SupplyChainTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} />
                    ) : overviewTab === 'report' ? (
                        hasSiteLink ? (
                            <ReportTab
                                constructionSiteId={effectiveSiteId!}
                                projectId={selectedProject.id}
                                contractValue={contractValue}
                                totalSpent={aggForRender.totalExpense}
                            />
                        ) : renderSiteRequired('Báo cáo')
                    ) : overviewTab === 'documents' ? (
                        <DocumentsTab constructionSiteId={effectiveSiteId || undefined} projectId={selectedProject.id} uploadedBy={user?.name} />
                    ) : (
                <>
                {/* KPI Cards — AUTO-AGGREGATED */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div onClick={() => setOverviewTab('contract')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-indigo-500 transition-colors"><FileText size={12} /> Giá trị HĐ</div>
                        <div className="text-xl font-black text-slate-800">{fmt(contractValue)}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{fmtFull(contractValue)}</div>
                    </div>
                    <div onClick={() => setOverviewTab('budget')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-orange-500 transition-colors"><DollarSign size={12} /> Chi phí thực tế</div>
                        <div className="text-xl font-black text-slate-800">{fmt(aggForRender.totalExpense)}</div>
                        <div className={`text-[10px] mt-1 font-bold flex items-center gap-1 ${budgetUsed > 100 ? 'text-red-500' : 'text-emerald-500'}`}>
                            {budgetUsed > 100 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />} {budgetUsed.toFixed(1)}% ngân sách
                        </div>
                    </div>
                    <div onClick={() => setOverviewTab('cashflow')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
	                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-emerald-500 transition-colors"><TrendingUp size={12} /> Biên tạm tính</div>
	                        <div className={`text-xl font-black ${estimatedMargin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(estimatedMargin)}</div>
	                        <div className={`text-[10px] mt-1 font-bold ${estimatedMarginPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
	                            {estimatedMarginPct >= 0 ? '+' : ''}{estimatedMarginPct.toFixed(1)}%
                        </div>
                    </div>
                    <div onClick={() => setOverviewTab('cashflow')} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer group">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 group-hover:text-cyan-500 transition-colors"><Target size={12} /> Thu / Chờ thu</div>
                        <div className="text-xl font-black text-emerald-600">{fmt(aggForRender.revenueReceived)}</div>
                        <div className="text-[10px] text-amber-500 font-bold mt-1">Chờ: {fmt(aggForRender.revenuePending)}</div>
                    </div>
                </div>

                {/* Budget Chart + Cash Flow */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Budget vs Actual */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                        <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-orange-500" /> Dự toán vs Thực tế (tự động)</h3>
                        <div className="space-y-4">
                            {BUDGET_CATS.map(cat => {
                                const budget = (financeForRender as any)?.[`budget${cat.key}`] || 0;
                                const actual = (aggForRender as any)[cat.aggKey] || 0;
                                const diff = actual - budget;
                                return (
                                    <div key={cat.key}
                                        onClick={() => { setTxFilter(txFilter === cat.filterKey ? 'all' : cat.filterKey); document.getElementById('tx-list-section')?.scrollIntoView({ behavior: 'smooth' }); }}
                                        className={`cursor-pointer rounded-xl p-2 -mx-2 transition-all hover:bg-slate-50 ${txFilter === cat.filterKey ? 'ring-2 ring-offset-1 bg-slate-50 scale-[1.02]' : ''}`}
                                        style={txFilter === cat.filterKey ? { '--tw-ring-color': cat.color } as any : {}}
                                    >
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2"><span className="text-lg">{cat.icon}</span><span className="text-sm font-bold text-slate-700">{cat.label}</span>{txFilter === cat.filterKey && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ backgroundColor: cat.color }}>Đang lọc</span>}</div>
                                            <div className="flex items-center gap-3 text-xs">
                                                <span className="text-slate-400">DT: <span className="font-bold text-slate-600">{fmt(budget)}</span></span>
                                                <span className="text-slate-400">TT: <span className={`font-bold ${diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(actual)}</span></span>
                                                {diff !== 0 && <span className={`font-bold px-1.5 py-0.5 rounded ${diff > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>}
                                            </div>
                                        </div>
                                        <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="absolute inset-y-0 left-0 rounded-full opacity-30 transition-all duration-700" style={{ width: `${maxVal > 0 ? (budget / maxVal) * 100 : 0}%`, backgroundColor: cat.color }} />
                                            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${maxVal > 0 ? (actual / maxVal) * 100 : 0}%`, backgroundColor: cat.color }} />
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="flex items-center gap-6 pt-2 border-t border-slate-100 text-xs text-slate-400">
                                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-slate-300 opacity-40" /> Dự toán</div>
                                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-slate-500" /> Thực tế (từ giao dịch)</div>
                            </div>
                        </div>
                    </div>

                    {/* Cash Flow */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                        <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><DollarSign size={16} className="text-emerald-500" /> Dòng tiền</h3>
                        <div className="space-y-2.5">
                            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border border-blue-100">
                                <span className="text-sm font-bold text-blue-700">Giá trị HĐ (A)</span>
                                <span className="text-sm font-black text-blue-700">{fmtFull(contractValue)}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                                <span className="text-sm font-bold text-emerald-700">Đã thanh toán</span>
                                <span className="text-sm font-black text-emerald-700">+ {fmtFull(aggForRender.revenueReceived)}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-amber-50 rounded-xl border border-amber-100">
                                <span className="text-sm font-bold text-amber-700">Chờ nghiệm thu</span>
                                <span className="text-sm font-black text-amber-700">{fmtFull(aggForRender.revenuePending)}</span>
                            </div>
                            <div className="border-t-2 border-dashed border-slate-200 my-1" />
                            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                                <span className="text-sm font-bold text-slate-700">Tổng ngân sách (DT)</span>
                                <span className="text-sm font-black text-slate-700">{fmtFull(totalBudget)}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-orange-50 rounded-xl border border-orange-200">
                                <span className="text-sm font-bold text-orange-700">Tổng chi thực tế ({aggForRender.txCount} GD)</span>
                                <span className="text-sm font-black text-orange-700">- {fmtFull(aggForRender.totalExpense)}</span>
                            </div>
	                            <div className={`flex justify-between items-center p-4 rounded-xl border-2 ${estimatedMargin >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
	                                <span className={`text-sm font-black uppercase ${estimatedMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{estimatedMargin >= 0 ? 'Biên doanh thu - chi' : 'Âm theo chi hiện tại'}</span>
	                                <span className={`text-lg font-black ${estimatedMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{estimatedMargin >= 0 ? '+' : ''}{fmtFull(estimatedMargin)}</span>
	                            </div>
                        </div>
                    </div>
                </div>

                {/* Transaction List */}
                <div id="tx-list-section" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <List size={16} /> Danh sách giao dịch ({siteTxs.length})
                        </h3>
                        <div className="flex items-center gap-2">
                            <select value={txFilter} onChange={e => setTxFilter(e.target.value as any)}
                                className="text-xs font-bold text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-orange-500 outline-none">
                                <option value="all">Tất cả</option>
                                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {siteTxs.length === 0 ? (
                        <div className="p-12 text-center">
                            <DollarSign size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có giao dịch nào</p>
                            <p className="text-xs text-slate-300 mt-1">Nhấn "Thêm giao dịch" hoặc "Import Excel" để bắt đầu</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {siteTxs.map(tx => {
                                const catCfg = CATEGORY_CONFIG[tx.category];
                                const typeCfg = TX_TYPE_CONFIG[tx.type];
                                const srcCfg = SOURCE_CONFIG[tx.source];
                                const hasAttachments = tx.attachments && tx.attachments.length > 0;
                                return (
                                    <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/50 transition-colors group">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <span className="text-lg">{catCfg?.icon || '📄'}</span>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-1.5">
                                                    {tx.description || '—'}
                                                    {hasAttachments && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 text-violet-500 text-[10px] font-bold shrink-0">
                                                            <Paperclip size={9} /> {tx.attachments!.length}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] flex-wrap">
                                                    <span className={`font-bold px-1.5 py-0.5 rounded ${typeCfg?.color}`}>{typeCfg?.label}</span>
                                                    <span className="text-slate-400">{catCfg?.label}</span>
                                                    <span className="text-slate-300">•</span>
                                                    <span className="text-slate-400">{tx.date}</span>
                                                    <span className="text-slate-300">•</span>
                                                    <span className="text-slate-400">{srcCfg?.icon} {srcCfg?.label}</span>
                                                </div>
                                                {hasAttachments && (
                                                    <div className="flex gap-1.5 mt-1.5">
                                                        {tx.attachments!.map((att, ai) => (
                                                            <button key={ai} onClick={() => setPreviewUrl(att.url)} className="group/att relative">
                                                                {(att.fileType || '').startsWith('image/') ? (
                                                                    <img src={att.url} className="w-10 h-10 object-cover rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all" />
                                                                ) : (
                                                                    <div className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center hover:border-blue-400 transition-all">
                                                                        <FileText size={12} className="text-slate-400" />
                                                                        <span className="text-[7px] text-slate-400">{att.name.split('.').pop()?.toUpperCase()}</span>
                                                                    </div>
                                                                )}
                                                                <div className="absolute inset-0 rounded-lg bg-black/0 group-hover/att:bg-black/20 flex items-center justify-center transition-all">
                                                                    <Eye size={12} className="text-white opacity-0 group-hover/att:opacity-100 transition-opacity" />
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-black ${tx.type === 'expense' ? 'text-red-500' : 'text-emerald-600'}`}>
                                                {tx.type === 'expense' ? '-' : '+'}{fmtFull(tx.amount)}
                                            </span>
                                            <button onClick={() => openEditTx(tx)}
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100">
                                                <Edit2 size={13} />
                                            </button>
                                            {deleteTxConfirmId === tx.id ? (
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => handleDeleteTx(tx.id)} className="px-2 py-1 rounded-lg bg-red-500 text-white text-[10px] font-black">Xoá</button>
                                                    <button onClick={() => setDeleteTxConfirmId(null)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black">Huỷ</button>
                                                </div>
                                            ) : (
                                                <button onClick={() => setDeleteTxConfirmId(tx.id)}
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                </>
                    )}
                </Suspense>
            </div>
        );
    };

    // ========== PROJECT LIST VIEW ==========
    const renderList = () => (
        <div className="space-y-6">
            {projectRows.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-5 text-white shadow-lg">
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">Tổng giá trị HĐ</div>
                        <div className="text-2xl font-black">{fmt(allStats.totalContract)}</div>
                        <div className="text-xs opacity-60 mt-1">{filteredProjectRows.length}/{projectRows.length} dự án</div>
                    </div>
                    <div className="bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl p-5 text-white shadow-lg">
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">Tổng chi thực tế</div>
                        <div className="text-2xl font-black">{fmt(allStats.totalActual)}</div>
                        <div className="text-xs opacity-60 mt-1">NS: {fmt(allStats.totalBudget)}</div>
                    </div>
                    <div className={`bg-gradient-to-br ${allStats.profit >= 0 ? 'from-emerald-500 to-green-600' : 'from-red-500 to-rose-600'} rounded-2xl p-5 text-white shadow-lg`}>
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">{allStats.profit >= 0 ? 'Biên tạm tính' : 'Âm theo chi hiện tại'}</div>
                        <div className="text-2xl font-black">{fmt(allStats.profit)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg">
                        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">Tiến độ TB</div>
                        <div className="text-2xl font-black">{allStats.avgProgress.toFixed(0)}%</div>
                        <div className="text-xs opacity-60 mt-1">Thu: {fmt(allStats.totalRevenue)}</div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider">Danh sách dự án</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {filteredProjectRows.length} đang hiển thị • {projectRows.length} tổng dự án • {hrmConstructionSites.length} công trường HRM có thể liên kết
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleDownloadProjectTemplate} disabled={projectExporting}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
                            {projectExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Xuất mẫu
                        </button>
                        {canManageProjects && (
                            <>
                                <button onClick={() => openProjectImport('create')} disabled={projectImporting}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50">
                                    {projectImporting && projectImportMode === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Nhập mới
                                </button>
                                <button onClick={() => openProjectImport('update')} disabled={projectImporting}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50">
                                    {projectImporting && projectImportMode === 'update' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Cập nhật
                                </button>
                            </>
                        )}
                        <input ref={projectImportInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleProjectImportExcel} />
                        <button onClick={handleExportProjectList} disabled={projectExporting}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
                            {projectExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Xuất danh sách
                        </button>
                        {canManageProjects && (
                            <button onClick={openCreateProject}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20 hover:shadow-xl transition-all">
                                <Plus size={14} /> Thêm dự án
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="flex flex-col lg:flex-row gap-3">
                        <div className="relative flex-1 min-w-0">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                            <input
                                value={projectFilters.query}
                                onChange={e => setProjectFilters(prev => ({ ...prev, query: e.target.value }))}
                                placeholder="Tìm mã, tên, khách hàng, công trường..."
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowProjectAdvancedFilters(prev => !prev)}
                            aria-expanded={showProjectAdvancedFilters}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs font-black text-slate-700 hover:bg-slate-100 lg:w-auto"
                        >
                            <Filter size={15} />
                            Tìm kiếm nâng cao
                            {projectAdvancedFilterCount > 0 && (
                                <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] text-white">
                                    {projectAdvancedFilterCount}
                                </span>
                            )}
                            <ChevronDown size={15} className={`transition-transform ${showProjectAdvancedFilters ? 'rotate-180' : ''}`} />
                        </button>
                    </div>

                    {showProjectAdvancedFilters && (
                        <div className="mt-4 border-t border-slate-100 pt-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Trạng thái</label>
                                    <select value={projectFilters.status} onChange={e => setProjectFilters(prev => ({ ...prev, status: e.target.value as ProjectFilterState['status'] }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="all">Tất cả trạng thái</option>
                                        {Object.entries(STATUS_CONFIG).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Nhóm dự án</label>
                                    <select value={projectFilters.groupId} onChange={e => setProjectFilters(prev => ({ ...prev, groupId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="all">Tất cả nhóm</option>
                                        {projectGroups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Loại dự án</label>
                                    <select value={projectFilters.typeId} onChange={e => setProjectFilters(prev => ({ ...prev, typeId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="all">Tất cả loại</option>
                                        {projectTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Lĩnh vực</label>
                                    <select value={projectFilters.sectorId} onChange={e => setProjectFilters(prev => ({ ...prev, sectorId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="all">Tất cả lĩnh vực</option>
                                        {projectSectors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Quy trình</label>
                                    <select value={projectFilters.workflowId} onChange={e => setProjectFilters(prev => ({ ...prev, workflowId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="all">Tất cả quy trình</option>
                                        {workflowTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Công trường</label>
                                    <select value={projectFilters.siteLink} onChange={e => setProjectFilters(prev => ({ ...prev, siteLink: e.target.value as ProjectSiteFilter }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="all">Liên kết công trường</option>
                                        <option value="linked">Đã liên kết</option>
                                        <option value="unlinked">Chưa liên kết</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Bắt đầu từ</label>
                                    <input type="date" value={projectFilters.startFrom} onChange={e => setProjectFilters(prev => ({ ...prev, startFrom: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Bắt đầu đến</label>
                                    <input type="date" value={projectFilters.startTo} onChange={e => setProjectFilters(prev => ({ ...prev, startTo: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Kết thúc từ</label>
                                    <input type="date" value={projectFilters.endFrom} onChange={e => setProjectFilters(prev => ({ ...prev, endFrom: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Kết thúc đến</label>
                                    <input type="date" value={projectFilters.endTo} onChange={e => setProjectFilters(prev => ({ ...prev, endTo: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Sắp xếp</label>
                                    <select value={projectSort} onChange={e => setProjectSort(e.target.value as ProjectSortKey)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                        <option value="updatedAt">Cập nhật mới</option>
                                        <option value="code">Mã dự án</option>
                                        <option value="name">Tên dự án</option>
                                        <option value="startDate">Ngày bắt đầu</option>
                                        <option value="contractValue">Giá trị HĐ</option>
                                        <option value="actualCost">Chi phí thực tế</option>
                                        <option value="profit">Lợi nhuận tạm tính</option>
                                        <option value="progress">Tiến độ</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Thứ tự</label>
                                    <button onClick={() => setProjectSortAsc(prev => !prev)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-black text-slate-600 hover:bg-slate-50">
                                        {projectSortAsc ? 'Tăng dần' : 'Giảm dần'}
                                    </button>
                                </div>
                                {isAdmin && (
                                    <div>
                                        <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Dự án ẩn</label>
                                        <select value={projectFilters.hidden} onChange={e => setProjectFilters(prev => ({ ...prev, hidden: e.target.value as ProjectHiddenFilter }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-orange-500">
                                            <option value="active">Đang hoạt động</option>
                                            <option value="hidden">Đã ẩn</option>
                                            <option value="all">Tất cả</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className="mt-4 flex justify-end">
                                <button
                                    onClick={() => {
                                        setProjectFilters(emptyProjectFilters());
                                        setProjectSort('updatedAt');
                                        setProjectSortAsc(false);
                                    }}
                                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-slate-50"
                                >
                                    Xoá lọc
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {projectLoadError && projects.length === 0 && hrmConstructionSites.length > 0 && (
                    <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs font-bold text-amber-700">
                        Đang dùng dữ liệu công trường cũ làm fallback. Cần chạy migration `projects` để bật luồng dự án mới.
                    </div>
                )}

                {projectsLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-8 h-8 border-2 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-sm font-bold text-slate-400">Đang tải danh sách dự án...</p>
                    </div>
                ) : projectRows.length === 0 ? (
                    <div className="p-12 text-center">
                        <Building2 size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-sm font-bold text-slate-500">Chưa có dự án nào</p>
                        <p className="text-xs text-slate-400 mt-1">Bấm "Thêm dự án" để tạo dự án, sau đó cấu hình nhân sự tại tab Tổ chức.</p>
                    </div>
                ) : filteredProjectRows.length === 0 ? (
                    <div className="p-12 text-center">
                        <Search size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-sm font-bold text-slate-500">Không có dự án phù hợp bộ lọc</p>
                        <p className="text-xs text-slate-400 mt-1">Thử xoá bớt điều kiện lọc hoặc chuyển trạng thái ẩn nếu là Admin.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filteredProjectRows.map(project => {
                            const metrics = getProjectListMetrics(project);
                            const site = metrics.site;
                            const finance = metrics.finance;
                            const status = finance?.status || project.status || 'planning';
                            const metaChips = getProjectMetaChips(project);

                            return (
                                <div key={project.id} className={`flex items-center justify-between p-4 transition-colors group ${project.isHidden ? 'bg-slate-50/70 hover:bg-slate-100/70' : 'hover:bg-slate-50/50'}`}>
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${project.isHidden ? 'bg-slate-200 text-slate-500' : site ? 'bg-orange-50 text-orange-500' : 'bg-slate-100 text-slate-400'}`}>
                                            {project.isHidden ? <EyeOff size={18} /> : site ? <HardHat size={18} /> : <Building2 size={18} />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className={`text-sm font-bold truncate ${project.isHidden ? 'text-slate-500' : 'text-slate-800'}`}>{project.name}</div>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold shrink-0">{project.code}</span>
                                                {project.isHidden && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 font-black shrink-0">Đã ẩn</span>}
                                            </div>
                                            <div className="text-xs text-slate-400 truncate">
                                                {site ? `Công trường: ${site.name}` : 'Chưa liên kết công trường HRM'}
                                                {project.clientName ? ` • ${project.clientName}` : ''}
                                                {project.hiddenReason ? ` • Lý do ẩn: ${project.hiddenReason}` : ''}
                                            </div>
                                            {metaChips.length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {metaChips.map(chip => (
                                                        <span key={chip.label} className={`px-1.5 py-0.5 rounded-md border text-[9px] font-black ${chip.tone}`}>
                                                            {chip.label}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_CONFIG[status]?.bg || 'bg-slate-50 border-slate-200'} ${STATUS_CONFIG[status]?.color || 'text-slate-500'}`}>
                                            {STATUS_CONFIG[status]?.label || status}
                                        </div>
                                        <div className="text-right hidden md:block">
                                            <div className="text-xs font-bold text-slate-600">{fmt(metrics.contractValue)}</div>
                                            <div className={`text-[10px] font-bold ${metrics.profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {site ? `${metrics.profit >= 0 ? '+' : ''}${fmt(metrics.profit)} (${metrics.txCount} GD)` : 'Chưa có dữ liệu hiện trường'}
                                            </div>
                                        </div>
                                        <div className="w-20 hidden lg:block">
                                            <div className="text-[10px] font-bold text-slate-500 mb-0.5">{metrics.progress}%</div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-orange-500 rounded-full" style={{ width: `${metrics.progress}%` }} />
                                            </div>
                                        </div>
                                        {canManageProjects && !project.isHidden && (
                                            <button onClick={() => openEditProject(project)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-700 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all" title="Sửa dự án">
                                                <Edit2 size={14} />
                                            </button>
                                        )}
                                        {canManageProjects && !project.isHidden && (
                                            <button onClick={() => openHideProject(project)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all" title="Ẩn / xoá dự án">
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                        {isAdmin && project.isHidden && (
                                            <button onClick={() => handleRestoreProject(project)} disabled={restoringProjectId === project.id}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center text-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50" title="Khôi phục dự án">
                                                {restoringProjectId === project.id ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
                                            </button>
                                        )}
                                        {site && !finance && !project.isHidden && (
                                            <button onClick={() => openBudgetForm(site.id)}
                                                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 opacity-0 group-hover:opacity-100 transition-all">
                                                Ngân sách
                                            </button>
                                        )}
                                        <button onClick={() => openProjectDetail(project)}
                                            className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 opacity-0 group-hover:opacity-100 transition-all">
                                            Xem chi tiết
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    // ========== MAIN ==========
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
                    <BarChart3 size={24} className="text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white">Tổng quan Dự án</h1>
                    <p className="text-sm text-slate-500">Chi phí tự động cập nhật từ giao dịch • Import • Workflow</p>
                </div>
            </div>

            {projectImportPreview && (
                <ExcelImportReviewModal
                    title={projectImportPreview.mode === 'create' ? 'Preview nhập mới dự án' : 'Preview cập nhật dự án'}
                    preview={projectImportPreview}
                    loading={projectImporting}
                    onClose={() => setProjectImportPreview(null)}
                    onConfirm={handleConfirmProjectImport}
                />
            )}

            {activeView === 'list' && renderList()}
            {activeView === 'overview' && renderOverview()}
            {renderProjectForm()}
            {renderBudgetForm()}
            {renderTxForm()}
            {renderHideProjectModal()}

            {/* Lightbox Preview */}
            {previewUrl && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="relative max-w-4xl max-h-[90vh] mx-4">
                        <button onClick={() => setPreviewUrl(null)} className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:text-red-500"><X size={16} /></button>
                        {previewUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i) ? (
                            <img src={previewUrl} className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
                        ) : (
                            <div className="bg-white rounded-2xl p-8 text-center shadow-2xl">
                                <FileText size={48} className="mx-auto mb-3 text-slate-400" />
                                <p className="text-sm font-bold text-slate-700 mb-3">{previewUrl.split('/').pop()}</p>
                                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-blue-500 hover:bg-blue-600">
                                    <Download size={14} /> Tải xuống
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectDashboard;
