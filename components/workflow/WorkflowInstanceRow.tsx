import React from 'react';
import { Check, Eye, Paperclip, PenLine } from 'lucide-react';
import { User, WorkflowInstance, WorkflowInstanceAction, WorkflowInstanceStatus } from '../../types';
import { getWorkflowStepActionCopy } from '../../lib/workflowStepType';
import type { WorkflowInstanceInsight } from '../../lib/workflowInstanceInsight';
import {
    WaitingForYouBadge,
    WorkflowHandlers,
    WorkflowStatusBadge,
    WorkflowStepper,
    WorkflowWaitChip,
} from './WorkflowInstanceVisuals';

export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-mint-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-mint-700';
export const btnSoft = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
export const btnDanger = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-800 dark:hover:bg-rose-950/30';

interface Props {
    instance: WorkflowInstance;
    templateName: string;
    insight: WorkflowInstanceInsight;
    users: User[];
    creatorName: string;
    metaLine: string;
    fileCount: number;
    /** The signed-in user can act on the current step. */
    waitingForMe: boolean;
    onOpen: () => void;
    onAction: (action: WorkflowInstanceAction) => void;
    onOpenCanonical: () => void;
}

/** One ticket in the list: what it is, which step, who holds it, and the buttons that matter. */
const WorkflowInstanceRow: React.FC<Props> = ({ instance, templateName, insight, users, creatorName, metaLine, fileCount, waitingForMe, onOpen, onAction, onOpenCanonical }) => {
    const running = instance.status === WorkflowInstanceStatus.RUNNING;
    const draft = instance.status === WorkflowInstanceStatus.DRAFT;
    const copy = getWorkflowStepActionCopy(insight.currentNode);
    const stepLabels = insight.steps.map(step => step.label);
    const accent = insight.overdue ? 'bg-rose-400' : waitingForMe ? 'bg-amber-400' : 'bg-transparent';

    return (
        <article
            onClick={onOpen}
            className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-white px-4 py-3 transition hover:border-mint-300 hover:shadow-sm dark:bg-slate-900 ${waitingForMe ? 'border-amber-200 dark:border-amber-900/60' : 'border-slate-200 dark:border-slate-800'}`}
        >
            <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
            <div className="grid gap-x-5 gap-y-2.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] xl:items-center">
                <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            onClick={event => { event.stopPropagation(); onOpenCanonical(); }}
                            title="Mở liên kết chuẩn của phiếu"
                            className="font-mono text-xs font-semibold text-mint-700 hover:underline dark:text-mint-300"
                        >
                            {instance.code}
                        </button>
                        <WorkflowStatusBadge status={instance.status} />
                        {waitingForMe && <WaitingForYouBadge />}
                        {fileCount > 0 && <span className="inline-flex items-center gap-0.5 text-xs text-slate-400" title={`${fileCount} tệp đính kèm`}><Paperclip size={12} />{fileCount}</span>}
                    </p>
                    <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">{instance.title}</h3>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{templateName}{metaLine ? ` · ${metaLine}` : ''}</p>
                </div>

                <div className="min-w-0 space-y-1.5">
                    {stepLabels.length > 0 && <WorkflowStepper stepLabels={stepLabels} stepIndex={insight.stepIndex} running={running} overdue={insight.overdue} />}
                    <p className="truncate text-xs text-slate-600 dark:text-slate-300">
                        {running && insight.currentNode ? (
                            <><span className="font-semibold text-slate-800 dark:text-slate-100">Bước {insight.stepIndex + 1}/{insight.steps.length}</span> · {insight.currentNode.label}</>
                        ) : draft ? 'Chưa gửi duyệt'
                            : instance.status === WorkflowInstanceStatus.COMPLETED ? 'Đã đi hết các bước'
                                : instance.status === WorkflowInstanceStatus.REJECTED ? 'Đã bị từ chối' : 'Đã hủy'}
                    </p>
                </div>

                <div className="flex min-w-0 flex-col items-start gap-1">
                    {running ? (
                        <>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Người xử lý</p>
                            <WorkflowHandlers handlerIds={insight.handlerIds} users={users} />
                            <WorkflowWaitChip insight={insight} status={instance.status} />
                        </>
                    ) : (
                        <span className="text-xs text-slate-400">{creatorName} tạo {new Date(instance.createdAt).toLocaleDateString('vi-VN')}</span>
                    )}
                </div>

                <div className="flex w-full items-center justify-end gap-1.5 md:w-auto" onClick={event => event.stopPropagation()}>
                    {waitingForMe ? (
                        <>
                            <button type="button" className={`${btnPrimary} flex-1 md:flex-none`} onClick={() => onAction(WorkflowInstanceAction.APPROVED)}>
                                <Check size={15} />{copy.isAction ? 'Hoàn thành' : 'Duyệt'}
                            </button>
                            {copy.canReject && (
                                <button type="button" className={`${btnDanger} flex-1 md:flex-none`} onClick={() => onAction(WorkflowInstanceAction.REJECTED)}>Từ chối</button>
                            )}
                        </>
                    ) : draft ? (
                        <button type="button" className={`${btnSoft} flex-1 md:flex-none`} onClick={onOpen}><PenLine size={15} />Tiếp tục soạn</button>
                    ) : (
                        <button type="button" className={`${btnSoft} flex-1 md:flex-none`} onClick={onOpen}><Eye size={15} />Xem</button>
                    )}
                </div>
            </div>
        </article>
    );
};

export default WorkflowInstanceRow;
