import React, { useState, useMemo, useCallback } from 'react';
import { useWorkflow } from '../context/WorkflowContext';
import { useApp } from '../context/AppContext';
import {
    WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceAction,
    WorkflowNodeType, Role, WorkflowNode
} from '../types';
import {
    Clock, CheckCircle, XCircle, User, GripVertical,
    ChevronRight, AlertCircle, MessageSquare, Paperclip,
    FileText, Hash, Calendar, ArrowRight, Eye
} from 'lucide-react';

const STATUS_COLORS: Record<WorkflowInstanceStatus, string> = {
    RUNNING: 'border-l-blue-500',
    COMPLETED: 'border-l-emerald-500',
    REJECTED: 'border-l-red-500',
    CANCELLED: 'border-l-slate-400',
};

const STATUS_DOT: Record<WorkflowInstanceStatus, string> = {
    RUNNING: 'bg-blue-500',
    COMPLETED: 'bg-emerald-500',
    REJECTED: 'bg-red-500',
    CANCELLED: 'bg-slate-400',
};

interface KanbanBoardProps {
    templateId: string;
    instances: WorkflowInstance[];
    onCardClick: (instance: WorkflowInstance) => void;
    onDragComplete: (instanceId: string, action: WorkflowInstanceAction, comment: string, assigneeId?: string) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ templateId, instances, onCardClick, onDragComplete }) => {
    const { nodes, edges, logs, getInstanceLogs, processInstance, reopenInstance } = useWorkflow();
    const { user, users } = useApp();

    const [draggedInstanceId, setDraggedInstanceId] = useState<string | null>(null);
    const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
    const [showConfirmDrag, setShowConfirmDrag] = useState<{ instanceId: string; targetNodeId: string; action: WorkflowInstanceAction; isReopen?: boolean } | null>(null);
    const [dragComment, setDragComment] = useState('');
    const [dragAssigneeId, setDragAssigneeId] = useState<string>('');

    // Build ordered columns from template nodes
    const orderedColumns = useMemo(() => {
        const templateNodes = nodes.filter(n => n.templateId === templateId);
        const templateEdges = edges.filter(e => e.templateId === templateId);

        const ordered: WorkflowNode[] = [];
        let current = templateNodes.find(n => n.type === WorkflowNodeType.START);
        const visited = new Set<string>();

        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            ordered.push(current);
            const nextEdge = templateEdges.find(e => e.sourceNodeId === current!.id);
            if (nextEdge) {
                current = templateNodes.find(n => n.id === nextEdge.targetNodeId);
            } else {
                break;
            }
        }

        return ordered;
    }, [nodes, edges, templateId]);

    // Group instances by currentNodeId
    const columnData = useMemo(() => {
        const map = new Map<string, WorkflowInstance[]>();

        // Initialize all columns
        orderedColumns.forEach(col => map.set(col.id, []));

        // Add "completed" and "rejected" virtual columns
        map.set('__COMPLETED__', []);
        map.set('__REJECTED__', []);

        instances.forEach(inst => {
            if (inst.templateId !== templateId) return;
            if (inst.status === WorkflowInstanceStatus.COMPLETED) {
                map.get('__COMPLETED__')?.push(inst);
            } else if (inst.status === WorkflowInstanceStatus.REJECTED) {
                map.get('__REJECTED__')?.push(inst);
            } else if (inst.status === WorkflowInstanceStatus.CANCELLED) {
                // Don't show cancelled in board
            } else if (inst.currentNodeId && map.has(inst.currentNodeId)) {
                map.get(inst.currentNodeId)?.push(inst);
            }
        });

        return map;
    }, [instances, orderedColumns, templateId]);

    // Calculate SLA deadline
    const getSlaInfo = (instance: WorkflowInstance, node: WorkflowNode) => {
        if (!node.config.slaHours) return null;
        const instanceLogs = getInstanceLogs(instance.id);
        const arrivedLog = instanceLogs
            .filter(l => l.nodeId === node.id || l.action === WorkflowInstanceAction.APPROVED)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        if (!arrivedLog) return null;

        const deadline = new Date(arrivedLog.createdAt);
        deadline.setHours(deadline.getHours() + node.config.slaHours);
        const now = new Date();
        const hoursLeft = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

        return {
            deadline,
            hoursLeft,
            isOverdue: hoursLeft < 0,
            isUrgent: hoursLeft >= 0 && hoursLeft < 4,
        };
    };

    // Drag handlers
    const handleDragStart = (e: React.DragEvent, instanceId: string) => {
        setDraggedInstanceId(instanceId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', instanceId);
        // Add a slight delay for the drag image to look right
        const target = e.currentTarget as HTMLElement;
        target.style.opacity = '0.5';
    };

    const handleDragEnd = (e: React.DragEvent) => {
        const target = e.currentTarget as HTMLElement;
        target.style.opacity = '1';
        setDraggedInstanceId(null);
        setDragOverNodeId(null);
    };

    const handleDragOver = (e: React.DragEvent, nodeId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverNodeId(nodeId);
    };

    const handleDragLeave = () => {
        setDragOverNodeId(null);
    };

    const handleDrop = (e: React.DragEvent, targetNodeId: string) => {
        e.preventDefault();
        setDragOverNodeId(null);

        const instanceId = e.dataTransfer.getData('text/plain');
        if (!instanceId) return;

        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return;

        // Handle reopen: dragging from COMPLETED/REJECTED back to a step
        if (instance.status === WorkflowInstanceStatus.COMPLETED || instance.status === WorkflowInstanceStatus.REJECTED) {
            // Only admin can reopen
            if (user.role !== Role.ADMIN) return;
            const targetIdx = orderedColumns.findIndex(c => c.id === targetNodeId);
            if (targetIdx === -1) return;
            setShowConfirmDrag({ instanceId, targetNodeId, action: WorkflowInstanceAction.REVISION_REQUESTED, isReopen: true });
            return;
        }

        if (!instance.currentNodeId) return;

        // Can only move to adjacent nodes
        const currentIdx = orderedColumns.findIndex(c => c.id === instance.currentNodeId);
        const targetIdx = orderedColumns.findIndex(c => c.id === targetNodeId);

        if (currentIdx === -1 || targetIdx === -1) return;
        if (targetIdx === currentIdx) return; // No change

        // Determine the action based on direction
        let action: WorkflowInstanceAction;
        if (targetIdx === currentIdx + 1) {
            action = WorkflowInstanceAction.APPROVED;
        } else if (targetIdx < currentIdx) {
            action = WorkflowInstanceAction.REVISION_REQUESTED;
        } else {
            // Can't skip steps
            return;
        }

        // Check permission
        const currentNode = orderedColumns[currentIdx];
        const canAct = user.role === Role.ADMIN ||
            currentNode.config.assigneeUserId === user.id ||
            currentNode.config.assigneeRole === user.role;

        if (!canAct) return;

        // Show confirmation dialog
        setShowConfirmDrag({ instanceId, targetNodeId, action });
    };

    const confirmDragAction = async () => {
        if (!showConfirmDrag) return;
        if (showConfirmDrag.isReopen) {
            // Reopen the instance to the target node
            await reopenInstance(showConfirmDrag.instanceId, showConfirmDrag.targetNodeId, user.id, dragComment || 'Mở lại từ Kanban board');
        } else {
            await onDragComplete(showConfirmDrag.instanceId, showConfirmDrag.action, dragComment, dragAssigneeId || undefined);
        }
        setShowConfirmDrag(null);
        setDragComment('');
        setDragAssigneeId('');
    };

    const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || 'N/A';

    const getAssigneeName = (node: WorkflowNode) => {
        if (node.config.assigneeUserId) {
            return users.find(u => u.id === node.config.assigneeUserId)?.name || 'User';
        }
        if (node.config.assigneeRole) return node.config.assigneeRole;
        return '';
    };

    const getColumnColor = (idx: number, total: number) => {
        const colors = [
            { header: 'from-slate-500 to-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/40', border: 'border-slate-200 dark:border-slate-700' },
            { header: 'from-blue-500 to-blue-600', bg: 'bg-blue-50/30 dark:bg-blue-900/10', border: 'border-blue-200/50 dark:border-blue-800/30' },
            { header: 'from-amber-500 to-orange-500', bg: 'bg-amber-50/30 dark:bg-amber-900/10', border: 'border-amber-200/50 dark:border-amber-800/30' },
            { header: 'from-purple-500 to-violet-500', bg: 'bg-purple-50/30 dark:bg-purple-900/10', border: 'border-purple-200/50 dark:border-purple-800/30' },
            { header: 'from-cyan-500 to-teal-500', bg: 'bg-cyan-50/30 dark:bg-cyan-900/10', border: 'border-cyan-200/50 dark:border-cyan-800/30' },
            { header: 'from-pink-500 to-rose-500', bg: 'bg-pink-50/30 dark:bg-pink-900/10', border: 'border-pink-200/50 dark:border-pink-800/30' },
        ];
        return colors[idx % colors.length];
    };

    // Actionable columns (not START, not END)
    const actionableColumns = orderedColumns.filter(
        n => n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END
    );

    const formatTimeAgo = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        if (days > 0) return `${days} ngày`;
        if (hours > 0) return `${hours} giờ`;
        return 'Vừa xong';
    };

    // Filter: only show columns that are actionable steps (skip START/END)
    const visibleColumns = [
        ...actionableColumns,
        // Virtual completed column
        { id: '__COMPLETED__', label: 'Hoàn thành', type: 'virtual' as any, config: {}, templateId, positionX: 0, positionY: 0 },
        { id: '__REJECTED__', label: 'Thất bại', type: 'virtual' as any, config: {}, templateId, positionX: 0, positionY: 0 },
    ].filter(col => {
        // Always show actionable columns, hide empty virtual columns
        if (col.id === '__COMPLETED__' || col.id === '__REJECTED__') {
            return (columnData.get(col.id) || []).length > 0;
        }
        return true;
    });

    return (
        <div className="relative">
            {/* Board Container */}
            <div className="flex gap-4 overflow-x-auto pb-4 px-1" style={{ minHeight: '60vh' }}>
                {visibleColumns.map((col, colIdx) => {
                    const colInstances = columnData.get(col.id) || [];
                    const isVirtual = col.id.startsWith('__');
                    const isDragTarget = dragOverNodeId === col.id;
                    const colColor = isVirtual
                        ? col.id === '__COMPLETED__'
                            ? { header: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50/30 dark:bg-emerald-900/10', border: 'border-emerald-200/50 dark:border-emerald-800/30' }
                            : { header: 'from-red-500 to-red-600', bg: 'bg-red-50/30 dark:bg-red-900/10', border: 'border-red-200/50 dark:border-red-800/30' }
                        : getColumnColor(colIdx + 1, visibleColumns.length);

                    return (
                        <div
                            key={col.id}
                            className={`flex flex-col rounded-2xl overflow-hidden border transition-all duration-200 shrink-0 ${colColor.border} ${isDragTarget ? 'ring-2 ring-indigo-400 ring-offset-2 scale-[1.01]' : ''}`}
                            style={{ width: '320px', maxHeight: 'calc(100vh - 250px)' }}
                            onDragOver={isVirtual ? undefined : (e) => handleDragOver(e, col.id)}
                            onDragLeave={isVirtual ? undefined : handleDragLeave}
                            onDrop={isVirtual ? undefined : (e) => handleDrop(e, col.id)}
                        >
                            {/* Column Header */}
                            <div className={`px-4 py-3 bg-gradient-to-r ${colColor.header} text-white`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-black uppercase tracking-wider">{col.label}</span>
                                    </div>
                                    <span className="text-[10px] font-bold bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full">
                                        {colInstances.length}
                                    </span>
                                </div>
                                {!isVirtual && (col as WorkflowNode).config.assigneeRole && (
                                    <div className="flex items-center gap-1 mt-1 text-[10px] text-white/70">
                                        <User size={9} />
                                        <span>{getAssigneeName(col as WorkflowNode)}</span>
                                        {(col as WorkflowNode).config.slaHours && (
                                            <span className="ml-1 bg-white/10 px-1.5 rounded text-[9px]">
                                                SLA: {(col as WorkflowNode).config.slaHours}h
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Cards Container */}
                            <div className={`flex-1 overflow-y-auto p-2.5 space-y-2.5 ${colColor.bg} ${isDragTarget ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}>
                                {colInstances.length === 0 && (
                                    <div className={`flex flex-col items-center justify-center py-10 text-slate-300 dark:text-slate-600 transition-all ${isDragTarget ? 'opacity-100' : 'opacity-50'}`}>
                                        <FileText size={28} className="mb-2" />
                                        <p className="text-[10px] font-bold uppercase tracking-wider">
                                            {isDragTarget ? 'Thả vào đây' : 'Không có phiếu'}
                                        </p>
                                    </div>
                                )}

                                {colInstances.map(instance => {
                                    const creator = users.find(u => u.id === instance.createdBy);
                                    const isDragging = draggedInstanceId === instance.id;
                                    const instanceLogs = getInstanceLogs(instance.id);
                                    const lastLog = instanceLogs[instanceLogs.length - 1];
                                    const hasFiles = Object.keys(instance.formData || {}).some(k => {
                                        const v = instance.formData[k];
                                        return v && typeof v === 'object' && v.fileName;
                                    });
                                    const sla = !isVirtual ? getSlaInfo(instance, col as WorkflowNode) : null;

                                    return (
                                        <div
                                            key={instance.id}
                                            draggable={instance.status === WorkflowInstanceStatus.RUNNING || ((instance.status === WorkflowInstanceStatus.COMPLETED || instance.status === WorkflowInstanceStatus.REJECTED) && user.role === Role.ADMIN)}
                                            onDragStart={e => handleDragStart(e, instance.id)}
                                            onDragEnd={handleDragEnd}
                                            onClick={() => onCardClick(instance)}
                                            className={`group rounded-xl border-l-4 bg-white dark:bg-slate-800 shadow-sm hover:shadow-lg cursor-pointer transition-all duration-200 ${STATUS_COLORS[instance.status]} ${isDragging ? 'opacity-50 scale-95 rotate-1' : 'hover:-translate-y-0.5'}`}
                                        >
                                            {/* Card Content */}
                                            <div className="p-3.5">
                                                {/* Title + Code */}
                                                <div className="flex items-start gap-2 mb-2">
                                                    {(instance.status === WorkflowInstanceStatus.RUNNING || instance.status === WorkflowInstanceStatus.COMPLETED || instance.status === WorkflowInstanceStatus.REJECTED) && (
                                                        <GripVertical size={14} className="text-slate-300 dark:text-slate-600 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="text-[13px] font-bold text-slate-800 dark:text-white leading-tight line-clamp-2">
                                                            {instance.title}
                                                        </h4>
                                                        <span className="font-mono text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-0.5 block">
                                                            {instance.code}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Meta info */}
                                                <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
                                                    <span className="flex items-center gap-1">
                                                        <User size={9} />
                                                        <span className="truncate max-w-[80px]">{creator?.name || 'N/A'}</span>
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Clock size={9} />
                                                        {formatTimeAgo(instance.updatedAt || instance.createdAt)}
                                                    </span>
                                                    {hasFiles && (
                                                        <Paperclip size={9} className="text-rose-400" />
                                                    )}
                                                </div>

                                                {/* SLA Warning */}
                                                {sla && (sla.isOverdue || sla.isUrgent) && (
                                                    <div className={`mt-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg ${sla.isOverdue
                                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                                                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-500'
                                                    }`}>
                                                        <AlertCircle size={10} />
                                                        {sla.isOverdue
                                                            ? `Quá hạn ${Math.abs(Math.floor(sla.hoursLeft))}h`
                                                            : `Còn ${Math.floor(sla.hoursLeft)}h`
                                                        }
                                                    </div>
                                                )}

                                                {/* Last comment preview */}
                                                {lastLog?.comment && (
                                                    <div className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-700/30 rounded-lg px-2.5 py-1.5">
                                                        <MessageSquare size={10} className="shrink-0 mt-0.5 text-slate-300" />
                                                        <span className="line-clamp-2 italic">{lastLog.comment}</span>
                                                    </div>
                                                )}

                                                {/* Form data badges */}
                                                {instance.formData && (
                                                    <div className="mt-2 flex flex-wrap gap-1">
                                                        {Object.entries(instance.formData)
                                                            .filter(([k, v]) => !k.startsWith('step_') && k !== 'note' && typeof v === 'string' && v.length > 0 && v.length < 50)
                                                            .slice(0, 3)
                                                            .map(([k, v]) => (
                                                                <span key={k} className="text-[9px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                                                                    {v as string}
                                                                </span>
                                                            ))
                                                        }
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Column Footer */}
                            <div className={`px-4 py-2 border-t ${colColor.border} bg-white/60 dark:bg-slate-800/60`}>
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                                    {colInstances.length} phiếu
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Drag Confirm Modal */}
            {showConfirmDrag && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                            <ArrowRight size={16} className="text-indigo-500" />
                            Xác nhận chuyển bước
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                            {showConfirmDrag.isReopen
                                ? `Bạn sẽ MỞ LẠI phiếu này và đưa về bước "${orderedColumns.find(c => c.id === showConfirmDrag.targetNodeId)?.label || 'đã chọn'}".`
                                : showConfirmDrag.action === WorkflowInstanceAction.APPROVED
                                    ? 'Bạn sẽ DUYỆT phiếu này và chuyển sang bước tiếp theo.'
                                    : 'Bạn sẽ YÊU CẦU BỔ SUNG và trả phiếu về bước trước.'
                            }
                        </p>

                        {/* Assign to user */}
                        <div className="mb-4">
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                <User size={11} className="inline mr-1" />Giao cho
                            </label>
                            <select
                                value={dragAssigneeId}
                                onChange={e => setDragAssigneeId(e.target.value)}
                                className="w-full p-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-indigo-300"
                            >
                                <option value="">-- Giữ nguyên người phụ trách --</option>
                                {users
                                    .filter(u => u.isActive !== false)
                                    .map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.name} {u.role ? `(${u.role})` : ''}
                                        </option>
                                    ))
                                }
                            </select>
                        </div>

                        <textarea
                            placeholder="Nhập ghi chú (tùy chọn)..."
                            value={dragComment}
                            onChange={e => setDragComment(e.target.value)}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-indigo-300 resize-none mb-4"
                            rows={3}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setShowConfirmDrag(null); setDragComment(''); setDragAssigneeId(''); }}
                                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 transition"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={confirmDragAction}
                                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition shadow-lg ${showConfirmDrag.isReopen
                                    ? 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/25'
                                    : showConfirmDrag.action === WorkflowInstanceAction.APPROVED
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25'
                                        : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25'
                                }`}
                            >
                                {showConfirmDrag.isReopen ? '↻ Mở lại' : showConfirmDrag.action === WorkflowInstanceAction.APPROVED ? '✓ Duyệt' : '↩ Yêu cầu bổ sung'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KanbanBoard;
