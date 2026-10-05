import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, RotateCcw, X, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useWorkflow } from '../../context/WorkflowContext';
import { WorkflowInstanceAction, WorkflowNodeType } from '../../types';
import { getWorkflowStepSelectionMode, resolveWorkflowStepAssigneeCandidates } from '../../lib/workflowAssignmentResolver';
import { approvalAdvancesStage, getWorkflowStepActionCopy, getWorkflowStepApprovalState } from '../../lib/workflowStepType';

interface Props {
    instanceId: string;
    action: WorkflowInstanceAction;
    onClose: () => void;
    /** Called after the server accepted the action, before the dialog closes. */
    onDone?: () => void | Promise<void>;
}

/**
 * Approve / request revision / reject a ticket: choose who gets the next step, add a note, confirm.
 * One dialog for the ticket page, the list, the Kanban cards and the quick-look panel.
 */
const WorkflowInstanceActionDialog: React.FC<Props> = ({ instanceId, action, onClose, onDone }) => {
    const { instances, nodes, edges, getInstanceLogs, processInstance } = useWorkflow();
    const { user, users, employees, orgUnits } = useApp();
    const [comment, setComment] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const instance = instances.find(item => item.id === instanceId);
    const currentNode = nodes.find(node => node.id === instance?.currentNodeId);
    const instanceLogs = useMemo(() => getInstanceLogs(instanceId), [getInstanceLogs, instanceId]);

    const nextNode = useMemo(() => {
        if (!currentNode) return null;
        const edge = edges.find(item => item.sourceNodeId === currentNode.id);
        return edge ? nodes.find(node => node.id === edge.targetNodeId) || null : null;
    }, [currentNode, edges, nodes]);

    // Sending back goes to the step before this one (or the first real step when that is START).
    const revisionNode = useMemo(() => {
        if (!currentNode) return null;
        const previousEdge = edges.find(edge => edge.targetNodeId === currentNode.id);
        const previous = previousEdge ? nodes.find(node => node.id === previousEdge.sourceNodeId) : null;
        if (!previous || previous.type !== WorkflowNodeType.START) return previous || null;
        const firstEdge = edges.find(edge => edge.sourceNodeId === previous.id);
        return firstEdge ? nodes.find(node => node.id === firstEdge.targetNodeId) || null : null;
    }, [currentNode, edges, nodes]);

    const stepCopy = getWorkflowStepActionCopy(currentNode);
    // "Tất cả phải duyệt": only the last pending approver moves the ticket on.
    const approvalState = getWorkflowStepApprovalState(instance, currentNode);
    const approvalAdvances = approvalAdvancesStage(approvalState, user.id);
    const targetNode = action === WorkflowInstanceAction.REVISION_REQUESTED ? revisionNode : nextNode;
    const holdsStage = action === WorkflowInstanceAction.APPROVED && !approvalAdvances;
    const needsAssignee = action !== WorkflowInstanceAction.REJECTED && !holdsStage && Boolean(targetNode) && targetNode!.type !== WorkflowNodeType.END;
    const selectionMode = getWorkflowStepSelectionMode(targetNode);

    const candidates = useMemo(() => {
        if (!instance || !targetNode || targetNode.type === WorkflowNodeType.END) return [];
        return resolveWorkflowStepAssigneeCandidates({ node: targetNode, instance, users, employees, orgUnits, logs: instanceLogs });
    }, [instance, targetNode, users, employees, orgUnits, instanceLogs]);

    useEffect(() => {
        // Capture phase: Esc closes only this dialog, not the quick-look panel behind it.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            if (!submitting) onClose();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [onClose, submitting]);

    if (!instance) return null;

    const toggle = (candidateId: string) => setSelectedIds(previous => {
        if (selectionMode === 'single') return previous[0] === candidateId ? [] : [candidateId];
        return previous.includes(candidateId) ? previous.filter(item => item !== candidateId) : [...previous, candidateId];
    });

    const confirm = async () => {
        if (needsAssignee && selectedIds.length === 0) {
            setError('Vui lòng chọn người nhận xử lý bước tiếp theo.');
            return;
        }
        setError('');
        setSubmitting(true);
        try {
            const result = await processInstance(
                instanceId,
                action,
                user.id,
                comment,
                action === WorkflowInstanceAction.REJECTED || holdsStage ? [] : selectedIds,
            );
            if (!result.ok) {
                setError(result.errorMessage || 'Không xử lý được phiếu. Vui lòng thử lại.');
                return;
            }
            await onDone?.();
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    const tone = action === WorkflowInstanceAction.REJECTED ? 'bg-rose-600 hover:bg-rose-700' : 'bg-mint-600 hover:bg-mint-700';

    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true">
            <div className="animate-scale-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-slate-800 sm:rounded-2xl sm:p-6">
                <div className="mobile-sheet-handle sm:hidden" />
                <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-700 sm:mb-4 sm:pb-3">
                    <h3 className="flex items-center gap-2 text-xs font-black uppercase text-slate-800 dark:text-white sm:text-sm">
                        {action === WorkflowInstanceAction.APPROVED ? (
                            <><CheckCircle className="shrink-0 text-mint-600" size={17} /> <span>{stepCopy.dialogTitle}</span></>
                        ) : action === WorkflowInstanceAction.REVISION_REQUESTED ? (
                            <><RotateCcw className="shrink-0 text-amber-500" size={17} /> <span>Yêu cầu chỉnh sửa / bổ sung</span></>
                        ) : (
                            <><XCircle className="shrink-0 text-rose-500" size={17} /> <span>Từ chối đề xuất</span></>
                        )}
                    </h3>
                    <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700">
                        <X size={18} />
                    </button>
                </div>

                <p className="mb-3 truncate text-xs font-semibold text-slate-500">
                    <span className="font-mono text-mint-700">{instance.code}</span> · {instance.title}
                </p>

                <div className="space-y-4">
                    {holdsStage && (
                        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
                            Giai đoạn này cần tất cả cùng {stepCopy.isAction ? 'hoàn thành' : 'duyệt'}. Sau khi bạn xác nhận, phiếu vẫn chờ:{' '}
                            <strong>{approvalState.pending.filter(id => id !== user.id).map(id => users.find(item => item.id === id)?.name || 'Người dùng').join(', ')}</strong>.
                        </div>
                    )}
                    {needsAssignee && (
                        <div className="animate-fade-in">
                            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">
                                Người nhận bước "{targetNode?.label || 'tiếp theo'}" *
                            </label>
                            {candidates.length === 0 ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                    Không tìm thấy nhân sự phù hợp để chỉ định.
                                </div>
                            ) : (
                                <div className="grid max-h-[180px] gap-2 overflow-y-auto pr-1">
                                    {candidates.map(candidate => {
                                        const checked = selectedIds.includes(candidate.id);
                                        return (
                                            <button
                                                key={candidate.id}
                                                type="button"
                                                onClick={() => toggle(candidate.id)}
                                                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${checked ? 'border-mint-400 bg-mint-50 dark:bg-mint-900/20' : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'}`}
                                            >
                                                <span className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-black ${checked ? 'border-mint-600 bg-mint-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{checked ? '✓' : ''}</span>
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
                                {selectionMode === 'multiple' ? 'Chọn một hoặc nhiều người nhận' : 'Chỉ được chọn một người nhận'}
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">
                            {action === WorkflowInstanceAction.APPROVED ? 'Ý kiến / Ghi chú xử lý' : 'Lý do'}
                        </label>
                        <textarea
                            value={comment}
                            onChange={event => setComment(event.target.value)}
                            placeholder="Ý kiến phê duyệt hoặc lý do từ chối/yêu cầu bổ sung..."
                            rows={3}
                            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-mint-300 dark:border-slate-700 dark:bg-slate-900"
                        />
                    </div>

                    {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-950/20 dark:text-red-300">{error}</div>}
                </div>

                <div className="mt-5 flex gap-2.5 border-t border-slate-100 pt-3 dark:border-slate-700">
                    <button type="button" onClick={onClose} disabled={submitting} className="min-h-[42px] flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-bold transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700">
                        Hủy
                    </button>
                    <button type="button" disabled={submitting || (needsAssignee && selectedIds.length === 0)} onClick={() => void confirm()} className={`min-h-[42px] flex-1 rounded-xl py-2.5 text-xs font-bold text-white transition disabled:opacity-50 ${tone}`}>
                        {submitting ? 'Đang xử lý…' : 'Xác nhận xử lý'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkflowInstanceActionDialog;
