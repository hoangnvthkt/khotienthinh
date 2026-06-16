import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, CheckCircle, Clock, FileText, GitBranch, Image as ImageIcon,
    MessageSquare, Paperclip, RefreshCcw, RotateCcw, Send, User, X, XCircle
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
} from '../../types';
import {
    getWorkflowStepSelectionMode,
    isWorkflowStepAssignedToUser,
    resolveWorkflowStepAssigneeCandidates,
} from '../../lib/workflowAssignmentResolver';
import { workflowInstanceCommentService } from '../../lib/workflowInstanceCommentService';
import { canSeeMaterialRequestWorkflowOnKanban, isMaterialRequestWorkflowTemplate } from '../../lib/workflowVisibility';

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

const WorkflowInstanceDetail: React.FC = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const {
        templates, instances, nodes, edges, logs, loadInstanceFormData,
        processInstance, getInstanceLogs, refreshData,
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

    const originalFormEntries = Object.entries(instance.formData || {})
        .filter(([key, value]) => !key.startsWith('step_') && isPlainDisplayValue(value));

    return (
        <div className="min-h-[calc(100vh-120px)] space-y-5">
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

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-5">
                    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                        <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <FileText size={16} /> Thông tin phiếu
                        </h2>
                        {originalFormEntries.length > 0 ? (
                            <div className="grid gap-3 md:grid-cols-2">
                                {originalFormEntries.map(([key, value]) => (
                                    <div key={key} className="rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{key}</div>
                                        <div className="mt-1 break-words text-sm font-semibold text-slate-700 dark:text-slate-200">{String(value)}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm font-semibold text-slate-400">Phiếu chưa có dữ liệu biểu mẫu hiển thị.</p>
                        )}
                    </section>

                    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                        <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <GitBranch size={16} /> Luồng xử lý
                        </h2>
                        <div className="space-y-3">
                            {orderedNodes.filter(node => node.type !== WorkflowNodeType.START).map(node => {
                                const nodeLogs = instanceLogs.filter(log => log.nodeId === node.id);
                                const isCurrent = node.id === instance.currentNodeId && instance.status === WorkflowInstanceStatus.RUNNING;
                                return (
                                    <div key={node.id} className={`rounded-xl border px-4 py-3 ${isCurrent ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'}`}>
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-800 dark:text-slate-100">{node.label}</div>
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{node.type}</div>
                                            </div>
                                            {isCurrent && <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-black text-white">Đang ở bước này</span>}
                                        </div>
                                        {nodeLogs.length > 0 && (
                                            <div className="mt-3 space-y-2">
                                                {nodeLogs.map(log => {
                                                    const actor = users.find(item => item.id === log.actedBy);
                                                    return (
                                                        <div key={log.id} className="text-xs text-slate-500 dark:text-slate-400">
                                                            <span className="font-bold text-slate-700 dark:text-slate-200">{actor?.name || 'N/A'}</span>
                                                            {' '}<span>{ACTION_LABEL[log.action] || log.action}</span>
                                                            {' '}<span className="text-slate-400">{new Date(log.createdAt).toLocaleString('vi-VN')}</span>
                                                            {log.comment && <div className="mt-1 rounded-lg bg-white dark:bg-slate-900 px-3 py-2 italic">{log.comment}</div>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {canAct && (
                        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                            <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Send size={16} /> Xử lý phiếu
                            </h2>
                            <div className="mb-4 flex flex-wrap gap-2">
                                <button onClick={() => setActiveAction(WorkflowInstanceAction.APPROVED)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeAction === WorkflowInstanceAction.APPROVED ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'}`}>
                                    <CheckCircle size={14} /> Duyệt / chuyển bước
                                </button>
                                <button onClick={() => setActiveAction(WorkflowInstanceAction.REVISION_REQUESTED)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeAction === WorkflowInstanceAction.REVISION_REQUESTED ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                                    <RotateCcw size={14} /> Yêu cầu bổ sung
                                </button>
                                <button onClick={() => setActiveAction(WorkflowInstanceAction.REJECTED)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeAction === WorkflowInstanceAction.REJECTED ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                                    <XCircle size={14} /> Từ chối
                                </button>
                            </div>

                            {activeAction && activeAction !== WorkflowInstanceAction.REJECTED && transitionTargetNode?.type !== WorkflowNodeType.END && (
                                <div className="mb-4">
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
                                className="mb-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800"
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
                </div>

                <aside className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-120px)] xl:overflow-hidden flex flex-col">
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <MessageSquare size={16} /> Trao đổi
                    </h2>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        {comments.length === 0 && (
                            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm font-semibold text-slate-400">
                                Chưa có trao đổi nào.
                            </div>
                        )}
                        {comments.map(comment => {
                            const author = users.find(item => item.id === comment.authorUserId);
                            const mine = comment.authorUserId === user.id;
                            return (
                                <div key={comment.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[88%] rounded-2xl px-3 py-2 ${mine ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                                        <div className={`mb-1 text-[10px] font-black uppercase tracking-wider ${mine ? 'text-indigo-100' : 'text-slate-400'}`}>
                                            {author?.name || 'N/A'} • {new Date(comment.createdAt).toLocaleString('vi-VN')}
                                        </div>
                                        {comment.body && <div className="whitespace-pre-wrap text-sm font-medium">{comment.body}</div>}
                                        {comment.attachments.length > 0 && (
                                            <div className="mt-2 grid gap-2">
                                                {comment.attachments.map(attachment => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                        {draftAttachments.length > 0 && (
                            <div className="mb-3 grid gap-2">
                                {draftAttachments.map(attachment => (
                                    <div key={attachment.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
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
                            placeholder="Nhập trao đổi..."
                            rows={3}
                            className="mb-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800"
                        />
                        {commentError && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-900/20 dark:text-red-300">{commentError}</div>}
                        <div className="flex items-center justify-between gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                                <Paperclip size={14} /> {isUploading ? 'Đang tải...' : 'Đính kèm'}
                                <input type="file" multiple className="hidden" onChange={event => { handleAttachmentFiles(event.target.files); event.target.value = ''; }} />
                            </label>
                            <button
                                onClick={sendComment}
                                disabled={isSendingComment || isUploading || (!commentBody.trim() && draftAttachments.length === 0)}
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-black text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Send size={14} /> Gửi
                            </button>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default WorkflowInstanceDetail;
