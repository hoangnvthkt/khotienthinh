import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Clock, FileText, GripVertical, MessageSquare, Package, UserRound } from 'lucide-react';
import {
  InventoryItem,
  MaterialRequest,
  MaterialRequestEvent,
  MaterialRequestFulfillmentBatch,
  MaterialRequestFulfillmentSummary,
  MaterialRequestKanbanLaneId,
  MaterialRequestKanbanStage,
  ProjectWorkflowBoardFilter,
  ProjectWorkflowSubject,
  ProjectWorkBoqItem,
  Transaction,
  User,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRuntimeNode,
} from '../../types';
import {
  getMaterialRequestSlaState,
  MATERIAL_REQUEST_KANBAN_COLUMNS,
  resolveRequestKanbanStage,
} from '../../lib/materialRequestService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

interface MaterialRequestKanbanBoardProps {
  requests: MaterialRequest[];
  fulfillmentSummaries: Record<string, MaterialRequestFulfillmentSummary>;
  fulfillmentBatches: Record<string, MaterialRequestFulfillmentBatch[]>;
  eventsByRequest: Record<string, MaterialRequestEvent[]>;
  transactions: Transaction[];
  inventoryItemById: Map<string, InventoryItem>;
  workBoqItemById: Map<string, ProjectWorkBoqItem>;
  userById: Map<string, User>;
  workflowSubjectsByRequestId?: Record<string, ProjectWorkflowSubject>;
  workflowNodes?: WorkflowNode[];
  workflowRuntimeNodes?: WorkflowRuntimeNode[];
  currentUserId?: string;
  boardFilter?: ProjectWorkflowBoardFilter;
  searchTerm?: string;
  hideEmptyWorkflowLanes?: boolean;
  canMoveRequest: (request: MaterialRequest, toStage: MaterialRequestKanbanLaneId, fromStage: MaterialRequestKanbanLaneId) => boolean;
  onMoveRequest: (request: MaterialRequest, toStage: MaterialRequestKanbanLaneId, fromStage: MaterialRequestKanbanLaneId) => void;
  onOpenRequest: (request: MaterialRequest) => void;
}

const columnHeaderGradient: Record<MaterialRequestKanbanStage, string> = {
  draft: 'from-slate-500 to-slate-600',
  site_manager_review: 'from-amber-500 to-orange-500',
  material_department_review: 'from-blue-500 to-blue-600',
  batch_planning: 'from-indigo-500 to-violet-500',
  site_quality_check: 'from-orange-500 to-amber-500',
  site_receipt: 'from-cyan-500 to-teal-500',
  completed: 'from-emerald-500 to-emerald-600',
  closed: 'from-rose-500 to-red-600',
};

const columnBgTone: Record<MaterialRequestKanbanStage, string> = {
  draft: 'bg-slate-50/50 dark:bg-slate-900/40',
  site_manager_review: 'bg-amber-50/30 dark:bg-amber-900/10',
  material_department_review: 'bg-blue-50/30 dark:bg-blue-900/10',
  batch_planning: 'bg-indigo-50/30 dark:bg-indigo-900/10',
  site_quality_check: 'bg-orange-50/30 dark:bg-orange-900/10',
  site_receipt: 'bg-cyan-50/30 dark:bg-cyan-900/10',
  completed: 'bg-emerald-50/30 dark:bg-emerald-900/10',
  closed: 'bg-rose-50/30 dark:bg-rose-900/10',
};

const columnBorderTone: Record<MaterialRequestKanbanStage, string> = {
  draft: 'border-slate-200 dark:border-slate-700',
  site_manager_review: 'border-amber-200/50 dark:border-amber-800/30',
  material_department_review: 'border-blue-200/50 dark:border-blue-800/30',
  batch_planning: 'border-indigo-200/50 dark:border-indigo-800/30',
  site_quality_check: 'border-orange-200/50 dark:border-orange-800/30',
  site_receipt: 'border-cyan-200/50 dark:border-cyan-800/30',
  completed: 'border-emerald-200/50 dark:border-emerald-800/30',
  closed: 'border-rose-200/50 dark:border-rose-800/30',
};

const getHeaderGradient = (id: MaterialRequestKanbanLaneId) => {
  if (id.startsWith('workflow:')) return 'from-purple-500 to-violet-500';
  if (id === 'legacy_review') return 'from-amber-500 to-orange-500';
  return columnHeaderGradient[id as MaterialRequestKanbanStage] || 'from-slate-500 to-slate-600';
};

const getColumnBg = (id: MaterialRequestKanbanLaneId) => {
  if (id.startsWith('workflow:')) return 'bg-purple-50/30 dark:bg-purple-900/10';
  if (id === 'legacy_review') return 'bg-amber-50/30 dark:bg-amber-900/10';
  return columnBgTone[id as MaterialRequestKanbanStage] || 'bg-slate-50/50 dark:bg-slate-900/40';
};

const getColumnBorder = (id: MaterialRequestKanbanLaneId) => {
  if (id.startsWith('workflow:')) return 'border-purple-200/50 dark:border-purple-800/30';
  if (id === 'legacy_review') return 'border-amber-200/50 dark:border-amber-800/30';
  return columnBorderTone[id as MaterialRequestKanbanStage] || 'border-slate-200 dark:border-slate-700';
};

const getLaneBorderColor = (laneId: MaterialRequestKanbanLaneId) => {
  if (laneId.startsWith('workflow:')) return 'border-l-purple-500';
  if (laneId === 'legacy_review') return 'border-l-amber-500';
  
  const colors: Record<MaterialRequestKanbanStage, string> = {
    draft: 'border-l-slate-400',
    site_manager_review: 'border-l-amber-500',
    material_department_review: 'border-l-blue-500',
    batch_planning: 'border-l-indigo-500',
    site_quality_check: 'border-l-orange-500',
    site_receipt: 'border-l-cyan-500',
    completed: 'border-l-emerald-500',
    closed: 'border-l-rose-500',
  };
  return colors[laneId as MaterialRequestKanbanStage] || 'border-l-slate-400';
};



const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatSlaLabel = (request: MaterialRequest) => {
  if (!request.workflowStepDueAt || !request.workflowStepSlaHours) return 'Không SLA';
  const due = new Date(request.workflowStepDueAt).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const absHours = Math.abs(diffMs) / 36e5;
  if (diffMs < 0) return `Quá hạn ${absHours >= 24 ? `${Math.floor(absHours / 24)} ngày` : `${Math.ceil(absHours)}h`}`;
  return `Còn ${absHours >= 24 ? `${Math.floor(absHours / 24)} ngày` : `${Math.ceil(absHours)}h`}`;
};

const normalizeText = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const MaterialRequestKanbanBoard: React.FC<MaterialRequestKanbanBoardProps> = ({
  requests,
  fulfillmentSummaries,
  fulfillmentBatches,
  eventsByRequest,
  transactions,
  inventoryItemById,
  workBoqItemById,
  userById,
  workflowSubjectsByRequestId = {},
  workflowNodes = [],
  workflowRuntimeNodes = [],
  currentUserId,
  boardFilter = 'all',
  searchTerm = '',
  hideEmptyWorkflowLanes = false,
  canMoveRequest,
  onMoveRequest,
  onOpenRequest,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<MaterialRequestKanbanLaneId | null>(null);
  const [hoverCandidateId, setHoverCandidateId] = useState<string | null>(null);
  const [hoveredRequestId, setHoveredRequestId] = useState<string | null>(null);
  const [hoverCapable, setHoverCapable] = useState(true);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Bật hover popover trên màn hình từ tablet/desktop trở lên (width >= 768px)
    // Hoặc nếu thiết bị hỗ trợ pointer dạng fine (chuột/trackpad)
    const isMobile = window.innerWidth < 768;
    const hasFinePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    setHoverCapable(!isMobile || hasFinePointer);
  }, []);

  useEffect(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (!hoverCandidateId || !hoverCapable || draggedRequestId) {
      setHoveredRequestId(null);
      return;
    }
    hoverTimerRef.current = setTimeout(() => {
      setHoveredRequestId(hoverCandidateId);
    }, 180);
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, [draggedRequestId, hoverCandidateId, hoverCapable]);

  const columns = useMemo(() => {
    const dynamicById = new Map<string, { id: MaterialRequestKanbanLaneId; label: string; hint: string; order: number }>();
    workflowRuntimeNodes
      .filter(node => node.type !== WorkflowNodeType.START && node.type !== WorkflowNodeType.END)
      .forEach(node => {
        const laneNodeId = node.templateNodeId || node.id;
        if (dynamicById.has(laneNodeId)) return;
        dynamicById.set(laneNodeId, {
          id: `workflow:${laneNodeId}`,
          label: node.label,
          hint: 'Bước phê duyệt theo phiên bản workflow đang chạy',
          order: node.positionY,
        });
      });
    workflowNodes
      .filter(node => node.type !== WorkflowNodeType.START && node.type !== WorkflowNodeType.END)
      .forEach(node => {
        if (dynamicById.has(node.id)) return;
        dynamicById.set(node.id, {
          id: `workflow:${node.id}`,
          label: node.label,
          hint: 'Bước phê duyệt theo mẫu workflow',
          order: node.positionY,
        });
      });
    Object.values(workflowSubjectsByRequestId).forEach(subject => {
      const runtimeNode = subject.currentRuntimeNode;
      const compatibilityNode = subject.currentNode;
      const nodeType = runtimeNode?.type || compatibilityNode?.type;
      if (nodeType === WorkflowNodeType.START || nodeType === WorkflowNodeType.END) return;
      const laneNodeId = runtimeNode?.templateNodeId || runtimeNode?.id || subject.currentNodeId;
      if (!laneNodeId) return;
      if (!dynamicById.has(laneNodeId)) {
        dynamicById.set(laneNodeId, {
          id: `workflow:${laneNodeId}`,
          label: runtimeNode?.label || compatibilityNode?.label || 'Bước workflow đang tải',
          hint: runtimeNode?.templateNodeId ? 'Bước phê duyệt đang chạy' : 'Bước thuộc phiên bản workflow cũ',
          order: runtimeNode?.positionY ?? compatibilityNode?.positionY ?? Number.MAX_SAFE_INTEGER,
        });
      }
    });
    const logistics = MATERIAL_REQUEST_KANBAN_COLUMNS.filter(column =>
      ['batch_planning', 'site_quality_check', 'site_receipt', 'completed', 'closed'].includes(column.id)
    );
    return [
      MATERIAL_REQUEST_KANBAN_COLUMNS[0],
      ...Array.from(dynamicById.values()).sort((a, b) => a.order - b.order),
      { id: 'legacy_review' as const, label: 'Legacy chờ duyệt', hint: 'Phiếu đã gửi trước khi bắt buộc workflow động' },
      ...logistics,
    ];
  }, [workflowNodes, workflowRuntimeNodes, workflowSubjectsByRequestId]);

  const visibleRequests = useMemo(() => {
    return requests.filter(request => {
      const subject = workflowSubjectsByRequestId[request.id];
      const assigneeIds = subject?.currentAssigneeUserIds?.length
        ? subject.currentAssigneeUserIds
        : subject?.currentAssigneeUserId
          ? [subject.currentAssigneeUserId]
          : request.submittedToUserId
            ? [request.submittedToUserId]
            : [];
      if (searchTerm.trim()) {
        const requester = userById.get(request.requesterId);
        const handlerNames = assigneeIds.map(id => userById.get(id)?.name || id).join(' ');
        const matched = matchesSearchQueryMultiple([
          request.code,
          request.title,
          request.id,
          requester?.name,
          request.submittedToName,
          handlerNames
        ], searchTerm);
        if (!matched) return false;
      }
      if (boardFilter === 'mine') {
        return Boolean(currentUserId && (assigneeIds.includes(currentUserId) || request.requesterId === currentUserId));
      }
      if (boardFilter === 'overdue') return getMaterialRequestSlaState(request) === 'overdue';
      if (boardFilter === 'returned') return subject?.status === 'RETURNED' || request.workflowStep === 'returned_to_creator';
      if (boardFilter === 'watching') {
        return Boolean(currentUserId && subject?.participants?.some(participant =>
          participant.isActive && participant.role === 'WATCHER' && participant.userId === currentUserId
        ));
      }
      return true;
    });
  }, [boardFilter, currentUserId, requests, searchTerm, userById, workflowSubjectsByRequestId]);

  const stageByRequestId = useMemo(() => {
    return visibleRequests.reduce<Record<string, MaterialRequestKanbanLaneId>>((acc, request) => {
      const subject = workflowSubjectsByRequestId[request.id];
      if (subject?.status === 'RUNNING' && subject.currentRuntimeNode?.type !== WorkflowNodeType.END) {
        const laneNodeId = subject.currentRuntimeNode?.templateNodeId || subject.currentRuntimeNode?.id || subject.currentNodeId;
        if (laneNodeId) {
          acc[request.id] = `workflow:${laneNodeId}`;
          return acc;
        }
      }
      if (!subject && request.status === 'PENDING') {
        acc[request.id] = 'legacy_review';
        return acc;
      }
      acc[request.id] = resolveRequestKanbanStage(
        request,
        fulfillmentBatches[request.id] || [],
        transactions,
        fulfillmentSummaries[request.id],
      );
      return acc;
    }, {});
  }, [fulfillmentBatches, fulfillmentSummaries, transactions, visibleRequests, workflowSubjectsByRequestId]);

  const requestsByStage = useMemo(() => {
    const grouped = columns.reduce<Record<string, MaterialRequest[]>>((acc, column) => {
      acc[column.id] = [];
      return acc;
    }, {});
    visibleRequests.forEach(request => {
      const stage = stageByRequestId[request.id] || 'draft';
      if (!grouped[stage]) grouped[stage] = [];
      grouped[stage].push(request);
    });
    return grouped;
  }, [columns, stageByRequestId, visibleRequests]);

  const displayColumns = useMemo(() => {
    return columns.filter(column => {
      if (column.id === 'legacy_review') return (requestsByStage[column.id] || []).length > 0;
      if (!hideEmptyWorkflowLanes) return true;
      if (!column.id.startsWith('workflow:')) return true;
      return (requestsByStage[column.id] || []).length > 0;
    });
  }, [columns, hideEmptyWorkflowLanes, requestsByStage]);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (stage: MaterialRequestKanbanLaneId) => {
    const request = requests.find(item => item.id === draggedRequestId);
    setDragOverStage(null);
    setDraggedRequestId(null);
    if (!request) return;
    const fromStage = stageByRequestId[request.id] || 'draft';
    if (fromStage === stage || !canMoveRequest(request, stage, fromStage)) return;
    onMoveRequest(request, stage, fromStage);
  };

  return (
    <div className="overflow-x-auto">
      <div
        className="flex gap-4 pb-4 px-1"
        style={{ minHeight: '60vh' }}
      >
        {displayColumns.map((column, colIndex) => {
          const columnRequests = requestsByStage[column.id] || [];
          const isDropTarget = dragOverStage === column.id;
          return (
            <section
              key={column.id}
              onDragOver={event => {
                event.preventDefault();
                setDragOverStage(column.id);
              }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={() => handleDrop(column.id)}
              className={`flex flex-col rounded-2xl overflow-hidden border shrink-0 transition-all duration-200 ${getColumnBorder(column.id)} ${isDropTarget ? 'ring-2 ring-indigo-400 ring-offset-2 scale-[1.01]' : ''}`}
              style={{ width: '320px', maxHeight: 'calc(100vh - 250px)' }}
            >
              {/* Gradient Header */}
              <div className={`px-4 py-3 bg-gradient-to-r ${getHeaderGradient(column.id)} text-white`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider">{column.label}</span>
                  <span className="text-[10px] font-bold bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full">
                    {columnRequests.length}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-[10px] font-medium text-white/70">{column.hint}</p>
              </div>

              <div className={`flex-1 overflow-y-auto p-2.5 space-y-2.5 ${getColumnBg(column.id)} ${isDropTarget ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}>
                {columnRequests.map((request, reqIndex) => {
                  const expanded = expandedIds.has(request.id);
                  const requester = userById.get(request.requesterId);
                  const workflowSubject = workflowSubjectsByRequestId[request.id];
                  const handlerUserIds = workflowSubject?.currentAssigneeUserIds?.length
                    ? workflowSubject.currentAssigneeUserIds
                    : workflowSubject?.currentAssigneeUserId
                      ? [workflowSubject.currentAssigneeUserId]
                      : request.submittedToUserId
                        ? [request.submittedToUserId]
                        : [];
                  const handlerNames = handlerUserIds.map(id => userById.get(id)?.name || id);
                  const handlerLabel = handlerNames.length > 1
                    ? `${handlerNames[0]} + ${handlerNames.length - 1} người`
                    : handlerNames[0] || request.submittedToName || '';
                  const workflowStepLabel = workflowSubject?.currentRuntimeNode?.label || workflowSubject?.currentNode?.label || undefined;
                  const summary = fulfillmentSummaries[request.id];
                  const events = eventsByRequest[request.id] || [];
                  const slaState = getMaterialRequestSlaState(request);
                  const progress = summary && summary.committedQty > 0
                    ? Math.min(100, Math.round((summary.receivedQty / summary.committedQty) * 100))
                    : 0;

                  const isHovered = hoveredRequestId === request.id && !draggedRequestId;
                  const isRightSide = colIndex >= 4;
                  const alignBottom = columnRequests.length > 2 && reqIndex >= columnRequests.length - 2;

                  return (
                    <article
                      key={request.id}
                      draggable
                      onDragStart={event => {
                        setDraggedRequestId(request.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', request.id);
                      }}
                      onDragEnd={() => {
                        setDraggedRequestId(null);
                        setDragOverStage(null);
                      }}
                      onMouseEnter={() => setHoverCandidateId(request.id)}
                      onMouseLeave={() => {
                        setHoverCandidateId(null);
                        setHoveredRequestId(null);
                      }}
                      className={`group relative rounded-xl border-l-4 bg-card shadow-sm hover:shadow-lg cursor-pointer transition-all duration-200 ${getLaneBorderColor(column.id)} ${draggedRequestId === request.id ? 'opacity-50 scale-95 rotate-1' : 'hover:-translate-y-0.5'}`}
                    >
                      <button
                        onClick={() => toggleExpanded(request.id)}
                        className="w-full p-4 text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <GripVertical
                              size={14}
                              className="text-muted-foreground/30 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                            />
                            <div className="min-w-0">
                              <h4 className="text-[13px] font-bold text-foreground leading-tight line-clamp-2">
                                {request.title || 'Đề xuất vật tư'}
                              </h4>
                              <span className="mt-0.5 block truncate font-mono text-[9px] font-bold text-muted-foreground">
                                {request.code} - Đề xuất vật tư
                              </span>
                            </div>
                          </div>
                          {expanded ? <ChevronUp size={15} className="text-slate-300 dark:text-slate-600" /> : <ChevronDown size={15} className="text-slate-300 dark:text-slate-600" />}
                        </div>

                        {/* Meta info row */}
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <UserRound size={9} />
                            <span className="truncate max-w-[100px]">{requester?.name || request.requesterId}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={9} />
                            {formatSlaLabel(request)}
                          </span>
                        </div>

                        {/* SLA Warning */}
                        {slaState === 'overdue' && (
                          <div className="mt-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-destructive/10 text-destructive">
                            <Clock size={10} />
                            {formatSlaLabel(request)}
                          </div>
                        )}
                        {slaState === 'urgent' && (
                          <div className="mt-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-500/10 text-amber-500">
                            <Clock size={10} />
                            {formatSlaLabel(request)}
                          </div>
                        )}

                        {/* Tags row */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {handlerLabel && (
                            <span className="text-[9px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                              {handlerLabel}
                            </span>
                          )}
                          {workflowStepLabel && (
                            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                              {workflowStepLabel}
                            </span>
                          )}
                        </div>

                        {summary && summary.committedQty > 0 && (
                          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted rounded-lg px-2.5 py-1.5">
                            <Package size={10} className="shrink-0 mt-0.5 text-slate-300" />
                            <span className="line-clamp-1">Nhận {summary.receivedQty.toLocaleString('vi-VN')} / {summary.committedQty.toLocaleString('vi-VN')} ({progress}%)</span>
                          </div>
                        )}
                      </button>

                      {expanded && (
                        <div className="border-t border-border px-3 pb-3">
                          <div className="mt-3 space-y-1.5">
                            {(request.items || []).slice(0, 5).map((line: any, index: number) => {
                              const item = inventoryItemById.get(line.itemId);
                              const work = line.workBoqItemId ? workBoqItemById.get(line.workBoqItemId) : undefined;
                              return (
                                <div key={`${request.id}-${line.lineId || line.itemId}-${index}`} className="rounded-lg bg-muted px-2 py-1.5">
                                  <div className="truncate text-[10px] font-black text-foreground">
                                    {work?.wbsCode ? `${work.wbsCode} - ` : ''}{line.itemNameSnapshot || item?.name || line.itemId}
                                  </div>
                                  <div className="mt-0.5 text-[9px] font-bold text-muted-foreground">
                                    KL yêu cầu: {Number(line.requestQty || 0).toLocaleString('vi-VN')} {line.unitSnapshot || item?.unit || ''}
                                  </div>
                                </div>
                              );
                            })}
                            {(request.items || []).length > 5 && (
                              <div className="text-[9px] font-bold text-muted-foreground">+{(request.items || []).length - 5} dòng khác</div>
                            )}
                          </div>

                          <div className="mt-3 rounded-lg border border-border bg-card px-2 py-2">
                            <div className="mb-1.5 flex items-center gap-1 text-[9px] font-black uppercase text-muted-foreground">
                              <MessageSquare size={10} /> Timeline
                            </div>
                            <div className="space-y-1.5">
                              {events.slice(0, 4).map(event => (
                                <div key={event.id} className="text-[10px]">
                                  <div className="font-black text-foreground/80">{event.action} <span className="font-medium text-muted-foreground/30">• {formatDateTime(event.createdAt)}</span></div>
                                  {event.note && <div className="line-clamp-2 text-muted-foreground">{event.note}</div>}
                                </div>
                              ))}
                              {events.length === 0 && (request.logs || []).slice(-3).reverse().map((log, index) => (
                                <div key={`${request.id}-log-${index}`} className="text-[10px]">
                                  <div className="font-black text-foreground/80">{log.action} <span className="font-medium text-muted-foreground/30">• {formatDateTime(log.timestamp)}</span></div>
                                  {log.note && <div className="line-clamp-2 text-muted-foreground">{log.note}</div>}
                                </div>
                              ))}
                              {events.length === 0 && (!request.logs || request.logs.length === 0) && (
                                <div className="text-[10px] font-bold text-muted-foreground/30">Chưa có ghi chú xử lý.</div>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={() => onOpenRequest(request)}
                            className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-slate-700"
                          >
                            <FileText size={12} /> Mở chi tiết <ArrowRight size={11} />
                          </button>
                        </div>
                      )}

                      {/* Quick View Popover on Hover */}
                      {isHovered && hoverCapable && (
                        <div
                          className={`absolute z-50 w-[400px] rounded-2xl border border-border bg-popover/95 backdrop-blur-md p-4 shadow-[0_20px_50px_rgba(0,0,0,0.15)] transition-all duration-300 ${
                            isRightSide ? 'right-full mr-3' : 'left-full ml-3'
                          } ${
                            alignBottom ? 'bottom-0' : 'top-0'
                          }`}
                          style={{ minHeight: '120px' }}
                          onClick={(e) => e.stopPropagation()} // Chống click bubble làm đóng/mở rộng card cha
                        >
                          <div className="space-y-4">
                            {/* Header */}
                            <div className="flex items-start justify-between border-b border-border pb-2">
                              <div>
                                <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-indigo-400">
                                  Xem nhanh phiếu
                                </span>
                                <h4 className="mt-1 text-sm font-black text-foreground">
                                  {request.title || 'Đề xuất vật tư'}
                                </h4>
                                <div className="mt-0.5 font-mono text-[10px] font-bold text-indigo-600">
                                  {request.code} - Đề xuất vật tư
                                </div>
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase text-white bg-gradient-to-r ${getHeaderGradient(column.id)}`}>
                                {column.label}
                              </span>
                            </div>

                            {/* General Info Grid */}
                            <div className="grid grid-cols-2 gap-3 text-[11px]">
                              <div className="space-y-1">
                                <span className="font-bold text-muted-foreground">Người yêu cầu:</span>
                                <div className="flex items-center gap-1 font-black text-foreground">
                                  <UserRound size={12} className="text-muted-foreground" />
                                  <span className="truncate">{requester?.name || request.requesterId}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="font-bold text-muted-foreground">Người xử lý:</span>
                                <div className="flex items-center gap-1 font-black text-foreground">
                                  <UserRound size={12} className="text-amber-500" />
                                  <span className="truncate">{handlerNames.length > 0 ? handlerNames.join(', ') : request.submittedToName || 'Chưa phân công'}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="font-bold text-muted-foreground">Ngày yêu cầu:</span>
                                <div className="flex items-center gap-1 font-semibold text-foreground/80">
                                  <Clock size={12} className="text-muted-foreground" />
                                  <span>{formatDateTime(request.createdDate || request.date)}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="font-bold text-muted-foreground">Hạn mong muốn:</span>
                                <div className="flex items-center gap-1 font-semibold text-foreground/80">
                                  <Clock size={12} className="text-rose-400" />
                                  <span>{formatDateTime(request.expectedDate)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Note */}
                            {(request.note || request.submissionNote) && (
                              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2 text-[10px] text-foreground">
                                <div className="font-bold text-amber-800">Ghi chú:</div>
                                <p className="mt-0.5 italic">{request.note || request.submissionNote}</p>
                              </div>
                            )}
                            {workflowStepLabel && (
                              <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-2 text-[10px] text-indigo-400">
                                <div className="font-bold">Bước workflow hiện tại:</div>
                                <p className="mt-0.5 font-black">{workflowStepLabel}</p>
                              </div>
                            )}

                            {/* Items List */}
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                                <span>Danh sách vật tư ({request.items?.length || 0})</span>
                              </div>
                              <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
                                {(request.items || []).map((line: any, index: number) => {
                                  const item = inventoryItemById.get(line.itemId);
                                  const work = line.workBoqItemId ? workBoqItemById.get(line.workBoqItemId) : undefined;
                                  return (
                                    <div key={`${request.id}-hover-${line.lineId || line.itemId}-${index}`} className="flex items-start justify-between gap-2 rounded-lg bg-muted border border-border px-2 py-1.5 hover:bg-muted/80 transition">
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[10px] font-black text-foreground">
                                          {line.itemNameSnapshot || item?.name || line.itemId}
                                        </div>
                                        {work?.wbsCode && (
                                          <div className="text-[9px] font-bold text-indigo-500 mt-0.5">
                                            WBS: {work.wbsCode} - {work.name}
                                          </div>
                                        )}
                                      </div>
                                      <div className="text-right shrink-0">
                                        <div className="text-[10px] font-black text-slate-700 font-mono">
                                          {Number(line.requestQty || 0).toLocaleString('vi-VN')} {line.unitSnapshot || item?.unit || ''}
                                        </div>
                                        {line.approvedQty !== undefined && line.approvedQty !== line.requestQty && (
                                          <div className="text-[9px] font-bold text-emerald-600 font-mono">
                                            Duyệt: {Number(line.approvedQty).toLocaleString('vi-VN')}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Fulfillment progress */}
                            {summary && summary.committedQty > 0 && (
                              <div className="border-t border-border pt-3">
                                <div className="flex justify-between text-[10px] font-black text-muted-foreground mb-1">
                                  <span>Tiến độ nhận hàng</span>
                                  <span>{progress}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-muted border border-border">
                                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                                </div>
                                <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground font-mono">
                                  <span>Đã nhận: {summary.receivedQty.toLocaleString('vi-VN')}</span>
                                  <span>Còn lại: {summary.remainingToReceive.toLocaleString('vi-VN')}</span>
                                </div>
                              </div>
                            )}

                            {/* Timeline */}
                            <div className="border-t border-border pt-3">
                              <div className="mb-1.5 flex items-center gap-1 text-[9px] font-black uppercase text-muted-foreground">
                                <MessageSquare size={10} /> Hoạt động gần đây
                              </div>
                              <div className="space-y-2 max-h-[100px] overflow-y-auto pr-1">
                                {events.slice(0, 3).map(event => (
                                  <div key={event.id} className="text-[10px]">
                                    <div className="font-black text-foreground/80">{event.action} <span className="font-medium text-muted-foreground/30">• {formatDateTime(event.createdAt)}</span></div>
                                    {event.note && <div className="line-clamp-2 text-muted-foreground mt-0.5">{event.note}</div>}
                                  </div>
                                ))}
                                {events.length === 0 && (request.logs || []).slice(-3).reverse().map((log, index) => (
                                  <div key={`${request.id}-log-hover-${index}`} className="text-[10px]">
                                    <div className="font-black text-foreground/80">{log.action} <span className="font-medium text-muted-foreground/30">• {formatDateTime(log.timestamp)}</span></div>
                                    {log.note && <div className="line-clamp-2 text-muted-foreground mt-0.5">{log.note}</div>}
                                  </div>
                                ))}
                                {events.length === 0 && (!request.logs || request.logs.length === 0) && (
                                  <div className="text-[10px] font-bold text-muted-foreground/30">Chưa có hoạt động.</div>
                                )}
                              </div>
                            </div>

                            {/* Footer Action */}
                            <div className="border-t border-border pt-3 flex items-center justify-between gap-3">
                              <span className="text-[9px] font-bold text-muted-foreground">
                                Kéo thả để chuyển trạng thái
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // Ngăn sự kiện toggle expand thẻ cha
                                  onOpenRequest(request);
                                }}
                                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-indigo-700 shadow-sm transition active:scale-95"
                              >
                                <FileText size={11} /> Mở chi tiết <ArrowRight size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}

                {columnRequests.length === 0 && (
                  <div className={`flex flex-col items-center justify-center py-10 text-muted-foreground/30 transition-all ${isDropTarget ? 'opacity-100' : 'opacity-50'}`}>
                    <Package size={28} className="mb-2" />
                    <p className="text-[10px] font-bold uppercase tracking-wider">
                      {isDropTarget ? 'Thả vào đây' : 'Không có phiếu'}
                    </p>
                  </div>
                )}
              </div>

              {/* Column Footer */}
              <div className={`px-4 py-2 border-t ${getColumnBorder(column.id)} bg-card/60`}>
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {columnRequests.length} phiếu
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default MaterialRequestKanbanBoard;
