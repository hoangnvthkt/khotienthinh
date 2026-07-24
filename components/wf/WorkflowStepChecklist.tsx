import React, { useState, useEffect, useCallback } from 'react';
import {
    CheckCircle2, Circle, Plus, Paperclip, Trash2, Eye, Download,
    Check, X, FileText, CheckSquare, Loader2
} from 'lucide-react';
import { WorkflowStepTask, WorkflowStepTaskAttachment, User } from '../../types';
import { workflowStepTaskService } from '../../lib/workflowStepTaskService';
import { saveAs } from 'file-saver';
import { supabase } from '../../lib/supabase';

const WORKFLOW_ATTACHMENT_BUCKET = 'workflow-attachments';

interface WorkflowStepChecklistProps {
    instanceId: string;
    currentNodeId?: string | null;
    currentNodeLabel?: string;
    allStepNodes?: { id: string; label: string }[];
    currentUser: User;
    users: User[];
    canEdit?: boolean;
    onPreviewFile?: (file: any) => void;
}

export const WorkflowStepChecklist: React.FC<WorkflowStepChecklistProps> = ({
    instanceId,
    currentNodeId,
    currentNodeLabel,
    allStepNodes = [],
    currentUser,
    users,
    canEdit = true,
    onPreviewFile,
}) => {
    const [tasks, setTasks] = useState<WorkflowStepTask[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Form state for adding task
    const [isAdding, setIsAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState<string>(currentNodeId || '');
    const [draftFiles, setDraftFiles] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

    // Filter view state: 'current' | 'all'
    const [viewMode, setViewMode] = useState<'current' | 'all'>('current');

    // Update selectedNodeId if currentNodeId changes
    useEffect(() => {
        if (currentNodeId && (!selectedNodeId || viewMode === 'current')) {
            setSelectedNodeId(currentNodeId);
        }
    }, [currentNodeId, viewMode, selectedNodeId]);

    const loadTasks = useCallback(async () => {
        if (!instanceId) return;
        setIsLoading(true);
        setError(null);
        try {
            const list = await workflowStepTaskService.listTasks(instanceId);
            setTasks(list);
        } catch (err: any) {
            console.error('WorkflowStepChecklist load error:', err);
            setError('Không thể tải danh sách công việc');
        } finally {
            setIsLoading(false);
        }
    }, [instanceId]);

    useEffect(() => {
        loadTasks();
    }, [loadTasks]);

    // Filtered tasks based on viewMode
    const filteredTasks = tasks.filter(t => {
        if (viewMode === 'current' && currentNodeId) {
            return t.nodeId === currentNodeId;
        }
        return true;
    });

    const completedCount = filteredTasks.filter(t => t.isCompleted).length;
    const totalCount = filteredTasks.length;
    const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const handleCreateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        const title = newTitle.trim();
        if (!title) return;

        const targetNodeId = selectedNodeId || currentNodeId;
        if (!targetNodeId) {
            alert('Vui lòng chọn bước xử lý cho công việc này');
            return;
        }

        setIsSubmitting(true);
        try {
            // Upload draft files if any
            const attachments: WorkflowStepTaskAttachment[] = [];
            for (const file of draftFiles) {
                const att = await workflowStepTaskService.uploadAttachment(instanceId, file);
                attachments.push(att);
            }

            const newTask = await workflowStepTaskService.createTask({
                instanceId,
                nodeId: targetNodeId,
                title,
                createdBy: currentUser.id,
                attachments,
            });

            setTasks(prev => [...prev, newTask]);
            setNewTitle('');
            setDraftFiles([]);
            setIsAdding(false);
        } catch (err: any) {
            console.error('Create task error:', err);
            alert(err?.message || 'Có lỗi xảy ra khi tạo công việc mới');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleTask = async (task: WorkflowStepTask) => {
        if (!canEdit) return;
        setTogglingTaskId(task.id);
        const nextState = !task.isCompleted;

        try {
            const updated = await workflowStepTaskService.toggleTaskComplete({
                taskId: task.id,
                isCompleted: nextState,
                completedBy: currentUser.id,
            });
            setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
        } catch (err: any) {
            console.error('Toggle task error:', err);
            alert('Không thể cập nhật trạng thái công việc');
        } finally {
            setTogglingTaskId(null);
        }
    };

    const handleDeleteTask = async (task: WorkflowStepTask) => {
        if (!window.confirm(`Bạn có chắc chắn muốn xóa công việc "${task.title}"?`)) return;

        try {
            await workflowStepTaskService.deleteTask(task.id);
            setTasks(prev => prev.filter(t => t.id !== task.id));
        } catch (err) {
            console.error('Delete task error:', err);
            alert('Không thể xóa công việc');
        }
    };

    const handleDownloadFile = async (att: WorkflowStepTaskAttachment) => {
        try {
            if (att.storagePath) {
                const { data, error } = await supabase.storage.from(WORKFLOW_ATTACHMENT_BUCKET).download(att.storagePath);
                if (error || !data) throw error || new Error('Download failed');
                saveAs(data, att.fileName || 'attachment');
            }
        } catch (err) {
            console.error('Download file error:', err);
            alert('Không tải được file đính kèm');
        }
    };

    const getNodeLabel = (nodeId: string) => {
        const found = allStepNodes.find(n => n.id === nodeId);
        return found ? found.label : nodeId;
    };

    return (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            {/* Top Bar Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                        <CheckSquare size={18} />
                    </div>
                    <div>
                        <h2 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                            DANH SÁCH CÔNG VIỆC
                            {totalCount > 0 && (
                                <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] px-2 py-0.5 font-bold">
                                    {completedCount}/{totalCount}
                                </span>
                            )}
                        </h2>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                            {currentNodeLabel ? `Giai đoạn: ${currentNodeLabel}` : 'Công việc theo từng giai đoạn quy trình'}
                        </p>
                    </div>
                </div>

                {/* Controls: Single "Thêm công việc" Button */}
                <div className="flex items-center gap-2 shrink-0">
                    {canEdit && !isAdding && (
                        <button
                            type="button"
                            onClick={() => {
                                setIsAdding(true);
                                setSelectedNodeId(currentNodeId || allStepNodes[0]?.id || '');
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-black shadow-sm transition active:scale-95"
                        >
                            <Plus size={14} /> Thêm công việc
                        </button>
                    )}
                </div>
            </div>

            {/* Progress Bar if tasks exist */}
            {totalCount > 0 && (
                <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-black text-slate-500">
                        <span>Tiến độ hoàn thành</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">{percent}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shadow-inner">
                        <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Form to Add New Task */}
            {isAdding && (
                <form onSubmit={handleCreateTask} className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3 shadow-inner">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                            <Plus size={14} /> Thêm công việc mới
                        </span>
                        {allStepNodes.length > 1 && (
                            <select
                                value={selectedNodeId}
                                onChange={e => setSelectedNodeId(e.target.value)}
                                className="text-xs font-bold rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2 py-1 text-slate-700 dark:text-slate-200 outline-none"
                            >
                                {allStepNodes.map(node => (
                                    <option key={node.id} value={node.id}>
                                        {node.label} {node.id === currentNodeId ? '(Bước hiện tại)' : ''}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <textarea
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        placeholder="Nhập nội dung công việc cần thực hiện tại bước này..."
                        rows={2}
                        required
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-400 text-slate-800 dark:text-slate-200"
                    />

                    {/* File Attachment Draft List */}
                    {draftFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {draftFiles.map((file, idx) => (
                                <div key={idx} className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                    <Paperclip size={12} className="text-emerald-500" />
                                    <span className="truncate max-w-[150px]">{file.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => setDraftFiles(prev => prev.filter((_, i) => i !== idx))}
                                        className="text-slate-400 hover:text-red-500 ml-1"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center justify-between pt-1">
                        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-emerald-600 cursor-pointer select-none">
                            <Paperclip size={14} />
                            <span>Đính kèm file</span>
                            <input
                                type="file"
                                multiple
                                className="hidden"
                                onChange={e => {
                                    if (e.target.files?.length) {
                                        setDraftFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                                    }
                                    e.target.value = '';
                                }}
                            />
                        </label>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsAdding(false);
                                    setNewTitle('');
                                    setDraftFiles([]);
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400"
                            >
                                Hủy
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || !newTitle.trim()}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-black shadow-sm disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size={13} className="animate-spin" /> Đang lưu...
                                    </>
                                ) : (
                                    <>Lưu công việc</>
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {/* Task List */}
            {isLoading ? (
                <div className="py-6 text-center text-xs font-semibold text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin text-emerald-500" /> Đang tải danh sách công việc...
                </div>
            ) : filteredTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center">
                    <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                        {viewMode === 'current'
                            ? 'Bước này chưa có công việc nào trong checklist.'
                            : 'Phiếu này chưa có công việc nào.'}
                    </p>
                    {canEdit && !isAdding && (
                        <button
                            type="button"
                            onClick={() => {
                                setIsAdding(true);
                                setSelectedNodeId(currentNodeId || allStepNodes[0]?.id || '');
                            }}
                            className="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                        >
                            <Plus size={13} /> Nhấp vào đây để thêm công việc đầu tiên
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredTasks.map((task, index) => {
                        const completedUser = task.completedBy ? users.find(u => u.id === task.completedBy) : null;
                        const createdUser = users.find(u => u.id === task.createdBy);
                        const isToggling = togglingTaskId === task.id;

                        return (
                            <div
                                key={task.id}
                                className={`group flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3.5 rounded-xl border transition-all ${task.isCompleted
                                    ? 'bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200/80 dark:border-emerald-900/40'
                                    : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                            >
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                    {/* Green Checkmark Button / Tích xanh button */}
                                    <button
                                        type="button"
                                        onClick={() => handleToggleTask(task)}
                                        disabled={!canEdit || isToggling}
                                        title={task.isCompleted ? 'Đã hoàn thành - Bấm để bỏ tích' : 'Bấm để tích xanh hoàn thành'}
                                        className={`mt-0.5 shrink-0 transition-transform active:scale-90 ${!canEdit ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                                            }`}
                                    >
                                        {isToggling ? (
                                            <Loader2 size={20} className="animate-spin text-slate-400" />
                                        ) : task.isCompleted ? (
                                            <div className="h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm shadow-emerald-500/30 ring-2 ring-emerald-200 dark:ring-emerald-900">
                                                <Check size={13} strokeWidth={3} />
                                            </div>
                                        ) : (
                                            <div className="h-5 w-5 rounded-full border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500 dark:hover:border-emerald-400 bg-white dark:bg-slate-800 transition-colors" />
                                        )}
                                    </button>

                                    {/* Task Content */}
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {viewMode === 'all' && (
                                                <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                                    {getNodeLabel(task.nodeId)}
                                                </span>
                                            )}
                                            <span className={`text-xs font-semibold leading-relaxed break-words ${task.isCompleted
                                                ? 'text-emerald-900 dark:text-emerald-200 line-through decoration-emerald-500/50 font-bold'
                                                : 'text-slate-800 dark:text-slate-100 font-bold'
                                                }`}>
                                                {task.title}
                                            </span>
                                        </div>

                                        {/* Completed Info / Creator info */}
                                        <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                            <span>Tạo bởi {createdUser?.name || 'N/A'}</span>
                                            {task.isCompleted && (
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                                                    <CheckCircle2 size={11} />
                                                    Đã tích xanh bởi {completedUser?.name || 'N/A'} {task.completedAt && `• ${new Date(task.completedAt).toLocaleString('vi-VN')}`}
                                                </span>
                                            )}
                                        </div>

                                        {/* Attachments */}
                                        {task.attachments && task.attachments.length > 0 && (
                                            <div className="pt-1.5 flex flex-wrap gap-2">
                                                {task.attachments.map(att => (
                                                    <div
                                                        key={att.id}
                                                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-300"
                                                    >
                                                        <Paperclip size={12} className="text-emerald-500 shrink-0" />
                                                        <span className="truncate max-w-[160px]" title={att.fileName}>{att.fileName}</span>
                                                        <div className="flex items-center gap-1 shrink-0 ml-1 border-l border-slate-200 dark:border-slate-700 pl-1">
                                                            {onPreviewFile && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onPreviewFile(att)}
                                                                    className="p-0.5 rounded text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                                                    title="Xem trước"
                                                                >
                                                                    <Eye size={12} />
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadFile(att)}
                                                                className="p-0.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                                                                title="Tải về"
                                                            >
                                                                <Download size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Actions: Delete */}
                                {canEdit && (currentUser.id === task.createdBy || currentUser.role === 'ADMIN') && (
                                    <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity self-start sm:self-center">
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteTask(task)}
                                            className="p-1 rounded.lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            title="Xóa công việc"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
