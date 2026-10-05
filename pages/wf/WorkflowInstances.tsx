
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import {
    WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceAction,
    WorkflowNodeType, Role, WorkflowCustomField, WorkflowPrintTemplate
} from '../../types';
import {
    GitBranch, Plus, Search, Clock, CheckCircle, XCircle, Circle,
    ArrowRight, User, MessageSquare, FileText, Send, RotateCcw,
    ChevronDown, ChevronUp, Filter, Inbox, AlertCircle, X,
    Edit2, Trash2, Ban, Save, Upload, Paperclip, Table2, FileSpreadsheet, Eye, Download, Undo2,
    LayoutGrid, List, Printer, Shield, UserPlus, SlidersHorizontal
} from 'lucide-react';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import KanbanBoard from '../../components/KanbanBoard';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { supabase } from '../../lib/supabase';
import { useCelebration } from '../../components/Celebration';
import { loadXlsx } from '../../lib/loadXlsx';
import {
    canUserActOnWorkflowStep,
    getWorkflowAssigneeDisplay,
    getWorkflowStepSelectionMode,
    isWorkflowStepAssignedToUser,
    resolveCurrentWorkflowAssignees,
    resolveWorkflowStepAssigneeCandidates,
} from '../../lib/workflowAssignmentResolver';
import {
    canSeeMaterialRequestWorkflowOnKanban,
    isMaterialRequestWorkflowTemplate,
    isProjectOwnedWorkflowTemplate,
    isRequestModuleWorkflowTemplate,
} from '../../lib/workflowVisibility';
import WorkflowInstanceDetail from './WorkflowInstanceDetail';
import WorkflowSidebar from '../../components/workflow/WorkflowSidebar';
import WorkflowInstanceRow, { btnPrimary } from '../../components/workflow/WorkflowInstanceRow';
import WorkflowKpiStrip, { type WorkflowKpiValues } from '../../components/workflow/WorkflowKpiStrip';
import WorkflowInstanceActionDialog from '../../components/workflow/WorkflowInstanceActionDialog';
import { WfBadge } from '../../components/workflow/WorkflowInstanceVisuals';
import {
    buildWorkSteps,
    countWorkflowFiles,
    getWorkflowInstanceInsight,
    getWorkflowMetaParts,
    type WorkflowInstanceInsight,
} from '../../lib/workflowInstanceInsight';
import WorkflowFilePreview from '../../components/workflow/WorkflowFilePreview';
import {
    formatWorkflowFileSize,
    getWorkflowFileKind,
    normalizeWorkflowFiles,
    packWorkflowFiles,
    type WorkflowFileValue,
} from '../../lib/workflowFiles';
import { downloadWorkflowFile, hasDownloadableFile, uploadWorkflowAttachment } from '../../lib/workflowFileTransfer';
import WorkflowTemplateGroupList from '../../components/workflow/WorkflowTemplateGroupList';
import WorkflowInstanceSummaryPanel from '../../components/workflow/WorkflowInstanceSummaryPanel';
import { canPerform } from '../../lib/permissions/permissionService';
import { buildWorkflowRoute } from '../../lib/workflowRoutes';

const STATUS_MAP: Record<WorkflowInstanceStatus, { label: string; color: string; icon: any }> = {
    DRAFT: { label: 'Bản nháp', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: Edit2 },
    RUNNING: { label: 'Đang xử lý', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: Clock },
    COMPLETED: { label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: CheckCircle },
    REJECTED: { label: 'Từ chối', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: XCircle },
    CANCELLED: { label: 'Đã hủy', color: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400', icon: XCircle },
};

const ACTION_MAP: Record<WorkflowInstanceAction, { label: string; color: string }> = {
    SUBMITTED: { label: 'Đã gửi', color: 'text-blue-600' },
    APPROVED: { label: 'Đã duyệt', color: 'text-emerald-600' },
    REJECTED: { label: 'Từ chối', color: 'text-red-600' },
    REVISION_REQUESTED: { label: 'Yêu cầu bổ sung', color: 'text-amber-600' },
    REOPENED: { label: 'Mở lại', color: 'text-purple-600' },
};

// ========== File Field Input ==========
export const FileFieldInput: React.FC<{
    fieldName: string;
    value: any;
    onChange: (val: any) => void;
    disabled: boolean;
}> = ({ fieldName, value, onChange, disabled }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState('');
    const files = useMemo(() => normalizeWorkflowFiles(value), [value]);
    const isUploading = progress !== null;

    const addFiles = useCallback(async (selected: FileList | File[] | null) => {
        const incoming = Array.from(selected || []);
        if (incoming.length === 0 || disabled || isUploading) return;
        setError('');
        setProgress({ done: 0, total: incoming.length });
        const uploaded: WorkflowFileValue[] = [];
        const failed: string[] = [];
        for (const file of incoming) {
            try {
                uploaded.push(await uploadWorkflowAttachment(file));
            } catch (err) {
                console.error('Workflow attachment upload error:', err);
                failed.push(err instanceof Error && err.message.includes('25MB') ? err.message : `Không tải được "${file.name}".`);
            }
            setProgress(current => current && { ...current, done: current.done + 1 });
        }
        if (uploaded.length > 0) onChange(packWorkflowFiles([...files, ...uploaded]));
        if (failed.length > 0) setError(failed.join(' '));
        setProgress(null);
    }, [disabled, files, isUploading, onChange]);

    const removeFile = (index: number) => onChange(packWorkflowFiles(files.filter((_, itemIndex) => itemIndex !== index)));

    if (disabled && files.length === 0) return null;

    return (
        <div className="space-y-2">
            <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                disabled={disabled || isUploading}
                onChange={e => { void addFiles(e.target.files); e.target.value = ''; }}
                accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.txt"
            />
            {files.length > 0 && (
                <ul className="space-y-1.5">
                    {files.map((file, index) => (
                        <li key={`${file.storagePath || file.fileName}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/50">
                            {getWorkflowFileKind(file) === 'excel' ? <FileSpreadsheet size={16} className="shrink-0 text-emerald-600" /> : <Paperclip size={16} className="shrink-0 text-rose-400" />}
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200" title={file.fileName}>{file.fileName}</p>
                                <p className="text-[11px] font-medium text-slate-400">{formatWorkflowFileSize(file.fileSize)}</p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                <button type="button" onClick={() => setPreviewIndex(index)} className="rounded-lg p-1.5 text-blue-500 transition-colors hover:bg-blue-100 dark:hover:bg-blue-800/30" title="Xem trước" aria-label={`Xem trước ${file.fileName}`}>
                                    <Eye size={14} />
                                </button>
                                {hasDownloadableFile(file) && (
                                    <button type="button" onClick={() => void downloadWorkflowFile(file)} className="rounded-lg p-1.5 text-emerald-500 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-800/30" title="Tải về" aria-label={`Tải về ${file.fileName}`}>
                                        <Download size={14} />
                                    </button>
                                )}
                                {!disabled && (
                                    <button type="button" onClick={() => removeFile(index)} className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-800/30" title="Xoá file" aria-label={`Xoá ${file.fileName}`}>
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {!disabled && (
                <div
                    onClick={() => !isUploading && fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); if (!isUploading) setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
                    className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed transition-all ${files.length > 0 ? 'px-4 py-3' : 'px-6 py-8'} ${dragOver
                        ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
                        : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30 dark:border-slate-600 dark:hover:bg-emerald-900/5'
                        } ${isUploading ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                    <Upload size={files.length > 0 ? 18 : 24} className={dragOver ? 'text-emerald-500' : 'text-slate-400'} />
                    <span className="text-center text-sm text-slate-500">
                        <span className="font-bold text-emerald-600">
                            {isUploading ? `Đang tải ${progress!.done}/${progress!.total} file...` : files.length > 0 ? 'Thêm file' : 'Chọn nhiều file'}
                        </span>
                        {!isUploading && ' hoặc kéo thả vào đây'}
                        {files.length === 0 && <><br /><span className="text-xs text-slate-400">Excel, PDF, Word, Ảnh · mỗi file tối đa 25MB</span></>}
                    </span>
                </div>
            )}
            {error && <p className="text-xs font-bold text-red-500">{error}</p>}
            {previewIndex !== null && <WorkflowFilePreview files={files} startIndex={previewIndex} onClose={() => setPreviewIndex(null)} />}
        </div>
    );
};

// ========== Table Field Input ==========
interface TableFieldInputProps {
    fieldName: string;
    columns: string[];
    value: string[][] | null | undefined;
    onChange: (val: string[][]) => void;
    disabled?: boolean;
}

export const TableFieldInput: React.FC<TableFieldInputProps> = ({ fieldName, columns, value, onChange, disabled = false }) => {
    // Ensure value is initialized with at least one row if empty
    const rows = React.useMemo(() => {
        if (Array.isArray(value) && value.length > 0) return value;
        return [Array(columns.length).fill('')];
    }, [value, columns.length]);

    const handleCellChange = (rowIndex: number, colIndex: number, text: string) => {
        const updated = rows.map((r, ri) => {
            if (ri !== rowIndex) return r;
            const newRow = [...r];
            newRow[colIndex] = text;
            return newRow;
        });
        onChange(updated);
    };

    const addRow = () => {
        const updated = [...rows, Array(columns.length).fill('')];
        onChange(updated);
    };

    const removeRow = (rowIndex: number) => {
        if (rows.length <= 1) {
            onChange([Array(columns.length).fill('')]);
            return;
        }
        const updated = rows.filter((_, ri) => ri !== rowIndex);
        onChange(updated);
    };

    return (
        <div className="mt-2 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left" style={{ minWidth: Math.max(600, columns.length * 150) }}>
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                            <th className="px-4 py-3 text-center w-12">#</th>
                            {columns.map((col, idx) => (
                                <th key={idx} className="px-4 py-3">{col}</th>
                            ))}
                            {!disabled && <th className="px-3 py-2 text-center w-12"></th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rows.map((row, ri) => (
                            <tr key={ri} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="px-4 py-3 text-center text-slate-400 font-semibold align-middle">
                                    {String(ri + 1).padStart(2, '0')}
                                </td>
                                {columns.map((_, ci) => (
                                    <td key={ci} className="px-3 py-2 align-middle">
                                        <input
                                            type="text"
                                            value={row[ci] ?? ''}
                                            onChange={e => handleCellChange(ri, ci, e.target.value)}
                                            disabled={disabled}
                                            className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-transparent focus:ring-1 focus:ring-accent outline-none text-slate-700 dark:text-slate-200 text-sm font-semibold"
                                            placeholder="..."
                                        />
                                    </td>
                                ))}
                                {!disabled && (
                                    <td className="px-2 py-1 text-center align-middle">
                                        <button
                                            type="button"
                                            onClick={() => removeRow(ri)}
                                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                                            title="Xóa dòng"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!disabled && (
                <div className="p-2 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <button
                        type="button"
                        onClick={addRow}
                        className="inline-flex items-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition shadow-sm"
                    >
                        <Plus size={13} /> Thêm dòng
                    </button>
                    <span className="text-[10px] text-slate-400 font-medium">
                        Tổng cộng: {rows.length} dòng
                    </span>
                </div>
            )}
        </div>
    );
};

const WorkflowInstances: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { templates, categories, instances, nodes, edges, logs, createInstance, createDraft, loadInstanceFormData, updateInstance, submitDraft, deleteDraft, cancelInstance, processInstance, reopenInstance, getInstanceLogs, getPrintTemplates, updateInstanceWatchers } = useWorkflow();
    const { user, users, employees, orgUnits } = useApp();
    const { celebrate, showToast: celebrationToast } = useCelebration();
    const [activeTab, setActiveTab] = useState<'mine' | 'pending' | 'watching'>('pending');
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
    const [boardTemplateId, setBoardTemplateId] = useState<string>('');
    const [quickViewId, setQuickViewId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<{ instanceId: string; action: WorkflowInstanceAction } | null>(null);
    const navTouchedRef = useRef(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const targetInstanceId = useMemo(() => {
        return searchParams.get('id') || searchParams.get('wf') || searchParams.get('instanceId');
    }, [searchParams]);
    const [expandedId, setExpandedId] = useState<string | null>(() => targetInstanceId);
    const [selectedTemplateIdFilter, setSelectedTemplateIdFilter] = useState('');
    const instanceRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const loadedFormDataIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!targetInstanceId) return;
        navigate(buildWorkflowRoute(targetInstanceId), { replace: true });
    }, [navigate, targetInstanceId]);

    // File preview state

    // Create form state
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [newTitle, setNewTitle] = useState('');
    const [newNote, setNewNote] = useState('');
    const [customFormData, setCustomFormData] = useState<Record<string, any>>({});
    const [initialAssigneeIds, setInitialAssigneeIds] = useState<string[]>([]);

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
    const selectedCustomFields: WorkflowCustomField[] = selectedTemplate?.customFields || [];
    const selectedFirstTaskNode = useMemo(() => {
        if (!selectedTemplateId) return null;
        const startNode = nodes.find(node => node.templateId === selectedTemplateId && node.type === WorkflowNodeType.START);
        const firstEdge = startNode
            ? edges.find(edge => edge.templateId === selectedTemplateId && edge.sourceNodeId === startNode.id)
            : null;
        return firstEdge ? nodes.find(node => node.id === firstEdge.targetNodeId) || null : null;
    }, [edges, nodes, selectedTemplateId]);
    const initialAssigneeCandidates = useMemo(() => resolveWorkflowStepAssigneeCandidates({
        node: selectedFirstTaskNode,
        instance: { createdBy: user.id } as WorkflowInstance,
        users,
        employees,
        orgUnits,
    }), [employees, orgUnits, selectedFirstTaskNode, user.id, users]);
    const initialAssigneeSelectionMode = getWorkflowStepSelectionMode(selectedFirstTaskNode);
    const initialCandidateIdsKey = initialAssigneeCandidates.map(candidate => candidate.id).join('|');
    const requiresInitialAssignee = Boolean(selectedFirstTaskNode && selectedFirstTaskNode.type !== WorkflowNodeType.END);

    useEffect(() => {
        const candidateIds = initialAssigneeCandidates.map(candidate => candidate.id);
        setInitialAssigneeIds(previous => {
            const validPrevious = previous.filter(id => candidateIds.includes(id));
            if (validPrevious.length > 0) return validPrevious;
            return candidateIds.length === 1 ? [candidateIds[0]] : [];
        });
    }, [initialCandidateIdsKey, selectedTemplateId]);

    // Action state
    const [actionComment, setActionComment] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [uploadingStepFiles, setUploadingStepFiles] = useState(false);

    // Edit instance state
    const [editingInstance, setEditingInstance] = useState<WorkflowInstance | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editFormData, setEditFormData] = useState<Record<string, any>>({});

    // Delete/Cancel confirm state
    const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

    // Reopen modal state (Admin can revert completed/rejected instances)
    const [reopenInstanceId, setReopenInstanceId] = useState<string | null>(null);
    const [reopenTargetNodeId, setReopenTargetNodeId] = useState('');
    const [reopenComment, setReopenComment] = useState('');

    useEffect(() => {
        const hasActiveOverlay = showCreateModal || !!editingInstance || !!quickViewId || !!cancelConfirmId || !!reopenInstanceId;
        if (hasActiveOverlay) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [showCreateModal, editingInstance, quickViewId, cancelConfirmId, reopenInstanceId]);

    // Step data editing state
    const [stepFormData, setStepFormData] = useState<Record<string, any>>({});
    const [stepExcelData, setStepExcelData] = useState<{ sheets: Record<string, any[][]>; sheetNames: string[] } | null>(null);

    const activeTemplates = templates.filter(t => t.isActive);
    const nonMaterialActiveTemplates = activeTemplates.filter(t =>
        !isMaterialRequestWorkflowTemplate(t) && !isRequestModuleWorkflowTemplate(t)
    );
    const boardTemplates = activeTemplates.filter(t =>
        !isRequestModuleWorkflowTemplate(t) && !isProjectOwnedWorkflowTemplate(t)
        && (!isMaterialRequestWorkflowTemplate(t) || canSeeMaterialRequestWorkflowOnKanban(user))
    );
    const templateById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
    const isMaterialWorkflowInstance = useCallback(
        (instance: WorkflowInstance) => isMaterialRequestWorkflowTemplate(templateById.get(instance.templateId)),
        [templateById],
    );
    const isRequestModuleWorkflowInstance = useCallback(
        (instance: WorkflowInstance) => isRequestModuleWorkflowTemplate(templateById.get(instance.templateId)),
        [templateById],
    );
    const visibleListInstances = useMemo(
        () => instances.filter(instance =>
            !isMaterialWorkflowInstance(instance) && !isRequestModuleWorkflowInstance(instance)
        ),
        [instances, isMaterialWorkflowInstance, isRequestModuleWorkflowInstance],
    );
    // One pass over the tickets instead of one filter per template in the sidebar.
    const sidebarCountByTemplate = useMemo(() => {
        const counts = new Map<string, number>();
        visibleListInstances.forEach(i => {
            let matchTab: boolean;
            if (activeTab === 'mine') matchTab = i.createdBy === user.id;
            else if (activeTab === 'watching') matchTab = i.watchers?.includes(user.id) || templateById.get(i.templateId)?.defaultWatchers?.includes(user.id) || false;
            else matchTab = (i.status === WorkflowInstanceStatus.RUNNING && i.currentNodeId && (isWorkflowStepAssignedToUser(i, nodes.find(n => n.id === i.currentNodeId)!, user) || user.role === Role.ADMIN || templateById.get(i.templateId)?.managers?.includes(user.id))) || false;
            const matchStatus = filterStatus === 'ALL' ? true : i.status === filterStatus;
            if (matchTab && matchStatus) counts.set(i.templateId, (counts.get(i.templateId) || 0) + 1);
        });
        return counts;
    }, [visibleListInstances, activeTab, filterStatus, templateById, nodes, user]);
    const visibleBoardInstances = useMemo(
        () => instances.filter(instance =>
            !isRequestModuleWorkflowInstance(instance)
            && (canSeeMaterialRequestWorkflowOnKanban(user) || !isMaterialWorkflowInstance(instance))
        ),
        [instances, isMaterialWorkflowInstance, isRequestModuleWorkflowInstance, user],
    );
    useEffect(() => {
        if (boardTemplateId && !boardTemplates.some(template => template.id === boardTemplateId)) {
            setBoardTemplateId('');
        }
    }, [boardTemplateId, boardTemplates]);
    const getEffectiveAssigneeUserId = useCallback((instance: WorkflowInstance, node?: { id: string; config: any } | null) => {
        if (!node) return undefined;
        return instance.stepAssignees?.[node.id] || node.config.assigneeUserId;
    }, []);

    // Filter instances based on active tab
    const filteredInstances = useMemo(() => {
        let list = visibleListInstances;

        if (activeTab === 'mine') {
            list = list.filter(i => i.createdBy === user.id);
        } else if (activeTab === 'watching') {
            // Show instances where user is a watcher (instance-level or default template-level)
            list = list.filter(i => {
                if (i.watchers?.includes(user.id)) return true;
                const tmpl = templates.find(t => t.id === i.templateId);
                if (tmpl?.defaultWatchers?.includes(user.id)) return true;
                return false;
            });
        } else {
            // "Chờ tôi duyệt": instances where current node is assigned to this user (by role or by userId)
            list = list.filter(i => {
                if (i.status !== WorkflowInstanceStatus.RUNNING || !i.currentNodeId) return false;
                const currentNode = nodes.find(n => n.id === i.currentNodeId);
                if (!currentNode) return false;
                if (isWorkflowStepAssignedToUser(i, currentNode, user)) return true;
                if (user.role === Role.ADMIN) return true; // admin sees all
                // Managers can also see pending instances for their templates
                const tmpl = templates.find(t => t.id === i.templateId);
                if (tmpl?.managers?.includes(user.id)) return true;
                return false;
            });
        }

        if (selectedTemplateIdFilter) {
            list = list.filter(i => i.templateId === selectedTemplateIdFilter);
        }

        if (filterStatus !== 'ALL') {
            list = list.filter(i => i.status === filterStatus);
        }

        if (searchTerm) {
            list = list.filter(i => matchesSearchQueryMultiple([i.code, i.title], searchTerm));
        }

        return list;
    }, [visibleListInstances, activeTab, filterStatus, searchTerm, user, nodes, templates, selectedTemplateIdFilter]);

    const boardRunningCountByTemplate = useMemo(() => {
        const counts = new Map<string, number>();
        visibleBoardInstances.forEach(i => {
            if (i.status === WorkflowInstanceStatus.RUNNING) counts.set(i.templateId, (counts.get(i.templateId) || 0) + 1);
        });
        return counts;
    }, [visibleBoardInstances]);

    const activeInstanceId = useMemo(() => {
        if (expandedId && filteredInstances.some(i => i.id === expandedId)) {
            return expandedId;
        }
        return null;
    }, [expandedId, filteredInstances]);

    const activeInstance = useMemo(() => {
        return instances.find(i => i.id === activeInstanceId) || null;
    }, [instances, activeInstanceId]);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const showToast = (type: 'success' | 'error', text: string) => {
        celebrationToast({ type, title: text });
    };

    const ensureInstanceFormData = useCallback(async (instance: WorkflowInstance): Promise<WorkflowInstance> => {
        if (Object.keys(instance.formData || {}).length > 0 || loadedFormDataIdsRef.current.has(instance.id)) {
            return instance;
        }

        const formData = await loadInstanceFormData(instance.id);
        loadedFormDataIdsRef.current.add(instance.id);
        return { ...instance, formData: formData || {} };
    }, [loadInstanceFormData]);

    const handleToggleExpand = useCallback(async (instance: WorkflowInstance) => {
        if (expandedId === instance.id) {
            setExpandedId(null);
            setSearchParams({}, { replace: true });
            return;
        }
        setExpandedId(instance.id);
        setSearchParams({ id: instance.id }, { replace: true });
        await ensureInstanceFormData(instance);
    }, [expandedId, ensureInstanceFormData, setSearchParams]);

    const handleStepFileUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploadingStepFiles(true);
        try {
            const uploadedFiles = [];
            for (let i = 0; i < files.length; i++) {
                uploadedFiles.push(await uploadWorkflowAttachment(files[i]));
            }
            setStepFormData(prev => ({ ...prev, _files: [...(prev._files || []), ...uploadedFiles] }));
        } catch (err) {
            console.error('Step attachment upload error:', err);
            alert('Không upload được file đính kèm. Vui lòng thử lại.');
        } finally {
            setUploadingStepFiles(false);
        }
    }, []);

    const handleCreate = async () => {
        if (!selectedTemplateId || !newTitle.trim()) return;
        // Check required custom fields
        for (const field of selectedCustomFields) {
            if (field.required && !customFormData[field.name]) return;
        }
        setIsSubmitting(true);
        try {
            const formData = { ...customFormData, note: newNote };
            const result = await createInstance(
                selectedTemplateId,
                newTitle.trim(),
                user.id,
                formData,
                initialAssigneeIds,
            );
            if (!result) {
                setIsSubmitting(false);
                showToast('error', 'Tạo phiếu thất bại. Kiểm tra lại mẫu quy trình có đủ các bước (Bắt đầu/Kết thúc) chưa.');
                return;
            }
            setShowCreateModal(false);
            setSelectedTemplateId('');
            setNewTitle('');
            setNewNote('');
            setCustomFormData({});
            setInitialAssigneeIds([]);
            loadedFormDataIdsRef.current.add(result.id);
            setActiveTab('mine');
            showToast('success', `Phiếu "${result.title}" đã được tạo thành công!`);
        } catch (err) {
            showToast('error', 'Đã xảy ra lỗi khi tạo phiếu. Vui lòng thử lại.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveDraft = async () => {
        if (!selectedTemplateId || !newTitle.trim()) return;
        setIsSubmitting(true);
        try {
            const result = await createDraft(
                selectedTemplateId,
                newTitle.trim(),
                { ...customFormData, note: newNote },
                initialAssigneeIds,
            );
            if (!result) {
                showToast('error', 'Không lưu được bản nháp. Vui lòng thử lại.');
                return;
            }
            setShowCreateModal(false);
            setSelectedTemplateId('');
            setNewTitle('');
            setNewNote('');
            setCustomFormData({});
            setInitialAssigneeIds([]);
            loadedFormDataIdsRef.current.add(result.id);
            setActiveTab('mine');
            showToast('success', `Đã lưu bản nháp "${result.title}".`);
        } catch (err) {
            showToast('error', 'Không lưu được bản nháp. Vui lòng thử lại.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSelectTemplate = (tid: string) => {
        setSelectedTemplateId(tid);
        setCustomFormData({});
        setInitialAssigneeIds([]);
    };

    const openCreateModal = () => {
        setSelectedTemplateId('');
        setNewTitle('');
        setNewNote('');
        setCustomFormData({});
        setInitialAssigneeIds([]);
        setShowCreateModal(true);
    };

    const toggleInitialAssignee = (candidateId: string) => {
        setInitialAssigneeIds(previous => {
            if (initialAssigneeSelectionMode === 'single') return [candidateId];
            return previous.includes(candidateId)
                ? previous.filter(id => id !== candidateId)
                : [...previous, candidateId];
        });
    };

    // ==================== WORD EXPORT ====================
    const handleExportWord = async (instance: WorkflowInstance, printTemplate: WorkflowPrintTemplate) => {
        try {
            instance = await ensureInstanceFormData(instance);
            // 1. Download .docx from Supabase Storage
            const { data: fileData, error } = await supabase.storage.from('workflow-templates').download(printTemplate.storagePath);
            if (error || !fileData) { alert('Không tải được file mẫu. Vui lòng thử lại.'); return; }

            // 2. Prepare image module for signatures
            let ImageModule: any = null;
            try { ImageModule = (await import('open-docxtemplater-image-module')).default; } catch { }

            const imageMap: Record<string, ArrayBuffer> = {};
            // Collect approver signatures
            const instanceLogs = logs.filter(l => l.instanceId === instance.id);
            for (const log of instanceLogs) {
                const node = nodes.find(n => n.id === log.nodeId);
                if (!node) continue;
                const actor = users.find(u => u.id === log.actedBy);
                if (!actor?.signatureUrl) continue;
                const safeLabel = node.label.replace(/\s+/g, '_').toLowerCase();
                try {
                    const sigRes = await fetch(actor.signatureUrl);
                    if (sigRes.ok) imageMap[`signature_${safeLabel}`] = await sigRes.arrayBuffer();
                } catch { }
            }
            // Creator signature
            const creator = users.find(u => u.id === instance.createdBy);
            if (creator?.signatureUrl) {
                try {
                    const sigRes = await fetch(creator.signatureUrl);
                    if (sigRes.ok) imageMap['signature_creator'] = await sigRes.arrayBuffer();
                } catch { }
            }

            // 3. Parse with PizZip + Docxtemplater
            const arrayBuffer = await fileData.arrayBuffer();
            const zip = new PizZip(arrayBuffer);

            const modules: any[] = [];
            if (ImageModule && Object.keys(imageMap).length > 0) {
                const imgModule = new ImageModule({
                    centered: false,
                    getImage: (tagValue: string) => imageMap[tagValue] || new ArrayBuffer(0),
                    getSize: () => [150, 60],
                });
                modules.push(imgModule);
            }

            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '${', end: '}' },
                modules,
            });

            // 4. Build data object
            const template = templates.find(t => t.id === instance.templateId);
            const createdDate = new Date(instance.createdAt);
            const statusLabels: Record<string, string> = {
                RUNNING: 'Đang xử lý', COMPLETED: 'Hoàn thành',
                REJECTED: 'Từ chối', CANCELLED: 'Đã hủy',
            };

            const data: Record<string, any> = {
                code: instance.code || '',
                title: instance.title || '',
                creator_name: creator?.name || '',
                creator_email: creator?.email || '',
                created_at_day: String(createdDate.getDate()).padStart(2, '0'),
                created_at_month: String(createdDate.getMonth() + 1).padStart(2, '0'),
                created_at_year: String(createdDate.getFullYear()),
                created_at_full: createdDate.toLocaleDateString('vi-VN'),
                template_name: template?.name || '',
                status: statusLabels[instance.status] || instance.status,
            };

            // Add signature keys for image module
            Object.keys(imageMap).forEach(key => { data[key] = key; });

            // Form data fields (auto-map)
            if (instance.formData) {
                Object.entries(instance.formData).forEach(([key, value]) => {
                    if (typeof value === 'object' && value !== null) {
                        const attached = normalizeWorkflowFiles(value);
                        if (attached.length > 0) data[key] = attached.map(file => file.fileName).join(', ');
                    } else {
                        data[key] = String(value ?? '');
                    }
                });
            }

            // Approver fields from logs
            instanceLogs.forEach(log => {
                const node = nodes.find(n => n.id === log.nodeId);
                if (node) {
                    const actor = users.find(u => u.id === log.actedBy);
                    const safeLabel = node.label.replace(/\s+/g, '_').toLowerCase();
                    data[`approver_${safeLabel}`] = actor?.name || '';
                    const logDate = new Date(log.createdAt);
                    data[`approved_date_${safeLabel}`] = logDate.toLocaleDateString('vi-VN');
                }
            });

            // 5. Replace placeholders
            doc.render(data);

            // 6. Generate and download
            const output = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            saveAs(output, `${instance.code}_${printTemplate.name}.docx`);
        } catch (err: any) {
            console.error('Export Word error:', err);
            alert('Lỗi khi xuất Word: ' + (err.message || 'Không xác định'));
        }
    };

    const handleAction = async (instanceId: string, action: WorkflowInstanceAction) => {
        setProcessingId(instanceId);
        let instance = instances.find(i => i.id === instanceId);
        try {
            // Save step data if any
            if (instance) {
                instance = await ensureInstanceFormData(instance);
                const nodeId = instance.currentNodeId;
                const newFormData = { ...(instance.formData || {}) };
                // Save step form fields (exclude _files which is handled separately)
                const formEntries = Object.entries(stepFormData).filter(([k]) => k !== '_files');
                if (formEntries.length > 0) {
                    formEntries.forEach(([key, value]) => {
                        newFormData[`step_${nodeId}_${key}`] = value;
                    });
                }
                // Save step file attachments
                if (stepFormData._files && stepFormData._files.length > 0) {
                    newFormData[`step_${nodeId}_files`] = stepFormData._files;
                }
                // Save step-level Excel edits
                if (stepExcelData) {
                    newFormData[`step_${nodeId}_excel_data`] = stepExcelData.sheets;
                    newFormData[`step_${nodeId}_excel_sheets`] = stepExcelData.sheetNames;
                }
                if (formEntries.length > 0 || stepExcelData || (stepFormData._files && stepFormData._files.length > 0)) {
                    const saved = await updateInstance(instanceId, { formData: newFormData });
                    if (!saved) throw new Error('Không lưu được dữ liệu bước');
                    instance = { ...instance, formData: newFormData };
                }
            }

            const result = await processInstance(instanceId, action, user.id, actionComment);
            if (!result.ok) {
                showToast('error', result.errorMessage || 'Thao tác quy trình thất bại. Vui lòng thử lại.');
                return;
            }

            // 🎉 Celebration!
            if (action === WorkflowInstanceAction.APPROVED) {
                celebrate({
                    variant: 'approve',
                    title: '✅ Đã Duyệt Thành Công!',
                    subtitle: instance?.title || '',
                    confetti: true,
                });
            } else if (action === WorkflowInstanceAction.REJECTED) {
                celebrationToast({ type: 'warning', title: 'Phiếu đã bị từ chối', message: instance?.title || '' });
            } else if (action === WorkflowInstanceAction.REVISION_REQUESTED) {
                celebrationToast({ type: 'info', title: 'Yêu cầu chỉnh sửa đã gửi', message: instance?.title || '' });
            }

            setActionComment('');
            setStepFormData({});
            setStepExcelData(null);
        } catch (err) {
            console.error('handleAction error:', err);
            showToast('error', 'Không xử lý được phiếu. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    // Edit instance handlers
    const openEditModal = async (instance: WorkflowInstance) => {
        const readyInstance = await ensureInstanceFormData(instance);
        setEditingInstance(readyInstance);
        setSelectedTemplateId(readyInstance.templateId);
        setEditTitle(readyInstance.title);
        // Extract only the original form data (non step_ prefixed)
        const originalFormData: Record<string, any> = {};
        Object.entries(readyInstance.formData || {}).forEach(([key, value]) => {
            if (!key.startsWith('step_')) {
                originalFormData[key] = value;
            }
        });
        setEditFormData(originalFormData);
        const startNode = nodes.find(node => node.templateId === readyInstance.templateId && node.type === WorkflowNodeType.START);
        const firstEdge = startNode
            ? edges.find(edge => edge.templateId === readyInstance.templateId && edge.sourceNodeId === startNode.id)
            : null;
        const savedAssignees = firstEdge ? readyInstance.stepAssignees?.[firstEdge.targetNodeId] : [];
        setInitialAssigneeIds(Array.isArray(savedAssignees)
            ? savedAssignees
            : savedAssignees ? [savedAssignees] : []);
    };

    const handleEditSave = async () => {
        if (!editingInstance || !editTitle.trim()) return;
        setIsSubmitting(true);
        // Merge step data back in
        const stepData: Record<string, any> = {};
        Object.entries(editingInstance.formData || {}).forEach(([key, value]) => {
            if (key.startsWith('step_')) {
                stepData[key] = value;
            }
        });
        const mergedFormData = { ...editFormData, ...stepData };
        const ok = await updateInstance(editingInstance.id, {
            title: editTitle.trim(),
            formData: mergedFormData,
            ...(editingInstance.status === WorkflowInstanceStatus.DRAFT
                ? { initialAssigneeUserIds: initialAssigneeIds }
                : {}),
        });
        setIsSubmitting(false);
        if (ok) {
            showToast('success', 'Phiếu đã được cập nhật thành công!');
            setEditingInstance(null);
        } else {
            showToast('error', 'Cập nhật phiếu thất bại.');
        }
    };

    const handleSubmitDraft = async () => {
        if (!editingInstance || editingInstance.status !== WorkflowInstanceStatus.DRAFT || !editTitle.trim()) return;
        if (!selectedFirstTaskNode || (requiresInitialAssignee && initialAssigneeIds.length === 0)) {
            showToast('error', 'Cần chọn người xử lý bước đầu trước khi gửi phiếu.');
            return;
        }
        if (selectedCustomFields.some(field => field.required && !editFormData[field.name])) {
            showToast('error', 'Vui lòng điền đủ các trường bắt buộc trước khi gửi phiếu.');
            return;
        }
        setIsSubmitting(true);
        try {
            const saved = await updateInstance(editingInstance.id, {
                title: editTitle.trim(),
                formData: editFormData,
                initialAssigneeUserIds: initialAssigneeIds,
            });
            const submitted = saved && await submitDraft(editingInstance.id, initialAssigneeIds);
            if (!submitted) {
                showToast('error', 'Không gửi được bản nháp. Vui lòng kiểm tra lại dữ liệu.');
                return;
            }
            setEditingInstance(null);
            showToast('success', 'Bản nháp đã được gửi vào quy trình xử lý.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteDraft = async () => {
        if (!editingInstance || editingInstance.status !== WorkflowInstanceStatus.DRAFT) return;
        if (!window.confirm(`Xóa bản nháp "${editingInstance.title}"?`)) return;
        setIsSubmitting(true);
        try {
            const deleted = await deleteDraft(editingInstance.id);
            if (!deleted) {
                showToast('error', 'Không xóa được bản nháp.');
                return;
            }
            setEditingInstance(null);
            showToast('success', 'Đã xóa bản nháp.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = async (id: string) => {
        const ok = await cancelInstance(id, user.id);
        setCancelConfirmId(null);
        if (ok) {
            showToast('success', 'Phiếu đã được hủy!');
        } else {
            showToast('error', 'Hủy phiếu thất bại.');
        }
    };

    const getNodeTimeline = (instance: WorkflowInstance) => {
        const templateNodes = nodes.filter(n => n.templateId === instance.templateId);
        const templateEdges = edges.filter(e => e.templateId === instance.templateId);
        const instanceLogs = getInstanceLogs(instance.id);

        // Build ordered path from START
        const orderedNodes: typeof templateNodes = [];
        let currentNode = templateNodes.find(n => n.type === WorkflowNodeType.START);
        const visited = new Set<string>();
        while (currentNode && !visited.has(currentNode.id)) {
            visited.add(currentNode.id);
            orderedNodes.push(currentNode);
            const nextEdge = templateEdges.find(e => e.sourceNodeId === currentNode!.id);
            if (nextEdge) {
                currentNode = templateNodes.find(n => n.id === nextEdge.targetNodeId);
            } else {
                break;
            }
        }

        return orderedNodes.map(node => {
            const nodeLog = instanceLogs.filter(l => l.nodeId === node.id);
            const isCurrent = instance.currentNodeId === node.id;
            const isPast = nodeLog.length > 0;
            // Extract step-specific data
            const stepData: Record<string, any> = {};
            Object.entries(instance.formData || {}).forEach(([key, value]) => {
                const prefix = `step_${node.id}_`;
                if (key.startsWith(prefix)) {
                    stepData[key.replace(prefix, '')] = value;
                }
            });
            return { node, logs: nodeLog, isCurrent, isPast, stepData };
        });
    };

    // Permission checks
    const isCreator = (instance: WorkflowInstance): boolean => instance.createdBy === user.id;
    const isRunning = (instance: WorkflowInstance): boolean => instance.status === WorkflowInstanceStatus.RUNNING;

    // Check if instance has any approval actions (approved by someone other than creator)
    const hasBeenApproved = (instance: WorkflowInstance): boolean => {
        const instanceLogs = getInstanceLogs(instance.id);
        return instanceLogs.some(l => l.action === 'APPROVED');
    };

    // Non-admin: can only delete own instances that have NOT been approved by anyone
    // Admin: can always delete
    const canDeleteInstance = (instance: WorkflowInstance): boolean => {
        if (user.role === Role.ADMIN) return true;
        return isCreator(instance) && !hasBeenApproved(instance);
    };

    // Check if user can approve current node
    const canActOnInstance = (instance: WorkflowInstance): boolean => {
        const currentNode = nodes.find(n => n.id === instance.currentNodeId);
        const tmpl = templates.find(t => t.id === instance.templateId);
        const startNode = nodes.find(n => n.templateId === instance.templateId && n.type === WorkflowNodeType.START);
        const firstTaskNodeId = startNode
            ? edges.find(edge => edge.templateId === instance.templateId && edge.sourceNodeId === startNode.id)?.targetNodeId
            : null;
        const hasAssignedAction = user.role === Role.ADMIN
            || canPerform(user, 'workflow.instance.act_assigned', {
                scopeType: 'assigned',
                scopeId: user.id,
            })
            || canPerform(user, 'workflow.instance.act_assigned', {
                scopeType: 'global',
                scopeId: '*',
            });
        return hasAssignedAction && canUserActOnWorkflowStep({
            instance,
            node: currentNode,
            user,
            templateManagerIds: tmpl?.managers,
            firstTaskNodeId,
            logs: getInstanceLogs(instance.id),
        });
    };

    // ===== Workspace data: step insight, who is waiting on me, sidebar counts, KPIs =====
    const workStepsByTemplate = useMemo(() => buildWorkSteps(nodes, edges), [nodes, edges]);
    const lastActivityById = useMemo(() => {
        const latest = new Map<string, number>();
        logs.forEach(log => {
            const at = Date.parse(log.createdAt);
            if (at > (latest.get(log.instanceId) || 0)) latest.set(log.instanceId, at);
        });
        return latest;
    }, [logs]);
    const insightById = useMemo(() => {
        const now = Date.now();
        const result = new Map<string, WorkflowInstanceInsight>();
        instances.forEach(instance => result.set(
            instance.id,
            getWorkflowInstanceInsight(instance, workStepsByTemplate.get(instance.templateId) || [], lastActivityById.get(instance.id), now),
        ));
        return result;
    }, [instances, workStepsByTemplate, lastActivityById]);
    const waitingForMeIds = useMemo(
        () => new Set(visibleBoardInstances.filter(i => i.status === WorkflowInstanceStatus.RUNNING && canActOnInstance(i)).map(i => i.id)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [visibleBoardInstances, nodes, edges, templates, user, logs],
    );
    const navCounts = useMemo(() => ({
        pending: visibleListInstances.filter(i => waitingForMeIds.has(i.id)).length,
        mine: visibleListInstances.filter(i => i.createdBy === user.id).length,
        watching: visibleListInstances.filter(i => i.watchers?.includes(user.id) || templateById.get(i.templateId)?.defaultWatchers?.includes(user.id)).length,
    }), [visibleListInstances, waitingForMeIds, user.id, templateById]);
    const kpiValues = useMemo<WorkflowKpiValues>(() => {
        const running = visibleListInstances.filter(i => i.status === WorkflowInstanceStatus.RUNNING);
        return {
            waitingForMe: navCounts.pending,
            needsAttention: running.filter(i => insightById.get(i.id)?.overdue || insightById.get(i.id)?.stale).length,
            running: running.length,
            completed: visibleListInstances.filter(i => i.status === WorkflowInstanceStatus.COMPLETED).length,
            runningTemplates: new Set(running.map(i => i.templateId)).size,
        };
    }, [visibleListInstances, navCounts.pending, insightById]);
    // Waiting-on-me first, then past SLA, then whoever has waited longest.
    const sortedInstances = useMemo(() => filteredInstances.slice().sort((a, b) => {
        const ia = insightById.get(a.id)!;
        const ib = insightById.get(b.id)!;
        return Number(waitingForMeIds.has(b.id)) - Number(waitingForMeIds.has(a.id))
            || Number(ib.overdue) - Number(ia.overdue)
            || (b.status === WorkflowInstanceStatus.RUNNING ? ib.sinceHours : 0) - (a.status === WorkflowInstanceStatus.RUNNING ? ia.sinceHours : 0);
    }), [filteredInstances, insightById, waitingForMeIds]);
    // The board shows every ticket of the chosen workflow so the whole flow is visible; the ones
    // waiting on you are highlighted instead of hiding the rest.
    const boardInstances = useMemo(
        () => searchTerm ? visibleBoardInstances.filter(i => matchesSearchQueryMultiple([i.code, i.title], searchTerm)) : visibleBoardInstances,
        [visibleBoardInstances, searchTerm],
    );
    const boardSummary = useMemo(() => {
        const ofTemplate = boardInstances.filter(i => i.templateId === boardTemplateId);
        return {
            total: ofTemplate.filter(i => i.status !== WorkflowInstanceStatus.CANCELLED).length,
            waitingForMe: ofTemplate.filter(i => waitingForMeIds.has(i.id)).length,
            needsAttention: ofTemplate.filter(i => insightById.get(i.id)?.overdue || insightById.get(i.id)?.stale).length,
        };
    }, [boardInstances, boardTemplateId, waitingForMeIds, insightById]);

    const pageTitle = viewMode === 'board'
        ? boardTemplates.find(t => t.id === boardTemplateId)?.name || 'Quy trình duyệt'
        : selectedTemplateIdFilter
            ? templateById.get(selectedTemplateIdFilter)?.name || 'Quy trình duyệt'
            : activeTab === 'pending' ? 'Chờ tôi duyệt' : activeTab === 'mine' ? 'Phiếu của tôi' : 'Đang theo dõi';

    const goToNav = (id: 'pending' | 'mine' | 'watching') => {
        navTouchedRef.current = true;
        setActiveTab(id);
        setViewMode('list');
        setExpandedId(null);
        setSelectedTemplateIdFilter('');
    };
    const selectSidebarTemplate = (templateId: string, fromSelect = false) => {
        if (viewMode === 'board') {
            if (templateId) setBoardTemplateId(templateId);
            return;
        }
        setExpandedId(null);
        setSelectedTemplateIdFilter(fromSelect || selectedTemplateIdFilter !== templateId ? templateId : '');
    };
    const openQuickView = (instance: WorkflowInstance) => {
        if (instance.status === WorkflowInstanceStatus.DRAFT) {
            void openEditModal(instance);
            return;
        }
        setQuickViewId(instance.id);
        void ensureInstanceFormData(instance);
    };
    const handleActionDone = (instanceId: string, action: WorkflowInstanceAction) => {
        const title = instances.find(i => i.id === instanceId)?.title || '';
        if (action === WorkflowInstanceAction.APPROVED) celebrate({ variant: 'approve', title: '✅ Đã Duyệt Thành Công!', subtitle: title, confetti: true });
        else if (action === WorkflowInstanceAction.REJECTED) celebrationToast({ type: 'warning', title: 'Phiếu đã bị từ chối', message: title });
        else celebrationToast({ type: 'info', title: 'Yêu cầu chỉnh sửa đã gửi', message: title });
        setQuickViewId(null);
    };

    // Open on "Chờ tôi duyệt" when something waits; otherwise on the user's own tickets.
    useEffect(() => {
        if (navTouchedRef.current || targetInstanceId || instances.length === 0) return;
        navTouchedRef.current = true;
        if (navCounts.pending === 0) setActiveTab('mine');
    }, [instances.length, navCounts.pending, targetInstanceId]);
    // Switching to the board needs a workflow: prefer the one picked in the sidebar, else the busiest.
    useEffect(() => {
        if (viewMode !== 'board' || boardTemplateId || boardTemplates.length === 0) return;
        const busiest = boardTemplates
            .map(t => ({ id: t.id, count: boardRunningCountByTemplate.get(t.id) || 0 }))
            .sort((a, b) => b.count - a.count)[0];
        setBoardTemplateId(boardTemplates.some(t => t.id === selectedTemplateIdFilter) ? selectedTemplateIdFilter : busiest.id);
    }, [viewMode, boardTemplateId, boardTemplates, boardRunningCountByTemplate, selectedTemplateIdFilter]);

    useEffect(() => {
        if (!targetInstanceId) return;
        const target = instances.find(instance => instance.id === targetInstanceId);
        if (!target) return;

        setViewMode('list');
        setFilterStatus('ALL');
        setSearchTerm('');
        setExpandedId(target.id);

        if (canActOnInstance(target)) setActiveTab('pending');
        else if (target.watchers?.includes(user.id)) setActiveTab('watching');
        else setActiveTab('mine');

        ensureInstanceFormData(target).catch(console.error);
        window.requestAnimationFrame(() => {
            instanceRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }, [ensureInstanceFormData, instances, targetInstanceId, user.id]);

    // Check if current step is the first step and was sent back for revision
    const isRevisionAtFirstStep = (instance: WorkflowInstance): boolean => {
        if (!instance.currentNodeId) return false;
        const startNode = nodes.find(n => n.templateId === instance.templateId && n.type === WorkflowNodeType.START);
        if (!startNode) return false;
        const templateEdgesLocal = edges.filter(e => e.templateId === instance.templateId);
        const firstEdge = templateEdgesLocal.find(e => e.sourceNodeId === startNode.id);
        if (!firstEdge || firstEdge.targetNodeId !== instance.currentNodeId) return false;
        const instanceLogs = logs.filter(l => l.instanceId === instance.id);
        return instanceLogs.some(l => l.action === WorkflowInstanceAction.REVISION_REQUESTED);
    };

    // Render custom fields form (reused in create and edit modals)
    const renderCustomFieldInputs = (
        fields: WorkflowCustomField[],
        data: Record<string, any>,
        onChange: (key: string, value: any) => void,
        disabled = false
    ) => (
        fields.map(field => (
            <div key={field.id}>
                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.type === 'text' && (
                    <input
                        type="text"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    />
                )}
                {field.type === 'textarea' && (
                    <textarea
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none disabled:opacity-50"
                        rows={3}
                    />
                )}
                {field.type === 'number' && (
                    <input
                        type="number"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    />
                )}
                {field.type === 'date' && (
                    <input
                        type="date"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    />
                )}
                {field.type === 'select' && (
                    <select
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    >
                        <option value="">-- Chọn {field.label.toLowerCase()} --</option>
                        {(field.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                )}
                {field.type === 'table' && (
                    <TableFieldInput
                        fieldName={field.name}
                        columns={field.options || []}
                        value={data[field.name]}
                        onChange={(val: string[][]) => onChange(field.name, val)}
                        disabled={disabled}
                    />
                )}
                {field.type === 'file' && (
                    <FileFieldInput
                        fieldName={field.name}
                        value={data[field.name]}
                        onChange={(val: any) => onChange(field.name, val)}
                        disabled={disabled}
                    />
                )}
            </div>
        ))
    );

    return (
        <div className="wf-base relative flex h-full w-full select-none overflow-hidden bg-[var(--wf-canvas)]">
            {/* Toast Notification */}
            {submitMessage && (
                <div className={`fixed top-6 right-6 z-[60] px-5 py-3.5 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-fade-in-down ${submitMessage.type === 'success'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-red-500 text-white'
                    }`}>
                    {submitMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    {submitMessage.text}
                    <button onClick={() => setSubmitMessage(null)} className="ml-2 p-0.5 hover:bg-white/20 rounded">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* ==================== WORKSPACE: sidebar + (danh sách | Kanban) ==================== */}
            <WorkflowSidebar
                activeNav={viewMode === 'list' ? activeTab : null}
                counts={navCounts}
                onNav={goToNav}
                onCreate={openCreateModal}
                createDisabled={nonMaterialActiveTemplates.length === 0}
                templates={viewMode === 'board' ? boardTemplates : nonMaterialActiveTemplates}
                categories={categories}
                userId={user.id}
                selectedTemplateId={viewMode === 'board' ? boardTemplateId : selectedTemplateIdFilter}
                onSelectTemplate={selectSidebarTemplate}
                getTemplateCount={templateId => (viewMode === 'board' ? boardRunningCountByTemplate : sidebarCountByTemplate).get(templateId) || 0}
            />

            <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wf-canvas)]">
                {viewMode === 'list' && activeInstanceId ? (
                    <div className="h-full w-full select-text overflow-y-auto bg-white px-3.5 py-3 dark:bg-[#313338] sm:px-6 sm:py-4">
                        <WorkflowInstanceDetail
                            instanceId={activeInstanceId}
                            onBack={() => { setExpandedId(null); setSearchParams({}, { replace: true }); }}
                        />
                    </div>
                ) : (
                    <>
                        <header className="shrink-0 space-y-3 border-b border-[var(--wf-border)] bg-white px-4 py-3 dark:bg-slate-900 md:px-6">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="mr-auto min-w-0 truncate text-lg font-bold text-slate-900 dark:text-white">{pageTitle}</h1>
                                <label className="relative w-full sm:w-48 xl:w-64">
                                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={searchTerm}
                                        onChange={event => setSearchTerm(event.target.value)}
                                        placeholder="Tìm mã hoặc tiêu đề…"
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                    />
                                </label>
                                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800" role="group" aria-label="Kiểu hiển thị">
                                    {([
                                        { id: 'list' as const, icon: <List size={14} />, label: 'Danh sách' },
                                        { id: 'board' as const, icon: <LayoutGrid size={14} />, label: 'Kanban' },
                                    ]).map(item => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            aria-pressed={viewMode === item.id}
                                            onClick={() => setViewMode(item.id)}
                                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-semibold transition ${viewMode === item.id ? 'bg-white text-mint-800 shadow-sm dark:bg-slate-900 dark:text-mint-300' : 'text-slate-500'}`}
                                        >
                                            {item.icon}{item.label}
                                        </button>
                                    ))}
                                </div>
                                <button type="button" onClick={openCreateModal} disabled={nonMaterialActiveTemplates.length === 0} className={`${btnPrimary} disabled:opacity-50`}>
                                    <Plus size={15} />Tạo phiếu
                                </button>
                            </div>

                            {/* Phone navigation: the sidebar is hidden below lg */}
                            <div className="no-scrollbar flex gap-1.5 overflow-x-auto lg:hidden">
                                {([
                                    { id: 'pending' as const, label: 'Chờ tôi duyệt' },
                                    { id: 'mine' as const, label: 'Của tôi' },
                                    { id: 'watching' as const, label: 'Theo dõi' },
                                ]).map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => goToNav(item.id)}
                                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${viewMode === 'list' && activeTab === item.id ? 'border-mint-300 bg-mint-50 text-mint-800' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
                                    >
                                        {item.label} {navCounts[item.id]}
                                    </button>
                                ))}
                                <select
                                    value={viewMode === 'board' ? boardTemplateId : selectedTemplateIdFilter}
                                    onChange={event => selectSidebarTemplate(event.target.value, true)}
                                    aria-label="Chọn quy trình"
                                    className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                >
                                    {viewMode === 'list' && <option value="">Mọi quy trình</option>}
                                    {(viewMode === 'board' ? boardTemplates : nonMaterialActiveTemplates).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </div>
                        </header>

                        <div className="wf-scroll min-h-0 flex-1 overflow-y-auto">
                            {viewMode === 'list' ? (
                                <div className="mx-auto max-w-7xl space-y-3 px-4 py-4 md:px-6">
                                    <WorkflowKpiStrip values={kpiValues} onWaitingClick={() => goToNav('pending')} />

                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {(['ALL', ...Object.keys(STATUS_MAP)] as string[]).map(status => (
                                            <button
                                                key={status}
                                                type="button"
                                                onClick={() => setFilterStatus(status)}
                                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filterStatus === status ? 'border-mint-300 bg-mint-50 text-mint-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
                                            >
                                                {status === 'ALL' ? 'Tất cả' : STATUS_MAP[status as WorkflowInstanceStatus].label}
                                            </button>
                                        ))}
                                        <span className="ml-auto text-xs text-slate-400">{sortedInstances.length} phiếu · ưu tiên: chờ bạn → quá hạn → lâu nhất</span>
                                    </div>

                                    {sortedInstances.length === 0 ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
                                            <Inbox size={26} className="mx-auto text-slate-300" />
                                            <p className="mt-3 font-semibold text-slate-700 dark:text-slate-200">{activeTab === 'pending' && !searchTerm && filterStatus === 'ALL' ? 'Bạn không còn phiếu nào chờ duyệt' : 'Không có phiếu khớp bộ lọc'}</p>
                                            <p className="mt-1 text-sm text-slate-400">Phiếu mới cần bạn xử lý sẽ hiện ở đây.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {sortedInstances.map(instance => {
                                                const template = templateById.get(instance.templateId);
                                                const insight = insightById.get(instance.id)!;
                                                return (
                                                    <WorkflowInstanceRow
                                                        key={instance.id}
                                                        instance={instance}
                                                        templateName={template?.name || ''}
                                                        insight={insight}
                                                        users={users}
                                                        creatorName={users.find(u => u.id === instance.createdBy)?.name || 'N/A'}
                                                        metaLine={getWorkflowMetaParts(instance.formData, template?.customFields, 1)[0] || ''}
                                                        fileCount={countWorkflowFiles(instance.formData)}
                                                        waitingForMe={waitingForMeIds.has(instance.id)}
                                                        onOpen={() => openQuickView(instance)}
                                                        onAction={action => setPendingAction({ instanceId: instance.id, action })}
                                                        onOpenCanonical={() => navigate(buildWorkflowRoute(instance.id))}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex h-full flex-col px-4 py-4 md:px-6">
                                    {boardTemplateId ? (
                                        <>
                                            <p className="mb-3 flex shrink-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                                                <span className="font-semibold text-slate-700 dark:text-slate-200">{boardSummary.total} phiếu</span>
                                                <WfBadge className="border-amber-200 bg-amber-50 text-amber-700">{boardSummary.waitingForMe} chờ bạn duyệt</WfBadge>
                                                <WfBadge className="border-rose-200 bg-rose-50 text-rose-700">{boardSummary.needsAttention} cần chú ý</WfBadge>
                                                <span className="hidden text-slate-400 sm:inline">Kéo thả thẻ sang cột kế tiếp để duyệt · bấm thẻ để xem nhanh</span>
                                            </p>
                                            <div className="min-h-0 flex-1">
                                                <KanbanBoard
                                                    templateId={boardTemplateId}
                                                    instances={boardInstances}
                                                    employees={employees}
                                                    orgUnits={orgUnits}
                                                    isWaitingForMe={instance => waitingForMeIds.has(instance.id)}
                                                    onQuickAction={(instance, action) => setPendingAction({ instanceId: instance.id, action })}
                                                    onCardClick={instance => openQuickView(instance)}
                                                    onDragComplete={async (instanceId, action, comment, assigneeIds) => {
                                                        const result = await processInstance(instanceId, action, user.id, comment, assigneeIds);
                                                        if (!result.ok) showToast('error', result.errorMessage || 'Không xử lý được phiếu.');
                                                    }}
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                                            <LayoutGrid size={40} className="opacity-40" />
                                            <p className="text-[13px] font-medium">Chọn một quy trình ở cột bên trái</p>
                                            <p className="text-[12px]">Mỗi cột trên bảng là một giai đoạn xử lý</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>

            {/* Quick look from the list or the board: summary first, full ticket behind "Xem chi tiết" */}
            {quickViewId && (() => {
                const instance = instances.find(i => i.id === quickViewId);
                const insight = instance ? insightById.get(instance.id) : undefined;
                if (!instance || !insight) return null;
                return (
                    <WorkflowInstanceSummaryPanel
                        instance={instance}
                        template={templateById.get(instance.templateId) || null}
                        insight={insight}
                        users={users}
                        logs={getInstanceLogs(instance.id)}
                        waitingForMe={waitingForMeIds.has(instance.id)}
                        onClose={() => setQuickViewId(null)}
                        onOpenDetail={() => navigate(buildWorkflowRoute(instance.id))}
                        onAction={action => setPendingAction({ instanceId: instance.id, action })}
                    />
                );
            })()}

            {pendingAction && (
                <WorkflowInstanceActionDialog
                    instanceId={pendingAction.instanceId}
                    action={pendingAction.action}
                    onClose={() => setPendingAction(null)}
                    onDone={() => handleActionDone(pendingAction.instanceId, pendingAction.action)}
                />
            )}

            {/* Shared Create Instance Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 h-[100dvh] max-h-[100dvh] overflow-hidden p-0 sm:p-4">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl p-4 sm:p-6 w-full sm:w-[75vw] xl:max-w-[1050px] 2xl:max-w-[1200px] shadow-2xl flex flex-col h-[92dvh] sm:h-auto max-h-[92dvh] sm:max-h-[90vh] overflow-hidden relative select-text animate-fade-in">
                        <div className="mobile-sheet-handle sm:hidden" />
                        <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white mb-3 sm:mb-4 flex items-center gap-2">
                            <Send size={18} className="text-accent" /> Tạo phiếu mới
                        </h2>
                        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto -webkit-overflow-scrolling-touch pr-1">
                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Chọn quy trình *</label>
                                <select
                                    value={selectedTemplateId}
                                    onChange={e => handleSelectTemplate(e.target.value)}
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold"
                                >
                                    <option value="">-- Chọn quy trình --</option>
                                    {nonMaterialActiveTemplates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề phiếu *</label>
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder="VD: Thanh toán hạng mục móng CT5..."
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold text-slate-850 dark:text-white"
                                />
                            </div>

                            {selectedTemplateId && (
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                        Người xử lý bước đầu *
                                    </label>
                                    {selectedFirstTaskNode && initialAssigneeCandidates.length > 0 ? (
                                        <div className="space-y-2">
                                            <p className="text-xs text-slate-500">
                                                Bước “{selectedFirstTaskNode.label}” · {initialAssigneeSelectionMode === 'multiple' ? 'có thể chọn nhiều người' : 'chọn một người'}
                                            </p>
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                {initialAssigneeCandidates.map(candidate => {
                                                    const checked = initialAssigneeIds.includes(candidate.id);
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={candidate.id}
                                                            onClick={() => toggleInitialAssignee(candidate.id)}
                                                            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${checked
                                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-100'
                                                                : 'border-slate-200 bg-white/60 text-slate-700 hover:border-indigo-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200'
                                                                }`}
                                                        >
                                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-500'}`}>
                                                                {checked && <CheckCircle size={13} />}
                                                            </span>
                                                            <span className="min-w-0">
                                                                <span className="block truncate text-sm font-black">{candidate.name}</span>
                                                                <span className="block truncate text-[11px] text-slate-400">{candidate.sublabel}</span>
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                                            Mẫu quy trình chưa cấu hình người nhận hợp lệ cho bước đầu.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Dynamic Custom Fields */}
                            {selectedCustomFields.length > 0 && (
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Thông tin bổ sung</p>
                                    {renderCustomFieldInputs(
                                        selectedCustomFields,
                                        customFormData,
                                        (key, value) => setCustomFormData(prev => ({ ...prev, [key]: value }))
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                <textarea
                                    value={newNote}
                                    onChange={e => setNewNote(e.target.value)}
                                    placeholder="Nội dung chi tiết..."
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none text-slate-850 dark:text-white"
                                    rows={2}
                                />
                            </div>
                        </div>
                        <div className="flex gap-4 mt-8 border-t border-slate-100 dark:border-slate-700/50 pt-5">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button
                                onClick={handleSaveDraft}
                                disabled={isSubmitting || !selectedTemplateId || !newTitle.trim()}
                                className="flex-1 px-5 py-3 border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300 rounded-xl font-bold text-base hover:bg-amber-100 dark:hover:bg-amber-950/50 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                <Save size={15} /> Lưu nháp
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={isSubmitting || !selectedTemplateId || !newTitle.trim() || !selectedFirstTaskNode || (requiresInitialAssignee && initialAssigneeIds.length === 0) || selectedCustomFields.some(f => f.required && !customFormData[f.name])}
                                className="flex-1 px-5 py-3 bg-accent text-white rounded-xl font-bold text-base hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang gửi...</>
                                ) : (
                                    'Gửi phiếu'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Edit Instance Modal */}
            {editingInstance && (() => {
                const editTemplate = templates.find(t => t.id === editingInstance.templateId);
                const editCustomFields = editTemplate?.customFields || [];
                return (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 h-[100dvh] max-h-[100dvh] overflow-hidden p-0 sm:p-4">
                        <div className="glass-card bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:w-[75vw] xl:max-w-[1050px] 2xl:max-w-[1200px] shadow-2xl flex flex-col h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[90vh] overflow-hidden relative select-text animate-fade-in">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Edit2 size={20} className="text-blue-500" /> Sửa phiếu
                            </h2>
                            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto -webkit-overflow-scrolling-touch pr-1">
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mã phiếu</label>
                                    <input
                                        type="text" value={editingInstance.code} disabled
                                        className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-base opacity-60 font-semibold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề phiếu *</label>
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={e => setEditTitle(e.target.value)}
                                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold text-slate-850 dark:text-white"
                                        autoFocus
                                    />
                                </div>

                                {/* Custom fields */}
                                {editCustomFields.length > 0 && (
                                    <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Thông tin bổ sung</p>
                                        {renderCustomFieldInputs(
                                            editCustomFields,
                                            editFormData,
                                            (key, value) => setEditFormData(prev => ({ ...prev, [key]: value }))
                                        )}
                                    </div>
                                )}

                                {/* Note field */}
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-405 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                    <textarea
                                        value={editFormData.note || ''}
                                        onChange={e => setEditFormData(prev => ({ ...prev, note: e.target.value }))}
                                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none text-slate-850 dark:text-white"
                                        rows={2}
                                    />
                                </div>

                                {editingInstance.status === WorkflowInstanceStatus.DRAFT && selectedTemplateId && (
                                    <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                                        <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                            Người xử lý bước đầu
                                        </label>
                                        {selectedFirstTaskNode && initialAssigneeCandidates.length > 0 ? (
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                {initialAssigneeCandidates.map(candidate => {
                                                    const checked = initialAssigneeIds.includes(candidate.id);
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={candidate.id}
                                                            onClick={() => toggleInitialAssignee(candidate.id)}
                                                            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${checked
                                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-100'
                                                                : 'border-slate-200 bg-white/60 text-slate-700 hover:border-indigo-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200'
                                                                }`}
                                                        >
                                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-500'}`}>
                                                                {checked && <CheckCircle size={13} />}
                                                            </span>
                                                            <span className="min-w-0">
                                                                <span className="block truncate text-sm font-black">{candidate.name}</span>
                                                                <span className="block truncate text-[11px] text-slate-400">{candidate.sublabel}</span>
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                                                Mẫu quy trình chưa cấu hình người nhận hợp lệ cho bước đầu.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-4 mt-8 border-t border-slate-100 dark:border-slate-700/50 pt-5">
                                <button onClick={() => setEditingInstance(null)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                                {editingInstance.status === WorkflowInstanceStatus.DRAFT && (
                                    <button
                                        onClick={handleDeleteDraft}
                                        disabled={isSubmitting}
                                        className="px-5 py-3 border border-red-200 text-red-600 dark:border-red-800 dark:text-red-300 rounded-xl font-bold text-base hover:bg-red-50 dark:hover:bg-red-950/30 transition disabled:opacity-50"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                )}
                                <button
                                    onClick={handleEditSave}
                                    disabled={isSubmitting || !editTitle.trim()}
                                    className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition disabled:opacity-50 shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? (
                                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang lưu...</>
                                    ) : (
                                        <><Save size={14} /> Lưu thay đổi</>
                                    )}
                                </button>
                                {editingInstance.status === WorkflowInstanceStatus.DRAFT && (
                                    <button
                                        onClick={handleSubmitDraft}
                                        disabled={isSubmitting || !editTitle.trim() || !selectedFirstTaskNode || (requiresInitialAssignee && initialAssigneeIds.length === 0) || selectedCustomFields.some(field => field.required && !editFormData[field.name])}
                                        className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                                    >
                                        <Send size={14} /> Gửi xử lý
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Shared Cancel Confirm Modal */}
            {cancelConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-scale-in">
                        <h2 className="text-lg font-bold text-amber-600 mb-2">Hủy phiếu?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Phiếu sẽ bị hủy và không thể tiếp tục xử lý. Bạn vẫn có thể xem lại phiếu đã hủy.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setCancelConfirmId(null)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Đóng</button>
                            <button onClick={() => handleCancel(cancelConfirmId)} className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-655 transition shadow-lg shadow-amber-500/20">Xác nhận hủy</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Reopen/Revert Modal for Admin */}
            {reopenInstanceId && (() => {
                const inst = instances.find(i => i.id === reopenInstanceId);
                if (!inst) return null;
                const tplNodes = nodes.filter(n => n.templateId === inst.templateId && n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END);
                // Order nodes by edge sequence
                const tplEdges = edges.filter(e => e.templateId === inst.templateId);
                const startNode = nodes.find(n => n.templateId === inst.templateId && n.type === WorkflowNodeType.START);
                const orderedNodes: typeof tplNodes = [];
                if (startNode) {
                    let currentId = startNode.id;
                    while (currentId) {
                        const edge = tplEdges.find(e => e.sourceNodeId === currentId);
                        if (!edge) break;
                        const node = tplNodes.find(n => n.id === edge.targetNodeId);
                        if (node) orderedNodes.push(node);
                        currentId = edge.targetNodeId;
                    }
                }
                const displayNodes = orderedNodes.length > 0 ? orderedNodes : tplNodes;
                return (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
                        <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl animate-scale-in">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                                <Undo2 size={20} className="text-purple-500" /> Mở lại quy trình
                            </h2>
                            <p className="text-xs text-slate-400 mb-4">Chọn bước muốn quay lại để tiếp tục xử lý.</p>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 uppercase tracking-wider mb-1.5">Quay lại bước *</label>
                                    <select
                                        value={reopenTargetNodeId}
                                        onChange={e => setReopenTargetNodeId(e.target.value)}
                                        className="w-full px-3 py-2 bg-white/80 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500 text-slate-850 dark:text-white"
                                    >
                                        <option value="">-- Chọn bước --</option>
                                        {displayNodes.map((n, idx) => (
                                            <option key={n.id} value={n.id}>Bước {idx + 1}: {n.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 uppercase tracking-wider mb-1.5">Lý do mở lại</label>
                                    <textarea
                                        value={reopenComment}
                                        onChange={e => setReopenComment(e.target.value)}
                                        placeholder="Nhập lý do mở lại quy trình..."
                                        className="w-full px-3 py-2 bg-white/80 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500 resize-none text-slate-850 dark:text-white"
                                        rows={3}
                                    />
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setReopenInstanceId(null)}
                                        className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-650 dark:text-slate-355 rounded-xl text-xs font-bold hover:bg-slate-200 transition"
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!reopenTargetNodeId) return;
                                            await reopenInstance(reopenInstanceId, reopenTargetNodeId, user.id, reopenComment);
                                            setReopenInstanceId(null);
                                            setReopenTargetNodeId('');
                                            setReopenComment('');
                                        }}
                                        disabled={!reopenTargetNodeId}
                                        className="px-4 py-2 bg-purple-500 text-white rounded-xl text-xs font-bold hover:bg-purple-650 transition shadow-md shadow-purple-500/20 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Undo2 size={13} /> Mở lại
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Shared File Preview Modal */}
        </div>
    );
};

export default WorkflowInstances;
