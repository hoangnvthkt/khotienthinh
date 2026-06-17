import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
    X, Save, ChevronRight, ChevronDown, Search, Calendar, User, Clock, 
    AlertTriangle, CheckCircle2, HelpCircle, Loader2, ArrowUpRight, 
    ArrowDownRight, Folder, FolderOpen, ClipboardCheck, Sliders, PlayCircle
} from 'lucide-react';
import { 
    ProjectTask, DailyLog, ProjectWeeklyTaskProgress, ContractItem, 
    ProjectStaff, ProjectTaskCompletionRequest, PurchaseOrder, MaterialBudgetItem, 
    MaterialRequestFulfillmentBatch, ProjectTaskProgressMode, Attachment, TaskContractItem
} from '../../types';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { taskService, dailyLogService, poService, boqService } from '../../lib/projectService';
import { taskCompletionRequestService } from '../../lib/projectTaskCompletionService';
import { projectStaffService } from '../../lib/projectStaffService';
import { contractItemService } from '../../lib/contractItemService';
import { taskContractItemService } from '../../lib/taskContractItemService';
import { 
    projectWeeklyProgressService, getWeekStart, getISOWeekLabel, 
    getProjectScopeKey, calculateWeeklyConstructionProgress, calculateProjectValueProgress 
} from '../../lib/projectWeeklyProgressService';
import { deriveProjectTaskProgress, clampProgress } from '../../lib/projectScheduleRules';

interface WeeklyProgressTabProps {
    projectId?: string;
    constructionSiteId?: string;
    canManageTab: boolean;
}

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

const getWeekColor = (index: number) => {
    const hue = (index * 137.5) % 360;
    return `hsl(${hue}, 70%, 50%)`;
};

export default function WeeklyProgressTab({ projectId, constructionSiteId, canManageTab }: WeeklyProgressTabProps) {
    const { user, projectFinances } = useApp();
    const toast = useToast();
    const confirm = useConfirm();

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
    const [completionRequests, setCompletionRequests] = useState<ProjectTaskCompletionRequest[]>([]);
    const [allWeeklyProgress, setAllWeeklyProgress] = useState<ProjectWeeklyTaskProgress[]>([]);

    // Weekly chốt states
    const [selectedWeekStart, setSelectedWeekStart] = useState<string>(() => getWeekStart(new Date()));
    const [weeklyDrafts, setWeeklyDrafts] = useState<Record<string, { progressPercent: string; quantityDone: string; note: string }>>({});
    const [confirmedWeeklyOverrunKeys, setConfirmedWeeklyOverrunKeys] = useState<Set<string>>(new Set());
    const [savingWeeklyProgress, setSavingWeeklyProgress] = useState(false);

    // Filter states
    const [selectedFilterTaskId, setSelectedFilterTaskId] = useState<string>('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [dropdownSearch, setDropdownSearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Time filter states
    const [timeFilterMode, setTimeFilterMode] = useState<'all' | 'week' | 'month'>('all');
    const [filterWeek, setFilterWeek] = useState<string>('');
    const [filterMonth, setFilterMonth] = useState<string>('');

    // WBS Collapse state (default collapsed)
    const [weeklyCollapsedParents, setWeeklyCollapsedParents] = useState<Set<string>>(new Set());
    const hasInitializedCollapse = useRef(false);

    useEffect(() => {
        hasInitializedCollapse.current = false;
        setWeeklyCollapsedParents(new Set());
    }, [effectiveId]);

    // Task contract link maps
    const [taskContractLinks, setTaskContractLinks] = useState<Record<string, string[]>>({});

    // Load data
    const loadData = useCallback(async () => {
        if (!effectiveId) return;
        setLoading(true);
        try {
            const [
                taskData,
                logData,
                contractItemData,
                linkData,
                poData,
                boqData,
                fulfillmentBatchData,
                staffData,
                completionData,
                weeklyProgressData
            ] = await Promise.all([
                taskService.list(effectiveId, constructionSiteId || null),
                dailyLogService.list(effectiveId, constructionSiteId || null),
                contractItemService.listBySite(effectiveId, undefined, constructionSiteId || null),
                taskContractItemService.listBySite(effectiveId, constructionSiteId || null),
                poService.list(effectiveId, constructionSiteId || null),
                boqService.list(effectiveId, constructionSiteId || null),
                projectWeeklyProgressService.listFulfillmentBatchesByScope(effectiveId, constructionSiteId || null),
                projectId
                    ? projectStaffService.listByProject(projectId, constructionSiteId)
                    : constructionSiteId
                        ? projectStaffService.listBySite(constructionSiteId)
                        : Promise.resolve([]),
                taskCompletionRequestService.list(effectiveId, constructionSiteId || null),
                projectWeeklyProgressService.listAll(scopeKey)
            ]);

            setTasks(deriveProjectTaskProgress(taskData, completionData, logData));
            setDailyLogs(logData);
            setContractItems(contractItemData);
            setTaskContractLinkRows(linkData);
            setPurchaseOrders(poData);
            setMaterialBudgets(boqData);
            setFulfillmentBatches(fulfillmentBatchData);
            setProjectStaff(staffData);
            setCompletionRequests(completionData);
            setAllWeeklyProgress(weeklyProgressData);

            setTaskContractLinks(linkData.reduce<Record<string, string[]>>((acc, link) => {
                if (!acc[link.taskId]) acc[link.taskId] = [];
                acc[link.taskId].push(link.contractItemId);
                return acc;
            }, {}));
        } catch (error) {
            console.error('WeeklyProgressTab load error:', error);
            toast.error('Không thể tải dữ liệu tiến độ', 'Vui lòng kiểm tra lại kết nối mạng.');
        } finally {
            setLoading(false);
        }
    }, [effectiveId, constructionSiteId, projectId, scopeKey, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

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

    // unique week lists
    const uniqueWeeks = useMemo(() => {
        const weeksSet = new Set<string>();
        allWeeklyProgress.forEach(p => {
            if (p.weekStart) weeksSet.add(p.weekStart);
        });
        if (selectedWeekStart) {
            weeksSet.add(selectedWeekStart);
        }
        return Array.from(weeksSet).sort();
    }, [allWeeklyProgress, selectedWeekStart]);

    const weekColors = useMemo(() => {
        const colors: Record<string, string> = {};
        uniqueWeeks.forEach((week, idx) => {
            colors[week] = getWeekColor(idx);
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
            if (timeFilterMode === 'week') {
                return week <= filterWeek;
            }
            if (timeFilterMode === 'month') {
                return week.substring(0, 7) <= filterMonth;
            }
            return true;
        });
    }, [uniqueWeeks, timeFilterMode, filterWeek, filterMonth]);

    // Load drafts when weekStart changes
    useEffect(() => {
        if (!scopeKey || weeklyLeafTasks.length === 0) {
            setWeeklyDrafts({});
            return;
        }
        let cancelled = false;
        projectWeeklyProgressService.listLatestAtOrBefore(scopeKey, selectedWeekStart)
            .then(data => {
                if (cancelled) return;
                const nextDrafts: Record<string, { progressPercent: string; quantityDone: string; note: string }> = {};
                weeklyLeafTasks.forEach(task => {
                    const found = data.find(p => p.taskId === task.id);
                    if (found) {
                        const plannedQuantity = Number(task.provisionalQuantity || 0);
                        const defaultQuantityDone = plannedQuantity > 0 ? (plannedQuantity * found.progressPercent) / 100 : 0;
                        nextDrafts[task.id] = {
                            progressPercent: formatNumberInput(found.progressPercent, 2),
                            quantityDone: formatNumberInput(found.quantityDone ?? defaultQuantityDone, 2),
                            note: found.note || '',
                        };
                    } else {
                        const plannedQuantity = Number(task.provisionalQuantity || 0);
                        const currentProgress = parseWeeklyProgressPercent(task.progress);
                        const defaultQuantityDone = plannedQuantity > 0 ? (plannedQuantity * currentProgress) / 100 : 0;
                        nextDrafts[task.id] = {
                            progressPercent: formatNumberInput(currentProgress, 2),
                            quantityDone: formatNumberInput(defaultQuantityDone, 2),
                            note: '',
                        };
                    }
                });
                setWeeklyDrafts(nextDrafts);
            })
            .catch(error => {
                console.warn('Cannot load weekly progress drafts', error);
                if (!cancelled) setWeeklyDrafts({});
            });

        return () => {
            cancelled = true;
        };
    }, [scopeKey, selectedWeekStart, weeklyLeafTasks]);

    // Compute weekly history rollup for all tasks and all weeks
    const weeklyHistoryRollup = useMemo(() => {
        if (tasks.length === 0) return {};
        
        const history: Record<string, Record<string, { progress: number; note?: string; updatedBy?: string; updatedAt?: string }>> = {};
        const leafProgressMap = new Map<string, ProjectWeeklyTaskProgress>();
        
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
            
            const derived = deriveProjectTaskProgress(rawTasks, completionRequests, dailyLogs);
            
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
    }, [tasks, uniqueWeeks, allWeeklyProgress, completionRequests, dailyLogs]);

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
            deriveProjectTaskProgress(draftTasks, completionRequests, dailyLogs),
            taskContractLinkRows,
            contractItems,
        );
    }, [childCountByTaskId, completionRequests, contractItems, dailyLogs, taskContractLinkRows, tasks, weeklyConstructionProgress, weeklyDrafts, weeklyLeafTasks.length]);

    // Check project permissions
    const ensureProjectPermission = useCallback((action: 'edit' | 'admin', label: string): boolean => {
        if (user?.role === 'ADMIN') return true;
        if (canManageTab) return true;
        toast.warning('Không có quyền', `Bạn cần quyền quản trị hoặc sửa tab để thực hiện: ${label}.`);
        return false;
    }, [user, canManageTab, toast]);

    const updateWeeklyDraft = useCallback((taskId: string, patch: Partial<{ progressPercent: string; quantityDone: string; note: string }>) => {
        setWeeklyDrafts(prev => ({
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
            message: `Hạng mục "${task.name}" có tiến độ ${progressPercent}%. Bạn có chắc chắn muốn chốt tiến độ lớn hơn 100% không?`,
            confirmLabel: 'Đồng ý',
            cancelLabel: 'Huỷ',
            confirmTone: 'warning',
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

    // Save weekly progress chốt
    const handleSaveWeeklyProgress = useCallback(async () => {
        if (!ensureProjectPermission('edit', 'chốt tiến độ tuần')) return;
        if (!scopeKey || weeklyLeafTasks.length === 0) {
            toast.warning('Chưa có hạng mục', 'Cần có hạng mục WBS lá trước khi chốt tiến độ tuần.');
            return;
        }

        setSavingWeeklyProgress(true);
        try {
            const weeklyRows: ProjectWeeklyTaskProgress[] = weeklyLeafTasks.map(task => {
                const currentProgress = parseWeeklyProgressPercent(task.progress);
                const defaultQuantityDone = Number(task.provisionalQuantity || 0) > 0
                    ? (Number(task.provisionalQuantity) * currentProgress) / 100
                    : 0;
                const draft = weeklyDrafts[task.id] || { progressPercent: String(currentProgress), quantityDone: String(defaultQuantityDone), note: '' };
                const progressPercent = parseWeeklyProgressPercent(draft.progressPercent);
                return {
                    scopeKey,
                    projectId: projectId || null,
                    constructionSiteId: constructionSiteId || null,
                    taskId: task.id,
                    weekStart: selectedWeekStart,
                    progressPercent,
                    quantityDone: draft.quantityDone === ''
                        ? (Number(task.provisionalQuantity || 0) > 0 ? (Number(task.provisionalQuantity) * progressPercent) / 100 : 0)
                        : parseNonNegativeNumber(draft.quantityDone),
                    note: draft.note?.trim() || null,
                    attachments: [],
                    updatedBy: user?.id || null,
                };
            });

            await projectWeeklyProgressService.upsertMany(weeklyRows);
            
            // Sync tasks
            const progressByTask = new Map(weeklyRows.map(row => [row.taskId, row]));
            const rawNextTasks = tasks.map(task => {
                const row = progressByTask.get(task.id);
                if (!row) return task;
                return {
                    ...task,
                    progress: row.progressPercent,
                    progressMode: 'weekly_report' as ProjectTaskProgressMode,
                };
            });
            const nextTasks = deriveProjectTaskProgress(rawNextTasks, completionRequests, dailyLogs);
            const changedTasks = nextTasks.filter(next => {
                const prev = tasks.find(task => task.id === next.id);
                return !!prev && (
                    prev.progress !== next.progress ||
                    prev.progressMode !== next.progressMode ||
                    prev.gateStatus !== next.gateStatus ||
                    prev.actualEndDate !== next.actualEndDate
                );
            });
            if (changedTasks.length > 0) await taskService.upsertMany(changedTasks);
            
            setTasks(nextTasks);
            const constructionProgress = calculateWeeklyConstructionProgress(nextTasks, taskContractLinkRows, contractItems);
            
            await projectWeeklyProgressService.upsertSnapshot({
                scopeKey,
                projectId: projectId || null,
                constructionSiteId: constructionSiteId || null,
                weekStart: selectedWeekStart,
                constructionProgressPercent: constructionProgress,
                valueMetric: valueProgressMetric,
                progressMode: 'weekly_report',
                ganttPercent: constructionProgress, // or standard gantt percent
            });

            // Reload all weekly progress to refresh visual segments
            const weeklyProgressData = await projectWeeklyProgressService.listAll(scopeKey);
            setAllWeeklyProgress(weeklyProgressData);

            toast.success('Đã chốt tiến độ tuần', `${getISOWeekLabel(selectedWeekStart)} · Tiến độ thi công ${constructionProgress}% · Theo giá trị ${valueProgressMetric.valueProgressPercent}%`);
        } catch (error: any) {
            console.error(error);
            toast.error('Không thể chốt tiến độ tuần', error?.message || 'Vui lòng thử lại.');
        } finally {
            setSavingWeeklyProgress(false);
        }
    }, [
        completionRequests,
        constructionSiteId,
        contractItems,
        dailyLogs,
        ensureProjectPermission,
        projectId,
        scopeKey,
        selectedWeekStart,
        taskContractLinkRows,
        tasks,
        toast,
        user?.id,
        valueProgressMetric,
        weeklyDrafts,
        weeklyLeafTasks,
    ]);

    // Flatten tree construction based on collapse and filter states
    const dropdownTasks = useMemo(() => {
        return tasks.sort((a, b) => {
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
        const segments = useMemo(() => {
            const list: Array<{
                week: string;
                weekLabel: string;
                percent: number;
                cumulativeProgress: number;
                addedProgress: number;
                color: string;
                note?: string;
                by?: string;
                date?: string;
            }> = [];
            
            let lastProgress = 0;
            
            // Walk through visibleWeeks
            for (const week of visibleWeeks) {
                const weekData = weeklyHistoryRollup[week]?.[taskId];
                const currentProgress = weekData ? weekData.progress : lastProgress;
                const addedProgress = currentProgress - lastProgress;
                
                if (addedProgress > 0) {
                    const staffName = weekData?.updatedBy ? (staffMap.get(weekData.updatedBy) || weekData.updatedBy) : '';
                    list.push({
                        week,
                        weekLabel: getISOWeekLabel(week),
                        percent: addedProgress,
                        cumulativeProgress: currentProgress,
                        addedProgress,
                        color: weekColors[week] || '#94a3b8',
                        note: weekData?.note || undefined,
                        by: staffName || undefined,
                        date: weekData?.updatedAt ? new Date(weekData.updatedAt).toLocaleDateString('vi-VN') : undefined,
                    });
                }
                lastProgress = currentProgress;
            }
            
            return list;
        }, [taskId]);

        const totalProgress = useMemo(() => {
            if (segments.length === 0) return 0;
            return segments[segments.length - 1].cumulativeProgress;
        }, [segments]);

        return (
            <div className="relative w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible flex items-center">
                {segments.map((seg, idx) => (
                    <div 
                        key={seg.week} 
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
                                <Calendar size={11} /> {seg.weekLabel}
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
                            {seg.date && (
                                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                                    <span>Ngày chốt:</span>
                                    <span>{seg.date}</span>
                                </div>
                            )}
                            {seg.by && (
                                <div className="flex justify-between text-[10px] text-slate-400">
                                    <span>Người chốt:</span>
                                    <span className="font-medium truncate max-w-[100px]">{seg.by}</span>
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

    if (loading) {
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
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-100 dark:border-slate-700/60 shadow-sm space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Searchable Select for WBS */}
                    <div className="flex-1 min-w-0 space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Chọn hạng mục WBS cần xem/nhập</label>
                        <div ref={dropdownRef} className="relative w-full max-w-md">
                            <button
                                type="button"
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:border-slate-300 transition-colors"
                            >
                                <div className="flex items-center gap-2 truncate">
                                    <Sliders size={15} className="text-orange-500 shrink-0" />
                                    <span className="truncate">
                                        {activeFilterTask 
                                            ? `[${activeFilterTask.wbsCode}] ${activeFilterTask.name}` 
                                            : '— Hiển thị toàn bộ hạng mục —'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
                                    {selectedFilterTaskId && (
                                        <X 
                                            size={14} 
                                            className="hover:text-slate-600 cursor-pointer" 
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
                                <div className="absolute left-0 right-0 mt-2 z-50 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-2 max-h-[300px] flex flex-col">
                                    <div className="relative mb-2 shrink-0">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={dropdownSearch}
                                            onChange={e => setDropdownSearch(e.target.value)}
                                            placeholder="Tìm mã WBS hoặc tên..."
                                            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                    </div>
                                    <div className="overflow-y-auto flex-1 divide-y divide-slate-50 dark:divide-slate-800/40">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedFilterTaskId('');
                                                setDropdownOpen(false);
                                                setDropdownSearch('');
                                            }}
                                            className="w-full text-left px-3 py-2 text-xs font-black text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
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
                                                className={`w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-start gap-2 ${
                                                    selectedFilterTaskId === t.id ? 'bg-orange-50 dark:bg-orange-950/20 text-orange-600 font-black' : 'text-slate-700 dark:text-slate-300 font-bold'
                                                }`}
                                            >
                                                <span className="font-mono text-indigo-500 shrink-0 w-[50px]">{t.wbsCode}</span>
                                                <span className="truncate">{t.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Week Selection & Save button */}
                    <div className="flex items-end justify-end gap-3 flex-wrap">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Chọn tuần chốt tiến độ</label>
                            <input
                                type="date"
                                value={selectedWeekStart}
                                onChange={e => {
                                    if (e.target.value) setSelectedWeekStart(getWeekStart(e.target.value));
                                }}
                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-black bg-transparent focus:ring-2 focus:ring-orange-500 outline-none text-slate-700 dark:text-slate-200"
                                title="Tuần chốt"
                            />
                        </div>
                        
                        <button
                            onClick={handleSaveWeeklyProgress}
                            disabled={savingWeeklyProgress || weeklyLeafTasks.length === 0}
                            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-md shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {savingWeeklyProgress ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            Chốt tiến độ {getISOWeekLabel(selectedWeekStart)}
                        </button>
                    </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-700 my-2"></div>

                {/* Sub-Filters for History Visualisation */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-black text-slate-400 uppercase">Bộ lọc Biểu đồ Snapshots:</span>
                        <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                            {[
                                { key: 'all', label: 'Toàn bộ thời gian' },
                                { key: 'week', label: 'Lũy kế theo Tuần' },
                                { key: 'month', label: 'Lũy kế theo Tháng' },
                            ].map(btn => (
                                <button
                                    key={btn.key}
                                    onClick={() => setTimeFilterMode(btn.key as any)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                                        timeFilterMode === btn.key 
                                            ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm' 
                                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
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
                                className="text-xs font-bold text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-orange-500 outline-none"
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
                                className="text-xs font-bold text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-orange-500 outline-none"
                            >
                                {uniqueMonths.map(m => (
                                    <option key={m} value={m}>Tháng {m}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Expand / Collapse all toggles */}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                const parentIds = new Set<string>();
                                tasks.forEach(t => {
                                    if (t.parentId) parentIds.add(t.parentId);
                                });
                                setWeeklyCollapsedParents(parentIds);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-[10px] font-black text-slate-500 transition-all"
                        >
                            Thu gọn hết
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeeklyCollapsedParents(new Set())}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-[10px] font-black text-slate-500 transition-all"
                        >
                            Mở rộng hết
                        </button>
                    </div>
                </div>
            </div>

            {/* Quick KPI stats cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Thi công tuần này', value: `${draftWeeklyConstructionProgress}%`, sub: `Chốt gốc: ${weeklyConstructionProgress}%`, tone: 'text-orange-600 border-orange-100 bg-orange-50/20 dark:bg-orange-950/10' },
                    { label: 'Tiến độ theo giá trị', value: `${valueProgressMetric.valueProgressPercent}%`, sub: 'Tổng giá trị WBS tính lũy kế', tone: 'text-emerald-600 border-emerald-100 bg-emerald-50/20 dark:bg-emerald-950/10' },
                    { label: 'Đơn hàng PO hợp lệ', value: formatMoneyShort(valueProgressMetric.purchasedValue), sub: 'Ghi nhận từ PO đã duyệt', tone: 'text-blue-600 border-blue-100 bg-blue-50/20 dark:bg-blue-950/10' },
                    { label: 'Vật tư đã cấp', value: formatMoneyShort(valueProgressMetric.issuedValue), sub: 'Ghi nhận thực cấp từ kho', tone: 'text-violet-600 border-violet-100 bg-violet-50/20 dark:bg-violet-950/10' },
                ].map((item, idx) => (
                    <div key={idx} className={`rounded-2xl p-5 border shadow-sm ${item.tone} transition-all hover:scale-[1.02]`}>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{item.label}</div>
                        <div className="mt-1 text-xl font-black">{item.value}</div>
                        <div className="text-[10px] text-slate-400 mt-1 font-bold">{item.sub}</div>
                    </div>
                ))}
            </div>

            {/* Tree WBS Table */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
                    <table className="w-full min-w-[960px] text-xs">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-700 z-10">
                            <tr className="text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-700">
                                <th className="px-4 py-3 text-left w-[100px]">WBS Code</th>
                                <th className="px-4 py-3 text-left w-[300px]">Hạng mục thi công (WBS)</th>
                                <th className="px-4 py-3 text-left">Biểu đồ Snapshot tiến độ theo tuần (Gốc 100%)</th>
                                <th className="px-4 py-3 text-right w-[110px]">% hoàn thành</th>
                                <th className="px-4 py-3 text-right w-[130px]">Khối lượng hoàn thành</th>
                                <th className="px-4 py-3 text-left w-[220px]">Ghi chú chốt tuần</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                            {wbsTreeRows.map(task => {
                                const isParent = task.hasChildren;
                                const isCollapsed = weeklyCollapsedParents.has(task.id);
                                const draft = weeklyDrafts[task.id] || { progressPercent: String(task.progress || 0), quantityDone: '0', note: '' };
                                const linkedIds = taskContractLinks[task.id] || [];
                                const draftProgress = parseWeeklyProgressPercent(draft.progressPercent);
                                const isOverProgress = draftProgress > 100;
                                
                                return (
                                    <tr 
                                        key={task.id} 
                                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors ${
                                            isParent ? 'bg-slate-50/20 dark:bg-slate-800/10 font-bold' : ''
                                        } ${isOverProgress ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}
                                    >
                                        {/* WBS Code */}
                                        <td className="px-4 py-3 font-mono font-black text-indigo-500 text-[11px]">
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
                                                        className="w-5 h-5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                                                    >
                                                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                    </button>
                                                ) : (
                                                    <span className="w-5 h-5 inline-block shrink-0" />
                                                )}

                                                <span className="text-slate-400 shrink-0">
                                                    {isParent 
                                                        ? (isCollapsed ? <Folder size={14} className="text-amber-500" /> : <FolderOpen size={14} className="text-amber-500" />)
                                                        : <PlayCircle size={13} className="text-indigo-400" />
                                                    }
                                                </span>

                                                <span 
                                                    className={`truncate block ${isParent ? 'text-slate-800 dark:text-slate-100 font-bold' : 'text-slate-600 dark:text-slate-300'}`}
                                                    title={task.name}
                                                >
                                                    {task.name}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Weekly progress snapshot bar */}
                                        <td className="px-4 py-3 min-w-[200px]">
                                            <WeeklySegmentedProgressBar taskId={task.id} />
                                        </td>

                                        {/* Percent Input/Text */}
                                        <td className="px-4 py-3">
                                            {isParent ? (
                                                <div className="text-right text-xs font-bold text-slate-400 pr-2">
                                                    {task.progress}%
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        value={draft.progressPercent}
                                                        onChange={e => { void updateWeeklyProgressPercent(task, e.target.value); }}
                                                        className={`w-full pl-2 pr-6 py-1 rounded-xl border text-right font-black bg-transparent text-[11px] focus:ring-2 outline-none ${
                                                            isOverProgress 
                                                                ? 'border-red-200 text-red-600 bg-red-50/60 focus:ring-red-400' 
                                                                : 'border-slate-200 dark:border-slate-700 focus:ring-orange-500 text-slate-800 dark:text-slate-200'
                                                        }`}
                                                    />
                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-slate-400 pointer-events-none">%</span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Quantity Completed Input/Text */}
                                        <td className="px-4 py-3">
                                            {isParent ? (
                                                <div className="text-right text-xs font-bold text-slate-400 pr-2">
                                                    —
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 justify-end">
                                                    <input
                                                        type="text"
                                                        value={draft.quantityDone}
                                                        onChange={e => { void updateWeeklyQuantityDone(task, e.target.value); }}
                                                        className={`w-full max-w-[85px] px-2 py-1 rounded-xl border text-right font-black bg-transparent text-[11px] focus:ring-2 outline-none ${
                                                            isOverProgress 
                                                                ? 'border-red-200 text-red-600 bg-red-50/60 focus:ring-red-400' 
                                                                : 'border-slate-200 dark:border-slate-700 focus:ring-orange-500 text-slate-800 dark:text-slate-200'
                                                        }`}
                                                    />
                                                    <span className="text-[10px] font-bold text-slate-400 shrink-0 truncate max-w-[40px]" title={getTaskUnit(task, linkedIds, contractItems)}>
                                                        {getTaskUnit(task, linkedIds, contractItems)}
                                                    </span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Notes */}
                                        <td className="px-4 py-3">
                                            {isParent ? (
                                                <div className="text-slate-400 text-[10px] italic">
                                                    Tự động cộng dồn
                                                </div>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={draft.note}
                                                    onChange={e => updateWeeklyDraft(task.id, { note: e.target.value })}
                                                    placeholder="Ghi chú chốt tuần..."
                                                    className="w-full px-2 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-[11px] outline-none focus:ring-2 focus:ring-orange-500 text-slate-800 dark:text-slate-200"
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
        </div>
    );
}
