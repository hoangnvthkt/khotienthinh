import React, { useState, useMemo, useEffect, useCallback } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import { Plus, Edit2, Trash2, X, Save, Cloud, Sun, CloudRain, CloudLightning, Users, Calendar, AlertTriangle, Mic, MicOff, MapPin, Camera, Clock, Send, CheckCircle2, RotateCcw, LayoutList, ChevronLeft, ChevronRight } from 'lucide-react';
import { DailyLog, WeatherType, ProjectTask, DelayTaskEntry, DelayCategory, DailyLogVolume, DailyLogMaterial, DailyLogLabor, DailyLogMachine, ContractItem, DailyLogStatus } from '../../types';
import { supabase } from '../../lib/supabase';
import { dailyLogService, taskService } from '../../lib/projectService';
import { contractItemService } from '../../lib/contractItemService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { notificationService } from '../../lib/notificationService';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import DailyLogDetailTabs from '../../components/project/DailyLogDetailTabs';

interface DailyLogTabProps {
    constructionSiteId?: string;
    projectId?: string;
}

const WEATHER: Record<WeatherType, { label: string; icon: React.ReactNode; emoji: string }> = {
    sunny: { label: 'Nắng', icon: <Sun size={14} />, emoji: '☀️' },
    cloudy: { label: 'Mây', icon: <Cloud size={14} />, emoji: '⛅' },
    rainy: { label: 'Mưa', icon: <CloudRain size={14} />, emoji: '🌧️' },
    storm: { label: 'Bão', icon: <CloudLightning size={14} />, emoji: '⛈️' },
};

const STATUS_CFG: Record<DailyLogStatus, { label: string; cls: string }> = {
    draft: { label: 'Nháp', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
    submitted: { label: 'Chờ xác nhận', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    verified: { label: 'Đã xác nhận', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected: { label: 'Trả lại', cls: 'bg-red-50 text-red-700 border-red-200' },
};

const STATUS_DOT: Record<DailyLogStatus, string> = {
    draft: 'bg-slate-400',
    submitted: 'bg-amber-500',
    verified: 'bg-emerald-500',
    rejected: 'bg-red-500',
};

const DAILY_LOG_STATUS_PERMISSION: Partial<Record<DailyLogStatus, ProjectPermissionCode>> = {
    submitted: 'submit',
    verified: 'verify',
    rejected: 'verify',
};

const ALL_DAILY_LOG_PERMISSION_CODES: ProjectPermissionCode[] = ['edit', 'submit', 'verify'];

const toDateKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const monthKeyFromDate = (date: Date): string => toDateKey(date).slice(0, 7);

const shiftMonth = (monthKey: string, delta: number): string => {
    const [year, month] = monthKey.split('-').map(Number);
    return monthKeyFromDate(new Date(year, month - 1 + delta, 1));
};

const getLogStatus = (log: DailyLog): DailyLogStatus => (log.status || (log.verified ? 'verified' : 'draft')) as DailyLogStatus;

const buildCalendarCells = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    const firstOfMonth = new Date(year, month - 1, 1);
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

    return Array.from({ length: 42 }, (_, idx) => {
        const d = new Date(start);
        d.setDate(start.getDate() + idx);
        return {
            date: toDateKey(d),
            day: d.getDate(),
            inMonth: d.getMonth() === month - 1,
        };
    });
};

// Voice-enabled Textarea component
const VoiceTextarea: React.FC<{
    value: string;
    onChange: (val: string) => void;
    rows?: number;
    placeholder?: string;
    className?: string;
}> = ({ value, onChange, rows = 3, placeholder, className }) => {
    const { isListening, isSupported, interimTranscript, toggleListening, resetTranscript } = useVoiceInput({
        onResult: (text) => {
            onChange((value ? value + ' ' : '') + text);
            resetTranscript();
        },
    });

    return (
        <div className="relative">
            <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                rows={rows}
                placeholder={placeholder}
                className={className}
            />
            {isListening && interimTranscript && (
                <div className="absolute bottom-1 left-3 right-10 text-[10px] text-teal-500 italic truncate pointer-events-none">
                    🎙️ {interimTranscript}
                </div>
            )}
            {isSupported && (
                <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                        isListening
                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse'
                            : 'bg-slate-100 text-slate-400 hover:bg-teal-50 hover:text-teal-600'
                    }`}
                    title={isListening ? 'Dừng ghi âm' : 'Voice input (tiếng Việt)'}
                >
                    {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
            )}
        </div>
    );
};

const DailyLogTab: React.FC<DailyLogTabProps> = ({ constructionSiteId, projectId }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const { user } = useApp();
    const effectiveId = projectId || constructionSiteId || '';
    const [logs, setLogs] = useState<DailyLog[]>([]);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [contractItems, setContractItems] = useState<ContractItem[]>([]);

    // ── PBAC: Load user permissions ──
    const [userPerms, setUserPerms] = useState<Set<string>>(new Set());
    const [pbacLoaded, setPbacLoaded] = useState(false);

    useEffect(() => {
        setPbacLoaded(false);
        setUserPerms(new Set());
        if (!effectiveId) return;
        const loadPerms = async () => {
            try {
                // Check if PBAC is configured for this site/project
                const hasStaff = projectId
                    ? await projectStaffService.hasProjectStaff(projectId, constructionSiteId)
                    : constructionSiteId
                        ? await projectStaffService.hasSiteStaff(constructionSiteId)
                        : false;

                if (!hasStaff || !user?.id) {
                    // No PBAC setup → grant all permissions (backward compatible)
                    setUserPerms(new Set(ALL_DAILY_LOG_PERMISSION_CODES));
                    setPbacLoaded(true);
                    return;
                }

                const permsToCheck = ALL_DAILY_LOG_PERMISSION_CODES;
                const results = await Promise.all(
                    permsToCheck.map(async code => {
                        const r = projectId
                            ? await projectStaffService.checkProjectPermission(user.id, projectId, code, constructionSiteId)
                            : constructionSiteId
                                ? await projectStaffService.checkPermission(user.id, constructionSiteId, code)
                                : { allowed: false };
                        return { code, allowed: r.allowed };
                    })
                );
                setUserPerms(new Set(results.filter(r => r.allowed).map(r => r.code)));
            } catch (err) {
                console.warn('PBAC load failed', err);
                setUserPerms(new Set());
            } finally {
                setPbacLoaded(true);
            }
        };
        loadPerms();
    }, [effectiveId, user?.id, constructionSiteId, projectId]);

    const ensureDailyLogPermission = useCallback((code: ProjectPermissionCode, actionLabel: string) => {
        if (!pbacLoaded) {
            toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
            return false;
        }
        if (!userPerms.has(code)) {
            toast.error('Không có quyền', `Bạn cần quyền "${code}" để ${actionLabel}.`);
            return false;
        }
        return true;
    }, [pbacLoaded, toast, userPerms]);

    useEffect(() => {
        if (!effectiveId) return;
        dailyLogService.list(effectiveId, constructionSiteId || null).then(setLogs).catch(console.error);
        taskService.list(effectiveId, constructionSiteId || null).then(setTasks).catch(console.error);
        contractItemService.listBySite(effectiveId, undefined, constructionSiteId || null).then(setContractItems).catch(console.error);
    }, [effectiveId, constructionSiteId]);

    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<DailyLog | null>(null);
    const [filterMonth, setFilterMonth] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    const [calendarMonth, setCalendarMonth] = useState(monthKeyFromDate(new Date()));
    const [dayLogPicker, setDayLogPicker] = useState<{ date: string; logs: DailyLog[] } | null>(null);

    // Form state
    const [fDate, setFDate] = useState(new Date().toISOString().split('T')[0]);
    const [fWeather, setFWeather] = useState<WeatherType>('sunny');
    const [fWorkers, setFWorkers] = useState('');
    const [fDesc, setFDesc] = useState('');
    const [fIssues, setFIssues] = useState('');

    const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
    const [gpsLoading, setGpsLoading] = useState(false);
    
    const [photoRequired, setPhotoRequired] = useState(true);
    const [fPhotos, setFPhotos] = useState<{ name: string; url: string }[]>([]);
    const [uploading, setUploading] = useState(false);

    const [fDelayTasks, setFDelayTasks] = useState<DelayTaskEntry[]>([]);

    // FastCons detail states
    const [fVolumes, setFVolumes] = useState<DailyLogVolume[]>([]);
    const [fMaterials, setFMaterials] = useState<DailyLogMaterial[]>([]);
    const [fLabor, setFLabor] = useState<DailyLogLabor[]>([]);
    const [fMachines, setFMachines] = useState<DailyLogMachine[]>([]);

    const resetForm = () => {
        setEditing(null);
        setFDate(new Date().toISOString().split('T')[0]);
        setFWeather('sunny'); setFWorkers(''); setFDesc(''); setFIssues('');
        setGpsCoords(null);
        setFPhotos([]);
        setPhotoRequired(true);
        setFDelayTasks([]);
        setFVolumes([]); setFMaterials([]); setFLabor([]); setFMachines([]);
        setShowForm(false);
    };

    const openEdit = (l: DailyLog) => {
        setEditing(l);
        setFDate(l.date); setFWeather(l.weather); setFWorkers(String(l.workerCount));
        setFDesc(l.description); setFIssues(l.issues || '');
        setGpsCoords(l.gpsLat && l.gpsLng ? { lat: l.gpsLat, lng: l.gpsLng, accuracy: l.gpsAccuracy || 0 } : null);
        setFPhotos(l.photos || []);
        setPhotoRequired(l.photoRequired ?? true);
        setFDelayTasks(l.delayTasks || []);
        setFVolumes(l.volumes || []); setFMaterials(l.materials || []);
        setFLabor(l.laborDetails || []); setFMachines(l.machines || []);
        setShowForm(true);
    };

    const openCreateForDate = (date: string) => {
        resetForm();
        setDayLogPicker(null);
        setFDate(date);
        setShowForm(true);
    };

    const handleCalendarDayClick = (date: string, dayLogs: DailyLog[]) => {
        if (dayLogs.length === 0) {
            openCreateForDate(date);
            return;
        }
        if (dayLogs.length === 1) {
            setDayLogPicker(null);
            openEdit(dayLogs[0]);
            return;
        }
        setDayLogPicker({ date, logs: dayLogs });
    };

    const captureGPS = () => {
        setGpsLoading(true);
        navigator.geolocation.getCurrentPosition(
            pos => {
                setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
                setGpsLoading(false);
                toast.success('Đã lấy vị trí hiện trường');
            },
            err => { toast.error('Không lấy được vị trí', err.message); setGpsLoading(false); },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const ext = file.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
            const { error } = await supabase.storage.from('project-photos').upload(`dailylogs/${effectiveId}/${fileName}`, file);
            if (error) throw error;
            const { data: { publicUrl } } = supabase.storage.from('project-photos').getPublicUrl(`dailylogs/${effectiveId}/${fileName}`);
            setFPhotos([...fPhotos, { name: file.name, url: publicUrl }]);
            toast.success('Tải ảnh thành công');
        } catch (err: any) {
            toast.error('Lỗi tải ảnh', err.message);
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        if (!fDate || !fDesc) return;
        if (!ensureDailyLogPermission('edit', editing ? 'cập nhật nhật ký' : 'tạo nhật ký')) return;
        if (photoRequired && fPhotos.length === 0) {
            toast.error('Cần ít nhất 1 ảnh công trường');
            return;
        }

        try {
	        const baseItem = {
	            date: fDate, weather: fWeather, workerCount: Number(fWorkers) || 0,
	            description: fDesc, issues: fIssues || undefined,
	            gpsLat: gpsCoords?.lat, gpsLng: gpsCoords?.lng, gpsAccuracy: gpsCoords?.accuracy,
	            photos: fPhotos, photoRequired, delayTasks: fDelayTasks,
	            volumes: fVolumes, materials: fMaterials, laborDetails: fLabor, machines: fMachines,
	            status: editing?.status || 'draft',
	            verified: editing?.status === 'verified' || editing?.verified || false,
	        };
        
	        const item: DailyLog = editing ? {
	            ...editing, ...baseItem
	        } : {
	            id: crypto.randomUUID(), projectId: projectId || constructionSiteId || null, constructionSiteId: constructionSiteId || null, ...baseItem,
	            createdBy: user?.name || 'admin', createdAt: new Date().toISOString(),
		    };
	        await dailyLogService.upsert(item);
	        setLogs(await dailyLogService.list(effectiveId, constructionSiteId || null));
	        toast.success(editing ? 'Cập nhật nhật ký' : 'Ghi nhật ký thành công');
	        resetForm();
        } catch (e: any) {
            toast.error('Lỗi lưu nhật ký', e?.message);
        }
	    };

	    const handleStatusChange = async (log: DailyLog, status: DailyLogStatus) => {
	        // ── PBAC Check ──
	        const permCode = DAILY_LOG_STATUS_PERMISSION[status];
            if (permCode && !ensureDailyLogPermission(
                permCode,
                status === 'submitted' ? 'gửi nhật ký' : status === 'verified' ? 'xác nhận nhật ký' : 'trả lại nhật ký',
            )) return;

            try {
	            const now = new Date().toISOString();
	            const updated: DailyLog = {
	                ...log,
	                status,
	                verified: status === 'verified',
	                submittedAt: status === 'submitted' ? now : log.submittedAt,
	                verifiedBy: status === 'verified' ? (user?.name || 'PM/QS') : log.verifiedBy,
	                rejectedAt: status === 'rejected' ? now : log.rejectedAt,
	                rejectionReason: status === 'rejected' ? 'Cần bổ sung/kiểm tra lại' : log.rejectionReason,
	            };
	            await dailyLogService.upsert(updated);
	            setLogs(await dailyLogService.list(effectiveId, constructionSiteId || null));

            // Notify if submitted
            if (status === 'submitted') {
                try {
                    const verifiers = await projectStaffService.listProjectStaffWithPermissions(
                        projectId,
                        constructionSiteId,
                        ['verify'],
                    );
                    await notificationService.notifyProjectUsers({
                        recipientIds: verifiers.map(v => v.userId),
                        actorId: user?.id,
                        type: 'info',
                        category: 'progress',
                        title: '📝 Nhật ký chờ xác nhận',
                        message: `${user?.name || 'Nhân viên'} đã gửi nhật ký ngày ${new Date(log.date).toLocaleDateString('vi-VN')}`,
                        severity: 'info',
                        icon: '📝',
                        link: '/da',
                        sourceType: 'dailylog_submitted',
                        sourceId: `dailylog_${log.id}`,
                        constructionSiteId: constructionSiteId || undefined,
                        metadata: { logId: log.id, date: log.date, projectId, submittedBy: user?.name },
                    });
                } catch (err) {
                    console.error('Failed to notify verifiers:', err);
                }
            }

	        toast.success(
	            status === 'submitted' ? 'Đã gửi nhật ký' :
	            status === 'verified' ? 'Đã xác nhận nhật ký' :
	            status === 'rejected' ? 'Đã trả lại nhật ký' : 'Đã cập nhật trạng thái'
	        );
            } catch (e: any) {
                toast.error('Lỗi cập nhật trạng thái', e?.message);
            }
	    };

    const handleDelete = async (id: string) => {
        if (!ensureDailyLogPermission('edit', 'xoá nhật ký')) return;
        const log = logs.find(l => l.id === id);
        const ok = await confirm({ targetName: log ? new Date(log.date).toLocaleDateString('vi-VN') : 'nhật ký này', title: 'Xoá nhật ký công trường' });
        if (!ok) return;
        try {
            await dailyLogService.remove(id);
            setLogs(await dailyLogService.list(effectiveId, constructionSiteId || null));
            toast.success('Xoá nhật ký thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const filtered = useMemo(() => {
        let list = [...logs];
        if (filterMonth) list = list.filter(l => l.date.startsWith(filterMonth));
        return list.sort((a, b) => b.date.localeCompare(a.date));
    }, [logs, filterMonth]);

    // Stats
    const stats = useMemo(() => {
        const thisMonth = new Date().toISOString().slice(0, 7);
        const monthLogs = logs.filter(l => l.date.startsWith(thisMonth));
        const avgWorkers = monthLogs.length > 0 ? Math.round(monthLogs.reduce((s, l) => s + l.workerCount, 0) / monthLogs.length) : 0;
        const rainyDays = monthLogs.filter(l => l.weather === 'rainy' || l.weather === 'storm').length;
        const issueCount = monthLogs.filter(l => l.issues).length;
        return { total: logs.length, monthCount: monthLogs.length, avgWorkers, rainyDays, issueCount };
    }, [logs]);

    // Available months for filter
    const availableMonths = useMemo(() => {
        const ms = new Set(logs.map(l => l.date.slice(0, 7)));
        return Array.from(ms).sort().reverse();
    }, [logs]);

    const logsByDate = useMemo(() => {
        const map = new Map<string, DailyLog[]>();
        logs.forEach(log => {
            const list = map.get(log.date) || [];
            list.push(log);
            map.set(log.date, list);
        });
        for (const list of map.values()) {
            list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        }
        return map;
    }, [logs]);

    const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);
    const calendarTitle = useMemo(() => {
        const [year, month] = calendarMonth.split('-').map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
    }, [calendarMonth]);

    return (
        <div className="space-y-6">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Nhật ký công trường</h3>
                <AiInsightPanel module="dailylog" siteId={constructionSiteId} />
            </div>
            {/* Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">📝 Tổng nhật ký</div>
                    <div className="text-2xl font-black text-slate-800">{stats.total}</div>
                    <div className="text-[10px] text-blue-500 font-bold mt-1">Tháng này: {stats.monthCount}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Users size={10} /> CN TB/ngày</div>
                    <div className="text-2xl font-black text-blue-600">{stats.avgWorkers}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">🌧️ Ngày mưa</div>
                    <div className="text-2xl font-black text-cyan-600">{stats.rainyDays}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertTriangle size={10} /> Vấn đề</div>
                    <div className="text-2xl font-black text-red-500">{stats.issueCount}</div>
                </div>
            </div>

            {/* Log List */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                        <Calendar size={16} className="text-teal-500" /> Nhật ký công trường
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
                            <button
                                onClick={() => setViewMode('list')}
                                className={`w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                title="Danh sách"
                            >
                                <LayoutList size={14} />
                            </button>
                            <button
                                onClick={() => {
                                    setCalendarMonth(filterMonth || calendarMonth);
                                    setViewMode('calendar');
                                }}
                                className={`w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'calendar' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                title="Lịch tháng"
                            >
                                <Calendar size={14} />
                            </button>
                        </div>
                        {viewMode === 'calendar' ? (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl border border-slate-200 bg-white">
                                <button onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                                    title="Tháng trước">
                                    <ChevronLeft size={14} />
                                </button>
                                <span className="min-w-[116px] text-center text-xs font-black text-slate-600 capitalize">{calendarTitle}</span>
                                <button onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                                    title="Tháng sau">
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        ) : (
                            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                                className="text-xs font-bold text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 bg-white outline-none">
                                <option value="">Tất cả</option>
                                {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        )}
                        <button onClick={() => { resetForm(); setShowForm(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-all">
                            <Plus size={12} /> Ghi nhật ký
                        </button>
                    </div>
                </div>

                {viewMode === 'calendar' ? (
                    <div className="p-3 sm:p-5">
                        <div className="grid grid-cols-7 border-l border-t border-slate-100 rounded-2xl overflow-hidden">
                            {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map(day => (
                                <div key={day} className="bg-slate-50 border-r border-b border-slate-100 px-1.5 py-2 text-center text-[10px] font-black text-slate-400 uppercase">
                                    {day}
                                </div>
                            ))}
                            {calendarCells.map(cell => {
                                const dayLogs = logsByDate.get(cell.date) || [];
                                const primaryLog = dayLogs[0];
                                const totalWorkers = dayLogs.reduce((sum, log) => sum + (log.workerCount || 0), 0);
                                const isToday = cell.date === toDateKey(new Date());
                                return (
                                    <button
                                        key={cell.date}
                                        onClick={() => handleCalendarDayClick(cell.date, dayLogs)}
                                        className={`min-h-[72px] sm:min-h-[92px] border-r border-b border-slate-100 p-1.5 sm:p-2 text-left transition-colors hover:bg-teal-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-400 ${cell.inMonth ? 'bg-white' : 'bg-slate-50/70 text-slate-300'} ${isToday ? 'ring-2 ring-inset ring-teal-400' : ''}`}
                                    >
                                        <div className="flex items-start justify-between gap-1">
                                            <span className={`text-xs font-black ${cell.inMonth ? 'text-slate-700' : 'text-slate-300'}`}>{cell.day}</span>
                                            {primaryLog && <span className="text-sm leading-none">{WEATHER[primaryLog.weather]?.emoji}</span>}
                                        </div>
                                        {dayLogs.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                <div className="flex items-center gap-1">
                                                    {dayLogs.slice(0, 4).map(log => (
                                                        <span key={log.id} className={`w-2 h-2 rounded-full ${STATUS_DOT[getLogStatus(log)]}`} />
                                                    ))}
                                                    {dayLogs.length > 4 && <span className="text-[9px] font-bold text-slate-400">+{dayLogs.length - 4}</span>}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold text-slate-500">
                                                    <span className="inline-flex items-center gap-0.5"><Users size={10} /> {totalWorkers}</span>
                                                    {dayLogs.length > 1 && <span>{dayLogs.length} nhật ký</span>}
                                                </div>
                                                {primaryLog?.description && (
                                                    <p className="hidden sm:block text-[10px] text-slate-500 line-clamp-2 leading-snug">{primaryLog.description}</p>
                                                )}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <Calendar size={36} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-sm font-bold text-slate-400">Chưa có nhật ký nào</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
	                        {filtered.map(l => {
	                            const w = WEATHER[l.weather];
	                            const status = (l.status || (l.verified ? 'verified' : 'draft')) as DailyLogStatus;
	                            const statusCfg = STATUS_CFG[status];
	                            return (
	                                <div key={l.id} className="px-5 py-4 hover:bg-slate-50/50 transition-colors group">
	                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-100 flex flex-col items-center justify-center shrink-0">
                                                <div className="text-[9px] font-black text-teal-600">{new Date(l.date).getDate()}</div>
                                                <div className="text-[8px] text-teal-400">T{new Date(l.date).getMonth() + 1}</div>
                                            </div>
                                            <div className="min-w-0 flex-1">
	                                                <div className="flex items-center gap-2 mb-1">
	                                                    <span className="text-sm font-bold text-slate-800">{new Date(l.date).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
	                                                    <span className="text-xs">{w.emoji}</span>
	                                                    <span className="text-[10px] font-bold text-blue-500 flex items-center gap-0.5"><Users size={10} /> {l.workerCount}</span>
	                                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${statusCfg.cls}`}>{statusCfg.label}</span>
	                                                </div>
                                                <p className="text-xs text-slate-600 leading-relaxed">{l.description}</p>
                                                {l.issues && (
                                                    <div className="mt-1.5 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-100">
                                                        <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                                                        <span className="text-xs text-red-600 font-medium">{l.issues}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
	                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
	                                            {status === 'draft' && userPerms.has('submit') && (
	                                                <button onClick={() => handleStatusChange(l, 'submitted')} title="Gửi xác nhận" className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-400 hover:text-amber-600 hover:bg-amber-50"><Send size={13} /></button>
	                                            )}
	                                            {status === 'submitted' && userPerms.has('verify') && (
	                                                <button onClick={() => handleStatusChange(l, 'verified')} title="Xác nhận" className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50"><CheckCircle2 size={13} /></button>
	                                            )}
	                                            {status === 'submitted' && userPerms.has('reject') && (
	                                                <button onClick={() => handleStatusChange(l, 'rejected')} title="Trả lại" className="w-7 h-7 rounded-lg flex items-center justify-center text-red-300 hover:text-red-500 hover:bg-red-50"><RotateCcw size={13} /></button>
	                                            )}
	                                            <button onClick={() => openEdit(l)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50"><Edit2 size={13} /></button>
	                                            <button onClick={() => handleDelete(l.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
	                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {dayLogPicker && (
                <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={e => e.target === e.currentTarget && setDayLogPicker(null)}>
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-black text-slate-700">{new Date(dayLogPicker.date).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                                <p className="text-[10px] font-bold text-slate-400">{dayLogPicker.logs.length} nhật ký trong ngày</p>
                            </div>
                            <button onClick={() => setDayLogPicker(null)} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
                            {dayLogPicker.logs.map(log => {
                                const status = getLogStatus(log);
                                return (
                                    <button key={log.id} onClick={() => { setDayLogPicker(null); openEdit(log); }}
                                        className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-teal-200 hover:bg-teal-50/50 transition-colors">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm">{WEATHER[log.weather]?.emoji}</span>
                                                <span className="text-xs font-bold text-slate-700">{log.workerCount} công nhân</span>
                                            </div>
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${STATUS_CFG[status].cls}`}>{STATUS_CFG[status].label}</span>
                                        </div>
                                        <p className="text-xs text-slate-500 line-clamp-2">{log.description}</p>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
                            <button onClick={() => openCreateForDate(dayLogPicker.date)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-teal-600 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-colors">
                                <Plus size={13} /> Thêm nhật ký
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[92vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editing ? <><Edit2 size={18} /> Sửa nhật ký</> : <><Plus size={18} /> Ghi nhật ký</>}
                            </span>
                            <button onClick={resetForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto flex-1">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày</label>
                                    <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số công nhân</label>
                                    <input type="number" value={fWorkers} onChange={e => setFWorkers(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Thời tiết</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {(Object.entries(WEATHER) as [WeatherType, typeof WEATHER[WeatherType]][]).map(([k, v]) => (
                                        <button key={k} onClick={() => setFWeather(k)}
                                            className={`py-2 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 ${fWeather === k ? 'bg-teal-50 border-teal-300 text-teal-700 shadow-sm' : 'border-slate-200 text-slate-500'}`}>
                                            <span className="text-lg">{v.emoji}</span>
                                            <span>{v.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nội dung công việc</label>
                                <VoiceTextarea
                                    value={fDesc}
                                    onChange={setFDesc}
                                    rows={3}
                                    placeholder="Mô tả công việc đã thực hiện trong ngày... (nhấn 🎤 để voice input)"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-teal-500 outline-none resize-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 flex items-center gap-1"><AlertTriangle size={10} className="text-red-400" /> Vấn đề / Sự cố</label>
                                <VoiceTextarea
                                    value={fIssues}
                                    onChange={setFIssues}
                                    rows={2}
                                    placeholder="Ghi lại vấn đề, sự cố nếu có... (nhấn 🎤 để voice input)"
                                    className="w-full px-3 py-2.5 rounded-xl border border-red-100 bg-red-50/30 text-sm focus:ring-2 focus:ring-red-400 outline-none resize-none"
                                />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                                {/* GPS */}
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Vị trí hiện trường</label>
                                    {gpsCoords ? (
                                        <div className="flex items-center justify-between p-2.5 rounded-xl border border-teal-200 bg-teal-50">
                                            <div className="flex items-center gap-2">
                                                <MapPin size={14} className="text-teal-600" />
                                                <div className="text-xs">
                                                    <div className="font-bold text-slate-700">{gpsCoords.lat.toFixed(5)}, {gpsCoords.lng.toFixed(5)}</div>
                                                    <div className="text-[10px] text-teal-600">Sai số: {Math.round(gpsCoords.accuracy)}m</div>
                                                </div>
                                            </div>
                                            <button onClick={() => setGpsCoords(null)} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
                                        </div>
                                    ) : (
                                        <button onClick={captureGPS} disabled={gpsLoading}
                                            className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-slate-300 text-sm font-bold text-slate-500 hover:bg-slate-50 hover:text-teal-600 hover:border-teal-300 transition-colors disabled:opacity-50">
                                            <MapPin size={16} /> {gpsLoading ? 'Đang lấy vị trí...' : 'Lấy tọa độ GPS'}
                                        </button>
                                    )}
                                </div>
                                {/* Photos */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                                            Ảnh chụp <span className="text-red-500">*</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                                            <input type="checkbox" checked={photoRequired} onChange={e => setPhotoRequired(e.target.checked)} className="accent-teal-500" /> Bắt buộc
                                        </label>
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        {fPhotos.map((p, i) => (
                                            <div key={i} className="relative group">
                                                <img src={p.url} alt={p.name} className="w-12 h-12 object-cover rounded-lg border border-slate-200" />
                                                <button onClick={() => setFPhotos(fPhotos.filter((_, idx) => idx !== i))}
                                                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ))}
                                        <label className={`w-12 h-12 rounded-lg border border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-teal-300 hover:text-teal-600 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : 'text-slate-400'}`}>
                                            <Camera size={16} />
                                            <input type="file" accept="image/*" className="hidden" onChange={handleUploadPhoto} disabled={uploading} />
                                        </label>
                                    </div>
                                    {photoRequired && fPhotos.length === 0 && (
                                        <div className="mt-1.5 text-[10px] text-red-500 flex items-center gap-1">
                                            <AlertTriangle size={10} /> Cần ít nhất 1 ảnh công trường
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Delay Tasks */}
                            {tasks && tasks.length > 0 && (
                                <div className="border-t border-slate-100 pt-4">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1 mb-2">
                                        <Clock size={12} className="text-amber-500" /> Ghi nhận trễ tiến độ
                                    </label>
                                    <div className="space-y-2">
                                        {fDelayTasks.map((dt, i) => (
                                            <div key={i} className="flex gap-2 items-start bg-amber-50/50 p-2 rounded-xl border border-amber-100">
                                                <select className="flex-1 text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-amber-400"
                                                    value={dt.taskId} onChange={e => {
                                                        const newDt = [...fDelayTasks];
                                                        const t = tasks.find(x => x.id === e.target.value);
                                                        newDt[i].taskId = e.target.value;
                                                        if (t) newDt[i].taskName = t.name;
                                                        setFDelayTasks(newDt);
                                                    }}>
                                                    <option value="" disabled>Chọn hạng mục...</option>
                                                    {tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                </select>
                                                <div className="flex items-center gap-1 bg-white border border-amber-200 rounded-lg px-2 w-[80px]">
                                                    <input type="number" className="w-full text-xs text-center py-1.5 outline-none bg-transparent" placeholder="Số" min="1"
                                                        value={dt.delayDays || ''} onChange={e => {
                                                            const newDt = [...fDelayTasks];
                                                            newDt[i].delayDays = Number(e.target.value);
                                                            setFDelayTasks(newDt);
                                                        }} />
                                                    <span className="text-[10px] text-slate-400">ngày</span>
                                                </div>
                                                <select className="w-[110px] text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-amber-400"
                                                    value={dt.category} onChange={e => {
                                                        const newDt = [...fDelayTasks];
                                                        newDt[i].category = e.target.value as DelayCategory;
                                                        setFDelayTasks(newDt);
                                                    }}>
                                                    <option value="material">Vật tư</option>
                                                    <option value="labor">Nhân công</option>
                                                    <option value="weather">Thời tiết</option>
                                                    <option value="drawing">Bản vẽ</option>
                                                    <option value="other">Khác</option>
                                                </select>
                                                <input type="text" className="flex-1 text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-amber-400" placeholder="Ghi chú thêm..."
                                                    value={dt.reason} onChange={e => {
                                                        const newDt = [...fDelayTasks];
                                                        newDt[i].reason = e.target.value;
                                                        setFDelayTasks(newDt);
                                                    }} />
                                                <button onClick={() => setFDelayTasks(fDelayTasks.filter((_, idx) => idx !== i))} className="w-7 h-7 flex items-center justify-center text-amber-400 hover:text-red-500 hover:bg-white rounded-lg shrink-0 mt-0.5"><X size={14} /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => setFDelayTasks([...fDelayTasks, { taskId: '', taskName: '', delayDays: 1, reason: '', category: 'weather' }])}
                                            className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors border border-amber-200">
                                            <Plus size={12} /> Thêm hạng mục bị trễ
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* FastCons Detail Tabs */}
                            <DailyLogDetailTabs
                                volumes={fVolumes} materials={fMaterials}
                                laborDetails={fLabor} machines={fMachines}
                                onVolumesChange={setFVolumes} onMaterialsChange={setFMaterials}
                                onLaborChange={setFLabor} onMachinesChange={setFMachines}
                                contractItems={contractItems}
                            />
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSave} disabled={!fDate || !fDesc || (photoRequired && fPhotos.length === 0)}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-teal-500 to-cyan-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editing ? 'Lưu' : 'Ghi nhật ký'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DailyLogTab;
