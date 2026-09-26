import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useWorkflow } from '../context/WorkflowContext';
import { useApp } from '../context/AppContext';
import {
    WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceAction,
    WorkflowNodeType, Role, WorkflowNode, Employee, OrgUnit
} from '../types';
import {
    Clock, User, GripVertical, AlertCircle, MessageSquare,
    Paperclip, FileText, Lock, Users2
} from 'lucide-react';
import {
    canUserActOnWorkflowStep,
    getWorkflowAssigneeDisplay,
    getWorkflowStepSelectionMode,
    isWorkflowStepAssignedToUser,
    resolveCurrentWorkflowAssignees,
    resolveWorkflowStepAssigneeCandidates,
} from '../lib/workflowAssignmentResolver';
import { canPerform } from '../lib/permissions/permissionService';

// Left accent stripe per instance status. Base keeps the card body neutral and
// reserves strong colour for the deadline state (see resolveCardTone below).
const STATUS_STRIPE: Record<WorkflowInstanceStatus, string> = {
    DRAFT: '#f59e0b',
    RUNNING: '#3b82f6',
    COMPLETED: '#4caf50',
    REJECTED: '#e74c3c',
    CANCELLED: '#94a3b8',
};

type CardTone = 'normal' | 'urgent' | 'overdue';

// Base signals an at-risk card through the left stripe + a badge, not by
// flooding the whole card, so a board full of late tickets stays readable.
const CARD_STRIPE_WIDTH: Record<CardTone, string> = {
    normal: '3px',
    urgent: '5px',
    overdue: '5px',
};

const formatDuration = (hours: number) => {
    const totalMinutes = Math.max(0, Math.round(Math.abs(hours) * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const remHours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    if (remHours > 0) return minutes > 0 ? `${remHours}h${minutes}m` : `${remHours}h`;
    return `${minutes}m`;
};

const formatSlaHours = (hours: number) => `${hours.toFixed(2)}h`;

interface KanbanBoardProps {
    templateId: string;
    instances: WorkflowInstance[];
    employees?: Employee[];
    orgUnits?: OrgUnit[];
    onCardClick: (instance: WorkflowInstance) => void;
    onDragComplete: (instanceId: string, action: WorkflowInstanceAction, comment: string, assigneeIds?: string[]) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ templateId, instances, employees = [], orgUnits = [], onCardClick, onDragComplete }) => {
    const { templates, nodes, edges, logs, getInstanceLogs, processInstance, reopenInstance } = useWorkflow();
    const { user, users } = useApp();
    const canReopenWorkflowInstance = user.role === Role.ADMIN
        || canPerform(user, 'workflow.instance.reopen', { scopeType: 'global', scopeId: '*' });

    const [draggedInstanceId, setDraggedInstanceId] = useState<string | null>(null);
    const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
    const [showConfirmDrag, setShowConfirmDrag] = useState<{
        instanceId: string;
        targetNodeId: string;
        action: WorkflowInstanceAction;
        isReopen?: boolean;
        /** Approving the last actionable step, i.e. dropping onto "Hoàn thành". */
        isFinish?: boolean;
    } | null>(null);
    const [dragComment, setDragComment] = useState('');
    const [dragAssigneeIds, setDragAssigneeIds] = useState<string[]>([]);
    // A refused drop used to be a bare `return`, so a blocked board looked
    // identical to a broken one. Surface the reason instead.
    const [dropNotice, setDropNotice] = useState<string | null>(null);

    const rejectDrop = useCallback((reason: string) => {
        setDropNotice(reason);
    }, []);

    useEffect(() => {
        if (!dropNotice) return;
        const timer = window.setTimeout(() => setDropNotice(null), 4000);
        return () => window.clearTimeout(timer);
    }, [dropNotice]);

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

    const template = useMemo(
        () => templates.find(t => t.id === templateId) || null,
        [templates, templateId],
    );

    // Base renders form data as one dense "label: value · label: value" paragraph
    // instead of scattered chips, which keeps cards short and scannable.
    const buildMetaSummary = useCallback((instance: WorkflowInstance) => {
        const formData = instance.formData || {};
        const fields = template?.customFields || [];
        const parts: string[] = [];

        const describeValue = (value: unknown): string | null => {
            if (value === null || value === undefined) return null;
            if (typeof value === 'string') return value.trim() || null;
            if (typeof value === 'number') return String(value);
            if (typeof value === 'boolean') return value ? 'Có' : 'Không';
            if (Array.isArray(value)) return value.length ? `${value.length} dòng` : null;
            if (typeof value === 'object') {
                const fileName = (value as { fileName?: string }).fileName;
                if (fileName) return '[FILE]';
                return null;
            }
            return null;
        };

        fields.forEach(field => {
            if (parts.length >= 4) return;
            const described = describeValue(formData[field.name]);
            if (described) parts.push(`${field.label}: ${described}`);
        });

        // Templates without declared custom fields still get a summary.
        if (parts.length === 0) {
            Object.entries(formData)
                .filter(([key]) => !key.startsWith('step_'))
                .slice(0, 3)
                .forEach(([key, value]) => {
                    const described = describeValue(value);
                    if (described) parts.push(`${key}: ${described}`);
                });
        }

        return parts.join(' · ');
    }, [template]);

    const resolveCardTone = (
        sla: { isOverdue: boolean; isUrgent: boolean } | null,
        unassigned: boolean,
    ): CardTone => {
        if (sla?.isOverdue || unassigned) return 'overdue';
        if (sla?.isUrgent) return 'urgent';
        return 'normal';
    };

    // Header stats mirror Base: "<assigned>/<total> NV · <n> Q.hạn" plus the step SLA.
    const getColumnStats = useCallback((col: WorkflowNode, colInstances: WorkflowInstance[]) => {
        let assignedCount = 0;
        let overdueCount = 0;
        const avatarUserIds = new Set<string>();

        colInstances.forEach(instance => {
            const assignees = resolveCurrentWorkflowAssignees(instance, col, users);
            if (assignees.length > 0) {
                assignedCount += 1;
                assignees.forEach(assignee => avatarUserIds.add(assignee.id));
            }
            if (getSlaInfo(instance, col)?.isOverdue) overdueCount += 1;
        });

        return {
            assignedCount,
            totalCount: colInstances.length,
            overdueCount,
            avatarUsers: Array.from(avatarUserIds)
                .map(id => users.find(u => u.id === id))
                .filter((u): u is NonNullable<typeof u> => Boolean(u)),
        };
    }, [users, getInstanceLogs]);

    // Actionable columns (not START, not END) — the only real step lanes.
    const actionableColumns = useMemo(
        () => orderedColumns.filter(
            n => n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END
        ),
        [orderedColumns],
    );

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
            if (!canReopenWorkflowInstance) {
                rejectDrop('Bạn không có quyền mở lại nhiệm vụ đã kết thúc.');
                return;
            }
            const targetIdx = actionableColumns.findIndex(c => c.id === targetNodeId);
            if (targetIdx === -1) {
                rejectDrop('Chỉ có thể mở lại về một giai đoạn xử lý.');
                return;
            }
            setShowConfirmDrag({ instanceId, targetNodeId, action: WorkflowInstanceAction.REVISION_REQUESTED, isReopen: true });
            return;
        }

        if (instance.status !== WorkflowInstanceStatus.RUNNING) {
            rejectDrop('Chỉ nhiệm vụ đang chạy mới chuyển được giai đoạn.');
            return;
        }

        if (!instance.currentNodeId) {
            rejectDrop('Nhiệm vụ chưa ở giai đoạn nào để chuyển.');
            return;
        }

        const currentIdx = actionableColumns.findIndex(c => c.id === instance.currentNodeId);
        if (currentIdx === -1) {
            rejectDrop('Không xác định được giai đoạn hiện tại của nhiệm vụ.');
            return;
        }
        const currentNode = actionableColumns[currentIdx];

        // The permission gate must not be stricter than the DB's own check
        // (process_workflow_instance_fast -> v_can_act), otherwise the board
        // silently blocks template managers and returned creators that the
        // backend would accept. Mirror the list view instead.
        const canAct = canUserActOnWorkflowStep({
            instance,
            node: currentNode,
            user,
            templateManagerIds: template?.managers,
            firstTaskNodeId: actionableColumns[0]?.id,
            logs: getInstanceLogs(instance.id),
        });
        if (!canAct) {
            rejectDrop('Bạn không phải người được phân công xử lý giai đoạn hiện tại.');
            return;
        }

        const hasAssignedAction = user.role === Role.ADMIN
            || (template?.managers || []).includes(user.id)
            || canPerform(user, 'workflow.instance.act_assigned', {
                scopeType: 'assigned',
                scopeId: user.id,
            })
            || canPerform(user, 'workflow.instance.act_assigned', {
                scopeType: 'global',
                scopeId: '*',
            });
        if (!hasAssignedAction) {
            rejectDrop('Tài khoản của bạn chưa được cấp quyền xử lý nhiệm vụ quy trình.');
            return;
        }

        // Dropping onto the terminal "Hoàn thành" lane approves the last step
        // into END — previously there was no drop target for finishing a card.
        if (targetNodeId === '__COMPLETED__') {
            if (currentIdx !== actionableColumns.length - 1) {
                rejectDrop('Chỉ giai đoạn cuối mới kết thúc được nhiệm vụ. Hãy chuyển lần lượt từng giai đoạn.');
                return;
            }
            setShowConfirmDrag({ instanceId, targetNodeId, action: WorkflowInstanceAction.APPROVED, isFinish: true });
            return;
        }

        if (targetNodeId === '__REJECTED__') {
            rejectDrop('Dùng nút Từ chối trong chi tiết nhiệm vụ để đánh dấu thất bại.');
            return;
        }

        const targetIdx = actionableColumns.findIndex(c => c.id === targetNodeId);
        if (targetIdx === -1) return;
        if (targetIdx === currentIdx) return; // No change

        // Forward: exactly one step. Backward: exactly one step too — the RPC
        // walks a single incoming edge for REVISION_REQUESTED and ignores any
        // target we send, so allowing a multi-column drag would lie to the user.
        let action: WorkflowInstanceAction;
        if (targetIdx === currentIdx + 1) {
            action = WorkflowInstanceAction.APPROVED;
        } else if (targetIdx === currentIdx - 1) {
            action = WorkflowInstanceAction.REVISION_REQUESTED;
        } else if (targetIdx > currentIdx) {
            rejectDrop('Không thể bỏ qua giai đoạn. Chỉ chuyển sang giai đoạn liền kề.');
            return;
        } else {
            rejectDrop(`Chỉ trả về được giai đoạn liền trước ("${actionableColumns[currentIdx - 1]?.label || '—'}").`);
            return;
        }

        setShowConfirmDrag({ instanceId, targetNodeId, action });
    };

    const confirmDragAction = async () => {
        if (!showConfirmDrag) return;
        if (showConfirmDrag.isReopen) {
            // Reopen the instance to the target node
            await reopenInstance(showConfirmDrag.instanceId, showConfirmDrag.targetNodeId, user.id, dragComment || 'Mở lại từ Kanban board');
        } else {
            await onDragComplete(showConfirmDrag.instanceId, showConfirmDrag.action, dragComment, dragAssigneeIds);
        }
        setShowConfirmDrag(null);
        setDragComment('');
        setDragAssigneeIds([]);
    };

    // Base uses one neutral column chrome for every step; the only coloured
    // column accents are the terminal Completed / Rejected lanes.
    const getColumnAccent = (colId: string) => {
        if (colId === '__COMPLETED__') return 'var(--wf-green)';
        if (colId === '__REJECTED__') return 'var(--wf-overdue)';
        return 'var(--wf-border-strong)';
    };

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
        // "Hoàn thành" stays visible even when empty: it is the drop target that
        // finishes the last step. "Thất bại" is only chrome, so hide it if empty.
        if (col.id === '__COMPLETED__') return actionableColumns.length > 0;
        if (col.id === '__REJECTED__') return (columnData.get(col.id) || []).length > 0;
        return true;
    });

    const dragTargetNode = useMemo(() => {
        if (!showConfirmDrag) return null;
        return orderedColumns.find(c => c.id === showConfirmDrag.targetNodeId) || null;
    }, [orderedColumns, showConfirmDrag]);

    const dragTargetInstance = useMemo(() => {
        if (!showConfirmDrag) return null;
        return instances.find(i => i.id === showConfirmDrag.instanceId) || null;
    }, [instances, showConfirmDrag]);

    const dragCandidates = useMemo(() => {
        if (!dragTargetNode || !dragTargetInstance || showConfirmDrag?.isReopen) return [];
        return resolveWorkflowStepAssigneeCandidates({
            node: dragTargetNode,
            instance: dragTargetInstance,
            users,
            employees,
            orgUnits,
            logs,
        });
    }, [dragTargetNode, dragTargetInstance, showConfirmDrag?.isReopen, users, employees, orgUnits, logs]);

    // Base shows how long the card sat in the stage it is leaving. Read-only —
    // derived from the latest log entry for the current step, never user input.
    const stageDurationLabel = useMemo(() => {
        if (!dragTargetInstance) return 'Chưa xác định';
        const currentNodeId = dragTargetInstance.currentNodeId;
        const instanceLogs = getInstanceLogs(dragTargetInstance.id);
        const enteredLog = instanceLogs
            .filter(l => (currentNodeId ? l.nodeId === currentNodeId : true))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const startedAt = enteredLog?.createdAt || dragTargetInstance.createdAt;
        if (!startedAt) return 'Chưa xác định';
        const hours = (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60);
        return `${formatDuration(hours)} trong giai đoạn hiện tại`;
    }, [dragTargetInstance, getInstanceLogs]);

    const dragSelectionMode = getWorkflowStepSelectionMode(dragTargetNode);
    // Finishing into END has no next stage, so it needs no assignee.
    const mustChooseDragAssignee = Boolean(
        showConfirmDrag &&
        !showConfirmDrag.isReopen &&
        !showConfirmDrag.isFinish &&
        dragTargetNode &&
        dragTargetNode.type !== WorkflowNodeType.END
    );

    const toggleDragAssignee = (candidateId: string) => {
        setDragAssigneeIds(prev => {
            if (dragSelectionMode === 'single') {
                return prev[0] === candidateId ? [] : [candidateId];
            }
            return prev.includes(candidateId)
                ? prev.filter(id => id !== candidateId)
                : [...prev, candidateId];
        });
    };

    return (
        <div className="wf-base relative h-full min-h-[60vh]">
            {/* Board Container */}
            <div className="wf-scroll wf-canvas flex h-full items-start gap-3 overflow-x-auto pb-2">
                {visibleColumns.map(col => {
                    const colInstances = columnData.get(col.id) || [];
                    const isVirtual = col.id.startsWith('__');
                    const isDragTarget = dragOverNodeId === col.id;
                    const accent = getColumnAccent(col.id);
                    const node = isVirtual ? null : (col as WorkflowNode);
                    const stats = node ? getColumnStats(node, colInstances) : null;
                    const slaHours = node?.config.slaHours;

                    return (
                        <div
                            key={col.id}
                            className="wf-surface flex shrink-0 flex-col overflow-hidden rounded-lg border"
                            style={{
                                width: '308px',
                                maxHeight: '100%',
                                borderColor: isDragTarget ? 'var(--wf-green)' : 'var(--wf-border)',
                                borderTop: `3px solid ${accent}`,
                            }}
                            onDragOver={(e) => handleDragOver(e, col.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, col.id)}
                        >
                            {/* Column Header — neutral chrome, stats-driven like Base */}
                            <div
                                className="wf-surface shrink-0 border-b px-3 pb-1.5 pt-2.5"
                                style={{ borderColor: 'var(--wf-border)' }}
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className="min-w-0 flex-1 truncate text-[13px] font-semibold"
                                        style={{ color: 'var(--wf-text)' }}
                                        title={col.label}
                                    >
                                        {col.label}
                                    </span>

                                    {/* Stacked assignee avatars */}
                                    {stats && stats.avatarUsers.length > 0 && (
                                        <div className="flex shrink-0 -space-x-1.5">
                                            {stats.avatarUsers.slice(0, 3).map(assignee => (
                                                <div
                                                    key={assignee.id}
                                                    title={assignee.name}
                                                    className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 text-[8px] font-bold uppercase text-white"
                                                    style={{
                                                        borderColor: 'var(--wf-surface)',
                                                        backgroundColor: 'var(--wf-green-dark)',
                                                    }}
                                                >
                                                    {assignee.avatar
                                                        ? <img src={assignee.avatar} alt={assignee.name} className="h-full w-full object-cover" />
                                                        : assignee.name.slice(0, 2)}
                                                </div>
                                            ))}
                                            {stats.avatarUsers.length > 3 && (
                                                <div
                                                    className="flex h-5 w-5 items-center justify-center rounded-full border-2 text-[8px] font-bold"
                                                    style={{
                                                        borderColor: 'var(--wf-surface)',
                                                        backgroundColor: 'var(--wf-column)',
                                                        color: 'var(--wf-text-muted)',
                                                    }}
                                                >
                                                    +{stats.avatarUsers.length - 3}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <span
                                        className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
                                        style={{ backgroundColor: 'var(--wf-column)', color: 'var(--wf-text-muted)' }}
                                    >
                                        {colInstances.length}
                                    </span>
                                </div>

                                {/* Stats row: assigned / total · overdue count — step SLA on the right */}
                                <div
                                    className="mt-1 flex items-center justify-between text-[10px]"
                                    style={{ color: 'var(--wf-text-faint)' }}
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        {stats ? (
                                            <>
                                                <span className="flex items-center gap-1">
                                                    <Users2 size={9} />
                                                    {stats.assignedCount}/{stats.totalCount} NV
                                                </span>
                                                {stats.overdueCount > 0 && (
                                                    <span
                                                        className="font-semibold"
                                                        style={{ color: 'var(--wf-overdue-text)' }}
                                                    >
                                                        · {stats.overdueCount} Q.hạn
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span>{col.id === '__COMPLETED__' ? 'Đã hoàn thành' : 'Đã từ chối'}</span>
                                        )}
                                    </span>
                                    {slaHours ? (
                                        <span className="flex shrink-0 items-center gap-1">
                                            <Clock size={9} />
                                            {formatSlaHours(slaHours)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            {/* Cards Container */}
                            <div
                                className={`wf-scroll wf-column-bg flex-1 space-y-2 overflow-y-auto p-2 ${isDragTarget ? 'wf-drop-active' : ''}`}
                            >
                                {colInstances.length === 0 && (
                                    <div
                                        className="flex flex-col items-center justify-center py-10"
                                        style={{ color: 'var(--wf-text-faint)', opacity: isDragTarget ? 1 : 0.6 }}
                                    >
                                        <FileText size={24} className="mb-2 opacity-60" />
                                        <p className="text-[11px] font-medium">
                                            {isDragTarget ? 'Thả vào đây' : 'Không có nhiệm vụ'}
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
                                    const currentAssignees = resolveCurrentWorkflowAssignees(
                                        instance,
                                        isVirtual ? null : col as WorkflowNode,
                                        users,
                                    );
                                    const currentAssigneeDisplay = getWorkflowAssigneeDisplay(currentAssignees);
                                    const isRunning = instance.status === WorkflowInstanceStatus.RUNNING;
                                    const isUnassigned = !isVirtual && isRunning && currentAssignees.length === 0;
                                    const tone = resolveCardTone(sla, isUnassigned);
                                    const metaSummary = buildMetaSummary(instance);
                                    const canDragCard = isRunning
                                        || ((instance.status === WorkflowInstanceStatus.COMPLETED
                                            || instance.status === WorkflowInstanceStatus.REJECTED)
                                            && canReopenWorkflowInstance);

                                    return (
                                        <div
                                            key={instance.id}
                                            draggable={canDragCard}
                                            onDragStart={e => handleDragStart(e, instance.id)}
                                            onDragEnd={handleDragEnd}
                                            onClick={() => onCardClick(instance)}
                                            className={`wf-card wf-surface group cursor-pointer rounded-md border ${isDragging ? 'wf-card-dragging' : ''}`}
                                            style={{
                                                borderColor: tone === 'overdue'
                                                    ? 'var(--wf-overdue)'
                                                    : tone === 'urgent'
                                                        ? 'var(--wf-urgent)'
                                                        : 'var(--wf-border)',
                                                borderLeftWidth: CARD_STRIPE_WIDTH[tone],
                                                borderLeftColor: tone === 'overdue'
                                                    ? 'var(--wf-overdue)'
                                                    : tone === 'urgent'
                                                        ? 'var(--wf-urgent)'
                                                        : STATUS_STRIPE[instance.status],
                                            }}
                                        >
                                            <div className="px-2.5 py-2">
                                                {/* Title + code */}
                                                <div className="mb-1 flex items-start gap-1.5">
                                                    {canDragCard && (
                                                        <GripVertical
                                                            size={13}
                                                            className="mt-0.5 shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
                                                            style={{ color: 'var(--wf-text-faint)' }}
                                                        />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <h4
                                                            className="line-clamp-2 text-[13px] font-semibold leading-snug"
                                                            style={{ color: 'var(--wf-text)' }}
                                                        >
                                                            {instance.title}
                                                        </h4>
                                                        <span
                                                            className="mt-0.5 block font-mono text-[9px]"
                                                            style={{ color: 'var(--wf-text-faint)' }}
                                                        >
                                                            {instance.code}
                                                        </span>
                                                    </div>
                                                    {hasFiles && (
                                                        <Paperclip
                                                            size={11}
                                                            className="mt-0.5 shrink-0"
                                                            style={{ color: 'var(--wf-text-faint)' }}
                                                        />
                                                    )}
                                                </div>

                                                {/* Condensed field summary, Base-style */}
                                                {metaSummary && (
                                                    <p
                                                        className="line-clamp-3 text-[11px] leading-[1.45]"
                                                        style={{ color: 'var(--wf-text-muted)' }}
                                                    >
                                                        {metaSummary}
                                                    </p>
                                                )}

                                                {/* Last comment preview */}
                                                {lastLog?.comment && (
                                                    <p
                                                        className="mt-1 line-clamp-1 text-[10px] italic"
                                                        style={{ color: 'var(--wf-text-faint)' }}
                                                    >
                                                        <MessageSquare size={9} className="mr-1 inline" />
                                                        {lastLog.comment}
                                                    </p>
                                                )}

                                                {/* Unassigned warning + quick assign affordance */}
                                                {isUnassigned && (
                                                    <div className="mt-1.5 flex items-center justify-between gap-2">
                                                        <span
                                                            className="flex items-center gap-1 text-[10px] font-semibold"
                                                            style={{ color: 'var(--wf-overdue-text)' }}
                                                        >
                                                            <AlertCircle size={10} />
                                                            Chưa được giao
                                                        </span>
                                                        <span
                                                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                            style={{ backgroundColor: 'var(--wf-green)' }}
                                                        >
                                                            Mở để giao
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Footer: assignee left, deadline right */}
                                                <div
                                                    className="mt-1.5 flex items-center justify-between gap-2 border-t pt-1.5"
                                                    style={{ borderColor: 'var(--wf-border)' }}
                                                >
                                                    <span className="flex min-w-0 items-center gap-1.5">
                                                        {!isVirtual && isRunning && currentAssigneeDisplay.visibleAssignees.length > 0 ? (
                                                            <>
                                                                <span className="flex shrink-0 -space-x-1.5">
                                                                    {currentAssigneeDisplay.visibleAssignees.map(assignee => (
                                                                        <span
                                                                            key={assignee.id}
                                                                            className="flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded-full border text-[8px] font-bold uppercase text-white"
                                                                            style={{
                                                                                borderColor: 'var(--wf-surface)',
                                                                                backgroundColor: 'var(--wf-green-dark)',
                                                                            }}
                                                                        >
                                                                            {assignee.avatar
                                                                                ? <img src={assignee.avatar} alt={assignee.name} className="h-full w-full object-cover" />
                                                                                : assignee.name.slice(0, 2)}
                                                                        </span>
                                                                    ))}
                                                                </span>
                                                                <span
                                                                    className="truncate text-[10px]"
                                                                    style={{ color: 'var(--wf-text-muted)' }}
                                                                    title={currentAssigneeDisplay.label}
                                                                >
                                                                    {currentAssigneeDisplay.label}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span
                                                                className="flex items-center gap-1 truncate text-[10px]"
                                                                style={{ color: 'var(--wf-text-faint)' }}
                                                            >
                                                                <User size={9} />
                                                                {creator?.name || 'N/A'}
                                                            </span>
                                                        )}
                                                    </span>

                                                    {sla ? (
                                                        <span
                                                            className="flex shrink-0 items-center gap-1 text-[10px] font-semibold"
                                                            style={{
                                                                color: sla.isOverdue
                                                                    ? 'var(--wf-overdue-text)'
                                                                    : sla.isUrgent
                                                                        ? 'var(--wf-urgent)'
                                                                        : 'var(--wf-text-faint)',
                                                            }}
                                                        >
                                                            {sla.isOverdue && <AlertCircle size={9} />}
                                                            {sla.isOverdue
                                                                ? `Quá hạn ${formatDuration(sla.hoursLeft)}`
                                                                : `Đến hạn trong ${formatDuration(sla.hoursLeft)}`}
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className="flex shrink-0 items-center gap-1 text-[10px]"
                                                            style={{ color: 'var(--wf-text-faint)' }}
                                                        >
                                                            <Clock size={9} />
                                                            {formatTimeAgo(instance.updatedAt || instance.createdAt)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Stage Transition Modal — Base layout: centred heading, boxed inputs,
                full-width primary action, plain "close" link underneath. */}
            {showConfirmDrag && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div
                        className="wf-base wf-surface wf-scroll max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-lg px-8 py-7 shadow-2xl"
                        style={{ backgroundColor: 'var(--wf-surface)' }}
                    >
                        <h3
                            className="text-center text-[22px] font-semibold leading-tight"
                            style={{ color: 'var(--wf-green-text)' }}
                        >
                            {showConfirmDrag.isReopen
                                ? 'Mở lại nhiệm vụ về giai đoạn trước'
                                : showConfirmDrag.isFinish
                                    ? 'Hoàn thành nhiệm vụ'
                                    : showConfirmDrag.action === WorkflowInstanceAction.APPROVED
                                        ? 'Chuyển nhiệm vụ sang giai đoạn tiếp theo'
                                        : 'Trả nhiệm vụ về giai đoạn trước'}
                        </h3>
                        <p
                            className="mx-auto mt-2 max-w-[520px] text-center text-[13px] leading-relaxed"
                            style={{ color: 'var(--wf-text-muted)' }}
                        >
                            {showConfirmDrag.isFinish ? (
                                <>
                                    Duyệt giai đoạn cuối sẽ kết thúc nhiệm vụ{' '}
                                    <strong style={{ color: 'var(--wf-text)' }}>
                                        {dragTargetInstance?.title || 'này'}
                                    </strong>{' '}
                                    và chuyển sang trạng thái <strong style={{ color: 'var(--wf-text)' }}>Hoàn thành</strong>.
                                </>
                            ) : (
                                <>
                                    Vui lòng hoàn thành các bước sau trước khi chuyển nhiệm vụ{' '}
                                    <strong style={{ color: 'var(--wf-text)' }}>
                                        {dragTargetInstance?.title || 'này'}
                                    </strong>{' '}
                                    đến <strong style={{ color: 'var(--wf-text)' }}>{dragTargetNode?.label || 'giai đoạn đã chọn'}</strong>.
                                </>
                            )}
                        </p>

                        <hr className="my-5" style={{ borderColor: 'var(--wf-border)' }} />

                        <p
                            className="mb-4 text-center text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: 'var(--wf-text-muted)' }}
                        >
                            {showConfirmDrag.isFinish ? 'Xác nhận kết thúc' : 'Đầu vào cho giai đoạn'}{' '}
                            <span
                                className="ml-1 rounded px-2 py-0.5 text-[11px] uppercase"
                                style={{ backgroundColor: 'var(--wf-column)', color: 'var(--wf-text)' }}
                            >
                                {showConfirmDrag.isFinish ? 'Hoàn thành' : dragTargetNode?.label || '—'}
                            </span>
                        </p>

                        {/* Field 1 — assignee pool for the target stage */}
                        {!showConfirmDrag.isReopen && dragTargetNode && dragTargetNode.type !== WorkflowNodeType.END && (
                            <div
                                className="mb-3 rounded border px-4 py-3"
                                style={{ borderColor: 'var(--wf-border-strong)' }}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <span
                                        className="text-[13px] font-semibold"
                                        style={{ color: 'var(--wf-text)' }}
                                    >
                                        Giao lại cho
                                    </span>
                                    <Lock size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--wf-text-faint)' }} />
                                </div>

                                {dragCandidates.length === 0 ? (
                                    <p
                                        className="mt-2 text-[12px] font-medium"
                                        style={{ color: 'var(--wf-overdue-text)' }}
                                    >
                                        Giai đoạn này chưa có người hợp lệ. Kiểm tra lại cài đặt bước trước khi chuyển.
                                    </p>
                                ) : (
                                    <>
                                        <p
                                            className="mt-1 text-[12px] leading-relaxed"
                                            style={{ color: 'var(--wf-text-faint)' }}
                                        >
                                            Người có thể được giao:{' '}
                                            {dragCandidates.slice(0, 4).map((candidate, idx) => (
                                                <span key={candidate.id}>
                                                    {idx > 0 && ', '}
                                                    {candidate.name}
                                                    {candidate.sublabel ? ` (${candidate.sublabel})` : ''}
                                                </span>
                                            ))}
                                            {dragCandidates.length > 4 && `, +${dragCandidates.length - 4} người khác`}
                                        </p>

                                        <div className="wf-scroll mt-2.5 max-h-44 space-y-1 overflow-y-auto">
                                            {dragCandidates.map(candidate => {
                                                const checked = dragAssigneeIds.includes(candidate.id);
                                                return (
                                                    <button
                                                        key={candidate.id}
                                                        type="button"
                                                        onClick={() => toggleDragAssignee(candidate.id)}
                                                        className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition"
                                                        style={{
                                                            backgroundColor: checked ? 'var(--wf-green-soft)' : 'transparent',
                                                        }}
                                                    >
                                                        <span
                                                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold text-white"
                                                            style={{
                                                                borderColor: checked ? 'var(--wf-green)' : 'var(--wf-border-strong)',
                                                                backgroundColor: checked ? 'var(--wf-green)' : 'transparent',
                                                            }}
                                                        >
                                                            {checked ? '✓' : ''}
                                                        </span>
                                                        <span className="min-w-0">
                                                            <span
                                                                className="block truncate text-[12px] font-medium"
                                                                style={{ color: 'var(--wf-text)' }}
                                                            >
                                                                {candidate.name}
                                                            </span>
                                                            {candidate.sublabel && (
                                                                <span
                                                                    className="block truncate text-[10px]"
                                                                    style={{ color: 'var(--wf-text-faint)' }}
                                                                >
                                                                    {candidate.sublabel}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {dragSelectionMode === 'multiple' && (
                                            <p
                                                className="mt-1.5 text-[11px]"
                                                style={{ color: 'var(--wf-text-faint)' }}
                                            >
                                                Có thể chọn nhiều người cho giai đoạn này.
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Field 2 — time spent in the stage being left */}
                        <div
                            className="mb-3 rounded border px-4 py-3"
                            style={{ borderColor: 'var(--wf-border-strong)' }}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <span
                                    className="text-[11px] font-semibold uppercase tracking-wide"
                                    style={{ color: 'var(--wf-text)' }}
                                >
                                    Duration
                                </span>
                                <Lock size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--wf-text-faint)' }} />
                            </div>
                            <p className="mt-1 text-[13px]" style={{ color: 'var(--wf-text-muted)' }}>
                                {stageDurationLabel}
                            </p>
                        </div>

                        {/* Field 3 — free-form handover note */}
                        <div
                            className="mb-5 rounded border px-4 py-3"
                            style={{ borderColor: 'var(--wf-border-strong)' }}
                        >
                            <label
                                className="block text-[13px] font-semibold"
                                style={{ color: 'var(--wf-text)' }}
                            >
                                Những việc đã hoàn thành?
                            </label>
                            <textarea
                                placeholder="Chia sẻ nhanh ghi chú về những gì đã hoàn thành trong giai đoạn trước đó"
                                value={dragComment}
                                onChange={e => setDragComment(e.target.value)}
                                rows={2}
                                className="mt-1 w-full resize-none bg-transparent text-[13px] outline-none"
                                style={{ color: 'var(--wf-text)' }}
                            />
                        </div>

                        <button
                            onClick={confirmDragAction}
                            disabled={mustChooseDragAssignee && dragAssigneeIds.length === 0}
                            className="w-full rounded py-3 text-[14px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ backgroundColor: 'var(--wf-green)' }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--wf-green-hover)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--wf-green)'; }}
                        >
                            {showConfirmDrag.isReopen
                                ? 'Mở lại nhiệm vụ'
                                : showConfirmDrag.isFinish
                                    ? 'Duyệt và hoàn thành nhiệm vụ'
                                    : showConfirmDrag.action === WorkflowInstanceAction.APPROVED
                                        ? 'Chuyển sang giai đoạn kế tiếp'
                                        : 'Trả về giai đoạn trước'}
                        </button>

                        <button
                            onClick={() => { setShowConfirmDrag(null); setDragComment(''); setDragAssigneeIds([]); }}
                            className="mx-auto mt-3 block text-[13px] transition hover:underline"
                            style={{ color: 'var(--wf-text-faint)' }}
                        >
                            Đóng lại
                        </button>
                    </div>
                </div>
            )}

            {/* Refused-drop feedback. Without this a blocked drag is
                indistinguishable from a broken one. */}
            {dropNotice && (
                <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-auto absolute bottom-4 left-1/2 z-[70] flex max-w-[460px] -translate-x-1/2 items-start gap-2 rounded-lg border px-4 py-3 shadow-lg"
                    style={{
                        backgroundColor: 'var(--wf-surface)',
                        borderColor: 'var(--wf-overdue)',
                        color: 'var(--wf-text)',
                    }}
                >
                    <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--wf-overdue-text)' }} />
                    <span className="text-[12px] font-medium leading-relaxed">{dropNotice}</span>
                    <button
                        type="button"
                        onClick={() => setDropNotice(null)}
                        className="ml-1 shrink-0 text-[12px] font-semibold transition hover:underline"
                        style={{ color: 'var(--wf-text-faint)' }}
                    >
                        Đóng
                    </button>
                </div>
            )}
        </div>
    );
};

export default KanbanBoard;
