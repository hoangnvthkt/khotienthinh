import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import AiInsightPanel from '../../components/AiInsightPanel';
import { Plus, Edit2, Trash2, X, Save, Cloud, Sun, CloudRain, CloudLightning, Users, Calendar, AlertTriangle, Mic, MicOff, MapPin, Camera, Clock, Send, CheckCircle2, RotateCcw, LayoutList, ChevronLeft, ChevronRight, Loader2, UserCheck, Eye, Layers, Package, Wrench, Paperclip, Search, SlidersHorizontal, ChevronDown, ChevronUp, BarChart3, FileSpreadsheet, FileText } from 'lucide-react';
import { DailyLog, DailyLogPhoto, WeatherType, ProjectTask, DelayTaskEntry, DelayCategory, DailyLogVolume, DailyLogMaterial, DailyLogLabor, DailyLogMachine, DailyLogStatus, ContractLaborCatalogItem, ContractMachineCatalogItem, ProjectStaff, BusinessPartner, ProjectWorkBoqItem } from '../../types';
import { supabase } from '../../lib/supabase';
import { dailyLogService, taskService, workBoqService } from '../../lib/projectService';
import { contractLaborCatalogService, contractMachineCatalogService } from '../../lib/contractMetadataService';
import { partnerService } from '../../lib/partnerService';
import { projectStaffService } from '../../lib/projectStaffService';
import { projectPermissionRoomService } from '../../lib/projectPermissionRoomService';
import { notificationService } from '../../lib/notificationService';
import { delayEventService } from '../../lib/projectScheduleForecastService';
import { projectDocumentActionLogService } from '../../lib/projectDocumentActionLogService';
import { projectDocumentDependencyService } from '../../lib/projectDocumentDependencyService';
import { formatPolicyMessage, getProjectDocumentPolicy } from '../../lib/projectDocumentPolicy';
import { subjectAuthorizationService, type DailyLogResponsibilityTarget } from '../../lib/subjectAuthorizationService';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import DailyLogDetailTabs from '../../components/project/DailyLogDetailTabs';
import SafetyImageGalleryModal from '../../components/project/safety/SafetyImageGalleryModal';
import { buildDailyLogVolumesFromDailyProgress } from '../../lib/dailyLogProgressImport';
import { getProjectScopeKey, projectWeeklyProgressService } from '../../lib/projectWeeklyProgressService';
import {
    buildDailyLogSourceSnapshot,
    buildDailyLogSummaryVolumes,
    canReturnDailyLogSource,
    getDailyLogSummarySourceLogs,
    getDailyLogSourceReviewState,
    getDailyLogSummarySourceSnapshots,
    isDailyLogSummaryEditable,
    type DailyLogSourceReviewState,
    type DailyLogSummarySourceSnapshot,
} from '../../lib/dailyLogWorkflow';

interface DailyLogTabProps {
    constructionSiteId?: string;
    projectId?: string;
    canManageTab?: boolean;
}

const WEATHER: Record<WeatherType, { label: string; icon: React.ReactNode; emoji: string }> = {
    sunny: { label: 'Nắng', icon: <Sun size={14} />, emoji: '☀️' },
    cloudy: { label: 'Mây', icon: <Cloud size={14} />, emoji: '⛅' },
    rainy: { label: 'Mưa', icon: <CloudRain size={14} />, emoji: '🌧️' },
    storm: { label: 'Bão', icon: <CloudLightning size={14} />, emoji: '⛈️' },
};

const STATUS_CFG: Record<DailyLogStatus, { label: string; cls: string }> = {
    draft: { label: 'Nháp', cls: 'bg-muted text-muted-foreground border-border' },
    submitted: { label: 'Chờ xác nhận', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    verified: { label: 'Đã xác nhận', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    rejected: { label: 'Trả lại', cls: 'bg-destructive/10 text-destructive border-destructive/20' },
};

const STATUS_DOT: Record<DailyLogStatus, string> = {
    draft: 'bg-slate-400',
    submitted: 'bg-amber-500',
    verified: 'bg-emerald-500',
    rejected: 'bg-red-500',
};

const SOURCE_REVIEW_STATE_CFG: Record<DailyLogSourceReviewState, { label: string; cls: string; cardCls: string }> = {
    waiting_review: {
        label: 'Chờ rà soát',
        cls: 'border-amber-200 bg-amber-50 text-amber-700',
        cardCls: 'border-amber-200 bg-amber-50/40',
    },
    included: {
        label: 'Đã đưa vào tổng hợp',
        cls: 'border-teal-200 bg-teal-50 text-teal-700',
        cardCls: 'border-teal-200 bg-teal-50/60',
    },
    needs_rereview: {
        label: 'Cần rà soát lại',
        cls: 'border-orange-200 bg-orange-50 text-orange-700',
        cardCls: 'border-orange-200 bg-orange-50/60',
    },
    returned: {
        label: 'Đã trả lại',
        cls: 'border-red-200 bg-red-50 text-red-700',
        cardCls: 'border-red-200 bg-red-50/50',
    },
};

const SOURCE_REVIEW_STATE_ORDER: Record<DailyLogSourceReviewState, number> = {
    waiting_review: 0,
    included: 1,
    needs_rereview: 2,
    returned: 3,
};

const DAILY_SUMMARY_SOURCE_TYPE = 'member_contributions';

const DAILY_LOG_ACTION = {
    view: 'project.daily_log.view',
    create: 'project.daily_log.create',
    editOwn: 'project.daily_log.edit_own',
    editAll: 'project.daily_log.edit_all',
    deleteOwn: 'project.daily_log.delete_own',
    deleteAll: 'project.daily_log.delete_all',
    submit: 'project.daily_log.submit',
    return: 'project.daily_log.return',
    verify: 'project.daily_log.verify',
    approve: 'project.daily_log.approve',
    summarize: 'project.daily_log.summarize',
} as const;

type DailyLogActionCode = typeof DAILY_LOG_ACTION[keyof typeof DAILY_LOG_ACTION];

const DAILY_LOG_STATUS_PERMISSION: Partial<Record<DailyLogStatus, DailyLogActionCode>> = {
    submitted: DAILY_LOG_ACTION.submit,
    verified: DAILY_LOG_ACTION.verify,
    rejected: DAILY_LOG_ACTION.return,
};

const ALL_DAILY_LOG_PERMISSION_CODES: DailyLogActionCode[] = Object.values(DAILY_LOG_ACTION);

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

const isSummaryDailyLog = (log: DailyLog): boolean => log.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE;

const isLegacyDailyLogSource = (log: DailyLog): boolean =>
    !isSummaryDailyLog(log)
    && getLogStatus(log) === 'submitted'
    && (log.submittedToPermission || 'verify') !== 'approve';

const getLegacyDailyLogSourceName = (log: DailyLog): string =>
    log.createdBy || log.submittedBy || log.createdById || log.submittedById || 'Thành viên';

const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];

const getLegacyDailyLogSourcePhotos = (log: DailyLog): DailyLogPhoto[] => {
    const sourceUserId = log.createdById || log.submittedById || log.submittedBy;
    const sourceUserName = getLegacyDailyLogSourceName(log);
    return (log.photos || []).map(photo => ({
        ...photo,
        sourceContributionId: `legacy-daily-log:${log.id}`,
        sourceUserId,
        sourceUserName,
    }));
};

const getWorkerCountFromLabor = (rows: DailyLogLabor[]): number =>
    rows.reduce((sum, row) => sum + Math.max(0, Number(row.count || 0)), 0);

const formatNumber = (value?: number | null) =>
    Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const formatMoney = (value?: number | null) =>
    Number(value || 0).toLocaleString('vi-VN');

const ATTACHMENT_MIME_BY_EXTENSION: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
};

const inferAttachmentMimeType = (file: { fileType?: string; fileName?: string; name?: string }) => {
    if (file.fileType) return file.fileType;
    const name = file.fileName || file.name || '';
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return ATTACHMENT_MIME_BY_EXTENSION[ext] || '';
};

const normalizeAttachmentUrl = (file: { fileType?: string; fileName?: string; name?: string; url?: string }) => {
    const url = file.url || '';
    if (!url.startsWith('data:')) return url;
    const mimeType = inferAttachmentMimeType(file);
    if (!mimeType) return url;
    const commaIndex = url.indexOf(',');
    if (commaIndex === -1) return url;
    const prefix = url.slice(0, commaIndex);
    const needsMime = /^data:(?:;base64)?$/i.test(prefix) || /^data:application\/octet-stream(?:;base64)?$/i.test(prefix);
    return needsMime ? `data:${mimeType};base64${url.slice(commaIndex)}` : url;
};

const isImageAttachment = (file: { fileType?: string; fileName?: string; name?: string; url?: string }) => {
    const name = file.fileName || file.name || '';
    return /^image\//i.test(inferAttachmentMimeType(file)) || /^data:image\//i.test(normalizeAttachmentUrl(file)) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name);
};

const normalizeLookupText = (value?: string | null) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const SITE_WAREHOUSE_STOP_WORDS = new Set(['kho', 'cong', 'truong', 'du', 'an', 'ct', 'tai', 'khu']);

const uniqueStaffByUser = (rows: ProjectStaff[]): ProjectStaff[] => {
    const map = new Map<string, ProjectStaff>();
    rows.forEach(staff => {
        if (!staff.userId || map.has(staff.userId)) return;
        map.set(staff.userId, staff);
    });
    return [...map.values()];
};

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
    bulletPoints?: boolean;
}> = ({ value, onChange, rows = 3, placeholder, className, bulletPoints }) => {
    const { isListening, isSupported, interimTranscript, toggleListening, resetTranscript } = useVoiceInput({
        onResult: (text) => {
            onChange((value ? value + ' ' : '') + text);
            resetTranscript();
        },
    });

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (bulletPoints && e.key === 'Enter') {
            e.preventDefault();
            const textarea = e.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            
            // Insert newline and bullet point
            const nextVal = value.slice(0, start) + '\n- ' + value.slice(end);
            onChange(nextVal);
            
            const targetPos = start + 3; // length of '\n- '
            setTimeout(() => {
                textarea.setSelectionRange(targetPos, targetPos);
            }, 0);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        let val = e.target.value;
        if (bulletPoints && val) {
            // If the textarea was empty before and the user typed a character, auto-prepend '- '
            if (!value && val.trim() !== '') {
                const lines = val.split('\n');
                const processed = lines.map(line => {
                    if (line.trim() === '') return line;
                    if (!line.startsWith('- ')) {
                        if (line.startsWith('-')) {
                            return '- ' + line.substring(1);
                        }
                        return '- ' + line;
                    }
                    return line;
                });
                val = processed.join('\n');
            }
        }
        onChange(val);
    };

    return (
        <div className="relative">
            <textarea
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
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
                    className={`absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isListening
                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse'
                            : 'bg-muted text-muted-foreground hover:bg-teal-500/10 hover:text-teal-400'
                        }`}
                    title={isListening ? 'Dừng ghi âm' : 'Voice input (tiếng Việt)'}
                >
                    {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
            )}
        </div>
    );
};

interface DailyLogViewerProps {
    log: DailyLog;
    siteStaff: ProjectStaff[];
    status: DailyLogStatus;
    statusClassName: string;
    weatherLabel: string;
    weatherEmoji: string;
    canEdit: boolean;
    canReturn: boolean;
    canVerify: boolean;
    canRollback: boolean;
    canSubmit: boolean;
    canDelete: boolean;
    sourceSummaryLog?: DailyLog | null;
    summarySourceLogs?: DailyLog[];
    canReturnSourceLog?: (log: DailyLog) => boolean;
    busy: boolean;
    onClose: () => void;
    onPreviewImage?: (attachments: { url: string; name: string; fileType?: string }[], index: number) => void;
    onEdit: () => void;
    onRollback: () => void | Promise<void>;
    onSubmit: () => void;
    onDelete: () => void;
    onVerify: () => void;
    onReject: () => void | Promise<void>;
    onReturnSourceLog?: (log: DailyLog) => void | Promise<void>;
}

const DailyLogViewer: React.FC<DailyLogViewerProps> = ({
    log,
    siteStaff,
    status,
    statusClassName,
    weatherLabel,
    weatherEmoji,
    canEdit,
    canReturn,
    canVerify,
    canRollback,
    canSubmit,
    canDelete,
    sourceSummaryLog,
    summarySourceLogs = [],
    canReturnSourceLog,
    busy,
    onClose,
    onPreviewImage,
    onEdit,
    onRollback,
    onSubmit,
    onDelete,
    onVerify,
    onReject,
    onReturnSourceLog,
}) => {
    const materialRows = log.materials || [];
    const displayVolumes = (log.volumes || []).length > 0
        ? (log.volumes || [])
        : buildDailyLogSummaryVolumes(summarySourceLogs);
    const materialQuantity = materialRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const materialUnits = Array.from(new Set(materialRows.map(row => row.unit).filter(Boolean)));
    const materialSummary = materialRows.length === 0
        ? '0'
        : materialUnits.length === 1
            ? `${formatNumber(materialQuantity)} ${materialUnits[0]}`
            : `${materialRows.length} dòng`;
    const laborCount = (log.laborDetails || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
    const machineShifts = (log.machines || []).reduce((sum, row) => sum + Number(row.shifts || 0), 0);
    const participatingStaff = (log.staffIds || [])
        .map(id => siteStaff.find(s => s.userId === id))
        .filter(Boolean) as ProjectStaff[];

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm px-3" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="w-[96vw] h-[92dvh] max-w-[1180px] rounded-3xl bg-card shadow-2xl border border-border flex flex-col overflow-hidden">
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h3 className="text-lg font-black text-foreground">Nhật ký công trường</h3>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusClassName}`}>{STATUS_CFG[status].label}</span>
                            <span className="text-sm">{weatherEmoji}</span>
                        </div>
                        <p className="text-xs font-bold text-muted-foreground">
                            {new Date(log.date).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                            <span className="mx-2 text-muted-foreground/30">•</span>{weatherLabel}
                            <span className="mx-2 text-muted-foreground/30">•</span>{log.workerCount || 0} nhân công
                        </p>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-muted shrink-0">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 sm:space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4">
                        <div className="rounded-2xl border border-border p-4 space-y-4">
                            <div>
                                <div className="text-[10px] font-black text-muted-foreground uppercase mb-1">Nội dung công việc thi công</div>
                                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{log.description || 'Không có nội dung.'}</p>
                            </div>
                            {log.acceptanceDescription && (
                                <div className="border-t border-border pt-3">
                                    <div className="text-[10px] font-black text-muted-foreground uppercase mb-1">Nội dung công việc nghiệm thu</div>
                                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{log.acceptanceDescription}</p>
                                </div>
                            )}
                            {log.nextDayPlan && (
                                <div className="border-t border-border pt-3">
                                    <div className="text-[10px] font-black text-muted-foreground uppercase mb-1">Kế hoạch thi công ngày hôm sau</div>
                                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{log.nextDayPlan}</p>
                                </div>
                            )}
                            <div className="border-t border-border pt-3">
                                <div className="text-[10px] font-black text-muted-foreground uppercase mb-2">Đảm bảo an toàn & vệ sinh</div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className={`p-2.5 rounded-xl border text-center text-xs font-bold ${log.workSafetyOk !== false ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
                                        An toàn lao động: {log.workSafetyOk !== false ? 'Đạt' : 'Không đạt'}
                                    </div>
                                    <div className={`p-2.5 rounded-xl border text-center text-xs font-bold ${log.envHygieneOk !== false ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
                                        Vệ sinh môi trường: {log.envHygieneOk !== false ? 'Đạt' : 'Không đạt'}
                                    </div>
                                    <div className={`p-2.5 rounded-xl border text-center text-xs font-bold ${log.trafficSafetyOk !== false ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
                                        An toàn giao thông: {log.trafficSafetyOk !== false ? 'Đạt' : 'Không đạt'}
                                    </div>
                                </div>
                            </div>
                            {log.issues && (
                                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3">
                                    <div className="text-[10px] font-black text-destructive uppercase mb-1 flex items-center gap-1"><AlertTriangle size={11} /> Vấn đề / Sự cố</div>
                                    <p className="text-sm text-destructive whitespace-pre-wrap">{log.issues}</p>
                                </div>
                            )}
                        </div>
                        <div className="rounded-2xl border border-border p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-xl bg-muted p-3">
                                    <div className="text-[9px] font-black text-muted-foreground uppercase">Người lập</div>
                                    <div className="text-sm font-bold text-foreground truncate">{log.createdBy || log.submittedBy || 'Không rõ'}</div>
                                </div>
                                <div className="rounded-xl bg-muted p-3">
                                    <div className="text-[9px] font-black text-muted-foreground uppercase">Người xác nhận</div>
                                    <div className="text-sm font-bold text-foreground truncate">{log.requestedVerifierName || log.verifiedBy || 'Chưa có'}</div>
                                </div>
                            </div>
                            {log.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE && (
                                <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-3">
                                    <div className="text-[9px] font-black text-teal-600 uppercase">Bản tổng hợp ngày</div>
                                    <div className="mt-1 text-xs font-bold text-teal-700">
                                        {log.summarizedByName || 'Kỹ thuật trưởng'} • {log.summaryContributionCount || 0} báo cáo nguồn
                                    </div>
                                </div>
                            )}
                            {sourceSummaryLog && (
                                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                                    <div className="text-[9px] font-black text-amber-600 uppercase">Phiếu nguồn đã tổng hợp</div>
                                    <div className="mt-1 text-xs font-bold text-amber-700">
                                        Nằm trong bản tổng hợp ngày {new Date(`${sourceSummaryLog.date}T00:00:00`).toLocaleDateString('vi-VN')} • {STATUS_CFG[getLogStatus(sourceSummaryLog)].label}
                                    </div>
                                </div>
                            )}
                            {log.gpsLat && log.gpsLng && (
                                <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-3 text-xs font-bold text-teal-400 flex items-center gap-2">
                                    <MapPin size={14} /> {log.gpsLat.toFixed(5)}, {log.gpsLng.toFixed(5)}
                                    {log.gpsAccuracy ? <span className="text-teal-500">±{Math.round(log.gpsAccuracy)}m</span> : null}
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-xl bg-amber-500/10 p-3">
                                    <div className="text-[9px] font-black text-amber-500 uppercase">Vật tư</div>
                                    <div className="text-sm font-black text-amber-400">{materialSummary}</div>
                                </div>
                                <div className="rounded-xl bg-blue-500/10 p-3">
                                    <div className="text-[9px] font-black text-blue-500 uppercase">Nhân công</div>
                                    <div className="text-sm font-black text-blue-400">{formatNumber(laborCount)} người</div>
                                </div>
                                <div className="rounded-xl bg-purple-500/10 p-3">
                                    <div className="text-[9px] font-black text-purple-500 uppercase">Máy TC</div>
                                    <div className="text-sm font-black text-purple-400">{formatNumber(machineShifts)} ca</div>
                                </div>
                            </div>

                            {/* Cán bộ tham gia */}
                            {participatingStaff.length > 0 && (
                                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                                    <div className="text-[10px] font-black text-muted-foreground uppercase">Cán bộ tham gia ({participatingStaff.length})</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {participatingStaff.map(staff => (
                                            <span key={staff.userId} className="inline-flex flex-col px-2.5 py-1 bg-background border border-border rounded-lg text-xs">
                                                <span className="font-semibold text-foreground">{staff.userName}</span>
                                                <span className="text-[10px] text-muted-foreground">{staff.positionName || 'Cán bộ'}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Supervisor Eval */}
                            {(log.supervisorConstructionEval || log.supervisorAcceptanceEval || log.supervisorSafetyOk !== undefined) && (
                                <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3">
                                    <div className="text-[10px] font-black text-muted-foreground uppercase">Đánh giá của Giám sát</div>
                                    {log.supervisorConstructionEval && (
                                        <div>
                                            <div className="text-[9px] font-bold text-muted-foreground uppercase">Nhận xét thi công</div>
                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{log.supervisorConstructionEval}</div>
                                        </div>
                                    )}
                                    {log.supervisorAcceptanceEval && (
                                        <div>
                                            <div className="text-[9px] font-bold text-muted-foreground uppercase">Nhận xét nghiệm thu</div>
                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{log.supervisorAcceptanceEval}</div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/60">
                                        <div className={`text-[10px] text-center font-bold p-1 rounded ${log.supervisorSafetyOk !== false ? 'text-emerald-400 bg-emerald-500/10' : 'text-destructive bg-destructive/10'}`}>
                                            ATLĐ: {log.supervisorSafetyOk !== false ? 'Đạt' : 'K.Đạt'}
                                        </div>
                                        <div className={`text-[10px] text-center font-bold p-1 rounded ${log.supervisorHygieneOk !== false ? 'text-emerald-400 bg-emerald-500/10' : 'text-destructive bg-destructive/10'}`}>
                                            VSMT: {log.supervisorHygieneOk !== false ? 'Đạt' : 'K.Đạt'}
                                        </div>
                                        <div className={`text-[10px] text-center font-bold p-1 rounded ${log.supervisorTrafficOk !== false ? 'text-emerald-400 bg-emerald-500/10' : 'text-destructive bg-destructive/10'}`}>
                                            ATGT: {log.supervisorTrafficOk !== false ? 'Đạt' : 'K.Đạt'}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {summarySourceLogs.length > 0 && (
                        <section className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <h4 className="text-xs font-black text-muted-foreground uppercase flex items-center gap-1">
                                    <FileText size={13} className="text-teal-600" /> Phiếu nguồn trong ngày
                                </h4>
                                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-black text-teal-700">
                                    {summarySourceLogs.length} phiếu
                                </span>
                            </div>
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                {summarySourceLogs.map(source => {
                                    const sourceStatus = getLogStatus(source);
                                    const canReturnSource = canReturnSourceLog?.(source) || false;
                                    return (
                                        <div key={source.id} className="rounded-xl border border-border bg-card p-3">
                                            <div className="mb-2 flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-foreground">{getLegacyDailyLogSourceName(source)}</div>
                                                    <div className="text-[10px] font-bold text-muted-foreground">
                                                        {source.submittedAt ? new Date(source.submittedAt).toLocaleString('vi-VN') : new Date(`${source.date}T00:00:00`).toLocaleDateString('vi-VN')}
                                                    </div>
                                                </div>
                                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black ${STATUS_CFG[sourceStatus].cls}`}>
                                                    {STATUS_CFG[sourceStatus].label}
                                                </span>
                                            </div>
                                            <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{source.description || 'Không có nội dung.'}</p>
                                            {source.issues && (
                                                <p className="mt-2 line-clamp-2 whitespace-pre-wrap rounded-lg bg-red-50 px-2 py-1.5 text-xs font-medium text-red-600">{source.issues}</p>
                                            )}
                                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                                <div className="text-[10px] font-bold text-muted-foreground">
                                                    {(source.photos || []).length} ảnh
                                                </div>
                                                {canReturnSource && onReturnSourceLog && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onReturnSourceLog(source)}
                                                        disabled={busy}
                                                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black text-red-700 hover:bg-red-100 disabled:opacity-50"
                                                    >
                                                        {busy ? 'Đang trả...' : 'Trả lại nguồn'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {(log.photos || []).length > 0 && (
                        <section className="rounded-2xl border border-border p-4">
                            <h4 className="text-xs font-black text-muted-foreground uppercase mb-3 flex items-center gap-1"><Camera size={13} /> Ảnh công trường</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                                {(log.photos || []).map((photo, index) => (
                                    <div 
                                        key={`${photo.url}-${index}`} 
                                        onClick={() => {
                                            if (onPreviewImage) {
                                                const galleryList = (log.photos || []).map((p, idx) => ({
                                                    url: p.url,
                                                    name: p.name || `Ảnh công trường ${idx + 1}`,
                                                    fileType: 'image/jpeg'
                                                }));
                                                onPreviewImage(galleryList, index);
                                            }
                                        }}
                                        className="group cursor-zoom-in"
                                    >
                                        <img src={photo.url} alt={photo.name || `Ảnh ${index + 1}`} className="w-full aspect-square object-cover rounded-xl border border-border group-hover:border-teal-500 hover:scale-[1.03] transition-all duration-200" />
                                        <div className="mt-1 text-[10px] font-bold text-muted-foreground truncate">{photo.sourceUserName || photo.name}</div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="rounded-2xl border-amber-500/20 p-4">
                        <h4 className="text-xs font-black text-muted-foreground uppercase mb-3 flex items-center gap-1"><Layers size={13} className="text-amber-600" /> Khối lượng</h4>
                        {displayVolumes.length === 0 ? (
                            <p className="text-xs font-bold text-muted-foreground">Chưa có khối lượng.</p>
                        ) : (
                            <div className="space-y-2">
                                {displayVolumes.map((row, index) => {
                                    const attachments = row.attachments || [];
                                    return (
                                        <div key={index} className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-black text-foreground truncate">{row.workBoqItemName || row.taskName || row.contractItemName || 'Hạng mục chưa đặt tên'}</div>
                                                    {row.workBoqItemName && row.taskName && row.workBoqItemName !== row.taskName && (
                                                        <div className="text-[10px] font-bold text-muted-foreground truncate">Tiến độ: {row.taskName}</div>
                                                    )}
                                                    {row.note && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{row.note}</p>}
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="text-base font-black text-amber-400">{formatNumber(row.quantity)} {row.unit}</div>
                                                </div>
                                            </div>
                                            {attachments.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {(() => {
                                                        const imageAttachments = attachments
                                                            .map(file => {
                                                                const label = file.name || file.fileName || 'Bằng chứng';
                                                                const attachmentUrl = normalizeAttachmentUrl(file);
                                                                return {
                                                                    ...file,
                                                                    url: attachmentUrl,
                                                                    name: label,
                                                                    isImg: attachmentUrl && isImageAttachment({ ...file, url: attachmentUrl })
                                                                };
                                                            })
                                                            .filter(item => item.isImg);

                                                        return attachments.map((file) => {
                                                            const label = file.name || file.fileName || 'Bằng chứng';
                                                            const attachmentUrl = normalizeAttachmentUrl(file);
                                                            const isImg = attachmentUrl && isImageAttachment({ ...file, url: attachmentUrl });
                                                            
                                                            if (isImg) {
                                                                const imgIndexInGallery = imageAttachments.findIndex(img => img.url === attachmentUrl);
                                                                return (
                                                                    <div 
                                                                        key={file.id || attachmentUrl} 
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (onPreviewImage) {
                                                                                const galleryList = imageAttachments.map(img => ({
                                                                                    url: img.url,
                                                                                    name: img.name,
                                                                                    fileType: 'image/jpeg'
                                                                                }));
                                                                                onPreviewImage(galleryList, imgIndexInGallery >= 0 ? imgIndexInGallery : 0);
                                                                            }
                                                                        }}
                                                                        className="group w-24 cursor-zoom-in"
                                                                    >
                                                                        <img src={attachmentUrl} alt={label} className="w-24 h-20 object-cover rounded-lg border border-white dark:border-slate-700/80 shadow-sm group-hover:border-blue-200 dark:group-hover:border-blue-500 hover:scale-[1.03] transition-all duration-200" />
                                                                        <div className="mt-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 truncate">{label}</div>
                                                                    </div>
                                                                );
                                                            }
                                                            return (
                                                                <a key={file.id || attachmentUrl || label} href={attachmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-card px-2 py-1 text-[10px] font-bold text-blue-400 border border-border hover:bg-muted">
                                                                    <Paperclip size={10} /> {label}
                                                                </a>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <section className="rounded-2xl border-orange-500/20 p-4">
                            <h4 className="text-xs font-black text-muted-foreground uppercase mb-3 flex items-center gap-1"><Package size={13} className="text-orange-500" /> Vật tư</h4>
                            {(log.materials || []).length === 0 ? <p className="text-xs font-bold text-muted-foreground">Chưa có vật tư.</p> : (
                                <div className="space-y-2">
                                    {(log.materials || []).map((row, index) => (
                                        <div key={index} className="flex items-start justify-between gap-2 text-xs rounded-xl bg-orange-500/5 p-2">
                                            <div className="min-w-0">
                                                <div className="font-black text-foreground truncate">{row.itemName}</div>
                                                {row.note && <div className="text-muted-foreground truncate">{row.note}</div>}
                                            </div>
                                            <div className="font-black text-orange-400 shrink-0">{formatNumber(row.quantity)} {row.unit}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                        <section className="rounded-2xl border-blue-500/20 p-4">
                            <h4 className="text-xs font-black text-muted-foreground uppercase mb-3 flex items-center gap-1"><Users size={13} className="text-blue-500" /> Nhân công</h4>
                            {(log.laborDetails || []).length === 0 ? <p className="text-xs font-bold text-muted-foreground">Chưa có nhân công.</p> : (
                                <div className="space-y-2">
                                    {(log.laborDetails || []).map((row, index) => (
                                        <div key={index} className="text-xs rounded-xl bg-blue-500/5 p-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="font-black text-foreground truncate">{row.catalogName || row.partnerName || row.groupName || row.laborType}</div>
                                                    <div className="text-muted-foreground truncate">{row.taskName || 'Chưa gắn hạng mục'}</div>
                                                </div>
                                                <div className="font-black text-blue-400 shrink-0">{formatNumber(row.count)} người</div>
                                            </div>
                                            <div className="mt-1 text-[10px] text-slate-400">Giờ: {formatNumber(row.hours || 0)} • Đơn giá: {formatMoney(row.unitCost)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                        <section className="rounded-2xl border-purple-500/20 p-4">
                            <h4 className="text-xs font-black text-muted-foreground uppercase mb-3 flex items-center gap-1"><Wrench size={13} className="text-purple-500" /> Máy thi công</h4>
                            {(log.machines || []).length === 0 ? <p className="text-xs font-bold text-muted-foreground">Chưa có máy thi công.</p> : (
                                <div className="space-y-2">
                                    {(log.machines || []).map((row, index) => (
                                        <div key={index} className="text-xs rounded-xl bg-purple-500/5 p-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="font-black text-foreground truncate">{row.catalogName || row.machineName}</div>
                                                    <div className="text-muted-foreground truncate">{row.taskName || row.groupName || 'Chưa gắn hạng mục'}</div>
                                                </div>
                                                <div className="font-black text-purple-400 shrink-0">{formatNumber(row.shifts)} ca</div>
                                            </div>
                                            <div className="mt-1 text-[10px] text-slate-400">Đơn giá: {formatMoney(row.unitCost)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>

                    {(log.delayTasks || []).length > 0 && (
                        <section className="rounded-2xl border-destructive/20 p-4">
                            <h4 className="text-xs font-black text-muted-foreground uppercase mb-3 flex items-center gap-1"><Clock size={13} className="text-red-500" /> Ghi nhận trễ tiến độ</h4>
                            <div className="space-y-2">
                                {(log.delayTasks || []).map((row, index) => (
                                    <div key={index} className="rounded-xl bg-destructive/5 p-3 text-xs">
                                        <div className="font-black text-slate-700">{row.taskName}</div>
                                        <div className="text-red-600 font-bold">{row.delayDays} ngày • {row.category}</div>
                                        {row.reason && <div className="mt-1 text-slate-500">{row.reason}</div>}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                <div className="px-4 sm:px-6 py-3 sm:py-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t border-border flex flex-wrap items-center justify-end gap-2">
                    {canReturn && (
                        <button onClick={onReject} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-bold text-destructive bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 flex items-center gap-1.5">
                            {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Trả lại
                        </button>
                    )}
                    {canVerify && (
                        <button onClick={onVerify} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
                            {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Xác nhận
                        </button>
                    )}
                    {canEdit && (
                        <button onClick={onEdit} className="px-4 py-2 rounded-xl text-sm font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 flex items-center gap-1.5">
                            <Edit2 size={15} /> Sửa phiếu
                        </button>
                    )}
                    {canRollback && (
                        <button onClick={onRollback} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-bold text-destructive bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 flex items-center gap-1.5">
                            {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Rollback
                        </button>
                    )}
                    {canSubmit && (
                        <button onClick={onSubmit} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 flex items-center gap-1.5">
                            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Gửi xác nhận
                        </button>
                    )}
                    {canDelete && (
                        <button onClick={onDelete} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-bold text-destructive bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 flex items-center gap-1.5">
                            <Trash2 size={15} /> Xoá phiếu
                        </button>
                    )}
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted">Đóng</button>
                </div>
            </div>
        </div>
    );
};

const DailyLogTab: React.FC<DailyLogTabProps> = ({ constructionSiteId, projectId, canManageTab = true }) => {
    const location = useLocation();
    const toast = useToast();
    const confirm = useConfirm();
    const reasonConfirm = useReasonConfirm();
    const { user, users, items: inventoryItems, warehouses, hrmConstructionSites, loadModuleData } = useApp();
    const effectiveId = projectId || constructionSiteId || '';
    const scopeKey = useMemo(() => getProjectScopeKey(projectId || null, constructionSiteId || null), [constructionSiteId, projectId]);
    const [logs, setLogs] = useState<DailyLog[]>([]);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [workBoqItems, setWorkBoqItems] = useState<ProjectWorkBoqItem[]>([]);
    const [laborCatalogs, setLaborCatalogs] = useState<ContractLaborCatalogItem[]>([]);
    const [machineCatalogs, setMachineCatalogs] = useState<ContractMachineCatalogItem[]>([]);
    const [businessPartners, setBusinessPartners] = useState<BusinessPartner[]>([]);
    const [savingLog, setSavingLog] = useState(false);
    const [importingProgressVolumes, setImportingProgressVolumes] = useState(false);
    const savingLogRef = useRef(false);
    const statusBusyRef = useRef<Set<string>>(new Set());
    const logRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const autoOpenedLogIdRef = useRef<string | null>(null);
    const [busyLogIds, setBusyLogIds] = useState<Set<string>>(new Set());
    const [highlightLogId, setHighlightLogId] = useState<string | null>(null);
    const [submitTarget, setSubmitTarget] = useState<DailyLog | null>(null);
    const [resolvedSubmitTarget, setResolvedSubmitTarget] = useState<DailyLogResponsibilityTarget | null>(null);
    const [resolvingSubmitTarget, setResolvingSubmitTarget] = useState(false);
    const [siteStaff, setSiteStaff] = useState<ProjectStaff[]>([]);
    const [summaryDate, setSummaryDate] = useState<string | null>(null);
    const [summarySaving, setSummarySaving] = useState(false);
    const [summaryLogId, setSummaryLogId] = useState<string>('');
    const [summaryApprovers, setSummaryApprovers] = useState<ProjectStaff[]>([]);
    const [summaryApproverUserId, setSummaryApproverUserId] = useState('');
    const [summaryWeather, setSummaryWeather] = useState<WeatherType>('sunny');
    const [summaryDescription, setSummaryDescription] = useState('');
    const [summaryIssues, setSummaryIssues] = useState('');
    const [summaryNextPlan, setSummaryNextPlan] = useState('');
    const [summaryPhotos, setSummaryPhotos] = useState<DailyLogPhoto[]>([]);
    const [selectedSummaryLegacyLogIds, setSelectedSummaryLegacyLogIds] = useState<string[]>([]);
    const [summarySourceSnapshots, setSummarySourceSnapshots] = useState<Record<string, DailyLogSummarySourceSnapshot>>({});

    // ── PBAC v2: Load explicit Daily Log actions ──
    const [dailyLogPerms, setDailyLogPerms] = useState<Set<DailyLogActionCode>>(new Set());
    const [pbacLoaded, setPbacLoaded] = useState(false);

    useEffect(() => {
        loadModuleData('wms-core');
    }, [loadModuleData]);

    const siteWarehouse = useMemo(() => {
        const activeSiteWarehouses = warehouses.filter(warehouse => !warehouse.isArchived && warehouse.type === 'SITE');
        if (activeSiteWarehouses.length === 0) return undefined;
        const site = constructionSiteId ? hrmConstructionSites.find(item => item.id === constructionSiteId) : undefined;
        const siteName = normalizeLookupText(site?.name);
        if (!siteName) return undefined;
        const exactName = activeSiteWarehouses.find(warehouse => normalizeLookupText(warehouse.name).includes(siteName));
        if (exactName) return exactName;
        const tokens = siteName.split(' ').filter(token => token.length > 1 && !SITE_WAREHOUSE_STOP_WORDS.has(token));
        if (tokens.length === 0) return undefined;
        return activeSiteWarehouses.find(warehouse => {
            const warehouseName = normalizeLookupText(warehouse.name);
            return tokens.every(token => warehouseName.includes(token));
        }) || activeSiteWarehouses.find(warehouse => {
            const warehouseName = normalizeLookupText(warehouse.name);
            return tokens.some(token => warehouseName.includes(token));
        });
    }, [constructionSiteId, hrmConstructionSites, warehouses]);

    useEffect(() => {
        setPbacLoaded(false);
        setDailyLogPerms(new Set());
        if (!effectiveId) return;
        const loadPerms = async () => {
            try {
                if (user?.role === 'ADMIN') {
                    setDailyLogPerms(new Set(ALL_DAILY_LOG_PERMISSION_CODES));
                    setPbacLoaded(true);
                    return;
                }
                if (!user?.id) {
                    setPbacLoaded(true);
                    return;
                }

                const permsToCheck = ALL_DAILY_LOG_PERMISSION_CODES;
                const results = await Promise.all(
                    permsToCheck.map(async code => {
                        const r = await projectStaffService.checkProjectAction({
                            userId: user.id,
                            projectId: projectId || null,
                            constructionSiteId: constructionSiteId || null,
                            permissionCode: code,
                        });
                        return { code, allowed: r.allowed };
                    })
                );
                setDailyLogPerms(new Set(results.filter(r => r.allowed).map(r => r.code)));
            } catch (err) {
                console.warn('PBAC load failed', err);
                setDailyLogPerms(new Set());
            } finally {
                setPbacLoaded(true);
            }
        };
        loadPerms();
    }, [effectiveId, user?.id, user?.role, constructionSiteId, projectId]);

    const hasDailyLogAction = useCallback((code: DailyLogActionCode) => (
        user?.role === 'ADMIN' || dailyLogPerms.has(code)
    ), [dailyLogPerms, user?.role]);

    const ensureDailyLogAction = useCallback((code: DailyLogActionCode, actionLabel: string) => {
        if (user?.role === 'ADMIN') return true;
        if (!pbacLoaded) {
            toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
            return false;
        }
        if (!dailyLogPerms.has(code)) {
            toast.error('Không có quyền', `Bạn cần quyền "${code}" để ${actionLabel}.`);
            return false;
        }
        return true;
    }, [dailyLogPerms, pbacLoaded, toast, user?.role]);

    const requireDailyLogAction = useCallback(async (code: DailyLogActionCode, actionLabel: string) => {
        if (!ensureDailyLogAction(code, actionLabel)) return false;
        if (user?.role === 'ADMIN') return true;
        if (!user?.id) return false;

        try {
            await projectStaffService.requireProjectAction({
                userId: user.id,
                projectId: projectId || null,
                constructionSiteId: constructionSiteId || null,
                permissionCode: code,
                actionLabel,
            });
            return true;
        } catch (err: any) {
            toast.error('Không có quyền', err?.message || `Bạn cần quyền "${code}" để ${actionLabel}.`);
            return false;
        }
    }, [constructionSiteId, ensureDailyLogAction, projectId, toast, user?.id, user?.role]);

    const requireDailyLogResponsibilityRoom = useCallback(async (
        log: DailyLog,
        target: DailyLogResponsibilityTarget,
    ) => {
        const roomContext = {
            roomCode: 'daily_log' as const,
            actionCode: target.responsibility === 'current_approver' ? 'approve' as const : 'verify' as const,
        };
        const scopedProjectId = projectId || log.projectId;
        if (!scopedProjectId) {
            toast.error('Chưa xác định dự án', 'Không thể kiểm tra Room của người nhận nhật ký.');
            return false;
        }
        const allowed = await projectPermissionRoomService.hasAction(
            target.userId,
            scopedProjectId,
            constructionSiteId || log.constructionSiteId || null,
            roomContext.roomCode,
            roomContext.actionCode,
        );
        if (!allowed) {
            toast.error('Người nhận chưa thuộc Room', `Người chịu trách nhiệm chưa có quyền ${roomContext.actionCode === 'approve' ? 'duyệt' : 'kiểm tra'} trong Room Nhật ký công trường.`);
        }
        return allowed;
    }, [constructionSiteId, projectId, toast]);

    const reloadDailyLogRecords = useCallback(async () => {
        if (!effectiveId) return;
        const staffPromise = projectId
            ? projectStaffService.listByProject(projectId, constructionSiteId || undefined)
            : constructionSiteId
                ? projectStaffService.listBySite(constructionSiteId)
                : Promise.resolve([] as ProjectStaff[]);

        const [
            logRows,
            taskRows,
            workBoqRows,
            laborRows,
            machineRows,
            partnerRows,
            staffRows,
        ] = await Promise.all([
            dailyLogService.list(effectiveId, constructionSiteId || null),
            taskService.list(effectiveId, constructionSiteId || null),
            workBoqService.list(effectiveId, constructionSiteId || null),
            contractLaborCatalogService.list(),
            contractMachineCatalogService.list(),
            partnerService.list(),
            staffPromise,
        ]);
        setLogs(logRows);
        setTasks(taskRows);
        setWorkBoqItems(workBoqRows);
        setLaborCatalogs(laborRows);
        setMachineCatalogs(machineRows);
        setBusinessPartners(partnerRows);
        setSiteStaff(uniqueStaffByUser(staffRows || []));
    }, [effectiveId, constructionSiteId, projectId]);

    useEffect(() => {
        reloadDailyLogRecords().catch(console.error);
    }, [reloadDailyLogRecords]);

    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<DailyLog | null>(null);
    const [filterMonth, setFilterMonth] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterWeather, setFilterWeather] = useState<string>('all');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    const [calendarMonth, setCalendarMonth] = useState(monthKeyFromDate(new Date()));
    const [dayLogPicker, setDayLogPicker] = useState<{ date: string; logs: DailyLog[] } | null>(null);
    const [viewLogId, setViewLogId] = useState<string | null>(null);
    const [galleryAttachments, setGalleryAttachments] = useState<{ url: string; name: string; fileType?: string }[] | null>(null);
    const [galleryIndex, setGalleryIndex] = useState<number>(0);

    // Form state
    const [fDate, setFDate] = useState(new Date().toISOString().split('T')[0]);
    const [fWeather, setFWeather] = useState<WeatherType>('sunny');
    const [fDesc, setFDesc] = useState('');
    const [fAcceptanceDesc, setFAcceptanceDesc] = useState('');
    const [fWorkSafetyOk, setFWorkSafetyOk] = useState(true);
    const [fEnvHygieneOk, setFEnvHygieneOk] = useState(true);
    const [fTrafficSafetyOk, setFTrafficSafetyOk] = useState(true);
    const [fSupervisorConstructionEval, setFSupervisorConstructionEval] = useState('');
    const [fSupervisorAcceptanceEval, setFSupervisorAcceptanceEval] = useState('');
    const [fSupervisorSafetyOk, setFSupervisorSafetyOk] = useState(true);
    const [fSupervisorHygieneOk, setFSupervisorHygieneOk] = useState(true);
    const [fSupervisorTrafficOk, setFSupervisorTrafficOk] = useState(true);
    const [fIssues, setFIssues] = useState('');

    const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
    const [gpsLoading, setGpsLoading] = useState(false);

    const [photoRequired, setPhotoRequired] = useState(true);
    const [fPhotos, setFPhotos] = useState<{ name: string; url: string }[]>([]);
    const [uploading, setUploading] = useState(false);

    const [fDelayTasks, setFDelayTasks] = useState<DelayTaskEntry[]>([]);
    const [fNextDayPlan, setFNextDayPlan] = useState('');
    const [fStaffIds, setFStaffIds] = useState<string[]>([]);

    // FastCons detail states
    const [fVolumes, setFVolumes] = useState<DailyLogVolume[]>([]);
    const [fMaterials, setFMaterials] = useState<DailyLogMaterial[]>([]);
    const [fLabor, setFLabor] = useState<DailyLogLabor[]>([]);
    const [fMachines, setFMachines] = useState<DailyLogMachine[]>([]);

    const targetDailyLogId = useMemo(() => new URLSearchParams(location.search).get('dailyLogId'), [location.search]);

    const buildDailyLogLink = useCallback((logId: string) => {
        const params = new URLSearchParams();
        if (projectId) params.set('projectId', projectId);
        if (constructionSiteId) params.set('siteId', constructionSiteId);
        params.set('tab', 'dailylog');
        params.set('dailyLogId', logId);
        return `/#/da?${params.toString()}`;
    }, [constructionSiteId, projectId]);

    const buildDailyLogReportLink = useCallback(() => {
        const params = new URLSearchParams();
        if (projectId) params.set('projectId', projectId);
        if (constructionSiteId) params.set('siteId', constructionSiteId);
        params.set('tab', 'report');
        params.set('reportView', 'dailylog');
        return `/#/da?${params.toString()}`;
    }, [constructionSiteId, projectId]);

    const isAdminUser = user?.role === 'ADMIN';

    const isDailyLogOwner = useCallback((log: DailyLog) => {
        if (!user?.id) return false;
        return log.createdById === user.id
            || log.submittedById === user.id
            || log.submittedBy === user.id
            || log.createdBy === user.id
            || (!!user.name && log.createdBy === user.name);
    }, [user?.id, user?.name]);

    const getDailyLogEditAction = useCallback((log: DailyLog): DailyLogActionCode => (
        isDailyLogOwner(log) ? DAILY_LOG_ACTION.editOwn : DAILY_LOG_ACTION.editAll
    ), [isDailyLogOwner]);

    const getDailyLogDeleteAction = useCallback((log: DailyLog): DailyLogActionCode => (
        isDailyLogOwner(log) ? DAILY_LOG_ACTION.deleteOwn : DAILY_LOG_ACTION.deleteAll
    ), [isDailyLogOwner]);

    const canEditDailyLog = useCallback((log: DailyLog) => {
        const editableStatus = ['draft', 'rejected'].includes(getLogStatus(log));
        if (isAdminUser) return editableStatus;
        return editableStatus && hasDailyLogAction(getDailyLogEditAction(log));
    }, [getDailyLogEditAction, hasDailyLogAction, isAdminUser]);

    const canDeleteDailyLog = useCallback((log: DailyLog) => {
        const editableStatus = ['draft', 'rejected'].includes(getLogStatus(log));
        if (isAdminUser) return editableStatus;
        return editableStatus && hasDailyLogAction(getDailyLogDeleteAction(log));
    }, [getDailyLogDeleteAction, hasDailyLogAction, isAdminUser]);

    const canSubmitDailyLog = useCallback((log: DailyLog) => {
        const editableStatus = ['draft', 'rejected'].includes(getLogStatus(log));
        if (isAdminUser) return editableStatus;
        return editableStatus && isDailyLogOwner(log) && hasDailyLogAction(DAILY_LOG_ACTION.submit);
    }, [hasDailyLogAction, isAdminUser, isDailyLogOwner]);

    const resetForm = () => {
        if (savingLogRef.current) return;
        setEditing(null);
        setFDate(new Date().toISOString().split('T')[0]);
        setFWeather('sunny'); setFDesc(''); setFIssues('');
        setFAcceptanceDesc('');
        setFNextDayPlan('');
        setFStaffIds([]);
        setFWorkSafetyOk(true); setFEnvHygieneOk(true); setFTrafficSafetyOk(true);
        setFSupervisorConstructionEval(''); setFSupervisorAcceptanceEval('');
        setFSupervisorSafetyOk(true); setFSupervisorHygieneOk(true); setFSupervisorTrafficOk(true);
        setGpsCoords(null);
        setFPhotos([]);
        setPhotoRequired(true);
        setFDelayTasks([]);
        setFVolumes([]); setFMaterials([]); setFLabor([]); setFMachines([]);
        setShowForm(false);
    };

    const openEdit = (l: DailyLog) => {
        if (!canEditDailyLog(l)) {
            toast.info('Phiếu đã khoá', 'Chỉ người lập được sửa nhật ký ở trạng thái nháp hoặc bị trả lại.');
            return;
        }
        setEditing(l);
        setFDate(l.date); setFWeather(l.weather);
        setFDesc(l.description); setFIssues(l.issues || '');
        setFAcceptanceDesc(l.acceptanceDescription || '');
        setFNextDayPlan(l.nextDayPlan || '');
        setFStaffIds(l.staffIds || []);
        setFWorkSafetyOk(l.workSafetyOk ?? true);
        setFEnvHygieneOk(l.envHygieneOk ?? true);
        setFTrafficSafetyOk(l.trafficSafetyOk ?? true);
        setFSupervisorConstructionEval(l.supervisorConstructionEval || '');
        setFSupervisorAcceptanceEval(l.supervisorAcceptanceEval || '');
        setFSupervisorSafetyOk(l.supervisorSafetyOk ?? true);
        setFSupervisorHygieneOk(l.supervisorHygieneOk ?? true);
        setFSupervisorTrafficOk(l.supervisorTrafficOk ?? true);
        setGpsCoords(l.gpsLat && l.gpsLng ? { lat: l.gpsLat, lng: l.gpsLng, accuracy: l.gpsAccuracy || 0 } : null);
        setFPhotos(l.photos || []);
        setPhotoRequired(l.photoRequired ?? true);
        setFDelayTasks(l.delayTasks || []);
        setFVolumes(l.volumes || []); setFMaterials(l.materials || []);
        setFLabor(l.laborDetails || []); setFMachines(l.machines || []);
        setShowForm(true);
    };

    const openView = (l: DailyLog) => {
        setViewLogId(l.id);
        setDayLogPicker(null);
    };

    const viewingLog = useMemo(() => (
        viewLogId ? logs.find(log => log.id === viewLogId) || null : null
    ), [logs, viewLogId]);

    useEffect(() => {
        if (!targetDailyLogId || logs.length === 0) return;
        const target = logs.find(log => log.id === targetDailyLogId);
        if (!target) return;
        setViewMode('list');
        setFilterMonth(target.date.slice(0, 7));
        setHighlightLogId(targetDailyLogId);
        if (autoOpenedLogIdRef.current !== targetDailyLogId) {
            autoOpenedLogIdRef.current = targetDailyLogId;
            setViewLogId(targetDailyLogId);
        }
        window.requestAnimationFrame(() => {
            logRefs.current[targetDailyLogId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const timeout = window.setTimeout(() => setHighlightLogId(null), 5000);
        return () => window.clearTimeout(timeout);
    }, [logs, targetDailyLogId]);

    const openCreateForDate = (date: string) => {
        if (!ensureDailyLogAction(DAILY_LOG_ACTION.create, 'ghi nhật ký')) return;
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
            openView(dayLogs[0]);
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

    const openSummaryForDate = useCallback(async (date: string) => {
        if (!(await requireDailyLogAction(DAILY_LOG_ACTION.summarize, 'tổng hợp nhật ký'))) return;
        const dayLogs = logs.filter(log => log.date === date);
        const existingSummary = dayLogs.find(isSummaryDailyLog);
        const id = existingSummary?.id || crypto.randomUUID();
        const metadata = existingSummary?.summarySourceMetadata || {};
        const metadataLegacyLogIds = toStringArray(metadata.legacyDailyLogIds);
        const metadataSourceSnapshots = getDailyLogSummarySourceSnapshots(metadata);
        const approvers = projectId
            ? await projectPermissionRoomService.listRecipients(projectId, constructionSiteId, 'daily_log', 'approve')
            : [];

        setSummaryDate(date);
        setSummaryLogId(id);
        setSummaryApprovers(approvers);
        setSummaryApproverUserId(
            existingSummary?.submittedToUserId && approvers.some(staff => staff.userId === existingSummary.submittedToUserId)
                ? existingSummary.submittedToUserId
                : approvers.length === 1
                    ? approvers[0].userId
                    : '',
        );
        setSummaryWeather(existingSummary?.weather || 'sunny');
        setSummaryDescription(existingSummary?.description || '');
        setSummaryIssues(existingSummary?.issues || '');
        setSummaryNextPlan(existingSummary?.nextDayPlan || '');
        setSummaryPhotos(existingSummary?.photos || []);
        setSelectedSummaryLegacyLogIds(existingSummary ? metadataLegacyLogIds : []);
        setSummarySourceSnapshots(existingSummary ? metadataSourceSnapshots : {});
    }, [constructionSiteId, logs, projectId, requireDailyLogAction]);

    const closeSummary = (force = false) => {
        if (!force && summarySaving) return;
        setSummaryDate(null);
        setSummaryLogId('');
        setSummaryApprovers([]);
        setSummaryApproverUserId('');
        setSummaryDescription('');
        setSummaryIssues('');
        setSummaryNextPlan('');
        setSummaryPhotos([]);
        setSelectedSummaryLegacyLogIds([]);
        setSummarySourceSnapshots({});
    };

    const includeLegacyLogInSummary = (log: DailyLog) => {
        const prefix = getLegacyDailyLogSourceName(log);
        setSummaryDescription(prev => `${prev ? `${prev.trim()}\n` : ''}- ${prefix}: ${log.description}`.trim());
        if (log.issues?.trim()) {
            setSummaryIssues(prev => `${prev ? `${prev.trim()}\n` : ''}- ${prefix}: ${log.issues}`.trim());
        }
        const sourcePhotos = getLegacyDailyLogSourcePhotos(log);
        setSummaryPhotos(prev => {
            const knownUrls = new Set(prev.map(photo => photo.url));
            return [...prev, ...sourcePhotos.filter(photo => !knownUrls.has(photo.url))];
        });
        setSelectedSummaryLegacyLogIds(prev => prev.includes(log.id) ? prev : [...prev, log.id]);
        setSummarySourceSnapshots(prev => ({
            ...prev,
            [log.id]: buildDailyLogSourceSnapshot(log),
        }));
    };

    const removeLegacyLogFromSummary = (log: DailyLog) => {
        const sourceContributionId = `legacy-daily-log:${log.id}`;
        setSelectedSummaryLegacyLogIds(prev => prev.filter(id => id !== log.id));
        setSummarySourceSnapshots(prev => {
            const next = { ...prev };
            delete next[log.id];
            return next;
        });
        setSummaryPhotos(prev => prev.filter(photo => photo.sourceContributionId !== sourceContributionId));
    };

    const saveSummary = async (submitNow = false) => {
        if (!summaryDate || !summaryLogId) return;
        if (!(await requireDailyLogAction(DAILY_LOG_ACTION.summarize, 'lưu bản tổng hợp'))) return;
        if (submitNow && !(await requireDailyLogAction(DAILY_LOG_ACTION.submit, 'gửi bản tổng hợp'))) return;
        const summaryApprover = summaryApprovers.find(staff => staff.userId === summaryApproverUserId);
        if (submitNow && !summaryApprover) {
            toast.warning('Chưa chọn CHT duyệt', 'Vui lòng chọn người có quyền duyệt trong Room Nhật ký công trường.');
            return;
        }
        if (!summaryDescription.trim() && summaryPhotos.length === 0) {
            toast.warning('Thiếu nội dung tổng hợp', 'Vui lòng nhập nội dung hoặc chọn ảnh từ báo cáo thành viên.');
            return;
        }
        const selectedLegacyLogs = selectedSummaryLegacyLogIds
            .map(sourceId => logs.find(log => log.id === sourceId))
            .filter((log): log is DailyLog => Boolean(log));
        if (submitNow) {
            const blockingSource = selectedLegacyLogs.find(log => {
                const state = getDailyLogSourceReviewState({
                    sourceLog: log,
                    included: true,
                    snapshot: summarySourceSnapshots[log.id] || null,
                });
                return state === 'returned' || state === 'needs_rereview' || state === 'waiting_review';
            });
            if (blockingSource) {
                const state = getDailyLogSourceReviewState({
                    sourceLog: blockingSource,
                    included: true,
                    snapshot: summarySourceSnapshots[blockingSource.id] || null,
                });
                const actionText = state === 'returned'
                    ? 'Phiếu nguồn đang được trả lại, hãy bỏ khỏi tổng hợp hoặc chờ nhân viên gửi lại.'
                    : 'Phiếu nguồn đã thay đổi, hãy cập nhật từ phiếu hoặc bỏ khỏi tổng hợp.';
                toast.warning('Còn phiếu nguồn cần rà soát', `${getLegacyDailyLogSourceName(blockingSource)}: ${actionText}`);
                return;
            }
        }
        setSummarySaving(true);
        try {
            const existing = logs.find(log => log.id === summaryLogId);
            const summaryVolumes = buildDailyLogSummaryVolumes(selectedLegacyLogs);
            const sourceSnapshots = selectedLegacyLogs.reduce<Record<string, DailyLogSummarySourceSnapshot>>((acc, log) => {
                acc[log.id] = summarySourceSnapshots[log.id] || buildDailyLogSourceSnapshot(log);
                return acc;
            }, {});
            const summarySourceMetadata = {
                legacyDailyLogIds: selectedSummaryLegacyLogIds,
                sourceSnapshots,
            };
            const item: DailyLog = existing ? {
                ...existing,
                date: summaryDate,
                weather: summaryWeather,
                description: summaryDescription.trim(),
                issues: summaryIssues.trim() || undefined,
                nextDayPlan: summaryNextPlan.trim() || undefined,
                photos: summaryPhotos,
                volumes: summaryVolumes,
                summarySourceType: DAILY_SUMMARY_SOURCE_TYPE,
                summaryContributionCount: selectedLegacyLogs.length,
                summarySourceMetadata,
                summarizedById: user?.id || null,
                summarizedByName: user?.name || user?.username || user?.id || null,
                summarizedAt: new Date().toISOString(),
            } : {
                id: summaryLogId,
                projectId: projectId || constructionSiteId || null,
                constructionSiteId: constructionSiteId || null,
                date: summaryDate,
                weather: summaryWeather,
                workerCount: 0,
                description: summaryDescription.trim(),
                issues: summaryIssues.trim() || undefined,
                nextDayPlan: summaryNextPlan.trim() || undefined,
                photos: summaryPhotos,
                photoRequired: false,
                verified: false,
                status: 'draft',
                submittedToPermission: 'approve',
                summarySourceType: DAILY_SUMMARY_SOURCE_TYPE,
                summaryContributionCount: selectedLegacyLogs.length,
                summarySourceMetadata,
                summarizedById: user?.id || null,
                summarizedByName: user?.name || user?.username || user?.id || null,
                summarizedAt: new Date().toISOString(),
                createdBy: user?.name || user?.id || 'admin',
                createdById: user?.id,
                createdAt: new Date().toISOString(),
                volumes: summaryVolumes,
                materials: [],
                laborDetails: [],
                machines: [],
            };
            await dailyLogService.upsert(item);
            if (submitNow) {
                await dailyLogService.updateStatus({
                    logId: summaryLogId,
                    status: 'submitted',
                    requestedVerifierId: summaryApproverUserId,
                    requestedVerifierName: summaryApprover?.userName || null,
                    actorUserId: user?.id,
                });
                await notificationService.notifyProjectUsers({
                    recipientIds: [summaryApproverUserId],
                    actorId: user?.id,
                    type: 'info',
                    category: 'progress',
                    title: 'Nhật ký ngày chờ CHT duyệt',
                    message: `Nhật ký tổng hợp ngày ${new Date(`${summaryDate}T00:00:00`).toLocaleDateString('vi-VN')} đang chờ duyệt`,
                    severity: 'info',
                    icon: '✅',
                    link: buildDailyLogLink(summaryLogId),
                    sourceType: 'dailylog_summary_submitted',
                    sourceId: `dailylog_summary_${summaryLogId}_${summaryApproverUserId}_${Date.now()}`,
                    constructionSiteId: constructionSiteId || undefined,
                    metadata: {
                        logId: summaryLogId,
                        date: summaryDate,
                        projectId,
                        constructionSiteId,
                        assignmentResponsibility: 'current_approver',
                        assignmentUserId: summaryApproverUserId,
                    },
                }).catch(err => console.warn('Cannot notify responsibility assignee', err?.message || err));
            }
            await reloadDailyLogRecords();
            toast.success(submitNow ? 'Đã gửi CHT duyệt' : 'Đã lưu bản tổng hợp');
            closeSummary(true);
        } catch (err: any) {
            toast.error('Không lưu được bản tổng hợp', err?.message || 'Vui lòng thử lại.');
        } finally {
            setSummarySaving(false);
        }
    };

    const handleImportDailyProgressVolumes = useCallback(async () => {
        if (!fDate) {
            toast.warning('Chưa chọn ngày nhật ký');
            return;
        }
        if (!scopeKey) {
            toast.warning('Chưa xác định dự án', 'Cần chọn dự án/công trường trước khi lấy khối lượng.');
            return;
        }

        const dateLabel = new Date(`${fDate}T00:00:00`).toLocaleDateString('vi-VN');
        setImportingProgressVolumes(true);
        try {
            const dailyProgressRows = await projectWeeklyProgressService.listDailyByDate(scopeKey, fDate);
            if (dailyProgressRows.length === 0) {
                toast.info('Chưa có dữ liệu chốt tiến độ ngày', `Ngày ${dateLabel} chưa có dòng tiến độ đã chốt.`);
                return;
            }

            const result = buildDailyLogVolumesFromDailyProgress({
                dailyProgressRows,
                tasks,
                workBoqItems,
                existingVolumes: [],
            });

            if (result.volumes.length === 0) {
                toast.info(
                    'Chưa có dữ liệu chốt tiến độ ngày',
                    `Ngày ${dateLabel} chưa có khối lượng chốt phù hợp để hiển thị.`,
                );
                return;
            }

            setFVolumes(result.volumes);
            toast.success('Đã lấy khối lượng từ chốt tiến độ', `Hiển thị ${result.volumes.length} dòng cho ngày ${dateLabel}.`);
        } catch (error: any) {
            console.error(error);
            toast.error('Không thể lấy khối lượng', error?.message || 'Vui lòng thử lại.');
        } finally {
            setImportingProgressVolumes(false);
        }
    }, [fDate, scopeKey, tasks, toast, workBoqItems]);

    const handleSave = async () => {
        if (savingLogRef.current) return;
        if (!fDate || !fDesc) return;
        const requiredAction = editing ? getDailyLogEditAction(editing) : DAILY_LOG_ACTION.create;
        if (!(await requireDailyLogAction(requiredAction, editing ? 'cập nhật nhật ký' : 'tạo nhật ký'))) return;
        if (editing && !canEditDailyLog(editing)) {
            toast.error('Phiếu đã khoá', 'Nhật ký đã gửi đi chỉ được sửa khi bị trả lại.');
            return;
        }
        if (editing) {
            const deps = await projectDocumentDependencyService.getDailyLogDependencies(editing);
            const policy = getProjectDocumentPolicy({
                action: 'edit',
                documentType: 'daily_log',
                status: getLogStatus(editing),
                user,
                permissions: dailyLogPerms,
                dependencies: deps,
                relatedUserIds: [editing.createdById, editing.submittedById, editing.submittedBy],
                documentLabel: new Date(editing.date).toLocaleDateString('vi-VN'),
            });
            if (!policy.allowed) {
                await projectDocumentActionLogService.logBlocked({
                    projectId: projectId || editing.projectId || effectiveId,
                    constructionSiteId: constructionSiteId || editing.constructionSiteId || null,
                    documentType: 'daily_log',
                    documentId: editing.id,
                    documentLabel: new Date(editing.date).toLocaleDateString('vi-VN'),
                    action: 'edit',
                    fromStatus: getLogStatus(editing),
                    blockedReason: policy.reason,
                    requiredRollbackSteps: policy.requiredRollbackSteps,
                    metadata: deps.metadata,
                    createdBy: user?.id,
                });
                toast.error('Không thể sửa nhật ký', formatPolicyMessage(policy));
                return;
            }
        }
        if (photoRequired && fPhotos.length === 0) {
            toast.error('Cần ít nhất 1 ảnh công trường');
            return;
        }
        const overStockMaterial = siteWarehouse ? fMaterials.find(material => {
            const item = material.materialId ? inventoryItems.find(inventory => inventory.id === material.materialId) : undefined;
            if (!item) return false;
            const siteStock = Number(item.stockByWarehouse?.[siteWarehouse.id] || 0);
            return Number(material.quantity || 0) > siteStock + 0.000001;
        }) : undefined;
        if (overStockMaterial) {
            toast.error('Vật tư vượt tồn kho công trường', `${overStockMaterial.itemName} đang vượt tồn tại ${siteWarehouse.name}. Vui lòng kiểm tra lại phiếu cấp vật tư hoặc kho công trường.`);
            return;
        }

        savingLogRef.current = true;
        setSavingLog(true);
        try {
            const workerCount = getWorkerCountFromLabor(fLabor);
            const baseItem = {
                date: fDate, weather: fWeather, workerCount,
                description: fDesc, issues: fIssues || undefined,
                acceptanceDescription: fAcceptanceDesc || undefined,
                nextDayPlan: fNextDayPlan || undefined,
                staffIds: fStaffIds,
                workSafetyOk: fWorkSafetyOk,
                envHygieneOk: fEnvHygieneOk,
                trafficSafetyOk: fTrafficSafetyOk,
                supervisorConstructionEval: fSupervisorConstructionEval || undefined,
                supervisorAcceptanceEval: fSupervisorAcceptanceEval || undefined,
                supervisorSafetyOk: fSupervisorSafetyOk,
                supervisorHygieneOk: fSupervisorHygieneOk,
                supervisorTrafficOk: fSupervisorTrafficOk,
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
                createdBy: user?.name || user?.id || 'admin', createdById: user?.id, createdAt: new Date().toISOString(),
            };
            await dailyLogService.upsert(item);
            const nextLogs = await dailyLogService.list(effectiveId, constructionSiteId || null);
            setLogs(nextLogs);
            toast.success(editing ? 'Cập nhật nhật ký' : 'Ghi nhật ký thành công');
            resetForm();
        } catch (e: any) {
            toast.error('Lỗi lưu nhật ký', e?.message);
        } finally {
            savingLogRef.current = false;
            setSavingLog(false);
        }
    };

    const beginStatusAction = (logId: string) => {
        if (statusBusyRef.current.has(logId)) return false;
        statusBusyRef.current.add(logId);
        setBusyLogIds(new Set(statusBusyRef.current));
        return true;
    };

    const endStatusAction = (logId: string) => {
        statusBusyRef.current.delete(logId);
        setBusyLogIds(new Set(statusBusyRef.current));
    };

    const handleStatusChange = async (
        log: DailyLog,
        status: DailyLogStatus,
        responsibilityTarget?: DailyLogResponsibilityTarget,
        rejectionReason?: string,
    ): Promise<boolean> => {
        if (!beginStatusAction(log.id)) return false;
        // ── PBAC Check ──
        const requiredAction = log.submittedToPermission === 'approve' && status === 'verified'
            ? DAILY_LOG_ACTION.approve
            : DAILY_LOG_STATUS_PERMISSION[status];
        if (requiredAction && !(await requireDailyLogAction(
            requiredAction,
            status === 'submitted' ? 'gửi nhật ký' : status === 'verified' ? 'xác nhận nhật ký' : 'trả lại nhật ký',
        ))) {
            endStatusAction(log.id);
            return false;
        }

        try {
            const subjectAction: 'submit' | 'verify' | 'approve' | 'return' = status === 'submitted'
                ? 'submit'
                : status === 'rejected'
                    ? 'return'
                    : log.submittedToPermission === 'approve'
                        ? 'approve'
                        : 'verify';
            if (!(await subjectAuthorizationService.canAct('daily_log', log.id, subjectAction))) {
                throw new Error('Bạn không có quyền, phạm vi hoặc assignment đang hiệu lực để xử lý nhật ký này.');
            }

            if (status === 'submitted') {
                responsibilityTarget = responsibilityTarget
                    || await subjectAuthorizationService.getDailyLogResponsibilityTarget(log.id);
                if (!responsibilityTarget || !(await requireDailyLogResponsibilityRoom(log, responsibilityTarget))) {
                    return false;
                }
            }
            if (status === 'submitted' || status === 'verified') {
                const reviewAction = status === 'verified' && log.submittedToPermission === 'approve' ? 'approve' : 'verify';
                const policy = getProjectDocumentPolicy({
                    action: status === 'submitted' ? 'submit' : reviewAction,
                    documentType: 'daily_log',
                    status: getLogStatus(log),
                    user,
                    permissions: dailyLogPerms,
                    relatedUserIds: [log.createdById, log.submittedById, log.submittedBy],
                    currentHandlerIds: [log.requestedVerifierId, log.submittedToUserId],
                    everSubmitted: log.everSubmitted,
                    documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                });
                if (!policy.allowed) {
                    await projectDocumentActionLogService.logBlocked({
                        projectId: projectId || log.projectId || effectiveId,
                        constructionSiteId: constructionSiteId || log.constructionSiteId || null,
                        documentType: 'daily_log',
                        documentId: log.id,
                        documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                        action: status === 'submitted' ? 'submit' : reviewAction,
                        fromStatus: getLogStatus(log),
                        blockedReason: policy.reason,
                        requiredRollbackSteps: policy.requiredRollbackSteps,
                        createdBy: user?.id,
                    });
                    toast.error(status === 'submitted' ? 'Không thể gửi nhật ký' : 'Không thể xác nhận nhật ký', formatPolicyMessage(policy));
                    endStatusAction(log.id);
                    return false;
                }
            }
            if (status === 'rejected') {
                const policy = getProjectDocumentPolicy({
                    action: 'return',
                    documentType: 'daily_log',
                    status: getLogStatus(log),
                    user,
                    permissions: dailyLogPerms,
                    relatedUserIds: [log.createdById, log.submittedById, log.submittedBy],
                    currentHandlerIds: [log.requestedVerifierId, log.submittedToUserId],
                    reason: rejectionReason,
                    documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                });
                if (!policy.allowed) {
                    await projectDocumentActionLogService.logBlocked({
                        projectId: projectId || log.projectId || effectiveId,
                        constructionSiteId: constructionSiteId || log.constructionSiteId || null,
                        documentType: 'daily_log',
                        documentId: log.id,
                        documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                        action: 'return',
                        fromStatus: getLogStatus(log),
                        reason: rejectionReason,
                        blockedReason: policy.reason,
                        requiredRollbackSteps: policy.requiredRollbackSteps,
                        createdBy: user?.id,
                    });
                    toast.error('Không thể trả lại nhật ký', formatPolicyMessage(policy));
                    endStatusAction(log.id);
                    return false;
                }
            }

            await dailyLogService.updateStatus({
                logId: log.id,
                status,
                rejectionReason: status === 'rejected' ? rejectionReason : undefined,
                actorUserId: user?.id,
            });
            if (status === 'verified' && (log.delayTasks || []).length > 0) {
                try {
                    await delayEventService.createFromDailyLog({ ...log, status: 'verified', verified: true }, user?.id || null);
                } catch (delayError: any) {
                    console.warn('Cannot create schedule delay events from daily log', delayError?.message || delayError);
                    toast.warning('Chưa ghi được sự kiện chậm tiến độ', 'Nhật ký vẫn đã xác nhận; kiểm tra migration forecast trước khi dùng bảng dự báo.');
                }
            }
            const nextLogs = await dailyLogService.list(effectiveId, constructionSiteId || null);
            setLogs(nextLogs);
            if (status === 'submitted' || status === 'verified' || status === 'rejected') {
                await projectDocumentActionLogService.log({
                    projectId: projectId || log.projectId || effectiveId,
                    constructionSiteId: constructionSiteId || log.constructionSiteId || null,
                    documentType: 'daily_log',
                    documentId: log.id,
                    documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                    action: status === 'rejected' ? 'return' : status,
                    fromStatus: getLogStatus(log),
                    toStatus: status,
                    reason: status === 'rejected' ? rejectionReason : undefined,
                    warningAcknowledged: true,
                    createdBy: user?.id,
                });
            }

            // Notify if submitted
            if (status === 'submitted') {
                try {
                    const recipientId = responsibilityTarget?.userId;
                    const notifiedIds = await notificationService.notifyProjectUsers({
                        recipientIds: [recipientId],
                        actorId: user?.id,
                        type: 'info',
                        category: 'progress',
                        title: '📝 Nhật ký chờ xác nhận',
                        message: `${user?.name || 'Nhân viên'} đã gửi nhật ký ngày ${new Date(log.date).toLocaleDateString('vi-VN')} cho bạn xác nhận`,
                        severity: 'info',
                        icon: '📝',
                        link: buildDailyLogLink(log.id),
                        sourceType: 'dailylog_submitted',
                        sourceId: `dailylog_submitted_${log.id}_${recipientId}_${Date.now()}`,
                        constructionSiteId: constructionSiteId || undefined,
                        metadata: {
                            logId: log.id,
                            date: log.date,
                            projectId,
                            constructionSiteId,
                            submittedBy: user?.name,
                            assignmentUserId: recipientId,
                            assignmentResponsibility: responsibilityTarget?.responsibility,
                        },
                    });
                    if (recipientId !== user?.id && (!recipientId || !notifiedIds.includes(recipientId))) {
                        throw new Error('Không tạo được thông báo cho người nhận được hệ thống phân công.');
                    }
                } catch (err) {
                    throw err;
                }
            }

            if (status === 'verified' || status === 'rejected') {
                const ownerId = log.submittedById || log.submittedBy || log.createdById ||
                    (users.some(u => u.id === log.createdBy) ? log.createdBy : users.find(u => u.name === log.createdBy)?.id);
                if (ownerId) {
                    await notificationService.notifyProjectUsers({
                        recipientIds: [ownerId],
                        actorId: user?.id,
                        type: status === 'verified' ? 'success' : 'warning',
                        category: 'progress',
                        title: status === 'verified' ? '✅ Nhật ký đã xác nhận' : '↩ Nhật ký cần bổ sung',
                        message: `Nhật ký ngày ${new Date(log.date).toLocaleDateString('vi-VN')} ${status === 'verified' ? 'đã được xác nhận' : 'đã bị trả lại'}`,
                        severity: status === 'verified' ? 'info' : 'warning',
                        icon: status === 'verified' ? '✅' : '↩',
                        link: buildDailyLogLink(log.id),
                        sourceType: `dailylog_${status}`,
                        sourceId: `dailylog_${status}_${log.id}_${Date.now()}`,
                        constructionSiteId: constructionSiteId || undefined,
                        metadata: { logId: log.id, date: log.date, projectId, constructionSiteId },
                    });
                }
            }

            toast.success(
                status === 'submitted' ? 'Đã gửi nhật ký' :
                    status === 'verified' ? 'Đã xác nhận nhật ký' :
                        status === 'rejected' ? 'Đã trả lại nhật ký' : 'Đã cập nhật trạng thái'
            );
            return true;
        } catch (e: any) {
            toast.error('Lỗi cập nhật trạng thái', e?.message);
            return false;
        } finally {
            endStatusAction(log.id);
        }
    };

    const openSubmitAssignmentConfirmation = async (log: DailyLog) => {
        if (!(await requireDailyLogAction(DAILY_LOG_ACTION.submit, 'gửi nhật ký'))) return;
        if (!canSubmitDailyLog(log)) {
            toast.error('Phiếu đã khoá', 'Chỉ người lập có quyền submit được gửi nhật ký nháp hoặc bị trả lại.');
            return;
        }
        if (!(await subjectAuthorizationService.canAct('daily_log', log.id, 'submit'))) {
            toast.error('Không thể gửi nhật ký', 'Bạn không có quyền hoặc điều kiện workflow hợp lệ để gửi nhật ký này.');
            return;
        }
        setSubmitTarget(log);
        setResolvedSubmitTarget(null);
        setResolvingSubmitTarget(true);
        try {
            setResolvedSubmitTarget(await subjectAuthorizationService.getDailyLogResponsibilityTarget(log.id));
        } catch (error: any) {
            toast.error('Chưa xác định được người chịu trách nhiệm', error?.message || 'Vui lòng cấu hình responsibility slot trong Tổ chức dự án.');
            setSubmitTarget(null);
        } finally {
            setResolvingSubmitTarget(false);
        }
    };

    const closeSubmitAssignmentConfirmation = () => {
        if (submitTarget && busyLogIds.has(submitTarget.id)) return;
        setSubmitTarget(null);
        setResolvedSubmitTarget(null);
    };

    const confirmSubmitWithAssignment = async () => {
        if (!submitTarget) return;
        if (!resolvedSubmitTarget) {
            toast.warning('Đang xác định người nhận', 'Hệ thống chưa resolve được responsibility assignment.');
            return;
        }
        const ok = await handleStatusChange(submitTarget, 'submitted', resolvedSubmitTarget);
        if (ok) closeSubmitAssignmentConfirmation();
    };

    const handleDelete = async (id: string) => {
        const log = logs.find(l => l.id === id);
        if (!log) return;
        if (!(await requireDailyLogAction(getDailyLogDeleteAction(log), 'xoá nhật ký'))) return;
        if (!canDeleteDailyLog(log)) {
            toast.error('Không thể xoá nhật ký', 'Chỉ nhật ký nháp/bị trả lại và đúng quyền xoá owner/all mới được xoá.');
            return;
        }
        const deps = await projectDocumentDependencyService.getDailyLogDependencies(log);
        const status = getLogStatus(log);
        const policy = getProjectDocumentPolicy({
            action: 'delete',
            documentType: 'daily_log',
            status,
            user,
            permissions: dailyLogPerms,
            dependencies: deps,
            relatedUserIds: [log.createdById, log.submittedById, log.submittedBy],
            everSubmitted: log.everSubmitted,
            documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
        });
        if (!policy.allowed) {
            await projectDocumentActionLogService.logBlocked({
                projectId: projectId || log.projectId || effectiveId,
                constructionSiteId: constructionSiteId || log.constructionSiteId || null,
                documentType: 'daily_log',
                documentId: log.id,
                documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                action: 'delete',
                fromStatus: status,
                blockedReason: policy.reason,
                requiredRollbackSteps: policy.requiredRollbackSteps,
                metadata: deps.metadata,
                createdBy: user?.id,
            });
            toast.error('Không thể xoá nhật ký', formatPolicyMessage(policy));
            return;
        }
        const ok = await confirm({ targetName: log ? new Date(log.date).toLocaleDateString('vi-VN') : 'nhật ký này', title: 'Xoá nhật ký công trường' });
        if (!ok) return;
        try {
            await dailyLogService.remove(id);
            const nextLogs = await dailyLogService.list(effectiveId, constructionSiteId || null);
            setLogs(nextLogs);
            await projectDocumentActionLogService.log({
                projectId: projectId || log.projectId || effectiveId,
                constructionSiteId: constructionSiteId || log.constructionSiteId || null,
                documentType: 'daily_log',
                documentId: log.id,
                documentLabel: new Date(log.date).toLocaleDateString('vi-VN'),
                action: 'delete',
                fromStatus: status,
                warningAcknowledged: true,
                metadata: deps.metadata,
                createdBy: user?.id,
            });
            toast.success('Xoá nhật ký thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const filtered = useMemo(() => {
        let list = [...logs];
        if (filterMonth) {
            list = list.filter(l => l.date.startsWith(filterMonth));
        }
        if (filterStatus && filterStatus !== 'all') {
            list = list.filter(l => getLogStatus(l) === filterStatus);
        }
        if (filterWeather && filterWeather !== 'all') {
            list = list.filter(l => l.weather === filterWeather);
        }
        if (searchQuery.trim()) {
            const query = normalizeLookupText(searchQuery);
            list = list.filter(l => {
                const desc = normalizeLookupText(l.description);
                const issues = normalizeLookupText(l.issues);
                const creator = normalizeLookupText(l.createdBy || l.submittedBy);
                const verifier = normalizeLookupText(l.requestedVerifierName || l.verifiedBy);
                const plan = normalizeLookupText(l.nextDayPlan);
                const staffNames = (l.staffIds || [])
                    .map(id => siteStaff.find(s => s.userId === id)?.userName || '')
                    .join(' ')
                    .toLowerCase();
                const normalizedStaff = normalizeLookupText(staffNames);

                const volumesMatch = (l.volumes || []).some(v =>
                    normalizeLookupText(v.workBoqItemName).includes(query) ||
                    normalizeLookupText(v.taskName).includes(query)
                );

                const materialsMatch = (l.materials || []).some(m =>
                    normalizeLookupText(m.itemName).includes(query)
                );

                return desc.includes(query) ||
                    issues.includes(query) ||
                    creator.includes(query) ||
                    verifier.includes(query) ||
                    plan.includes(query) ||
                    normalizedStaff.includes(query) ||
                    volumesMatch ||
                    materialsMatch;
            });
        }
        return list.sort((a, b) => b.date.localeCompare(a.date));
    }, [logs, filterMonth, filterStatus, filterWeather, searchQuery, siteStaff]);

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
        filtered.forEach(log => {
            const list = map.get(log.date) || [];
            list.push(log);
            map.set(log.date, list);
        });
        for (const list of map.values()) {
            list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        }
        return map;
    }, [filtered]);

    const sourceSummaryByLogId = useMemo(() => {
        const map = new Map<string, DailyLog>();
        logs.forEach(log => {
            if (!isSummaryDailyLog(log)) return;
            toStringArray(log.summarySourceMetadata?.legacyDailyLogIds).forEach(sourceLogId => {
                map.set(sourceLogId, log);
            });
        });
        return map;
    }, [logs]);

    const getSummarySourceLogs = useCallback((dayLogs: DailyLog[]) => {
        return getDailyLogSummarySourceLogs(dayLogs, {
            canReviewSources: hasDailyLogAction(DAILY_LOG_ACTION.summarize),
            currentUserId: user?.id,
            sourceSummaryLogIds: sourceSummaryByLogId.keys(),
        });
    }, [hasDailyLogAction, sourceSummaryByLogId, user?.id]);

    const canReviewDailyLog = useCallback((log: DailyLog) => canReturnDailyLogSource({
        sourceLog: log,
        sourceSummaryLog: sourceSummaryByLogId.get(log.id) || null,
        userId: user?.id,
        isAdmin: isAdminUser,
        permissions: dailyLogPerms,
    }), [dailyLogPerms, isAdminUser, sourceSummaryByLogId, user?.id]);

    const dayRows = useMemo(() => {
        const dates = new Set<string>();
        logs.forEach(log => dates.add(log.date));
        const query = normalizeLookupText(searchQuery);

        return Array.from(dates).map(date => {
            const dayLogs = logs.filter(log => log.date === date);
            const legacyReports = getSummarySourceLogs(dayLogs);
            const sourceLogIds = new Set(legacyReports.map(log => log.id));
            const officialCandidates = dayLogs.filter(log => !sourceLogIds.has(log.id));
            const officialLog = officialCandidates.find(isSummaryDailyLog)
                || officialCandidates.find(log => getLogStatus(log) === 'verified')
                || officialCandidates[0]
                || null;
            const officialStatus = officialLog ? getLogStatus(officialLog) : null;
            const submittedCount = legacyReports.length;
            const reportCount = legacyReports.length;
            const photoCount = legacyReports.reduce((sum, log) => sum + (log.photos?.length || 0), 0)
                + (officialLog?.photos?.length || 0);
            const searchable = normalizeLookupText([
                date,
                officialLog?.description,
                officialLog?.issues,
                officialLog?.summarizedByName,
                officialLog?.verifiedBy,
                ...legacyReports.flatMap(log => [getLegacyDailyLogSourceName(log), log.description, log.issues]),
            ].filter(Boolean).join(' '));
            return {
                date,
                logs: dayLogs,
                legacyReports,
                officialLog,
                officialStatus,
                submittedCount,
                reportCount,
                photoCount,
                searchable,
            };
        }).filter(row => {
            if (filterMonth && !row.date.startsWith(filterMonth)) return false;
            if (filterStatus !== 'all' && row.officialStatus !== filterStatus) return false;
            if (filterWeather !== 'all' && row.officialLog?.weather !== filterWeather) return false;
            if (query && !row.searchable.includes(query)) return false;
            return true;
        }).sort((a, b) => b.date.localeCompare(a.date));
    }, [filterMonth, filterStatus, filterWeather, getSummarySourceLogs, logs, searchQuery]);

    const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);
    const calendarTitle = useMemo(() => {
        const [year, month] = calendarMonth.split('-').map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
    }, [calendarMonth]);

    const viewingLogStatus = viewingLog ? getLogStatus(viewingLog) : 'draft';
    const viewingSourceSummaryLog = viewingLog ? sourceSummaryByLogId.get(viewingLog.id) || null : null;
    const canModifyViewingSource = !viewingSourceSummaryLog || isDailyLogSummaryEditable(viewingSourceSummaryLog);
    const viewingSummarySourceLogs = viewingLog && isSummaryDailyLog(viewingLog)
        ? toStringArray(viewingLog.summarySourceMetadata?.legacyDailyLogIds)
            .map(sourceId => logs.find(log => log.id === sourceId))
            .filter((log): log is DailyLog => Boolean(log))
        : [];
    const canReturnViewingLog = !!viewingLog && canReviewDailyLog(viewingLog);
    const canVerifyViewingLog = !!viewingLog
        && canReviewDailyLog(viewingLog)
        && !isLegacyDailyLogSource(viewingLog);
    const canRollbackViewingLog = !!viewingLog
        && viewingLogStatus === 'verified'
        && isAdminUser;
    const canSubmitViewingLog = !!viewingLog
        && ['draft', 'rejected'].includes(viewingLogStatus)
        && canModifyViewingSource
        && canSubmitDailyLog(viewingLog);
    const canDeleteViewingLog = !!viewingLog
        && ['draft', 'rejected'].includes(viewingLogStatus)
        && canModifyViewingSource
        && canDeleteDailyLog(viewingLog);
    const activeSummaryLegacyLogs = useMemo(() => {
        if (!summaryDate) return [];
        return [...getSummarySourceLogs(logs.filter(log => log.date === summaryDate))]
            .sort((a, b) => {
                const aState = getDailyLogSourceReviewState({
                    sourceLog: a,
                    included: selectedSummaryLegacyLogIds.includes(a.id),
                    snapshot: summarySourceSnapshots[a.id] || null,
                });
                const bState = getDailyLogSourceReviewState({
                    sourceLog: b,
                    included: selectedSummaryLegacyLogIds.includes(b.id),
                    snapshot: summarySourceSnapshots[b.id] || null,
                });
                return SOURCE_REVIEW_STATE_ORDER[aState] - SOURCE_REVIEW_STATE_ORDER[bState]
                    || getLegacyDailyLogSourceName(a).localeCompare(getLegacyDailyLogSourceName(b), 'vi');
            });
    }, [getSummarySourceLogs, logs, selectedSummaryLegacyLogIds, summaryDate, summarySourceSnapshots]);
    const activeSummarySourceCount = activeSummaryLegacyLogs.length;
    const selectedSummarySourceLogs = useMemo(
        () => logs.filter(log => selectedSummaryLegacyLogIds.includes(log.id)),
        [logs, selectedSummaryLegacyLogIds],
    );
    const activeSummaryVolumes = useMemo(
        () => buildDailyLogSummaryVolumes(selectedSummarySourceLogs),
        [selectedSummarySourceLogs],
    );

    const returnSourceLog = async (log: DailyLog) => {
        const reason = await reasonConfirm({
            title: 'Trả lại phiếu nhật ký nguồn',
            targetName: `${getLegacyDailyLogSourceName(log)} - ${new Date(log.date).toLocaleDateString('vi-VN')}`,
            warningText: 'Phiếu sẽ quay về người lập để sửa và gửi lại Kỹ thuật trưởng.',
            reasonPlaceholder: 'Nhập lý do trả lại phiếu nguồn...',
            actionLabel: 'Trả lại',
            intent: 'danger',
        });
        if (!reason) return;
        await handleStatusChange(log, 'rejected', undefined, reason);
    };

    return (
        <div className="space-y-6">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Nhật ký công trường</h3>
                <div className="flex items-center gap-2">
                    <a
                        href={buildDailyLogReportLink()}
                        className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10px] font-black text-teal-700 transition-colors hover:bg-teal-100"
                    >
                        <BarChart3 size={13} /> Xem báo cáo nhật ký
                    </a>
                    <AiInsightPanel module="dailylog" siteId={constructionSiteId} />
                </div>
            </div>
            {/* Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Tổng nhật ký */}
                <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 dark:bg-teal-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><FileSpreadsheet size={11} className="text-teal-500" /> Tổng nhật ký</div>
                    <div className="text-3xl font-black text-slate-800 dark:text-white leading-none tracking-tight">{stats.total}</div>
                    <div className="text-[10px] text-teal-600 dark:text-teal-400 font-bold mt-2 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-50 dark:bg-teal-400 animate-pulse" /> Tháng này: {stats.monthCount}
                    </div>
                </div>

                {/* Nhân công trung bình */}
                <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 dark:bg-blue-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><Users size={11} className="text-blue-500" /> CN TB/ngày</div>
                    <div className="text-3xl font-black text-blue-600 dark:text-blue-400 leading-none tracking-tight">{stats.avgWorkers}</div>
                    <div className="text-[10px] text-muted-foreground font-medium mt-2">Nhân công bình quân công trường</div>
                </div>

                {/* Ngày mưa */}
                <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 dark:bg-cyan-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><CloudRain size={11} className="text-cyan-500" /> Ngày mưa</div>
                    <div className="text-3xl font-black text-cyan-600 dark:text-cyan-400 leading-none tracking-tight">{stats.rainyDays}</div>
                    <div className="text-[10px] text-muted-foreground font-medium mt-2">Ảnh hưởng đến tiến độ</div>
                </div>

                {/* Vấn đề sự cố */}
                <div className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-800 dark:to-slate-900/50 rounded-2xl p-5 border border-slate-100/80 dark:border-slate-700/60 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.02] group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 dark:bg-red-400/5 rounded-bl-full pointer-events-none transition-transform duration-300 group-hover:scale-110" />
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><AlertTriangle size={11} className="text-red-500" /> Vấn đề ghi nhận</div>
                    <div className="text-3xl font-black text-red-500 dark:text-red-400 leading-none tracking-tight">{stats.issueCount}</div>
                    <div className="text-[10px] text-muted-foreground font-medium mt-2">Sự cố, vướng mắc phát sinh</div>
                </div>
            </div>

            {/* Log List */}
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                        <Calendar size={16} className="text-teal-500" /> Nhật ký công trường
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
                            <button
                                onClick={() => setViewMode('list')}
                                className={`w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-muted text-teal-500 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                title="Danh sách"
                            >
                                <LayoutList size={14} />
                            </button>
                            <button
                                onClick={() => {
                                    setCalendarMonth(filterMonth || calendarMonth);
                                    setViewMode('calendar');
                                }}
                                className={`w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'calendar' ? 'bg-muted text-teal-500 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                title="Lịch tháng"
                            >
                                <Calendar size={14} />
                            </button>
                        </div>
                        {viewMode === 'calendar' ? (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl border border-border bg-card">
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
                                className="text-xs font-bold text-slate-600 px-3 py-1.5 rounded-lg border border-border bg-card outline-none">
                                <option value="">Tất cả</option>
                                {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        )}
                        <button onClick={() => { if (!ensureDailyLogAction(DAILY_LOG_ACTION.create, 'ghi nhật ký')) return; resetForm(); setShowForm(true); }}
                            disabled={pbacLoaded && !hasDailyLogAction(DAILY_LOG_ACTION.create)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                            <Plus size={12} /> Ghi nhật ký chi tiết
                        </button>
                    </div>
                </div>

                {/* Search and Filters Section */}
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/40 dark:bg-slate-900/20">
                    <div className="flex flex-col sm:flex-row gap-3">
                        {/* Search Input */}
                        <div className="relative flex-1">
                            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                                <Search size={15} />
                            </span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Gõ để tìm kiếm theo nội dung, sự cố, người lập, vật tư, thiết bị, hạng mục..."
                                className="w-full text-xs pl-9 pr-8 py-2 rounded-xl border border-border bg-card outline-none focus:border-teal-500 dark:focus:border-teal-500 transition-all font-medium text-slate-700 dark:text-slate-200"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Month Selector in List View */}
                        {viewMode !== 'calendar' && (
                            <select
                                value={filterMonth}
                                onChange={e => setFilterMonth(e.target.value)}
                                className="text-xs font-bold text-slate-600 dark:text-slate-300 px-3 py-2 rounded-xl border border-border bg-card outline-none focus:border-teal-500 transition-all cursor-pointer min-w-[120px]"
                            >
                                <option value="">Tất cả các tháng</option>
                                {availableMonths.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        )}

                        {/* Advanced Filters Button */}
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border ${showAdvanced || filterStatus !== 'all' || filterWeather !== 'all'
                                    ? 'text-teal-600 bg-teal-50 border-teal-200 dark:bg-teal-950/30 dark:border-teal-800 dark:text-teal-400'
                                    : 'text-foreground bg-card border-border hover:bg-muted'
                                }`}
                        >
                            <SlidersHorizontal size={14} />
                            <span>Bộ lọc nâng cao</span>
                            {(filterStatus !== 'all' || filterWeather !== 'all') && (
                                <span className="w-2 h-2 rounded-full bg-teal-500 dark:bg-teal-400 animate-pulse shrink-0" />
                            )}
                            {showAdvanced ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
                        </button>
                    </div>

                    {/* Accordion Content with smooth height transition */}
                    <div
                        className={`transition-all duration-300 ease-in-out overflow-hidden ${showAdvanced ? 'max-h-[300px] mt-4 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                            }`}
                    >
                        <div className="pt-4 border-t border-dashed border-slate-200 dark:border-slate-700/60 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Status Filter */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                                    Trạng thái phê duyệt
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        onClick={() => setFilterStatus('all')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${filterStatus === 'all'
                                                ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                                                : 'bg-card text-foreground border-border hover:bg-muted'
                                            }`}
                                    >
                                        Tất cả
                                    </button>
                                    {(Object.keys(STATUS_CFG) as DailyLogStatus[]).map(statusKey => {
                                        const active = filterStatus === statusKey;
                                        const cfg = STATUS_CFG[statusKey];
                                        return (
                                            <button
                                                key={statusKey}
                                                onClick={() => setFilterStatus(statusKey)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${active
                                                        ? 'bg-teal-600 text-white border-teal-600 dark:bg-teal-500 dark:border-teal-500'
                                                        : 'bg-card text-foreground border-border hover:bg-muted'
                                                    }`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : STATUS_DOT[statusKey]}`} />
                                                <span>{cfg.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Weather Filter */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                                    Điều kiện thời tiết
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        onClick={() => setFilterWeather('all')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${filterWeather === 'all'
                                                ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                                                : 'bg-card text-foreground border-border hover:bg-muted'
                                            }`}
                                    >
                                        Tất cả
                                    </button>
                                    {(Object.keys(WEATHER) as WeatherType[]).map(weatherKey => {
                                        const active = filterWeather === weatherKey;
                                        const cfg = WEATHER[weatherKey];
                                        return (
                                            <button
                                                key={weatherKey}
                                                onClick={() => setFilterWeather(weatherKey)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${active
                                                        ? 'bg-teal-600 text-white border-teal-600 dark:bg-teal-500 dark:border-teal-500'
                                                        : 'bg-card text-foreground border-border hover:bg-muted'
                                                    }`}
                                            >
                                                <span>{cfg.emoji}</span>
                                                <span>{cfg.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Reset filters panel */}
                        {(filterStatus !== 'all' || filterWeather !== 'all' || searchQuery.trim() !== '') && (
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <span className="text-[11px] font-bold text-muted-foreground">
                                    Đang lọc ra {dayRows.length} ngày
                                </span>
                                <button
                                    onClick={() => {
                                        setSearchQuery('');
                                        setFilterStatus('all');
                                        setFilterWeather('all');
                                    }}
                                    className="flex items-center gap-1 text-[10px] font-black text-red-500 hover:text-red-600 transition-colors uppercase tracking-wider"
                                >
                                    <RotateCcw size={10} />
                                    Đặt lại bộ lọc
                                </button>
                            </div>
                        )}
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
                                        className={`min-h-[72px] sm:min-h-[92px] border-r border-b border-border p-1.5 sm:p-2 text-left transition-colors hover:bg-teal-500/10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-400 ${cell.inMonth ? 'bg-card' : 'bg-muted/50 text-muted-foreground'} ${isToday ? 'ring-2 ring-inset ring-teal-400' : ''}`}
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
                ) : dayRows.length === 0 ? (
                    <div className="p-12 text-center">
                        <Calendar size={36} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-sm font-bold text-slate-400">Chưa có báo cáo hoặc nhật ký nào</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-750">
                        {dayRows.map(row => {
                            const officialLog = row.officialLog;
                            const status = row.officialStatus;
                            const statusCfg = status ? STATUS_CFG[status] : null;
                            const w = officialLog ? WEATHER[officialLog.weather] : null;
                            const borderAccentCls = 
                                status === 'verified' ? 'bg-emerald-500 dark:bg-emerald-400' :
                                status === 'submitted' ? 'bg-amber-500 dark:bg-amber-400' :
                                status === 'rejected' ? 'bg-rose-500 dark:bg-rose-400' :
                                row.submittedCount > 0 ? 'bg-blue-500 dark:bg-blue-400' :
                                'bg-slate-400 dark:bg-slate-500';
                            const dayLabel = new Date(`${row.date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
                            const summaryLabel = officialLog?.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE && status === 'submitted'
                                ? 'Chờ CHT duyệt'
                                : officialLog?.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE && status === 'verified'
                                    ? 'Đã duyệt'
                                    : officialLog?.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE && status === 'rejected'
                                        ? 'CHT trả lại'
                                        : statusCfg?.label || (row.submittedCount > 0 ? 'Chờ tổng hợp' : 'Chưa có bản ngày');
                            const sourceReportsReady = row.legacyReports.length > 0;
                            const summaryEditable = !!officialLog
                                && officialLog.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE
                                && ['draft', 'rejected'].includes(getLogStatus(officialLog));
                            const hasSummary = officialLog?.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE;
                            const canSummarizeDay = hasDailyLogAction(DAILY_LOG_ACTION.summarize)
                                && ((!hasSummary && sourceReportsReady) || summaryEditable);
                            const canReportDay = hasDailyLogAction(DAILY_LOG_ACTION.create);
                            const contributorNames = row.legacyReports.map(getLegacyDailyLogSourceName);

                            return (
                                <div
                                    key={row.date}
                                    ref={el => { if (officialLog) logRefs.current[officialLog.id] = el; }}
                                    onClick={() => officialLog ? openView(officialLog) : canSummarizeDay ? openSummaryForDate(row.date) : openCreateForDate(row.date)}
                                    className={`relative pl-5 sm:pl-7 pr-4 sm:pr-5 py-3.5 sm:py-4 bg-card hover:bg-muted/40 border-b border-border transition-all duration-200 cursor-pointer group flex items-start justify-between gap-3 overflow-hidden ${officialLog && highlightLogId === officialLog.id ? 'bg-amber-500/10 ring-2 ring-amber-500/40 ring-inset' : ''
                                        }`}
                                >
                                    {/* Left Accent Status Border */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${borderAccentCls} transition-all duration-200 group-hover:w-2`} />
                                    
                                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border border-slate-200/60 dark:border-slate-700/60 flex flex-col items-center justify-center shrink-0 shadow-sm transition-transform duration-250 group-hover:scale-105">
                                            <div className="text-[10px] font-black text-slate-700 dark:text-slate-200">{new Date(`${row.date}T00:00:00`).getDate()}</div>
                                            <div className="text-[8px] font-bold text-muted-foreground uppercase">T{new Date(`${row.date}T00:00:00`).getMonth() + 1}</div>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="text-xs font-bold text-slate-800 dark:text-slate-150 transition-colors group-hover:text-teal-600 dark:group-hover:text-teal-400">
                                                    {dayLabel}
                                                </span>
                                                {w && <span className="text-xs">{w.emoji}</span>}
                                                <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 flex items-center gap-0.5"><Users size={10} /> {row.reportCount} báo cáo nguồn</span>
                                                <span className="text-[10px] font-bold text-rose-500 dark:text-rose-400 flex items-center gap-0.5"><Camera size={10} /> {row.photoCount} ảnh</span>
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${statusCfg?.cls || 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>{summaryLabel}</span>
                                            </div>
                                            <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed line-clamp-2">
                                                {officialLog?.description || row.legacyReports[0]?.description || 'Chưa có nội dung trong ngày.'}
                                            </p>
                                            
                                            <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] font-bold text-slate-500 dark:text-slate-400 border-t border-slate-100/60 dark:border-slate-800/80 pt-1.5">
                                                {contributorNames.slice(0, 5).map((name, idx) => (
                                                    <span key={`${row.date}-${name}-${idx}`} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-slate-600">
                                                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[8px] font-black text-blue-600">
                                                            {String(name || '?').slice(0, 1).toUpperCase()}
                                                        </span>
                                                        {name}
                                                    </span>
                                                ))}
                                                {contributorNames.length > 5 && (
                                                    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-slate-500">+{contributorNames.length - 5}</span>
                                                )}
                                                {officialLog?.summarizedByName && (
                                                    <span className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-0.5 text-teal-700">
                                                        <UserCheck size={10} /> Tổng hợp: {officialLog.summarizedByName}
                                                    </span>
                                                )}
                                                {officialLog?.verifiedBy && (
                                                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                        <CheckCircle2 size={10} /> Duyệt: {officialLog.verifiedBy}
                                                    </span>
                                                )}
                                            </div>
                                            {row.legacyReports.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {row.legacyReports.slice(0, 4).map(log => {
                                                        const sourceSummary = sourceSummaryByLogId.get(log.id);
                                                        const sourceSnapshots = getDailyLogSummarySourceSnapshots(sourceSummary?.summarySourceMetadata || null);
                                                        const sourceReviewState = getDailyLogSourceReviewState({
                                                            sourceLog: log,
                                                            included: Boolean(sourceSummary),
                                                            snapshot: sourceSnapshots[log.id] || null,
                                                        });
                                                        const sourceStateCfg = SOURCE_REVIEW_STATE_CFG[sourceReviewState];
                                                        return (
                                                            <span key={log.id} className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${sourceStateCfg.cls}`}>
                                                                {getLegacyDailyLogSourceName(log)}: {sourceStateCfg.label}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {officialLog && status === 'submitted' && (officialLog.requestedVerifierName || officialLog.submittedToName) && (
                                                <div className="mt-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                                    <UserCheck size={11} /> Chờ {officialLog.requestedVerifierName || officialLog.submittedToName} {officialLog.submittedToPermission === 'approve' ? 'duyệt' : 'xác nhận'}
                                                </div>
                                            )}
                                            {officialLog?.issues && (
                                                <div className="mt-1.5 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50/80 dark:bg-red-950/20 border border-red-100/60 dark:border-red-900/30">
                                                    <AlertTriangle size={12} className="text-red-400 dark:text-red-500 shrink-0 mt-0.5" />
                                                    <span className="text-xs text-red-600 dark:text-red-450 font-medium">{officialLog.issues}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-1 opacity-100 transition-all shrink-0 self-center">
                                        {canReportDay && (
                                            <button
                                                type="button"
                                                onClick={e => { e.stopPropagation(); openCreateForDate(row.date); }}
                                                className="h-8 rounded-lg border border-teal-200 bg-teal-50 px-2 text-[10px] font-black text-teal-700 hover:bg-teal-100"
                                            >
                                                Ghi nhật ký
                                            </button>
                                        )}
                                        {canSummarizeDay && (
                                            <button
                                                type="button"
                                                onClick={e => { e.stopPropagation(); openSummaryForDate(row.date); }}
                                                className="h-8 rounded-lg border border-teal-200 bg-teal-50 px-2 text-[10px] font-black text-teal-700 hover:bg-teal-100"
                                            >
                                                Tổng hợp
                                            </button>
                                        )}
                                        {officialLog ? (
                                            <button
                                                type="button"
                                                onClick={e => { e.stopPropagation(); openView(officialLog); }}
                                                className="h-8 w-8 rounded-lg flex items-center justify-center text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border border-teal-100 dark:border-teal-900/30 shadow-sm"
                                                title="Xem nhật ký ngày"
                                            >
                                                <Eye size={13} />
                                            </button>
                                        ) : row.logs.length > 0 ? (
                                            <button
                                                type="button"
                                                onClick={e => { e.stopPropagation(); setDayLogPicker({ date: row.date, logs: row.logs }); }}
                                                className="h-8 w-8 rounded-lg flex items-center justify-center text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border border-teal-100 dark:border-teal-900/30 shadow-sm"
                                                title="Xem phiếu nguồn"
                                            >
                                                <Eye size={13} />
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {summaryDate && (
                <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/35 backdrop-blur-sm px-3" onClick={e => e.target === e.currentTarget && closeSummary()}>
                    <div className="flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
                        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-black text-foreground">
                                    <FileText size={16} className="text-teal-500" /> Tổng hợp nhật ký ngày
                                </div>
                                <div className="mt-1 text-[11px] font-bold text-muted-foreground">
                                    {new Date(`${summaryDate}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </div>
                            </div>
                            <button onClick={() => closeSummary()} disabled={summarySaving}
                                className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-muted disabled:opacity-50">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
                            <div className="overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="text-xs font-black uppercase text-muted-foreground">Phiếu nhật ký nguồn</div>
                                    <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">{activeSummarySourceCount}</span>
                                </div>
                                <div className="space-y-3">
                                    {activeSummarySourceCount === 0 ? (
                                        <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs font-bold text-muted-foreground">
                                            Chưa có phiếu nhật ký chi tiết đã gửi trong ngày.
                                        </div>
                                    ) : (
                                        <>
                                            {activeSummaryLegacyLogs.map(log => {
                                                const selected = selectedSummaryLegacyLogIds.includes(log.id);
                                                const authorName = getLegacyDailyLogSourceName(log);
                                                const canReturnSource = canReviewDailyLog(log);
                                                const sourceVolumeCount = (log.volumes || []).length;
                                                const sourceReviewState = getDailyLogSourceReviewState({
                                                    sourceLog: log,
                                                    included: selected,
                                                    snapshot: summarySourceSnapshots[log.id] || null,
                                                });
                                                const sourceStateCfg = SOURCE_REVIEW_STATE_CFG[sourceReviewState];
                                                const canIncludeSource = sourceReviewState !== 'returned';
                                                const canUpdateSource = selected && sourceReviewState !== 'returned';
                                                return (
                                                    <div key={log.id} className={`rounded-xl border p-3 transition-colors ${sourceStateCfg.cardCls}`}>
                                                        <div className="mb-2 flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-black text-foreground">{authorName}</div>
                                                                <div className="text-[10px] font-bold text-muted-foreground">
                                                                    {log.submittedAt ? new Date(log.submittedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Phiếu nhật ký đã gửi'}
                                                                </div>
                                                            </div>
                                                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black ${sourceStateCfg.cls}`}>
                                                                {sourceStateCfg.label}
                                                            </span>
                                                        </div>
                                                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{log.description}</p>
                                                        {log.issues && (
                                                            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-xs font-medium text-red-600">{log.issues}</p>
                                                        )}
                                                        {(log.photos || []).length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {(log.photos || []).map((photo, index) => (
                                                                    <img key={`${photo.url}-${index}`} src={photo.url} alt={photo.name} className="h-12 w-12 rounded-md border border-white object-cover shadow-sm" />
                                                                ))}
                                                            </div>
                                                        )}
                                                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                                                            {sourceVolumeCount > 0 && (
                                                                <span className="mr-auto rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">
                                                                    {sourceVolumeCount} hạng mục
                                                                </span>
                                                            )}
                                                            {canReturnSource && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => returnSourceLog(log)}
                                                                    disabled={busyLogIds.has(log.id)}
                                                                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black text-red-700 hover:bg-red-100 disabled:opacity-50"
                                                                >
                                                                    {busyLogIds.has(log.id) ? 'Đang trả...' : 'Trả lại'}
                                                                </button>
                                                            )}
                                                            {!selected && canIncludeSource && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => includeLegacyLogInSummary(log)}
                                                                    className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-100"
                                                                >
                                                                    Đưa vào tổng hợp
                                                                </button>
                                                            )}
                                                            {canUpdateSource && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => includeLegacyLogInSummary(log)}
                                                                    className="rounded-lg border border-teal-200 bg-white px-2.5 py-1 text-[10px] font-black text-teal-700 hover:bg-teal-50"
                                                                >
                                                                    Cập nhật từ phiếu
                                                                </button>
                                                            )}
                                                            {selected && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeLegacyLogFromSummary(log)}
                                                                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50"
                                                                >
                                                                    Bỏ khỏi tổng hợp
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="overflow-y-auto p-4">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-[10px] font-black uppercase text-muted-foreground">Thời tiết</label>
                                        <select value={summaryWeather} onChange={e => setSummaryWeather(e.target.value as WeatherType)}
                                            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-teal-400">
                                            {(Object.entries(WEATHER) as [WeatherType, typeof WEATHER[WeatherType]][]).map(([key, value]) => (
                                                <option key={key} value={key}>{value.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-black uppercase text-muted-foreground">CHT duyệt</label>
                                        <select
                                            value={summaryApproverUserId}
                                            onChange={event => setSummaryApproverUserId(event.target.value)}
                                            className="w-full rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 outline-none focus:ring-2 focus:ring-teal-400"
                                        >
                                            <option value="">Chọn CHT từ Room Nhật ký</option>
                                            {summaryApprovers.map(staff => (
                                                <option key={staff.userId} value={staff.userId}>{staff.userName}</option>
                                            ))}
                                        </select>
                                        {summaryApprovers.length === 0 && (
                                            <p className="mt-1 text-[10px] font-bold text-red-600">Chưa có người có quyền duyệt trong Room Nhật ký công trường.</p>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-4">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-muted-foreground">Nội dung tổng hợp</label>
                                    <VoiceTextarea
                                        value={summaryDescription}
                                        onChange={setSummaryDescription}
                                        rows={8}
                                        placeholder="Nội dung nhật ký chính thức..."
                                        className="w-full resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-teal-400"
                                        bulletPoints
                                    />
                                </div>
                                <div className="mt-4">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-muted-foreground">Vấn đề / sự cố</label>
                                    <VoiceTextarea
                                        value={summaryIssues}
                                        onChange={setSummaryIssues}
                                        rows={3}
                                        placeholder="Vấn đề cần ghi nhận..."
                                        className="w-full resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-teal-400"
                                    />
                                </div>
                                <div className="mt-4">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-muted-foreground">Kế hoạch ngày sau</label>
                                    <VoiceTextarea
                                        value={summaryNextPlan}
                                        onChange={setSummaryNextPlan}
                                        rows={3}
                                        placeholder="Kế hoạch thi công ngày hôm sau..."
                                        className="w-full resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-teal-400"
                                        bulletPoints
                                    />
                                </div>
                                <div className="mt-4">
                                    <label className="mb-2 block text-[10px] font-black uppercase text-muted-foreground">Ảnh đưa vào nhật ký</label>
                                    <div className="flex flex-wrap gap-2">
                                        {summaryPhotos.map((photo, index) => (
                                            <div key={`${photo.url}-${index}`} className="group relative">
                                                <img src={photo.url} alt={photo.name} className="h-16 w-16 rounded-lg border border-border object-cover" />
                                                <div className="mt-1 max-w-16 truncate text-[9px] font-bold text-muted-foreground">{photo.sourceUserName || photo.name}</div>
                                                <button
                                                    type="button"
                                                    onClick={() => setSummaryPhotos(prev => prev.filter((_, idx) => idx !== index))}
                                                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                                                >
                                                    <X size={11} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="text-[10px] font-black uppercase text-amber-700">Hạng mục thi công từ chốt ngày</div>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black text-amber-700">{activeSummaryVolumes.length}</span>
                                    </div>
                                    {activeSummaryVolumes.length === 0 ? (
                                        <div className="text-[11px] font-bold text-amber-700/70">Chưa có dữ liệu khối lượng từ phiếu nguồn đã chọn.</div>
                                    ) : (
                                        <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                                            {activeSummaryVolumes.map((volume, index) => (
                                                <div key={`${volume.workBoqItemId || volume.taskId || volume.contractItemName || index}-${index}`} className="rounded-lg bg-white px-2 py-1.5">
                                                    <div className="truncate text-[11px] font-black text-slate-700">
                                                        {volume.workBoqItemName || volume.taskName || volume.contractItemName || 'Hạng mục chưa đặt tên'}
                                                    </div>
                                                    <div className="text-[10px] font-bold text-amber-700">
                                                        {formatNumber(volume.quantity)} {volume.unit || ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/30 px-5 py-4">
                            <button onClick={() => closeSummary()} disabled={summarySaving}
                                className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
                                Đóng
                            </button>
                            <button onClick={() => saveSummary(false)} disabled={summarySaving}
                                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                {summarySaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu tổng hợp
                            </button>
                            <button onClick={() => saveSummary(true)} disabled={summarySaving || (!summaryDescription.trim() && summaryPhotos.length === 0)}
                                className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50">
                                {summarySaving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Gửi CHT
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {submitTarget && (
                <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={e => e.target === e.currentTarget && closeSubmitAssignmentConfirmation()}>
                    <div className="w-full max-w-lg rounded-2xl bg-card border border-border overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                                    <UserCheck size={16} className="text-amber-500" /> Xác nhận gửi nhật ký
                                </p>
                                <p className="text-[10px] font-bold text-slate-400">Người nhận được hệ thống phân công theo responsibility slot, không theo link hoặc danh sách quyền chung.</p>
                            </div>
                            <button onClick={closeSubmitAssignmentConfirmation} disabled={busyLogIds.has(submitTarget.id)}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-5">
                            {resolvingSubmitTarget ? (
                                <div className="rounded-2xl border border-slate-100 p-8 text-center text-xs font-bold text-slate-400">
                                    <Loader2 size={16} className="inline animate-spin mr-2" />Đang xác định người chịu trách nhiệm...
                                </div>
                            ) : resolvedSubmitTarget ? (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="text-[10px] font-black uppercase text-amber-700">Người nhận</div>
                                    <div className="mt-1 text-base font-black text-foreground">{resolvedSubmitTarget.name}</div>
                                    <div className="mt-1 text-xs font-bold text-amber-700">
                                        {resolvedSubmitTarget.responsibility === 'current_approver' ? 'Người duyệt hiện tại' : 'Người xác nhận hiện tại'} · {resolvedSubmitTarget.scopeType}
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm font-bold text-destructive">
                                    Chưa xác định được người chịu trách nhiệm. Vui lòng kiểm tra responsibility slot trong Tổ chức dự án.
                                </div>
                            )}
                        </div>
                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={closeSubmitAssignmentConfirmation} disabled={busyLogIds.has(submitTarget.id)}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
                                Huỷ
                            </button>
                            <button onClick={confirmSubmitWithAssignment} disabled={!resolvedSubmitTarget || resolvingSubmitTarget || busyLogIds.has(submitTarget.id)}
                                className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2">
                                {busyLogIds.has(submitTarget.id) ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                Gửi xác nhận
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {dayLogPicker && (
                <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={e => e.target === e.currentTarget && setDayLogPicker(null)}>
                    <div className="w-full max-w-md rounded-2xl bg-card border border-border overflow-hidden">
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
                                    <button key={log.id} onClick={() => openView(log)}
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
                                disabled={!canManageTab}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-teal-600 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-colors">
                                <Plus size={13} /> Thêm nhật ký
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {viewingLog && (
                <DailyLogViewer
                    log={viewingLog}
                    siteStaff={siteStaff}
                    status={viewingLogStatus}
                    statusClassName={STATUS_CFG[viewingLogStatus].cls}
                    weatherLabel={WEATHER[viewingLog.weather]?.label || ''}
                    weatherEmoji={WEATHER[viewingLog.weather]?.emoji || ''}
                    canEdit={canEditDailyLog(viewingLog) && canModifyViewingSource}
                    canReturn={canReturnViewingLog}
                    canVerify={canVerifyViewingLog}
                    canRollback={canRollbackViewingLog}
                    canSubmit={canSubmitViewingLog}
                    canDelete={canDeleteViewingLog}
                    sourceSummaryLog={viewingSourceSummaryLog}
                    summarySourceLogs={viewingSummarySourceLogs}
                    canReturnSourceLog={canReviewDailyLog}
                    busy={busyLogIds.has(viewingLog.id)}
                    onClose={() => setViewLogId(null)}
                    onPreviewImage={(list, idx) => {
                        setGalleryAttachments(list);
                        setGalleryIndex(idx);
                    }}
                    onEdit={() => {
                        setViewLogId(null);
                        openEdit(viewingLog);
                    }}
                    onRollback={async () => {
                        const reason = await reasonConfirm({
                            title: 'Rollback nhật ký đã xác nhận',
                            targetName: viewingLog.description || new Date(viewingLog.date).toLocaleDateString('vi-VN'),
                            warningText: 'Admin rollback nhật ký đã xác nhận bắt buộc nhập lý do để truy vết.',
                            reasonPlaceholder: 'Nhập lý do rollback nhật ký đã xác nhận...',
                            actionLabel: 'Rollback',
                            intent: 'danger',
                            countdownSeconds: 1,
                        });
                        if (!reason) return;
                        handleStatusChange(viewingLog, 'rejected', undefined, reason);
                    }}
                    onSubmit={() => {
                        setViewLogId(null);
                        openSubmitAssignmentConfirmation(viewingLog);
                    }}
                    onDelete={() => {
                        setViewLogId(null);
                        handleDelete(viewingLog.id);
                    }}
                    onVerify={() => handleStatusChange(viewingLog, 'verified')}
                    onReject={async () => {
                        const reason = await reasonConfirm({
                            title: 'Trả lại nhật ký',
                            targetName: viewingLog.description || new Date(viewingLog.date).toLocaleDateString('vi-VN'),
                            warningText: 'Vui lòng nhập lý do để người lập bổ sung đúng nội dung.',
                            reasonPlaceholder: 'Nhập lý do trả lại nhật ký...',
                            actionLabel: 'Trả lại',
                            intent: 'danger',
                        });
                        if (!reason) return;
                        handleStatusChange(viewingLog, 'rejected', undefined, reason);
                    }}
                    onReturnSourceLog={returnSourceLog}
                />
            )}

            {/* Form Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/45 backdrop-blur-sm">
                    <div className="bg-card border border-border rounded-3xl shadow-2xl w-[95vw] h-[90dvh] sm:w-[80vw] sm:h-[80dvh] max-w-[1280px] min-w-[320px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-t-3xl flex items-center justify-between shrink-0">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editing ? <><Edit2 size={18} /> Sửa nhật ký</> : <><Plus size={18} /> Ghi nhật ký</>}
                            </span>
                            <button onClick={resetForm} disabled={savingLog} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-50 transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 bg-card">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Ngày</label>
                                    <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-750 bg-muted/30 text-foreground text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Nhân công</label>
                                    <div className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/50 text-sm font-black text-slate-700 dark:text-slate-300">
                                        {getWorkerCountFromLabor(fLabor)} người
                                    </div>
                                    <p className="mt-1 text-[10px] font-medium text-muted-foreground">Tự cộng từ Chi tiết thi công &gt; Nhân công.</p>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1.5">Thời tiết</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {(Object.entries(WEATHER) as [WeatherType, typeof WEATHER[WeatherType]][]).map(([k, v]) => (
                                        <button key={k} onClick={() => setFWeather(k)}
                                            className={`py-2.5 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 ${fWeather === k ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-400 shadow-sm scale-[1.02]' : 'border-slate-200 dark:border-slate-700/60 bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            <span className="text-lg">{v.emoji}</span>
                                            <span>{v.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Nội dung công việc thi công</label>
                                <VoiceTextarea
                                    value={fDesc}
                                    onChange={setFDesc}
                                    rows={3}
                                    placeholder="Mô tả công việc thi công đã thực hiện trong ngày... (nhấn 🎤 để voice input)"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-750 bg-muted/30 text-foreground text-sm focus:ring-2 focus:ring-teal-500 outline-none resize-none transition-all"
                                    bulletPoints={true}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Nội dung công việc nghiệm thu</label>
                                <VoiceTextarea
                                    value={fAcceptanceDesc}
                                    onChange={setFAcceptanceDesc}
                                    rows={3}
                                    placeholder="Mô tả công việc nghiệm thu đã thực hiện trong ngày... (nhấn 🎤 để voice input)"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-750 bg-muted/30 text-foreground text-sm focus:ring-2 focus:ring-teal-500 outline-none resize-none transition-all"
                                    bulletPoints={true}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Kế hoạch thi công ngày hôm sau</label>
                                <VoiceTextarea
                                    value={fNextDayPlan}
                                    onChange={setFNextDayPlan}
                                    rows={3}
                                    placeholder="Kế hoạch thi công của ngày hôm sau... (nhấn 🎤 để voice input)"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-750 bg-muted/30 text-foreground text-sm focus:ring-2 focus:ring-teal-500 outline-none resize-none transition-all"
                                    bulletPoints={true}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-2">Cán bộ tham gia trong ngày</label>
                                <div className="border border-slate-200 dark:border-slate-700/60 bg-muted/10 rounded-xl p-3 max-h-[160px] overflow-y-auto">
                                    {siteStaff.length === 0 ? (
                                        <div className="text-xs text-muted-foreground py-2 italic text-center">Chưa có cán bộ nào trong danh sách tổ chức công trường</div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                            {siteStaff.map(staff => {
                                                const isChecked = fStaffIds.includes(staff.userId || '');
                                                return (
                                                    <label key={staff.userId} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer select-none transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700/60">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setFStaffIds([...fStaffIds, staff.userId || '']);
                                                                } else {
                                                                    setFStaffIds(fStaffIds.filter(id => id !== staff.userId));
                                                                }
                                                            }}
                                                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4 cursor-pointer"
                                                        />
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-xs font-semibold text-slate-750 dark:text-slate-200 truncate">{staff.userName}</span>
                                                            <span className="text-[10px] text-muted-foreground truncate">{staff.positionName || 'Cán bộ'}</span>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 dark:border-slate-700/60 pt-4">
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-2">Đảm bảo An toàn lao động</label>
                                    <div className="flex gap-2">
                                        <button onClick={() => setFWorkSafetyOk(true)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${fWorkSafetyOk ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            Đạt
                                        </button>
                                        <button onClick={() => setFWorkSafetyOk(false)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!fWorkSafetyOk ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            Không đạt
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-2">Vệ sinh môi trường</label>
                                    <div className="flex gap-2">
                                        <button onClick={() => setFEnvHygieneOk(true)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${fEnvHygieneOk ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            Đạt
                                        </button>
                                        <button onClick={() => setFEnvHygieneOk(false)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!fEnvHygieneOk ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            Không đạt
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-2">An toàn giao thông</label>
                                    <div className="flex gap-2">
                                        <button onClick={() => setFTrafficSafetyOk(true)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${fTrafficSafetyOk ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            Đạt
                                        </button>
                                        <button onClick={() => setFTrafficSafetyOk(false)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!fTrafficSafetyOk ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-750'}`}>
                                            Không đạt
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="border-t border-slate-100 dark:border-slate-700/60 pt-4 space-y-4">
                                <label className="text-[10px] font-black text-muted-foreground uppercase block">Đánh giá của Giám sát</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-muted-foreground block mb-1">Nhận xét Công tác thi công</label>
                                        <VoiceTextarea
                                            value={fSupervisorConstructionEval}
                                            onChange={setFSupervisorConstructionEval}
                                            rows={2}
                                            placeholder="Đánh giá công tác thi công..."
                                            className="w-full px-3 py-2 rounded-xl border border-border bg-card text-slate-800 dark:text-slate-150 text-xs focus:ring-1 focus:ring-teal-500 outline-none resize-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-muted-foreground block mb-1">Nhận xét Công tác nghiệm thu</label>
                                        <VoiceTextarea
                                            value={fSupervisorAcceptanceEval}
                                            onChange={setFSupervisorAcceptanceEval}
                                            rows={2}
                                            placeholder="Đánh giá công tác nghiệm thu..."
                                            className="w-full px-3 py-2 rounded-xl border border-border bg-card text-slate-800 dark:text-slate-150 text-xs focus:ring-1 focus:ring-teal-500 outline-none resize-none"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-muted-foreground block mb-2">Giám sát đánh giá ATLĐ</label>
                                        <div className="flex gap-2">
                                            <button onClick={() => setFSupervisorSafetyOk(true)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${fSupervisorSafetyOk ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500'}`}>
                                                Đạt
                                            </button>
                                            <button onClick={() => setFSupervisorSafetyOk(false)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${!fSupervisorSafetyOk ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500'}`}>
                                                Không đạt
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-muted-foreground block mb-2">Giám sát đánh giá VSMT</label>
                                        <div className="flex gap-2">
                                            <button onClick={() => setFSupervisorHygieneOk(true)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${fSupervisorHygieneOk ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500'}`}>
                                                Đạt
                                            </button>
                                            <button onClick={() => setFSupervisorHygieneOk(false)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${!fSupervisorHygieneOk ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500'}`}>
                                                Không đạt
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-muted-foreground block mb-2">Giám sát đánh giá ATGT</label>
                                        <div className="flex gap-2">
                                            <button onClick={() => setFSupervisorTrafficOk(true)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${fSupervisorTrafficOk ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-700' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500'}`}>
                                                Đạt
                                            </button>
                                            <button onClick={() => setFSupervisorTrafficOk(false)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${!fSupervisorTrafficOk ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700' : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-500'}`}>
                                                Không đạt
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1 flex items-center gap-1"><AlertTriangle size={10} className="text-red-400" /> Vấn đề / Sự cố</label>
                                <VoiceTextarea
                                    value={fIssues}
                                    onChange={setFIssues}
                                    rows={2}
                                    placeholder="Ghi lại vấn đề, sự cố nếu có... (nhấn 🎤 để voice input)"
                                    className="w-full px-3 py-2.5 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/20 dark:bg-red-950/10 text-slate-850 dark:text-slate-100 text-sm focus:ring-2 focus:ring-red-400 outline-none resize-none transition-all"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-700/60 pt-4">
                                {/* GPS */}
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-2">Vị trí hiện trường</label>
                                    {gpsCoords ? (
                                        <div className="flex items-center justify-between p-2.5 rounded-xl border border-teal-200/60 dark:border-teal-900/40 bg-teal-50/40 dark:bg-teal-950/15">
                                            <div className="flex items-center gap-2">
                                                <MapPin size={14} className="text-teal-600 dark:text-teal-400 shrink-0" />
                                                <div className="text-xs">
                                                    <div className="font-bold text-slate-700 dark:text-slate-200">{gpsCoords.lat.toFixed(5)}, {gpsCoords.lng.toFixed(5)}</div>
                                                    <div className="text-[10px] text-teal-600 dark:text-teal-400">Sai số: {Math.round(gpsCoords.accuracy)}m</div>
                                                </div>
                                            </div>
                                            <button onClick={() => setGpsCoords(null)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                                        </div>
                                    ) : (
                                        <button onClick={captureGPS} disabled={gpsLoading}
                                            className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-sm font-bold text-slate-550 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-teal-600 dark:hover:text-teal-400 hover:border-teal-300 dark:hover:border-teal-800 transition-all disabled:opacity-50">
                                            <MapPin size={16} /> {gpsLoading ? 'Đang lấy vị trí...' : 'Lấy tọa độ GPS'}
                                        </button>
                                    )}
                                </div>
                                {/* Photos */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                                            Ảnh chụp <span className="text-red-500">*</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer text-slate-500 dark:text-slate-400">
                                            <input type="checkbox" checked={photoRequired} onChange={e => setPhotoRequired(e.target.checked)} className="accent-teal-500 rounded" /> Bắt buộc
                                        </label>
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        {fPhotos.map((p, i) => (
                                            <div key={i} className="relative group">
                                                <img 
                                                    src={p.url} 
                                                    alt={p.name} 
                                                    onClick={() => {
                                                        const galleryList = fPhotos.map((photo, idx) => ({
                                                            url: photo.url,
                                                            name: photo.name || `Ảnh công trường ${idx + 1}`,
                                                            fileType: 'image/jpeg'
                                                        }));
                                                        setGalleryAttachments(galleryList);
                                                        setGalleryIndex(i);
                                                    }}
                                                    className="w-12 h-12 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-zoom-in hover:scale-105 transition-transform duration-150" 
                                                />
                                                <button onClick={() => setFPhotos(fPhotos.filter((_, idx) => idx !== i))}
                                                    className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ))}
                                        <label className={`w-12 h-12 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750 hover:border-teal-300 dark:hover:border-teal-800 hover:text-teal-600 dark:hover:text-teal-400 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : 'text-slate-400'}`}>
                                            {uploading ? <Loader2 size={16} className="animate-spin text-teal-500" /> : <Camera size={16} />}
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
                                <div className="border-t border-slate-100 dark:border-slate-700/60 pt-4">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1 mb-2">
                                        <Clock size={12} className="text-amber-500" /> Ghi nhận trễ tiến độ
                                    </label>
                                    <div className="space-y-2.5">
                                        {fDelayTasks.map((dt, i) => (
                                            <div key={i} className="grid grid-cols-12 gap-2 items-center bg-amber-50/20 dark:bg-amber-950/10 p-2.5 rounded-xl border border-amber-100/50 dark:border-amber-900/30">
                                                <div className="col-span-12 sm:col-span-4">
                                                    <select className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-muted/30 text-foreground outline-none focus:ring-1 focus:ring-amber-400"
                                                        value={dt.taskId} onChange={e => {
                                                            const newDt = [...fDelayTasks];
                                                            const t = tasks.find(x => x.id === e.target.value);
                                                            newDt[i].taskId = e.target.value;
                                                            if (t) newDt[i].taskName = t.name;
                                                            setFDelayTasks(newDt);
                                                        }}>
                                                        <option value="" disabled className="dark:bg-slate-900">Chọn hạng mục...</option>
                                                        {tasks.map(t => <option key={t.id} value={t.id} className="dark:bg-slate-900">{t.name}</option>)}
                                                    </select>
                                                </div>
                                                <div className="col-span-5 sm:col-span-2">
                                                    <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg px-2 w-full">
                                                        <input type="number" className="w-full text-xs text-center py-1.5 outline-none bg-transparent text-slate-800 dark:text-slate-200" placeholder="Số" min="1"
                                                            value={dt.delayDays || ''} onChange={e => {
                                                                const newDt = [...fDelayTasks];
                                                                newDt[i].delayDays = Number(e.target.value);
                                                                setFDelayTasks(newDt);
                                                            }} />
                                                        <span className="text-[10px] text-muted-foreground">ngày</span>
                                                    </div>
                                                </div>
                                                <div className="col-span-7 sm:col-span-3">
                                                    <select className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-muted/30 text-foreground outline-none focus:ring-1 focus:ring-amber-400"
                                                        value={dt.category} onChange={e => {
                                                            const newDt = [...fDelayTasks];
                                                            newDt[i].category = e.target.value as DelayCategory;
                                                            setFDelayTasks(newDt);
                                                        }}>
                                                        <option value="material" className="dark:bg-slate-900">Vật tư</option>
                                                        <option value="labor" className="dark:bg-slate-900">Nhân công</option>
                                                        <option value="weather" className="dark:bg-slate-900">Thời tiết</option>
                                                        <option value="drawing" className="dark:bg-slate-900">Bản vẽ</option>
                                                        <option value="other" className="dark:bg-slate-900">Khác</option>
                                                    </select>
                                                </div>
                                                <div className="col-span-10 sm:col-span-2">
                                                    <input type="text" className="w-full text-xs border border-border dark:border-slate-700 rounded-lg px-2 py-1.5 bg-muted/30 text-foreground outline-none focus:ring-1 focus:ring-amber-400" placeholder="Ghi chú thêm..."
                                                        value={dt.reason} onChange={e => {
                                                            const newDt = [...fDelayTasks];
                                                            newDt[i].reason = e.target.value;
                                                            setFDelayTasks(newDt);
                                                        }} />
                                                </div>
                                                <div className="col-span-2 sm:col-span-1 flex justify-center">
                                                    <button onClick={() => setFDelayTasks(fDelayTasks.filter((_, idx) => idx !== i))} className="w-7 h-7 flex items-center justify-center text-amber-400 dark:text-amber-500 hover:text-red-500 hover:bg-muted rounded-lg shrink-0 transition-colors"><X size={14} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        <button onClick={() => setFDelayTasks([...fDelayTasks, { taskId: '', taskName: '', delayDays: 1, reason: '', category: 'weather' }])}
                                            className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 px-3 py-1.5 rounded-lg transition-colors border border-amber-200 dark:border-amber-900/40">
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
                                tasks={tasks}
                                workBoqItems={workBoqItems}
                                laborCatalogs={laborCatalogs}
                                machineCatalogs={machineCatalogs}
                                businessPartners={businessPartners}
                                inventoryItems={inventoryItems}
                                siteWarehouseId={siteWarehouse?.id}
                                siteWarehouseName={siteWarehouse?.name}
                                dailyProgressDate={fDate}
                                importingDailyProgressVolumes={importingProgressVolumes}
                                onImportDailyProgressVolumes={handleImportDailyProgressVolumes}
                            />
                        </div>
                        <div className="px-4 sm:px-6 py-3 sm:py-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/45 flex justify-end gap-3 shrink-0">
                            <button onClick={resetForm} disabled={savingLog} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-700/60 disabled:opacity-50 transition-colors">Huỷ</button>
                            <button onClick={handleSave} disabled={savingLog || !fDate || !fDesc || (photoRequired && fPhotos.length === 0)}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-teal-500 to-cyan-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50 transition-all hover:-translate-y-0.5 active:translate-y-0">
                                {savingLog ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {savingLog ? 'Đang lưu...' : editing ? 'Lưu' : 'Ghi nhật ký'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Lightbox Component Overlay */}
            {galleryAttachments && galleryAttachments.length > 0 && (
                <SafetyImageGalleryModal
                    attachments={galleryAttachments}
                    currentIndex={galleryIndex}
                    onClose={() => setGalleryAttachments(null)}
                    onIndexChange={setGalleryIndex}
                />
            )}
        </div>
    );
};

export default DailyLogTab;
