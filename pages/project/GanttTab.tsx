import React, { useState, useMemo, useRef, useEffect } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import {
    Plus, Edit2, Trash2, X, Save, ChevronRight, ChevronDown, Flag,
    ZoomIn, ZoomOut, LayoutList, BarChart3, Columns, Search,
    Filter, Calendar, User, Clock, AlertTriangle, CheckCircle2,
    Circle, PlayCircle, ArrowUpDown, ChevronUp, Copy
} from 'lucide-react';
import { ProjectTask } from '../../types';
import { taskService } from '../../lib/projectService';

interface GanttTabProps {
    constructionSiteId: string;
}

// ============= CONSTANTS =============
const COLORS = ['#f97316', '#0ea5e9', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#f43f5e', '#14b8a6'];

type ViewMode = 'table' | 'gantt' | 'split';
type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';
type SortField = 'name' | 'startDate' | 'endDate' | 'progress' | 'assignee' | 'status';
type SortDir = 'asc' | 'desc';

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
    if (t.progress >= 100) return 'completed';
    const now = today();
    if (t.endDate < now && t.progress < 100) return 'overdue';
    if (t.progress > 0) return 'in_progress';
    return 'not_started';
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; icon: any }> = {
    not_started: { label: 'Chưa bắt đầu', color: 'text-slate-500', bg: 'bg-slate-100', icon: Circle },
    in_progress: { label: 'Đang thực hiện', color: 'text-blue-600', bg: 'bg-blue-50', icon: PlayCircle },
    completed: { label: 'Hoàn thành', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle2 },
    overdue: { label: 'Trễ hạn', color: 'text-red-600', bg: 'bg-red-50', icon: AlertTriangle },
};

// ============= COMPONENTS =============

/** Status Badge */
const StatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
    const cfg = STATUS_CONFIG[status];
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.color} ${cfg.bg}`}>
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
const GanttTab: React.FC<GanttTabProps> = ({ constructionSiteId }) => {
    // Data
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        taskService.list(constructionSiteId).then(data => { setTasks(data); setLoading(false); }).catch(e => { console.error(e); setLoading(false); });
    }, [constructionSiteId]);

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

    // Form state
    const [fName, setFName] = useState('');
    const [fStart, setFStart] = useState('');
    const [fEnd, setFEnd] = useState('');
    const [fProgress, setFProgress] = useState('0');
    const [fAssignee, setFAssignee] = useState('');
    const [fParentId, setFParentId] = useState('');
    const [fMilestone, setFMilestone] = useState(false);
    const [fNotes, setFNotes] = useState('');
    const [fColor, setFColor] = useState('');

    // ====== CRUD operations ======
    const resetForm = () => {
        setEditing(null); setFName(''); setFStart(''); setFEnd(''); setFProgress('0');
        setFAssignee(''); setFParentId(''); setFMilestone(false); setFNotes(''); setFColor('');
        setShowForm(false);
    };

    const openAdd = (parentId?: string) => {
        resetForm();
        if (parentId) setFParentId(parentId);
        const t = today();
        setFStart(t);
        setFEnd(addDays(t, 14));
        setShowForm(true);
    };

    const openEdit = (t: ProjectTask) => {
        setEditing(t);
        setFName(t.name); setFStart(t.startDate); setFEnd(t.endDate);
        setFProgress(String(t.progress)); setFAssignee(t.assignee || '');
        setFParentId(t.parentId || ''); setFMilestone(t.isMilestone);
        setFNotes(t.notes || ''); setFColor(t.color || '');
        setShowForm(true);
    };

    const duplicateTask = (t: ProjectTask) => {
        setEditing(null);
        setFName(t.name + ' (Bản sao)'); setFStart(t.startDate); setFEnd(t.endDate);
        setFProgress('0'); setFAssignee(t.assignee || '');
        setFParentId(t.parentId || ''); setFMilestone(t.isMilestone);
        setFNotes(t.notes || ''); setFColor(t.color || '');
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!fName || !fStart || !fEnd) return;
        const duration = daysBetween(fStart, fEnd);
        const item: ProjectTask = editing ? {
            ...editing, name: fName, startDate: fStart, endDate: fEnd, duration,
            progress: Number(fProgress), assignee: fAssignee || undefined,
            parentId: fParentId || undefined, isMilestone: fMilestone,
            notes: fNotes || undefined, color: fColor || undefined,
        } : {
            id: crypto.randomUUID(), constructionSiteId,
            name: fName, startDate: fStart, endDate: fEnd, duration,
            progress: Number(fProgress), assignee: fAssignee || undefined,
            parentId: fParentId || undefined, isMilestone: fMilestone,
            notes: fNotes || undefined, color: fColor || undefined,
            order: tasks.length,
        };
        await taskService.upsert(item);
        setTasks(await taskService.list(constructionSiteId));
        resetForm();
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const children = tasks.filter(t => t.parentId === deleteTarget.id);
        for (const c of children) await taskService.remove(c.id);
        await taskService.remove(deleteTarget.id);
        setTasks(await taskService.list(constructionSiteId));
        setDeleteTarget(null);
    };

    const updateProgress = async (id: string, progress: number) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const updated = { ...task, progress: Math.max(0, Math.min(100, progress)) };
        await taskService.upsert(updated);
        setTasks(prev => prev.map(t => t.id === id ? updated : t));
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
        const completed = tasks.filter(t => t.progress >= 100).length;
        const inProgress = tasks.filter(t => t.progress > 0 && t.progress < 100).length;
        const overdue = tasks.filter(t => getStatus(t) === 'overdue').length;
        const avgProgress = total > 0 ? Math.round(tasks.filter(t => !t.parentId).reduce((s, t) => s + t.progress, 0) / tasks.filter(t => !t.parentId).length) : 0;
        return { total, completed, inProgress, overdue, avgProgress };
    }, [tasks]);

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
                    <p className="text-xs text-slate-400 mt-0.5">{stats.total} hạng mục • Tiến độ TB: {stats.avgProgress}%</p>
                </div>
                <div className="flex items-center gap-2">
                    <AiInsightPanel module="gantt" siteId={constructionSiteId} />
                    <button onClick={() => openAdd()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20 hover:shadow-xl hover:scale-[1.02] transition-all">
                        <Plus size={14} /> Thêm hạng mục
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                    { label: 'Tổng hạng mục', value: stats.total, color: 'text-slate-800', icon: '📋' },
                    { label: 'Tiến độ TB', value: `${stats.avgProgress}%`, color: 'text-orange-600', icon: '📈', bar: stats.avgProgress },
                    { label: 'Hoàn thành', value: stats.completed, color: 'text-emerald-600', icon: '✅' },
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
                                { mode: 'table' as ViewMode, icon: LayoutList, label: 'Bảng' },
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
                                <option value="completed">Hoàn thành</option>
                                <option value="overdue">Trễ hạn</option>
                            </select>
                            <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Right: Zoom (for gantt) */}
                    {viewMode !== 'table' && (
                        <div className="flex items-center gap-1">
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
                    <div className="flex overflow-hidden">
                        {/* ====== TABLE VIEW ====== */}
                        {(viewMode === 'table' || viewMode === 'split') && (
                            <div className={`${viewMode === 'split' ? 'w-[520px] shrink-0 border-r border-slate-100 dark:border-slate-700' : 'flex-1'} overflow-auto`}>
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-slate-50/80 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-3 py-2.5 text-left">
                                                <button onClick={() => handleSort('name')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    Hạng mục <SortIcon field="name" />
                                                </button>
                                            </th>
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[85px]">
                                                <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    T.Thái <SortIcon field="status" />
                                                </button>
                                            </th>
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[80px]">
                                                <button onClick={() => handleSort('startDate')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    Bắt đầu <SortIcon field="startDate" />
                                                </button>
                                            </th>
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[80px]">
                                                <button onClick={() => handleSort('endDate')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    Kết thúc <SortIcon field="endDate" />
                                                </button>
                                            </th>
                                            <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[130px]">
                                                <button onClick={() => handleSort('progress')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                    Tiến độ <SortIcon field="progress" />
                                                </button>
                                            </th>
                                            {viewMode === 'table' && (
                                                <th className="sticky top-0 bg-slate-50/95 dark:bg-slate-700/95 px-2 py-2.5 text-left w-[100px]">
                                                    <button onClick={() => handleSort('assignee')} className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
                                                        Phụ trách <SortIcon field="assignee" />
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
                                            return (
                                                <tr key={task.id}
                                                    className={`border-b border-slate-50 dark:border-slate-700/50 hover:bg-orange-50/30 dark:hover:bg-slate-700/30 group transition-colors ${status === 'overdue' ? 'bg-red-50/20' : ''}`}>
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
                                                        </div>
                                                    </td>
                                                    {/* Status */}
                                                    <td className="px-2 py-2.5"><StatusBadge status={status} /></td>
                                                    {/* Dates */}
                                                    <td className="px-2 py-2.5 text-slate-500 font-medium">{fmtShort(task.startDate)}</td>
                                                    <td className="px-2 py-2.5 text-slate-500 font-medium">{fmtShort(task.endDate)}</td>
                                                    {/* Progress */}
                                                    <td className="px-2 py-2.5">
                                                        <ProgressCell value={task.progress} onChange={v => updateProgress(task.id, v)} />
                                                    </td>
                                                    {/* Assignee (only in full table mode) */}
                                                    {viewMode === 'table' && (
                                                        <td className="px-2 py-2.5">
                                                            {task.assignee ? (
                                                                <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
                                                                    <User size={10} className="text-slate-400" /> {task.assignee}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-300">—</span>
                                                            )}
                                                        </td>
                                                    )}
                                                    {/* Actions */}
                                                    <td className="px-2 py-2.5">
                                                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
                            <div className="flex-1 overflow-x-auto">
                                <div style={{ width: `${totalDays * zoom}px`, minWidth: '100%' }}>
                                    {/* Month headers */}
                                    <div className="h-[42px] flex border-b border-slate-100 dark:border-slate-700 relative bg-slate-50/50 dark:bg-slate-700/30">
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
                                                <div key={task.id} className="h-[36px] flex items-center gap-1 px-2 border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 group text-xs"
                                                    style={{ paddingLeft: `${8 + level * 16}px` }}>
                                                    {hasChildren ? (
                                                        <button onClick={() => toggleCollapse(task.id)} className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-orange-500 shrink-0">
                                                            {collapsedParents.has(task.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                                        </button>
                                                    ) : <span className="w-4 shrink-0" />}
                                                    {task.isMilestone && <Flag size={10} className="text-red-500 shrink-0" />}
                                                    <span className="truncate font-bold text-slate-700 dark:text-slate-200 flex-1" title={task.name}>{task.name}</span>
                                                    <span className="text-[9px] font-bold text-slate-400 shrink-0 w-8 text-right">{task.progress}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Task bars */}
                                    {taskTree.map(({ task }, idx) => {
                                        const left = daysBetween(timelineStart, task.startDate) * zoom;
                                        const width = Math.max(task.duration * zoom, zoom);
                                        const color = task.color || COLORS[idx % COLORS.length];
                                        const status = getStatus(task);

                                        return (
                                            <div key={task.id} className="h-[36px] relative border-b border-slate-50 dark:border-slate-700/50" style={{ width: `${totalDays * zoom}px` }}>
                                                {todayOffset >= 0 && todayOffset <= totalDays && (
                                                    <div className="absolute top-0 h-full w-[2px] bg-red-500/10 z-0" style={{ left: `${todayOffset * zoom}px` }} />
                                                )}

                                                {task.isMilestone ? (
                                                    <div className="absolute top-1/2 -translate-y-1/2 z-10" style={{ left: `${left}px` }}>
                                                        <div className="w-4 h-4 rotate-45 rounded-sm shadow-md" style={{ backgroundColor: color }} />
                                                    </div>
                                                ) : (
                                                    <div className={`absolute top-[6px] h-[24px] rounded-lg shadow-sm cursor-pointer group/bar transition-all hover:scale-y-[1.15] hover:shadow-md z-10 ${status === 'overdue' ? 'ring-1 ring-red-400 ring-offset-1' : ''}`}
                                                        style={{ left: `${left}px`, width: `${width}px`, backgroundColor: `${color}20`, border: `2px solid ${color}` }}
                                                        title={`${task.name}: ${task.progress}% (${fmtShort(task.startDate)} → ${fmtShort(task.endDate)})`}
                                                        onClick={() => openEdit(task)}>
                                                        <div className="absolute inset-0 rounded-md transition-all" style={{ width: `${task.progress}%`, backgroundColor: color, opacity: 0.65 }} />
                                                        {width > 50 && (
                                                            <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold truncate z-10"
                                                                style={{ color: task.progress > 50 ? '#fff' : color }}>
                                                                {task.name}
                                                            </span>
                                                        )}
                                                        <div className="absolute right-0 top-0 h-full w-3 cursor-col-resize opacity-0 group-hover/bar:opacity-100 flex items-center justify-center"
                                                            onMouseDown={e => {
                                                                e.stopPropagation();
                                                                const startX = e.clientX;
                                                                const startProgress = task.progress;
                                                                const onMove = (me: MouseEvent) => {
                                                                    const dp = Math.round(((me.clientX - startX) / width) * 100);
                                                                    updateProgress(task.id, Math.round((startProgress + dp) / 5) * 5);
                                                                };
                                                                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
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
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

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

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Calendar size={10} /> Bắt đầu <span className="text-red-400">*</span></label>
                                    <input type="date" value={fStart} onChange={e => setFStart(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><Calendar size={10} /> Kết thúc <span className="text-red-400">*</span></label>
                                    <input type="date" value={fEnd} onChange={e => setFEnd(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
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
                                    <input type="range" min={0} max={100} step={5} value={fProgress} onChange={e => setFProgress(e.target.value)}
                                        className="w-full accent-orange-500" />
                                    <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                                        <span>0%</span><span>50%</span><span>100%</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5 flex items-center gap-1"><User size={10} /> Người phụ trách</label>
                                    <input value={fAssignee} onChange={e => setFAssignee(e.target.value)} placeholder="Tên người phụ trách"
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-transparent focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
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

                            {/* Milestone */}
                            <label className="flex items-center gap-2.5 cursor-pointer p-2.5 rounded-xl border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                <input type="checkbox" checked={fMilestone} onChange={e => setFMilestone(e.target.checked)}
                                    className="w-4 h-4 rounded accent-red-500" />
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1"><Flag size={12} className="text-red-500" /> Đánh dấu là Milestone (Mốc quan trọng)</span>
                            </label>

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
                    ? 'Hạng mục này có công việc con. Tất cả sẽ bị xoá.'
                    : 'Hành động này không thể hoàn tác.'}
                countdownSeconds={2}
            />
        </div>
    );
};

export default GanttTab;
