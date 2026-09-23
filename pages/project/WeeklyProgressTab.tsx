import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    X, Save, ChevronRight, ChevronDown, Search, Calendar, User, Clock,
    AlertTriangle, CheckCircle2, HelpCircle, Loader2, ArrowUpRight,
    ArrowDownRight, Folder, FolderOpen, ClipboardCheck, Sliders, PlayCircle
} from 'lucide-react';
import {
    ProjectTask, DailyLog, ProjectDailyTaskProgress, ProjectWeeklyTaskProgress, ContractItem,
    ProjectStaff, PurchaseOrder, MaterialBudgetItem,
    MaterialRequestFulfillmentBatch, ProjectTaskProgressMode, Attachment, TaskContractItem
} from '../../types';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { dailyLogService, poService, boqService } from '../../lib/projectService';
import { projectStaffService } from '../../lib/projectStaffService';
import { contractItemService } from '../../lib/contractItemService';
import {
    projectWeeklyProgressService, getWeekStart, getISOWeekLabel,
    getProjectScopeKey, calculateWeeklyConstructionProgress, calculateProjectValueProgress,
    addDaysToIsoDate, buildProgressSegments,
    mergeDailyProgressRows, rollupDailyRowsToWeeklyRows,
    getProjectProgressMutationErrorMessage,
    type ProjectProgressPeriodBundle, type ProjectProgressPeriodState, type ProjectProgressSnapshotPayload,
    type DailyProgressAuthority, type SaveProjectProgressPeriodResult,
} from '../../lib/projectWeeklyProgressService';
import { deriveProjectTaskProgress, clampProgress } from '../../lib/projectScheduleRules';
import { projectPermissionRoomService } from '../../lib/projectPermissionRoomService';
import {
    getWeeklyProgressEffectiveCapabilities,
    type EffectiveProjectRoomAction,
} from '../../lib/permissions/projectRoomEffectiveActions';

interface WeeklyProgressTabProps {
    projectId?: string;
    constructionSiteId?: string;
}

export interface WeeklyProgressPeriodControlsProps {
    periodType: ProgressEntryMode;
    periodStart: string;
    stateLoaded: boolean;
    state: Pick<ProjectProgressPeriodState, 'isLocked'> | null;
    canEdit: boolean;
    canConfirm: boolean;
    busy: boolean;
    hasRows: boolean;
    onSave: () => void;
    onClose: () => void;
    onReopen: () => void;
}

export const WeeklyProgressPeriodControls: React.FC<WeeklyProgressPeriodControlsProps> = ({
    stateLoaded,
    state,
    canEdit,
    canConfirm,
    busy,
    hasRows,
    onSave,
    onClose,
    onReopen,
}) => {
    if (!stateLoaded || !state) {
        return (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-2 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <Loader2 size={12} className="mr-1.5 animate-spin" /> Đang tải trạng thái
            </span>
        );
    }

    const locked = state.isLocked;
    return (
        <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-2 text-[10px] font-black ${locked
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}>
                {locked ? <CheckCircle2 size={12} className="mr-1.5" /> : <Clock size={12} className="mr-1.5" />}
                {locked ? 'Đã chốt' : 'Đang mở'}
            </span>

            {!locked && canEdit && (
                <button
                    type="button"
                    onClick={onSave}
                    disabled={busy || !hasRows}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    <span>Lưu thay đổi</span>
                </button>
            )}

            {!locked && canConfirm && (
                <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <ClipboardCheck size={13} /> <span>Chốt</span>
                </button>
            )}

            {locked && canConfirm && (
                <button
                    type="button"
                    onClick={onReopen}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <span>Mở chốt</span>
                </button>
            )}
        </div>
    );
};

type ProgressEntryMode = 'daily' | 'weekly';
type ProgressDraft = { progressPercent: string; quantityDone: string; note: string };
type TimeFilterMode = 'recent' | 'week' | 'month' | 'all';

interface DailyProgressCutoverFieldsProps {
    authoritative: boolean;
    row: ProjectDailyTaskProgress | null;
    progressPercent: string;
    quantityDone: string;
    note: string;
    unit: string;
    dailyLogHref: string | null;
    onChange: (patch: Partial<ProgressDraft>) => void;
    canRequestException?: boolean;
    onRequestException?: () => void;
}

export const DailyProgressCutoverFields: React.FC<DailyProgressCutoverFieldsProps> = ({
    authoritative, row, progressPercent, quantityDone, note, unit, dailyLogHref, onChange,
    canRequestException, onRequestException,
}) => {
    if (authoritative) {
        return <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-900 dark:bg-teal-950/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-teal-700 px-2 py-1 text-[10px] font-black text-white">
                    {row?.sourceDailyLogId ? 'Nguồn: Nhật ký tổng hợp' : 'Chờ nhật ký tổng hợp'}
                </span>
                {dailyLogHref && <a href={dailyLogHref} className="text-xs font-bold text-teal-800 underline underline-offset-2 dark:text-teal-300">Mở nhật ký</a>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
                <div><div className="text-[10px] font-bold uppercase text-slate-500">% hoàn thành</div><div className="font-black text-slate-900 dark:text-white">{progressPercent || 'Chưa có'}{progressPercent ? '%' : ''}</div></div>
                <div><div className="text-[10px] font-bold uppercase text-slate-500">Khối lượng</div><div className="font-black text-slate-900 dark:text-white">{quantityDone || 'Chưa xác định'}{quantityDone ? ` ${unit}` : ''}</div></div>
            </div>
            {note && <p className="text-xs text-slate-600 dark:text-slate-300">{note}</p>}
            {row && canRequestException && onRequestException && <button type="button" onClick={onRequestException} className="text-left text-xs font-bold text-amber-700 underline underline-offset-2">Điều chỉnh ngoại lệ</button>}
        </div>;
    }
    return <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">% hoàn thành<input aria-label="% hoàn thành" type="number" min="0" step="0.01" value={progressPercent} onChange={event => onChange({ progressPercent: event.target.value })} className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-black text-slate-900" /></label>
        <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">Khối lượng ({unit})<input aria-label="Khối lượng hoàn thành" type="number" min="0" step="0.01" value={quantityDone} onChange={event => onChange({ quantityDone: event.target.value })} className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-black text-slate-900" /></label>
        <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">Ghi chú<input aria-label="Ghi chú chốt" type="text" value={note} onChange={event => onChange({ note: event.target.value })} className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900" /></label>
    </div>;
};

export const getLatestDailyProgressRow = (
    rows: ProjectDailyTaskProgress[],
    scopeKey: string,
    taskId: string,
    progressDate: string,
    includeDate = true,
): ProjectDailyTaskProgress | undefined => rows
    .filter(row => row.scopeKey === scopeKey && row.taskId === taskId)
    .filter(row => includeDate ? row.progressDate <= progressDate : row.progressDate < progressDate)
    .sort((a, b) =>
        b.progressDate.localeCompare(a.progressDate)
        || (b.updatedAt || '').localeCompare(a.updatedAt || '')
    )[0];

export const buildWeeklyProgressBundleView = (
    bundle: Pick<ProjectProgressPeriodBundle,
        'dailyRows' | 'dailyBaselineRows' | 'weeklyRows' | 'weeklyBaselineRows' |
        'selectedWeeklyRows' | 'windowFromWeek' | 'windowToWeek'>,
) => {
    const allDailyProgress = mergeDailyProgressRows(bundle.dailyBaselineRows, bundle.dailyRows);
    return {
        allDailyProgress,
        dailyBaselineProgress: bundle.dailyBaselineRows,
        selectedDailyMutationRows: allDailyProgress,
        allWeeklyProgress: bundle.weeklyRows,
        weeklyBaselineProgress: bundle.weeklyBaselineRows,
        selectedWeeklyMutationRows: bundle.selectedWeeklyRows,
        loadedWeekRange: bundle.windowFromWeek && bundle.windowToWeek
            ? { fromWeek: bundle.windowFromWeek, toWeek: bundle.windowToWeek }
            : null,
    };
};

export const getWeeklyProgressPeriodKey = (
    scopeKey: string,
    periodType: ProgressEntryMode,
    periodStart: string,
): string => `${scopeKey}__${periodType}__${periodStart}`;

export const getWeeklyProgressMutationReadiness = (input: {
    actionsLoaded: boolean;
    baseDataReady?: boolean;
    canView: boolean;
    canEdit: boolean;
    canConfirm: boolean;
    currentKey: string;
    stateKey: string | null;
    draftKey: string | null;
    isLocked: boolean;
}): { canSave: boolean; canClose: boolean; canReopen: boolean } => {
    const currentResourcesReady = Boolean(input.actionsLoaded
        && input.baseDataReady !== false
        && input.canView
        && Boolean(input.currentKey)
        && input.stateKey === input.currentKey
        && input.draftKey === input.currentKey);
    return {
        canSave: currentResourcesReady && input.canEdit && !input.isLocked,
        canClose: currentResourcesReady && input.canConfirm && !input.isLocked,
        canReopen: currentResourcesReady && input.canConfirm && input.isLocked,
    };
};

export interface WeeklyProgressPeriodTarget {
    key: string;
    scopeKey: string;
    periodType: ProgressEntryMode;
    periodStart: string;
}

export type WeeklyProgressMutationOutcome<T> =
    | { ok: true; result: T; remainedOnCapturedTarget: boolean }
    | { ok: false; error: unknown; remainedOnCapturedTarget: boolean };

export const runWeeklyProgressKeyedReload = async <T,>(input: {
    targetKey: string;
    generation: number;
    read: () => Promise<T>;
    getCurrentKey: () => string;
    getGeneration: () => number;
    onInvalidate: () => void;
    onReady: (value: T) => void;
    onError: (error: unknown) => void;
}): Promise<{ applied: boolean }> => {
    input.onInvalidate();
    try {
        const value = await input.read();
        if (
            input.targetKey !== input.getCurrentKey()
            || input.generation !== input.getGeneration()
        ) return { applied: false };
        input.onReady(value);
        return { applied: true };
    } catch (error) {
        if (
            input.targetKey === input.getCurrentKey()
            && input.generation === input.getGeneration()
        ) input.onError(error);
        return { applied: false };
    }
};

export const completeWeeklyProgressMutationWithReload = async <T,>(input: {
    capturedTarget: WeeklyProgressPeriodTarget;
    mutate: () => Promise<T>;
    getCurrentTarget: () => WeeklyProgressPeriodTarget;
    reload: (target: WeeklyProgressPeriodTarget) => Promise<unknown>;
}): Promise<WeeklyProgressMutationOutcome<T>> => {
    const reloadUntilTargetSettles = async (): Promise<WeeklyProgressPeriodTarget> => {
        while (true) {
            const reloadTarget = input.getCurrentTarget();
            await input.reload(reloadTarget);
            const latestTarget = input.getCurrentTarget();
            if (latestTarget.key === reloadTarget.key) return latestTarget;
        }
    };
    try {
        const result = await input.mutate();
        const currentTarget = await reloadUntilTargetSettles();
        return {
            ok: true,
            result,
            remainedOnCapturedTarget: currentTarget.key === input.capturedTarget.key,
        };
    } catch (error) {
        const currentTarget = await reloadUntilTargetSettles();
        return {
            ok: false,
            error,
            remainedOnCapturedTarget: currentTarget.key === input.capturedTarget.key,
        };
    }
};

export const WeeklyProgressPermissionUnavailable: React.FC<{
    state: 'loading' | 'error' | 'denied';
    onRetry: () => void;
}> = ({ state, onRetry }) => (
    <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {state === 'loading' ? (
            <Loader2 size={36} className="mx-auto mb-3 animate-spin text-orange-500" />
        ) : (
            <AlertTriangle size={36} className="mx-auto mb-3 text-amber-500" />
        )}
        <p className="text-sm font-black text-slate-700 dark:text-slate-200">
            {state === 'loading'
                ? 'Đang tải quyền tiến độ…'
                : state === 'error'
                    ? 'Không thể tải quyền tiến độ'
                    : 'Bạn không có quyền Xem tiến độ.'}
        </p>
        {state === 'error' && (
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-white hover:bg-orange-600"
            >
                Thử lại
            </button>
        )}
    </div>
);

export const WeeklyProgressPeriodUnavailable: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
        <AlertTriangle size={18} className="shrink-0" />
        <div className="min-w-0 flex-1">
            <p className="text-xs font-black">Không thể tải dữ liệu kỳ tiến độ</p>
            <p className="text-[10px] font-bold">Trạng thái và dữ liệu nhập đang không khả dụng.</p>
        </div>
        <button
            type="button"
            onClick={onRetry}
            className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white"
        >
            Thử lại
        </button>
    </div>
);

const DEFAULT_PROGRESS_WINDOW_WEEKS = 8;

const getRecentWeekWindowStart = (weekStart: string): string =>
    addDaysToIsoDate(weekStart, -7 * (DEFAULT_PROGRESS_WINDOW_WEEKS - 1));

const getMonthWeekWindow = (month: string): { fromWeek: string; toWeek: string } => {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
        const fallbackWeek = getWeekStart(new Date());
        return { fromWeek: getRecentWeekWindowStart(fallbackWeek), toWeek: fallbackWeek };
    }
    const monthStart = `${yearText}-${monthText}-01`;
    const monthEnd = addDaysToIsoDate(new Date(year, monthIndex, 0), 0);
    return {
        fromWeek: getWeekStart(monthStart),
        toWeek: getWeekStart(monthEnd),
    };
};

const enumerateWeekStarts = (fromWeek?: string | null, toWeek?: string | null): string[] => {
    if (!fromWeek || !toWeek || fromWeek > toWeek) return [];
    const weeks: string[] = [];
    for (let week = fromWeek; week <= toWeek; week = addDaysToIsoDate(week, 7)) {
        weeks.push(week);
    }
    return weeks;
};

// Helper formats
const formatQuantity = (value?: number | null): string => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
};

const formatMoneyShort = (value?: number | null): string => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0 đ';
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
    if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}k`;
    return `${Math.round(n).toLocaleString('vi-VN')} đ`;
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

const parseWeeklyProgressPercent = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return 0;
    const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
    return Number.isNaN(n) ? 0 : clampProgress(n);
};

const parseNonNegativeNumber = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return 0;
    const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
    return Number.isNaN(n) || n < 0 ? 0 : n;
};

const formatNumberInput = (value: number, decimals = 2): string => {
    if (!Number.isFinite(value)) return '';
    return parseFloat(value.toFixed(decimals)).toString();
};

/** Green/Teal shade generator from light to dark based on index and total count */
const getTealShade = (index: number, total = 8): string => {
    const shades = [
        '#99f6e4', // teal-200 (lightest)
        '#5eead4', // teal-300
        '#2dd4bf', // teal-400
        '#14b8a6', // teal-500
        '#0d9488', // teal-600
        '#0f766e', // teal-700
        '#115e59', // teal-800
        '#134e4a', // teal-900 (darkest)
    ];
    if (total <= 1) return shades[5];
    const step = Math.min(shades.length - 1, Math.floor((index / Math.max(1, total - 1)) * (shades.length - 1)));
    return shades[step];
};

export default function WeeklyProgressTab({ projectId, constructionSiteId }: WeeklyProgressTabProps) {
    const { user, projectFinances } = useApp();
    const toast = useToast();
    const confirm = useConfirm();
    const reasonConfirm = useReasonConfirm();
    const navigate = useNavigate();
    const location = useLocation();

    const navigateToGanttTask = useCallback((taskId: string) => {
        const query = new URLSearchParams(location.search);
        query.set('tab', 'gantt');
        query.set('taskId', taskId);
        if (projectId) query.set('projectId', projectId);
        if (constructionSiteId) query.set('siteId', constructionSiteId);
        navigate(`/da?${query.toString()}`);
    }, [location.search, navigate, projectId, constructionSiteId]);

    const effectiveId = projectId || constructionSiteId || '';
    const scopeKey = useMemo(() => getProjectScopeKey(projectId || null, constructionSiteId || null), [projectId, constructionSiteId]);

    // Data states
    const [loading, setLoading] = useState(true);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
    const [contractItems, setContractItems] = useState<ContractItem[]>([]);
    const [taskContractLinkRows, setTaskContractLinkRows] = useState<TaskContractItem[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [materialBudgets, setMaterialBudgets] = useState<MaterialBudgetItem[]>([]);
    const [fulfillmentBatches, setFulfillmentBatches] = useState<MaterialRequestFulfillmentBatch[]>([]);
    const [projectStaff, setProjectStaff] = useState<ProjectStaff[]>([]);
    const [allWeeklyProgress, setAllWeeklyProgress] = useState<ProjectWeeklyTaskProgress[]>([]);
    const [weeklyBaselineProgress, setWeeklyBaselineProgress] = useState<ProjectWeeklyTaskProgress[]>([]);
    const [allDailyProgress, setAllDailyProgress] = useState<ProjectDailyTaskProgress[]>([]);
    const [dailyBaselineProgress, setDailyBaselineProgress] = useState<ProjectDailyTaskProgress[]>([]);
    const [loadedWeekRange, setLoadedWeekRange] = useState<{ fromWeek: string; toWeek: string } | null>(null);
    const [baseDataLoadState, setBaseDataLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [baseDataLoadKey, setBaseDataLoadKey] = useState<string | null>(null);
    const [baseDataRetryNonce, setBaseDataRetryNonce] = useState(0);
    const baseDataRequestGeneration = useRef(0);
    const baseDataScopeRef = useRef(scopeKey);
    baseDataScopeRef.current = scopeKey;

    // Weekly chốt states
    const [entryMode, setEntryMode] = useState<ProgressEntryMode>('daily');
    const [selectedProgressDate, setSelectedProgressDate] = useState<string>(() => addDaysToIsoDate(new Date(), 0));
    const [selectedWeekStart, setSelectedWeekStart] = useState<string>(() => getWeekStart(new Date()));
    const [dailyDrafts, setDailyDrafts] = useState<Record<string, ProgressDraft>>({});
    const [weeklyDrafts, setWeeklyDrafts] = useState<Record<string, ProgressDraft>>({});
    const [confirmedWeeklyOverrunKeys, setConfirmedWeeklyOverrunKeys] = useState<Set<string>>(new Set());
    const [savingDailyProgress, setSavingDailyProgress] = useState(false);
    const [savingWeeklyProgress, setSavingWeeklyProgress] = useState(false);
    const [effectiveRoomActions, setEffectiveRoomActions] = useState<EffectiveProjectRoomAction[]>([]);
    const [actionLoadState, setActionLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [actionRetryNonce, setActionRetryNonce] = useState(0);
    const [dailyPeriodState, setDailyPeriodState] = useState<ProjectProgressPeriodState | null>(null);
    const [weeklyPeriodState, setWeeklyPeriodState] = useState<ProjectProgressPeriodState | null>(null);
    const [dailyPeriodStateKey, setDailyPeriodStateKey] = useState<string | null>(null);
    const [weeklyPeriodStateKey, setWeeklyPeriodStateKey] = useState<string | null>(null);
    const [dailyDraftKey, setDailyDraftKey] = useState<string | null>(null);
    const [weeklyDraftKey, setWeeklyDraftKey] = useState<string | null>(null);
    const [selectedDailyMutationRows, setSelectedDailyMutationRows] = useState<ProjectDailyTaskProgress[]>([]);
    const [selectedWeeklyMutationRows, setSelectedWeeklyMutationRows] = useState<ProjectWeeklyTaskProgress[]>([]);
    const [dailyProgressAuthority, setDailyProgressAuthority] = useState<DailyProgressAuthority | null>(null);
    const [exceptionRow, setExceptionRow] = useState<ProjectDailyTaskProgress | null>(null);
    const [exceptionProgress, setExceptionProgress] = useState('');
    const [exceptionQuantity, setExceptionQuantity] = useState('');
    const [exceptionDailyQuantity, setExceptionDailyQuantity] = useState('');
    const [exceptionNote, setExceptionNote] = useState('');
    const [exceptionReason, setExceptionReason] = useState('');
    const [savingException, setSavingException] = useState(false);
    const [periodResourceLoadState, setPeriodResourceLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [periodResourceRetryNonce, setPeriodResourceRetryNonce] = useState(0);
    const periodStateRequestGeneration = useRef(0);
    const dailyLogsRef = useRef<DailyLog[]>([]);
    const authoritativeTaskRowsRef = useRef<{ tasks: ProjectTask[]; periodStart: string } | null>(null);
    dailyLogsRef.current = dailyLogs;

    // Filter states
    const [selectedFilterTaskId, setSelectedFilterTaskId] = useState<string>('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [dropdownSearch, setDropdownSearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Time filter states
    const [timeFilterMode, setTimeFilterMode] = useState<TimeFilterMode>('recent');
    const [filterWeek, setFilterWeek] = useState<string>(() => getWeekStart(new Date()));
    const [filterMonth, setFilterMonth] = useState<string>(() => getWeekStart(new Date()).substring(0, 7));

    // WBS Collapse state (default collapsed)
    const [weeklyCollapsedParents, setWeeklyCollapsedParents] = useState<Set<string>>(new Set());
    const hasInitializedCollapse = useRef(false);

    useEffect(() => {
        hasInitializedCollapse.current = false;
        setWeeklyCollapsedParents(new Set());
    }, [effectiveId]);

    useEffect(() => {
        let cancelled = false;
        setEffectiveRoomActions([]);
        setActionLoadState('loading');

        if (!projectId || !user?.id) {
            setActionLoadState('loaded');
            return () => { cancelled = true; };
        }

        projectPermissionRoomService.listMyActions(projectId, constructionSiteId || null)
            .then(actions => {
                if (cancelled) return;
                setEffectiveRoomActions(actions);
                setActionLoadState('loaded');
            })
            .catch(error => {
                console.warn('Weekly progress effective Room action load failed', error);
                if (cancelled) return;
                setEffectiveRoomActions([]);
                setActionLoadState('error');
            });

        return () => { cancelled = true; };
    }, [actionRetryNonce, constructionSiteId, projectId, user?.id]);

    const weeklyProgressCapabilities = useMemo(
        () => getWeeklyProgressEffectiveCapabilities(
            effectiveRoomActions,
            actionLoadState === 'loaded',
        ),
        [actionLoadState, effectiveRoomActions],
    );

    const dailyCurrentPeriodKey = useMemo(
        () => getWeeklyProgressPeriodKey(scopeKey, 'daily', selectedProgressDate),
        [scopeKey, selectedProgressDate],
    );
    const weeklyCurrentPeriodKey = useMemo(
        () => getWeeklyProgressPeriodKey(scopeKey, 'weekly', selectedWeekStart),
        [scopeKey, selectedWeekStart],
    );
    const currentPeriodTarget = useMemo<WeeklyProgressPeriodTarget>(() => ({
        key: entryMode === 'daily' ? dailyCurrentPeriodKey : weeklyCurrentPeriodKey,
        scopeKey,
        periodType: entryMode,
        periodStart: entryMode === 'daily' ? selectedProgressDate : selectedWeekStart,
    }), [dailyCurrentPeriodKey, entryMode, scopeKey, selectedProgressDate, selectedWeekStart, weeklyCurrentPeriodKey]);
    const currentPeriodTargetRef = useRef(currentPeriodTarget);
    currentPeriodTargetRef.current = currentPeriodTarget;

    useEffect(() => {
        const source = authoritativeTaskRowsRef.current;
        if (!source) return;
        setTasks(deriveProjectTaskProgress(source.tasks, dailyLogs, source.periodStart));
    }, [dailyLogs]);

    // Task contract link maps
    const [taskContractLinks, setTaskContractLinks] = useState<Record<string, string[]>>({});

    // Load scope-owned base data as one keyed bundle. Mutations remain disabled
    // until this exact project/site scope has loaded successfully.
    const loadData = useCallback(async () => {
        const targetKey = scopeKey;
        const generation = ++baseDataRequestGeneration.current;
        setBaseDataLoadKey(null);
        setBaseDataLoadState('loading');
        setLoading(true);
        setDailyLogs([]);
        setContractItems([]);
        setPurchaseOrders([]);
        setMaterialBudgets([]);
        setFulfillmentBatches([]);
        setProjectStaff([]);

        if (actionLoadState !== 'loaded' || !weeklyProgressCapabilities.canView || !effectiveId || !targetKey) {
            if (generation === baseDataRequestGeneration.current) {
                setBaseDataLoadState('idle');
                setLoading(false);
            }
            return;
        }
        try {
            const [
                logData,
                contractItemData,
                poData,
                boqData,
                fulfillmentBatchData,
                staffData,
            ] = await Promise.all([
                dailyLogService.list(effectiveId, constructionSiteId || null),
                contractItemService.listBySite(effectiveId, undefined, constructionSiteId || null),
                poService.list(effectiveId, constructionSiteId || null),
                boqService.list(effectiveId, constructionSiteId || null),
                projectWeeklyProgressService.listFulfillmentBatchesByScope(effectiveId, constructionSiteId || null),
                projectId
                    ? projectStaffService.listByProject(projectId, constructionSiteId)
                    : constructionSiteId
                        ? projectStaffService.listBySite(constructionSiteId)
                        : Promise.resolve([]),
            ]);

            if (
                generation !== baseDataRequestGeneration.current
                || baseDataScopeRef.current !== targetKey
            ) return;

            setDailyLogs(logData);
            setContractItems(contractItemData);
            setPurchaseOrders(poData);
            setMaterialBudgets(boqData);
            setFulfillmentBatches(fulfillmentBatchData);
            setProjectStaff(staffData);
            setBaseDataLoadKey(targetKey);
            setBaseDataLoadState('ready');
        } catch (error) {
            console.error('WeeklyProgressTab load error:', error);
            if (
                generation === baseDataRequestGeneration.current
                && baseDataScopeRef.current === targetKey
            ) {
                setBaseDataLoadKey(null);
                setBaseDataLoadState('error');
                toast.error('Không thể tải dữ liệu tiến độ', 'Vui lòng kiểm tra lại kết nối mạng.');
            }
        } finally {
            if (
                generation === baseDataRequestGeneration.current
                && baseDataScopeRef.current === targetKey
            ) setLoading(false);
        }
    }, [actionLoadState, baseDataRetryNonce, effectiveId, constructionSiteId, projectId, scopeKey, toast, weeklyProgressCapabilities.canView]);

    useEffect(() => {
        void loadData();
        return () => {
            baseDataRequestGeneration.current += 1;
        };
    }, [loadData]);

    const progressWeekWindow = useMemo(() => {
        if (timeFilterMode === 'all') return null;
        if (timeFilterMode === 'month') {
            return getMonthWeekWindow(filterMonth || selectedWeekStart.substring(0, 7));
        }
        const targetWeek = timeFilterMode === 'week'
            ? (filterWeek || selectedWeekStart)
            : selectedWeekStart;
        return {
            fromWeek: getRecentWeekWindowStart(targetWeek),
            toWeek: targetWeek,
        };
    }, [filterMonth, filterWeek, selectedWeekStart, timeFilterMode]);

    // Handle click outside searchable select
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Set default collapse when tasks load
    useEffect(() => {
        if (tasks.length > 0 && !hasInitializedCollapse.current) {
            const parentIds = new Set<string>();
            tasks.forEach(t => {
                if (t.parentId) parentIds.add(t.parentId);
            });
            setWeeklyCollapsedParents(parentIds);
            hasInitializedCollapse.current = true;
        }
    }, [tasks]);

    // Child counts and children map
    const { childCountByTaskId, childrenByTaskId } = useMemo(() => {
        const counts = new Map<string, number>();
        const children = new Map<string, ProjectTask[]>();
        tasks.forEach(task => {
            if (task.parentId) {
                counts.set(task.parentId, (counts.get(task.parentId) || 0) + 1);
                const list = children.get(task.parentId) || [];
                list.push(task);
                children.set(task.parentId, list);
            }
        });
        return { childCountByTaskId: counts, childrenByTaskId: children };
    }, [tasks]);

    // WBS leaf tasks
    const weeklyLeafTasks = useMemo(() => {
        return tasks.filter(task => !childCountByTaskId.has(task.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [tasks, childCountByTaskId]);

    // Financial calculations
    const currentProjectFinance = useMemo(() => {
        return projectFinances.find(f => projectId && f.projectId === projectId)
            || projectFinances.find(f => constructionSiteId && f.constructionSiteId === constructionSiteId);
    }, [constructionSiteId, projectFinances, projectId]);

    const valueProgressMetric = useMemo(() => {
        return calculateProjectValueProgress({
            projectFinance: currentProjectFinance,
            customerItems: contractItems.filter(item => item.contractType === 'customer'),
            purchaseOrders,
            fulfillmentBatches,
            materialBudgets,
        });
    }, [contractItems, currentProjectFinance, fulfillmentBatches, materialBudgets, purchaseOrders]);

    const loadedWindowWeeks = useMemo(
        () => enumerateWeekStarts(loadedWeekRange?.fromWeek, loadedWeekRange?.toWeek),
        [loadedWeekRange],
    );

    // unique week lists
    const uniqueWeeks = useMemo(() => {
        const weeksSet = new Set<string>();
        loadedWindowWeeks.forEach(week => weeksSet.add(week));
        allWeeklyProgress.forEach(p => {
            if (p.weekStart) weeksSet.add(p.weekStart);
        });
        if (weeksSet.size === 0 && selectedWeekStart) {
            weeksSet.add(selectedWeekStart);
        }
        return Array.from(weeksSet).sort();
    }, [allWeeklyProgress, loadedWindowWeeks, selectedWeekStart]);

    const weekColors = useMemo(() => {
        const colors: Record<string, string> = {};
        const total = uniqueWeeks.length;
        uniqueWeeks.forEach((week, idx) => {
            colors[week] = getTealShade(idx, total);
        });
        return colors;
    }, [uniqueWeeks]);

    const uniqueMonths = useMemo(() => {
        return Array.from(new Set(uniqueWeeks.map(w => w.substring(0, 7)))).sort();
    }, [uniqueWeeks]);

    // Set initial filters on load
    useEffect(() => {
        if (uniqueWeeks.length > 0 && !filterWeek) {
            setFilterWeek(uniqueWeeks[uniqueWeeks.length - 1]);
        }
        if (uniqueMonths.length > 0 && !filterMonth) {
            setFilterMonth(uniqueMonths[uniqueMonths.length - 1]);
        }
    }, [uniqueWeeks, uniqueMonths, filterWeek, filterMonth]);

    const visibleWeeks = useMemo(() => {
        return uniqueWeeks.filter(week => {
            if (timeFilterMode === 'recent') {
                return true;
            }
            if (timeFilterMode === 'week') {
                return week <= filterWeek;
            }
            if (timeFilterMode === 'month') {
                return true;
            }
            return true;
        });
    }, [uniqueWeeks, timeFilterMode, filterWeek, filterMonth]);

    const selectedWeekDays = useMemo(
        () => Array.from({ length: 7 }, (_, index) => addDaysToIsoDate(selectedWeekStart, index)),
        [selectedWeekStart],
    );

    const dayColors = useMemo(() => {
        const colors: Record<string, string> = {};
        const total = selectedWeekDays.length;
        selectedWeekDays.forEach((day, idx) => {
            colors[day] = getTealShade(idx, total);
        });
        return colors;
    }, [selectedWeekDays]);

    const getLatestDailyProgressForTask = useCallback((taskId: string, progressDate: string, includeDate = true) => {
        return getLatestDailyProgressRow(
            selectedDailyMutationRows,
            scopeKey,
            taskId,
            progressDate,
            includeDate,
        );
    }, [scopeKey, selectedDailyMutationRows]);

    const invalidateSelectedPeriodResources = useCallback(() => {
        setDailyPeriodState(null);
        setWeeklyPeriodState(null);
        setDailyPeriodStateKey(null);
        setWeeklyPeriodStateKey(null);
        setDailyDrafts({});
        setWeeklyDrafts({});
        setDailyDraftKey(null);
        setWeeklyDraftKey(null);
        setSelectedDailyMutationRows([]);
        setSelectedWeeklyMutationRows([]);
        setDailyProgressAuthority(null);
        setPeriodResourceLoadState('loading');
    }, []);

    const reloadAuthoritativePeriodResources = useCallback(async (
        target: WeeklyProgressPeriodTarget = currentPeriodTargetRef.current,
    ) => {
        if (
            actionLoadState !== 'loaded'
            || !weeklyProgressCapabilities.canView
            || !projectId
            || !effectiveId
            || !target.scopeKey
        ) {
            periodStateRequestGeneration.current += 1;
            invalidateSelectedPeriodResources();
            setPeriodResourceLoadState('idle');
            return { applied: false };
        }

        const generation = ++periodStateRequestGeneration.current;
        return runWeeklyProgressKeyedReload({
            targetKey: target.key,
            generation,
            getCurrentKey: () => currentPeriodTargetRef.current.key,
            getGeneration: () => periodStateRequestGeneration.current,
            onInvalidate: invalidateSelectedPeriodResources,
            read: async () => {
                const [bundle, authority] = await Promise.all([
                    projectWeeklyProgressService.getPeriodBundle({
                        projectId,
                        constructionSiteId: constructionSiteId || null,
                        periodType: target.periodType,
                        periodStart: target.periodStart,
                        windowFromWeek: progressWeekWindow?.fromWeek || null,
                        windowToWeek: progressWeekWindow?.toWeek || null,
                    }),
                    target.periodType === 'daily'
                        ? projectWeeklyProgressService.getDailyProgressAuthority({
                            projectId,
                            constructionSiteId: constructionSiteId || null,
                            progressDate: target.periodStart,
                        })
                        : Promise.resolve(null),
                ]);
                return { target, bundle, authority };
            },
            onReady: resource => {
                const { bundle } = resource;
                authoritativeTaskRowsRef.current = {
                    tasks: bundle.tasks,
                    periodStart: resource.target.periodStart,
                };
                const authoritativeTasks = deriveProjectTaskProgress(
                    bundle.tasks,
                    dailyLogsRef.current,
                    resource.target.periodStart,
                );
                const parentIds = new Set(authoritativeTasks.map(task => task.parentId).filter(Boolean));
                const leafTasks = authoritativeTasks
                    .filter(task => !parentIds.has(task.id))
                    .sort((a, b) => (a.order || 0) - (b.order || 0));

                setTasks(authoritativeTasks);
                setTaskContractLinkRows(bundle.taskContractItems);
                setTaskContractLinks(bundle.taskContractItems.reduce<Record<string, string[]>>((acc, link) => {
                    if (!acc[link.taskId]) acc[link.taskId] = [];
                    acc[link.taskId].push(link.contractItemId);
                    return acc;
                }, {}));

                const bundleView = buildWeeklyProgressBundleView(bundle);
                setAllWeeklyProgress(bundleView.allWeeklyProgress);
                setWeeklyBaselineProgress(bundleView.weeklyBaselineProgress);
                setAllDailyProgress(bundleView.allDailyProgress);
                setDailyBaselineProgress(bundleView.dailyBaselineProgress);
                setLoadedWeekRange(bundleView.loadedWeekRange);

                if (resource.target.periodType === 'daily') {
                    setDailyProgressAuthority(resource.authority);
                    const nextDrafts: Record<string, ProgressDraft> = {};
                    leafTasks.forEach(task => {
                        const found = bundleView.selectedDailyMutationRows
                            .filter(row => row.taskId === task.id && row.progressDate <= resource.target.periodStart)
                            .sort((a, b) =>
                                b.progressDate.localeCompare(a.progressDate)
                                || (b.updatedAt || '').localeCompare(a.updatedAt || '')
                            )[0];
                        const currentProgress = parseWeeklyProgressPercent(task.progress);
                        const plannedQuantity = Number(task.provisionalQuantity || 0);
                        const progressPercent = found?.progressPercent ?? currentProgress;
                        const quantityDone = found?.quantityDone
                            ?? (plannedQuantity > 0 ? (plannedQuantity * progressPercent) / 100 : 0);
                        nextDrafts[task.id] = {
                            progressPercent: formatNumberInput(progressPercent, 2),
                            quantityDone: formatNumberInput(quantityDone, 2),
                            note: found?.progressDate === resource.target.periodStart ? (found.note || '') : '',
                        };
                    });
                    setDailyPeriodState(bundle.state);
                    setDailyPeriodStateKey(resource.target.key);
                    setDailyDrafts(nextDrafts);
                    setDailyDraftKey(resource.target.key);
                    setSelectedDailyMutationRows(bundleView.selectedDailyMutationRows);
                    setSelectedWeeklyMutationRows(bundleView.selectedWeeklyMutationRows);
                } else {
                    setDailyProgressAuthority(null);
                    const nextDrafts: Record<string, ProgressDraft> = {};
                    leafTasks.forEach(task => {
                        const found = bundleView.selectedWeeklyMutationRows.find(row => row.taskId === task.id);
                        const currentProgress = parseWeeklyProgressPercent(task.progress);
                        const plannedQuantity = Number(task.provisionalQuantity || 0);
                        const progressPercent = found?.progressPercent ?? currentProgress;
                        const quantityDone = found?.quantityDone
                            ?? (plannedQuantity > 0 ? (plannedQuantity * progressPercent) / 100 : 0);
                        nextDrafts[task.id] = {
                            progressPercent: formatNumberInput(progressPercent, 2),
                            quantityDone: formatNumberInput(quantityDone, 2),
                            note: found?.note || '',
                        };
                    });
                    setWeeklyPeriodState(bundle.state);
                    setWeeklyPeriodStateKey(resource.target.key);
                    setWeeklyDrafts(nextDrafts);
                    setWeeklyDraftKey(resource.target.key);
                    setSelectedWeeklyMutationRows(bundleView.selectedWeeklyMutationRows);
                }
                setPeriodResourceLoadState('ready');
            },
            onError: error => {
                console.warn('Weekly progress authoritative period load failed', error);
                setPeriodResourceLoadState('error');
            },
        });
    }, [
        actionLoadState,
        constructionSiteId,
        effectiveId,
        invalidateSelectedPeriodResources,
        progressWeekWindow,
        projectId,
        weeklyProgressCapabilities.canView,
    ]);

    useEffect(() => {
        void reloadAuthoritativePeriodResources(currentPeriodTarget);
        return () => {
            periodStateRequestGeneration.current += 1;
        };
    }, [currentPeriodTarget, periodResourceRetryNonce, reloadAuthoritativePeriodResources]);

    const beginPeriodTargetChange = useCallback((target: WeeklyProgressPeriodTarget) => {
        periodStateRequestGeneration.current += 1;
        currentPeriodTargetRef.current = target;
        invalidateSelectedPeriodResources();
    }, [invalidateSelectedPeriodResources]);

    const weeklyBaselineRollup = useMemo(() => {
        if (tasks.length === 0) return {};
        const leafProgressMap = new Map(weeklyBaselineProgress.map(row => [row.taskId, row]));
        const rawTasks = tasks.map(task => {
            const entry = leafProgressMap.get(task.id);
            return {
                ...task,
                progress: entry ? entry.progressPercent : 0,
                progressMode: 'weekly_report' as const,
            };
        });
        const derived = deriveProjectTaskProgress(rawTasks, dailyLogs);
        return derived.reduce<Record<string, { progress: number }>>((acc, task) => {
            acc[task.id] = { progress: task.progress };
            return acc;
        }, {});
    }, [dailyLogs, tasks, weeklyBaselineProgress]);

    const dailyBaselineRollup = useMemo(() => {
        if (tasks.length === 0) return {};
        const leafProgressMap = new Map(dailyBaselineProgress.map(row => [row.taskId, row]));
        const rawTasks = tasks.map(task => {
            const entry = leafProgressMap.get(task.id);
            return {
                ...task,
                progress: entry ? entry.progressPercent : 0,
                progressMode: 'weekly_report' as const,
            };
        });
        const derived = deriveProjectTaskProgress(rawTasks, dailyLogs);
        return derived.reduce<Record<string, { progress: number }>>((acc, task) => {
            acc[task.id] = { progress: task.progress };
            return acc;
        }, {});
    }, [dailyBaselineProgress, dailyLogs, tasks]);

    // Compute weekly history rollup for all tasks and all weeks
    const weeklyHistoryRollup = useMemo(() => {
        if (tasks.length === 0) return {};

        const history: Record<string, Record<string, { progress: number; note?: string; updatedBy?: string; updatedAt?: string }>> = {};
        const leafProgressMap = new Map<string, ProjectWeeklyTaskProgress>(
            weeklyBaselineProgress.map(row => [row.taskId, row]),
        );

        for (const week of uniqueWeeks) {
            const entriesThisWeek = allWeeklyProgress.filter(p => p.weekStart === week);
            entriesThisWeek.forEach(entry => {
                leafProgressMap.set(entry.taskId, entry);
            });

            const rawTasks = tasks.map(t => {
                const entry = leafProgressMap.get(t.id);
                if (entry) {
                    return {
                        ...t,
                        progress: entry.progressPercent,
                        progressMode: 'weekly_report' as const,
                    };
                }
                return {
                    ...t,
                    progress: 0,
                    progressMode: 'weekly_report' as const,
                };
            });

            const derived = deriveProjectTaskProgress(rawTasks, dailyLogs);

            const taskProgressMap: Record<string, { progress: number; note?: string; updatedBy?: string; updatedAt?: string }> = {};
            derived.forEach(t => {
                const leafEntry = entriesThisWeek.find(e => e.taskId === t.id);
                taskProgressMap[t.id] = {
                    progress: t.progress,
                    note: leafEntry?.note || undefined,
                    updatedBy: leafEntry?.updatedBy || undefined,
                    updatedAt: leafEntry?.updatedAt || undefined,
                };
            });
            history[week] = taskProgressMap;
        }
        return history;
    }, [tasks, uniqueWeeks, allWeeklyProgress, dailyLogs, weeklyBaselineProgress]);

    const dailyHistoryRollup = useMemo(() => {
        if (tasks.length === 0) return {};

        const history: Record<string, Record<string, { progress: number; note?: string; updatedBy?: string; updatedAt?: string }>> = {};

        for (const day of selectedWeekDays) {
            const rawTasks = tasks.map(t => {
                const entry = getLatestDailyProgressRow(allDailyProgress, scopeKey, t.id, day);
                if (entry) {
                    return {
                        ...t,
                        progress: entry.progressPercent,
                        progressMode: 'weekly_report' as const,
                    };
                }
                return {
                    ...t,
                    progress: 0,
                    progressMode: 'weekly_report' as const,
                };
            });

            const derived = deriveProjectTaskProgress(rawTasks, dailyLogs);
            const exactEntries = allDailyProgress.filter(row => row.scopeKey === scopeKey && row.progressDate === day);
            const taskProgressMap: Record<string, { progress: number; note?: string; updatedBy?: string; updatedAt?: string }> = {};

            derived.forEach(t => {
                const exactEntry = exactEntries.find(entry => entry.taskId === t.id);
                taskProgressMap[t.id] = {
                    progress: t.progress,
                    note: exactEntry?.note || undefined,
                    updatedBy: exactEntry?.updatedBy || undefined,
                    updatedAt: exactEntry?.updatedAt || undefined,
                };
            });
            history[day] = taskProgressMap;
        }

        return history;
    }, [allDailyProgress, dailyLogs, scopeKey, selectedWeekDays, tasks]);

    const staffMap = useMemo(() => {
        const map = new Map<string, string>();
        projectStaff.forEach(s => {
            if (s.userId) {
                map.set(s.userId, s.userName || s.userId);
            }
        });
        return map;
    }, [projectStaff]);

    // Weekly construction progress statistics
    const weeklyConstructionProgress = useMemo(
        () => calculateWeeklyConstructionProgress(tasks, taskContractLinkRows, contractItems),
        [contractItems, taskContractLinkRows, tasks],
    );

    const draftWeeklyConstructionProgress = useMemo(() => {
        if (weeklyLeafTasks.length === 0) return weeklyConstructionProgress;
        const draftTasks = tasks.map(task => {
            if (childCountByTaskId.has(task.id)) return task;
            const draft = weeklyDrafts[task.id];
            if (!draft) return task;
            return {
                ...task,
                progress: parseWeeklyProgressPercent(draft.progressPercent),
                progressMode: 'weekly_report' as ProjectTaskProgressMode,
            };
        });
        return calculateWeeklyConstructionProgress(
            deriveProjectTaskProgress(draftTasks, dailyLogs),
            taskContractLinkRows,
            contractItems,
        );
    }, [childCountByTaskId, contractItems, dailyLogs, taskContractLinkRows, tasks, weeklyConstructionProgress, weeklyDrafts, weeklyLeafTasks.length]);

    const draftDailyConstructionProgress = useMemo(() => {
        if (weeklyLeafTasks.length === 0) return weeklyConstructionProgress;
        const draftTasks = tasks.map(task => {
            if (childCountByTaskId.has(task.id)) return task;
            const draft = dailyDrafts[task.id];
            if (!draft) return task;
            return {
                ...task,
                progress: parseWeeklyProgressPercent(draft.progressPercent),
                progressMode: 'weekly_report' as ProjectTaskProgressMode,
            };
        });
        return calculateWeeklyConstructionProgress(
            deriveProjectTaskProgress(draftTasks, dailyLogs),
            taskContractLinkRows,
            contractItems,
        );
    }, [childCountByTaskId, contractItems, dailyDrafts, dailyLogs, taskContractLinkRows, tasks, weeklyConstructionProgress, weeklyLeafTasks.length]);

    const draftConstructionProgress = entryMode === 'daily' ? draftDailyConstructionProgress : draftWeeklyConstructionProgress;

    const selectedPeriodState = entryMode === 'daily' ? dailyPeriodState : weeklyPeriodState;
    const selectedCurrentPeriodKey = entryMode === 'daily' ? dailyCurrentPeriodKey : weeklyCurrentPeriodKey;
    const selectedPeriodStateKey = entryMode === 'daily' ? dailyPeriodStateKey : weeklyPeriodStateKey;
    const selectedDraftKey = entryMode === 'daily' ? dailyDraftKey : weeklyDraftKey;
    const selectedPeriodStateLoaded = Boolean(selectedPeriodState)
        && selectedPeriodStateKey === selectedCurrentPeriodKey;
    const selectedPeriodLocked = selectedPeriodState?.isLocked === true;
    const baseDataReadyForCurrentScope = baseDataLoadState === 'ready'
        && baseDataLoadKey === scopeKey;
    const selectedMutationReadiness = getWeeklyProgressMutationReadiness({
        actionsLoaded: actionLoadState === 'loaded',
        baseDataReady: baseDataReadyForCurrentScope,
        canView: weeklyProgressCapabilities.canView,
        canEdit: weeklyProgressCapabilities.canEdit,
        canConfirm: weeklyProgressCapabilities.canConfirm,
        currentKey: selectedCurrentPeriodKey,
        stateKey: selectedPeriodStateKey,
        draftKey: selectedDraftKey,
        isLocked: selectedPeriodLocked,
    });
    const dailyModeAuthoritative = entryMode === 'daily' && dailyProgressAuthority?.authoritative === true;
    const canEditSelectedPeriod = selectedMutationReadiness.canSave && !dailyModeAuthoritative;
    const canConfirmSelectedPeriod = !dailyModeAuthoritative
        && (selectedMutationReadiness.canClose || selectedMutationReadiness.canReopen);

    const getSelectedDailySourceRow = useCallback((taskId: string) => allDailyProgress
        .filter(row => row.scopeKey === scopeKey && row.taskId === taskId && row.progressDate === selectedProgressDate)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] || null,
    [allDailyProgress, scopeKey, selectedProgressDate]);

    const buildDailyLogHref = useCallback((dailyLogId?: string | null) => {
        if (!dailyLogId) return null;
        const query = new URLSearchParams(location.search);
        query.set('tab', 'dailylog');
        query.set('dailyLogId', dailyLogId);
        if (projectId) query.set('projectId', projectId);
        if (constructionSiteId) query.set('siteId', constructionSiteId);
        return `/da?${query.toString()}`;
    }, [constructionSiteId, location.search, projectId]);

    const openDailyProgressException = useCallback((row: ProjectDailyTaskProgress) => {
        setExceptionRow(row);
        setExceptionProgress(formatNumberInput(row.progressPercent, 2));
        setExceptionQuantity(row.quantityDone == null ? '' : formatNumberInput(row.quantityDone, 2));
        setExceptionDailyQuantity(row.dailyQuantityDone == null ? '' : formatNumberInput(row.dailyQuantityDone, 2));
        setExceptionNote(row.note || '');
        setExceptionReason('');
    }, []);

    const ensureWeeklyProgressAction = useCallback((action: 'edit' | 'confirm'): boolean => {
        if (actionLoadState !== 'loaded') {
            toast.info('Đang tải quyền', 'Vui lòng thử lại sau khi quyền thao tác được tải xong.');
            return false;
        }
        if (!baseDataReadyForCurrentScope || !selectedPeriodStateLoaded || selectedDraftKey !== selectedCurrentPeriodKey || !selectedPeriodState) {
            toast.info('Đang tải dữ liệu kỳ', 'Vui lòng thử lại sau khi trạng thái và dữ liệu kỳ được tải xong.');
            return false;
        }
        const allowed = action === 'edit'
            ? weeklyProgressCapabilities.canEdit
            : weeklyProgressCapabilities.canConfirm;
        if (!allowed) {
            toast.error(
                'Không có quyền',
                action === 'edit'
                    ? 'Bạn không có quyền Sửa/Nhập liệu tiến độ.'
                    : 'Bạn không có quyền Chốt/Mở chốt kỳ tiến độ.',
            );
            return false;
        }
        return true;
    }, [
        actionLoadState,
        baseDataReadyForCurrentScope,
        selectedPeriodState,
        selectedPeriodStateLoaded,
        selectedCurrentPeriodKey,
        selectedDraftKey,
        toast,
        weeklyProgressCapabilities.canConfirm,
        weeklyProgressCapabilities.canEdit,
    ]);

    const updateWeeklyDraft = useCallback((taskId: string, patch: Partial<{ progressPercent: string; quantityDone: string; note: string }>) => {
        setWeeklyDrafts(prev => ({
            ...prev,
            [taskId]: {
                ...(prev[taskId] || { progressPercent: '0', quantityDone: '0', note: '' }),
                ...patch,
            },
        }));
    }, []);

    const updateDailyDraft = useCallback((taskId: string, patch: Partial<ProgressDraft>) => {
        setDailyDrafts(prev => ({
            ...prev,
            [taskId]: {
                ...(prev[taskId] || { progressPercent: '0', quantityDone: '0', note: '' }),
                ...patch,
            },
        }));
    }, []);

    const confirmWeeklyOverrun = useCallback(async (task: ProjectTask, progressPercent: number) => {
        if (progressPercent <= 100) return true;
        const key = `${task.id}_${selectedWeekStart}`;
        if (confirmedWeeklyOverrunKeys.has(key)) return true;
        const ok = await confirm({
            title: 'Tiến độ vượt quá 100%',
            targetName: task.name,
            confirmText: `Hạng mục này có tiến độ ${progressPercent}%. Bạn có chắc chắn muốn chốt tiến độ lớn hơn 100% cho`,
            warningText: 'Tiến độ lớn hơn 100% có thể làm sai lệch báo cáo nếu chưa được kiểm tra.',
            actionLabel: 'Đồng ý',
            cancelLabel: 'Huỷ',
            intent: 'warning',
            countdownSeconds: 0,
        });
        if (ok) {
            setConfirmedWeeklyOverrunKeys(prev => {
                const next = new Set(prev);
                next.add(key);
                return next;
            });
        }
        return ok;
    }, [confirm, confirmedWeeklyOverrunKeys, selectedWeekStart]);

    const updateWeeklyProgressPercent = useCallback(async (task: ProjectTask, progressPercentText: string) => {
        if (progressPercentText === '') {
            updateWeeklyDraft(task.id, { progressPercent: '', quantityDone: '' });
            return;
        }
        const progressPercent = parseWeeklyProgressPercent(progressPercentText);
        const ok = await confirmWeeklyOverrun(task, progressPercent);
        if (!ok) return;
        updateWeeklyDraft(task.id, {
            progressPercent: formatNumberInput(progressPercent, 2),
            quantityDone: Number(task.provisionalQuantity || 0) > 0
                ? formatNumberInput((Number(task.provisionalQuantity) * progressPercent) / 100, 2)
                : weeklyDrafts[task.id]?.quantityDone ?? '0',
        });
    }, [confirmWeeklyOverrun, updateWeeklyDraft, weeklyDrafts]);

    const updateWeeklyQuantityDone = useCallback(async (task: ProjectTask, quantityDone: string) => {
        const patch: Partial<{ progressPercent: string; quantityDone: string; note: string }> = { quantityDone };
        if (quantityDone !== '') {
            const plannedQuantity = Number(task.provisionalQuantity || 0);
            const progressPercent = plannedQuantity > 0
                ? parseWeeklyProgressPercent((parseNonNegativeNumber(quantityDone) / plannedQuantity) * 100)
                : 100;
            const ok = await confirmWeeklyOverrun(task, progressPercent);
            if (!ok) return;
            patch.progressPercent = formatNumberInput(progressPercent, 2);
        }
        updateWeeklyDraft(task.id, patch);
    }, [confirmWeeklyOverrun, updateWeeklyDraft]);

    const updateDailyProgressPercent = useCallback(async (task: ProjectTask, progressPercentText: string) => {
        if (progressPercentText === '') {
            updateDailyDraft(task.id, { progressPercent: '', quantityDone: '' });
            return;
        }
        const progressPercent = parseWeeklyProgressPercent(progressPercentText);
        const ok = await confirmWeeklyOverrun(task, progressPercent);
        if (!ok) return;
        updateDailyDraft(task.id, {
            progressPercent: formatNumberInput(progressPercent, 2),
            quantityDone: Number(task.provisionalQuantity || 0) > 0
                ? formatNumberInput((Number(task.provisionalQuantity) * progressPercent) / 100, 2)
                : dailyDrafts[task.id]?.quantityDone ?? '0',
        });
    }, [confirmWeeklyOverrun, dailyDrafts, updateDailyDraft]);

    const updateDailyQuantityDone = useCallback(async (task: ProjectTask, quantityDone: string) => {
        const patch: Partial<ProgressDraft> = { quantityDone };
        if (quantityDone !== '') {
            const plannedQuantity = Number(task.provisionalQuantity || 0);
            const progressPercent = plannedQuantity > 0
                ? parseWeeklyProgressPercent((parseNonNegativeNumber(quantityDone) / plannedQuantity) * 100)
                : 100;
            const ok = await confirmWeeklyOverrun(task, progressPercent);
            if (!ok) return;
            patch.progressPercent = formatNumberInput(progressPercent, 2);
        }
        updateDailyDraft(task.id, patch);
    }, [confirmWeeklyOverrun, updateDailyDraft]);

    const deriveTasksFromProgressRows = useCallback((
        progressRows: Array<{ taskId: string; progressPercent: number }>,
        effectiveDate: string,
    ): ProjectTask[] => {
        const progressByTask = new Map(progressRows.map(row => [row.taskId, row.progressPercent]));
        const rawNextTasks = tasks.map(task => {
            const progress = progressByTask.get(task.id);
            if (progress === undefined) return task;
            return {
                ...task,
                progress,
                progressMode: 'weekly_report' as ProjectTaskProgressMode,
                actualStartDate: progress > 0 ? (task.actualStartDate || effectiveDate) : task.actualStartDate,
                actualEndDate: progress >= 100 ? (task.actualEndDate || effectiveDate) : task.actualEndDate,
            };
        });
        return deriveProjectTaskProgress(rawNextTasks, dailyLogs, effectiveDate);
    }, [dailyLogs, tasks]);

    const buildSnapshot = useCallback((
        constructionProgress: number,
        progressMode: 'daily_report' | 'weekly_report',
        calculatedAt: string,
    ): ProjectProgressSnapshotPayload => ({
        constructionProgressPercent: constructionProgress,
        valueProgressPercent: valueProgressMetric.valueProgressPercent,
        progressMode,
        suppliedValue: valueProgressMetric.recognizedValue || null,
        contractTotalValue: valueProgressMetric.contractTotalValue || null,
        purchasedValue: valueProgressMetric.purchasedValue,
        issuedValue: valueProgressMetric.issuedValue,
        recognizedValue: valueProgressMetric.recognizedValue,
        ganttPercent: constructionProgress,
        calculatedAt,
    }), [valueProgressMetric]);

    const buildDailyMutationDraft = useCallback(() => {
        const weekStart = getWeekStart(selectedProgressDate);
        const nowIso = new Date().toISOString();
        const dailyRows: ProjectDailyTaskProgress[] = weeklyLeafTasks.map(task => {
            const currentProgress = parseWeeklyProgressPercent(task.progress);
            const defaultQuantityDone = Number(task.provisionalQuantity || 0) > 0
                ? (Number(task.provisionalQuantity) * currentProgress) / 100
                : 0;
            const draft = dailyDrafts[task.id]
                || { progressPercent: String(currentProgress), quantityDone: String(defaultQuantityDone), note: '' };
            const progressPercent = parseWeeklyProgressPercent(draft.progressPercent);
            const quantityDone = draft.quantityDone === ''
                ? (Number(task.provisionalQuantity || 0) > 0
                    ? (Number(task.provisionalQuantity) * progressPercent) / 100
                    : 0)
                : parseNonNegativeNumber(draft.quantityDone);
            const previousDailyProgress = getLatestDailyProgressForTask(task.id, selectedProgressDate, false);
            const latestDailyProgress = getLatestDailyProgressForTask(task.id, selectedProgressDate);
            const exactDailyProgress = latestDailyProgress?.progressDate === selectedProgressDate
                ? latestDailyProgress
                : undefined;
            const previousQuantityDone = previousDailyProgress
                ? Number(previousDailyProgress.quantityDone || 0)
                : exactDailyProgress
                    ? Number(exactDailyProgress.quantityDone || 0) - Number(exactDailyProgress.dailyQuantityDone || 0)
                    : defaultQuantityDone;

            return {
                scopeKey,
                projectId: projectId || null,
                constructionSiteId: constructionSiteId || null,
                taskId: task.id,
                progressDate: selectedProgressDate,
                weekStart,
                progressPercent,
                quantityDone,
                dailyQuantityDone: quantityDone - previousQuantityDone,
                note: draft.note?.trim() || null,
                attachments: [],
                updatedBy: user?.id || null,
                updatedAt: nowIso,
            };
        });
        const nextDailyRows = mergeDailyProgressRows(selectedDailyMutationRows, dailyRows);
        const weeklyRows = rollupDailyRowsToWeeklyRows({
            tasks,
            dailyRows: nextDailyRows,
            existingWeeklyRows: selectedWeeklyMutationRows,
            scopeKey,
            projectId: projectId || null,
            constructionSiteId: constructionSiteId || null,
            weekStart,
            updatedBy: user?.id || null,
            updatedAt: nowIso,
        });
        const anticipatedProgressRows = weeklyRows.length > 0 ? weeklyRows : dailyRows;
        const nextTasks = deriveTasksFromProgressRows(anticipatedProgressRows, selectedProgressDate);
        const constructionProgress = calculateWeeklyConstructionProgress(nextTasks, taskContractLinkRows, contractItems);
        return {
            weekStart,
            dailyRows,
            nextDailyRows,
            weeklyRows,
            nextTasks,
            constructionProgress,
            snapshot: buildSnapshot(constructionProgress, 'daily_report', nowIso),
        };
    }, [
        buildSnapshot,
        constructionSiteId,
        contractItems,
        dailyDrafts,
        deriveTasksFromProgressRows,
        getLatestDailyProgressForTask,
        projectId,
        scopeKey,
        selectedDailyMutationRows,
        selectedProgressDate,
        selectedWeeklyMutationRows,
        taskContractLinkRows,
        tasks,
        user?.id,
        weeklyLeafTasks,
    ]);

    const buildWeeklyMutationDraft = useCallback(() => {
        const nowIso = new Date().toISOString();
        const weeklyRows: ProjectWeeklyTaskProgress[] = weeklyLeafTasks.map(task => {
            const currentProgress = parseWeeklyProgressPercent(task.progress);
            const defaultQuantityDone = Number(task.provisionalQuantity || 0) > 0
                ? (Number(task.provisionalQuantity) * currentProgress) / 100
                : 0;
            const draft = weeklyDrafts[task.id]
                || { progressPercent: String(currentProgress), quantityDone: String(defaultQuantityDone), note: '' };
            const progressPercent = parseWeeklyProgressPercent(draft.progressPercent);
            return {
                scopeKey,
                projectId: projectId || null,
                constructionSiteId: constructionSiteId || null,
                taskId: task.id,
                weekStart: selectedWeekStart,
                progressPercent,
                quantityDone: draft.quantityDone === ''
                    ? (Number(task.provisionalQuantity || 0) > 0
                        ? (Number(task.provisionalQuantity) * progressPercent) / 100
                        : 0)
                    : parseNonNegativeNumber(draft.quantityDone),
                note: draft.note?.trim() || null,
                attachments: [],
                updatedBy: user?.id || null,
                updatedAt: nowIso,
            };
        });
        const nextTasks = deriveTasksFromProgressRows(weeklyRows, selectedWeekStart);
        const constructionProgress = calculateWeeklyConstructionProgress(nextTasks, taskContractLinkRows, contractItems);
        return {
            weeklyRows,
            nextTasks,
            constructionProgress,
            snapshot: buildSnapshot(constructionProgress, 'weekly_report', nowIso),
        };
    }, [
        buildSnapshot,
        constructionSiteId,
        contractItems,
        deriveTasksFromProgressRows,
        projectId,
        scopeKey,
        selectedWeekStart,
        taskContractLinkRows,
        user?.id,
        weeklyDrafts,
        weeklyLeafTasks,
    ]);

    const handleSaveDailyProgress = useCallback(async () => {
        if (dailyModeAuthoritative) {
            toast.info('Tiến độ do nhật ký tổng hợp quản lý', 'Ngày sau cutover chỉ đọc tại màn hình này. Dùng điều chỉnh ngoại lệ khi thật sự cần.');
            return;
        }
        if (!ensureWeeklyProgressAction('edit')) return;
        if (!selectedMutationReadiness.canSave) return;
        if (selectedPeriodLocked) {
            toast.error('Kỳ đã chốt', 'Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.');
            return;
        }
        if (!projectId || !scopeKey || weeklyLeafTasks.length === 0) {
            toast.warning('Chưa có hạng mục', 'Cần có hạng mục WBS lá trước khi lưu tiến độ ngày.');
            return;
        }

        const draft = buildDailyMutationDraft();
        const sourceTaskIds = new Set(selectedDailyMutationRows
            .filter(row => row.progressDate === selectedProgressDate && row.sourceDailyLogId)
            .map(row => row.taskId));
        const mutableRows = draft.dailyRows.filter(row => !sourceTaskIds.has(row.taskId));
        if (mutableRows.length === 0) return;
        const capturedTarget = currentPeriodTargetRef.current;
        setSavingDailyProgress(true);
        try {
            const outcome = await completeWeeklyProgressMutationWithReload<SaveProjectProgressPeriodResult>({
                capturedTarget,
                getCurrentTarget: () => currentPeriodTargetRef.current,
                reload: reloadAuthoritativePeriodResources,
                mutate: () => projectWeeklyProgressService.savePeriod({
                    projectId,
                    constructionSiteId: constructionSiteId || null,
                    periodType: 'daily',
                    periodStart: capturedTarget.periodStart,
                    rows: mutableRows,
                    snapshot: draft.snapshot,
                }),
            });
            if (!outcome.remainedOnCapturedTarget) return;
            if (outcome.ok === false) {
                console.error(outcome.error);
                toast.error(
                    'Không thể lưu tiến độ ngày',
                    getProjectProgressMutationErrorMessage(outcome.error, 'Vui lòng thử lại.'),
                );
                return;
            }
            setFilterWeek(draft.weekStart);
            setFilterMonth(draft.weekStart.substring(0, 7));

            toast.success(
                'Đã lưu thay đổi',
                outcome.result.weeklyAggregateFrozen
                    ? `${capturedTarget.periodStart} · Tuần đã chốt nên tổng hợp tuần được giữ nguyên.`
                    : `${capturedTarget.periodStart} · ${getISOWeekLabel(draft.weekStart)} · Tiến độ thi công ${draft.constructionProgress}%`,
            );
        } catch (error: any) {
            if (currentPeriodTargetRef.current.key !== capturedTarget.key) return;
            console.error(error);
            toast.error(
                'Không thể lưu tiến độ ngày',
                getProjectProgressMutationErrorMessage(error, 'Vui lòng thử lại.'),
            );
        } finally {
            setSavingDailyProgress(false);
        }
    }, [
        buildDailyMutationDraft,
        constructionSiteId,
        dailyModeAuthoritative,
        ensureWeeklyProgressAction,
        projectId,
        reloadAuthoritativePeriodResources,
        scopeKey,
        selectedPeriodLocked,
        selectedMutationReadiness.canSave,
        selectedDailyMutationRows,
        selectedProgressDate,
        toast,
        weeklyLeafTasks.length,
    ]);

    const handleSaveDailyProgressException = useCallback(async () => {
        if (!exceptionRow?.id || !exceptionRow.updatedAt || !exceptionReason.trim()) return;
        setSavingException(true);
        try {
            await projectWeeklyProgressService.saveDailyProgressException({
                progressRowId: exceptionRow.id,
                expectedUpdatedAt: exceptionRow.updatedAt,
                progressPercent: parseWeeklyProgressPercent(exceptionProgress),
                quantityDone: exceptionQuantity.trim() === '' ? null : parseNonNegativeNumber(exceptionQuantity),
                dailyQuantityDone: exceptionDailyQuantity.trim() === '' ? null : parseNonNegativeNumber(exceptionDailyQuantity),
                note: exceptionNote,
                reason: exceptionReason,
            });
            setExceptionRow(null);
            await reloadAuthoritativePeriodResources();
            toast.success('Đã lưu điều chỉnh ngoại lệ', 'Lý do và số liệu trước/sau đã được ghi vào nhật ký kiểm toán.');
        } catch (error) {
            toast.error('Không thể điều chỉnh ngoại lệ', getProjectProgressMutationErrorMessage(error, error instanceof Error ? error.message : 'Vui lòng thử lại.'));
        } finally {
            setSavingException(false);
        }
    }, [exceptionDailyQuantity, exceptionNote, exceptionProgress, exceptionQuantity, exceptionReason, exceptionRow, reloadAuthoritativePeriodResources, toast]);

    const handleSaveWeeklyProgress = useCallback(async () => {
        if (!ensureWeeklyProgressAction('edit')) return;
        if (!selectedMutationReadiness.canSave) return;
        if (selectedPeriodLocked) {
            toast.error('Kỳ đã chốt', 'Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.');
            return;
        }
        if (!projectId || !scopeKey || weeklyLeafTasks.length === 0) {
            toast.warning('Chưa có hạng mục', 'Cần có hạng mục WBS lá trước khi lưu tiến độ tuần.');
            return;
        }

        const draft = buildWeeklyMutationDraft();
        const capturedTarget = currentPeriodTargetRef.current;
        setSavingWeeklyProgress(true);
        try {
            const outcome = await completeWeeklyProgressMutationWithReload({
                capturedTarget,
                getCurrentTarget: () => currentPeriodTargetRef.current,
                reload: reloadAuthoritativePeriodResources,
                mutate: () => projectWeeklyProgressService.savePeriod({
                    projectId,
                    constructionSiteId: constructionSiteId || null,
                    periodType: 'weekly',
                    periodStart: capturedTarget.periodStart,
                    rows: draft.weeklyRows,
                    snapshot: draft.snapshot,
                }),
            });
            if (!outcome.remainedOnCapturedTarget) return;
            if (outcome.ok === false) {
                console.error(outcome.error);
                toast.error(
                    'Không thể lưu tiến độ tuần',
                    getProjectProgressMutationErrorMessage(outcome.error, 'Vui lòng thử lại.'),
                );
                return;
            }
            setFilterWeek(capturedTarget.periodStart);
            setFilterMonth(capturedTarget.periodStart.substring(0, 7));

            toast.success(
                'Đã lưu thay đổi',
                `${getISOWeekLabel(capturedTarget.periodStart)} · Tiến độ thi công ${draft.constructionProgress}% · Theo giá trị ${valueProgressMetric.valueProgressPercent}%`,
            );
        } catch (error: any) {
            if (currentPeriodTargetRef.current.key !== capturedTarget.key) return;
            console.error(error);
            toast.error(
                'Không thể lưu tiến độ tuần',
                getProjectProgressMutationErrorMessage(error, 'Vui lòng thử lại.'),
            );
        } finally {
            setSavingWeeklyProgress(false);
        }
    }, [
        buildWeeklyMutationDraft,
        constructionSiteId,
        ensureWeeklyProgressAction,
        projectId,
        reloadAuthoritativePeriodResources,
        scopeKey,
        selectedPeriodLocked,
        selectedMutationReadiness.canSave,
        toast,
        valueProgressMetric.valueProgressPercent,
        weeklyLeafTasks.length,
    ]);

    const handleCloseProgressPeriod = useCallback(async () => {
        if (!ensureWeeklyProgressAction('confirm')) return;
        if (!selectedMutationReadiness.canClose) return;
        if (!projectId || !selectedPeriodState || selectedPeriodLocked) return;
        const ok = await confirm({
            title: 'Chốt kỳ tiến độ',
            targetName: entryMode === 'daily'
                ? new Date(`${selectedProgressDate}T00:00:00`).toLocaleDateString('vi-VN')
                : getISOWeekLabel(selectedWeekStart),
            confirmText: 'Sau khi chốt, dữ liệu kỳ này chỉ có thể sửa khi được mở chốt.',
            warningText: weeklyProgressCapabilities.canEdit
                ? 'Các thay đổi đang hiển thị sẽ được lưu và chốt trong cùng một giao dịch.'
                : 'Kỳ sẽ được chốt với dữ liệu đã lưu hiện tại.',
            actionLabel: 'Chốt',
            cancelLabel: 'Huỷ',
            intent: 'warning',
            countdownSeconds: 0,
        });
        if (!ok) return;

        const capturedTarget = currentPeriodTargetRef.current;
        const setSaving = entryMode === 'daily' ? setSavingDailyProgress : setSavingWeeklyProgress;
        setSaving(true);
        try {
            let outcome: WeeklyProgressMutationOutcome<ProjectProgressPeriodState>;
            if (entryMode === 'daily') {
                const draft = weeklyProgressCapabilities.canEdit && weeklyLeafTasks.length > 0
                    ? buildDailyMutationDraft()
                    : null;
                outcome = await completeWeeklyProgressMutationWithReload({
                    capturedTarget,
                    getCurrentTarget: () => currentPeriodTargetRef.current,
                    reload: reloadAuthoritativePeriodResources,
                    mutate: () => projectWeeklyProgressService.closePeriod({
                        projectId,
                        constructionSiteId: constructionSiteId || null,
                        periodType: 'daily',
                        periodStart: capturedTarget.periodStart,
                        rows: draft?.dailyRows || null,
                        snapshot: draft?.snapshot || null,
                    }),
                });
            } else {
                const draft = weeklyProgressCapabilities.canEdit && weeklyLeafTasks.length > 0
                    ? buildWeeklyMutationDraft()
                    : null;
                outcome = await completeWeeklyProgressMutationWithReload({
                    capturedTarget,
                    getCurrentTarget: () => currentPeriodTargetRef.current,
                    reload: reloadAuthoritativePeriodResources,
                    mutate: () => projectWeeklyProgressService.closePeriod({
                        projectId,
                        constructionSiteId: constructionSiteId || null,
                        periodType: 'weekly',
                        periodStart: capturedTarget.periodStart,
                        rows: draft?.weeklyRows || null,
                        snapshot: draft?.snapshot || null,
                    }),
                });
            }
            if (!outcome.remainedOnCapturedTarget) return;
            if (outcome.ok === false) {
                console.error(outcome.error);
                toast.error(
                    'Không thể chốt kỳ tiến độ',
                    getProjectProgressMutationErrorMessage(outcome.error, 'Vui lòng thử lại.'),
                );
                return;
            }
            toast.success('Đã chốt kỳ tiến độ', 'Dữ liệu kỳ đã chuyển sang chế độ chỉ đọc.');
        } catch (error: any) {
            if (currentPeriodTargetRef.current.key !== capturedTarget.key) return;
            console.error(error);
            toast.error(
                'Không thể chốt kỳ tiến độ',
                getProjectProgressMutationErrorMessage(error, 'Vui lòng thử lại.'),
            );
        } finally {
            setSaving(false);
        }
    }, [
        buildDailyMutationDraft,
        buildWeeklyMutationDraft,
        confirm,
        constructionSiteId,
        ensureWeeklyProgressAction,
        entryMode,
        projectId,
        reloadAuthoritativePeriodResources,
        selectedPeriodLocked,
        selectedMutationReadiness.canClose,
        selectedPeriodState,
        selectedProgressDate,
        selectedWeekStart,
        toast,
        weeklyLeafTasks.length,
        weeklyProgressCapabilities.canEdit,
    ]);

    const handleReopenProgressPeriod = useCallback(async () => {
        if (!ensureWeeklyProgressAction('confirm')) return;
        if (!selectedMutationReadiness.canReopen) return;
        if (!projectId || !selectedPeriodState || !selectedPeriodLocked) return;
        const reason = await reasonConfirm({
            title: 'Mở chốt kỳ tiến độ',
            targetName: entryMode === 'daily'
                ? new Date(`${selectedProgressDate}T00:00:00`).toLocaleDateString('vi-VN')
                : getISOWeekLabel(selectedWeekStart),
            warningText: 'Lý do mở chốt sẽ được lưu trong nhật ký kiểm soát.',
            reasonLabel: 'Lý do mở chốt',
            reasonPlaceholder: 'Nhập lý do mở chốt...',
            actionLabel: 'Mở chốt',
            cancelLabel: 'Huỷ',
            intent: 'warning',
            countdownSeconds: 0,
        });
        if (!reason) return;

        const capturedTarget = currentPeriodTargetRef.current;
        const setSaving = entryMode === 'daily' ? setSavingDailyProgress : setSavingWeeklyProgress;
        setSaving(true);
        try {
            const outcome = await completeWeeklyProgressMutationWithReload({
                capturedTarget,
                getCurrentTarget: () => currentPeriodTargetRef.current,
                reload: reloadAuthoritativePeriodResources,
                mutate: () => projectWeeklyProgressService.reopenPeriod({
                    projectId,
                    constructionSiteId: constructionSiteId || null,
                    periodType: capturedTarget.periodType,
                    periodStart: capturedTarget.periodStart,
                    reason,
                }),
            });
            if (!outcome.remainedOnCapturedTarget) return;
            if (outcome.ok === false) {
                console.error(outcome.error);
                toast.error(
                    'Không thể mở chốt',
                    getProjectProgressMutationErrorMessage(outcome.error, 'Vui lòng thử lại.'),
                );
                return;
            }
            toast.success('Đã mở chốt', 'Kỳ tiến độ đã được mở lại. Quyền sửa vẫn áp dụng độc lập.');
        } catch (error: any) {
            if (currentPeriodTargetRef.current.key !== capturedTarget.key) return;
            console.error(error);
            toast.error(
                'Không thể mở chốt',
                getProjectProgressMutationErrorMessage(error, 'Vui lòng thử lại.'),
            );
        } finally {
            setSaving(false);
        }
    }, [
        constructionSiteId,
        ensureWeeklyProgressAction,
        entryMode,
        projectId,
        reasonConfirm,
        reloadAuthoritativePeriodResources,
        selectedPeriodLocked,
        selectedMutationReadiness.canReopen,
        selectedPeriodState,
        selectedProgressDate,
        selectedWeekStart,
        toast,
    ]);

    // Flatten tree construction based on collapse and filter states
    const dropdownTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            const wbsA = a.wbsCode || '';
            const wbsB = b.wbsCode || '';
            return wbsA.localeCompare(wbsB, undefined, { numeric: true });
        });
    }, [tasks]);

    const filteredDropdownTasks = useMemo(() => {
        if (!dropdownSearch) return dropdownTasks;
        const query = dropdownSearch.toLowerCase();
        return dropdownTasks.filter(t =>
            t.name.toLowerCase().includes(query) ||
            (t.wbsCode && t.wbsCode.toLowerCase().includes(query))
        );
    }, [dropdownTasks, dropdownSearch]);

    const activeFilterTask = useMemo(() => {
        return tasks.find(t => t.id === selectedFilterTaskId);
    }, [tasks, selectedFilterTaskId]);

    const wbsTreeRows = useMemo(() => {
        if (tasks.length === 0) return [];
        const taskMap = new Map(tasks.map(t => [t.id, t]));

        let rootIds: string[] = [];
        if (selectedFilterTaskId) {
            if (taskMap.has(selectedFilterTaskId)) {
                rootIds = [selectedFilterTaskId];
            }
        } else {
            rootIds = tasks
                .filter(t => !t.parentId || !taskMap.has(t.parentId))
                .map(t => t.id);
        }

        const buildTree = (
            ids: string[],
            depth: number,
            collapsedSet: Set<string>
        ): Array<ProjectTask & { depth: number; hasChildren: boolean }> => {
            const list: Array<ProjectTask & { depth: number; hasChildren: boolean }> = [];
            ids.sort((a, b) => {
                const ta = taskMap.get(a);
                const tb = taskMap.get(b);
                return (ta?.order || 0) - (tb?.order || 0);
            }).forEach(id => {
                const task = taskMap.get(id);
                if (!task) return;
                const children = childrenByTaskId.get(id) || [];
                const hasChildren = children.length > 0;
                list.push({ ...task, depth, hasChildren });
                if (hasChildren && !collapsedSet.has(id)) {
                    const childIds = children.map(c => c.id);
                    list.push(...buildTree(childIds, depth + 1, collapsedSet));
                }
            });
            return list;
        };

        return buildTree(rootIds, 0, weeklyCollapsedParents);
    }, [tasks, selectedFilterTaskId, childrenByTaskId, weeklyCollapsedParents]);

    // Segmented progress bar renderer component inside the file
    const WeeklySegmentedProgressBar = ({ taskId }: { taskId: string }) => {
        const baselineProgress = Number(weeklyBaselineRollup[taskId]?.progress || 0);
        const segments = useMemo(() => {
            return buildProgressSegments(visibleWeeks.map(week => {
                const weekData = weeklyHistoryRollup[week]?.[taskId];
                const staffName = weekData?.updatedBy ? (staffMap.get(weekData.updatedBy) || weekData.updatedBy) : '';
                return {
                    key: week,
                    label: getISOWeekLabel(week),
                    progress: Number(weekData?.progress ?? baselineProgress),
                    color: weekColors[week] || '#94a3b8',
                    note: weekData?.note || undefined,
                    updatedBy: staffName || undefined,
                    updatedAt: weekData?.updatedAt,
                };
            }), baselineProgress);
        }, [baselineProgress, staffMap, taskId, visibleWeeks, weekColors, weeklyHistoryRollup]);

        const totalProgress = useMemo(() => {
            if (segments.length === 0) return baselineProgress;
            return segments[segments.length - 1].cumulativeProgress;
        }, [baselineProgress, segments]);

        return (
            <div className="relative w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible flex items-center">
                {segments.map((seg, idx) => (
                    <div
                        key={seg.key}
                        className="group relative h-full cursor-pointer transition-opacity hover:opacity-85 first:rounded-l-full last:rounded-r-full"
                        style={{
                            width: `${seg.percent}%`,
                            backgroundColor: seg.color,
                            // If it's the only one or last one matching total progress, ensure rounded edges behave correctly
                            borderTopLeftRadius: idx === 0 ? '9999px' : '0px',
                            borderBottomLeftRadius: idx === 0 ? '9999px' : '0px',
                            borderTopRightRadius: idx === segments.length - 1 && totalProgress >= 100 ? '9999px' : '0px',
                            borderBottomRightRadius: idx === segments.length - 1 && totalProgress >= 100 ? '9999px' : '0px',
                        }}
                    >
                        {/* CSS Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col bg-slate-900 dark:bg-slate-950 text-white text-[11px] rounded-xl p-3 shadow-xl z-50 pointer-events-none min-w-[200px] leading-relaxed border border-slate-700/50">
                            <div className="font-black text-amber-400 flex items-center gap-1">
                                <Calendar size={11} /> {seg.label}
                            </div>
                            <div className="border-b border-slate-700 my-1"></div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Tích lũy đến tuần:</span>
                                <span className="font-bold">{seg.cumulativeProgress}%</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Thực hiện trong tuần:</span>
                                <span className="font-black text-emerald-400">+{seg.addedProgress}%</span>
                            </div>
                            {seg.updatedAt && (
                                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                                    <span>Ngày chốt:</span>
                                    <span>{new Date(seg.updatedAt).toLocaleDateString('vi-VN')}</span>
                                </div>
                            )}
                            {seg.updatedBy && (
                                <div className="flex justify-between text-[10px] text-slate-400">
                                    <span>Người chốt:</span>
                                    <span className="font-medium truncate max-w-[100px]">{seg.updatedBy}</span>
                                </div>
                            )}
                            {seg.note && (
                                <div className="text-[10px] text-amber-200 mt-1 italic border-t border-slate-800 pt-1 leading-normal max-w-[180px] break-words">
                                    Ghi chú: {seg.note}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Total label showing cumulative percentage */}
                {totalProgress > 0 && (
                    <span
                        className="absolute left-2 text-[9px] font-black text-white pointer-events-none"
                        style={{ textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)' }}
                    >
                        {totalProgress}%
                    </span>
                )}
            </div>
        );
    };

    const DailySegmentedProgressBar = ({ taskId }: { taskId: string }) => {
        const baselineProgress = Number(dailyBaselineRollup[taskId]?.progress || 0);

        const segments = useMemo(() => {
            return buildProgressSegments(selectedWeekDays.map(day => {
                const dayData = dailyHistoryRollup[day]?.[taskId];
                const staffName = dayData?.updatedBy ? (staffMap.get(dayData.updatedBy) || dayData.updatedBy) : '';
                return {
                    key: day,
                    label: new Date(`${day}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                    progress: Number(dayData?.progress || baselineProgress),
                    color: dayColors[day] || '#94a3b8',
                    note: dayData?.note || undefined,
                    updatedBy: staffName || undefined,
                    updatedAt: dayData?.updatedAt,
                };
            }), baselineProgress);
        }, [baselineProgress, dailyHistoryRollup, dayColors, selectedWeekDays, staffMap, taskId]);

        const totalProgress = useMemo(() => {
            if (segments.length === 0) return baselineProgress;
            return segments[segments.length - 1].cumulativeProgress;
        }, [baselineProgress, segments]);

        return (
            <div className="relative w-full h-3 bg-slate-50 dark:bg-slate-900 rounded-full overflow-visible flex items-center">
                {segments.map((seg, idx) => (
                    <div
                        key={seg.key}
                        className="group relative h-full cursor-pointer transition-opacity hover:opacity-85"
                        style={{
                            width: `${seg.percent}%`,
                            backgroundColor: seg.color,
                            borderTopLeftRadius: idx === 0 ? '9999px' : '0px',
                            borderBottomLeftRadius: idx === 0 ? '9999px' : '0px',
                            borderTopRightRadius: idx === segments.length - 1 && totalProgress >= 100 ? '9999px' : '0px',
                            borderBottomRightRadius: idx === segments.length - 1 && totalProgress >= 100 ? '9999px' : '0px',
                        }}
                    >
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col bg-slate-900 dark:bg-slate-950 text-white text-[11px] rounded-xl p-3 shadow-xl z-50 pointer-events-none min-w-[190px] leading-relaxed border border-slate-700/50">
                            <div className="font-black text-cyan-300 flex items-center gap-1">
                                <Calendar size={11} /> Ngày {seg.label}
                            </div>
                            <div className="border-b border-slate-700 my-1"></div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Lũy kế đến ngày:</span>
                                <span className="font-bold">{seg.cumulativeProgress}%</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Tăng trong ngày:</span>
                                <span className="font-black text-emerald-400">+{seg.addedProgress}%</span>
                            </div>
                            {seg.updatedBy && (
                                <div className="flex justify-between text-[10px] text-slate-400">
                                    <span>Người chốt:</span>
                                    <span className="font-medium truncate max-w-[100px]">{seg.updatedBy}</span>
                                </div>
                            )}
                            {seg.note && (
                                <div className="text-[10px] text-cyan-100 mt-1 italic border-t border-slate-800 pt-1 leading-normal max-w-[170px] break-words">
                                    Ghi chú: {seg.note}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {totalProgress > 0 && (
                    <span
                        className="absolute left-2 text-[8px] font-black text-slate-700 dark:text-white pointer-events-none"
                    >
                        {totalProgress}%
                    </span>
                )}
            </div>
        );
    };

    if (actionLoadState !== 'loaded') {
        return (
            <WeeklyProgressPermissionUnavailable
                state={actionLoadState}
                onRetry={() => setActionRetryNonce(prev => prev + 1)}
            />
        );
    }

    if (!weeklyProgressCapabilities.canView) {
        return (
            <WeeklyProgressPermissionUnavailable
                state="denied"
                onRetry={() => setActionRetryNonce(prev => prev + 1)}
            />
        );
    }

    if (baseDataLoadState === 'error') {
        return (
            <WeeklyProgressPermissionUnavailable
                state="error"
                onRetry={() => setBaseDataRetryNonce(prev => prev + 1)}
            />
        );
    }

    if (loading || !baseDataReadyForCurrentScope) {
        return (
            <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-12 text-center shadow-sm">
                <Loader2 size={36} className="mx-auto mb-3 animate-spin text-orange-500" />
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Đang tải dữ liệu chốt tiến độ...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Top Controllers & Action Bar */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 sm:p-5 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
                {/* Row 1: Searchable Select for WBS */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block">
                        Chọn hạng mục WBS cần xem/nhập
                    </label>
                    <div ref={dropdownRef} className="relative w-full">
                        <button
                            type="button"
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/70 text-xs sm:text-sm font-semibold text-zinc-800 dark:text-zinc-200 shadow-xs hover:border-teal-500/50 dark:hover:border-teal-500/50 transition-colors min-h-[42px]"
                        >
                            <div className="flex items-center gap-2 truncate">
                                <Sliders size={15} className="text-teal-700 dark:text-teal-400 shrink-0" />
                                <span className="truncate">
                                    {activeFilterTask
                                        ? `[${activeFilterTask.wbsCode}] ${activeFilterTask.name}`
                                        : '— Hiển thị toàn bộ hạng mục —'}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 text-zinc-400">
                                {selectedFilterTaskId && (
                                    <X
                                        size={14}
                                        className="hover:text-zinc-600 cursor-pointer"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedFilterTaskId('');
                                        }}
                                    />
                                )}
                                <ChevronDown size={14} />
                            </div>
                        </button>

                        {dropdownOpen && (
                            <div className="absolute left-0 right-0 mt-2 z-50 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl p-2 max-h-[300px] flex flex-col">
                                <div className="relative mb-2 shrink-0">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                                    <input
                                        type="text"
                                        value={dropdownSearch}
                                        onChange={e => setDropdownSearch(e.target.value)}
                                        placeholder="Tìm mã WBS hoặc tên..."
                                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-semibold outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                    />
                                </div>
                                <div className="overflow-y-auto flex-1 divide-y divide-zinc-100 dark:divide-zinc-800">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedFilterTaskId('');
                                            setDropdownOpen(false);
                                            setDropdownSearch('');
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs font-bold text-teal-700 dark:text-teal-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
                                    >
                                        — Hiển thị toàn bộ hạng mục —
                                    </button>
                                    {filteredDropdownTasks.map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedFilterTaskId(t.id);
                                                setDropdownOpen(false);
                                                setDropdownSearch('');
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-start gap-2 ${selectedFilterTaskId === t.id ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 font-bold' : 'text-zinc-700 dark:text-zinc-300 font-medium'
                                                }`}
                                        >
                                            <span className="font-mono text-teal-700 dark:text-teal-400 shrink-0 w-[50px]">{t.wbsCode}</span>
                                            <span className="truncate">{t.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Row 2: Settings & Actions */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
                    {/* Left: Kiểu chốt & Ngày chốt */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-auto">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block">Kiểu chốt</label>
                            <div className="flex rounded-xl bg-zinc-100 p-0.5 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 min-h-[38px] items-center">
                                {[
                                    { key: 'daily', label: 'Chốt ngày' },
                                    { key: 'weekly', label: 'Tổng hợp tuần' },
                                ].map(option => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => {
                                            const nextMode = option.key as ProgressEntryMode;
                                            if (nextMode === entryMode) return;
                                            const nextStart = nextMode === 'daily' ? selectedProgressDate : selectedWeekStart;
                                            beginPeriodTargetChange({
                                                key: getWeeklyProgressPeriodKey(scopeKey, nextMode, nextStart),
                                                scopeKey,
                                                periodType: nextMode,
                                                periodStart: nextStart,
                                            });
                                            setEntryMode(nextMode);
                                        }}
                                        className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${entryMode === option.key
                                                ? 'bg-white text-teal-800 shadow-xs dark:bg-zinc-900 dark:text-teal-300 font-black'
                                                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                                            }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block">
                                {entryMode === 'daily' ? 'Ngày chốt tiến độ' : 'Tuần chốt tiến độ'}
                            </label>
                            {entryMode === 'daily' ? (
                                <input
                                    type="date"
                                    value={selectedProgressDate}
                                    onChange={e => {
                                        if (!e.target.value) return;
                                        const nextWeekStart = getWeekStart(e.target.value);
                                        beginPeriodTargetChange({
                                            key: getWeeklyProgressPeriodKey(scopeKey, 'daily', e.target.value),
                                            scopeKey,
                                            periodType: 'daily',
                                            periodStart: e.target.value,
                                        });
                                        setSelectedProgressDate(e.target.value);
                                        setSelectedWeekStart(nextWeekStart);
                                        setFilterWeek(nextWeekStart);
                                        setFilterMonth(nextWeekStart.substring(0, 7));
                                    }}
                                    className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-zinc-800 dark:text-zinc-100 min-h-[38px]"
                                    title="Ngày chốt"
                                />
                            ) : (
                                <input
                                    type="date"
                                    value={selectedWeekStart}
                                    onChange={e => {
                                        if (!e.target.value) return;
                                        const nextWeekStart = getWeekStart(e.target.value);
                                        beginPeriodTargetChange({
                                            key: getWeeklyProgressPeriodKey(scopeKey, 'weekly', nextWeekStart),
                                            scopeKey,
                                            periodType: 'weekly',
                                            periodStart: nextWeekStart,
                                        });
                                        setSelectedWeekStart(nextWeekStart);
                                        setFilterWeek(nextWeekStart);
                                        setFilterMonth(nextWeekStart.substring(0, 7));
                                    }}
                                    className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-zinc-800 dark:text-zinc-100 min-h-[38px]"
                                    title="Tuần chốt"
                                />
                            )}
                        </div>
                    </div>

                    {/* Right: Period controls ([Đang mở / Đã chốt] + [Lưu thay đổi] + [Chốt / Mở chốt]) */}
                    <div className="flex items-center justify-end gap-2 pt-1 lg:pt-0">
                        {periodResourceLoadState === 'error' ? (
                            <WeeklyProgressPeriodUnavailable
                                onRetry={() => setPeriodResourceRetryNonce(previous => previous + 1)}
                            />
                        ) : (
                            <WeeklyProgressPeriodControls
                                periodType={entryMode}
                                periodStart={entryMode === 'daily' ? selectedProgressDate : selectedWeekStart}
                                stateLoaded={selectedPeriodStateLoaded}
                                state={selectedPeriodState}
                                canEdit={canEditSelectedPeriod}
                                canConfirm={canConfirmSelectedPeriod}
                                busy={savingDailyProgress || savingWeeklyProgress}
                                hasRows={weeklyLeafTasks.length > 0}
                                onSave={entryMode === 'daily' ? handleSaveDailyProgress : handleSaveWeeklyProgress}
                                onClose={handleCloseProgressPeriod}
                                onReopen={handleReopenProgressPeriod}
                            />
                        )}
                    </div>
                </div>

                {dailyModeAuthoritative && <div className="mt-3 flex flex-col gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900 sm:flex-row sm:items-center sm:justify-between dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200">
                    <div><strong>Tiến độ ngày lấy từ Nhật ký tổng hợp.</strong> Màn hình này chỉ đọc để tránh hai nguồn cùng sửa một số liệu.</div>
                    {!dailyProgressAuthority?.canEditException && <span className="font-semibold">Liên hệ người có cả quyền sửa tiến độ và công bố nhật ký nếu cần điều chỉnh.</span>}
                </div>}

                {/* Row 3: Sub-Filters for History Visualisation & Expand/Collapse */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 min-w-0">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider shrink-0">Biểu đồ Snapshots:</span>
                        <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-xl p-0.5 border border-zinc-200 dark:border-zinc-700 shrink-0">
                            {[
                                { key: 'recent', label: '8 tuần gần nhất' },
                                { key: 'week', label: 'Lũy kế Tuần' },
                                { key: 'month', label: 'Lũy kế Tháng' },
                                { key: 'all', label: 'Toàn bộ' },
                            ].map(btn => (
                                <button
                                    key={btn.key}
                                    onClick={() => setTimeFilterMode(btn.key as TimeFilterMode)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${timeFilterMode === btn.key
                                            ? 'bg-white dark:bg-zinc-900 text-teal-800 dark:text-teal-300 shadow-xs'
                                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                                        }`}
                                >
                                    {btn.label}
                                </button>
                            ))}
                        </div>

                        {/* Secondary Dropdown filters based on selection */}
                        {timeFilterMode === 'week' && (
                            <select
                                value={filterWeek}
                                onChange={e => setFilterWeek(e.target.value)}
                                className="text-xs font-bold text-zinc-700 dark:text-zinc-300 px-2.5 py-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500 outline-none shrink-0"
                            >
                                {uniqueWeeks.map(w => (
                                    <option key={w} value={w}>{getISOWeekLabel(w)} ({w})</option>
                                ))}
                            </select>
                        )}

                        {timeFilterMode === 'month' && (
                            <select
                                value={filterMonth}
                                onChange={e => setFilterMonth(e.target.value)}
                                className="text-xs font-bold text-zinc-700 dark:text-zinc-300 px-2.5 py-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500 outline-none shrink-0"
                            >
                                {uniqueMonths.map(m => (
                                    <option key={m} value={m}>Tháng {m}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Expand / Collapse all toggles */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                            type="button"
                            onClick={() => {
                                const parentIds = new Set<string>();
                                tasks.forEach(t => {
                                    if (t.parentId) parentIds.add(t.parentId);
                                });
                                setWeeklyCollapsedParents(parentIds);
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                        >
                            Thu gọn hết
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeeklyCollapsedParents(new Set())}
                            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                        >
                            Mở rộng hết
                        </button>
                    </div>
                </div>
            </div>

            {/* Chỉ giữ lại thông tin tổng tiến độ đã được chốt (Loại bỏ các card PO, Giá trị, Vật tư cấp) */}
            <div className="bg-gradient-to-r from-teal-900 via-teal-800 to-emerald-900 text-white rounded-2xl p-4 sm:p-5 border border-teal-700/60 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center text-teal-200 shrink-0">
                            <ClipboardCheck size={22} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-teal-200/90">
                                {entryMode === 'daily' ? 'Tổng tiến độ thi công đang chốt (ngày)' : 'Tổng tiến độ thi công đang chốt (tuần)'}
                            </div>
                            <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
                                <span className="text-2xl sm:text-3xl font-black tracking-tight">{draftConstructionProgress}%</span>
                                <span className="text-xs font-semibold text-teal-200/80">
                                    (Gốc đã chốt: <strong className="text-white">{weeklyConstructionProgress}%</strong>
                                    {draftConstructionProgress !== weeklyConstructionProgress && (
                                        <span className={`ml-1 font-bold ${draftConstructionProgress > weeklyConstructionProgress ? 'text-emerald-300' : 'text-amber-300'}`}>
                                            {draftConstructionProgress > weeklyConstructionProgress ? `+${(draftConstructionProgress - weeklyConstructionProgress).toFixed(1)}%` : `${(draftConstructionProgress - weeklyConstructionProgress).toFixed(1)}%`}
                                        </span>
                                    )}
                                    )
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 sm:max-w-xs w-full sm:w-auto">
                        <div className="w-full sm:w-48 bg-black/25 rounded-full h-2.5 overflow-hidden border border-white/10">
                            <div
                                className="bg-gradient-to-r from-teal-300 to-emerald-300 h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, draftConstructionProgress))}%` }}
                            />
                        </div>
                        <span className="text-xs font-mono font-bold text-teal-100 shrink-0">{draftConstructionProgress}%</span>
                    </div>
                </div>

                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-teal-100/80 font-medium">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        Bấm vào tên hạng mục để xem chi tiết trong bảng Tiến độ. Nhập % hoặc khối lượng và bấm <strong>[Lưu thay đổi]</strong>.
                    </span>
                    <span className="hidden md:inline text-teal-200/70">
                        {wbsTreeRows.filter(r => !r.hasChildren).length} hạng mục cần nhập
                    </span>
                </div>
            </div>

            {/* Mobile View: Thẻ nhập số liệu từng hạng mục trực tiếp, không cần cuộn ngang */}
            <div className="md:hidden space-y-3">
                {wbsTreeRows.map(task => {
                    const isParent = task.hasChildren;
                    const isCollapsed = weeklyCollapsedParents.has(task.id);
                    const weeklyDraft = weeklyDrafts[task.id] || { progressPercent: String(task.progress || 0), quantityDone: '0', note: '' };
                    const dailyDraft = dailyDrafts[task.id] || weeklyDraft;
                    const activeDraft = entryMode === 'daily' ? dailyDraft : weeklyDraft;
                    const linkedIds = taskContractLinks[task.id] || [];
                    const draftProgress = parseWeeklyProgressPercent(activeDraft.progressPercent);
                    const isOverProgress = draftProgress > 100;
                    const taskUnit = getTaskUnit(task, linkedIds, contractItems);
                    const exactDailyRow = getSelectedDailySourceRow(task.id);

                    if (isParent) {
                        return (
                            <div
                                key={task.id}
                                className="bg-zinc-100/90 dark:bg-zinc-800/90 rounded-2xl p-3 border border-zinc-200 dark:border-zinc-700 shadow-xs"
                                style={{ marginLeft: `${Math.min(task.depth * 10, 30)}px` }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setWeeklyCollapsedParents(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(task.id)) {
                                                        next.delete(task.id);
                                                    } else {
                                                        next.add(task.id);
                                                    }
                                                    return next;
                                                });
                                            }}
                                            className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 shadow-xs shrink-0 cursor-pointer"
                                            title={isCollapsed ? 'Mở rộng hạng mục con' : 'Thu gọn hạng mục con'}
                                        >
                                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                        </button>

                                        <span className="shrink-0 text-amber-500">
                                            {isCollapsed ? <Folder size={16} /> : <FolderOpen size={16} />}
                                        </span>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-mono font-black text-[11px] text-teal-700 dark:text-teal-400 shrink-0">
                                                    [{task.wbsCode || '–'}]
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => navigateToGanttTask(task.id)}
                                                    className="text-left font-black text-xs text-zinc-900 dark:text-zinc-100 hover:text-teal-600 dark:hover:text-teal-400 truncate cursor-pointer inline-flex items-center gap-1"
                                                    title={`Xem "${task.name}" trong bảng Tiến độ`}
                                                >
                                                    <span className="truncate">{task.name}</span>
                                                    <ArrowUpRight size={11} className="text-zinc-400 shrink-0" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="shrink-0 text-right">
                                        <span className="px-2 py-0.5 rounded-md bg-white dark:bg-zinc-700 text-xs font-black text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-600 shadow-xs">
                                            {task.progress}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    // Leaf task card - Chuyên để nhập số liệu
                    return (
                        <div
                            key={task.id}
                            className={`bg-white dark:bg-zinc-900 rounded-2xl p-3.5 border shadow-xs transition-all space-y-3 ${
                                isOverProgress
                                    ? 'border-red-300 bg-red-50/20 dark:bg-red-950/20 dark:border-red-900/60'
                                    : 'border-zinc-200 dark:border-zinc-800'
                            }`}
                            style={{ marginLeft: `${Math.min(task.depth * 10, 30)}px` }}
                        >
                            {/* Card Header: WBS Code + Task Name (Click to Gantt) */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 font-mono font-bold text-[10px] border border-teal-100 dark:border-teal-900 shrink-0">
                                            WBS {task.wbsCode || '–'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => navigateToGanttTask(task.id)}
                                            className="text-left font-bold text-xs text-zinc-900 dark:text-zinc-100 hover:text-teal-600 dark:hover:text-teal-400 transition-colors inline-flex items-center gap-1 cursor-pointer group"
                                            title={`Xem chi tiết "${task.name}" trong bảng Tiến độ`}
                                        >
                                            <span className="leading-snug">{task.name}</span>
                                            <ArrowUpRight size={12} className="text-zinc-400 group-hover:text-teal-600 shrink-0" />
                                        </button>
                                    </div>
                                </div>

                                <span className={`px-2 py-0.5 rounded-lg text-xs font-black shrink-0 ${
                                    draftProgress >= 100
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                        : draftProgress > 0
                                            ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                                            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                                }`}>
                                    {draftProgress}%
                                </span>
                            </div>

                            {/* Mini Snapshot Bars */}
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-2.5 border border-zinc-100 dark:border-zinc-800 space-y-2">
                                <div>
                                    <div className="mb-1 flex items-center justify-between text-[9px] font-bold uppercase text-zinc-400">
                                        <span>Tuần ({getISOWeekLabel(selectedWeekStart)})</span>
                                    </div>
                                    <WeeklySegmentedProgressBar taskId={task.id} />
                                </div>
                                <div>
                                    <div className="mb-1 flex items-center justify-between text-[9px] font-bold uppercase text-zinc-400">
                                        <span>Ngày ({selectedWeekStart.slice(5)} → {addDaysToIsoDate(selectedWeekStart, 6).slice(5)})</span>
                                    </div>
                                    <DailySegmentedProgressBar taskId={task.id} />
                                </div>
                            </div>

                            {dailyModeAuthoritative ? <DailyProgressCutoverFields
                                authoritative
                                row={exactDailyRow}
                                progressPercent={exactDailyRow ? formatNumberInput(exactDailyRow.progressPercent, 2) : activeDraft.progressPercent}
                                quantityDone={exactDailyRow?.quantityDone == null ? '' : formatNumberInput(exactDailyRow.quantityDone, 2)}
                                note={exactDailyRow?.note || ''}
                                unit={taskUnit}
                                dailyLogHref={buildDailyLogHref(exactDailyRow?.sourceDailyLogId)}
                                onChange={() => undefined}
                                canRequestException={dailyProgressAuthority?.canEditException}
                                onRequestException={exactDailyRow ? () => openDailyProgressException(exactDailyRow) : undefined}
                            /> : <>
                            {/* Direct Input Section - Ô nhập số liệu to, rõ, công thái học */}
                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                {/* Ô nhập % hoàn thành */}
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                                        % Hoàn thành
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={activeDraft.progressPercent}
                                            readOnly={!canEditSelectedPeriod}
                                            onChange={e => {
                                                if (entryMode === 'daily') {
                                                    void updateDailyProgressPercent(task, e.target.value);
                                                } else {
                                                    void updateWeeklyProgressPercent(task, e.target.value);
                                                }
                                            }}
                                            placeholder="0"
                                            className={`w-full pl-3 pr-7 py-2 rounded-xl border text-right font-black text-sm bg-white dark:bg-zinc-950 outline-none transition-all ${
                                                isOverProgress
                                                    ? 'border-red-400 text-red-600 bg-red-50/60 focus:ring-2 focus:ring-red-400'
                                                    : 'border-zinc-200 dark:border-zinc-700 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-zinc-900 dark:text-zinc-100'
                                            }`}
                                        />
                                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 pointer-events-none">%</span>
                                    </div>
                                </div>

                                {/* Ô nhập Khối lượng hoàn thành */}
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block truncate" title={`Khối lượng (${taskUnit})`}>
                                        Khối lượng ({taskUnit})
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={activeDraft.quantityDone}
                                            readOnly={!canEditSelectedPeriod}
                                            onChange={e => {
                                                if (entryMode === 'daily') {
                                                    void updateDailyQuantityDone(task, e.target.value);
                                                } else {
                                                    void updateWeeklyQuantityDone(task, e.target.value);
                                                }
                                            }}
                                            placeholder="0"
                                            className={`w-full px-3 py-2 rounded-xl border text-right font-black text-sm bg-white dark:bg-zinc-950 outline-none transition-all ${
                                                isOverProgress
                                                    ? 'border-red-400 text-red-600 bg-red-50/60 focus:ring-2 focus:ring-red-400'
                                                    : 'border-zinc-200 dark:border-zinc-700 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-zinc-900 dark:text-zinc-100'
                                            }`}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Ô nhập Ghi chú */}
                            <div className="space-y-1 pt-0.5">
                                <input
                                    type="text"
                                    value={activeDraft.note}
                                    readOnly={!canEditSelectedPeriod}
                                    onChange={e => {
                                        if (entryMode === 'daily') {
                                            updateDailyDraft(task.id, { note: e.target.value });
                                        } else {
                                            updateWeeklyDraft(task.id, { note: e.target.value });
                                        }
                                    }}
                                    placeholder={entryMode === 'daily' ? 'Ghi chú chốt ngày...' : 'Ghi chú chốt tuần...'}
                                    className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 text-xs font-medium outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
                                />
                            </div>
                            </>}
                        </div>
                    );
                })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto max-h-[650px] scrollbar-thin">
                    <table className="w-full min-w-[960px] text-xs">
                        <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800 z-10">
                            <tr className="text-[10px] font-black text-zinc-400 dark:text-zinc-400 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
                                <th className="px-4 py-3 text-left w-[100px]">WBS Code</th>
                                <th className="px-4 py-3 text-left w-[300px]">Hạng mục thi công (WBS)</th>
                                <th className="px-4 py-3 text-left">Biểu đồ tiến độ tuần/ngày (Gốc 100%)</th>
                                <th className="px-4 py-3 text-right w-[110px]">% hoàn thành</th>
                                <th className="px-4 py-3 text-right w-[140px]">Khối lượng hoàn thành</th>
                                <th className="px-4 py-3 text-left w-[220px]">Ghi chú chốt</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {wbsTreeRows.map(task => {
                                const isParent = task.hasChildren;
                                const isCollapsed = weeklyCollapsedParents.has(task.id);
                                const weeklyDraft = weeklyDrafts[task.id] || { progressPercent: String(task.progress || 0), quantityDone: '0', note: '' };
                                const dailyDraft = dailyDrafts[task.id] || weeklyDraft;
                                const activeDraft = entryMode === 'daily' ? dailyDraft : weeklyDraft;
                                const linkedIds = taskContractLinks[task.id] || [];
                                const draftProgress = parseWeeklyProgressPercent(activeDraft.progressPercent);
                                const isOverProgress = draftProgress > 100;
                                const taskUnit = getTaskUnit(task, linkedIds, contractItems);
                                const exactDailyRow = getSelectedDailySourceRow(task.id);

                                return (
                                    <tr
                                        key={task.id}
                                        className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                                            isParent ? 'bg-zinc-50/50 dark:bg-zinc-800/30 font-bold' : ''
                                        } ${isOverProgress ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}
                                    >
                                        {/* WBS Code */}
                                        <td className="px-4 py-3 font-mono font-black text-teal-700 dark:text-teal-400 text-[11px]">
                                            {task.wbsCode || '–'}
                                        </td>

                                        {/* Name with indentation and collapse/expand */}
                                        <td className="px-4 py-3">
                                            <div
                                                className="flex items-center gap-1.5"
                                                style={{ paddingLeft: `${task.depth * 18}px` }}
                                            >
                                                {isParent ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setWeeklyCollapsedParents(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(task.id)) {
                                                                    next.delete(task.id);
                                                                } else {
                                                                    next.add(task.id);
                                                                }
                                                                return next;
                                                            });
                                                        }}
                                                        className="w-5 h-5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
                                                    >
                                                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                    </button>
                                                ) : (
                                                    <span className="w-5 h-5 inline-block shrink-0" />
                                                )}

                                                <span className="text-zinc-400 shrink-0">
                                                    {isParent
                                                        ? (isCollapsed ? <Folder size={14} className="text-amber-500" /> : <FolderOpen size={14} className="text-amber-500" />)
                                                        : <PlayCircle size={13} className="text-teal-600 dark:text-teal-400" />
                                                    }
                                                </span>

                                                <button
                                                    type="button"
                                                    onClick={() => navigateToGanttTask(task.id)}
                                                    className={`text-left truncate block hover:text-teal-600 dark:hover:text-teal-400 hover:underline transition-colors cursor-pointer group ${
                                                        isParent ? 'text-zinc-900 dark:text-zinc-100 font-bold' : 'text-zinc-700 dark:text-zinc-300'
                                                    }`}
                                                    title={`Xem chi tiết "${task.name}" trong bảng Tiến độ`}
                                                >
                                                    <span className="truncate">{task.name}</span>
                                                    <ArrowUpRight size={11} className="inline ml-1 text-zinc-400 group-hover:text-teal-600 opacity-60 group-hover:opacity-100 transition-all" />
                                                </button>
                                            </div>
                                        </td>

                                        {/* Weekly + daily progress snapshot bars */}
                                        <td className="px-4 py-3 min-w-[200px]">
                                            <div className="space-y-2">
                                                <div>
                                                    <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase text-zinc-400">
                                                        <span>Tuần</span>
                                                        <span>{getISOWeekLabel(selectedWeekStart)}</span>
                                                    </div>
                                                    <WeeklySegmentedProgressBar taskId={task.id} />
                                                </div>
                                                <div>
                                                    <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase text-zinc-400">
                                                        <span>Ngày trong tuần</span>
                                                        <span>{selectedWeekStart} → {addDaysToIsoDate(selectedWeekStart, 6)}</span>
                                                    </div>
                                                    <DailySegmentedProgressBar taskId={task.id} />
                                                </div>
                                            </div>
                                        </td>

                                        {/* Percent Input/Text */}
                                        <td className="px-4 py-3">
                                            {isParent ? (
                                                <div className="text-right text-xs font-bold text-zinc-400 pr-2">
                                                    {task.progress}%
                                                </div>
                                            ) : dailyModeAuthoritative ? (
                                                <div className="space-y-1 text-right">
                                                    <div className="font-black text-teal-800 dark:text-teal-300">{exactDailyRow?.progressPercent ?? activeDraft.progressPercent}%</div>
                                                    <span className="inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-black text-teal-800">Nhật ký tổng hợp</span>
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={activeDraft.progressPercent}
                                                        readOnly={!canEditSelectedPeriod}
                                                        onChange={e => {
                                                            if (entryMode === 'daily') {
                                                                void updateDailyProgressPercent(task, e.target.value);
                                                            } else {
                                                                void updateWeeklyProgressPercent(task, e.target.value);
                                                            }
                                                        }}
                                                        className={`w-full pl-2 pr-6 py-1.5 rounded-xl border text-right font-black bg-white dark:bg-zinc-950 text-xs focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all ${
                                                            isOverProgress
                                                                ? 'border-red-300 text-red-600 bg-red-50/60 focus:ring-red-400'
                                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200'
                                                        }`}
                                                    />
                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-400 pointer-events-none">%</span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Quantity Completed Input/Text */}
                                        <td className="px-4 py-3">
                                            {isParent ? (
                                                <div className="text-right text-xs font-bold text-zinc-400 pr-2">
                                                    —
                                                </div>
                                            ) : dailyModeAuthoritative ? (
                                                <div className="text-right font-black text-zinc-800 dark:text-zinc-200">
                                                    {exactDailyRow?.quantityDone == null ? 'Chưa xác định' : `${formatNumberInput(exactDailyRow.quantityDone, 2)} ${taskUnit}`}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 justify-end">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={activeDraft.quantityDone}
                                                        readOnly={!canEditSelectedPeriod}
                                                        onChange={e => {
                                                            if (entryMode === 'daily') {
                                                                void updateDailyQuantityDone(task, e.target.value);
                                                            } else {
                                                                void updateWeeklyQuantityDone(task, e.target.value);
                                                            }
                                                        }}
                                                        className={`w-full max-w-[85px] px-2 py-1.5 rounded-xl border text-right font-black bg-white dark:bg-zinc-950 text-xs focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all ${
                                                            isOverProgress
                                                                ? 'border-red-300 text-red-600 bg-red-50/60 focus:ring-red-400'
                                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200'
                                                        }`}
                                                    />
                                                    <span className="text-[10px] font-bold text-zinc-400 shrink-0 truncate max-w-[40px]" title={taskUnit}>
                                                        {taskUnit}
                                                    </span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Notes */}
                                        <td className="px-4 py-3">
                                            {isParent ? (
                                                <div className="text-zinc-400 text-[10px] italic">
                                                    Tự động cộng dồn
                                                </div>
                                            ) : dailyModeAuthoritative ? (
                                                <div className="space-y-1.5">
                                                    <div className="text-xs text-zinc-600 dark:text-zinc-300">{exactDailyRow?.note || 'Không có ghi chú'}</div>
                                                    {buildDailyLogHref(exactDailyRow?.sourceDailyLogId) && <a href={buildDailyLogHref(exactDailyRow?.sourceDailyLogId)!} className="block font-bold text-teal-700 underline underline-offset-2">Mở nhật ký</a>}
                                                    {exactDailyRow && dailyProgressAuthority?.canEditException && <button type="button" onClick={() => openDailyProgressException(exactDailyRow)} className="font-bold text-amber-700 underline underline-offset-2">Điều chỉnh ngoại lệ</button>}
                                                </div>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={activeDraft.note}
                                                    readOnly={!canEditSelectedPeriod}
                                                    onChange={e => {
                                                        if (entryMode === 'daily') {
                                                            updateDailyDraft(task.id, { note: e.target.value });
                                                        } else {
                                                            updateWeeklyDraft(task.id, { note: e.target.value });
                                                        }
                                                    }}
                                                    placeholder={entryMode === 'daily' ? 'Ghi chú chốt ngày...' : 'Ghi chú chốt tuần...'}
                                                    className="w-full px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
                                                />
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Color Legend for Weeks */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-100 dark:border-slate-700/60 shadow-sm space-y-3">
                <div className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                    <Calendar size={13} className="text-orange-500" /> Chú giải màu sắc Snapshot chốt tiến độ tuần
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                    {visibleWeeks.map(week => (
                        <div key={week} className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                            <span
                                className="w-3.5 h-3.5 rounded-full inline-block shrink-0 shadow-sm border border-white/50"
                                style={{ backgroundColor: weekColors[week] || '#94a3b8' }}
                            />
                            <span>{getISOWeekLabel(week)} ({week})</span>
                        </div>
                    ))}
                    {visibleWeeks.length === 0 && (
                        <div className="text-xs font-bold text-slate-400 italic">Chưa có tuần nào được chốt tiến độ.</div>
                    )}
                </div>
            </div>

            {/* Color Legend for Days
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-100 dark:border-slate-700/60 shadow-sm space-y-3">
                <div className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                    <Calendar size={13} className="text-cyan-500" /> Chú giải màu sắc chốt tiến độ ngày trong tuần
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                    {selectedWeekDays.map(day => (
                        <div key={day} className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                            <span
                                className="w-3.5 h-3.5 rounded-full inline-block shrink-0 shadow-sm border border-white/50"
                                style={{ backgroundColor: dayColors[day] || '#94a3b8' }}
                            />
                            <span>{new Date(`${day}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                        </div>
                    ))}
                </div>
            </div> */}
            {exceptionRow && <div className="fixed inset-0 z-[1000] flex justify-end bg-black/35" onClick={event => event.target === event.currentTarget && !savingException && setExceptionRow(null)}>
                <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-zinc-900" aria-label="Điều chỉnh tiến độ ngoại lệ">
                    <div className="flex items-start justify-between border-b border-zinc-200 p-5 dark:border-zinc-800">
                        <div><h3 className="font-black text-zinc-900 dark:text-white">Điều chỉnh ngoại lệ</h3><p className="mt-1 text-xs text-zinc-500">Chỉ dùng khi tiến độ từ Nhật ký tổng hợp cần sửa có kiểm soát.</p></div>
                        <button type="button" disabled={savingException} onClick={() => setExceptionRow(null)} className="rounded-xl p-2 text-zinc-500 hover:bg-zinc-100"><X size={18} /></button>
                    </div>
                    <div className="flex-1 space-y-4 overflow-y-auto p-5">
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Hệ thống sẽ lưu người thực hiện, lý do và toàn bộ số liệu trước/sau vào audit.</div>
                        <label className="block space-y-1 text-xs font-bold text-zinc-700 dark:text-zinc-200">% hoàn thành<input type="number" min="0" step="0.01" value={exceptionProgress} onChange={event => setExceptionProgress(event.target.value)} className="block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block space-y-1 text-xs font-bold text-zinc-700 dark:text-zinc-200">Khối lượng lũy kế<input type="number" min="0" step="0.01" value={exceptionQuantity} onChange={event => setExceptionQuantity(event.target.value)} className="block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                            <label className="block space-y-1 text-xs font-bold text-zinc-700 dark:text-zinc-200">Khối lượng hôm nay<input type="number" min="0" step="0.01" value={exceptionDailyQuantity} onChange={event => setExceptionDailyQuantity(event.target.value)} className="block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                        </div>
                        <label className="block space-y-1 text-xs font-bold text-zinc-700 dark:text-zinc-200">Ghi chú<input type="text" value={exceptionNote} onChange={event => setExceptionNote(event.target.value)} className="block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                        <label className="block space-y-1 text-xs font-bold text-zinc-700 dark:text-zinc-200">Lý do điều chỉnh <span className="text-red-600">*</span><textarea value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} rows={4} placeholder="Mô tả bằng chứng và lý do cần sửa số liệu đã công bố..." className="block w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                    </div>
                    <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 p-4 sm:flex-row sm:justify-end dark:border-zinc-800">
                        <button type="button" disabled={savingException} onClick={() => setExceptionRow(null)} className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-bold text-zinc-700 disabled:opacity-50">Hủy</button>
                        <button type="button" disabled={savingException || !exceptionReason.trim()} onClick={handleSaveDailyProgressException} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 text-sm font-bold text-white disabled:opacity-50">{savingException && <Loader2 size={16} className="animate-spin" />} Lưu ngoại lệ</button>
                    </div>
                </aside>
            </div>}
        </div>
    );
}
