import React, { useEffect, useMemo } from 'react';
import { AlertCircle, Clock, ExternalLink, FileText, MessageSquare, Paperclip, X } from 'lucide-react';
import {
    User,
    WorkflowInstance,
    WorkflowInstanceAction,
    WorkflowInstanceLog,
    WorkflowInstanceStatus,
    WorkflowNode,
    WorkflowTemplate,
} from '../../types';
import { resolveCurrentWorkflowAssignees } from '../../lib/workflowAssignmentResolver';

const STATUS_LABEL: Record<WorkflowInstanceStatus, string> = {
    [WorkflowInstanceStatus.DRAFT]: 'Bản nháp',
    [WorkflowInstanceStatus.RUNNING]: 'Đang xử lý',
    [WorkflowInstanceStatus.COMPLETED]: 'Hoàn thành',
    [WorkflowInstanceStatus.REJECTED]: 'Từ chối',
    [WorkflowInstanceStatus.CANCELLED]: 'Đã hủy',
};

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
    if (Array.isArray(value)) return value.length ? { text: `${value.length} dòng` } : null;
    if (typeof value === 'object') {
        const fileName = (value as { fileName?: string }).fileName;
        return fileName ? { fileName } : null;
    }
    return null;
};

interface Props {
    instance: WorkflowInstance;
    template: WorkflowTemplate | null;
    currentNode: WorkflowNode | null;
    users: User[];
    logs: WorkflowInstanceLog[];
    onClose: () => void;
    onOpenDetail: () => void;
}

/**
 * Quick look at a ticket opened from the Kanban board. The full ticket (comments,
 * actions, attachments) lives on its own page behind "Xem chi tiết".
 */
const WorkflowInstanceSummaryPanel: React.FC<Props> = ({ instance, template, currentNode, users, logs, onClose, onOpenDetail }) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const creator = users.find(item => item.id === instance.createdBy);
    const isRunning = instance.status === WorkflowInstanceStatus.RUNNING;
    const assignees = useMemo(() => resolveCurrentWorkflowAssignees(instance, currentNode, users), [instance, currentNode, users]);

    const deadline = useMemo(() => {
        if (!isRunning || !currentNode?.config?.slaHours) return null;
        const arrived = logs
            .filter(log => log.nodeId === currentNode.id || log.action === WorkflowInstanceAction.APPROVED)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (!arrived) return null;
        const due = new Date(arrived.createdAt);
        due.setHours(due.getHours() + currentNode.config.slaHours);
        return { due, overdue: due.getTime() < Date.now() };
    }, [isRunning, currentNode, logs]);

    const fields = useMemo<FieldRow[]>(() => {
        const formData = instance.formData || {};
        const declared = (template?.customFields || []).map(field => ({ key: field.name, label: field.label }));
        const declaredKeys = new Set(declared.map(field => field.key));
        const extra = Object.keys(formData)
            .filter(key => !key.startsWith('step_') && !declaredKeys.has(key))
            .map(key => ({ key, label: key }));
        return [...declared, ...extra].flatMap(field => {
            const described = describeValue(formData[field.key]);
            return described ? [{ ...field, ...described }] : [];
        });
    }, [instance.formData, template]);

    const recentLogs = useMemo(
        () => logs.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3),
        [logs],
    );

    return (
        <div className="fixed inset-0 z-50 flex justify-end h-[100dvh] max-h-[100dvh] overflow-hidden" role="dialog" aria-modal="true" aria-label={`Tóm tắt phiếu ${instance.code}`}>
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900" style={{ animation: 'slideInRight 0.25s ease-out' }}>
                <div className="shrink-0 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500 dark:bg-slate-800">{instance.code}</span>
                                <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{STATUS_LABEL[instance.status]}</span>
                            </div>
                            <h3 className="text-base font-bold leading-snug text-slate-900 dark:text-white">{instance.title}</h3>
                            <p className="mt-1 text-xs text-slate-400">{template?.name || 'Quy trình'} · {creator?.name || 'N/A'} · {formatDate(instance.createdAt)}</p>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Đóng" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">
                            <X size={17} />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    {isRunning && currentNode && (
                        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Giai đoạn hiện tại</div>
                            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{currentNode.label}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                                <span className={assignees.length === 0 ? 'flex items-center gap-1 font-bold text-red-600' : 'font-semibold text-slate-600 dark:text-slate-300'}>
                                    {assignees.length === 0 && <AlertCircle size={12} />}
                                    Người xử lý: {assignees.length === 0 ? 'chưa được giao' : assignees.map(item => item.name).join(', ')}
                                </span>
                                {deadline && (
                                    <span className={`flex items-center gap-1 font-semibold ${deadline.overdue ? 'text-red-600' : 'text-slate-500'}`}>
                                        <Clock size={12} /> {deadline.overdue ? 'Quá hạn từ' : 'Hạn'} {formatDate(deadline.due.toISOString())}
                                    </span>
                                )}
                            </div>
                        </section>
                    )}

                    <section>
                        <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Nội dung phiếu</div>
                        {fields.length === 0 ? (
                            <p className="text-xs italic text-slate-400">Phiếu chưa có thông tin bổ sung.</p>
                        ) : (
                            <dl className="space-y-2.5">
                                {fields.map(field => (
                                    <div key={field.key}>
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

                    {recentLogs.length > 0 && (
                        <section>
                            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Hoạt động gần đây</div>
                            <ul className="space-y-2">
                                {recentLogs.map(log => {
                                    const actor = users.find(item => item.id === log.actedBy);
                                    return (
                                        <li key={log.id} className="text-xs text-slate-600 dark:text-slate-300">
                                            <span className="font-bold">{actor?.name || 'N/A'}</span> {ACTION_LABEL[log.action] || log.action}
                                            <span className="text-slate-400"> · {formatDate(log.createdAt)}</span>
                                            {log.comment && <p className="mt-0.5 flex items-start gap-1 italic text-slate-500"><MessageSquare size={11} className="mt-0.5 shrink-0" />{log.comment}</p>}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}
                </div>

                <div className="shrink-0 border-t border-slate-200 p-4 dark:border-slate-700">
                    <button type="button" onClick={onOpenDetail} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700">
                        <FileText size={15} /> Xem chi tiết <ExternalLink size={13} className="opacity-70" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkflowInstanceSummaryPanel;
