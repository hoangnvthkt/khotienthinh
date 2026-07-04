import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    Calendar,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    ChevronsDown,
    ChevronsUp,
    Circle,
    Clipboard,
    Clock,
    Copy,
    Download,
    FileText,
    Filter,
    Search,
    TrendingDown,
    TrendingUp,
    XCircle,
} from 'lucide-react';
import { loadXlsx } from '../../lib/loadXlsx';
import { DailyLog, ProjectTask, ProjectTaskCompletionRequest } from '../../types';
import { dailyLogService, taskService } from '../../lib/projectService';
import { taskCompletionRequestService } from '../../lib/projectTaskCompletionService';
import {
    clampProgress,
    deriveProjectTaskProgress,
    getLeafProjectTasks,
} from '../../lib/projectScheduleRules';
import {
    buildProjectScheduleProjection,
    type TaskProjectionDates,
} from '../../lib/projectScheduleProjection';
import DailyLogSummaryReport from '../../components/project/DailyLogSummaryReport';

interface ReportTabProps {
    constructionSiteId: string;
    projectId?: string;
    contractValue?: number;
    totalSpent?: number;
}

type ReportView = 'overview' | 'dailylog';
type StatusFilter = 'all' | 'active' | 'late' | 'completed' | 'not_started';
type ScheduleStatus = 'completed' | 'ahead' | 'on_track' | 'late' | 'not_started' | 'not_due';

const STATUS_FILTER_KEYS: StatusFilter[] = ['all', 'active', 'late', 'completed', 'not_started'];

const normalizeStatusFilter = (value?: string | null): StatusFilter => (
    STATUS_FILTER_KEYS.includes(value as StatusFilter) ? value as StatusFilter : 'all'
);

interface DelayInfo {
    days: number;
    reasons: string[];
}

interface ScheduleReportRow {
    task: ProjectTask;
    level: number;
    hasChildren: boolean;
    isLeaf: boolean;
    plannedDays: number;
    plannedPercent: number;
    actualProgress: number;
    progressDelta: number;
    actualStart?: string;
    actualEnd?: string;
    forecastEnd: string;
    endBasisLabel: string;
    dayDelta: number;
    startDelta: number;
    status: ScheduleStatus;
    note: string;
    delayDays: number;
}

const DAY_MS = 86400000;

const toIsoDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const parseIsoDate = (iso?: string | null): Date | null => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
};

const diffDays = (from: string, to: string): number => {
    const a = parseIsoDate(from);
    const b = parseIsoDate(to);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
};

const inclusiveDays = (start?: string, end?: string): number => {
    if (!start || !end) return 0;
    return Math.max(1, diffDays(start, end) + 1);
};

const fmtDate = (iso?: string | null): string => {
    const date = parseIsoDate(iso);
    if (!date) return '-';
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtPercent = (value: number): string => `${Math.round(value)}%`;

const formatProgressDelta = (delta: number): string => {
    const rounded = Math.round(delta);
    if (rounded > 0) return `Nhanh ${rounded} điểm %`;
    if (rounded < 0) return `Chậm ${Math.abs(rounded)} điểm %`;
    return 'Đúng tiến độ';
};

const formatDayDelta = (days: number): string => {
    if (days > 0) return `Chậm ${days} ngày`;
    if (days < 0) return `Nhanh ${Math.abs(days)} ngày`;
    return 'Đúng kế hoạch';
};

const formatNullableDayDelta = (days: number | null): string => (
    days === null ? 'Chưa đủ dữ liệu' : formatDayDelta(days)
);

const fmtSpi = (value: number | null): string => (
    value === null ? 'Chưa đủ dữ liệu' : value.toFixed(3)
);

const compareWbsCodes = (a = '', b = ''): number => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    const max = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < max; i++) {
        const va = partsA[i] ?? 0;
        const vb = partsB[i] ?? 0;
        if (!Number.isFinite(va) || !Number.isFinite(vb)) return a.localeCompare(b, 'vi');
        if (va !== vb) return va - vb;
    }

    return a.localeCompare(b, 'vi');
};

const normalizeText = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();

const deriveActualDates = (task: ProjectTask, dailyLogs: DailyLog[]) => {
    let start = task.actualStartDate;
    let end = task.actualEndDate;

    if (!start || !end) {
        const linkedLogs = dailyLogs.filter(log => {
            const verified = log.status === 'verified' || log.verified;
            if (!verified) return false;
            const hasDelayLink = (log.delayTasks || []).some(delay => delay.taskId === task.id);
            const hasVolumeLink = (log.volumes || []).some(volume => volume.taskId === task.id);
            const hasLaborLink = (log.laborDetails || []).some(labor => labor.taskId === task.id);
            const hasMachineLink = (log.machines || []).some(machine => machine.taskId === task.id);
            return hasDelayLink || hasVolumeLink || hasLaborLink || hasMachineLink;
        });

        if (linkedLogs.length > 0) {
            const dates = linkedLogs.map(log => log.date).sort();
            if (!start) start = dates[0];
            if (!end && (task.progress >= 100 || task.gateStatus === 'approved')) end = dates[dates.length - 1];
        }
    }

    if (!end && task.gateStatus === 'approved' && task.gateApprovedAt) {
        end = task.gateApprovedAt.split('T')[0];
    }

    return { actualStart: start, actualEnd: end };
};

const getScheduleStatus = (row: {
    task: ProjectTask;
    plannedPercent: number;
    actualProgress: number;
    dayDelta: number;
    todayIso: string;
}): ScheduleStatus => {
    if (row.actualProgress >= 100) return 'completed';
    if (row.task.startDate && row.todayIso < row.task.startDate) return 'not_due';
    if (row.actualProgress <= 0) return 'not_started';
    if (row.dayDelta > 0 || row.actualProgress + 5 < row.plannedPercent) return 'late';
    if (row.dayDelta < 0 || row.actualProgress > row.plannedPercent + 5) return 'ahead';
    return 'on_track';
};

const getStatusLabel = (status: ScheduleStatus): string => {
    switch (status) {
        case 'completed': return 'Hoàn thành';
        case 'ahead': return 'Đang nhanh';
        case 'on_track': return 'Đúng kế hoạch';
        case 'late': return 'Đang chậm';
        case 'not_started': return 'Chưa bắt đầu';
        case 'not_due': return 'Chưa tới KH';
        default: return 'Không rõ';
    }
};

const getStatusClass = (status: ScheduleStatus): string => {
    switch (status) {
        case 'completed': return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        case 'ahead': return 'border-cyan-200 bg-cyan-50 text-cyan-700';
        case 'on_track': return 'border-slate-200 bg-slate-50 text-slate-700';
        case 'late': return 'border-red-200 bg-red-50 text-red-700';
        case 'not_started': return 'border-amber-200 bg-amber-50 text-amber-700';
        case 'not_due': return 'border-slate-200 bg-white text-slate-500';
        default: return 'border-slate-200 bg-slate-50 text-slate-600';
    }
};

const getStatusIcon = (status: ScheduleStatus) => {
    switch (status) {
        case 'completed': return CheckCircle2;
        case 'ahead': return TrendingUp;
        case 'on_track': return Clock;
        case 'late': return AlertTriangle;
        case 'not_started': return XCircle;
        case 'not_due': return Circle;
        default: return Circle;
    }
};

const buildLevelMap = (tasks: ProjectTask[]) => {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const cache = new Map<string, number>();

    const getLevel = (task: ProjectTask): number => {
        if (cache.has(task.id)) return cache.get(task.id)!;
        if (!task.parentId || !byId.has(task.parentId)) {
            cache.set(task.id, 0);
            return 0;
        }
        const parent = byId.get(task.parentId)!;
        const level = Math.min(6, getLevel(parent) + 1);
        cache.set(task.id, level);
        return level;
    };

    tasks.forEach(getLevel);
    return cache;
};

const buildDelayMap = (dailyLogs: DailyLog[]): Map<string, DelayInfo> => {
    const map = new Map<string, DelayInfo>();

    dailyLogs.forEach(log => {
        (log.delayTasks || []).forEach(delay => {
            if (!delay.taskId) return;
            const current = map.get(delay.taskId) || { days: 0, reasons: [] };
            const reason = delay.reason?.trim();
            map.set(delay.taskId, {
                days: current.days + Number(delay.delayDays || 0),
                reasons: reason && !current.reasons.includes(reason)
                    ? [...current.reasons, reason]
                    : current.reasons,
            });
        });
    });

    return map;
};

const MetricTile: React.FC<{
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ElementType;
    tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'cyan';
}> = ({ label, value, sub, icon: Icon, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-white text-slate-700',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        red: 'border-red-200 bg-red-50 text-red-700',
        cyan: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    };

    return (
        <div className={`rounded-lg border p-4 shadow-sm ${tones[tone]}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p>
                <Icon size={18} className="shrink-0" />
            </div>
            <div className="text-2xl font-black leading-none text-slate-900 dark:text-white">{value}</div>
            {sub && <div className="mt-2 text-[11px] font-bold leading-4 text-slate-500">{sub}</div>}
        </div>
    );
};

const ReportTab: React.FC<ReportTabProps> = React.memo(({ constructionSiteId, projectId }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const queryReportView = useMemo(() => new URLSearchParams(location.search).get('reportView'), [location.search]);
    const queryReportStatus = useMemo(
        () => normalizeStatusFilter(new URLSearchParams(location.search).get('reportStatus')),
        [location.search],
    );
    const [activeReportView, setActiveReportView] = useState<ReportView>(
        queryReportView === 'dailylog' ? 'dailylog' : 'overview',
    );
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
    const [completionRequests, setCompletionRequests] = useState<ProjectTaskCompletionRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>(queryReportStatus);
    const [briefingCopied, setBriefingCopied] = useState(false);
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
    const [briefingCollapsed, setBriefingCollapsed] = useState(false);
    const projectScopeId = projectId || constructionSiteId;

    useEffect(() => {
        setActiveReportView(queryReportView === 'dailylog' ? 'dailylog' : 'overview');
    }, [queryReportView]);

    useEffect(() => {
        setStatusFilter(queryReportStatus);
    }, [queryReportStatus]);

    const changeReportView = (view: ReportView) => {
        setActiveReportView(view);

        const params = new URLSearchParams(location.search);
        if (projectId) params.set('projectId', projectId);
        if (constructionSiteId) params.set('siteId', constructionSiteId);
        params.set('tab', 'report');
        params.delete('dailyLogId');

        if (view === 'dailylog') {
            params.set('reportView', 'dailylog');
        } else {
            params.delete('reportView');
        }

        navigate(`/da?${params.toString()}`, { replace: true });
    };

    const changeStatusFilter = (filter: StatusFilter) => {
        setStatusFilter(filter);

        const params = new URLSearchParams(location.search);
        if (projectId) params.set('projectId', projectId);
        if (constructionSiteId) params.set('siteId', constructionSiteId);
        params.set('tab', 'report');
        params.delete('dailyLogId');
        params.delete('reportView');
        if (filter === 'all') {
            params.delete('reportStatus');
        } else {
            params.set('reportStatus', filter);
        }

        navigate(`/da?${params.toString()}`, { replace: true });
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        Promise.all([
            taskService.list(projectScopeId, constructionSiteId),
            dailyLogService.list(projectScopeId, constructionSiteId),
            taskCompletionRequestService.list(projectScopeId, constructionSiteId),
        ])
            .then(([taskRows, logRows, completionRows]) => {
                if (cancelled) return;
                setTasks(taskRows);
                setDailyLogs(logRows);
                setCompletionRequests(completionRows);
            })
            .catch(console.error)
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [constructionSiteId, projectScopeId]);

    const todayIso = useMemo(() => toIsoDate(new Date()), []);

    const derivedTasks = useMemo(
        () => deriveProjectTaskProgress(tasks, completionRequests, dailyLogs, todayIso),
        [completionRequests, dailyLogs, tasks, todayIso],
    );

    const rawTaskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);

    const scheduleReport = useMemo(() => {
        const childCount = new Map<string, number>();
        derivedTasks.forEach(task => {
            if (!task.parentId) return;
            childCount.set(task.parentId, (childCount.get(task.parentId) || 0) + 1);
        });

        const levelMap = buildLevelMap(derivedTasks);
        const delayMap = buildDelayMap(dailyLogs);
        const leafIds = new Set(getLeafProjectTasks(derivedTasks).map(task => task.id));
        const actualDatesByTask = new Map<string, TaskProjectionDates>();

        derivedTasks.forEach(task => {
            const sourceTask = rawTaskById.get(task.id) || task;
            actualDatesByTask.set(task.id, deriveActualDates(
                {
                    ...sourceTask,
                    progress: task.progress,
                    gateStatus: task.gateStatus,
                    gateApprovedAt: task.gateApprovedAt || sourceTask.gateApprovedAt,
                },
                dailyLogs,
            ));
        });

        const projection = buildProjectScheduleProjection({
            tasks: derivedTasks,
            dailyLogs,
            todayIso,
            taskActualDates: actualDatesByTask,
        });

        const rows: ScheduleReportRow[] = [...derivedTasks]
            .sort((a, b) => compareWbsCodes(a.wbsCode, b.wbsCode) || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'vi'))
            .map(task => {
                const taskProjection = projection.taskProjections.get(task.id);
                const { actualStart, actualEnd } = actualDatesByTask.get(task.id) || {};
                const plannedDays = inclusiveDays(task.startDate, task.endDate) || Math.max(1, Number(task.duration || 1));
                const plannedPercent = taskProjection?.plannedPercent || 0;
                const actualProgress = taskProjection?.actualProgress ?? clampProgress(task.progress);
                const forecastEnd = taskProjection?.forecastEnd || task.endDate || todayIso;
                const dayDelta = taskProjection?.dayDelta ?? (task.endDate ? diffDays(task.endDate, actualProgress >= 100 ? (actualEnd || forecastEnd) : forecastEnd) : 0);
                const startDelta = actualStart && task.startDate ? diffDays(task.startDate, actualStart) : 0;
                const status = getScheduleStatus({
                    task,
                    plannedPercent,
                    actualProgress,
                    dayDelta,
                    todayIso,
                });
                const delayInfo = delayMap.get(task.id);
                const note = [
                    task.delayReason,
                    delayInfo?.reasons.slice(0, 2).join('; '),
                    task.notes,
                    dayDelta > 0 && !task.delayReason && !delayInfo?.reasons.length ? 'Cần cập nhật nguyên nhân chậm' : '',
                ].filter(Boolean)[0] || '-';

                return {
                    task,
                    level: levelMap.get(task.id) || 0,
                    hasChildren: (childCount.get(task.id) || 0) > 0,
                    isLeaf: leafIds.has(task.id),
                    plannedDays,
                    plannedPercent,
                    actualProgress,
                    progressDelta: actualProgress - plannedPercent,
                    actualStart,
                    actualEnd,
                    forecastEnd,
                    endBasisLabel: taskProjection?.endBasisLabel || (actualProgress >= 100 ? 'Kết thúc TT' : 'Dự kiến TT'),
                    dayDelta,
                    startDelta,
                    status,
                    note,
                    delayDays: delayInfo?.days || 0,
                };
            });

        const leafRows = rows.filter(row => row.isLeaf);
        const rowsForProject = leafRows.length > 0 ? leafRows : rows;
        const topLevelRows = rows.filter(row => !row.task.parentId);
        const completedRows = rowsForProject.filter(row => row.actualProgress >= 100);
        const activeRows = rowsForProject.filter(row => row.actualProgress > 0 && row.actualProgress < 100);
        const touchedRows = rowsForProject.filter(row => row.actualProgress > 0 || row.actualStart || row.actualEnd);
        const lateRows = rowsForProject.filter(row => row.status === 'late' || row.dayDelta > 0);
        const notStartedRows = rowsForProject.filter(row => row.actualProgress <= 0 && row.status !== 'not_due');

        return {
            rows,
            rowsForProject,
            topLevelRows,
            completedRows,
            activeRows,
            touchedRows,
            lateRows,
            notStartedRows,
            projectStart: projection.projectStart,
            projectEnd: projection.projectEnd,
            projectDuration: projection.baselineDurationDays,
            forecastProjectEnd: projection.forecastProjectEnd,
            forecastDuration: projection.forecastDurationDays,
            projectDayDelta: projection.forecastDeltaDays,
            plannedProgress: projection.plannedProgressPercent,
            actualProgress: projection.actualProgressPercent,
            projection,
        };
    }, [dailyLogs, derivedTasks, rawTaskById, todayIso]);

    const toggleCollapse = (taskId: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    const expandAll = () => {
        setCollapsedIds(new Set());
    };

    const collapseAll = () => {
        const parentIds = scheduleReport.rows
            .filter(r => r.hasChildren)
            .map(r => r.task.id);
        setCollapsedIds(new Set(parentIds));
    };

    const briefingText = useMemo(() => {
        if (scheduleReport.rows.length === 0) {
            return `Báo cáo Sếp, hiện dự án chưa có dữ liệu tiến độ để tổng hợp đến ngày ${fmtDate(todayIso)}.`;
        }

        const itemNames = scheduleReport.topLevelRows.length > 0
            ? scheduleReport.topLevelRows.slice(0, 6).map(row => {
                const range = row.task.startDate && row.task.endDate ? ` (${fmtDate(row.task.startDate)} - ${fmtDate(row.task.endDate)})` : '';
                return `${row.task.name}${range}`;
            })
            : scheduleReport.rowsForProject.slice(0, 6).map(row => row.task.name);
        const touchedNames = scheduleReport.touchedRows.length > 0
            ? scheduleReport.touchedRows.slice(0, 6).map(row => `${row.task.name} đạt ${fmtPercent(row.actualProgress)}`)
            : ['chưa có hạng mục nào ghi nhận thực hiện'];
        const lateNames = scheduleReport.lateRows.slice(0, 4).map(row => `${row.task.name} ${formatDayDelta(row.dayDelta).toLowerCase()}`);
        const progressDelta = scheduleReport.actualProgress - scheduleReport.plannedProgress;
        const durationForecastLine = scheduleReport.projection.spiDurationDays !== null
            ? `Nếu giữ nhịp hiện tại, dự án dự kiến cần ${scheduleReport.projection.spiDurationDays} ngày, ${formatNullableDayDelta(scheduleReport.projection.spiDeltaDays).toLowerCase()} so với kế hoạch gốc.`
            : 'Nếu giữ nhịp hiện tại, SPI chưa đủ dữ liệu để quy đổi ra tổng thời lượng dự án.';

        return [
            `Báo cáo Sếp, kế hoạch gốc là ${scheduleReport.projectDuration} ngày, bắt đầu từ ngày ${fmtDate(scheduleReport.projectStart)} tới ngày ${fmtDate(scheduleReport.projectEnd)}.`,
            `Đến ngày ${fmtDate(todayIso)}, kế hoạch phải đạt khoảng ${fmtPercent(scheduleReport.plannedProgress)}, thực tế đang đạt ${fmtPercent(scheduleReport.actualProgress)}, SPI = ${fmtSpi(scheduleReport.projection.spi)}, ${formatProgressDelta(progressDelta).toLowerCase()}.`,
            durationForecastLine,
            `Dự án bao gồm các hạng mục chính: ${itemNames.join('; ')}.`,
            `Các hạng mục đã và đang thực hiện gồm: ${touchedNames.join('; ')}.`,
            `Dự báo mốc kết thúc theo nhịp hiện tại là ${fmtDate(scheduleReport.forecastProjectEnd)}, ${formatDayDelta(scheduleReport.projectDayDelta).toLowerCase()} so với kế hoạch.`,
            lateNames.length > 0 ? `Các điểm cần báo cáo thêm: ${lateNames.join('; ')}.` : 'Hiện chưa ghi nhận hạng mục lá nào chậm theo dữ liệu tiến độ hiện tại.',
        ].join('\n');
    }, [scheduleReport, todayIso]);

    const filteredRows = useMemo(() => {
        const query = normalizeText(searchTerm.trim());

        return scheduleReport.rows.filter(row => {
            if (statusFilter === 'active' && !(row.actualProgress > 0 && row.actualProgress < 100)) return false;
            if (statusFilter === 'late' && !(row.status === 'late' || row.dayDelta > 0)) return false;
            if (statusFilter === 'completed' && row.actualProgress < 100) return false;
            if (statusFilter === 'not_started' && !(row.actualProgress <= 0 && row.status !== 'not_due')) return false;
            if (!query) return true;
            return normalizeText(`${row.task.wbsCode || ''} ${row.task.name} ${row.task.assignee || ''} ${row.note}`).includes(query);
        });
    }, [scheduleReport.rows, searchTerm, statusFilter]);

    const displayedRows = useMemo(() => {
        return filteredRows.filter(row => {
            if (searchTerm.trim() || statusFilter !== 'all') return true;
            let parentId = row.task.parentId;
            while (parentId) {
                if (collapsedIds.has(parentId)) return false;
                const parent = rawTaskById.get(parentId);
                parentId = parent?.parentId;
            }
            return true;
        });
    }, [filteredRows, collapsedIds, rawTaskById, searchTerm, statusFilter]);

    const statusFilters: { key: StatusFilter; label: string; count: number }[] = [
        { key: 'all', label: 'Tất cả', count: scheduleReport.rows.length },
        { key: 'active', label: 'Đang làm', count: scheduleReport.activeRows.length },
        { key: 'late', label: 'Chậm', count: scheduleReport.lateRows.length },
        { key: 'completed', label: 'Hoàn thành', count: scheduleReport.completedRows.length },
        { key: 'not_started', label: 'Chưa BĐ', count: scheduleReport.notStartedRows.length },
    ];

    const copyBriefing = async () => {
        try {
            await navigator.clipboard.writeText(briefingText);
            setBriefingCopied(true);
            window.setTimeout(() => setBriefingCopied(false), 1600);
        } catch (error) {
            console.error(error);
        }
    };

    const exportToExcel = async () => {
        const XLSX = await loadXlsx();
        const summaryRows = [
            ['Báo cáo tiến độ dự án', fmtDate(todayIso)],
            ['Bắt đầu KH', fmtDate(scheduleReport.projectStart)],
            ['Kết thúc KH', fmtDate(scheduleReport.projectEnd)],
            ['Thời lượng gốc', `${scheduleReport.projectDuration} ngày`],
            ['% KH đến hôm nay', fmtPercent(scheduleReport.plannedProgress)],
            ['% Thực tế', fmtPercent(scheduleReport.actualProgress)],
            ['SPI hôm nay', fmtSpi(scheduleReport.projection.spi)],
            ['Thời lượng dự báo theo SPI', scheduleReport.projection.spiDurationDays !== null ? `${scheduleReport.projection.spiDurationDays} ngày` : 'Chưa đủ dữ liệu'],
            ['Lệch ngày theo SPI', formatNullableDayDelta(scheduleReport.projection.spiDeltaDays)],
            ['Dự báo mốc kết thúc', fmtDate(scheduleReport.forecastProjectEnd)],
            ['Thời lượng dự báo theo mốc', scheduleReport.forecastDuration ? `${scheduleReport.forecastDuration} ngày` : 'Chưa đủ dữ liệu'],
            ['Lệch mốc kết thúc', formatDayDelta(scheduleReport.projectDayDelta)],
            [],
            ['Câu trả lời nhanh'],
            ...briefingText.split('\n').map(line => [line]),
            [],
            [
                'Mã WBS',
                'Hạng mục',
                'Bắt đầu KH',
                'Kết thúc KH',
                'Số ngày KH',
                '% KH hôm nay',
                'Bắt đầu TT',
                'Kết thúc/Dự kiến TT',
                '% TT',
                'Lệch tiến độ',
                'Lệch ngày',
                'Trạng thái',
                'Ghi chú',
            ],
            ...scheduleReport.rows.map(row => [
                row.task.wbsCode || '',
                row.task.name,
                fmtDate(row.task.startDate),
                fmtDate(row.task.endDate),
                row.plannedDays,
                fmtPercent(row.plannedPercent),
                row.actualStart ? fmtDate(row.actualStart) : '',
                fmtDate(row.actualProgress >= 100 ? (row.actualEnd || row.forecastEnd) : row.forecastEnd),
                fmtPercent(row.actualProgress),
                formatProgressDelta(row.progressDelta),
                formatDayDelta(row.dayDelta),
                getStatusLabel(row.status),
                row.note === '-' ? '' : row.note,
            ]),
        ];

        const ws = XLSX.utils.aoa_to_sheet(summaryRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Tien_do');
        XLSX.writeFile(wb, `Bao_cao_tien_do_${Date.now()}.xlsx`);
    };

    const renderVisualBriefing = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center py-8 text-sm font-bold text-slate-400">
                    Đang tổng hợp dữ liệu tiến độ...
                </div>
            );
        }

        if (scheduleReport.rows.length === 0) {
            return (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-7 text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                    Báo cáo Sếp, hiện dự án chưa có dữ liệu tiến độ để tổng hợp đến ngày {fmtDate(todayIso)}.
                </div>
            );
        }

        const topLevelRows = scheduleReport.topLevelRows.slice(0, 6);
        const touchedRows = scheduleReport.touchedRows.slice(0, 6);
        const lateRows = scheduleReport.lateRows.slice(0, 4);

        return (
            <div className="grid grid-cols-1 gap-6 text-sm lg:grid-cols-2">
                {/* Cột Trái: Tổng quan & Dự báo */}
                <div className="space-y-5">
                    {/* Phần 1: Tổng quan tiến độ */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700/50 dark:bg-slate-900/50 shadow-sm">
                        <div className="mb-3.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <Activity size={14} className="text-blue-500" />
                            Tổng quan tiến độ dự án
                        </div>
                        <div className="space-y-3.5 font-semibold leading-relaxed text-slate-600 dark:text-slate-300">
                            <p>
                                Báo cáo Sếp, theo kế hoạch, tiến độ dự án bắt đầu từ ngày{' '}
                                <span className="font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-900/30">
                                    {fmtDate(scheduleReport.projectStart)}
                                </span>{' '}
                                tới ngày{' '}
                                <span className="font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-900/30">
                                    {fmtDate(scheduleReport.projectEnd)}
                                </span>{' '}
                                (<span className="font-extrabold text-slate-900 dark:text-slate-100">{scheduleReport.projectDuration} ngày</span>).
                            </p>
                            <p>
                                Đến ngày{' '}
                                <span className="font-extrabold text-slate-800 dark:text-slate-200">
                                    {fmtDate(todayIso)}
                                </span>
                                , kế hoạch phải đạt khoảng{' '}
                                <span className="font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30">
                                    {fmtPercent(scheduleReport.plannedProgress)}
                                </span>
                                , thực tế đang đạt{' '}
                                <span className="font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/30">
                                    {fmtPercent(scheduleReport.actualProgress)}
                                </span>
                                ,{' '}
                                <span className={`font-extrabold ${progressDelta < -5
                                        ? 'text-red-650 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900/30'
                                        : progressDelta > 5
                                            ? 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/40 border-cyan-100 dark:border-cyan-900/30'
                                            : 'text-slate-650 text-slate-650/80 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'
                                    } px-1.5 py-0.5 rounded border`}>
                                    {formatProgressDelta(progressDelta).toLowerCase()}
                                </span>
                                , SPI ={' '}
                                <span className="font-extrabold text-slate-900 dark:text-slate-100">
                                    {fmtSpi(scheduleReport.projection.spi)}
                                </span>.
                            </p>
                            <p>
                                Nếu giữ nhịp hiện tại, dự án dự kiến cần{' '}
                                <span className="font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30">
                                    {scheduleReport.projection.spiDurationDays !== null ? `${scheduleReport.projection.spiDurationDays} ngày` : 'chưa đủ dữ liệu'}
                                </span>
                                {scheduleReport.projection.spiDeltaDays !== null && (
                                    <>
                                        ,{' '}
                                        <span className={`font-extrabold ${scheduleReport.projection.spiDeltaDays > 0
                                                ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900/30'
                                                : scheduleReport.projection.spiDeltaDays < 0
                                                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/30'
                                                    : 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'
                                            } px-1.5 py-0.5 rounded border`}>
                                            {formatDayDelta(scheduleReport.projection.spiDeltaDays).toLowerCase()}
                                        </span>{' '}
                                        so với kế hoạch gốc
                                    </>
                                )}
                                .
                            </p>
                        </div>
                    </div>

                    {/* Phần 4: Dự báo kết thúc */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700/50 dark:bg-slate-900/50 shadow-sm">
                        <div className="mb-3.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <Clock size={14} className="text-indigo-500" />
                            Dự báo kết thúc dự án
                        </div>
                        <div className="font-semibold leading-relaxed text-slate-600 dark:text-slate-300">
                            Dự báo mốc kết thúc theo nhịp hiện tại là{' '}
                            <span className="font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30">
                                {fmtDate(scheduleReport.forecastProjectEnd)}
                            </span>
                            ,{' '}
                            <span className={`font-extrabold ${scheduleReport.projectDayDelta > 0
                                    ? 'text-red-650 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900/30'
                                    : scheduleReport.projectDayDelta < 0
                                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/30'
                                        : 'text-slate-650 text-slate-650/80 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'
                                } px-1.5 py-0.5 rounded border`}>
                                {formatDayDelta(scheduleReport.projectDayDelta).toLowerCase()}
                            </span>{' '}
                            so với kế hoạch. Thời lượng theo mốc dự báo là{' '}
                            <span className="font-extrabold text-slate-900 dark:text-slate-100">
                                {scheduleReport.forecastDuration ? `${scheduleReport.forecastDuration} ngày` : 'chưa đủ dữ liệu'}
                            </span>.
                        </div>
                    </div>
                </div>

                {/* Cột Phải: Các Hạng mục */}
                <div className="space-y-5">
                    {/* Phần 2: Hạng mục chính (Mỗi hạng mục 1 dòng) */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700/50 dark:bg-slate-900/50 shadow-sm">
                        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <Clipboard size={14} className="text-slate-500" />
                            Dự án bao gồm các hạng mục chính
                        </div>
                        <div className="space-y-2.5">
                            {topLevelRows.length > 0 ? (
                                topLevelRows.map((row, idx) => (
                                    <div key={idx} className="flex items-start gap-2.5 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                        <div className="min-w-0">
                                            <span className="font-extrabold text-slate-900 dark:text-white">
                                                {row.task.name}
                                            </span>
                                            {row.task.startDate && row.task.endDate && (
                                                <span className="text-[12px] text-slate-500 dark:text-slate-400">
                                                    {' '}(từ <span className="font-bold text-blue-600 dark:text-blue-400">{fmtDate(row.task.startDate)}</span> đến <span className="font-bold text-blue-600 dark:text-blue-400">{fmtDate(row.task.endDate)}</span>)
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                scheduleReport.rowsForProject.slice(0, 6).map((row, idx) => (
                                    <div key={idx} className="flex items-start gap-2.5 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                        <span className="font-extrabold text-slate-900 dark:text-white">
                                            {row.task.name}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Phần 3: Hạng mục đã và đang thực hiện */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700/50 dark:bg-slate-900/50 shadow-sm">
                        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <CheckCircle2 size={14} className="text-emerald-500" />
                            Các hạng mục đã và đang thực hiện gồm
                        </div>
                        <div className="space-y-2.5">
                            {touchedRows.length > 0 ? (
                                touchedRows.map((row, idx) => (
                                    <div key={idx} className="flex items-center justify-between gap-3 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                                            <span className="font-extrabold text-slate-900 dark:text-white truncate">
                                                {row.task.name}
                                            </span>
                                        </div>
                                        <span className={`font-extrabold text-xs shrink-0 ${row.actualProgress >= 100
                                                ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-800/30'
                                                : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-800/30'
                                            } px-2 py-0.5 rounded border shadow-sm`}>
                                            đạt {fmtPercent(row.actualProgress)}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-[13px] italic text-slate-400 pl-4">
                                    Chưa có hạng mục nào ghi nhận thực hiện.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Phần 5: Các điểm cần báo cáo thêm */}
                    <div className={`rounded-xl border p-5 shadow-sm ${lateRows.length > 0
                            ? 'border-red-200 bg-red-50/20 dark:border-red-900/30 dark:bg-red-950/10'
                            : 'border-emerald-200 bg-emerald-50/20 dark:border-emerald-900/30 dark:bg-emerald-950/10'
                        }`}>
                        <div className={`mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider ${lateRows.length > 0 ? 'text-red-650 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                            }`}>
                            <AlertTriangle size={14} />
                            Các điểm cần báo cáo thêm
                        </div>
                        <div className="space-y-2.5">
                            {lateRows.length > 0 ? (
                                lateRows.map((row, idx) => (
                                    <div key={idx} className="flex items-center justify-between gap-3 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                                            <span className="font-extrabold text-slate-900 dark:text-white truncate">
                                                {row.task.name}
                                            </span>
                                        </div>
                                        <span className="font-extrabold text-xs shrink-0 text-red-650 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/30 px-2 py-0.5 rounded shadow-sm">
                                            {formatDayDelta(row.dayDelta).toLowerCase()}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400 pl-4">
                                    Hiện chưa ghi nhận hạng mục lá nào chậm theo dữ liệu tiến độ hiện tại.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const progressDelta = scheduleReport.actualProgress - scheduleReport.plannedProgress;
    const projectDeltaTone = scheduleReport.projectDayDelta > 0 ? 'red' : scheduleReport.projectDayDelta < 0 ? 'emerald' : 'slate';
    const progressDeltaTone = progressDelta < -5 ? 'red' : progressDelta > 5 ? 'cyan' : 'slate';
    const spiDurationTone = scheduleReport.projection.spiDeltaDays === null
        ? 'slate'
        : scheduleReport.projection.spiDeltaDays > 0
            ? 'red'
            : scheduleReport.projection.spiDeltaDays < 0
                ? 'emerald'
                : 'slate';

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700/60 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="px-3 py-2">
                    <div className="text-sm font-black text-slate-800 dark:text-white">Báo cáo dự án</div>
                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400">Tiến độ kế hoạch/thực tế và nhật ký công trường</div>
                </div>
                <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
                    <button
                        type="button"
                        onClick={() => changeReportView('overview')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-black transition-colors ${activeReportView === 'overview' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <BarChart3 size={14} /> Tiến độ dự án
                    </button>
                    <button
                        type="button"
                        onClick={() => changeReportView('dailylog')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-black transition-colors ${activeReportView === 'dailylog' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-800' : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <Calendar size={14} /> Nhật ký công trường
                    </button>
                </div>
            </div>

            {activeReportView === 'dailylog' ? (
                <DailyLogSummaryReport
                    dailyLogs={dailyLogs}
                    projectId={projectId}
                    constructionSiteId={constructionSiteId}
                />
            ) : (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricTile
                            label="Kế hoạch gốc"
                            value={scheduleReport.projectDuration ? `${scheduleReport.projectDuration} ngày` : '-'}
                            sub={`${fmtDate(scheduleReport.projectStart)} - ${fmtDate(scheduleReport.projectEnd)}`}
                            icon={Calendar}
                        />
                        <MetricTile
                            label="SPI hôm nay"
                            value={scheduleReport.projection.spi === null ? '-' : fmtSpi(scheduleReport.projection.spi)}
                            sub={`KH ${fmtPercent(scheduleReport.plannedProgress)} · TT ${fmtPercent(scheduleReport.actualProgress)}, ${formatProgressDelta(progressDelta).toLowerCase()}`}
                            icon={Activity}
                            tone={progressDeltaTone}
                        />
                        <MetricTile
                            label="Dự báo theo nhịp hiện tại"
                            value={scheduleReport.projection.spiDurationDays !== null ? `${scheduleReport.projection.spiDurationDays} ngày` : '-'}
                            sub={formatNullableDayDelta(scheduleReport.projection.spiDeltaDays)}
                            icon={Clock}
                            tone={spiDurationTone}
                        />
                        <MetricTile
                            label="Dự báo mốc kết thúc"
                            value={fmtDate(scheduleReport.forecastProjectEnd)}
                            sub={`${formatDayDelta(scheduleReport.projectDayDelta)} · ${scheduleReport.lateRows.length} hạng mục cần lưu ý`}
                            icon={scheduleReport.projectDayDelta > 0 ? TrendingDown : TrendingUp}
                            tone={projectDeltaTone}
                        />
                    </div>

                    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                        <div className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${briefingCollapsed ? '' : 'border-b border-slate-100 dark:border-slate-700/60'
                            }`}>
                            <div>
                                <div className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-white">
                                    <Clipboard size={16} className="text-slate-500" />
                                    Tổng hợp nhanh báo cáo TGĐ
                                </div>
                                <p className="mt-1 text-xs font-bold text-slate-500">Tự động tổng hợp theo dữ liệu tiến độ đến ngày {fmtDate(todayIso)}.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setBriefingCollapsed(!briefingCollapsed)}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition-colors hover:bg-slate-50"
                                >
                                    {briefingCollapsed ? (
                                        <>
                                            <ChevronDown size={14} /> Mở rộng
                                        </>
                                    ) : (
                                        <>
                                            <ChevronUp size={14} /> Thu gọn
                                        </>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={copyBriefing}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition-colors hover:bg-slate-50"
                                >
                                    <Copy size={14} /> {briefingCopied ? 'Đã copy' : 'Copy'}
                                </button>
                                <button
                                    type="button"
                                    onClick={exportToExcel}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 transition-colors hover:bg-emerald-100"
                                >
                                    <Download size={14} /> Xuất Excel
                                </button>
                            </div>
                        </div>
                        {!briefingCollapsed && (
                            <div className="p-4">
                                {renderVisualBriefing()}
                            </div>
                        )}
                    </section>

                    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
                        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-700/60 xl:flex-row xl:items-center xl:justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-white">
                                    <FileText size={16} className="text-slate-500" />
                                    Bảng kế hoạch và thực tế
                                </div>
                                <p className="mt-1 text-xs font-bold text-slate-500">So sánh ngày kế hoạch, ngày thực tế, % kế hoạch đến hôm nay và dự báo lệch ngày.</p>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center w-full xl:w-auto xl:justify-end">
                                <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 max-w-full shrink-0">
                                    <Filter size={13} className="ml-2 shrink-0 text-slate-400" />
                                    {statusFilters.map(filter => (
                                        <button
                                            key={filter.key}
                                            type="button"
                                            onClick={() => changeStatusFilter(filter.key)}
                                            className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-black transition-colors ${statusFilter === filter.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                                }`}
                                        >
                                            {filter.label} <span className="text-slate-400">{filter.count}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={expandAll}
                                        className="shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:text-slate-900 transition-colors hover:bg-white"
                                    >
                                        <ChevronsDown size={13} className="text-slate-400" />
                                        Mở rộng hết
                                    </button>
                                    <div className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
                                    <button
                                        type="button"
                                        onClick={collapseAll}
                                        className="shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:text-slate-900 transition-colors hover:bg-white"
                                    >
                                        <ChevronsUp size={13} className="text-slate-400" />
                                        Thu gọn hết
                                    </button>
                                </div>
                                <label className="flex min-w-[240px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 shrink-0 sm:flex-1 md:flex-initial">
                                    <Search size={14} className="shrink-0 text-slate-400" />
                                    <input
                                        value={searchTerm}
                                        onChange={event => setSearchTerm(event.target.value)}
                                        placeholder="Tìm hạng mục, WBS, phụ trách..."
                                        className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="overflow-x-auto max-h-[650px] scrollbar-thin">
                            <table className="w-full min-w-[1120px] text-xs">
                                <thead className="sticky top-0 z-10 bg-gradient-to-r from-indigo-500 to-purple-500 text-[11px] font-bold uppercase tracking-wider text-white border-b border-indigo-400">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-bold whitespace-nowrap">Hạng mục</th>
                                        <th className="px-3 py-3 text-center font-bold whitespace-nowrap">KH bắt đầu</th>
                                        <th className="px-3 py-3 text-center font-bold whitespace-nowrap">KH kết thúc</th>
                                        <th className="px-3 py-3 text-right font-bold whitespace-nowrap">% KH</th>
                                        <th className="px-3 py-3 text-center font-bold whitespace-nowrap">TT bắt đầu</th>
                                        <th className="px-3 py-3 text-center font-bold whitespace-nowrap">TT/Dự kiến</th>
                                        <th className="px-3 py-3 text-right font-bold whitespace-nowrap">% TT</th>
                                        <th className="px-3 py-3 text-right font-bold whitespace-nowrap">Lệch ngày</th>
                                        <th className="px-3 py-3 text-center font-bold whitespace-nowrap">Trạng thái</th>
                                        <th className="px-4 py-3 text-left font-bold whitespace-nowrap">Ghi chú</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                                                Đang tải dữ liệu tiến độ...
                                            </td>
                                        </tr>
                                    ) : displayedRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                                                Chưa có hạng mục phù hợp với bộ lọc.
                                            </td>
                                        </tr>
                                    ) : displayedRows.map(row => {
                                        const StatusIcon = getStatusIcon(row.status);
                                        const isLate = row.dayDelta > 0 || row.status === 'late';
                                        const isAhead = row.dayDelta < 0 || row.status === 'ahead';
                                        const isParent = row.hasChildren;

                                        return (
                                            <tr
                                                key={row.task.id}
                                                className={`hover:bg-slate-50/70 dark:hover:bg-slate-900/40 ${isParent ? 'bg-slate-50/40 dark:bg-slate-800/10' : ''
                                                    }`}
                                            >
                                                <td className="px-4 py-3 align-top">
                                                    <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: row.level * 16 }}>
                                                        {row.hasChildren ? (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleCollapse(row.task.id);
                                                                }}
                                                                className="mt-0.5 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 shrink-0 flex items-center justify-center"
                                                                title={collapsedIds.has(row.task.id) ? 'Mở rộng' : 'Thu gọn'}
                                                            >
                                                                {collapsedIds.has(row.task.id) ? (
                                                                    <ChevronRight size={14} />
                                                                ) : (
                                                                    <ChevronDown size={14} />
                                                                )}
                                                            </button>
                                                        ) : (
                                                            <div className="w-5 h-5 shrink-0" />
                                                        )}
                                                        <span className="mt-0.5 w-12 shrink-0 text-[11px] font-black text-slate-400">{row.task.wbsCode || '-'}</span>
                                                        <div className="min-w-0">
                                                            <div className={`leading-5 ${isParent
                                                                    ? 'text-[13px] font-black text-slate-900 dark:text-white'
                                                                    : 'text-[12px] font-semibold text-slate-700 dark:text-slate-200'
                                                                }`}>
                                                                {row.task.name}
                                                            </div>
                                                            <div className="mt-0.5 text-[11px] font-bold text-slate-400">
                                                                {row.plannedDays} ngày KH{row.task.assignee ? ` · ${row.task.assignee}` : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-center align-top font-bold text-slate-600">{fmtDate(row.task.startDate)}</td>
                                                <td className="px-3 py-3 text-center align-top font-bold text-slate-600">{fmtDate(row.task.endDate)}</td>
                                                <td className="px-3 py-3 text-right align-top">
                                                    <span className="font-black text-slate-700">{fmtPercent(row.plannedPercent)}</span>
                                                </td>
                                                <td className="px-3 py-3 text-center align-top font-bold text-slate-600">
                                                    {row.actualStart ? fmtDate(row.actualStart) : row.actualProgress > 0 ? 'Chưa nhập' : '-'}
                                                </td>
                                                <td className="px-3 py-3 text-center align-top">
                                                    <div className="font-bold text-slate-700">{fmtDate(row.actualProgress >= 100 ? (row.actualEnd || row.forecastEnd) : row.forecastEnd)}</div>
                                                    <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.endBasisLabel}</div>
                                                </td>
                                                <td className="px-3 py-3 text-right align-top">
                                                    <div className="font-black text-slate-900">{fmtPercent(row.actualProgress)}</div>
                                                    <div className={`mt-0.5 text-[10px] font-bold ${row.progressDelta < -5 ? 'text-red-600' : row.progressDelta > 5 ? 'text-cyan-700' : 'text-slate-400'}`}>
                                                        {row.progressDelta > 0 ? '+' : ''}{Math.round(row.progressDelta)} điểm %
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-right align-top">
                                                    <span className={`font-black ${isLate ? 'text-red-600' : isAhead ? 'text-cyan-700' : 'text-slate-700'}`}>
                                                        {formatDayDelta(row.dayDelta)}
                                                    </span>
                                                    {row.startDelta > 0 && (
                                                        <div className="mt-0.5 text-[10px] font-bold text-amber-600">BĐ chậm {row.startDelta} ngày</div>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 text-center align-top">
                                                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black ${getStatusClass(row.status)}`}>
                                                        <StatusIcon size={12} />
                                                        {getStatusLabel(row.status)}
                                                    </span>
                                                </td>
                                                <td className="max-w-[260px] px-4 py-3 align-top">
                                                    <div className="line-clamp-2 font-semibold leading-5 text-slate-600" title={row.note === '-' ? '' : row.note}>
                                                        {row.note}
                                                    </div>
                                                    {row.delayDays > 0 && (
                                                        <div className="mt-1 text-[10px] font-black text-red-600">Nhật ký ghi nhận trễ {row.delayDays} ngày</div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
});

export default ReportTab;
