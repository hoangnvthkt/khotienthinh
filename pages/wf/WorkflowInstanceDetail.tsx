import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, CheckCircle, Clock, FileText, GitBranch, Image as ImageIcon,
    MessageSquare, Paperclip, RefreshCcw, RotateCcw, Send, User, X, XCircle,
    AlertCircle, Calendar, Download, Eye, Table2, FileSpreadsheet, ChevronRight, ChevronDown, Check,
    Search
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

// ========== Main Component ==========
const WorkflowInstanceDetail: React.FC = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const {
        templates, instances, nodes, edges, logs, loadInstanceFormData,
        processInstance, getInstanceLogs, refreshData, updateInstanceWatchers,
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
        if (!id) return;
        const targetNode = action === WorkflowInstanceAction.REVISION_REQUESTED ? revisionNode : nextNode;
        if (action !== WorkflowInstanceAction.REJECTED && targetNode && targetNode.type !== WorkflowNodeType.END && selectedAssigneeIds.length === 0) {
            setActionError('Vui lòng chọn người nhận xử lý bước tiếp theo.');
            return;
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
            return;
        }
        setActionComment('');
        setActiveAction(null);
        setSelectedAssigneeIds([]);
        await refreshData();
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

    return (
        <div className="min-h-[calc(100vh-120px)] space-y-5">
            {/* Header Title Block */}
            <div className="flex flex-col gap-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                    <button onClick={() => navigate('/wf')} className="mt-1 rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-mono text-[11px] font-black text-slate-500">{instance.code}</span>
                            <span className="rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-[11px] font-black text-blue-600 dark:text-blue-300">{STATUS_LABEL[instance.status]}</span>
                            {currentNode && instance.status === WorkflowInstanceStatus.RUNNING && (
                                <span className="rounded-lg bg-amber-50 dark:bg-amber-900/30 px-2 py-1 text-[11px] font-black text-amber-700 dark:text-amber-300">Bước: {currentNode.label}</span>
                            )}
                        </div>
                        <h1 className="mt-2 truncate text-2xl font-black text-slate-900 dark:text-white">{instance.title}</h1>
                        <div className="mt-1 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-400">
                            <span className="flex items-center gap-1"><GitBranch size={13} /> {template?.name || 'N/A'}</span>
                            <span className="flex items-center gap-1"><User size={13} /> {creator?.name || 'N/A'}</span>
                            <span className="flex items-center gap-1"><Clock size={13} /> {new Date(instance.createdAt).toLocaleString('vi-VN')}</span>
                        </div>
                    </div>
                </div>
                <button onClick={() => refreshData()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <RefreshCcw size={14} /> Làm mới
                </button>
            </div>

            {/* Layout Grid */}
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                {/* Main Column (Left) */}
                <div className="space-y-5">
                    {/* Horizontal Stages Progress Timeline */}
                    <div className="flex flex-wrap items-center gap-2 p-3 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-x-auto">
                        {orderedSteps.map((step, index) => {
                            const isCurrent = step.id === instance.currentNodeId && instance.status === WorkflowInstanceStatus.RUNNING;
                            const stepLogs = instanceLogs.filter(log => log.nodeId === step.id);
                            const isCompleted = stepLogs.some(log => log.action === WorkflowInstanceAction.APPROVED);
                            const isLast = index === orderedSteps.length - 1;

                            let bgClass = 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700';
                            if (isCurrent) {
                                bgClass = 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800 font-black';
                            } else if (isCompleted) {
                                bgClass = 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800 font-black';
                            }

                            return (
                                <div key={step.id} className="flex items-center gap-2 shrink-0">
                                    <div className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs transition ${bgClass}`}>
                                        <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black ${isCurrent ? 'bg-blue-600 text-white' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                            }`}>{index + 1}</span>
                                        <span>{step.label}</span>
                                    </div>
                                    {!isLast && <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />}
                                </div>
                            );
                        })}
                    </div>

                    {/* Accordion Custom Fields */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/20 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                        <button
                            onClick={() => setFieldsExpanded(!fieldsExpanded)}
                            className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-100/50 dark:bg-slate-800/40 border-b border-slate-200/60 dark:border-slate-700/60 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                {fieldsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} TRƯỜNG DỮ LIỆU KHI NHẬP MỚI
                            </span>
                            <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-0.5 rounded-full font-bold">
                                {customFieldsToRender.length} trường
                            </span>
                        </button>

                        {fieldsExpanded && (
                            <div className="p-5 bg-white dark:bg-slate-900 space-y-4 animate-fade-in">
                                <div className="border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm bg-white dark:bg-slate-950/40">
                                    <div className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-1">
                                        <span>⤳ ĐẦU VÀO</span>
                                    </div>
                                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 border-b border-slate-100 dark:border-slate-800 pb-2">
                                        THÔNG TIN CHI TIẾT
                                    </div>

                                    {customFieldsToRender.length > 0 ? (
                                        <div className="mt-4 space-y-5">
                                            {/* Simple Fields Grid */}
                                            {customFieldsToRender.filter(f => f.type !== 'table' && f.type !== 'file' && f.type !== 'textarea').length > 0 && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                                    {customFieldsToRender
                                                        .filter(f => f.type !== 'table' && f.type !== 'file' && f.type !== 'textarea')
                                                        .map((field) => {
                                                            const value = instance.formData?.[field.name];
                                                            const idx = customFieldsToRender.findIndex(f => f.id === field.id);
                                                            const numStr = String(idx + 2).padStart(2, '0');

                                                            return (
                                                                <div key={field.id} className="p-3 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/80 border border-slate-100 dark:border-slate-800/80 rounded-xl transition-all duration-200 shadow-sm">
                                                                    <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-slate-100 dark:border-slate-800/80">
                                                                        <span className="flex h-5 items-center justify-center rounded bg-emerald-600 px-1.5 text-[9px] font-black text-white uppercase tracking-wider shadow-sm shadow-emerald-600/10">
                                                                            {numStr}
                                                                        </span>
                                                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                                                                            {field.label}
                                                                        </span>
                                                                    </div>
                                                                    <div className="break-words text-sm font-semibold text-slate-800 dark:text-slate-200">
                                                                        {value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : <span className="text-slate-300 dark:text-slate-650 font-normal italic">Trống</span>}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            )}

                                            {/* Complex Fields Full Width List */}
                                            {customFieldsToRender.filter(f => f.type === 'table' || f.type === 'file' || f.type === 'textarea').length > 0 && (
                                                <div className="space-y-4 pt-1">
                                                    {customFieldsToRender
                                                        .filter(f => f.type === 'table' || f.type === 'file' || f.type === 'textarea')
                                                        .map((field) => {
                                                            const value = instance.formData?.[field.name];
                                                            const idx = customFieldsToRender.findIndex(f => f.id === field.id);
                                                            const numStr = String(idx + 2).padStart(2, '0');

                                                            return (
                                                                <div key={field.id} className="p-4 bg-slate-50/20 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-800/80 rounded-xl shadow-sm">
                                                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100 dark:border-slate-800/80">
                                                                        <span className="flex h-5 items-center justify-center rounded bg-emerald-600 px-1.5 text-[9px] font-black text-white uppercase tracking-wider shadow-sm shadow-emerald-600/10">
                                                                            {numStr}
                                                                        </span>
                                                                        <span className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                                                                            {field.label}
                                                                        </span>
                                                                    </div>
                                                                    <div className="mt-1">
                                                                        {/* Table field rendering */}
                                                                        {field.type === 'table' && (
                                                                            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm max-w-full">
                                                                                <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                                                                                    <table className="w-full text-xs text-left" style={{ minWidth: Math.max(600, (field.options || []).length * 150) }}>
                                                                                        <thead>
                                                                                            <tr className="bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 font-bold border-b border-slate-200 dark:border-slate-700">
                                                                                                <th className="px-4 py-3 text-center w-12 font-bold uppercase tracking-wider text-[10px]">#</th>
                                                                                                {(field.options || []).map((col, colIdx) => (
                                                                                                    <th key={colIdx} className="px-4 py-3 whitespace-nowrap font-bold uppercase tracking-wider text-[10px]">{col}</th>
                                                                                                ))}
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                                                                            {Array.isArray(value) && value.length > 0 ? (
                                                                                                value.map((row, ri) => (
                                                                                                    <tr key={ri} className="even:bg-slate-50/30 dark:even:bg-slate-900/10 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                                                                        <td className="px-4 py-3 text-center">
                                                                                                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                                                                                                                {ri + 1}
                                                                                                            </span>
                                                                                                        </td>
                                                                                                        {(field.options || []).map((_, ci) => (
                                                                                                            <td key={ci} className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap font-medium">{row[ci] ?? ''}</td>
                                                                                                        ))}
                                                                                                    </tr>
                                                                                                ))
                                                                                            ) : (
                                                                                                <tr>
                                                                                                    <td colSpan={(field.options?.length || 0) + 1} className="px-4 py-6 text-center text-slate-400 italic font-semibold">
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
                                                                            <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 rounded-xl text-xs max-w-md shadow-sm transition hover:shadow-md">
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
                                                                            <span className="text-slate-300 dark:text-slate-650 font-normal italic text-sm">Chưa có tệp đính kèm</span>
                                                                        )}
                                                                        {/* Textarea field rendering */}
                                                                        {field.type === 'textarea' && (
                                                                            <div className="text-sm font-medium text-slate-750 dark:text-slate-350 whitespace-pre-wrap leading-relaxed">
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
                                        <p className="text-sm font-semibold text-slate-400 mt-2">Quy trình không cấu hình trường dữ liệu tùy chỉnh.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Workflow Actions Section */}
                    {canAct && (
                        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm">
                            <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Send size={16} /> Xử lý phiếu
                            </h2>
                            <div className="mb-4 flex flex-wrap gap-2">
                                <button onClick={() => setActiveAction(WorkflowInstanceAction.APPROVED)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeAction === WorkflowInstanceAction.APPROVED ? 'bg-emerald-500 text-white shadow-md' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'}`}>
                                    <CheckCircle size={14} /> Duyệt / chuyển bước
                                </button>
                                <button onClick={() => setActiveAction(WorkflowInstanceAction.REVISION_REQUESTED)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeAction === WorkflowInstanceAction.REVISION_REQUESTED ? 'bg-amber-500 text-white shadow-md' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                                    <RotateCcw size={14} /> Yêu cầu bổ sung
                                </button>
                                <button onClick={() => setActiveAction(WorkflowInstanceAction.REJECTED)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeAction === WorkflowInstanceAction.REJECTED ? 'bg-red-500 text-white shadow-md' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                                    <XCircle size={14} /> Từ chối
                                </button>
                            </div>

                            {activeAction && activeAction !== WorkflowInstanceAction.REJECTED && transitionTargetNode?.type !== WorkflowNodeType.END && (
                                <div className="mb-4 animate-fade-in">
                                    <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
                                        Người nhận bước "{transitionTargetNode?.label || 'tiếp theo'}"
                                    </div>
                                    {transitionCandidates.length === 0 ? (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                            Step này chưa có pool người hợp lệ để chọn.
                                        </div>
                                    ) : (
                                        <div className="grid gap-2 md:grid-cols-2">
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
                                    <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        {transitionSelectionMode === 'multiple' ? 'Step cho phép chọn nhiều người' : 'Step chỉ chọn một người'}
                                    </div>
                                </div>
                            )}

                            <textarea
                                value={actionComment}
                                onChange={event => setActionComment(event.target.value)}
                                placeholder="Ghi chú xử lý..."
                                rows={3}
                                className="mb-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800"
                            />
                            {actionError && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-900/20 dark:text-red-300">{actionError}</div>}
                            <button
                                disabled={!activeAction || (mustChooseAssignee && selectedAssigneeIds.length === 0)}
                                onClick={() => activeAction && runAction(activeAction)}
                                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-black text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Send size={14} /> Xác nhận xử lý
                            </button>
                        </section>
                    )}

                    {/* Wide Comments Section */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 flex flex-col shadow-sm">
                        <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <MessageSquare size={16} /> Trao đổi thảo luận
                        </h2>
                        <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1 mb-4">
                            {comments.length === 0 && (
                                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-sm font-semibold text-slate-400">
                                    Chưa có trao đổi nào trong phiếu này.
                                </div>
                            )}
                            {comments.map(comment => {
                                const author = users.find(item => item.id === comment.authorUserId);
                                const mine = comment.authorUserId === user.id;
                                return (
                                    <div key={comment.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm ${mine ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                                            <div className={`mb-1 text-[10px] font-black uppercase tracking-wider ${mine ? 'text-indigo-100' : 'text-slate-400'}`}>
                                                {author?.name || 'N/A'} • {new Date(comment.createdAt).toLocaleString('vi-VN')}
                                            </div>
                                            {comment.body && <div className="whitespace-pre-wrap text-sm font-medium leading-relaxed">{comment.body}</div>}
                                            {comment.attachments.length > 0 && (
                                                <div className="mt-2 grid gap-2 grid-cols-2 md:grid-cols-3">
                                                    {comment.attachments.map(attachment => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                            {draftAttachments.length > 0 && (
                                <div className="mb-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                                    {draftAttachments.map(attachment => (
                                        <div key={attachment.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 border border-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                            <Paperclip size={13} className="text-slate-400" />
                                            <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                                            <button onClick={() => removeDraftAttachment(attachment)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                                                <X size={13} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <textarea
                                value={commentBody}
                                onChange={event => setCommentBody(event.target.value)}
                                placeholder="Nhập nội dung trao đổi thảo luận..."
                                rows={3}
                                className="mb-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800 text-slate-700 dark:text-slate-250"
                            />
                            {commentError && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-900/20 dark:text-red-300">{commentError}</div>}
                            <div className="flex items-center justify-between gap-2">
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                                    <Paperclip size={14} /> {isUploading ? 'Đang tải...' : 'Đính kèm tệp'}
                                    <input type="file" multiple className="hidden" onChange={event => { handleAttachmentFiles(event.target.files); event.target.value = ''; }} />
                                </label>
                                <button
                                    onClick={sendComment}
                                    disabled={isSendingComment || isUploading || (!commentBody.trim() && draftAttachments.length === 0)}
                                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2 text-xs font-black text-white hover:bg-indigo-650 disabled:cursor-not-allowed disabled:opacity-50 shadow-md shadow-indigo-500/20"
                                >
                                    <Send size={14} /> Gửi tin
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar Column (Right) */}
                <div className="space-y-5">
                    {/* Overdue Alert Banner */}
                    {isOverdue && (
                        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-500 text-white px-4 py-3 shadow-md animate-pulse">
                            <AlertCircle size={18} className="shrink-0" />
                            <div className="text-xs font-black flex-1 uppercase tracking-wider">
                                Quá hạn tại bước này!
                            </div>
                            <span className="text-[11px] font-black">
                                {currentStepTiming ? `${currentStepTiming.durationHours}h` : ''} / {currentNode?.config?.slaHours}h
                            </span>
                        </div>
                    )}

                    {/* Current Stage Card */}
                    {currentNode && instance.status === WorkflowInstanceStatus.RUNNING && (
                        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-blue-100/30 dark:border-blue-900/50 dark:from-slate-900 dark:to-blue-950/20 p-5 shadow-sm">
                            <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest block">Giai đoạn hiện tại</span>
                            <h3 className="text-base font-black text-blue-800 dark:text-blue-300 mt-1">
                                [{currentStepIndex}/{orderedSteps.length}] {currentNode.label}
                            </h3>
                            <div className="mt-3.5 space-y-2.5 text-xs">
                                <div className="flex justify-between font-semibold text-slate-500 dark:text-slate-400">
                                    <span>Thời hạn hoàn thành:</span>
                                    <span className="text-slate-800 dark:text-slate-200 font-bold">{deadlineString}</span>
                                </div>
                                <div className="flex justify-between font-semibold text-slate-500 dark:text-slate-400">
                                    <span>Thời gian bắt đầu:</span>
                                    <span className="text-slate-800 dark:text-slate-200 font-bold">
                                        {currentStepTiming ? currentStepTiming.startTime.split(' ')[0] : 'N/A'}
                                    </span>
                                </div>
                                <div className="pt-2 border-t border-blue-200/50 dark:border-blue-900/30 flex justify-between text-[11px] font-black uppercase text-slate-400">
                                    <span>Kỳ vọng SLA</span>
                                    <span>Đã sử dụng</span>
                                </div>
                                <div className="flex justify-between text-sm font-black text-slate-700 dark:text-slate-200">
                                    <span>{currentNode.config?.slaHours ? `${currentNode.config.slaHours.toFixed(2)}h` : 'N/A'}</span>
                                    <span className={isOverdue ? 'text-red-500 font-bold' : 'text-blue-600 dark:text-blue-400'}>
                                        {currentStepTiming ? `${currentStepTiming.durationHours}h` : '0.00h'}
                                    </span>
                                </div>
                                {/* Progress Bar */}
                                {currentNode.config?.slaHours && currentStepTiming && (
                                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-1 shadow-inner">
                                        <div
                                            className={`h-full rounded-full transition-all ${isOverdue ? 'bg-red-500' : 'bg-blue-500'}`}
                                            style={{ width: `${Math.min((currentStepTiming.durationHours / currentNode.config.slaHours) * 100, 100)}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                            {nextNode && (
                                <div className="mt-4 pt-3 border-t border-blue-200/50 dark:border-blue-900/30 text-[10px] font-black text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                    <span>» Giai đoạn kế tiếp:</span>
                                    <span className="underline">{nextNode.label} ({nextNode.config?.slaHours || 24}h0m)</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Task Info Card */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm">
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">Thông tin nhiệm vụ</h4>
                        <div className="mt-3 space-y-2.5 text-xs">
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Mã nhiệm vụ:</span>
                                <span className="text-slate-700 dark:text-slate-200 font-mono font-bold">#{instance.code}</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Tạo bởi:</span>
                                <span className="text-slate-700 dark:text-slate-200 font-bold">{creator?.name || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Thời gian tạo:</span>
                                <span className="text-slate-700 dark:text-slate-200 font-bold">{new Date(instance.createdAt).toLocaleString('vi-VN')}</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Cập nhật gần nhất:</span>
                                <span className="text-slate-700 dark:text-slate-200 font-bold">{new Date(instance.updatedAt).toLocaleString('vi-VN')}</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Giai đoạn hiện tại:</span>
                                <span className="text-slate-700 dark:text-slate-200 font-bold">{currentNode?.label || 'Hoàn thành'}</span>
                            </div>
                            {currentNode && instance.status === WorkflowInstanceStatus.RUNNING && (
                                <div className="flex justify-between font-semibold">
                                    <span className="text-slate-400">Người quản trị giai đoạn:</span>
                                    <span className="text-indigo-600 dark:text-indigo-400 font-bold text-right truncate max-w-[200px]" title={stageManagersString}>
                                        {stageManagersString}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Followers Card */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                            <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Người theo dõi</h4>
                            <span
                                onClick={() => {
                                    setTempSelectedWatcherIds(instance.watchers || []);
                                    setWatcherSearchTerm('');
                                    setShowWatchersModal(true);
                                }}
                                className="text-[10px] font-bold text-indigo-500 hover:underline cursor-pointer"
                            >
                                Thêm nhiều người
                            </span>
                        </div>
                        <div className="mt-3 flex items-center gap-2 overflow-x-auto py-1">
                            <div className="flex -space-x-2.5 overflow-hidden">
                                {Array.from(new Set([...(template?.defaultWatchers || []), ...(instance.watchers || [])])).slice(0, 8).map((watcherId, idx) => {
                                    const watcherUser = users.find(u => u.id === watcherId);
                                    const watcherEmployee = employees.find(e => e.userId === watcherId);
                                    const watcherAvatar = watcherEmployee?.avatarUrl || watcherUser?.avatar;
                                    return (
                                        <div
                                            key={watcherId}
                                            className="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-slate-900 bg-slate-200 overflow-hidden flex items-center justify-center text-[10px] font-black text-slate-600 uppercase border border-slate-100 shadow-sm"
                                            title={watcherUser?.name || 'N/A'}
                                        >
                                            {watcherAvatar ? (
                                                <img src={watcherAvatar} alt={watcherUser?.name || ''} className="w-full h-full object-cover" />
                                            ) : (
                                                watcherUser?.name ? watcherUser.name.split(' ').pop()?.slice(0, 2) : '?'
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <button
                                onClick={handleToggleWatch}
                                disabled={isDefaultWatcher}
                                title={isDefaultWatcher ? 'Bạn là người theo dõi mặc định của quy trình này' : undefined}
                                className="h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isDefaultWatcher ? 'Đang theo dõi (Mặc định)' : isCustomWatcher ? 'Bỏ theo dõi' : 'Theo dõi'}
                            </button>
                        </div>
                    </div>

                    {/* Total Time / Duration Progress */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm">
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">Tổng thời gian sử dụng</h4>
                        <div className="mt-3 text-xs space-y-2">
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Tổng SLA kỳ vọng:</span>
                                <span className="text-slate-800 dark:text-slate-200 font-bold">{totalSlaHours.toFixed(2)} giờ</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-slate-400">Đã sử dụng thực tế:</span>
                                <span className={`font-bold ${totalDurationHours > totalSlaHours ? 'text-red-500 font-bold animate-pulse' : 'text-slate-800 dark:text-slate-200'}`}>
                                    {totalDurationHours.toFixed(2)} giờ
                                </span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
                                <div
                                    className={`h-full rounded-full transition-all ${totalDurationHours > totalSlaHours ? 'bg-red-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min((totalDurationHours / (totalSlaHours || 1)) * 100, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Stage Timeline History Card */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm">
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2.5">Tiến trình của các giai đoạn</h4>
                        <div className="mt-4 space-y-5 relative pl-4 border-l border-slate-200 dark:border-slate-800">
                            {stepTimings.map((timing, idx) => {
                                const isCurrent = timing.status === 'running';
                                const isCompleted = timing.status === 'completed';

                                return (
                                    <div key={timing.stepId} className="relative text-xs">
                                        {/* Status Dot */}
                                        <div className={`absolute -left-[22.5px] top-0.5 h-3 w-3 rounded-full border-2 bg-white dark:bg-slate-900 transition-all ${isCompleted
                                            ? 'border-emerald-500 bg-emerald-500 text-white flex items-center justify-center text-[6px]'
                                            : isCurrent
                                                ? 'border-blue-500 bg-blue-500'
                                                : 'border-slate-300 dark:border-slate-700'
                                            }`}>
                                            {isCompleted && <Check size={6} className="stroke-[3] text-white" />}
                                        </div>

                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center justify-between">
                                                <span className={`font-black uppercase tracking-wide ${isCurrent ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                                    {idx + 1}. {timing.label}
                                                </span>
                                                {timing.startTime && (
                                                    <span className="text-[10px] text-slate-400 font-bold shrink-0">
                                                        SLA: {orderedSteps[idx]?.config?.slaHours || 24}h
                                                    </span>
                                                )}
                                            </div>

                                            {timing.startTime ? (
                                                <div className="mt-1 space-y-1 text-slate-500 dark:text-slate-400 font-medium">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span>Thực tế:</span>
                                                        <span className={`font-bold ${isCurrent && isOverdue ? 'text-red-500' : 'text-slate-700 dark:text-slate-350'}`}>
                                                            {timing.durationHours.toFixed(2)}h
                                                        </span>
                                                    </div>
                                                    {isCompleted && timing.actorName && (
                                                        <div className="text-[10px] mt-0.5 bg-slate-50 dark:bg-slate-800/40 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800/20">
                                                            <div>
                                                                Xử lý: <span className="font-bold text-slate-700 dark:text-slate-200">{timing.actorName}</span>
                                                            </div>
                                                            <div className="text-[9px] text-slate-400 mt-0.5">{timing.actionDate}</div>
                                                            {timing.comment && <div className="mt-1 italic text-slate-400">"{timing.comment}"</div>}
                                                        </div>
                                                    )}
                                                    {isCurrent && (
                                                        <span className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded text-[9px] font-black uppercase tracking-wider animate-pulse">
                                                            Đang xử lý ở bước này
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-[10px] text-slate-300 dark:text-slate-700 font-semibold italic">Chưa bắt đầu</span>
                                            )}
                                        </div>
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
                                            className={`flex items-center justify-between w-full p-2.5 rounded-xl border text-left transition ${
                                                isChecked
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
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${
                                                isChecked
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
        </div>
    );
};

export default WorkflowInstanceDetail;
