import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, CheckCircle, Clock, FileText, GitBranch, Image as ImageIcon,
    MessageSquare, Paperclip, RefreshCcw, RotateCcw, Send, User, X, XCircle,
    AlertCircle, Calendar, Download, Eye, Table2, FileSpreadsheet, ChevronRight, ChevronDown, Check,
    Search, Edit2, Bookmark
} from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import {
    Role,
    WorkflowInstance,
    WorkflowInstanceAction,
    WorkflowInstanceComment,
    WorkflowInstanceCommentAttachment,
    WorkflowInstanceStatus,
    WorkflowNode,
    WorkflowNodeType,
    WorkflowPrintTemplate,
} from '../../types';
import {
    getWorkflowStepSelectionMode,
    isWorkflowStepAssignedToUser,
    resolveWorkflowStepAssigneeCandidates,
} from '../../lib/workflowAssignmentResolver';
import { workflowInstanceCommentService } from '../../lib/workflowInstanceCommentService';
import { canSeeMaterialRequestWorkflowOnKanban, isMaterialRequestWorkflowTemplate } from '../../lib/workflowVisibility';
import { supabase } from '../../lib/supabase';
import { saveAs } from 'file-saver';
import { loadXlsx } from '../../lib/loadXlsx';
import { TableFieldInput, FileFieldInput } from './WorkflowInstances';
import { WorkflowStepChecklist } from '../../components/wf/WorkflowStepChecklist';

const STATUS_LABEL: Record<WorkflowInstanceStatus, string> = {
    RUNNING: 'Đang xử lý',
    COMPLETED: 'Hoàn thành',
    REJECTED: 'Từ chối',
    CANCELLED: 'Đã hủy',
};

const ACTION_LABEL: Record<WorkflowInstanceAction, string> = {
    SUBMITTED: 'Đã gửi',
    APPROVED: 'Đã duyệt',
    REJECTED: 'Từ chối',
    REVISION_REQUESTED: 'Yêu cầu bổ sung',
    REOPENED: 'Mở lại',
};

const isPlainDisplayValue = (value: unknown) =>
    value !== null && value !== undefined && typeof value !== 'object' && String(value).trim() !== '';

const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

// ========== Excel Table Preview ==========
const ExcelTablePreview: React.FC<{
    sheets: Record<string, any[][]>;
    sheetNames: string[];
}> = ({ sheets, sheetNames }) => {
    const [activeSheet, setActiveSheet] = useState(sheetNames[0] || '');
    const data = sheets[activeSheet] || [];
    if (!data.length) return <p className="text-xs text-slate-400 italic">Không có dữ liệu</p>;

    const headers = data[0] || [];
    const rows = data.slice(1);

    return (
        <div className="mt-2 rounded-xl border border-emerald-250 dark:border-emerald-800/40 overflow-hidden bg-white dark:bg-slate-900">
            {sheetNames.length > 1 && (
                <div className="flex gap-0 border-b border-emerald-100 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-900/10 overflow-x-auto">
                    {sheetNames.map(name => (
                        <button key={name} onClick={() => setActiveSheet(name)}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all border-b-2 ${activeSheet === name
                                ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500 bg-white dark:bg-slate-800'
                                : 'text-slate-400 border-transparent hover:text-slate-600'
                                }`}>
                            <Table2 size={10} className="inline mr-1" />{name}
                        </button>
                    ))}
                </div>
            )}
            <div className="overflow-auto max-h-[250px]" style={{ maxWidth: '100%' }}>
                <table className="w-full text-xs text-left">
                    <thead className="sticky top-0 z-10 bg-emerald-100 dark:bg-emerald-900/40">
                        <tr>
                            {headers.map((h: any, i: number) => (
                                <th key={i} className="px-3 py-2 font-bold whitespace-nowrap border-b text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700">
                                    {h ?? `Cột ${i + 1}`}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row: any[], ri: number) => (
                            <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30'}>
                                {headers.map((_: any, ci: number) => (
                                    <td key={ci} className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-850 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                        {row[ci] ?? ''}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <FileSpreadsheet size={10} className="inline mr-1" />
                {rows.length} dòng × {headers.length} cột
            </div>
        </div>
    );
};

// ========== File Helpers ==========
const WORKFLOW_ATTACHMENT_BUCKET = 'workflow-attachments';

const downloadFileFromBase64 = (base64: string, fileName: string, mimeType: string) => {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const getBase64DataUrl = (base64: string, mimeType: string) => `data:${mimeType};base64,${base64}`;

const getAttachmentBucket = (file: any) => file?.storageBucket || WORKFLOW_ATTACHMENT_BUCKET;

const hasDownloadableFile = (file: any) => Boolean(file?.data || file?.storagePath);

const downloadWorkflowFile = async (file: any) => {
    try {
        if (file?.data) {
            downloadFileFromBase64(file.data, file.fileName, file.fileType);
            return;
        }
        if (file?.storagePath) {
            const { data, error } = await supabase.storage.from(getAttachmentBucket(file)).download(file.storagePath);
            if (error || !data) throw error || new Error('Không tải được file');
            saveAs(data, file.fileName || 'attachment');
        }
    } catch (err) {
        console.error('downloadWorkflowFile error:', err);
        alert('Không tải được file đính kèm. Vui lòng thử lại.');
    }
};

// ========== File Preview Modal ==========
const FilePreviewModal: React.FC<{
    file: any;
    onClose: () => void;
}> = ({ file, onClose }) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState('');
    const isImage = /^image\//i.test(file?.fileType || '');
    const isPdf = /pdf/i.test(file?.fileType || '') || /\.pdf$/i.test(file?.fileName || '');
    const isExcel = /\.xlsx|xls|csv$/i.test(file?.fileName || '');

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        setPreviewUrl(null);
        setPreviewError('');

        const loadPreview = async () => {
            if (!file || (!isImage && !isPdf)) return;
            if (file.data) {
                setPreviewUrl(getBase64DataUrl(file.data, isPdf ? 'application/pdf' : file.fileType));
                return;
            }
            if (!file.storagePath) {
                setPreviewError('File cũ không còn dữ liệu xem trước');
                return;
            }
            const { data, error } = await supabase.storage.from(getAttachmentBucket(file)).download(file.storagePath);
            if (cancelled) return;
            if (error || !data) {
                console.error('File preview download error:', error);
                setPreviewError('Không tải được bản xem trước');
                return;
            }
            objectUrl = URL.createObjectURL(data);
            setPreviewUrl(objectUrl);
        };

        loadPreview();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [file, isImage, isPdf]);

    if (!file) return null;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <Paperclip size={16} className="text-rose-400" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{file.fileName}</p>
                        <p className="text-[10px] text-slate-400">{file.fileType} • {(file.fileSize / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                        onClick={() => downloadWorkflowFile(file)}
                        disabled={!hasDownloadableFile(file)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 transition shadow-md"
                    >
                        <Download size={13} /> Tải về
                    </button>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors">
                        <X size={18} />
                    </button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                    {isImage && previewUrl && (
                        <div className="flex items-center justify-center">
                            <img src={previewUrl} alt={file.fileName} className="max-w-full max-h-[70vh] rounded-lg shadow-lg" />
                        </div>
                    )}
                    {isPdf && previewUrl && (
                        <iframe
                            src={previewUrl}
                            className="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700"
                            title={file.fileName}
                        />
                    )}
                    {(isImage || isPdf) && !previewUrl && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">{previewError || 'Đang tải bản xem trước...'}</p>
                        </div>
                    )}
                    {isExcel && file.excelData && file.sheetNames && (
                        <ExcelTablePreview sheets={file.excelData} sheetNames={file.sheetNames} />
                    )}
                    {isExcel && (!file.excelData || !file.sheetNames) && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileSpreadsheet size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">File Excel lưu trữ trong Storage</p>
                        </div>
                    )}
                    {!isImage && !isPdf && !isExcel && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">Không hỗ trợ xem trước loại tệp này</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ========== Attachment Preview inside Comments ==========
const AttachmentPreview: React.FC<{ attachment: WorkflowInstanceCommentAttachment }> = ({ attachment }) => {
    const [url, setUrl] = useState<string>('');

    useEffect(() => {
        let mounted = true;
        workflowInstanceCommentService.getAttachmentUrl(attachment.storagePath)
            .then(signedUrl => { if (mounted) setUrl(signedUrl); })
            .catch(console.error);
        return () => { mounted = false; };
    }, [attachment.storagePath]);

    if (attachment.kind === 'image') {
        return (
            <a href={url || undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                {url ? (
                    <img src={url} alt={attachment.fileName} className="h-28 w-full object-cover" />
                ) : (
                    <div className="h-28 flex items-center justify-center text-slate-300"><ImageIcon size={24} /></div>
                )}
                <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 truncate">{attachment.fileName}</div>
            </a>
        );
    }

    return (
        <a
            href={url || undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-indigo-300"
        >
            <Paperclip size={14} className="text-slate-400" />
            <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
            <span className="text-[10px] text-slate-400">{formatBytes(attachment.fileSize)}</span>
        </a>
    );
};

interface WorkflowInstanceDetailProps {
    instanceId?: string;
    onBack?: () => void;
}

// ========== Main Component ==========
const WorkflowInstanceDetail: React.FC<WorkflowInstanceDetailProps> = ({ instanceId, onBack }) => {
    const { id: paramId } = useParams();
    const id = instanceId || paramId;
    const navigate = useNavigate();
    const {
        templates, instances, nodes, edges, logs, loadInstanceFormData,
        processInstance, getInstanceLogs, refreshData, updateInstanceWatchers,
        updateInstance,
    } = useWorkflow();
    const { user, users, employees, orgUnits } = useApp();

    const [commentBody, setCommentBody] = useState('');
    const [comments, setComments] = useState<WorkflowInstanceComment[]>([]);
    const [draftAttachments, setDraftAttachments] = useState<WorkflowInstanceCommentAttachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isSendingComment, setIsSendingComment] = useState(false);
    const [commentError, setCommentError] = useState('');
    const [actionError, setActionError] = useState('');
    const [actionComment, setActionComment] = useState('');
    const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
    const [activeAction, setActiveAction] = useState<WorkflowInstanceAction | null>(null);
    const [previewFile, setPreviewFile] = useState<any>(null);
    const [fieldsExpanded, setFieldsExpanded] = useState(true);

    // Watchers selection modal state
    const [showWatchersModal, setShowWatchersModal] = useState(false);
    const [watcherSearchTerm, setWatcherSearchTerm] = useState('');
    const [tempSelectedWatcherIds, setTempSelectedWatcherIds] = useState<string[]>([]);

    // Edit request and custom fields state
    const [showEditModal, setShowEditModal] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editNote, setEditNote] = useState('');
    const [editFormData, setEditFormData] = useState<Record<string, any>>({});
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const instance = useMemo(() => instances.find(item => item.id === id), [instances, id]);
    const template = useMemo(() => templates.find(item => item.id === instance?.templateId), [templates, instance?.templateId]);
    const currentNode = useMemo(() => nodes.find(node => node.id === instance?.currentNodeId), [nodes, instance?.currentNodeId]);
    const creator = useMemo(() => users.find(item => item.id === instance?.createdBy), [users, instance?.createdBy]);
    const instanceLogs = useMemo(() => id ? getInstanceLogs(id) : [], [getInstanceLogs, id, logs]);
    const isMaterialTemplate = isMaterialRequestWorkflowTemplate(template);

    const orderedNodes = useMemo(() => {
        if (!template) return [];
        const templateNodes = nodes.filter(node => node.templateId === template.id);
        const templateEdges = edges.filter(edge => edge.templateId === template.id);
        const result: WorkflowNode[] = [];
        const visited = new Set<string>();
        let cursor = templateNodes.find(node => node.type === WorkflowNodeType.START);
        while (cursor && !visited.has(cursor.id)) {
            visited.add(cursor.id);
            result.push(cursor);
            const nextEdge = templateEdges.find(edge => edge.sourceNodeId === cursor!.id);
            cursor = nextEdge ? templateNodes.find(node => node.id === nextEdge.targetNodeId) : undefined;
        }
        return result;
    }, [template, nodes, edges]);

    const orderedSteps = useMemo(() => {
        return orderedNodes.filter(node => node.type !== WorkflowNodeType.START && node.type !== WorkflowNodeType.END);
    }, [orderedNodes]);

    const nextNode = useMemo(() => {
        if (!currentNode) return null;
        const nextEdge = edges.find(edge => edge.sourceNodeId === currentNode.id);
        return nextEdge ? nodes.find(node => node.id === nextEdge.targetNodeId) || null : null;
    }, [currentNode, edges, nodes]);

    const revisionNode = useMemo(() => {
        if (!currentNode) return null;
        const previousEdge = edges.find(edge => edge.targetNodeId === currentNode.id);
        const previous = previousEdge ? nodes.find(node => node.id === previousEdge.sourceNodeId) : null;
        if (!previous || previous.type !== WorkflowNodeType.START) return previous || null;
        const firstEdge = edges.find(edge => edge.sourceNodeId === previous.id);
        return firstEdge ? nodes.find(node => node.id === firstEdge.targetNodeId) || null : null;
    }, [currentNode, edges, nodes]);

    const canAct = useMemo(() => {
        if (!instance || !currentNode || instance.status !== WorkflowInstanceStatus.RUNNING) return false;
        if (currentNode.type === WorkflowNodeType.START || currentNode.type === WorkflowNodeType.END) return false;
        if (user.role === Role.ADMIN) return true;
        if (template?.managers?.includes(user.id)) return true;
        if (isWorkflowStepAssignedToUser(instance, currentNode, user)) return true;
        if (instance.createdBy === user.id && revisionNode?.id === currentNode.id) return true;
        return false;
    }, [instance, currentNode, user, template, revisionNode]);

    const transitionTargetNode = activeAction === WorkflowInstanceAction.REVISION_REQUESTED ? revisionNode : nextNode;
    const transitionCandidates = useMemo(() => {
        if (!transitionTargetNode || !instance || transitionTargetNode.type === WorkflowNodeType.END) return [];
        return resolveWorkflowStepAssigneeCandidates({
            node: transitionTargetNode,
            instance,
            users,
            employees,
            orgUnits,
            logs: instanceLogs,
        });
    }, [transitionTargetNode, instance, users, employees, orgUnits, instanceLogs]);

    const transitionSelectionMode = getWorkflowStepSelectionMode(transitionTargetNode);
    const mustChooseAssignee = Boolean(
        activeAction &&
        activeAction !== WorkflowInstanceAction.REJECTED &&
        transitionTargetNode &&
        transitionTargetNode.type !== WorkflowNodeType.END
    );

    // ========== timing / SLA calculation ==========
    const stepTimings = useMemo(() => {
        if (!instance || !template || orderedSteps.length === 0) return [];
        const logsSorted = [...instanceLogs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        let lastTime = new Date(instance.createdAt).getTime();

        return orderedSteps.map((step, idx) => {
            const stepLogs = logsSorted.filter(log => log.nodeId === step.id);
            const isCurrent = step.id === instance.currentNodeId && instance.status === WorkflowInstanceStatus.RUNNING;

            let startTime = lastTime;
            let endTime: number | null = null;
            let duration = 0;
            let status: 'pending' | 'running' | 'completed' = 'pending';
            let actorName = '';
            let actionDate = '';
            let comment = '';

            const resolveLog = stepLogs.find(l =>
                l.action === WorkflowInstanceAction.APPROVED ||
                l.action === WorkflowInstanceAction.REJECTED
            );

            if (resolveLog) {
                endTime = new Date(resolveLog.createdAt).getTime();
                duration = endTime - startTime;
                status = 'completed';
                const actor = users.find(u => u.id === resolveLog.actedBy);
                actorName = actor?.name || 'N/A';
                actionDate = new Date(resolveLog.createdAt).toLocaleString('vi-VN');
                comment = resolveLog.comment;
                lastTime = endTime;
            } else if (isCurrent) {
                endTime = Date.now();
                duration = endTime - startTime;
                status = 'running';
            } else {
                startTime = 0;
                status = 'pending';
            }

            return {
                stepId: step.id,
                label: step.label,
                startTime: startTime > 0 ? new Date(startTime).toLocaleString('vi-VN') : '',
                endTime: endTime && status !== 'running' ? new Date(endTime).toLocaleString('vi-VN') : '',
                durationHours: startTime > 0 ? Number((duration / (1000 * 60 * 60)).toFixed(2)) : 0,
                status,
                actorName,
                actionDate,
                comment,
                logs: stepLogs
            };
        });
    }, [instance, template, orderedSteps, instanceLogs, users]);

    const currentStepTiming = useMemo(() => {
        return stepTimings.find(t => t.stepId === instance?.currentNodeId && t.status === 'running');
    }, [stepTimings, instance?.currentNodeId]);

    const isOverdue = useMemo(() => {
        if (!currentNode || !currentStepTiming || !currentNode.config?.slaHours) return false;
        return currentStepTiming.durationHours > currentNode.config.slaHours;
    }, [currentNode, currentStepTiming]);

    const totalSlaHours = useMemo(() => {
        return orderedSteps.reduce((sum, step) => sum + (step.config?.slaHours || 0), 0);
    }, [orderedSteps]);

    const totalDurationHours = useMemo(() => {
        if (!instance) return 0;
        const start = new Date(instance.createdAt).getTime();
        const end = instance.status === WorkflowInstanceStatus.RUNNING ? Date.now() : new Date(instance.updatedAt).getTime();
        return Number(((end - start) / (1000 * 60 * 60)).toFixed(2));
    }, [instance]);

    const currentStepIndex = useMemo(() => {
        if (!instance || !currentNode) return 0;
        return orderedSteps.findIndex(s => s.id === instance.currentNodeId) + 1;
    }, [instance, currentNode, orderedSteps]);

    // ========== comments and actions ==========
    const loadComments = useCallback(async () => {
        if (!id) return;
        try {
            setComments(await workflowInstanceCommentService.list(id));
        } catch (error) {
            console.error('Workflow comments load error:', error);
            setCommentError('Không tải được trao đổi của phiếu.');
        }
    }, [id]);

    useEffect(() => {
        refreshData().catch(console.error);
    }, [refreshData]);

    useEffect(() => {
        if (!instance) return;
        if (Object.keys(instance.formData || {}).length === 0) {
            loadInstanceFormData(instance.id).catch(console.error);
        }
    }, [instance, loadInstanceFormData]);

    useEffect(() => {
        loadComments();
        const onFocus = () => loadComments();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [loadComments]);

    useEffect(() => {
        setSelectedAssigneeIds([]);
        setActionError('');
    }, [activeAction, transitionTargetNode?.id]);

    const toggleAssignee = (candidateId: string) => {
        setSelectedAssigneeIds(prev => {
            if (transitionSelectionMode === 'single') {
                return prev[0] === candidateId ? [] : [candidateId];
            }
            return prev.includes(candidateId)
                ? prev.filter(id => id !== candidateId)
                : [...prev, candidateId];
        });
    };

    const handleAttachmentFiles = async (files: FileList | null) => {
        if (!id || !files?.length) return;
        const remaining = workflowInstanceCommentService.maxAttachmentsPerComment - draftAttachments.length;
        const selectedFiles = Array.from(files).slice(0, Math.max(remaining, 0));
        if (selectedFiles.length === 0) {
            setCommentError('Mỗi tin nhắn tối đa 5 file đính kèm.');
            return;
        }

        setCommentError('');
        setIsUploading(true);
        const draftId = crypto.randomUUID();
        try {
            const uploaded = [];
            for (const file of selectedFiles) {
                uploaded.push(await workflowInstanceCommentService.uploadAttachment({ instanceId: id, file, draftId }));
            }
            setDraftAttachments(prev => [...prev, ...uploaded]);
        } catch (error) {
            console.error('Workflow comment attachment upload error:', error);
            setCommentError(error instanceof Error ? error.message : 'Không upload được file đính kèm.');
        } finally {
            setIsUploading(false);
        }
    };

    const removeDraftAttachment = (attachment: WorkflowInstanceCommentAttachment) => {
        setDraftAttachments(prev => prev.filter(item => item.id !== attachment.id));
        workflowInstanceCommentService.removeAttachments([attachment.storagePath]).catch(console.error);
    };

    const sendComment = async () => {
        if (!id) return;
        setIsSendingComment(true);
        setCommentError('');
        try {
            await workflowInstanceCommentService.create({
                instanceId: id,
                authorUserId: user.id,
                body: commentBody,
                attachments: draftAttachments,
            });
            setCommentBody('');
            setDraftAttachments([]);
            await loadComments();
        } catch (error) {
            console.error('Workflow comment send error:', error);
            setCommentError(error instanceof Error ? error.message : 'Không gửi được trao đổi.');
        } finally {
            setIsSendingComment(false);
        }
    };

    const runAction = async (action: WorkflowInstanceAction) => {
        if (!id) return false;
        const targetNode = action === WorkflowInstanceAction.REVISION_REQUESTED ? revisionNode : nextNode;
        if (action !== WorkflowInstanceAction.REJECTED && targetNode && targetNode.type !== WorkflowNodeType.END && selectedAssigneeIds.length === 0) {
            setActionError('Vui lòng chọn người nhận xử lý bước tiếp theo.');
            return false;
        }

        setActionError('');
        const ok = await processInstance(
            id,
            action,
            user.id,
            actionComment,
            action === WorkflowInstanceAction.REJECTED ? [] : selectedAssigneeIds,
        );
        if (!ok) {
            setActionError('Không xử lý được phiếu. Vui lòng thử lại.');
            return false;
        }
        setActionComment('');
        setActiveAction(null);
        setSelectedAssigneeIds([]);
        await refreshData();
        return true;
    };

    const handleStartEditDescription = () => {
        if (!instance) return;
        setEditTitle(instance.title);
        setEditNote(instance.formData?.note || '');
        setEditFormData(instance.formData || {});
        setShowEditModal(true);
    };

    const handleSaveEdit = async () => {
        if (!instance) return;
        setIsSavingEdit(true);
        try {
            const updatedFormData = {
                ...editFormData,
                note: editNote
            };
            await updateInstance(instance.id, { title: editTitle, formData: updatedFormData });
            setShowEditModal(false);
            await refreshData();
        } catch (err) {
            console.error('Error saving edits:', err);
        } finally {
            setIsSavingEdit(false);
        }
    };

    const handleDocUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!id || !instance || !files?.length) return;
        setIsUploadingDoc(true);
        try {
            const uploaded = [];
            for (const file of Array.from(files)) {
                const uploadedFile = await workflowInstanceCommentService.uploadAttachment({
                    instanceId: id,
                    file,
                    draftId: crypto.randomUUID()
                });
                uploaded.push({
                    id: uploadedFile.id,
                    fileName: uploadedFile.fileName,
                    storagePath: uploadedFile.storagePath,
                    fileSize: uploadedFile.fileSize,
                    mimeType: uploadedFile.mimeType
                });
            }
            const currentAttachments = instance.formData?.attachments || [];
            const newAttachments = [...currentAttachments, ...uploaded];
            const updatedFormData = {
                ...instance.formData,
                attachments: newAttachments
            };
            await updateInstance(instance.id, { formData: updatedFormData });
            await refreshData();
        } catch (err) {
            console.error('Doc upload error:', err);
        } finally {
            setIsUploadingDoc(false);
        }
    };

    const handleDeleteDoc = async (fileToDelete: any) => {
        if (!instance || !window.confirm(`Bạn có chắc chắn muốn xóa file "${fileToDelete.fileName}"?`)) return;
        const currentAttachments = instance.formData?.attachments || [];
        const newAttachments = currentAttachments.filter((f: any) => f.storagePath !== fileToDelete.storagePath);
        const updatedFormData = {
            ...instance.formData,
            attachments: newAttachments
        };
        await updateInstance(instance.id, { formData: updatedFormData });
        workflowInstanceCommentService.removeAttachments([fileToDelete.storagePath]).catch(console.error);
        await refreshData();
    };

    const handleDownloadDoc = (file: any) => {
        downloadWorkflowFile({
            fileName: file.fileName,
            storagePath: file.storagePath
        });
    };

    const isDefaultWatcher = useMemo(() => (template?.defaultWatchers || []).includes(user.id), [template, user.id]);
    const isCustomWatcher = useMemo(() => (instance?.watchers || []).includes(user.id), [instance, user.id]);
    const isWatching = isDefaultWatcher || isCustomWatcher;

    const handleToggleWatch = async () => {
        if (!instance) return;
        let newWatchers = [...(instance.watchers || [])];
        if (isCustomWatcher) {
            newWatchers = newWatchers.filter(uid => uid !== user.id);
        } else {
            newWatchers.push(user.id);
        }
        await updateInstanceWatchers(instance.id, newWatchers);
    };

    const handleSaveWatchers = async () => {
        if (!instance) return;
        await updateInstanceWatchers(instance.id, tempSelectedWatcherIds);
        setShowWatchersModal(false);
    };

    if (!instance) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-12 text-center">
                <FileText className="mx-auto mb-3 text-slate-300" size={44} />
                <h1 className="text-lg font-black text-slate-700 dark:text-slate-200">Không tìm thấy phiếu</h1>
                <button onClick={() => navigate('/wf')} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">Quay lại danh sách</button>
            </div>
        );
    }

    if (isMaterialTemplate && !canSeeMaterialRequestWorkflowOnKanban(user)) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-12 text-center">
                <GitBranch className="mx-auto mb-3 text-slate-300" size={44} />
                <h1 className="text-lg font-black text-slate-700 dark:text-slate-200">Quy trình này chỉ hiển thị cho Admin ở dạng Kanban</h1>
                <button onClick={() => navigate('/wf')} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">Quay lại</button>
            </div>
        );
    }

    const customFieldsToRender = template?.customFields || [];

    // Calculate deadline formatted string
    const deadlineString = (() => {
        if (currentNode && instance.status === WorkflowInstanceStatus.RUNNING) {
            const currentStep = stepTimings.find(t => t.stepId === currentNode.id && t.status === 'running');
            if (currentStep && currentNode.config?.slaHours) {
                const startMs = new Date(instance.createdAt).getTime() + (currentStepIndex > 1 ? stepTimings.slice(0, currentStepIndex - 1).reduce((s, t) => s + (t.durationHours * 60 * 60 * 1000), 0) : 0);
                const deadlineMs = startMs + (currentNode.config.slaHours * 60 * 60 * 1000);
                return new Date(deadlineMs).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
            }
        }
        return 'N/A';
    })();

    // Stage Managers candidate names
    const stageManagersString = (() => {
        if (!currentNode || instance.status !== WorkflowInstanceStatus.RUNNING) return 'N/A';
        const candidates = resolveWorkflowStepAssigneeCandidates({
            node: currentNode,
            instance,
            users,
            employees,
            orgUnits,
            logs: instanceLogs
        });
        if (candidates.length === 0) return currentNode.config?.assigneeRole || 'N/A';
        return candidates.map(c => `@${c.name.split(' ').pop()?.toLowerCase() || c.name}`).join(', ');
    })();

    // Render custom fields form for editing
    const renderCustomFieldInputsLocal = (
        fields: any[],
        data: Record<string, any>,
        onChange: (key: string, value: any) => void
    ) => (
        fields.map(field => (
            <div key={field.id} className="space-y-1.5">
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.type === 'text' && (
                    <input
                        type="text"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-800 dark:text-white"
                    />
                )}
                {field.type === 'textarea' && (
                    <textarea
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-semibold resize-none text-slate-800 dark:text-white"
                        rows={3}
                    />
                )}
                {field.type === 'number' && (
                    <input
                        type="number"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-800 dark:text-white"
                    />
                )}
                {field.type === 'date' && (
                    <input
                        type="date"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-800 dark:text-white"
                    />
                )}
                {field.type === 'select' && (
                    <select
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-800 dark:text-white"
                    >
                        <option value="">-- Chọn {field.label.toLowerCase()} --</option>
                        {(field.options || []).map((opt: string) => (
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
                    />
                )}
                {field.type === 'file' && (
                    <FileFieldInput
                        fieldName={field.name}
                        value={data[field.name]}
                        onChange={(val: any) => onChange(field.name, val)}
                        disabled={false}
                    />
                )}
            </div>
        ))
    );

    return (
        <div className="min-h-[calc(100vh-120px)] space-y-5 text-slate-800 dark:text-slate-200">
            {/* Top Navigation & Action Header */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3">
                {/* Breadcrumb & Navigation */}
                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    <button
                        onClick={onBack || (() => navigate('/wf'))}
                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                        title="Quay lại"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <span>QT {template?.name?.toUpperCase() || 'QUY TRÌNH'}</span>
                    <span>›</span>
                    <span className="text-slate-700 dark:text-slate-300 font-extrabold">{currentNode?.label?.toUpperCase() || STATUS_LABEL[instance.status]}</span>
                </div>

                {/* Main Title & Action Bar Row */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-tight break-words">
                                {instance.title}
                            </h1>
                            {creator && (
                                <div className="hidden sm:flex items-center gap-2 shrink-0 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-full px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-300">
                                    <div className="h-5 w-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-black uppercase overflow-hidden">
                                        {creator.avatar ? <img src={creator.avatar} alt={creator.name} className="h-full w-full object-cover" /> : creator.name.slice(0, 2)}
                                    </div>
                                    <span>{creator.name}</span>
                                </div>
                            )}
                        </div>

                        {/* Sub Metadata Row */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400 pt-1">
                            <span className="flex items-center gap-1.5">
                                <Bookmark size={14} className="text-slate-400" />
                                {instance.formData?.note ? 'Có ghi chú tổng quan' : 'Không có tổng quan ngắn về nhiệm vụ'}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1.5">
                                <AlertCircle size={14} className="text-slate-400" />
                                Thời hạn trong giai đoạn: <strong className="text-slate-700 dark:text-slate-200">{currentNode?.config?.slaHours ? `${currentNode.config.slaHours}h` : 'Không thời hạn'}</strong> • SLA: <strong className="text-slate-700 dark:text-slate-200">{currentNode?.config?.slaHours || 0}h</strong>
                            </span>
                        </div>
                    </div>

                    {/* Top Action Buttons (Purple / Red / Actions) */}
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {canAct && (
                            <>
                                <button
                                    onClick={() => { setActionError(''); setSelectedAssigneeIds([]); setActionComment(''); setActiveAction(WorkflowInstanceAction.APPROVED); }}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white px-4 py-2 text-xs font-black transition shadow-md shadow-purple-700/20"
                                >
                                    <CheckCircle size={14} /> Chuyển tiếp / Duyệt
                                </button>
                                <button
                                    onClick={() => { setActionError(''); setSelectedAssigneeIds([]); setActionComment(''); setActiveAction(WorkflowInstanceAction.REVISION_REQUESTED); }}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-pink-300 dark:border-pink-800 text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-950/30 px-3.5 py-2 text-xs font-black transition"
                                >
                                    <RotateCcw size={14} /> Yêu cầu bổ sung
                                </button>
                                <button
                                    onClick={() => { setActionError(''); setSelectedAssigneeIds([]); setActionComment(''); setActiveAction(WorkflowInstanceAction.REJECTED); }}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-3.5 py-2 text-xs font-black transition"
                                >
                                    <XCircle size={14} /> Từ chối
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => refreshData()}
                            className="inline-flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                            title="Làm mới dữ liệu"
                        >
                            <RefreshCcw size={15} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Horizontal Stage Ribbon Stepper (Chevron Ribbon Layout) */}
            <div className="flex items-center overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-1.5 scrollbar-none">
                {orderedSteps.map((step, index) => {
                    const isCurrent = step.id === instance.currentNodeId && instance.status === WorkflowInstanceStatus.RUNNING;
                    const stepLogs = instanceLogs.filter(log => log.nodeId === step.id);
                    const isCompleted = stepLogs.some(log => log.action === WorkflowInstanceAction.APPROVED);

                    let itemStyle = 'bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400';
                    if (isCurrent) {
                        itemStyle = 'bg-sky-500 text-white font-black shadow-md shadow-sky-500/20';
                    } else if (isCompleted) {
                        itemStyle = 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-bold border-r border-emerald-200/50';
                    }

                    return (
                        <div
                            key={step.id}
                            className={`flex-1 min-w-[180px] px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-xs uppercase tracking-wider transition-all border-r last:border-r-0 border-slate-100 dark:border-slate-800 ${itemStyle}`}
                        >
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${isCurrent ? 'bg-white text-sky-600' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                }`}>
                                {index + 1}
                            </span>
                            <span className="truncate font-extrabold">{step.label}</span>
                        </div>
                    );
                })}
            </div>

            {/* 2-Column Grid Layout */}
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                {/* Left Column (Main Content) */}
                <div className="space-y-6">
                    {/* Section 1: MÔ TẢ & TÀI LIỆU ĐÍNH KÈM */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h2 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                MÔ TẢ
                            </h2>
                            <div className="flex items-center gap-3 text-xs font-bold">
                                {instance.status === WorkflowInstanceStatus.RUNNING && (instance.createdBy === user.id || user.role === Role.ADMIN) && (
                                    <>
                                        <button
                                            onClick={handleStartEditDescription}
                                            className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1"
                                        >
                                            Tải lên tài liệu
                                        </button>
                                        <span className="text-slate-300">•</span>
                                        <button
                                            onClick={handleStartEditDescription}
                                            className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1"
                                        >
                                            <Edit2 size={13} /> Chỉnh sửa
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Note / Description text */}
                        <div>
                            {instance.formData?.note ? (
                                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-medium leading-relaxed">
                                    {instance.formData.note}
                                </p>
                            ) : (
                                <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold italic">
                                    Không có mô tả
                                </p>
                            )}
                        </div>

                        {/* File attachments grid (Clean cards style matching screenshot) */}
                        {instance.formData?.attachments && instance.formData.attachments.length > 0 && (
                            <div className="pt-2">
                                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                                    {instance.formData.attachments.map((file: any, index: number) => {
                                        const isPdf = /\.pdf$/i.test(file.fileName || '');
                                        return (
                                            <div key={file.id || index} className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-3 text-xs relative group hover:border-emerald-300 transition-all">
                                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold uppercase ${isPdf ? 'bg-red-50 dark:bg-red-950/40 text-red-500' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-500'
                                                    }`}>
                                                    {isPdf ? 'PDF' : <Paperclip size={18} />}
                                                </div>
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <p className="font-bold text-slate-800 dark:text-slate-200 truncate" title={file.fileName}>
                                                        {file.fileName}
                                                    </p>
                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-semibold">
                                                        <span>{formatBytes(file.fileSize)}</span>
                                                        <span>•</span>
                                                        <button onClick={() => setPreviewFile(file)} className="hover:text-emerald-600 font-bold">Xem trước</button>
                                                        <span>•</span>
                                                        <button onClick={() => handleDownloadDoc(file)} className="hover:text-emerald-600 font-bold">Tải về</button>
                                                        {instance.status === WorkflowInstanceStatus.RUNNING && (instance.createdBy === user.id || user.role === Role.ADMIN) && (
                                                            <>
                                                                <span>•</span>
                                                                <button onClick={() => handleDeleteDoc(file)} className="hover:text-red-500 font-bold">Xoá</button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section 2: TRƯỜNG TUỲ CHỈNH */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h2 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                TRƯỜNG TUỲ CHỈNH
                            </h2>
                            <button
                                onClick={() => setFieldsExpanded(!fieldsExpanded)}
                                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                                {fieldsExpanded ? 'Thu gọn' : 'Xem tất cả'}
                            </button>
                        </div>

                        {/* Accordion header */}
                        <div className="flex items-center justify-between text-xs font-extrabold uppercase text-slate-700 dark:text-slate-300">
                            <button
                                onClick={() => setFieldsExpanded(!fieldsExpanded)}
                                className="flex items-center gap-2 hover:text-emerald-600 transition"
                            >
                                {fieldsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} TRƯỜNG DỮ LIỆU KHI NHẬP MỚI
                            </button>
                            <span className="text-[10px] text-slate-400 font-bold">
                                {customFieldsToRender.length} trường
                            </span>
                        </div>

                        {fieldsExpanded && (
                            <div className="pt-2 space-y-5">
                                {customFieldsToRender.length > 0 ? (
                                    <div className="space-y-6">
                                        {/* Simple Fields Grid */}
                                        {customFieldsToRender.filter(f => f.type !== 'table' && f.type !== 'file' && f.type !== 'textarea').length > 0 && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 pt-1">
                                                {customFieldsToRender
                                                    .filter(f => f.type !== 'table' && f.type !== 'file' && f.type !== 'textarea')
                                                    .map((field) => {
                                                        const value = instance.formData?.[field.name];
                                                        const idx = customFieldsToRender.findIndex(f => f.id === field.id);
                                                        const numStr = String(idx + 1).padStart(2, '0');

                                                        return (
                                                            <div key={field.id} className="space-y-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-600 text-[9px] font-black text-white shrink-0">
                                                                        {numStr}
                                                                    </span>
                                                                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 truncate">
                                                                        {field.label}
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 pl-6 break-words">
                                                                    {value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : <span className="text-slate-300 dark:text-slate-650 font-normal italic">Trống</span>}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        )}

                                        {/* Complex Fields (Table, File, Textarea) */}
                                        {customFieldsToRender.filter(f => f.type === 'table' || f.type === 'file' || f.type === 'textarea').length > 0 && (
                                            <div className="space-y-5">
                                                {customFieldsToRender
                                                    .filter(f => f.type === 'table' || f.type === 'file' || f.type === 'textarea')
                                                    .map((field) => {
                                                        const value = instance.formData?.[field.name];
                                                        const idx = customFieldsToRender.findIndex(f => f.id === field.id);
                                                        const numStr = String(idx + 1).padStart(2, '0');

                                                        return (
                                                            <div key={field.id} className="space-y-2">
                                                                <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-slate-800/60">
                                                                    <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-600 text-[9px] font-black text-white shrink-0">
                                                                        {numStr}
                                                                    </span>
                                                                    <span className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                                                                        {field.label}
                                                                    </span>
                                                                </div>

                                                                <div>
                                                                    {/* Table field rendering */}
                                                                    {field.type === 'table' && (
                                                                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900 shadow-sm max-w-full">
                                                                            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                                                                                <table className="w-full text-xs text-left" style={{ minWidth: Math.max(600, (field.options || []).length * 150) }}>
                                                                                    <thead>
                                                                                        <tr className="bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 font-bold border-b border-slate-200 dark:border-slate-800">
                                                                                            <th className="px-4 py-2.5 text-center w-12 font-bold uppercase tracking-wider text-[10px]">#</th>
                                                                                            {(field.options || []).map((col, colIdx) => (
                                                                                                <th key={colIdx} className="px-4 py-2.5 whitespace-nowrap font-bold uppercase tracking-wider text-[10px]">{col}</th>
                                                                                            ))}
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                                                                        {Array.isArray(value) && value.length > 0 ? (
                                                                                            value.map((row, ri) => (
                                                                                                <tr key={ri} className="even:bg-slate-50/30 dark:even:bg-slate-900/10 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                                                                    <td className="px-4 py-2.5 text-center">
                                                                                                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                                                                                                            {ri + 1}
                                                                                                        </span>
                                                                                                    </td>
                                                                                                    {(field.options || []).map((_, ci) => (
                                                                                                        <td key={ci} className="px-4 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap font-medium">{row[ci] ?? ''}</td>
                                                                                                    ))}
                                                                                                </tr>
                                                                                            ))
                                                                                        ) : (
                                                                                            <tr>
                                                                                                <td colSpan={(field.options?.length || 0) + 1} className="px-4 py-5 text-center text-slate-400 italic font-medium">
                                                                                                    Bảng không có dữ liệu
                                                                                                </td>
                                                                                            </tr>
                                                                                        )}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* File field rendering */}
                                                                    {field.type === 'file' && value && typeof value === 'object' && value.fileName ? (
                                                                        <div className="flex items-center gap-3 px-3.5 py-2.5 bg-slate-50/50 dark:bg-slate-850/50 border border-slate-200 dark:border-slate-800 rounded-xl text-xs max-w-md">
                                                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-500 shrink-0">
                                                                                <Paperclip size={16} />
                                                                            </div>
                                                                            <div className="min-w-0 flex-1">
                                                                                <span className="block font-semibold text-slate-800 dark:text-slate-200 truncate" title={value.fileName}>
                                                                                    {value.fileName}
                                                                                </span>
                                                                                <span className="block text-[10px] text-slate-400 font-medium mt-0.5">
                                                                                    {(value.fileSize / 1024).toFixed(1)} KB
                                                                                </span>
                                                                            </div>
                                                                            <div className="flex items-center gap-1 shrink-0">
                                                                                <button onClick={() => setPreviewFile(value)} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500 transition-colors" title="Xem trước">
                                                                                    <Eye size={14} />
                                                                                </button>
                                                                                {hasDownloadableFile(value) && (
                                                                                    <button onClick={() => downloadWorkflowFile(value)} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-800/30 text-emerald-500 transition-colors" title="Tải về">
                                                                                        <Download size={14} />
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    ) : field.type === 'file' && (
                                                                        <span className="text-slate-300 dark:text-slate-600 font-normal italic text-xs pl-6">Chưa có tệp đính kèm</span>
                                                                    )}

                                                                    {/* Textarea field rendering */}
                                                                    {field.type === 'textarea' && (
                                                                        <div className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed pl-6">
                                                                            {value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : <span className="text-slate-300 dark:text-slate-650 font-normal italic">Trống</span>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-xs font-semibold text-slate-400 italic">Quy trình không cấu hình trường dữ liệu tùy chỉnh.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Section 3: DANH SÁCH CÔNG VIỆC (Checklist Component) */}
                    <WorkflowStepChecklist
                        instanceId={instance.id}
                        currentNodeId={instance.currentNodeId}
                        currentNodeLabel={currentNode?.label}
                        allStepNodes={orderedSteps.map(s => ({ id: s.id, label: s.label }))}
                        currentUser={user}
                        users={users}
                        canEdit={canAct || instance.createdBy === user.id || user.role === Role.ADMIN}
                        onPreviewFile={(file) => setPreviewFile(file)}
                    />

                    {/* Section 4: LIÊN KẾT */}


                    {/* Section 5: THẢO LUẬN & BÌNH LUẬN */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                                    {user.avatar ? <img src={user.avatar} alt={user.name} className="h-full w-full rounded-full object-cover" /> : user.name.slice(0, 2)}
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{user.name}</div>
                                    <div className="text-[10px] font-semibold text-slate-400">{user.role} • @{user.name.toLowerCase().replace(/\s+/g, '')}</div>
                                </div>
                            </div>
                            <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer">
                                <Paperclip size={13} /> Thêm tài liệu
                                <input type="file" multiple className="hidden" onChange={event => { handleAttachmentFiles(event.target.files); event.target.value = ''; }} />
                            </label>
                        </div>

                        {/* Comments input box */}
                        <div className="space-y-3">
                            <textarea
                                value={commentBody}
                                onChange={event => setCommentBody(event.target.value)}
                                placeholder="Viết thảo luận của bạn..."
                                rows={3}
                                className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-400 text-slate-800 dark:text-slate-200"
                            />
                            {commentError && <div className="text-xs font-bold text-red-500">{commentError}</div>}
                            <div className="flex justify-end">
                                <button
                                    onClick={sendComment}
                                    disabled={isSendingComment || isUploading || (!commentBody.trim() && draftAttachments.length === 0)}
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 text-xs font-black shadow-md disabled:opacity-50"
                                >
                                    <Send size={13} /> Gửi thảo luận
                                </button>
                            </div>
                        </div>

                        {/* Comment Stream */}
                        <div className="space-y-3 pt-2">
                            {comments.map(comment => {
                                const author = users.find(item => item.id === comment.authorUserId);
                                return (
                                    <div key={comment.id} className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs space-y-1.5">
                                        <div className="flex items-center justify-between text-[10px] font-extrabold uppercase text-slate-400">
                                            <span>{author?.name || 'N/A'}</span>
                                            <span>{new Date(comment.createdAt).toLocaleString('vi-VN')}</span>
                                        </div>
                                        <p className="font-semibold text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{comment.body}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Column (Sidebar) */}
                <div className="space-y-5">
                    {/* Card 1: GIAI ĐOẠN HIỆN TẠI (Solid Sky Blue Card matching screenshot) */}
                    {currentNode && instance.status === WorkflowInstanceStatus.RUNNING && (
                        <div className="rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white p-5 shadow-lg shadow-sky-500/20 space-y-3">
                            <span className="text-[10px] font-black uppercase tracking-widest text-sky-100 block">
                                GIAI ĐOẠN HIỆN TẠI
                            </span>
                            <h3 className="text-base font-black text-white leading-snug">
                                [{currentStepIndex}/{orderedSteps.length}] {currentNode.label}
                            </h3>
                            <div className="space-y-1.5 text-[11px] pt-1">
                                <div className="flex justify-between text-sky-100 font-semibold">
                                    <span>THỜI HẠN: {deadlineString}</span>
                                    <span>Đã bắt đầu {currentStepTiming ? currentStepTiming.startTime.split(' ')[0] : 'gần đây'}</span>
                                </div>
                                <div className="flex justify-between font-black text-white pt-1">
                                    <span>KỲ VỌNG: {currentNode.config?.slaHours ? `${currentNode.config.slaHours.toFixed(2)}h` : '0.00h'}</span>
                                    <span className={isOverdue ? 'text-amber-300 font-black' : 'text-white'}>
                                        ĐÃ SỬ DỤNG: {currentStepTiming ? `${currentStepTiming.durationHours.toFixed(2)}h` : '0.00h'}
                                    </span>
                                </div>
                            </div>
                            {nextNode && (
                                <div className="pt-2 border-t border-sky-400/40 text-[11px] font-bold text-sky-100">
                                    » GIAI ĐOẠN KẾ TIẾP: <span className="underline">{nextNode.label} ({nextNode.config?.slaHours || 24}h)</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Card 2: THÔNG TIN NHIỆM VỤ */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
                        <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                            THÔNG TIN NHIỆM VỤ
                        </h4>
                        <div className="space-y-2.5 text-xs">
                            <div className="flex items-start gap-2">
                                <span className="text-slate-400 font-mono">#</span>
                                <span className="text-slate-500 font-semibold">Mã nhiệm vụ:</span>
                                <span className="ml-auto font-bold text-slate-800 dark:text-slate-200">{instance.code}</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <User size={14} className="text-slate-400 shrink-0 mt-0.5" />
                                <span className="text-slate-500 font-semibold">Tạo bởi:</span>
                                <span className="ml-auto font-bold text-slate-800 dark:text-slate-200 text-right">{creator?.name || 'N/A'}</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <Clock size={14} className="text-slate-400 shrink-0 mt-0.5" />
                                <span className="text-slate-500 font-semibold">Cập nhật:</span>
                                <span className="ml-auto font-bold text-slate-800 dark:text-slate-200">{new Date(instance.updatedAt).toLocaleDateString('vi-VN')}</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <GitBranch size={14} className="text-slate-400 shrink-0 mt-0.5" />
                                <span className="text-slate-400 font-semibold">Giai đoạn:</span>
                                <span className="ml-auto font-bold text-slate-800 dark:text-slate-200 text-right">{currentNode?.label || 'Hoàn thành'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Card 3: NGƯỜI THEO DÕI */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">NGƯỜI THEO DÕI</h4>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                <span onClick={() => { setTempSelectedWatcherIds(instance.watchers || []); setShowWatchersModal(true); }} className="hover:underline cursor-pointer">Thêm người</span>
                                <span>•</span>
                                <span onClick={handleToggleWatch} className="hover:underline cursor-pointer">{isCustomWatcher ? 'Bỏ theo dõi' : 'Theo dõi'}</span>
                            </div>
                        </div>
                        <div className="flex -space-x-2 overflow-hidden py-1">
                            {Array.from(new Set([...(template?.defaultWatchers || []), ...(instance.watchers || [])])).slice(0, 6).map((wId) => {
                                const wUser = users.find(u => u.id === wId);
                                return (
                                    <div key={wId} className="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-slate-900 bg-slate-200 overflow-hidden flex items-center justify-center text-[10px] font-black text-slate-600 uppercase" title={wUser?.name}>
                                        {wUser?.avatar ? <img src={wUser.avatar} alt={wUser.name} className="h-full w-full object-cover" /> : wUser?.name?.slice(0, 2) || '?'}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Card 4: TỔNG THỜI GIAN */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
                        <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-slate-400">TỔNG THỜI GIAN</span>
                            <span className="text-slate-700 dark:text-slate-300">Đã sử dụng {totalDurationHours.toFixed(2)}h</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min((totalDurationHours / (totalSlaHours || 1)) * 100, 100)}%` }} />
                        </div>
                    </div>

                    {/* Card 5: TIẾN TRÌNH CỦA CÁC GIAI ĐOẠN (Vertical Stepper Timeline matching reference) */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
                        <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                            TIẾN TRÌNH CỦA CÁC GIAI ĐOẠN
                        </h4>
                        <div className="space-y-5 relative pl-4 border-l-2 border-slate-150 dark:border-slate-800">
                            {stepTimings.map((timing, idx) => {
                                const isCurrent = timing.status === 'running';
                                const isCompleted = timing.status === 'completed';

                                return (
                                    <div key={timing.stepId} className="relative text-xs space-y-1">
                                        {/* Numbered node circle */}
                                        <div className={`absolute -left-[23px] top-0 h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-black ${isCurrent
                                                ? 'bg-sky-500 text-white ring-4 ring-sky-100 dark:ring-sky-950'
                                                : isCompleted
                                                    ? 'bg-emerald-500 text-white'
                                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                                            }`}>
                                            {idx + 1}
                                        </div>

                                        <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                                            <span className={isCurrent ? 'text-sky-600 dark:text-sky-400 font-extrabold' : ''}>{timing.label}</span>
                                            {timing.actionDate && <span className="text-[10px] font-semibold text-slate-400">{timing.actionDate}</span>}
                                        </div>

                                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                                            <span>Kỳ vọng: {orderedSteps[idx]?.config?.slaHours || 0}h</span>
                                            <span>Thực tế: {timing.durationHours.toFixed(2)}h</span>
                                        </div>

                                        {timing.actorName && (
                                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 pt-1">
                                                <div className="h-4 w-4 rounded-full bg-slate-300 flex items-center justify-center text-[8px]">👤</div>
                                                <span>{timing.actorName}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* File Preview Overlay Modal */}
            {previewFile && (
                <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
            )}
            {/* Watchers Selection Modal */}
            {showWatchersModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[95vw] max-w-md max-h-[85vh] flex flex-col overflow-hidden animate-scale-in">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <Eye size={16} className="text-indigo-500" /> Thêm người theo dõi
                            </h3>
                            <button onClick={() => setShowWatchersModal(false)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-4 border-b border-slate-100 dark:border-slate-800/50">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={watcherSearchTerm}
                                    onChange={e => setWatcherSearchTerm(e.target.value)}
                                    placeholder="Tìm theo tên hoặc vai trò..."
                                    className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 dark:text-slate-200"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[45vh]">
                            {(() => {
                                const q = watcherSearchTerm.trim().toLowerCase();
                                const filteredUsers = users.filter(u => {
                                    if (!q) return true;
                                    return u.name?.toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q);
                                });

                                if (filteredUsers.length === 0) {
                                    return (
                                        <div className="text-center py-8 text-slate-400 text-xs">
                                            Không tìm thấy người dùng phù hợp
                                        </div>
                                    );
                                }

                                return filteredUsers.map(u => {
                                    const isDefault = (template?.defaultWatchers || []).includes(u.id);
                                    const isChecked = isDefault || tempSelectedWatcherIds.includes(u.id);
                                    return (
                                        <button
                                            key={u.id}
                                            type="button"
                                            disabled={isDefault}
                                            onClick={() => {
                                                if (tempSelectedWatcherIds.includes(u.id)) {
                                                    setTempSelectedWatcherIds(tempSelectedWatcherIds.filter(id => id !== u.id));
                                                } else {
                                                    setTempSelectedWatcherIds([...tempSelectedWatcherIds, u.id]);
                                                }
                                            }}
                                            className={`flex items-center justify-between w-full p-2.5 rounded-xl border text-left transition ${isChecked
                                                ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20'
                                                : 'border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                                                } ${isDefault ? 'opacity-75 cursor-not-allowed' : ''}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                {(() => {
                                                    const emp = employees.find(e => e.userId === u.id);
                                                    const avatar = emp?.avatarUrl || u.avatar;
                                                    return (
                                                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 overflow-hidden flex items-center justify-center text-[10px] font-black text-indigo-600 dark:text-indigo-400">
                                                            {avatar ? (
                                                                <img src={avatar} alt={u.name || ''} className="w-full h-full object-cover" />
                                                            ) : (
                                                                u.name ? u.name.split(' ').pop()?.slice(0, 2) : '?'
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                                <div>
                                                    <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                                                        {u.name}
                                                    </span>
                                                    <span className="block text-[10px] text-slate-400 font-semibold mt-0.5">
                                                        {isDefault ? 'Người theo dõi mặc định' : (u.role || 'Thành viên')}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${isChecked
                                                ? 'bg-indigo-500 border-indigo-500 text-white'
                                                : 'border-slate-300 dark:border-slate-600'
                                                }`}>
                                                {isChecked ? '✓' : ''}
                                            </div>
                                        </button>
                                    );
                                });
                            })()}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 flex gap-3">
                            <button
                                type="button"
                                onClick={() => setShowWatchersModal(false)}
                                className="flex-1 py-2 px-4 border border-slate-200 dark:border-slate-700 text-xs font-bold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveWatchers}
                                className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-xs font-bold rounded-xl text-white shadow-md shadow-indigo-500/20 transition"
                            >
                                Lưu thay đổi
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Action Dialog Modal */}
            {activeAction && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-scale-in">
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 dark:border-slate-700">
                            <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                                {activeAction === WorkflowInstanceAction.APPROVED ? (
                                    <><CheckCircle className="text-emerald-500" size={18} /> Phê duyệt & chuyển bước</>
                                ) : activeAction === WorkflowInstanceAction.REVISION_REQUESTED ? (
                                    <><RotateCcw className="text-amber-500" size={18} /> Yêu cầu chỉnh sửa / bổ sung</>
                                ) : (
                                    <><XCircle className="text-red-500" size={18} /> Từ chối đề xuất</>
                                )}
                            </h3>
                            <button onClick={() => setActiveAction(null)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Assignee Selection */}
                            {activeAction !== WorkflowInstanceAction.REJECTED && transitionTargetNode?.type !== WorkflowNodeType.END && (
                                <div className="animate-fade-in">
                                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
                                        Người nhận bước "{transitionTargetNode?.label || 'tiếp theo'}" *
                                    </label>
                                    {transitionCandidates.length === 0 ? (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                            Không tìm thấy nhân sự phù hợp để chỉ định.
                                        </div>
                                    ) : (
                                        <div className="grid gap-2 max-h-[180px] overflow-y-auto pr-1">
                                            {transitionCandidates.map(candidate => {
                                                const checked = selectedAssigneeIds.includes(candidate.id);
                                                return (
                                                    <button
                                                        key={candidate.id}
                                                        type="button"
                                                        onClick={() => toggleAssignee(candidate.id)}
                                                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${checked ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'}`}
                                                    >
                                                        <span className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-black ${checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{checked ? '✓' : ''}</span>
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-xs font-black text-slate-800 dark:text-slate-100">{candidate.name}</span>
                                                            <span className="block truncate text-[10px] font-semibold text-slate-400">{candidate.sublabel || candidate.role}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <div className="mt-2 text-[10px] font-semibold text-slate-400">
                                        {transitionSelectionMode === 'multiple' ? 'Chọn một hoặc nhiều người nhận' : 'Chỉ được chọn một người nhận'}
                                    </div>
                                </div>
                            )}

                            {/* Comment Textarea */}
                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
                                    Ý kiến / Ghi chú xử lý
                                </label>
                                <textarea
                                    value={actionComment}
                                    onChange={event => setActionComment(event.target.value)}
                                    placeholder="Ý kiến phê duyệt hoặc lý do từ chối/yêu cầu bổ sung..."
                                    rows={3}
                                    className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-850 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                            </div>

                            {actionError && (
                                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs font-bold text-red-650 dark:text-red-300">
                                    {actionError}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 mt-6 pt-3 border-t border-slate-100 dark:border-slate-700">
                            <button
                                onClick={() => setActiveAction(null)}
                                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                            >
                                Hủy
                            </button>
                            <button
                                disabled={mustChooseAssignee && selectedAssigneeIds.length === 0}
                                onClick={async () => {
                                    const ok = await runAction(activeAction);
                                    if (ok) setActiveAction(null);
                                }}
                                className="flex-1 py-2.5 bg-indigo-500 hover:bg-indigo-650 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition"
                            >
                                Xác nhận xử lý
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit details and custom fields Modal */}
            {showEditModal && (
                <div className="fixed inset-0 z-[999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:w-[80vw] xl:max-w-[1000px] h-[90vh] sm:h-auto sm:max-h-[85vh] flex flex-col overflow-hidden animate-scale-in">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
                            <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                                <FileText size={16} className="text-indigo-500" /> Chỉnh sửa thông tin đề xuất
                            </h3>
                            <button onClick={() => setShowEditModal(false)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {/* Title Field */}
                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                                    Tiêu đề phiếu đề xuất *
                                </label>
                                <input
                                    type="text"
                                    value={editTitle}
                                    onChange={e => setEditTitle(e.target.value)}
                                    placeholder="Tiêu đề phiếu..."
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold text-slate-850 dark:text-white"
                                />
                            </div>

                            {/* Description / Note Field */}
                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                                    Mô tả / Ghi chú
                                </label>
                                <textarea
                                    value={editNote}
                                    onChange={e => setEditNote(e.target.value)}
                                    placeholder="Nội dung mô tả đề xuất..."
                                    rows={3}
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none text-slate-850 dark:text-white"
                                />
                            </div>

                            {/* Dynamic Custom Fields */}
                            {customFieldsToRender.length > 0 && (
                                <div className="border-t border-slate-100 dark:border-slate-700 pt-4 space-y-4">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Các trường dữ liệu tùy chỉnh</p>
                                    {renderCustomFieldInputsLocal(
                                        customFieldsToRender,
                                        editFormData,
                                        (key, value) => setEditFormData(prev => ({ ...prev, [key]: value }))
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/20 flex gap-4">
                            <button
                                type="button"
                                onClick={() => setShowEditModal(false)}
                                className="flex-1 py-3 border border-slate-200 dark:border-slate-600 font-bold text-sm rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={isSavingEdit || !editTitle.trim()}
                                className="flex-1 py-3 bg-indigo-650 hover:bg-indigo-700 text-sm font-bold rounded-xl text-white shadow-md shadow-indigo-500/20 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isSavingEdit ? (
                                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang lưu...</>
                                ) : (
                                    'Lưu thay đổi'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkflowInstanceDetail;
