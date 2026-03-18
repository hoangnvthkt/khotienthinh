import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Plus, Edit2, Trash2, X, Save, ChevronRight, ChevronDown, Flag, GripVertical, ZoomIn, ZoomOut } from 'lucide-react';
import { ProjectTask } from '../../types';

interface GanttTabProps {
    constructionSiteId: string;
}

const COLORS = ['#f97316', '#0ea5e9', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#f43f5e', '#14b8a6'];

const daysBetween = (a: string, b: string) => {
    const d1 = new Date(a), d2 = new Date(b);
    return Math.ceil((d2.getTime() - d1.getTime()) / 86400000);
};

const addDays = (d: string, n: number) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().split('T')[0];
};

const formatDate = (d: string) => new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

const GanttTab: React.FC<GanttTabProps> = ({ constructionSiteId }) => {
    const [tasks, setTasks] = useState<ProjectTask[]>(() => {
        const saved = localStorage.getItem(`gantt_tasks_${constructionSiteId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<ProjectTask | null>(null);
    const [zoom, setZoom] = useState(28); // px per day
    const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
    const ganttRef = useRef<HTMLDivElement>(null);

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

    const save = (list: ProjectTask[]) => {
        setTasks(list);
        localStorage.setItem(`gantt_tasks_${constructionSiteId}`, JSON.stringify(list));
    };

    const resetForm = () => {
        setEditing(null);
        setFName(''); setFStart(''); setFEnd(''); setFProgress('0');
        setFAssignee(''); setFParentId(''); setFMilestone(false);
        setFNotes(''); setFColor('');
        setShowForm(false);
    };

    const openEdit = (t: ProjectTask) => {
        setEditing(t);
        setFName(t.name); setFStart(t.startDate); setFEnd(t.endDate);
        setFProgress(String(t.progress)); setFAssignee(t.assignee || '');
        setFParentId(t.parentId || ''); setFMilestone(t.isMilestone);
        setFNotes(t.notes || ''); setFColor(t.color || '');
        setShowForm(true);
    };

    const handleSave = () => {
        if (!fName || !fStart || !fEnd) return;
        const duration = daysBetween(fStart, fEnd);
        if (editing) {
            save(tasks.map(t => t.id === editing.id ? {
                ...editing, name: fName, startDate: fStart, endDate: fEnd, duration,
                progress: Number(fProgress), assignee: fAssignee || undefined,
                parentId: fParentId || undefined, isMilestone: fMilestone,
                notes: fNotes || undefined, color: fColor || undefined,
            } : t));
        } else {
            const nt: ProjectTask = {
                id: crypto.randomUUID(), constructionSiteId,
                name: fName, startDate: fStart, endDate: fEnd, duration,
                progress: Number(fProgress), assignee: fAssignee || undefined,
                parentId: fParentId || undefined, isMilestone: fMilestone,
                notes: fNotes || undefined, color: fColor || undefined,
                order: tasks.length,
            };
            save([...tasks, nt]);
        }
        resetForm();
    };

    const handleDelete = (id: string) => {
        if (confirm('Xoá hạng mục này?')) {
            save(tasks.filter(t => t.id !== id && t.parentId !== id));
        }
    };

    const updateProgress = (id: string, progress: number) => {
        save(tasks.map(t => t.id === id ? { ...t, progress: Math.max(0, Math.min(100, progress)) } : t));
    };

    // Build tree structure
    const taskTree = useMemo(() => {
        const roots = tasks.filter(t => !t.parentId).sort((a, b) => a.order - b.order);
        const getChildren = (parentId: string): ProjectTask[] =>
            tasks.filter(t => t.parentId === parentId).sort((a, b) => a.order - b.order);

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
    }, [tasks, collapsedParents]);

    // Timeline range
    const { timelineStart, timelineEnd, totalDays, months } = useMemo(() => {
        if (tasks.length === 0) {
            const now = new Date();
            const s = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const e = addDays(s, 90);
            return { timelineStart: s, timelineEnd: e, totalDays: 90, months: [] as { label: string; startDay: number; days: number }[] };
        }
        const dates = tasks.flatMap(t => [t.startDate, t.endDate]).sort();
        const s = addDays(dates[0], -7);
        const e = addDays(dates[dates.length - 1], 14);
        const td = daysBetween(s, e);

        // Build month markers
        const ms: { label: string; startDay: number; days: number }[] = [];
        const cur = new Date(s);
        while (cur <= new Date(e)) {
            const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
            const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
            const startDay = Math.max(0, daysBetween(s, monthStart.toISOString().split('T')[0]));
            const endDay = Math.min(td, daysBetween(s, monthEnd.toISOString().split('T')[0]));
            ms.push({
                label: `T${cur.getMonth() + 1}/${cur.getFullYear()}`,
                startDay,
                days: endDay - startDay + 1,
            });
            cur.setMonth(cur.getMonth() + 1);
        }
        return { timelineStart: s, timelineEnd: e, totalDays: td, months: ms };
    }, [tasks]);

    const toggleCollapse = (id: string) => {
        setCollapsedParents(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Overall progress
    const overallProgress = useMemo(() => {
        const roots = tasks.filter(t => !t.parentId);
        if (roots.length === 0) return 0;
        return Math.round(roots.reduce((s, t) => s + t.progress, 0) / roots.length);
    }, [tasks]);

    const todayOffset = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return daysBetween(timelineStart, today);
    }, [timelineStart]);

    return (
        <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Hạng mục</div>
                    <div className="text-2xl font-black text-slate-800">{tasks.length}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Tiến độ TB</div>
                    <div className="text-2xl font-black text-orange-600">{overallProgress}%</div>
                    <div className="mt-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${overallProgress}%` }} />
                    </div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Hoàn thành</div>
                    <div className="text-2xl font-black text-emerald-600">{tasks.filter(t => t.progress === 100).length}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Đang thực hiện</div>
                    <div className="text-2xl font-black text-blue-600">{tasks.filter(t => t.progress > 0 && t.progress < 100).length}</div>
                </div>
            </div>

            {/* Gantt Header */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">📊 Biểu đồ Gantt</h3>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setZoom(z => Math.max(10, z - 6))} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50"><ZoomOut size={14} /></button>
                        <span className="text-[10px] font-bold text-slate-400 w-10 text-center">{zoom}px</span>
                        <button onClick={() => setZoom(z => Math.min(60, z + 6))} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50"><ZoomIn size={14} /></button>
                        <button onClick={() => { resetForm(); setShowForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-all">
                            <Plus size={12} /> Thêm
                        </button>
                    </div>
                </div>

                {tasks.length === 0 ? (
                    <div className="p-12 text-center">
                        <Flag size={36} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-sm font-bold text-slate-400">Chưa có hạng mục nào</p>
                        <p className="text-xs text-slate-300 mt-1">Thêm hạng mục thi công để bắt đầu theo dõi tiến độ</p>
                    </div>
                ) : (
                    <div className="flex overflow-hidden" ref={ganttRef}>
                        {/* Left panel: task list */}
                        <div className="w-[280px] shrink-0 border-r border-slate-100 bg-slate-50/30">
                            {/* Header */}
                            <div className="h-[52px] flex items-center px-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                Hạng mục
                            </div>
                            {/* Task rows */}
                            {taskTree.map(({ task, level, hasChildren }) => (
                                <div key={task.id}
                                    className="h-[40px] flex items-center gap-1 px-2 border-b border-slate-50 hover:bg-slate-50/50 group text-xs"
                                    style={{ paddingLeft: `${8 + level * 16}px` }}>
                                    {hasChildren ? (
                                        <button onClick={() => toggleCollapse(task.id)} className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0">
                                            {collapsedParents.has(task.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                        </button>
                                    ) : (
                                        <span className="w-4 shrink-0" />
                                    )}
                                    {task.isMilestone && <Flag size={10} className="text-red-500 shrink-0" />}
                                    <span className="truncate font-bold text-slate-700 flex-1" title={task.name}>{task.name}</span>
                                    <span className="text-[9px] font-bold text-slate-400 shrink-0 w-8 text-right">{task.progress}%</span>
                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button onClick={() => openEdit(task)} className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={10} /></button>
                                        <button onClick={() => handleDelete(task.id)} className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={10} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Right panel: Gantt bars */}
                        <div className="flex-1 overflow-x-auto">
                            <div style={{ width: `${totalDays * zoom}px`, minWidth: '100%' }}>
                                {/* Month headers */}
                                <div className="h-[52px] flex border-b border-slate-100 relative">
                                    {months.map((m, i) => (
                                        <div key={i} className="absolute top-0 h-full flex flex-col justify-center border-r border-slate-100"
                                            style={{ left: `${m.startDay * zoom}px`, width: `${m.days * zoom}px` }}>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider px-2 truncate">{m.label}</span>
                                        </div>
                                    ))}
                                    {/* Today line in header */}
                                    {todayOffset >= 0 && todayOffset <= totalDays && (
                                        <div className="absolute top-0 h-full w-[2px] bg-red-500 z-10" style={{ left: `${todayOffset * zoom}px` }}>
                                            <div className="absolute -top-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-b bg-red-500 text-white text-[8px] font-bold whitespace-nowrap">
                                                Hôm nay
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Task bars */}
                                {taskTree.map(({ task, level }, idx) => {
                                    const left = daysBetween(timelineStart, task.startDate) * zoom;
                                    const width = Math.max(task.duration * zoom, zoom);
                                    const color = task.color || COLORS[idx % COLORS.length];

                                    return (
                                        <div key={task.id} className="h-[40px] relative border-b border-slate-50" style={{ width: `${totalDays * zoom}px` }}>
                                            {/* Today line continuation */}
                                            {todayOffset >= 0 && todayOffset <= totalDays && (
                                                <div className="absolute top-0 h-full w-[2px] bg-red-500/10 z-0" style={{ left: `${todayOffset * zoom}px` }} />
                                            )}

                                            {task.isMilestone ? (
                                                /* Milestone diamond */
                                                <div className="absolute top-1/2 -translate-y-1/2 z-10" style={{ left: `${left}px` }}>
                                                    <div className="w-5 h-5 rotate-45 bg-red-500 rounded-sm shadow-md" />
                                                </div>
                                            ) : (
                                                /* Task bar */
                                                <div className="absolute top-[8px] h-[24px] rounded-lg shadow-sm cursor-pointer group/bar transition-transform hover:scale-y-[1.15] z-10"
                                                    style={{ left: `${left}px`, width: `${width}px`, backgroundColor: `${color}30`, border: `2px solid ${color}` }}
                                                    title={`${task.name}: ${task.progress}% (${formatDate(task.startDate)} → ${formatDate(task.endDate)})`}
                                                    onClick={() => openEdit(task)}>
                                                    {/* Progress fill */}
                                                    <div className="absolute inset-0 rounded-md transition-all"
                                                        style={{ width: `${task.progress}%`, backgroundColor: color, opacity: 0.7 }} />
                                                    {/* Label */}
                                                    {width > 60 && (
                                                        <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold truncate z-10"
                                                            style={{ color: task.progress > 50 ? '#fff' : color }}>
                                                            {task.name}
                                                        </span>
                                                    )}
                                                    {/* Progress handle */}
                                                    <div className="absolute right-0 top-0 h-full w-3 cursor-col-resize opacity-0 group-hover/bar:opacity-100 flex items-center justify-center"
                                                        onMouseDown={e => {
                                                            e.stopPropagation();
                                                            const startX = e.clientX;
                                                            const startProgress = task.progress;
                                                            const onMove = (me: MouseEvent) => {
                                                                const dx = me.clientX - startX;
                                                                const dp = Math.round((dx / width) * 100);
                                                                updateProgress(task.id, startProgress + dp);
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
                    </div>
                )}
            </div>

            {/* Task Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={resetForm}>
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-orange-500 to-amber-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editing ? <><Edit2 size={18} /> Sửa hạng mục</> : <><Plus size={18} /> Thêm hạng mục</>}
                            </span>
                            <button onClick={resetForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên hạng mục</label>
                                <input value={fName} onChange={e => setFName(e.target.value)} placeholder="VD: Đào móng, Đổ bê tông..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Bắt đầu</label>
                                    <input type="date" value={fStart} onChange={e => setFStart(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Kết thúc</label>
                                    <input type="date" value={fEnd} onChange={e => setFEnd(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tiến độ: {fProgress}%</label>
                                    <input type="range" min={0} max={100} value={fProgress} onChange={e => setFProgress(e.target.value)}
                                        className="w-full accent-orange-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Người phụ trách</label>
                                    <input value={fAssignee} onChange={e => setFAssignee(e.target.value)} placeholder="Tên người phụ trách"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Thuộc hạng mục cha</label>
                                    <select value={fParentId} onChange={e => setFParentId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none">
                                        <option value="">— Không (gốc) —</option>
                                        {tasks.filter(t => t.id !== editing?.id).map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Màu sắc</label>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {COLORS.map(c => (
                                            <button key={c} onClick={() => setFColor(c)}
                                                className={`w-6 h-6 rounded-lg transition-all ${fColor === c ? 'ring-2 ring-offset-1 ring-slate-800 scale-110' : 'hover:scale-110'}`}
                                                style={{ backgroundColor: c }} />
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={fMilestone} onChange={e => setFMilestone(e.target.checked)}
                                        className="w-4 h-4 rounded accent-red-500" />
                                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1"><Flag size={12} className="text-red-500" /> Milestone (Mốc quan trọng)</span>
                                </label>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSave} disabled={!fName || !fStart || !fEnd}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editing ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GanttTab;
