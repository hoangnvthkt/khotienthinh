import React, { useEffect, useMemo } from 'react';
import { ArrowRight, Check, ExternalLink, FileText, MessageSquare, Paperclip, RotateCcw, X } from 'lucide-react';
import {
    User,
    WorkflowInstance,
    WorkflowInstanceAction,
    WorkflowInstanceLog,
    WorkflowInstanceStatus,
    WorkflowTemplate,
} from '../../types';
import { getEffectiveStepAssigneeIds } from '../../lib/workflowAssignmentResolver';
import { getWorkflowStepActionCopy } from '../../lib/workflowStepType';
import { formatWaitDuration, type WorkflowInstanceInsight } from '../../lib/workflowInstanceInsight';
import { describeWorkflowFiles, normalizeWorkflowFiles } from '../../lib/workflowFiles';
import { btnDanger, btnPrimary, btnSoft } from './WorkflowInstanceRow';
import { WaitingForYouBadge, WorkflowHandlers, WorkflowStatusBadge, WorkflowWaitChip } from './WorkflowInstanceVisuals';

const ACTION_LABEL: Record<WorkflowInstanceAction, string> = {
    [WorkflowInstanceAction.SUBMITTED]: 'đã gửi',
    [WorkflowInstanceAction.APPROVED]: 'đã duyệt',
    [WorkflowInstanceAction.REJECTED]: 'đã từ chối',
    [WorkflowInstanceAction.REVISION_REQUESTED]: 'yêu cầu bổ sung',
    [WorkflowInstanceAction.REOPENED]: 'đã mở lại',
};

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';

interface FieldRow { key: string; label: string; text?: string; fileName?: string }

const describeValue = (value: unknown): Pick<FieldRow, 'text' | 'fileName'> | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.trim() ? { text: value.trim() } : null;
    if (typeof value === 'number') return { text: String(value) };
    if (typeof value === 'boolean') return { text: value ? 'Có' : 'Không' };
    const attached = normalizeWorkflowFiles(value);
    if (attached.length > 0) return { fileName: describeWorkflowFiles(attached) };
    if (Array.isArray(value)) return value.length ? { text: `${value.length} dòng` } : null;
    return null;
};

interface Props {
    instance: WorkflowInstance;
    template: WorkflowTemplate | null;
    insight: WorkflowInstanceInsight;
    users: User[];
    logs: WorkflowInstanceLog[];
    /** The signed-in user can act on the current step. */
    waitingForMe: boolean;
    onClose: () => void;
    onOpenDetail: () => void;
    onAction: (action: WorkflowInstanceAction) => void;
}

/**
 * Quick look at a ticket from the list or the Kanban board: where it is, who holds it, what it
 * says, and the actions. The full ticket (comments, files, edits) is behind "Xem chi tiết".
 */
const WorkflowInstanceSummaryPanel: React.FC<Props> = ({ instance, template, insight, users, logs, waitingForMe, onClose, onOpenDetail, onAction }) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const creator = users.find(item => item.id === instance.createdBy);
    const running = instance.status === WorkflowInstanceStatus.RUNNING;
    const copy = getWorkflowStepActionCopy(insight.currentNode);
    const nextStep = running ? insight.steps[insight.stepIndex + 1] : undefined;

    const fields = useMemo<FieldRow[]>(() => {
        const formData = instance.formData || {};
        const declared = (template?.customFields || []).map(field => ({ key: field.name, label: field.label }));
        const declaredKeys = new Set(declared.map(field => field.key));
        const extra = Object.keys(formData)
            .filter(key => !key.startsWith('step_') && key !== 'attachments' && !declaredKeys.has(key))
            .map(key => ({ key, label: key.replace(/_/g, ' ') }));
        const rows = [...declared, ...extra].flatMap(field => {
            const described = describeValue(formData[field.key]);
            return described ? [{ ...field, ...described }] : [];
        });
        const documents = normalizeWorkflowFiles(formData.attachments);
        return documents.length > 0 ? [...rows, { key: 'attachments', label: 'Tài liệu đính kèm', fileName: describeWorkflowFiles(documents) }] : rows;
    }, [instance.formData, template]);

    const lastLog = useMemo(
        () => logs.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0],
        [logs],
    );

    return (
        <div className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] justify-end overflow-hidden" role="dialog" aria-modal="true" aria-label={`Tóm tắt phiếu ${instance.code}`}>
            <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} />
            <div className="relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900" style={{ animation: 'slideInRight 0.25s ease-out' }}>
                <div className="shrink-0 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-semibold text-mint-700 dark:text-mint-300">{instance.code}</span>
                                <WorkflowStatusBadge status={instance.status} />
                                {waitingForMe && <WaitingForYouBadge />}
                            </div>
                            <h3 className="text-lg font-bold leading-snug text-slate-900 dark:text-white">{instance.title}</h3>
                            <p className="mt-1 text-xs text-slate-500">{template?.name || 'Quy trình'} · {creator?.name || 'N/A'} · {formatDate(instance.createdAt)}</p>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Đóng" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800">
                            <X size={17} />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    {running && insight.currentNode && (
                        <section className={`rounded-xl border p-4 ${insight.overdue ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20' : 'border-mint-200 bg-mint-50/60 dark:border-mint-900 dark:bg-mint-950/20'}`}>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Đang ở bước {insight.stepIndex + 1}/{insight.steps.length}</p>
                            <p className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{insight.currentNode.label}</p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <WorkflowHandlers handlerIds={insight.handlerIds} users={users} />
                                <WorkflowWaitChip insight={insight} status={instance.status} />
                            </div>
                            {nextStep && <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><ArrowRight size={12} />Tiếp theo: <b className="font-semibold text-slate-700 dark:text-slate-200">{nextStep.label}</b></p>}
                        </section>
                    )}

                    {insight.steps.length > 0 && (
                        <section>
                            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Các bước duyệt</h4>
                            <ol>
                                {insight.steps.map((step, index) => {
                                    const done = index < insight.stepIndex;
                                    const current = running && index === insight.stepIndex;
                                    const who = getEffectiveStepAssigneeIds(instance, step).map(id => users.find(item => item.id === id)?.name).filter(Boolean);
                                    return (
                                        <li key={step.id} className="flex gap-3">
                                            <span className="flex flex-col items-center">
                                                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${current ? 'bg-mint-600 text-white ring-4 ring-mint-100' : done ? 'bg-mint-100 text-mint-700' : 'border-2 border-slate-200 text-slate-400'}`}>{done ? <Check size={13} /> : index + 1}</span>
                                                {index < insight.steps.length - 1 && <span className={`my-0.5 w-0.5 flex-1 ${done ? 'bg-mint-200' : 'bg-slate-200 dark:bg-slate-700'}`} />}
                                            </span>
                                            <div className="min-w-0 flex-1 pb-3">
                                                <p className={`text-sm ${current ? 'font-bold text-slate-900 dark:text-white' : done ? 'font-medium text-slate-600 dark:text-slate-300' : 'text-slate-500'}`}>{step.label}</p>
                                                {who.length > 0 && <p className="text-xs text-slate-400">{who.join(', ')}</p>}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>
                    )}

                    <section>
                        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Nội dung phiếu</h4>
                        {fields.length === 0 ? (
                            <p className="text-xs italic text-slate-400">Phiếu chưa có thông tin bổ sung.</p>
                        ) : (
                            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                                {fields.map(field => (
                                    <div key={field.key} className="min-w-0">
                                        <dt className="text-[11px] font-semibold text-slate-400">{field.label}</dt>
                                        <dd className="mt-0.5 break-words text-sm font-medium text-slate-800 dark:text-slate-200">
                                            {field.fileName ? (
                                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800"><Paperclip size={12} className="text-slate-400" />{field.fileName}</span>
                                            ) : field.text}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    </section>

                    {lastLog && (
                        <section>
                            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Hoạt động gần nhất</h4>
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                <b className="font-semibold text-slate-800 dark:text-slate-100">{users.find(item => item.id === lastLog.actedBy)?.name || 'N/A'}</b>{' '}
                                {ACTION_LABEL[lastLog.action] || lastLog.action}
                                <span className="text-slate-400"> · {formatWaitDuration((Date.now() - new Date(lastLog.createdAt).getTime()) / 3_600_000)} trước</span>
                            </p>
                            {lastLog.comment && <p className="mt-0.5 flex items-start gap-1 text-xs italic text-slate-500"><MessageSquare size={11} className="mt-0.5 shrink-0" />{lastLog.comment}</p>}
                        </section>
                    )}
                </div>

                <div className="shrink-0 space-y-2 border-t border-slate-200 p-4 dark:border-slate-700">
                    {waitingForMe && (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {copy.canReject && <button type="button" className={btnDanger} onClick={() => onAction(WorkflowInstanceAction.REJECTED)}>Từ chối</button>}
                            <button type="button" className={btnSoft} onClick={() => onAction(WorkflowInstanceAction.REVISION_REQUESTED)}><RotateCcw size={14} />Yêu cầu bổ sung</button>
                            <button type="button" className={btnPrimary} onClick={() => onAction(WorkflowInstanceAction.APPROVED)}><Check size={15} />{copy.isAction ? 'Hoàn thành' : 'Duyệt, chuyển tiếp'}</button>
                        </div>
                    )}
                    <button type="button" onClick={onOpenDetail} className={`${btnSoft} w-full`}>
                        <FileText size={15} />Xem chi tiết<ExternalLink size={12} className="opacity-60" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkflowInstanceSummaryPanel;
