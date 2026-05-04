import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import GateStateMachineModal from '../../components/project/GateStateMachineModal';
import {
    Plus, Edit2, Trash2, X, Save, ChevronRight, ChevronDown, Flag,
    ZoomIn, ZoomOut, LayoutList, BarChart3, Columns, Search,
    Filter, Calendar, User, Clock, AlertTriangle, CheckCircle2,
    Circle, PlayCircle, ArrowUpDown, ChevronUp, Copy,
    Anchor, Link2, Shield, Wrench, Users, Zap, Lock, Bell,
    FlaskConical, Lightbulb, RotateCcw, Check,
    Upload, Download, FileSpreadsheet, Loader2, XCircle, Eye
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ProjectTask, ProjectBaseline, TaskDependencyType, ResourceType, DailyLog, GateStatus, ProjectTaskProgressMode, ContractItem, ProjectStaff } from '../../types';
import { taskService, baselineService, dailyLogService } from '../../lib/projectService';
import { contractItemService } from '../../lib/contractItemService';
import { taskContractItemService } from '../../lib/taskContractItemService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { notificationService } from '../../lib/notificationService';
import { computeCriticalPath, getDelayDays, rippleEffect, type CriticalPathResult } from '../../lib/criticalPathEngine';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
    applyProgressGateTransition,
    calculateProjectProgress,
    collectDescendantTaskIds,
    getGateBlockedTaskIds,
    getProjectTaskStatus,
    getTaskRelatedPhotoLog,
    removeTasksAndReferences,
    validateProjectTaskDraft,
    type ProjectTaskStatus,
} from '../../lib/projectScheduleRules';

interface GanttTabProps {
    constructionSiteId?: string;
    projectId?: string;
}

// ============= CONSTANTS =============
const COLORS = ['#f97316', '#0ea5e9', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#f43f5e', '#14b8a6'];
const WEATHER_ICONS: Record<string, string> = { sunny: '☀️', cloudy: '⛅', rainy: '🌧️', storm: '⛈️' };
const WEATHER_COLORS: Record<string, string> = { sunny: '', cloudy: '', rainy: 'bg-blue-200/60 dark:bg-blue-800/40', storm: 'bg-red-200/60 dark:bg-red-800/40' };
// Row height must be identical on BOTH the table (left) and Gantt bars (right) to stay aligned
const ROW_HEIGHT = 44; // px
const GANTT_HEADER_HEIGHT = 53; // px — must match left <thead> height

type ViewMode = 'table' | 'gantt' | 'split';
type TaskStatus = ProjectTaskStatus;
type SortField = 'name' | 'startDate' | 'endDate' | 'progress' | 'assignee' | 'status';
type SortDir = 'asc' | 'desc';
type ExcelImportRow = Record<string, unknown>;

// ============= HELPERS =============
const daysBetween = (a: string, b: string) => {
    const d1 = new Date(a), d2 = new Date(b);
    return Math.ceil((d2.getTime() - d1.getTime()) / 86400000);
};

const addDays = (d: string, n: number) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().split('T')[0];
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtShort = (d: string) => new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
const today = () => new Date().toISOString().split('T')[0];

const getStatus = (t: ProjectTask): TaskStatus => {
    return getProjectTaskStatus(t, today());
};

const toIsoDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const parseExcelDate = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (!parsed) return null;
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }

    const raw = String(value).trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    const vi = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (vi) return `${vi[3]}-${vi[2].padStart(2, '0')}-${vi[1].padStart(2, '0')}`;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 20000) return parseExcelDate(numeric);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : toIsoDate(parsed);
};

const parseProgress = (value: unknown): number => {
    const progress = Number(value || 0);
    if (!Number.isFinite(progress)) return 0;
    return Math.max(0, Math.min(100, Math.round(progress)));
};

const getTaskUnit = (task: ProjectTask, linkedIds: string[], contractItems: ContractItem[]): string => {
    if (linkedIds.length === 1) {
        const ci = contractItems.find(c => c.id === linkedIds[0]);
        return ci?.unit || task.fallbackUnit || '–';
    }
    if (linkedIds.length > 1) {
        const units = linkedIds.map(id => contractItems.find(c => c.id === id)?.unit).filter(Boolean);
        return units.length > 0 ? 'Nhiều' : (task.fallbackUnit || 'Nhiều');
    }
    return task.fallbackUnit || '–';
};

const getTaskUnitTitle = (task: ProjectTask, linkedIds: string[], contractItems: ContractItem[]): string => {
    if (linkedIds.length <= 1) return '';
    return linkedIds.map(id => contractItems.find(c => c.id === id)?.unit).filter(Boolean).join(', ');
};

const deriveActualDates = (task: ProjectTask, allLogs: DailyLog[], linkedContractItemIds: string[] = []) => {
    let start = task.actualStartDate;
    let end = task.actualEndDate;
    const linkedSet = new Set(linkedContractItemIds);

    if (!start || !end) {
        const taskLogs = allLogs.filter(log => {
            const verified = log.status === 'verified' || log.verified;
            if (!verified) return false;
            const hasDelayLink = (log.delayTasks || []).some(d => d.taskId === task.id);
            const hasVolumeLink = (log.volumes || []).some(v => v.taskId === task.id || linkedSet.has(v.contractItemId));
            return hasDelayLink || hasVolumeLink;
        });
        if (taskLogs.length > 0) {
            const sortedDates = taskLogs.map(l => l.date).sort();
            if (!start) start = sortedDates[0];
            if (!end && (task.progress === 100 || task.gateStatus === 'approved')) {
                end = sortedDates[sortedDates.length - 1];
            }
        }
    }

    // Fallback end to gateApprovedAt if approved
    if (!end && task.gateStatus === 'approved' && task.gateApprovedAt) {
        end = task.gateApprovedAt.split('T')[0];
    }

    return { derivedStart: start, derivedEnd: end };
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; icon: any }> = {
    not_started: { label: 'Chưa BĐ', color: 'text-slate-500', bg: 'bg-slate-100', icon: Circle },
    in_progress: { label: 'Đang TH', color: 'text-blue-600', bg: 'bg-blue-50', icon: PlayCircle },
    pending_gate: { label: 'Chờ NT', color: 'text-amber-600', bg: 'bg-amber-50', icon: Shield },
    completed: { label: 'Hoàn thành', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle2 },
    overdue: { label: 'Trễ hạn', color: 'text-red-600', bg: 'bg-red-50', icon: AlertTriangle },
};

const getStatusLabel = (status: TaskStatus) => STATUS_CONFIG[status]?.label || 'Không rõ';

const ALL_PROJECT_PERMISSION_CODES: ProjectPermissionCode[] = ['view', 'edit', 'submit', 'verify', 'confirm', 'approve'];

const PROJECT_PERMISSION_HINTS: Record<ProjectPermissionCode, string> = {
    view: 'xem dữ liệu tiến độ',
    edit: 'tạo, sửa hoặc xoá hạng mục tiến độ',
    submit: 'gửi hạng mục vào luồng nghiệm thu',
    verify: 'xác nhận kỹ thuật',
    confirm: 'xác nhận nghiệp vụ',
    approve: 'duyệt hoặc từ chối nghiệm thu',
};

// ============= COMPONENTS =============

/** Status Badge */
const StatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
    const cfg = STATUS_CONFIG[status];
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cfg.color} ${cfg.bg}`}>
            <Icon size={10} /> {cfg.label}
        </span>
    );
};

/** Progress bar with inline edit */
const ProgressCell: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => {
    const color = value >= 100 ? '#10b981' : value > 0 ? '#3b82f6' : '#cbd5e1';
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden cursor-pointer group relative"
                onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                    onChange(Math.max(0, Math.min(100, Math.round(pct / 5) * 5)));
                }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${value}%`, backgroundColor: color }} />
            </div>
            <span className={`text-[11px] font-bold w-8 text-right ${value >= 100 ? 'text-emerald-600' : value > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                {value}%
            </span>
        </div>
    );
};

// ============= MAIN COMPONENT =============
const GanttTab: React.FC<GanttTabProps> = ({ constructionSiteId, projectId }) => {
    const { projectFinances, updateProjectFinance, user } = useApp();
    const toast = useToast();
    const effectiveId = projectId || constructionSiteId || '';
    // Data
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [baselines, setBaselines] = useState<ProjectBaseline[]>([]);
    const [activeBaseline, setActiveBaseline] = useState<ProjectBaseline | null>(null);
    const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
    const [contractItems, setContractItems] = useState<ContractItem[]>([]);
    const [taskContractLinks, setTaskContractLinks] = useState<Record<string, string[]>>({});
    const [projectStaff, setProjectStaff] = useState<ProjectStaff[]>([]);
    const [projectPerms, setProjectPerms] = useState<Set<ProjectPermissionCode>>(new Set());
    const [pbacLoaded, setPbacLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showBaselinePanel, setShowBaselinePanel] = useState(false);
    // GĐ2: Drag state for ripple + ghosting
    const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
    const [dragGhost, setDragGhost] = useState<{ taskId: string; origLeft: number; origWidth: number; deltaDays: number; weatherWarn: string | null } | null>(null);
    const [showWorkload, setShowWorkload] = useState(false);
    // GĐ2: Gate State Machine
    const [gateModalTask, setGateModalTask] = useState<ProjectTask | null>(null);
    const [showGatePanel, setShowGatePanel] = useState(false);
    // GĐ5: Sandbox + AI
    const [isSandboxMode, setIsSandboxMode] = useState(false);
    const [sandboxTasks, setSandboxTasks] = useState<ProjectTask[]>([]);
    const [showAiInsights, setShowAiInsights] = useState(false);
    // GĐ2: Set of task IDs whose predecessor gate is blocking them
    const gateBlockedIds = useMemo(() => getGateBlockedTaskIds(tasks), [tasks]);

    useEffect(() => {
        if (!effectiveId) {
            setTasks([]);
            setBaselines([]);
            setDailyLogs([]);
            setContractItems([]);
            setTaskContractLinks({});
            setProjectStaff([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        Promise.all([
            taskService.list(effectiveId, constructionSiteId || null),
            baselineService.list(effectiveId, constructionSiteId || null),
            dailyLogService.list(effectiveId, constructionSiteId || null),
            contractItemService.listBySite(effectiveId, undefined, constructionSiteId || null),
            taskContractItemService.listBySite(effectiveId, constructionSiteId || null),
            projectId
                ? projectStaffService.listByProject(projectId, constructionSiteId)
                : constructionSiteId
                    ? projectStaffService.listBySite(constructionSiteId)
                    : Promise.resolve([]),
        ]).then(([taskData, baselineData, logData, contractItemData, linkData, staffData]) => {
            setTasks(taskData);
            setBaselines(baselineData);
            setDailyLogs(logData);
            setContractItems(contractItemData);
            setProjectStaff(staffData);
            setTaskContractLinks(linkData.reduce<Record<string, string[]>>((acc, link) => {
                if (!acc[link.taskId]) acc[link.taskId] = [];
                acc[link.taskId].push(link.contractItemId);
                return acc;
            }, {}));
            if (baselineData.length > 0) setActiveBaseline(baselineData[0]);
            setLoading(false);
        }).catch(e => { console.error(e); setLoading(false); });
    }, [effectiveId, constructionSiteId, projectId]);

    useEffect(() => {
        setPbacLoaded(false);
        setProjectPerms(new Set());
        if (!effectiveId) return;

        const loadProjectPerms = async () => {
            try {
                const hasPbac = await projectStaffService.hasProjectPbac(projectId, constructionSiteId || undefined);
                if (!hasPbac) {
                    setProjectPerms(new Set(ALL_PROJECT_PERMISSION_CODES));
                    return;
                }
                if (!user?.id) {
                    setProjectPerms(new Set());
                    return;
                }

                const results = await Promise.all(
                    ALL_PROJECT_PERMISSION_CODES.map(async code => {
                        const check = projectId
                            ? await projectStaffService.checkProjectPermission(user.id, projectId, code, constructionSiteId || undefined)
                            : constructionSiteId
                                ? await projectStaffService.checkPermission(user.id, constructionSiteId, code)
                                : { allowed: false };
                        return { code, allowed: check.allowed };
                    })
                );
                setProjectPerms(new Set(results.filter(result => result.allowed).map(result => result.code)));
            } catch (err) {
                console.warn('Gantt PBAC load failed', err);
                setProjectPerms(new Set());
            } finally {
                setPbacLoaded(true);
            }
        };

        loadProjectPerms();
    }, [effectiveId, projectId, constructionSiteId, user?.id]);

    const ensureProjectPermission = useCallback((code: ProjectPermissionCode, actionLabel?: string) => {
        if (!pbacLoaded) {
            toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
            return false;
        }
        if (!projectPerms.has(code)) {
            toast.error('Không có quyền', `Bạn cần quyền "${code}" để ${actionLabel || PROJECT_PERMISSION_HINTS[code]}.`);
            return false;
        }
        return true;
    }, [pbacLoaded, projectPerms, toast]);

    // View
    const [viewMode, setViewMode] = useState<ViewMode>('split');
    const [zoom, setZoom] = useState(28);
    const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    // CRUD
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<ProjectTask | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ProjectTask | null>(null);
    const [photoTooltip, setPhotoTooltip] = useState<{ x: number, y: number, photoUrl: string, date: string, taskName: string } | null>(null);

    // Form state
    const [fName, setFName] = useState('');
    const [fStart, setFStart] = useState('');
    const [fEnd, setFEnd] = useState('');
    const [fProgress, setFProgress] = useState('0');
    const [fProgressMode, setFProgressMode] = useState<ProjectTaskProgressMode>('manual');
    const [fAssignee, setFAssignee] = useState('');
    const [fAssigneeUserId, setFAssigneeUserId] = useState('');
    const [fParentId, setFParentId] = useState('');
    const [fMilestone, setFMilestone] = useState(false);
    const [fNotes, setFNotes] = useState('');
    const [fColor, setFColor] = useState('');
    // GĐ1: Advanced form fields
    const [fDeps, setFDeps] = useState<{ taskId: string; type: TaskDependencyType; requiresGateApproval?: boolean }[]>([]);
    const [fLagTime, setFLagTime] = useState('0');
    const [fResourceCount, setFResourceCount] = useState('1');
    const [fResourceType, setFResourceType] = useState<ResourceType>('worker');
    const [fCostPerDay, setFCostPerDay] = useState('0');
    const [fContractItemIds, setFContractItemIds] = useState<string[]>([]);
    const [fWbsCode, setFWbsCode] = useState('');
    const [fFallbackUnit, setFFallbackUnit] = useState('');
    const [fActualStart, setFActualStart] = useState('');
    const [fActualEnd, setFActualEnd] = useState('');
    const [fWatchers, setFWatchers] = useState<string[]>([]);

    // Excel Import State
    const [showImportModal, setShowImportModal] = useState(false);
    const [importRows, setImportRows] = useState<ExcelImportRow[]>([]);
    const [importErrors, setImportErrors] = useState<Record<number, string>>({});
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const progressSummary = useMemo(() => calculateProjectProgress(tasks), [tasks]);
    const staffUserMap = useMemo(() => {
        const map = new Map<string, { name: string; position?: string }>();
        for (const staff of projectStaff) {
            if (staff.endDate) continue;
            if (!staff.userId || map.has(staff.userId)) continue;
            map.set(staff.userId, {
                name: staff.userName || staff.userId,
                position: staff.positionName,
            });
        }
        return map;
    }, [projectStaff]);
    const watcherOptions = useMemo(() => {
        return [...staffUserMap.entries()]
            .map(([id, value]) => ({ id, ...value }))
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }, [staffUserMap]);
    const getWatcherNames = useCallback((watchers?: string[]) => {
        return (watchers || []).map(id => staffUserMap.get(id)?.name || id).join(', ');
    }, [staffUserMap]);

    const notifyTaskWatchers = useCallback(async (task: ProjectTask, gateStatus: GateStatus, excludeUserIds: string[] = []) => {
        const excluded = new Set([user?.id, ...excludeUserIds].filter(Boolean) as string[]);
        const recipientIds = [...new Set([task.assigneeUserId, ...(task.watchers || [])])]
            .filter(uid => uid && !excluded.has(uid)) as string[];
        if (recipientIds.length === 0) return;

        const statusCfg: Record<string, { type: 'info' | 'warning' | 'success' | 'error'; severity: 'info' | 'warning' | 'critical'; title: string; message: string; icon: string }> = {
            pending: {
                type: 'warning',
                severity: 'warning',
                title: '📋 Hạng mục chờ nghiệm thu',
                message: `"${task.name}" đã hoàn thành 100% và chờ duyệt gate`,
                icon: '📋',
            },
            approved: {
                type: 'success',
                severity: 'info',
                title: '✅ Hạng mục đã nghiệm thu',
                message: `"${task.name}" đã được duyệt nghiệm thu`,
                icon: '✅',
            },
            rejected: {
                type: 'warning',
                severity: 'warning',
                title: '⚠️ Hạng mục bị từ chối',
                message: `"${task.name}" chưa đạt nghiệm thu${task.gateApprovedBy ? ` — ${task.gateApprovedBy}` : ''}`,
                icon: '⚠️',
            },
        };
        const cfg = statusCfg[gateStatus];
        if (!cfg) return;

        await notificationService.notifyProjectUsers({
            recipientIds,
            actorId: user?.id,
            type: cfg.type,
            category: 'progress',
            title: cfg.title,
            message: cfg.message,
            severity: cfg.severity,
            icon: cfg.icon,
            link: '/da',
            sourceType: 'task_watcher_gate',
            sourceId: `task_watcher_${gateStatus}_${task.id}`,
            constructionSiteId: constructionSiteId || undefined,
            metadata: { taskId: task.id, taskName: task.name, projectId, gateStatus },
        });
    }, [constructionSiteId, projectId, user?.id]);

    const notifyGateApprovers = useCallback(async (task: ProjectTask): Promise<string[]> => {
        try {
            const approvers = await projectStaffService.listProjectStaffWithPermissions(
                projectId,
                constructionSiteId,
                ['approve', 'confirm'],
            );
            return notificationService.notifyProjectUsers({
                recipientIds: approvers.map(staff => staff.userId),
                actorId: user?.id,
                type: 'warning',
                category: 'progress',
                title: '📋 Hạng mục chờ nghiệm thu',
                message: `"${task.name}" đã hoàn thành 100% — cần duyệt gate`,
                severity: 'warning',
                icon: '📋',
                link: '/da',
                sourceType: 'gate_pending',
                sourceId: `gate_${task.id}`,
                constructionSiteId: constructionSiteId || undefined,
                metadata: { taskId: task.id, taskName: task.name, projectId },
            });
        } catch (err) {
            console.error('Failed to notify approvers:', err);
            return [];
        }
    }, [projectId, constructionSiteId, user?.id]);

    const syncProjectFinanceProgress = useCallback((nextTasks: ProjectTask[]) => {
        const summary = calculateProjectProgress(nextTasks);
        if (summary.leafTaskCount === 0) return;
        if (!constructionSiteId) return;

        const finance = projectFinances.find(pf => pf.constructionSiteId === constructionSiteId);
        if (!finance || finance.progressPercent === summary.progressPercent) return;

        updateProjectFinance({
            ...finance,
            progressPercent: summary.progressPercent,
            updatedAt: new Date().toISOString(),
        });
    }, [constructionSiteId, projectFinances, updateProjectFinance]);

    useEffect(() => {
        if (!loading && tasks.length > 0) syncProjectFinanceProgress(tasks);
    }, [loading, tasks, syncProjectFinanceProgress]);

    // ====== CRUD operations ======
    const resetForm = () => {
        setEditing(null); setFName(''); setFStart(''); setFEnd(''); setFProgress('0'); setFProgressMode('manual');
        setFAssignee(''); setFAssigneeUserId(''); setFParentId(''); setFMilestone(false); setFNotes(''); setFColor('');
        setFDeps([]); setFLagTime('0'); setFResourceCount('1'); setFResourceType('worker'); setFCostPerDay('0');
        setFContractItemIds([]); setFWbsCode(''); setFFallbackUnit(''); setFActualStart(''); setFActualEnd('');
        setFWatchers([]);
        setShowForm(false);
    };

    const openAdd = (parentId?: string) => {
        if (!ensureProjectPermission('edit', 'tạo hạng mục tiến độ')) return;
        resetForm();
        if (parentId) setFParentId(parentId);
        const t = today();
        setFStart(t);
        setFEnd(addDays(t, 14));
        setShowForm(true);
    };

    const openEdit = (t: ProjectTask) => {
        if (!ensureProjectPermission('edit', 'sửa hạng mục tiến độ')) return;
        setEditing(t);
        setFName(t.name); setFStart(t.startDate); setFEnd(t.endDate);
        setFProgress(String(t.progress)); setFProgressMode(t.progressMode || 'manual'); setFAssignee(t.assignee || ''); setFAssigneeUserId(t.assigneeUserId || '');
        setFParentId(t.parentId || ''); setFMilestone(t.isMilestone);
        setFNotes(t.notes || ''); setFColor(t.color || '');
        setFDeps(t.dependencies || []); setFLagTime(String(t.lagTime || 0));
        setFResourceCount(String(t.resourceCount || 1)); setFResourceType(t.resourceType || 'worker');
        setFCostPerDay(String(t.estimatedCostPerDay || 0));
        setFContractItemIds(taskContractLinks[t.id] || []);
        setFWbsCode(t.wbsCode || ''); setFFallbackUnit(t.fallbackUnit || '');
        setFActualStart(t.actualStartDate || ''); setFActualEnd(t.actualEndDate || '');
        setFWatchers(t.watchers || []);
        setShowForm(true);
    };

    const duplicateTask = (t: ProjectTask) => {
        if (!ensureProjectPermission('edit', 'nhân bản hạng mục tiến độ')) return;
        setEditing(null);
        setFName(t.name + ' (Bản sao)'); setFStart(t.startDate); setFEnd(t.endDate);
        setFProgress('0'); setFAssignee(t.assignee || ''); setFAssigneeUserId(t.assigneeUserId || '');
        setFParentId(t.parentId || ''); setFMilestone(t.isMilestone);
        setFNotes(t.notes || ''); setFColor(t.color || '');
        setFWatchers([]);
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!fName || !fStart || !fEnd) return;
        const cleanedDeps = fDeps.filter(dep => dep.taskId);
        const validation = validateProjectTaskDraft({
            id: editing?.id,
            name: fName,
            startDate: fStart,
            endDate: fEnd,
            parentId: fParentId || undefined,
            dependencies: fDeps,
            isMilestone: fMilestone,
        }, tasks, editing?.id);
        if (!validation.valid) {
            toast.error('Không thể lưu tiến độ', validation.errors[0]);
            return;
        }
        if (fActualStart && fActualEnd && fActualEnd < fActualStart) {
            toast.error('Không thể lưu tiến độ', 'Ngày kết thúc thực tế không được trước ngày bắt đầu thực tế.');
            return;
        }
        if (!ensureProjectPermission('edit', editing ? 'sửa hạng mục tiến độ' : 'tạo hạng mục tiến độ')) return;

        try {
            const duration = fMilestone ? 0 : daysBetween(fStart, fEnd);
            const baseItem: ProjectTask = editing ? {
                ...editing, name: fName, startDate: fStart, endDate: fEnd, duration,
                progress: Number(fProgress), progressMode: fProgressMode, assignee: fAssignee || undefined,
                assigneeUserId: fAssigneeUserId || undefined,
                parentId: fParentId || undefined, isMilestone: fMilestone,
                notes: fNotes || undefined, color: fColor || undefined,
                dependencies: cleanedDeps.length > 0 ? cleanedDeps : undefined,
                lagTime: Number(fLagTime) || 0,
                resourceCount: Number(fResourceCount) || 1,
                resourceType: fResourceType,
                estimatedCostPerDay: Number(fCostPerDay) || 0,
                wbsCode: fWbsCode || undefined, fallbackUnit: fFallbackUnit || undefined,
                actualStartDate: fActualStart || undefined, actualEndDate: fActualEnd || undefined,
                watchers: fWatchers,
            } : {
                id: crypto.randomUUID(), projectId: projectId || constructionSiteId || null, constructionSiteId: constructionSiteId || null,
                name: fName, startDate: fStart, endDate: fEnd, duration,
                progress: Number(fProgress), progressMode: fProgressMode, assignee: fAssignee || undefined,
                assigneeUserId: fAssigneeUserId || undefined,
                parentId: fParentId || undefined, isMilestone: fMilestone,
                notes: fNotes || undefined, color: fColor || undefined,
                order: tasks.length,
                dependencies: cleanedDeps.length > 0 ? cleanedDeps : undefined,
                lagTime: Number(fLagTime) || 0,
                resourceCount: Number(fResourceCount) || 1,
                resourceType: fResourceType,
                estimatedCostPerDay: Number(fCostPerDay) || 0,
                wbsCode: fWbsCode || undefined, fallbackUnit: fFallbackUnit || undefined,
                actualStartDate: fActualStart || undefined, actualEndDate: fActualEnd || undefined,
                watchers: fWatchers,
            };
	        const item = applyProgressGateTransition(baseItem, Number(fProgress));
	        await taskService.upsert(item);
	        await taskContractItemService.replaceForTask(item.id, effectiveId, constructionSiteId || null, fContractItemIds);
	        const nextTasks = await taskService.list(effectiveId, constructionSiteId || null);
	        const nextLinks = await taskContractItemService.listBySite(effectiveId, constructionSiteId || null);
	        setTasks(nextTasks);
	        setTaskContractLinks(nextLinks.reduce<Record<string, string[]>>((acc, link) => {
	            if (!acc[link.taskId]) acc[link.taskId] = [];
	            acc[link.taskId].push(link.contractItemId);
	            return acc;
	        }, {}));
        syncProjectFinanceProgress(nextTasks);
        resetForm();
        if (item.progress >= 100 && item.gateStatus === 'pending') {
            toast.info('Đã chuyển sang chờ nghiệm thu', 'Hạng mục 100% cần được duyệt trước khi tính là hoàn thành.');
            const wasAlreadyPending = editing?.progress >= 100 && editing?.gateStatus === 'pending';
            if (!wasAlreadyPending) {
                const approverIds = await notifyGateApprovers(item);
                await notifyTaskWatchers(item, 'pending', approverIds);
            }
        }
            toast.success(editing ? 'Đã cập nhật hạng mục' : 'Đã thêm hạng mục');
        } catch (e: any) {
            toast.error('Lỗi lưu tiến độ', e?.message);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        if (!ensureProjectPermission('edit', 'xoá hạng mục tiến độ')) return;
        try {
            const idsToRemove = collectDescendantTaskIds(tasks, deleteTarget.id);
            idsToRemove.add(deleteTarget.id);
            const nextLocalTasks = removeTasksAndReferences(tasks, idsToRemove);
            const changedRefs = nextLocalTasks.filter(next => {
                const prev = tasks.find(t => t.id === next.id);
                return JSON.stringify(prev?.dependencies || []) !== JSON.stringify(next.dependencies || []);
            });

            for (const id of idsToRemove) await taskService.remove(id);
            for (const task of changedRefs) await taskService.upsert(task);
            const nextTasks = await taskService.list(effectiveId, constructionSiteId || null);
            setTasks(nextTasks);
            syncProjectFinanceProgress(nextTasks);
            setDeleteTarget(null);
            toast.success('Đã xoá hạng mục');
        } catch (e: any) {
            toast.error('Lỗi xoá hạng mục', e?.message);
        }
    };

    const updateProgress = async (id: string, progress: number) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        if (!ensureProjectPermission('edit', 'cập nhật tiến độ hạng mục')) return;
        if (task.progressMode === 'derived_from_acceptance') {
            toast.warning('Tiến độ lấy từ nghiệm thu', 'Hạng mục này cần cập nhật qua nghiệm thu khối lượng thay vì chỉnh tay.');
            return;
        }
        if (gateBlockedIds.has(id) && progress > task.progress) {
            toast.warning('Đang bị chặn nghiệm thu', 'Hạng mục trước đó cần được duyệt trước khi tăng tiến độ.');
            return;
        }
        try {
            const updated = applyProgressGateTransition(task, progress);
            await taskService.upsert(updated);
            const nextTasks = tasks.map(t => t.id === id ? updated : t);
            setTasks(nextTasks);
            syncProjectFinanceProgress(nextTasks);
            if (updated.progress >= 100 && updated.gateStatus === 'pending') {
                toast.info('Đã nộp chờ nghiệm thu', 'Hạng mục sẽ chỉ tính là hoàn thành sau khi được duyệt.');
                const wasAlreadyPending = task.progress >= 100 && task.gateStatus === 'pending';
                if (!wasAlreadyPending) {
                    const approverIds = await notifyGateApprovers(updated);
                    await notifyTaskWatchers(updated, 'pending', approverIds);
                }
            }
        } catch (e: any) {
            toast.error('Lỗi cập nhật tiến độ', e?.message);
        }
    };

    // ====== GĐ3: Excel Import / Export ======
    const downloadTemplate = () => {
        const ws = XLSX.utils.json_to_sheet([
            {
                'Mã WBS': '1.1',
                'Công việc (*)': 'Đào đất móng',
                'Người thực hiện': 'Nguyễn Văn A',
                'Bắt đầu KH (*)': '2026-05-01',
                'Kết thúc KH (*)': '2026-05-10',
                'Bắt đầu thực tế': '',
                'Kết thúc thực tế': '',
                'Đơn vị': 'm3',
                'Tiến độ (%)': 0,
                'Công việc cha (Mã WBS)': '1'
            }
        ]);
        ws['!cols'] = [
            { wch: 15 }, // WBS
            { wch: 30 }, // Name
            { wch: 20 }, // Assignee
            { wch: 15 }, // Start
            { wch: 15 }, // End
            { wch: 15 }, // Actual Start
            { wch: 15 }, // Actual End
            { wch: 10 }, // Unit
            { wch: 10 }, // Progress
            { wch: 20 }  // Parent
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        XLSX.writeFile(wb, 'Tien_do_mau.xlsx');
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json<ExcelImportRow>(ws, { defval: '', raw: true });

                const errors: Record<number, string> = {};
                data.forEach((row, idx) => {
                    const start = parseExcelDate(row['Bắt đầu KH (*)']);
                    const end = parseExcelDate(row['Kết thúc KH (*)']);
                    const actualStart = parseExcelDate(row['Bắt đầu thực tế']);
                    const actualEnd = parseExcelDate(row['Kết thúc thực tế']);
                    const rawProgress = row['Tiến độ (%)'] === '' ? 0 : Number(row['Tiến độ (%)']);
                    if (!row['Công việc (*)']) errors[idx] = 'Thiếu tên công việc';
                    else if (!start) errors[idx] = 'Thiếu/sai ngày BĐ kế hoạch';
                    else if (!end) errors[idx] = 'Thiếu/sai ngày KT kế hoạch';
                    else if (start > end) {
                        errors[idx] = 'Ngày kết thúc KH phải sau ngày BĐ KH';
                    }
                    else if (actualStart && actualEnd && actualStart > actualEnd) errors[idx] = 'Ngày thực tế không hợp lệ';
                    else if (!Number.isFinite(rawProgress) || rawProgress < 0 || rawProgress > 100) errors[idx] = 'Tiến độ không hợp lệ';
                });
                setImportRows(data);
                setImportErrors(errors);
                setShowImportModal(true);
            } catch (err) {
                toast.error('Lỗi định dạng', 'Không thể đọc file Excel. Vui lòng dùng file mẫu.');
            }
        };
        reader.readAsBinaryString(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const processBulkImport = async () => {
        setImporting(true);
        try {
            const validRows = importRows.filter((_, i) => !importErrors[i]);
            const newTasks: ProjectTask[] = [];
            const codeToId: Record<string, string> = {};

            for (const row of validRows) {
                const start = parseExcelDate(row['Bắt đầu KH (*)']);
                const end = parseExcelDate(row['Kết thúc KH (*)']);
                if (!start || !end) continue;
                const id = crypto.randomUUID();

                const wbs = row['Mã WBS'] ? String(row['Mã WBS']) : undefined;
                if (wbs) codeToId[wbs] = id;
                codeToId[String(row['Công việc (*)'])] = id;

                newTasks.push({
                    id,
                    projectId: effectiveId,
                    constructionSiteId: constructionSiteId || null,
                    name: String(row['Công việc (*)']),
                    startDate: start,
                    endDate: end,
                    duration: daysBetween(start, end),
                    progress: parseProgress(row['Tiến độ (%)']),
                    progressMode: 'manual',
                    assignee: row['Người thực hiện'] ? String(row['Người thực hiện']) : undefined,
                    wbsCode: wbs,
                    fallbackUnit: row['Đơn vị'] ? String(row['Đơn vị']) : undefined,
                    actualStartDate: parseExcelDate(row['Bắt đầu thực tế']) || undefined,
                    actualEndDate: parseExcelDate(row['Kết thúc thực tế']) || undefined,
                    parentId: row['Công việc cha (Mã WBS)'] ? String(row['Công việc cha (Mã WBS)']) : undefined,
                    order: tasks.length + newTasks.length,
                    isMilestone: false,
                });
            }

            for (const task of newTasks) {
                if (task.parentId) {
                    const parentWbsOrName = task.parentId;
                    const existingParent = tasks.find(t => t.wbsCode === parentWbsOrName || t.name === parentWbsOrName);
                    if (existingParent) {
                        task.parentId = existingParent.id;
                    } else if (codeToId[parentWbsOrName]) {
                        task.parentId = codeToId[parentWbsOrName];
                    } else {
                        task.parentId = undefined;
                    }
                }
            }

            for (const t of newTasks) {
                await taskService.upsert(applyProgressGateTransition(t, t.progress));
            }

            const nextTasks = [...tasks, ...newTasks];
            setTasks(nextTasks);
            syncProjectFinanceProgress(nextTasks);
            toast.success('Thành công', `Đã nhập ${validRows.length} hạng mục thi công`);
            setShowImportModal(false);
            setImportRows([]);
        } catch (err) {
            toast.error('Lỗi', 'Có lỗi khi nhập dữ liệu');
            console.error(err);
        } finally {
            setImporting(false);
        }
    };

    const handleExportExcel = () => {
        const rows = (viewMode === 'split' ? taskTree : sortedTasks.map(t => ({ task: t, level: 0, hasChildren: false }))).map(({ task }) => {
            const status = getStatus(task);
            const parentName = task.parentId ? tasks.find(t => t.id === task.parentId)?.name : '';
            const linkedIds = taskContractLinks[task.id] || [];
            const { derivedStart, derivedEnd } = deriveActualDates(task, dailyLogs, linkedIds);
            return {
                'Mã WBS': task.wbsCode || '',
                'Công việc': task.name,
                'Người thực hiện': task.assignee || '',
                'Thời gian (ngày)': task.duration,
                'Bắt đầu KH': fmtDate(task.startDate),
                'Kết thúc KH': fmtDate(task.endDate),
                'Bắt đầu thực tế': derivedStart ? fmtDate(derivedStart) : '',
                'Kết thúc thực tế': derivedEnd ? fmtDate(derivedEnd) : '',
                'Đơn vị': getTaskUnit(task, linkedIds, contractItems),
                'Tiến độ (%)': task.progress,
                'Trạng thái': getStatusLabel(status),
                'Công việc cha': parentName
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [
            { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
            { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 20 }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'TienDo');
        XLSX.writeFile(wb, `Tien_do_DA_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    // ====== Tree & filtering ======
    const toggleCollapse = (id: string) => {
        setCollapsedParents(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleSort = (field: SortField) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    const filteredTasks = useMemo(() => {
        let result = [...tasks];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t => t.name.toLowerCase().includes(q) || (t.assignee || '').toLowerCase().includes(q));
        }
        if (filterStatus !== 'all') {
            result = result.filter(t => getStatus(t) === filterStatus);
        }
        return result;
    }, [tasks, searchQuery, filterStatus]);

    const sortedTasks = useMemo(() => {
        return [...filteredTasks].sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'name': cmp = a.name.localeCompare(b.name); break;
                case 'startDate': cmp = a.startDate.localeCompare(b.startDate); break;
                case 'endDate': cmp = a.endDate.localeCompare(b.endDate); break;
                case 'progress': cmp = a.progress - b.progress; break;
                case 'assignee': cmp = (a.assignee || '').localeCompare(b.assignee || ''); break;
                case 'status': cmp = getStatus(a).localeCompare(getStatus(b)); break;
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });
    }, [filteredTasks, sortField, sortDir]);

    const taskTree = useMemo(() => {
        const roots = filteredTasks.filter(t => !t.parentId).sort((a, b) => a.order - b.order);
        const getChildren = (parentId: string): ProjectTask[] =>
            filteredTasks.filter(t => t.parentId === parentId).sort((a, b) => a.order - b.order);
        const flatList: { task: ProjectTask; level: number; hasChildren: boolean }[] = [];
        const buildFlat = (items: ProjectTask[], level: number) => {
            items.forEach(t => {
                const children = getChildren(t.id);
                flatList.push({ task: t, level, hasChildren: children.length > 0 });
                if (!collapsedParents.has(t.id)) buildFlat(children, level + 1);
            });
        };
        buildFlat(roots, 0);
        return flatList;
    }, [filteredTasks, collapsedParents]);

    // ====== Stats ======
    const stats = useMemo(() => {
        const total = tasks.length;
        const completed = progressSummary.completedLeafCount;
        const pendingGate = progressSummary.pendingGateCount;
        const inProgress = tasks.filter(t => getStatus(t) === 'in_progress').length;
        const overdue = tasks.filter(t => getStatus(t) === 'overdue').length;
        const avgProgress = progressSummary.progressPercent;
        return { total, completed, pendingGate, inProgress, overdue, avgProgress };
    }, [progressSummary, tasks]);

    // ====== GĐ1: Critical Path ======
    const criticalPathResult = useMemo<CriticalPathResult | null>(() => {
        if (tasks.length === 0) return null;
        return computeCriticalPath(tasks);
    }, [tasks]);

    // Map baseline tasks by ID for quick lookup (shadow bars)
    const baselineMap = useMemo(() => {
        if (!activeBaseline) return new Map<string, ProjectTask>();
        const m = new Map<string, ProjectTask>();
        for (const t of activeBaseline.tasksSnapshot) m.set(t.id, t);
        return m;
    }, [activeBaseline]);

    // Lock baseline handler
    const lockBaseline = useCallback(async () => {
        const name = `Baseline v${baselines.length + 1} — ${new Date().toLocaleDateString('vi-VN')}`;
        const bl: ProjectBaseline = {
            id: crypto.randomUUID(),
            projectId: projectId || constructionSiteId || null,
            constructionSiteId: constructionSiteId || null,
            name,
            lockedAt: new Date().toISOString(),
            tasksSnapshot: tasks.map(t => ({ ...t, baselineStart: t.startDate, baselineEnd: t.endDate, baselineLocked: true })),
        };
        await baselineService.create(bl);
        // Update tasks with baseline dates
        const updatedTasks = tasks.map(t => ({
            ...t,
            baselineStart: t.startDate,
            baselineEnd: t.endDate,
            baselineLocked: true,
        }));
        await taskService.upsertMany(updatedTasks);
        setTasks(updatedTasks);
        setBaselines(prev => [bl, ...prev]);
        setActiveBaseline(bl);
    }, [tasks, baselines, projectId, constructionSiteId]);

    // ====== GĐ2: Gate State Machine ======
    const handleGateApproval = useCallback(async (taskId: string, status: GateStatus, reason?: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        const requiredPermission: ProjectPermissionCode = status === 'pending' ? 'submit' : 'approve';
        if (!ensureProjectPermission(requiredPermission, status === 'pending' ? 'gửi nghiệm thu hạng mục' : 'duyệt hoặc từ chối nghiệm thu hạng mục')) return;

        try {
            const now = new Date().toISOString();
            const updated: ProjectTask = {
                ...task,
                gateStatus: status,
                gateApprovedBy: status === 'approved' ? (user.name || user.username || 'Quản lý') : (status === 'rejected' ? `Từ chối: ${reason || 'Không đạt'}` : undefined),
                gateApprovedAt: (status === 'approved' || status === 'rejected') ? now : undefined,
            };

            // GĐ2: Auto set actualEndDate on gate approval if not manually set
            if (status === 'approved' && !updated.actualEndDate) {
                updated.actualEndDate = now.split('T')[0];
            }

            await taskService.upsert(updated);
            const nextTasks = tasks.map(t => t.id === taskId ? updated : t);
            setTasks(nextTasks);
            syncProjectFinanceProgress(nextTasks);
            if (status === 'pending' && task.gateStatus !== 'pending') {
                const approverIds = await notifyGateApprovers(updated);
                await notifyTaskWatchers(updated, 'pending', approverIds);
            }
            if ((status === 'approved' || status === 'rejected') && task.gateStatus !== status) {
                await notifyTaskWatchers(updated, status);
            }
            toast.success(
                status === 'approved' ? 'Đã duyệt nghiệm thu' :
                status === 'rejected' ? 'Đã từ chối nghiệm thu' :
                'Đã gửi chờ nghiệm thu'
            );
            // Sync modal task
            setGateModalTask(prev => prev?.id === taskId ? updated : prev);
        } catch (e: any) {
            toast.error('Lỗi cập nhật nghiệm thu', e?.message);
        }
    }, [ensureProjectPermission, notifyGateApprovers, notifyTaskWatchers, syncProjectFinanceProgress, tasks, toast, user.name, user.username]);

    // ====== GĐ2: Drag-Resize with Ripple (GĐ5: sandbox-aware) ======
    const handleBarDragEnd = useCallback(async (taskId: string, newEndDate: string) => {
        const source = isSandboxMode ? sandboxTasks : tasks;
        const rippled = rippleEffect(source, taskId, newEndDate);
        if (isSandboxMode) {
            setSandboxTasks(rippled);
        } else {
            const changedTasks = rippled.filter(t => {
                const orig = tasks.find(o => o.id === t.id);
                return orig && (orig.startDate !== t.startDate || orig.endDate !== t.endDate || orig.duration !== t.duration);
            });
            for (const t of changedTasks) {
                await taskService.upsert(t);
            }
            setTasks(rippled);
            syncProjectFinanceProgress(rippled);
        }
        setDraggingTaskId(null);
        setDragGhost(null);
    }, [tasks, isSandboxMode, sandboxTasks, syncProjectFinanceProgress]);

    // GĐ2: Live ripple preview during drag
    const handleBarDragMove = useCallback((taskId: string, newEndDate: string) => {
        const source = isSandboxMode ? sandboxTasks : tasks;
        const rippled = rippleEffect(source, taskId, newEndDate);
        if (isSandboxMode) setSandboxTasks(rippled);
    }, [tasks, isSandboxMode, sandboxTasks]);

    // ====== GĐ2: Weather Map (date → weather) ======
    const weatherMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const log of dailyLogs) {
            m.set(log.date, log.weather);
        }
        return m;
    }, [dailyLogs]);

    // ====== GĐ2: Workload Histogram ======
    const workloadData = useMemo(() => {
        if (tasks.length === 0) return [];
        const allDates = tasks.flatMap(t => [t.startDate, t.endDate]).sort();
        if (allDates.length === 0) return [];
        const start = allDates[0];
        const end = allDates[allDates.length - 1];
        const totalD = daysBetween(start, end);
        const histogram: { date: string; workers: number; machines: number; specialists: number; total: number }[] = [];

        for (let i = 0; i <= totalD; i++) {
            const d = addDays(start, i);
            let workers = 0, machines = 0, specialists = 0;
            for (const t of tasks) {
                if (d >= t.startDate && d <= t.endDate && t.progress < 100) {
                    const count = t.resourceCount || 1;
                    switch (t.resourceType) {
                        case 'machine': machines += count; break;
                        case 'specialist': specialists += count; break;
                        default: workers += count;
                    }
                }
            }
            histogram.push({ date: d, workers, machines, specialists, total: workers + machines + specialists });
        }
        return histogram;
    }, [tasks]);

    // ====== GĐ5: Sandbox helpers ======
    const activeTasks = isSandboxMode ? sandboxTasks : tasks;

    const sandboxDiff = useMemo(() => {
        if (!isSandboxMode || sandboxTasks.length === 0) return null;
        const origDates = tasks.flatMap(t => [t.startDate, t.endDate]).sort();
        const sbDates = sandboxTasks.flatMap(t => [t.startDate, t.endDate]).sort();
        if (origDates.length === 0 || sbDates.length === 0) return null;
        const origTotal = daysBetween(origDates[0], origDates[origDates.length - 1]);
        const sbTotal = daysBetween(sbDates[0], sbDates[sbDates.length - 1]);
        const changed = sandboxTasks.filter(st => {
            const orig = tasks.find(t => t.id === st.id);
            return orig && (orig.startDate !== st.startDate || orig.endDate !== st.endDate);
        }).length;
        return { origTotal, sbTotal, delta: sbTotal - origTotal, changed };
    }, [isSandboxMode, sandboxTasks, tasks]);

    const toggleSandbox = useCallback(() => {
        if (!isSandboxMode) {
            setSandboxTasks(tasks.map(t => ({ ...t })));
            setIsSandboxMode(true);
        } else {
            setIsSandboxMode(false);
            setSandboxTasks([]);
        }
    }, [isSandboxMode, tasks]);

    const applySandbox = useCallback(async () => {
        for (const t of sandboxTasks) {
            const orig = tasks.find(o => o.id === t.id);
            if (orig && (orig.startDate !== t.startDate || orig.endDate !== t.endDate || orig.duration !== t.duration)) {
                await taskService.upsert(t);
            }
        }
        setTasks(sandboxTasks.map(t => ({ ...t })));
        syncProjectFinanceProgress(sandboxTasks);
        setIsSandboxMode(false);
        setSandboxTasks([]);
    }, [sandboxTasks, syncProjectFinanceProgress, tasks]);

    // ====== GĐ5: AI Risk Analysis (Rule-based) ======
    const aiInsights = useMemo(() => {
        const insights: { icon: string; title: string; desc: string; severity: 'high' | 'medium' | 'low' }[] = [];
        // Rule 1: Tasks with heavy accumulated delays
        const delayMap: Record<string, number> = {};
        for (const log of dailyLogs) {
            for (const dt of (log.delayTasks || [])) {
                delayMap[dt.taskId] = (delayMap[dt.taskId] || 0) + dt.delayDays;
            }
        }
        for (const [tid, days] of Object.entries(delayMap)) {
            if (days >= 5) {
                const t = tasks.find(x => x.id === tid);
                if (t) insights.push({ icon: '🔴', title: `"${t.name}" đã trễ ${days} ngày`, desc: `Hạng mục này liên tục bị ghi nhận trễ trong nhật ký. Xem xét tăng ca hoặc bổ sung nhân lực.`, severity: 'high' });
            }
        }
        // Rule 2: Outdoor tasks in rainy months (T6-T10)
        const now = new Date();
        const month = now.getMonth() + 1;
        if (month >= 6 && month <= 10) {
            const outdoorTasks = tasks.filter(t => t.resourceType === 'worker' && t.progress < 100 && new Date(t.endDate) > now);
            for (const t of outdoorTasks.slice(0, 3)) {
                insights.push({ icon: '🌧️', title: `"${t.name}" vào mùa mưa`, desc: `Tháng ${month} là mùa mưa. Hạng mục ngoài trời có nguy cơ trễ 2-4 ngày. Cân nhắc lùi lịch đặt vật tư.`, severity: 'medium' });
            }
        }
        // Rule 3: Long dependency chains (domino risk)
        const getChainLen = (taskId: string, visited = new Set<string>()): number => {
            if (visited.has(taskId)) return 0;
            visited.add(taskId);
            const t = tasks.find(x => x.id === taskId);
            if (!t?.dependencies?.length) return 1;
            return 1 + Math.max(...t.dependencies.map(d => getChainLen(d.taskId, visited)));
        };
        for (const t of tasks) {
            const chain = getChainLen(t.id);
            if (chain >= 4) {
                insights.push({ icon: '⛓️', title: `Chuỗi phụ thuộc dài: "${t.name}"`, desc: `${chain} hạng mục nối tiếp nhau. Nếu 1 task trễ, hiệu ứng domino sẽ ảnh hưởng toàn chuỗi.`, severity: 'medium' });
            }
        }
        // Rule 4: Tasks overdue with no delay explanation
        for (const t of tasks) {
            if (getStatus(t) === 'overdue' && !delayMap[t.id]) {
                insights.push({ icon: '⚠️', title: `"${t.name}" trễ chưa rõ nguyên nhân`, desc: `Hạng mục này đã quá hạn nhưng chưa có nhật ký ghi nhận lý do trễ. Yêu cầu giám sát báo cáo.`, severity: 'low' });
            }
        }
        return insights.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
    }, [tasks, dailyLogs]);

    // ====== Timeline ======
    const { timelineStart, totalDays, months } = useMemo(() => {
        if (filteredTasks.length === 0) {
            const s = addDays(today(), -7);
            return { timelineStart: s, totalDays: 90, months: [] as { label: string; startDay: number; days: number }[] };
        }
        const dates = filteredTasks.flatMap(t => [t.startDate, t.endDate]).sort();
        const s = addDays(dates[0], -7);
        const e = addDays(dates[dates.length - 1], 14);
        const td = daysBetween(s, e);
        const ms: { label: string; startDay: number; days: number }[] = [];
        const cur = new Date(s);
        while (cur <= new Date(e)) {
            const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
            const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
            const startDay = Math.max(0, daysBetween(s, monthStart.toISOString().split('T')[0]));
            const endDay = Math.min(td, daysBetween(s, monthEnd.toISOString().split('T')[0]));
            ms.push({ label: `T${cur.getMonth() + 1}/${cur.getFullYear()}`, startDay, days: endDay - startDay + 1 });
            cur.setMonth(cur.getMonth() + 1);
        }
        return { timelineStart: s, totalDays: td, months: ms };
    }, [filteredTasks]);

    const todayOffset = useMemo(() => daysBetween(timelineStart, today()), [timelineStart]);

    // ====== Sort icon helper ======
    const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
        if (sortField !== field) return <ArrowUpDown size={10} className="text-slate-300" />;
        return sortDir === 'asc' ? <ChevronUp size={10} className="text-orange-500" /> : <ChevronDown size={10} className="text-orange-500" />;
    };

    // ====== RENDER ======
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h3 className="text-base font-black text-slate-800 dark:text-white">📊 Tiến độ thi công</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {stats.total} hạng mục • Tiến độ TB: {stats.avgProgress}%
                        {criticalPathResult && criticalPathResult.criticalPath.length > 0 && (
                            <span className="ml-2 text-red-500 font-bold">
                                • Đường găng: {criticalPathResult.criticalPath.length} task
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <AiInsightPanel module="gantt" siteId={constructionSiteId} />
                    {/* GĐ3: Excel Import/Export */}
                    <button onClick={handleExportExcel}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-emerald-600 border border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-900/30 transition-all"
                        title="Xuất Excel">
                        <Download size={13} />
                    </button>
                    <button onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-blue-600 border border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-all"
                        title="Nhập Excel">
                        <Upload size={13} />
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                    {/* GĐ2: Gate Panel toggle */}
                    {(() => {
                        const pendingCount = progressSummary.pendingGateCount;
                        return (
                            <button onClick={() => setShowGatePanel(v => !v)}
                                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${showGatePanel
                                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700'
                                        : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                                    }`}
                                title="Danh sách chờ nghiệm thu">
                                <Shield size={13} /> Gate
                                {pendingCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center animate-pulse">
                                        {pendingCount}
                                    </span>
                                )}
                            </button>
                        );
                    })()}
                    {/* GĐ1: Lock Baseline */}
                    <button onClick={lockBaseline}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                        title="Chốt kế hoạch gốc (Baseline)">
                        <Lock size={13} /> Chốt Baseline
                        {baselines.length > 0 && <span className="text-[9px] text-slate-400">v{baselines.length}</span>}
                    </button>
                    {/* T3: Baseline Compare Panel toggle */}
                    {baselines.length > 0 && (
                        <button onClick={() => setShowBaselinePanel(v => !v)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                                showBaselinePanel
                                    ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/20 text-sky-700'
                                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                            title="So sánh kế hoạch vs thực tế">
                            <BarChart3 size={13} /> So sánh BL
                        </button>
                    )}
                    {/* GĐ5: Sandbox Toggle */}
                    <button onClick={toggleSandbox}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${isSandboxMode
                                ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-700 ring-2 ring-violet-300 shadow-lg shadow-violet-500/20'
                                : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                        title="Chế độ giả lập (không lưu vào DB)">
                        <FlaskConical size={13} /> {isSandboxMode ? 'Tắt Giả lập' : 'Giả lập'}
                    </button>
                    {/* GĐ5: AI Insights Toggle */}
                    <button onClick={() => setShowAiInsights(v => !v)}
                        className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${showAiInsights
                                ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700'
                                : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                        title="AI Dự báo rủi ro">
                        <Lightbulb size={13} /> AI
                        {aiInsights.length > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[8px] font-black flex items-center justify-center">
                                {aiInsights.length}
                            </span>
                        )}
                    </button>
                    <button onClick={() => openAdd()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20 hover:shadow-xl hover:scale-[1.02] transition-all">
                        <Plus size={14} /> Thêm hạng mục
                    </button>
                </div>
            </div>

            {/* GĐ5: Sandbox active banner */}
            {isSandboxMode && (
                <div className="bg-gradient-to-r from-violet-600 to-purple-600 rounded-2xl p-4 shadow-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FlaskConical size={20} className="text-white" />
                        <div>
                            <p className="text-sm font-black text-white">🧪 Chế độ Giả lập (Sandbox)</p>
                            <p className="text-[10px] text-violet-200">Mọi thay đổi chỉ lưu tạm. Dữ liệu thật KHÔNG bị ảnh hưởng.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {sandboxDiff && (
                            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${sandboxDiff.delta > 0 ? 'bg-red-500/20 text-red-100' : sandboxDiff.delta < 0 ? 'bg-emerald-500/20 text-emerald-100' : 'bg-white/10 text-white'}`}>
                                {sandboxDiff.changed} task thay đổi • {sandboxDiff.delta > 0 ? '+' : ''}{sandboxDiff.delta} ngày
                            </span>
                        )}
                        <button onClick={() => { setIsSandboxMode(false); setSandboxTasks([]); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-white/20 hover:bg-white/30 transition-colors">
                            <RotateCcw size={12} /> Huỷ
                        </button>
                        <button onClick={applySandbox}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-violet-700 bg-white hover:bg-violet-50 transition-colors shadow-sm">
                            <Check size={12} /> Áp dụng thật
                        </button>
                    </div>
                </div>
            )}

            {/* T3: Baseline Compare Panel */}
            {showBaselinePanel && baselines.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-sky-200 dark:border-sky-800 shadow-lg overflow-hidden">
                    <div className="px-5 py-3 border-b border-sky-100 dark:border-sky-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <BarChart3 size={16} className="text-sky-500" />
                            <h4 className="text-sm font-black text-slate-800 dark:text-white">So sánh Baseline vs Thực tế</h4>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Baseline selector */}
                            <select
                                value={activeBaseline?.id || ''}
                                onChange={e => {
                                    const bl = baselines.find(b => b.id === e.target.value) || null;
                                    setActiveBaseline(bl);
                                }}
                                className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                            >
                                {baselines.map(bl => (
                                    <option key={bl.id} value={bl.id}>{bl.name}</option>
                                ))}
                            </select>
                            <button onClick={() => setShowBaselinePanel(false)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                    {activeBaseline && (() => {
                        const blMap = new Map<string, ProjectTask>();
                        for (const t of activeBaseline.tasksSnapshot) blMap.set(t.id, t);
                        const rows = tasks
                            .filter(t => blMap.has(t.id))
                            .map(t => {
                                const bl = blMap.get(t.id)!;
                                const startDelta = daysBetween(bl.startDate, t.startDate);
                                const endDelta = daysBetween(bl.endDate, t.endDate);
                                const durationDelta = t.duration - bl.duration;
                                return { task: t, bl, startDelta, endDelta, durationDelta };
                            })
                            .sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
                        const delayed = rows.filter(r => r.endDelta > 0).length;
                        const ahead = rows.filter(r => r.endDelta < 0).length;
                        const onTrack = rows.filter(r => r.endDelta === 0).length;
                        return (
                            <div>
                                {/* Summary badges */}
                                <div className="px-5 py-2.5 flex items-center gap-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                                    <span className="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                                        ⏰ Trễ: {delayed}
                                    </span>
                                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                        ✔ Đúng hạn: {onTrack}
                                    </span>
                                    <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                        ⚡ Sớm: {ahead}
                                    </span>
                                    <span className="text-[10px] text-slate-400 ml-auto">
                                        Baseline: {new Date(activeBaseline.lockedAt).toLocaleDateString('vi-VN')}
                                    </span>
                                </div>
                                {/* Table */}
                                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                            <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                                                <th className="text-left px-4 py-2.5">Hạng mục</th>
                                                <th className="text-center px-3 py-2.5">Tiến độ</th>
                                                <th className="text-right px-3 py-2.5">NGÀY BĐ (BL)</th>
                                                <th className="text-right px-3 py-2.5">NGÀY KẾT (BL)</th>
                                                <th className="text-right px-3 py-2.5">NGÀY BĐ (TT)</th>
                                                <th className="text-right px-3 py-2.5">NGÀY KẾT (TT)</th>
                                                <th className="text-center px-3 py-2.5">ĐỘ THẤY ĐỔI</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                                            {rows.map(({ task, bl, startDelta, endDelta }) => {
                                                const isDelayed = endDelta > 0;
                                                const isAhead = endDelta < 0;
                                                return (
                                                    <tr key={task.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${
                                                        isDelayed ? 'bg-red-50/30 dark:bg-red-900/10' : isAhead ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : ''
                                                    }`}>
                                                        <td className="px-4 py-2">
                                                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{task.name}</div>
                                                            {task.assignee && <div className="text-[9px] text-slate-400">{task.assignee}</div>}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <div className="flex items-center gap-1">
                                                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                    <div className={`h-full rounded-full ${
                                                                        task.progress >= 100 ? 'bg-emerald-500' : task.progress > 0 ? 'bg-blue-500' : 'bg-slate-200'
                                                                    }`} style={{ width: `${task.progress}%` }} />
                                                                </div>
                                                                <span className="text-[10px] font-bold text-slate-600">{task.progress}%</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right text-slate-500">{fmtShort(bl.startDate)}</td>
                                                        <td className="px-3 py-2 text-right text-slate-500">{fmtShort(bl.endDate)}</td>
                                                        <td className="px-3 py-2 text-right font-bold text-slate-700 dark:text-slate-200">{fmtShort(task.startDate)}</td>
                                                        <td className="px-3 py-2 text-right font-bold text-slate-700 dark:text-slate-200">{fmtShort(task.endDate)}</td>
                                                        <td className="px-3 py-2 text-center">
                                                            {endDelta === 0 ? (
                                                                <span className="text-[10px] font-bold text-emerald-600">✔ Đúng hạn</span>
                                                            ) : (
                                                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-black px-2 py-0.5 rounded-full ${
                                                                    isDelayed
                                                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                                }`}>
                                                                    {isDelayed ? '⏰' : '⚡'} {isDelayed ? '+' : ''}{endDelta} ngày
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                {[
                    { label: 'Tổng hạng mục', value: stats.total, color: 'text-slate-800', icon: '📋' },
                    { label: 'Tiến độ TB', value: `${stats.avgProgress}%`, color: 'text-orange-600', icon: '📈', bar: stats.avgProgress },
                    { label: 'Hoàn thành', value: stats.completed, color: 'text-emerald-600', icon: '✅' },
                    { label: 'Chờ NT', value: stats.pendingGate, color: stats.pendingGate > 0 ? 'text-amber-600' : 'text-slate-400', icon: '🛡️' },
                    { label: 'Đang thực hiện', value: stats.inProgress, color: 'text-blue-600', icon: '🔄' },
                    { label: 'Trễ hạn', value: stats.overdue, color: stats.overdue > 0 ? 'text-red-600' : 'text-slate-400', icon: '⚠️' },
                ].map((s, i) => (
                    <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</span>
                            <span className="text-sm">{s.icon}</span>
                        </div>
                        <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                        {s.bar !== undefined && (
                            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-orange-400 to-amber-500 rounded-full transition-all" style={{ width: `${s.bar}%` }} />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                <div className="p-3 flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 dark:border-slate-700">
                    {/* Left: View toggle + search */}
                    <div className="flex items-center gap-2">
                        {/* View mode toggle */}
                        <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                            {([
                                { mode: 'table' as ViewMode, icon: LayoutList, label: 'Bảng đầy đủ' },
                                { mode: 'split' as ViewMode, icon: Columns, label: 'Kết hợp' },
                                { mode: 'gantt' as ViewMode, icon: BarChart3, label: 'Gantt' },
                            ]).map(v => (
                                <button key={v.mode} onClick={() => setViewMode(v.mode)}
                                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${viewMode === v.mode
                                        ? 'bg-white dark:bg-slate-600 text-orange-600 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600'
                                        }`}>
                                    <v.icon size={12} /> {v.label}
                                </button>
                            ))}
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Tìm hạng mục..."
                                className="pl-7 pr-3 py-1.5 w-44 rounded-xl border border-slate-200 dark:border-slate-600 text-xs bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                        </div>

                        {/* Filter */}
                        <div className="relative">
                            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
                                className="pl-7 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 text-xs bg-transparent appearance-none cursor-pointer focus:ring-2 focus:ring-orange-500 outline-none font-medium">
                                <option value="all">Tất cả</option>
                                <option value="not_started">Chưa bắt đầu</option>
                                <option value="in_progress">Đang thực hiện</option>
                                <option value="pending_gate">Chờ nghiệm thu</option>
                                <option value="completed">Hoàn thành</option>
                                <option value="overdue">Trễ hạn</option>
                            </select>
                            <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Right: Zoom + GĐ2 controls */}
                    {viewMode !== 'table' && (
                        <div className="flex items-center gap-2">
                            {/* GĐ2: Workload toggle */}
                            <button onClick={() => setShowWorkload(v => !v)}
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${showWorkload ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20 text-violet-600' : 'border-slate-200 dark:border-slate-600 text-slate-400 hover:text-slate-600'
                                    }`}
                                title="Biểu đồ phân bổ nguồn lực">
                                <Users size={11} /> Workload
                            </button>
                            {/* Zoom */}
                            <button onClick={() => setZoom(z => Math.max(10, z - 6))} className="w-7 h-7 rounded-lg border border-slate-200 dark:border-slate-600 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><ZoomOut size={12} /></button>
                            <span className="text-[10px] font-bold text-slate-400 w-10 text-center">{zoom}px</span>
                            <button onClick={() => setZoom(z => Math.min(60, z + 6))} className="w-7 h-7 rounded-lg border border-slate-200 dark:border-slate-600 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><ZoomIn size={12} /></button>
                        </div>
                    )}
                </div>

                {/* Content */}
                {loading ? (
                    <div className="p-12 text-center">
                        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-xs font-bold text-slate-400">Đang tải dữ liệu...</p>
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="p-16 text-center">
                        <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Flag size={28} className="text-orange-300" />
                        </div>
                        <p className="text-sm font-bold text-slate-500 mb-1">Chưa có hạng mục nào</p>
                        <p className="text-xs text-slate-400 mb-4">Thêm hạng mục thi công để bắt đầu theo dõi tiến độ</p>
                        <button onClick={() => openAdd()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl transition-all">
                            <Plus size={14} /> Thêm hạng mục đầu tiên
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col lg:flex-row overflow-hidden">
                        {/* ====== TABLE VIEW ====== */}
                        {(viewMode === 'table' || viewMode === 'split') && (
                            <div className={`${viewMode === 'split' ? 'w-full lg:w-[520px] shrink-0 lg:border-r border-b lg:border-b-0 border-slate-100 dark:border-slate-700' : 'flex-1'} overflow-auto`}>
                                <table className={`${viewMode === 'table' ? 'w-full min-w-[760px] lg:min-w-[1180px] table-fixed' : 'w-full min-w-[500px]'} text-xs`}>
                                    <thead>
                                        <tr className="bg-slate-50/80 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                                            {viewMode === 'table' && (
                                                <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-center w-[40px]">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">STT</span>
                                                </th>
                                            )}
                                            {viewMode === 'table' && (
                                                <th className="hidden sm:table-cell sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[76px]">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Mã WBS</span>
                                                </th>
                                            )}
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-3 py-2.5 text-left">
                                                <button onClick={() => handleSort('name')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    Công việc <SortIcon field="name" />
                                                </button>
                                            </th>
                                            {viewMode === 'table' && (
                                                <th className="hidden md:table-cell sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[128px]">
                                                    <button onClick={() => handleSort('assignee')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                        Người thực hiện <SortIcon field="assignee" />
                                                    </button>
                                                </th>
                                            )}
                                            {viewMode === 'table' && (
                                                <th className="hidden lg:table-cell sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-center w-[88px]">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Thời gian<br />(ngày)</span>
                                                </th>
                                            )}
                                            {viewMode === 'split' && (
                                                <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[85px]">
                                                    <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                        T.Thái <SortIcon field="status" />
                                                    </button>
                                                </th>
                                            )}
                                            <th className={`${viewMode === 'table' ? 'hidden sm:table-cell' : ''} sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[80px]`}>
                                                <button onClick={() => handleSort('startDate')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    BĐ KH <SortIcon field="startDate" />
                                                </button>
                                            </th>
                                            <th className={`${viewMode === 'table' ? 'hidden sm:table-cell' : ''} sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[80px]`}>
                                                <button onClick={() => handleSort('endDate')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    KT KH <SortIcon field="endDate" />
                                                </button>
                                            </th>
                                            {viewMode === 'table' && (
                                                <>
                                                    <th className="hidden lg:table-cell sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[86px]">
                                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">BĐ thực tế</span>
                                                    </th>
                                                    <th className="hidden lg:table-cell sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[86px]">
                                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">KT thực tế</span>
                                                    </th>
                                                </>
                                            )}
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[120px]">
                                                <button onClick={() => handleSort('progress')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    Tiến độ <SortIcon field="progress" />
                                                </button>
                                            </th>
                                            {viewMode === 'table' && (
                                                <th className="hidden xl:table-cell sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[70px]">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Đơn vị</span>
                                                </th>
                                            )}
                                            {viewMode === 'table' && (
                                                <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[96px]">
                                                <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    T.Thái <SortIcon field="status" />
                                                </button>
                                            </th>
                                            )}
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-center w-[80px]">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Thao tác</span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(viewMode === 'split' ? taskTree : sortedTasks.map(t => ({ task: t, level: 0, hasChildren: false }))).map(({ task, level, hasChildren }, idx) => {
                                            const status = getStatus(task);
                                            const linkedIds = taskContractLinks[task.id] || [];
                                            const { derivedStart, derivedEnd } = deriveActualDates(task, dailyLogs, linkedIds);
                                            const unitLabel = getTaskUnit(task, linkedIds, contractItems);
                                            const unitTitle = getTaskUnitTitle(task, linkedIds, contractItems);
                                            return (
                                                <tr key={task.id}
                                                    style={{ height: `${ROW_HEIGHT}px` }}
                                                    className={`border-b border-slate-50 dark:border-slate-700/50 hover:bg-orange-50/30 dark:hover:bg-slate-700/30 group transition-colors ${status === 'overdue' ? 'bg-red-50/20' : status === 'pending_gate' ? 'bg-amber-50/20' : ''}`}>
                                                    {/* STT */}
                                                    {viewMode === 'table' && (
                                                        <td className="px-2 py-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                                                    )}
                                                    {/* Mã WBS */}
                                                    {viewMode === 'table' && (
                                                        <td className="hidden sm:table-cell px-2 py-2.5">
                                                            {task.wbsCode ? (
                                                                <span className="text-indigo-600 dark:text-indigo-400 font-bold">{task.wbsCode}</span>
                                                            ) : (
                                                                <span className="text-slate-300">–</span>
                                                            )}
                                                        </td>
                                                    )}
                                                    {/* Name */}
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center gap-1" style={{ paddingLeft: viewMode === 'split' ? `${level * 16}px` : 0 }}>
                                                            {viewMode === 'split' && hasChildren ? (
                                                                <button onClick={() => toggleCollapse(task.id)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-orange-500 shrink-0 rounded hover:bg-orange-50 transition-colors">
                                                                    {collapsedParents.has(task.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                                                </button>
                                                            ) : viewMode === 'split' ? (
                                                                <span className="w-5 shrink-0" />
                                                            ) : null}
                                                            {task.isMilestone && <Flag size={11} className="text-red-500 shrink-0" />}
                                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: task.color || COLORS[idx % COLORS.length] }} />
                                                            <span className="font-bold text-slate-700 dark:text-slate-200 truncate cursor-pointer hover:text-orange-600 transition-colors"
                                                                onClick={() => openEdit(task)} title={task.name}>
                                                                {task.name}
                                                            </span>
                                                            {(task.watchers || []).length > 0 && (
                                                                <span title={`Theo dõi: ${getWatcherNames(task.watchers)}`} className="inline-flex shrink-0">
                                                                    <Eye size={11} className="text-blue-400" />
                                                                </span>
                                                            )}
                                                        </div>
                                                        {viewMode === 'table' && (
                                                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-slate-400 md:hidden">
                                                                {task.wbsCode && <span>WBS {task.wbsCode}</span>}
                                                                {task.assignee && <span>{task.assignee}</span>}
                                                                <span>{fmtShort(task.startDate)}→{fmtShort(task.endDate)}</span>
                                                                {unitLabel !== '–' && <span>{unitLabel}</span>}
                                                                {(task.watchers || []).length > 0 && <span>{task.watchers?.length} theo dõi</span>}
                                                            </div>
                                                        )}
                                                    </td>
                                                    {/* Status */}
                                                    {viewMode === 'split' && (
                                                        <td className="px-2 py-0 overflow-hidden" style={{ maxWidth: "95px" }}><StatusBadge status={status} /></td>
                                                    )}
                                                    {/* Assignee */}
                                                    {viewMode === 'table' && (
                                                        <td className="hidden md:table-cell px-2 py-2.5">
                                                            {task.assignee ? (
                                                                <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
                                                                    <User size={10} className="text-slate-400" /> {task.assignee}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-300">—</span>
                                                            )}
                                                        </td>
                                                    )}
                                                    {/* Duration */}
                                                    {viewMode === 'table' && (
                                                        <td className="hidden lg:table-cell px-2 py-2.5 text-center font-bold text-slate-500">{task.duration}</td>
                                                    )}
                                                    {/* Planned Dates */}
                                                    <td className={`${viewMode === 'table' ? 'hidden sm:table-cell' : ''} px-2 py-2.5 text-slate-500 font-medium`}>{fmtShort(task.startDate)}</td>
                                                    <td className={`${viewMode === 'table' ? 'hidden sm:table-cell' : ''} px-2 py-2.5 text-slate-500 font-medium`}>{fmtShort(task.endDate)}</td>
                                                    {/* Actual Dates (table mode only) */}
                                                    {viewMode === 'table' && (
                                                        <>
                                                            <td className="hidden lg:table-cell px-2 py-2.5 text-emerald-600 font-medium" title={task.actualStartDate ? "Nhập tay" : derivedStart ? "Tính tự động" : ""}>
                                                                {derivedStart ? fmtShort(derivedStart) : <span className="text-slate-300">–</span>}
                                                            </td>
                                                            <td className="hidden lg:table-cell px-2 py-2.5 text-emerald-600 font-medium" title={task.actualEndDate ? "Nhập tay" : derivedEnd ? "Tính tự động" : ""}>
                                                                {derivedEnd ? fmtShort(derivedEnd) : <span className="text-slate-300">–</span>}
                                                            </td>
                                                        </>
                                                    )}
                                                    {/* Progress */}
                                                    <td className="px-2 py-2.5">
                                                        <ProgressCell value={task.progress} onChange={v => updateProgress(task.id, v)} />
                                                    </td>
                                                    {/* Unit (table mode only) */}
                                                    {viewMode === 'table' && (
                                                        <td className="hidden xl:table-cell px-2 py-2.5 text-slate-500 font-medium" title={unitTitle}>
                                                            {unitLabel}
                                                        </td>
                                                    )}
                                                    {/* Status */}
                                                    {viewMode === 'table' && (
                                                        <td className="px-2 py-0 overflow-hidden" style={{ maxWidth: "96px" }}><StatusBadge status={status} /></td>
                                                    )}
                                                    {/* Actions */}
                                                    <td className="px-2 py-2.5">
                                                        <div className="flex items-center justify-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                            <button onClick={() => openEdit(task)} title="Sửa"
                                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                                                                <Edit2 size={12} />
                                                            </button>
                                                            <button onClick={() => duplicateTask(task)} title="Nhân bản"
                                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
                                                                <Copy size={12} />
                                                            </button>
                                                            <button onClick={() => setDeleteTarget(task)} title="Xoá"
                                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {filteredTasks.length === 0 && tasks.length > 0 && (
                                    <div className="p-8 text-center">
                                        <Search size={24} className="mx-auto mb-2 text-slate-200" />
                                        <p className="text-xs font-bold text-slate-400">Không tìm thấy hạng mục phù hợp</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ====== GANTT VIEW ====== */}
                        {(viewMode === 'gantt' || viewMode === 'split') && (
                            <div className="flex-1 overflow-x-auto overflow-y-hidden relative">
                                <div className="relative" style={{ width: `${totalDays * zoom}px`, minWidth: '100%' }}>
                                    {/* Month headers */}
                                    <div className="flex border-b border-slate-100 dark:border-slate-700 relative bg-slate-50/50 dark:bg-slate-700/30" style={{ height: `${GANTT_HEADER_HEIGHT}px` }}>
                                        {months.map((m, i) => (
                                            <div key={i} className="absolute top-0 h-full flex flex-col justify-center border-r border-slate-100 dark:border-slate-700"
                                                style={{ left: `${m.startDay * zoom}px`, width: `${m.days * zoom}px` }}>
                                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider px-2 truncate">{m.label}</span>
                                            </div>
                                        ))}
                                        {todayOffset >= 0 && todayOffset <= totalDays && (
                                            <div className="absolute top-0 h-full w-[2px] bg-red-500 z-10" style={{ left: `${todayOffset * zoom}px` }}>
                                                <div className="absolute top-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-b bg-red-500 text-white text-[8px] font-bold whitespace-nowrap">
                                                    Hôm nay
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Gantt-only task labels */}
                                    {viewMode === 'gantt' && (
                                        <div className="border-b border-slate-100 dark:border-slate-700">
                                            {taskTree.map(({ task, level, hasChildren }) => (
                                                <div key={task.id} className="flex items-center gap-1 px-2 border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 group text-xs"
                                                    style={{ height: `${ROW_HEIGHT}px`, paddingLeft: `${8 + level * 16}px` }}>
                                                    {hasChildren ? (
                                                        <button onClick={() => toggleCollapse(task.id)} className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-orange-500 shrink-0">
                                                            {collapsedParents.has(task.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                                        </button>
                                                    ) : <span className="w-4 shrink-0" />}
                                                    {task.isMilestone && <Flag size={10} className="text-red-500 shrink-0" />}
                                                    <span className="truncate font-bold text-slate-700 dark:text-slate-200 flex-1" title={task.name}>{task.name}</span>
                                                    {(task.watchers || []).length > 0 && (
                                                        <span title={`Theo dõi: ${getWatcherNames(task.watchers)}`} className="inline-flex shrink-0">
                                                            <Eye size={10} className="text-blue-400" />
                                                        </span>
                                                    )}
                                                    <span className="text-[9px] font-bold text-slate-400 shrink-0 w-8 text-right">{task.progress}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Task bars + Baseline shadows + Critical Path + GĐ2: Ghost + Gate Block */}
                                    {taskTree.map(({ task }, idx) => {
                                        const left = daysBetween(timelineStart, task.startDate) * zoom;
                                        const width = Math.max(task.duration * zoom, zoom);
                                        const color = task.color || COLORS[idx % COLORS.length];
                                        const status = getStatus(task);
                                        const isCrit = criticalPathResult?.criticalPath.includes(task.id);
                                        const scheduleInfo = criticalPathResult?.taskSchedule.get(task.id);
                                        const floatVal = scheduleInfo?.float ?? 0;
                                        const baselineTask = baselineMap.get(task.id);
                                        const delayDays = getDelayDays(task);
                                        const isGateBlocked = gateBlockedIds.has(task.id);
                                        const isDragging = draggingTaskId === task.id;
                                        const isRippling = draggingTaskId !== null && draggingTaskId !== task.id;

                                        // GĐ3: Tìm ảnh mới nhất từ daily logs của task này
                                        const latestPhotoLog = getTaskRelatedPhotoLog(task, dailyLogs);
                                        const latestPhoto = latestPhotoLog?.photos?.[0];

                                        // Baseline shadow position
                                        const blLeft = baselineTask ? daysBetween(timelineStart, baselineTask.startDate) * zoom : 0;
                                        const blWidth = baselineTask ? Math.max(baselineTask.duration * zoom, zoom) : 0;

                                        return (
                                            <div key={task.id} className="w-full relative border-b border-slate-50 dark:border-slate-700/50" style={{ height: `${ROW_HEIGHT}px` }}>
                                                {todayOffset >= 0 && todayOffset <= totalDays && (
                                                    <div className="absolute top-0 h-full w-[2px] bg-red-500/10 z-0" style={{ left: `${todayOffset * zoom}px` }} />
                                                )}

                                                {/* GĐ1: Baseline Shadow Bar */}
                                                {baselineTask && blWidth > 0 && (
                                                    <div className="absolute top-[10px] h-[16px] rounded bg-slate-300/30 dark:bg-slate-500/20 z-[1] pointer-events-none border border-dashed border-slate-300/50"
                                                        style={{ left: `${blLeft}px`, width: `${blWidth}px` }}
                                                        title={`Baseline: ${fmtShort(baselineTask.startDate)} → ${fmtShort(baselineTask.endDate)}`} />
                                                )}

                                                {/* GĐ2: Ghost Bar — fixed at original position during drag */}
                                                {dragGhost && dragGhost.taskId === task.id && (
                                                    <div className="absolute top-[8px] h-[20px] rounded-lg z-[2] pointer-events-none border-2 border-dashed"
                                                        style={{
                                                            left: `${dragGhost.origLeft}px`,
                                                            width: `${dragGhost.origWidth}px`,
                                                            borderColor: `${color}60`,
                                                            backgroundColor: `${color}10`,
                                                            opacity: 0.35,
                                                        }} />
                                                )}

                                                {task.isMilestone ? (
                                                    <div className="absolute top-1/2 -translate-y-1/2 z-10" style={{ left: `${left}px` }}>
                                                        <div className={`w-4 h-4 rotate-45 rounded-sm shadow-md ${isCrit ? 'ring-2 ring-red-500 ring-offset-1' : ''}`} style={{ backgroundColor: color }} />
                                                    </div>
                                                ) : (
                                                    <div className={`absolute top-[6px] h-[24px] rounded-lg shadow-sm cursor-pointer group/bar z-10 ${isDragging ? 'shadow-lg scale-y-[1.2] z-30' : 'hover:scale-y-[1.15] hover:shadow-md'
                                                        } ${isCrit ? 'ring-2 ring-red-500/70 ring-offset-1' : ''
                                                        } ${status === 'overdue' ? 'ring-1 ring-red-400 ring-offset-1' : ''
                                                        } ${status === 'pending_gate' ? 'ring-1 ring-amber-400 ring-offset-1' : ''
                                                        } ${isGateBlocked ? 'opacity-40 grayscale' : ''
                                                        } ${isRippling ? 'transition-[left,width] duration-300 ease-out' : 'transition-all'}`}
                                                        style={{
                                                            left: `${left}px`, width: `${width}px`,
                                                            backgroundColor: isGateBlocked ? '#e2e8f0' : `${color}20`,
                                                            border: `2px solid ${isGateBlocked ? '#94a3b8' : (isCrit ? '#ef4444' : color)}`,
                                                        }}
                                                        title={`${task.name}: ${task.progress}% (${fmtShort(task.startDate)} → ${fmtShort(task.endDate)})${isCrit ? ' ⚡ Đường găng' : ''}${floatVal > 0 ? ` | Float: ${floatVal}d` : ''}${delayDays > 0 ? ` | Trễ: ${delayDays}d` : ''}${isGateBlocked ? ' 🔒 Chờ nghiệm thu' : ''}`}
                                                        onClick={() => openEdit(task)}
                                                        onMouseEnter={(e) => {
                                                            if (latestPhoto) {
                                                                setPhotoTooltip({ x: e.clientX, y: e.clientY, photoUrl: latestPhoto.url, date: latestPhotoLog!.date, taskName: task.name });
                                                            }
                                                        }}
                                                        onMouseLeave={() => setPhotoTooltip(null)}
                                                        onMouseMove={(e) => {
                                                            if (latestPhoto) {
                                                                setPhotoTooltip({ x: e.clientX, y: e.clientY, photoUrl: latestPhoto.url, date: latestPhotoLog!.date, taskName: task.name });
                                                            }
                                                        }}>
                                                        <div className="absolute inset-0 rounded-md transition-all" style={{ width: `${task.progress}%`, backgroundColor: isGateBlocked ? '#94a3b8' : (isCrit ? '#ef4444' : color), opacity: 0.65 }} />
                                                        {width > 50 && (
                                                            <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold truncate z-10"
                                                                style={{ color: task.progress > 50 ? '#fff' : (isGateBlocked ? '#64748b' : (isCrit ? '#ef4444' : color)) }}>
                                                                {isGateBlocked && '🔒 '}{task.name}
                                                            </span>
                                                        )}
                                                        {/* GĐ2: Drag delta indicator */}
                                                        {isDragging && dragGhost && dragGhost.deltaDays !== 0 && (
                                                            <span className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap z-30 shadow-sm ${dragGhost.deltaDays > 0 ? 'bg-orange-100 text-orange-700 border border-orange-300' : 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                                                }`}>
                                                                {dragGhost.deltaDays > 0 ? '+' : ''}{dragGhost.deltaDays}d
                                                            </span>
                                                        )}
                                                        {/* GĐ2: Weather warning on drag target end date */}
                                                        {isDragging && dragGhost?.weatherWarn && (
                                                            <span className="absolute -bottom-5 right-0 text-[8px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-full whitespace-nowrap z-30 animate-pulse shadow-sm">
                                                                {WEATHER_ICONS[dragGhost.weatherWarn] || '⚠️'} {dragGhost.weatherWarn === 'storm' ? 'Bão!' : 'Mưa!'}
                                                            </span>
                                                        )}
                                                        {/* Float badge */}
                                                        {!isDragging && floatVal > 0 && width > 60 && (
                                                            <span className="absolute -top-3.5 right-0 text-[8px] font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-1 rounded"
                                                                title={`Float: ${floatVal} ngày dự phòng`}>
                                                                +{floatVal}d
                                                            </span>
                                                        )}
                                                        {/* Delay badge */}
                                                        {!isDragging && delayDays > 0 && (
                                                            <span className="absolute -top-3.5 left-0 text-[8px] font-bold text-red-500 bg-red-50 dark:bg-red-900/30 px-1 rounded animate-pulse">
                                                                -{delayDays}d
                                                            </span>
                                                        )}
                                                        {/* GĐ2: Gate State Machine Badge */}
                                                        {task.progress >= 100 && task.gateStatus !== 'approved' && (
                                                            <button
                                                                className={`absolute -bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[7px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap z-20 hover:scale-110 transition-all shadow-sm ${task.gateStatus === 'pending'
                                                                        ? 'text-amber-700 bg-amber-50 border-amber-300 animate-pulse'
                                                                        : task.gateStatus === 'rejected'
                                                                            ? 'text-red-600 bg-red-50 border-red-300'
                                                                            : 'text-slate-600 bg-white border-slate-300'
                                                                    }`}
                                                                onClick={e => { e.stopPropagation(); setGateModalTask(task); }}
                                                                title="Mở quy trình nghiệm thu">
                                                                {task.gateStatus === 'pending' && <><Clock size={6} className="inline" /> Chờ duyệt</>}
                                                                {task.gateStatus === 'rejected' && <><AlertTriangle size={6} className="inline" /> Từ chối</>}
                                                                {(!task.gateStatus || task.gateStatus === 'none') && <><Shield size={6} className="inline" /> Nghiệm thu</>}
                                                            </button>
                                                        )}
                                                        {task.gateStatus === 'approved' && (
                                                            <button
                                                                className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[7px] font-bold text-emerald-600 whitespace-nowrap z-20 hover:underline"
                                                                onClick={e => { e.stopPropagation(); setGateModalTask(task); }}
                                                                title="Xem chi tiết nghiệm thu">
                                                                <CheckCircle2 size={8} className="inline" /> Đã duyệt
                                                            </button>
                                                        )}
                                                        {/* GĐ2: Gate-blocked indicator */}
                                                        {isGateBlocked && (
                                                            <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-slate-500 bg-slate-100 px-1.5 rounded-full whitespace-nowrap z-20 border border-slate-200">
                                                                <Lock size={7} className="inline mr-0.5" />Chờ gate
                                                            </span>
                                                        )}
                                                        {/* Drag handle — resize bar end date with ripple + ghost + weather */}
                                                        <div className="absolute right-0 top-0 h-full w-3 cursor-col-resize opacity-0 group-hover/bar:opacity-100 flex items-center justify-center"
                                                            onMouseDown={e => {
                                                                e.stopPropagation();
                                                                e.preventDefault();
                                                                setDraggingTaskId(task.id);
                                                                const startX = e.clientX;
                                                                const origEnd = task.endDate;
                                                                const origLeft = left;
                                                                const origWidth = width;
                                                                setDragGhost({ taskId: task.id, origLeft, origWidth, deltaDays: 0, weatherWarn: null });
                                                                const onMove = (me: MouseEvent) => {
                                                                    const dx = me.clientX - startX;
                                                                    const daysDelta = Math.round(dx / zoom);
                                                                    const newEnd = addDays(origEnd, daysDelta);
                                                                    // Check weather warning for outdoor tasks
                                                                    let weatherWarn: string | null = null;
                                                                    if (task.resourceType !== 'machine') {
                                                                        const endW = weatherMap.get(newEnd);
                                                                        if (endW === 'rainy' || endW === 'storm') weatherWarn = endW;
                                                                    }
                                                                    setDragGhost({ taskId: task.id, origLeft, origWidth, deltaDays: daysDelta, weatherWarn });
                                                                    if (daysDelta !== 0 && newEnd > task.startDate) {
                                                                        handleBarDragMove(task.id, newEnd);
                                                                    }
                                                                };
                                                                const onUp = (me: MouseEvent) => {
                                                                    window.removeEventListener('mousemove', onMove);
                                                                    window.removeEventListener('mouseup', onUp);
                                                                    const dx = me.clientX - startX;
                                                                    const daysDelta = Math.round(dx / zoom);
                                                                    if (daysDelta !== 0) {
                                                                        const newEnd = addDays(origEnd, daysDelta);
                                                                        if (newEnd > task.startDate) {
                                                                            handleBarDragEnd(task.id, newEnd);
                                                                        } else {
                                                                            setDraggingTaskId(null);
                                                                            setDragGhost(null);
                                                                        }
                                                                    } else {
                                                                        setDraggingTaskId(null);
                                                                        setDragGhost(null);
                                                                    }
                                                                };
                                                                window.addEventListener('mousemove', onMove);
                                                                window.addEventListener('mouseup', onUp);
                                                            }}>
                                                            <div className="w-1 h-3 rounded bg-white/80" />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* GĐ1: SVG Dependency Arrows */}
                                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-20" style={{ height: `${taskTree.length * ROW_HEIGHT + GANTT_HEADER_HEIGHT}px` }}>
                                        <defs>
                                            <marker id="dep-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                                            </marker>
                                            <marker id="dep-arrow-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                                            </marker>
                                        </defs>
                                        {taskTree.map(({ task }, idx) => {
                                            if (!task.dependencies || task.dependencies.length === 0) return null;
                                            const succY = GANTT_HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2; // center of this row
                                            const succLeft = daysBetween(timelineStart, task.startDate) * zoom;

                                            return task.dependencies.map(dep => {
                                                const predIdx = taskTree.findIndex(t => t.task.id === dep.taskId);
                                                if (predIdx < 0) return null;
                                                const predTask = taskTree[predIdx].task;
                                                const predY = GANTT_HEADER_HEIGHT + predIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                                                const predRight = daysBetween(timelineStart, predTask.endDate) * zoom;
                                                const predLeft = daysBetween(timelineStart, predTask.startDate) * zoom;

                                                const isBothCrit = criticalPathResult?.criticalPath.includes(task.id) && criticalPathResult?.criticalPath.includes(dep.taskId);

                                                // Arrow points based on dependency type
                                                let x1: number, x2: number;
                                                if (dep.type === 'FS') { x1 = predRight; x2 = succLeft; }
                                                else if (dep.type === 'SS') { x1 = predLeft; x2 = succLeft; }
                                                else if (dep.type === 'FF') { x1 = predRight; x2 = succLeft + Math.max(task.duration * zoom, zoom); }
                                                else { x1 = predLeft; x2 = succLeft + Math.max(task.duration * zoom, zoom); }

                                                // Draw an L-shaped path
                                                const midX = (x1 + x2) / 2;
                                                const path = `M ${x1} ${predY} L ${midX} ${predY} L ${midX} ${succY} L ${x2} ${succY}`;

                                                return (
                                                    <path key={`${dep.taskId}-${task.id}`} d={path}
                                                        stroke={isBothCrit ? '#ef4444' : '#94a3b8'}
                                                        strokeWidth={isBothCrit ? 2 : 1.5}
                                                        fill="none"
                                                        strokeDasharray={dep.type !== 'FS' ? '4 2' : undefined}
                                                        markerEnd={`url(#${isBothCrit ? 'dep-arrow-crit' : 'dep-arrow'})`}
                                                        opacity={0.7} />
                                                );
                                            });
                                        })}
                                    </svg>

                                    {/* GĐ2: Weather Overlay */}
                                    <div className="absolute top-0 left-0 h-full w-full pointer-events-none z-[5]">
                                        {Array.from({ length: totalDays }, (_, i) => {
                                            const d = addDays(timelineStart, i);
                                            const w = weatherMap.get(d);
                                            if (!w || w === 'sunny' || w === 'cloudy') return null;
                                            return (
                                                <div key={i} className={`absolute top-0 h-full ${WEATHER_COLORS[w] || ''} pointer-events-auto`}
                                                    style={{ left: `${i * zoom}px`, width: `${zoom}px`, borderLeft: `2px solid ${w === 'storm' ? '#fca5a5' : '#93c5fd'}` }}
                                                    title={`Thời tiết ngày ${d}: ${WEATHER_ICONS[w] || ''} ${w === 'rainy' ? 'Mưa' : 'Bão'} (Nguy cơ chậm tiến độ)`}>
                                                    <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] drop-shadow">{WEATHER_ICONS[w]}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* GĐ2: Workload Histogram — Enhanced */}
                                {showWorkload && workloadData.length > 0 && (() => {
                                    // Dynamic threshold from daily_logs max worker_count
                                    const maxLogged = Math.max(1, ...dailyLogs.map(l => l.workerCount || 0));
                                    const threshold = maxLogged > 0 ? maxLogged : Math.ceil(Math.max(1, ...workloadData.map(d => d.total)) * 0.75);
                                    const maxVal = Math.max(threshold + 2, ...workloadData.map(d => d.total));

                                    return (
                                        <div className="border-t-2 border-slate-200 dark:border-slate-700 pt-2 pb-1 w-full">
                                            <div className="px-2 mb-1 flex items-center gap-3 flex-wrap">
                                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">📊 Phân bổ nguồn lực</span>
                                                <span className="flex items-center gap-1 text-[8px] text-blue-500"><span className="w-2 h-2 rounded bg-blue-400" /> Nhân công</span>
                                                <span className="flex items-center gap-1 text-[8px] text-amber-500"><span className="w-2 h-2 rounded bg-amber-400" /> Máy</span>
                                                <span className="flex items-center gap-1 text-[8px] text-violet-500"><span className="w-2 h-2 rounded bg-violet-400" /> Chuyên gia</span>
                                                <span className="flex items-center gap-1 text-[8px] text-red-400"><span className="w-2 h-[1px] bg-red-400 border-t border-dashed border-red-400" style={{ width: '10px' }} /> Ngưỡng: {threshold} người</span>
                                            </div>
                                            <div className="relative h-20 w-full">
                                                {workloadData.map((d, i) => {
                                                    const dayOffset = daysBetween(timelineStart, d.date);
                                                    if (dayOffset < 0 || dayOffset > totalDays) return null;
                                                    const barH = (d.total / maxVal) * 72;
                                                    const wH = (d.workers / maxVal) * 72;
                                                    const mH = (d.machines / maxVal) * 72;
                                                    const sH = (d.specialists / maxVal) * 72;
                                                    const isOverload = d.total > threshold;
                                                    return (
                                                        <div key={i}
                                                            className={`absolute bottom-0 group/wbar cursor-default ${isOverload ? 'z-[2]' : ''}`}
                                                            style={{ left: `${dayOffset * zoom}px`, width: `${Math.max(zoom - 1, 2)}px` }}>
                                                            <div className={`flex flex-col-reverse rounded-t-sm ${isOverload ? 'animate-pulse' : ''}`} style={{ height: `${barH}px` }}>
                                                                {wH > 0 && <div className={`rounded-t-sm ${isOverload ? 'bg-red-400/80' : 'bg-blue-400/60'}`} style={{ height: `${wH}px` }} />}
                                                                {mH > 0 && <div className={isOverload ? 'bg-red-300/80' : 'bg-amber-400/60'} style={{ height: `${mH}px` }} />}
                                                                {sH > 0 && <div className={`rounded-t-sm ${isOverload ? 'bg-red-500/80' : 'bg-violet-400/60'}`} style={{ height: `${sH}px` }} />}
                                                            </div>
                                                            {/* Hover tooltip */}
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover/wbar:opacity-100 pointer-events-none transition-opacity z-30">
                                                                <div className="bg-slate-800 text-white text-[8px] px-2 py-1 rounded-lg shadow-lg whitespace-nowrap font-medium">
                                                                    <div className="font-bold text-[9px] mb-0.5">{fmtShort(d.date)}</div>
                                                                    <div>👷 {d.workers} CN • 🔧 {d.machines} Máy • 🧑‍🔬 {d.specialists} CG</div>
                                                                    <div className="font-bold mt-0.5">Tổng: {d.total}{isOverload ? ' ⚠️ QUÁ TẢI' : ''}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {/* Dynamic threshold line */}
                                                <div className="absolute left-0 right-0 border-t-2 border-dashed border-red-400/60 dark:border-red-600/60"
                                                    style={{ bottom: `${(threshold / maxVal) * 72}px` }}>
                                                    <span className="absolute right-1 -top-3 text-[7px] font-bold text-red-400 bg-white dark:bg-slate-800 px-1 rounded">
                                                        ⚠️ Quá tải ({threshold})
                                                    </span>
                                                </div>
                                                {/* Overload count summary */}
                                                {(() => {
                                                    const overloadDays = workloadData.filter(d => d.total > threshold).length;
                                                    return overloadDays > 0 ? (
                                                        <div className="absolute top-0 left-1 text-[8px] font-bold text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-b shadow-sm animate-pulse">
                                                            🔴 {overloadDays} ngày quá tải
                                                        </div>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* GĐ2: Gate Panel — pending tasks sidebar */}
            {showGatePanel && (() => {
                const pending = tasks.filter(t => t.gateStatus === 'pending' || (t.progress >= 100 && (!t.gateStatus || t.gateStatus === 'none')));
                const approved = tasks.filter(t => t.gateStatus === 'approved');
                const rejected = tasks.filter(t => t.gateStatus === 'rejected');
                return (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-700/30">
                            <div className="flex items-center gap-2">
                                <Shield size={14} className="text-amber-500" />
                                <span className="text-xs font-black text-slate-700 dark:text-white">Cổng Nghiệm Thu (Gate Approval)</span>
                            </div>
                            <button onClick={() => setShowGatePanel(false)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                                <X size={13} />
                            </button>
                        </div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Chờ duyệt */}
                            <div>
                                <p className="text-[9px] font-black text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <Clock size={9} /> Chờ nghiệm thu ({pending.length})
                                </p>
                                <div className="space-y-1.5">
                                    {pending.length === 0 && <p className="text-[10px] text-slate-400 italic">Không có</p>}
                                    {pending.map(t => (
                                        <button key={t.id}
                                            onClick={() => setGateModalTask(t)}
                                            className={`w-full flex items-center gap-2 p-2 rounded-xl border text-left hover:scale-[1.01] transition-all ${t.gateStatus === 'pending'
                                                    ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                                                    : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600'
                                                }`}>
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color || '#f97316' }} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">{t.name}</p>
                                                <p className="text-[9px] text-slate-400">
                                                    {t.gateStatus === 'pending' ? '⏳ Chờ duyệt' : '📋 Chưa nộp'}
                                                    {t.assignee && ` • ${t.assignee}`}
                                                </p>
                                            </div>
                                            <Shield size={11} className={t.gateStatus === 'pending' ? 'text-amber-500' : 'text-slate-300'} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {/* Đã duyệt */}
                            <div>
                                <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <CheckCircle2 size={9} /> Đã duyệt ({approved.length})
                                </p>
                                <div className="space-y-1.5">
                                    {approved.length === 0 && <p className="text-[10px] text-slate-400 italic">Không có</p>}
                                    {approved.map(t => (
                                        <button key={t.id}
                                            onClick={() => setGateModalTask(t)}
                                            className="w-full flex items-center gap-2 p-2 rounded-xl border text-left bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 hover:scale-[1.01] transition-all">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color || '#10b981' }} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">{t.name}</p>
                                                <p className="text-[9px] text-emerald-600">
                                                    ✓ {t.gateApprovedAt ? new Date(t.gateApprovedAt).toLocaleDateString('vi-VN') : 'Đã duyệt'}
                                                </p>
                                            </div>
                                            <CheckCircle2 size={11} className="text-emerald-500" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {/* Bị từ chối */}
                            <div>
                                <p className="text-[9px] font-black text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <AlertTriangle size={9} /> Bị từ chối ({rejected.length})
                                </p>
                                <div className="space-y-1.5">
                                    {rejected.length === 0 && <p className="text-[10px] text-slate-400 italic">Không có</p>}
                                    {rejected.map(t => (
                                        <button key={t.id}
                                            onClick={() => setGateModalTask(t)}
                                            className="w-full flex items-center gap-2 p-2 rounded-xl border text-left bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 hover:scale-[1.01] transition-all">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color || '#ef4444' }} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">{t.name}</p>
                                                <p className="text-[9px] text-red-500 truncate">
                                                    ✗ {t.gateApprovedBy || 'Không đạt'}
                                                </p>
                                            </div>
                                            <AlertTriangle size={11} className="text-red-400" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* GĐ5: AI Insights Panel */}
            {showAiInsights && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10">
                        <div className="flex items-center gap-2">
                            <Lightbulb size={14} className="text-amber-500" />
                            <span className="text-xs font-black text-slate-700 dark:text-white">🤖 AI Dự báo Rủi ro ({aiInsights.length})</span>
                        </div>
                        <button onClick={() => setShowAiInsights(false)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                            <X size={13} />
                        </button>
                    </div>
                    <div className="p-4">
                        {aiInsights.length === 0 ? (
                            <div className="text-center py-6">
                                <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                                <p className="text-xs font-bold text-emerald-600">Không phát hiện rủi ro nào! 🎉</p>
                                <p className="text-[10px] text-slate-400 mt-1">Dự án đang ổn định.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {aiInsights.map((insight, i) => (
                                    <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${
                                        insight.severity === 'high' ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800' :
                                        insight.severity === 'medium' ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' :
                                        'bg-slate-50 dark:bg-slate-700/30 border-slate-200 dark:border-slate-600'
                                    }`}>
                                        <span className="text-lg shrink-0 mt-0.5">{insight.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{insight.title}</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{insight.desc}</p>
                                        </div>
                                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full shrink-0 ${
                                            insight.severity === 'high' ? 'bg-red-100 text-red-600' :
                                            insight.severity === 'medium' ? 'bg-amber-100 text-amber-600' :
                                            'bg-slate-100 text-slate-500'
                                        }`}>{insight.severity === 'high' ? 'Cao' : insight.severity === 'medium' ? 'TB' : 'Thấp'}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ====== TASK FORM MODAL ====== */}
            {showForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && resetForm()}>
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-orange-500 to-amber-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editing ? <><Edit2 size={18} /> Sửa hạng mục</> : <><Plus size={18} /> Thêm hạng mục</>}
                            </span>
                            <button onClick={resetForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors"><X size={18} /></button>
                        </div>

                        {/* Form body */}
                        <div className="p-6 space-y-4">
                            {/* Task name */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Tên hạng mục <span className="text-red-400">*</span></label>
                                <input value={fName} onChange={e => setFName(e.target.value)} placeholder="VD: Đào móng, Đổ bê tông..."
                                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-bold bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" autoFocus />
                            </div>

                            {/* WBS Code + Unit */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Mã WBS</label>
                                    <input value={fWbsCode} onChange={e => setFWbsCode(e.target.value)} placeholder="VD: 1.1.3"
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Đơn vị</label>
                                    <input value={fFallbackUnit} onChange={e => setFFallbackUnit(e.target.value)} placeholder="m³, kg, m²..."
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                            </div>

                            {/* Planned Dates */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Calendar size={10} /> BĐ kế hoạch <span className="text-red-400">*</span></label>
                                    <input type="date" value={fStart} onChange={e => setFStart(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Calendar size={10} /> KT kế hoạch <span className="text-red-400">*</span></label>
                                    <input type="date" value={fEnd} onChange={e => setFEnd(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                            </div>

                            {/* Actual Dates */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Calendar size={10} /> BĐ thực tế</label>
                                    <input type="date" value={fActualStart} onChange={e => setFActualStart(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-700 text-sm bg-emerald-50/30 dark:bg-emerald-900/10 focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Calendar size={10} /> KT thực tế</label>
                                    <input type="date" value={fActualEnd} onChange={e => setFActualEnd(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-700 text-sm bg-emerald-50/30 dark:bg-emerald-900/10 focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                            </div>

                            {/* Duration info */}
                            {fStart && fEnd && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs text-blue-600 dark:text-blue-400 font-medium">
                                    <Clock size={12} /> Thời gian: <strong>{daysBetween(fStart, fEnd)} ngày</strong>
                                </div>
                            )}

                            {/* Progress + Assignee */}
                            <div className="grid grid-cols-2 gap-3">
	                                <div>
	                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">
	                                        Tiến độ: <span className="text-orange-600">{fProgress}%</span>
	                                    </label>
	                                    <input type="range" min={0} max={100} step={5} value={fProgress} disabled={fProgressMode === 'derived_from_acceptance'} onChange={e => setFProgress(e.target.value)}
	                                        className="w-full accent-orange-500 disabled:opacity-40" />
	                                    <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
	                                        <span>0%</span><span>50%</span><span>100%</span>
	                                    </div>
	                                </div>
	                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><User size={10} /> Người phụ trách</label>
                                    <select
                                        value={fAssigneeUserId}
                                        onChange={e => {
                                            const uid = e.target.value;
                                            setFAssigneeUserId(uid);
                                            if (uid) setFAssignee(staffUserMap.get(uid)?.name || '');
                                        }}
                                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-xs bg-transparent focus:ring-2 focus:ring-orange-500 outline-none mb-1.5"
                                    >
                                        <option value="">Chọn từ nhân sự dự án...</option>
                                        {watcherOptions.map(opt => (
                                            <option key={opt.id} value={opt.id}>{opt.name}{opt.position ? ` — ${opt.position}` : ''}</option>
                                        ))}
                                    </select>
                                    <input value={fAssignee} onChange={e => setFAssignee(e.target.value)} placeholder="Tên hiển thị"
                                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
	                                </div>
	                            </div>

                                <div className="rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-900/10 p-3">
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1 mb-2">
                                        <Eye size={11} className="text-blue-500" /> Người theo dõi
                                    </label>
                                    {fWatchers.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                            {fWatchers.map(uid => (
                                                <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                                    {staffUserMap.get(uid)?.name || uid}
                                                    <button onClick={() => setFWatchers(prev => prev.filter(id => id !== uid))} className="hover:text-red-500 transition-colors" title="Gỡ người theo dõi">
                                                        <X size={11} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <select
                                        value=""
                                        onChange={e => {
                                            if (!e.target.value) return;
                                            setFWatchers(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value]);
                                        }}
                                        disabled={watcherOptions.length === 0}
                                        className="w-full px-3 py-2 rounded-xl border border-blue-100 dark:border-blue-800 text-xs bg-white/70 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                                    >
                                        <option value="">{watcherOptions.length === 0 ? 'Chưa có nhân sự dự án' : '+ Thêm người theo dõi'}</option>
                                        {watcherOptions.filter(opt => !fWatchers.includes(opt.id)).map(opt => (
                                            <option key={opt.id} value={opt.id}>{opt.name}{opt.position ? ` — ${opt.position}` : ''}</option>
                                        ))}
                                    </select>
                                </div>

	                            <div>
	                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Nguồn tiến độ</label>
	                                <select value={fProgressMode} onChange={e => setFProgressMode(e.target.value as ProjectTaskProgressMode)}
	                                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none">
	                                    <option value="manual">Nhập tay theo kế hoạch thi công</option>
	                                    <option value="derived_from_acceptance">Tự tính từ nghiệm thu khối lượng</option>
	                                </select>
	                            </div>

                            {/* Parent + Color */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Thuộc hạng mục cha</label>
                                    <select value={fParentId} onChange={e => setFParentId(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none">
                                        <option value="">— Gốc (không cha) —</option>
                                        {tasks.filter(t => t.id !== editing?.id).map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Màu sắc</label>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {COLORS.map(c => (
                                            <button key={c} onClick={() => setFColor(c)}
                                                className={`w-7 h-7 rounded-lg transition-all ${fColor === c ? 'ring-2 ring-offset-2 ring-slate-800 scale-110' : 'hover:scale-110'}`}
                                                style={{ backgroundColor: c }} />
                                        ))}
                                    </div>
                                </div>
	                            </div>

	                            {contractItems.length > 0 && (
	                                <div className="border border-slate-100 dark:border-slate-700 rounded-xl p-3">
	                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-2">Liên kết BOQ hợp đồng</label>
	                                    <div className="max-h-28 overflow-y-auto space-y-1">
	                                        {contractItems.map(item => (
	                                            <label key={item.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
	                                                <input
	                                                    type="checkbox"
	                                                    checked={fContractItemIds.includes(item.id)}
	                                                    onChange={e => {
	                                                        setFContractItemIds(prev => e.target.checked
	                                                            ? [...prev, item.id]
	                                                            : prev.filter(id => id !== item.id));
	                                                    }}
	                                                    className="accent-orange-500"
	                                                />
	                                                <span className="font-bold text-indigo-600">{item.code}</span>
	                                                <span className="truncate">{item.name}</span>
	                                            </label>
	                                        ))}
	                                    </div>
	                                </div>
	                            )}

	                            {/* Milestone */}
                            <label className="flex items-center gap-2.5 cursor-pointer p-2.5 rounded-xl border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                <input type="checkbox" checked={fMilestone} onChange={e => setFMilestone(e.target.checked)}
                                    className="w-4 h-4 rounded accent-red-500" />
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1"><Flag size={12} className="text-red-500" /> Đánh dấu là Milestone (Mốc quan trọng)</span>
                            </label>

                            {/* GĐ1: Dependencies */}
                            <div className="border border-slate-100 dark:border-slate-700 rounded-xl p-3 space-y-2">
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1"><Link2 size={10} /> Phụ thuộc (Dependencies)</label>
                                {fDeps.map((dep, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <select value={dep.taskId} onChange={e => {
                                            const newDeps = [...fDeps];
                                            newDeps[i] = { ...newDeps[i], taskId: e.target.value };
                                            setFDeps(newDeps);
                                        }} className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs bg-transparent">
                                            <option value="">— Chọn task —</option>
                                            {tasks.filter(t => t.id !== editing?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
	                                        <select value={dep.type} onChange={e => {
	                                            const newDeps = [...fDeps];
	                                            newDeps[i] = { ...newDeps[i], type: e.target.value as TaskDependencyType };
	                                            setFDeps(newDeps);
	                                        }} className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs bg-transparent font-bold">
                                            <option value="FS">FS</option>
                                            <option value="SS">SS</option>
                                            <option value="FF">FF</option>
	                                            <option value="SF">SF</option>
	                                        </select>
	                                        <label className="flex items-center gap-1 text-[9px] font-bold text-slate-500 whitespace-nowrap">
	                                            <input type="checkbox" checked={!!dep.requiresGateApproval} onChange={e => {
	                                                const newDeps = [...fDeps];
	                                                newDeps[i] = { ...newDeps[i], requiresGateApproval: e.target.checked };
	                                                setFDeps(newDeps);
	                                            }} className="accent-orange-500" />
	                                            Chặn gate
	                                        </label>
                                        <button onClick={() => setFDeps(fDeps.filter((_, j) => j !== i))} className="w-6 h-6 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 transition-colors"><X size={12} /></button>
                                    </div>
                                ))}
                                <button onClick={() => setFDeps([...fDeps, { taskId: '', type: 'FS' }])}
                                    className="flex items-center gap-1 text-[10px] font-bold text-orange-500 hover:text-orange-600 transition-colors">
                                    <Plus size={10} /> Thêm phụ thuộc
                                </button>
                            </div>

                            {/* GĐ1: Lag Time + Resources */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Clock size={10} /> Lag (ngày)</label>
                                    <input type="number" min={0} value={fLagTime} onChange={e => setFLagTime(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Users size={10} /> Nhân lực</label>
                                    <input type="number" min={1} value={fResourceCount} onChange={e => setFResourceCount(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Wrench size={10} /> Loại TN</label>
                                    <select value={fResourceType} onChange={e => setFResourceType(e.target.value as ResourceType)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none">
                                        <option value="worker">Nhân công</option>
                                        <option value="machine">Máy móc</option>
                                        <option value="specialist">Chuyên gia</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Zap size={10} /> Chi phí/ngày (VNĐ)</label>
                                <input type="number" min={0} step={100000} value={fCostPerDay} onChange={e => setFCostPerDay(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Ghi chú</label>
                                <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2} placeholder="Ghi chú, yêu cầu kỹ thuật..."
                                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none resize-none" />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
                            <div>
                                {editing && (
                                    <button onClick={() => { setDeleteTarget(editing); resetForm(); }}
                                        className="px-3 py-2 rounded-xl text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1 transition-colors">
                                        <Trash2 size={14} /> Xoá
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={resetForm} className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Huỷ</button>
                                <button onClick={handleSave} disabled={!fName || !fStart || !fEnd}
                                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                                    <Save size={14} /> {editing ? 'Cập nhật' : 'Thêm mới'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== DELETE CONFIRM ====== */}
            <ConfirmDeleteModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                targetName={deleteTarget?.name || ''}
                subtitle={deleteTarget ? `${fmtDate(deleteTarget.startDate)} → ${fmtDate(deleteTarget.endDate)} • Tiến độ: ${deleteTarget.progress}%` : ''}
                warningText={deleteTarget && tasks.some(t => t.parentId === deleteTarget.id)
                    ? `Hạng mục này có ${collectDescendantTaskIds(tasks, deleteTarget.id).size} công việc con. Tất cả sẽ bị xoá và phụ thuộc liên quan sẽ được gỡ.`
                    : 'Hành động này không thể hoàn tác.'}
                countdownSeconds={2}
            />

            {/* GĐ2: Gate State Machine Modal */}
            <GateStateMachineModal
                task={gateModalTask}
                onClose={() => setGateModalTask(null)}
                onTransition={handleGateApproval}
            />

            {/* GĐ3: Photo Tooltip */}
            {photoTooltip && (
                <div className="fixed z-[9999] pointer-events-none bg-white rounded-lg shadow-xl border border-slate-200 p-2"
                    style={{ left: photoTooltip.x + 15, top: photoTooltip.y + 15 }}>
                    <img src={photoTooltip.photoUrl} className="w-32 h-24 object-cover rounded shadow-sm mb-1" />
                    <div className="text-[10px] font-bold text-slate-700 truncate w-32">{photoTooltip.taskName}</div>
                    <div className="text-[9px] text-slate-500">{new Date(photoTooltip.date).toLocaleDateString('vi-VN')}</div>
                </div>
            )}

            {/* ====== GĐ3: EXCEL IMPORT MODAL ====== */}
            {showImportModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-[95vw] max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                                    <FileSpreadsheet size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Xem trước dữ liệu Excel</h3>
                                    <p className="text-sm text-slate-500 font-medium">Hệ thống tìm thấy {importRows.length} hạng mục từ file</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <Upload size={14} /> Chọn file khác
                                </button>
                                <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                                    <Download size={14} /> Tải file mẫu
                                </button>
                                <button onClick={() => { setShowImportModal(false); setImportRows([]); setImportErrors({}); }} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-900/50 p-6">
                            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-[11px]">
                                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase tracking-wider font-bold">
                                            <tr>
                                                <th className="px-3 py-2 border-b border-slate-200 w-10 text-center">STT</th>
                                                <th className="px-3 py-2 border-b border-slate-200">Mã WBS</th>
                                                <th className="px-3 py-2 border-b border-slate-200">Công việc</th>
                                                <th className="px-3 py-2 border-b border-slate-200">BĐ Kế hoạch</th>
                                                <th className="px-3 py-2 border-b border-slate-200">KT Kế hoạch</th>
                                                <th className="px-3 py-2 border-b border-slate-200">Tiến độ</th>
                                                <th className="px-3 py-2 border-b border-slate-200">Trạng thái</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
	                                            {importRows.map((row, idx) => {
	                                                const err = importErrors[idx];
	                                                const plannedStart = parseExcelDate(row['Bắt đầu KH (*)']);
	                                                const plannedEnd = parseExcelDate(row['Kết thúc KH (*)']);
                                                const wbsPreview = row['Mã WBS'] ? String(row['Mã WBS']) : '-';
                                                const taskPreview = row['Công việc (*)'] ? String(row['Công việc (*)']) : '-';
                                                const progressPreview = parseProgress(row['Tiến độ (%)']);
	                                                return (
                                                    <tr key={idx} className={`hover:bg-slate-50 transition-colors ${err ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                                                        <td className="px-3 py-2 text-center text-slate-400">{idx + 1}</td>
	                                                        <td className="px-3 py-2 font-mono text-slate-600">{wbsPreview}</td>
	                                                        <td className="px-3 py-2 font-semibold text-slate-700">{taskPreview}</td>
                                                        <td className="px-3 py-2 text-slate-600">{plannedStart ? fmtDate(plannedStart) : '-'}</td>
                                                        <td className="px-3 py-2 text-slate-600">{plannedEnd ? fmtDate(plannedEnd) : '-'}</td>
                                                        <td className="px-3 py-2">
	                                                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-bold">{progressPreview}%</span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {err ? (
                                                                <span className="flex items-center gap-1 text-red-600 font-medium">
                                                                    <XCircle size={12} /> {err}
                                                                </span>
                                                            ) : (
                                                                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                                                    <CheckCircle2 size={12} /> Hợp lệ
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
                            <div className="flex gap-4 text-xs font-bold">
                                <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> {importRows.length - Object.keys(importErrors).length} Hợp lệ</span>
                                {Object.keys(importErrors).length > 0 && (
                                    <span className="text-red-500 flex items-center gap-1"><XCircle size={14} /> {Object.keys(importErrors).length} Lỗi</span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => { setShowImportModal(false); setImportRows([]); setImportErrors({}); }} className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Huỷ</button>
                                <button onClick={processBulkImport} disabled={importing || importRows.length === 0 || Object.keys(importErrors).length === importRows.length}
                                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                                    {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                    Nhập {importRows.length - Object.keys(importErrors).length} Hạng mục
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GanttTab;
