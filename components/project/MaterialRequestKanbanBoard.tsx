import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Clock, FileText, GitBranch, MessageSquare, Package, UserRound } from 'lucide-react';
import {
  InventoryItem,
  MaterialRequest,
  MaterialRequestEvent,
  MaterialRequestFulfillmentBatch,
  MaterialRequestFulfillmentSummary,
  MaterialRequestKanbanStage,
  ProjectWorkflowSubject,
  ProjectWorkBoqItem,
  Transaction,
  User,
} from '../../types';
import {
  getMaterialRequestSlaState,
  MATERIAL_REQUEST_KANBAN_COLUMNS,
  resolveRequestKanbanStage,
} from '../../lib/materialRequestService';

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
  canMoveRequest: (request: MaterialRequest, toStage: MaterialRequestKanbanStage, fromStage: MaterialRequestKanbanStage) => boolean;
  onMoveRequest: (request: MaterialRequest, toStage: MaterialRequestKanbanStage, fromStage: MaterialRequestKanbanStage) => void;
  onOpenRequest: (request: MaterialRequest) => void;
}

const columnTone: Record<MaterialRequestKanbanStage, string> = {
  draft: 'border-slate-200 bg-slate-50',
  site_manager_review: 'border-amber-200 bg-amber-50/50',
  material_department_review: 'border-blue-200 bg-blue-50/50',
  batch_planning: 'border-indigo-200 bg-indigo-50/50',
  site_quality_check: 'border-orange-200 bg-orange-50/50',
  site_receipt: 'border-cyan-200 bg-cyan-50/50',
  completed: 'border-emerald-200 bg-emerald-50/50',
  closed: 'border-rose-200 bg-rose-50/50',
};

const slaTone = {
  none: 'bg-slate-50 text-slate-400 border-slate-100',
  normal: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  urgent: 'bg-amber-50 text-amber-700 border-amber-100',
  overdue: 'bg-red-50 text-red-600 border-red-100',
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
  canMoveRequest,
  onMoveRequest,
  onOpenRequest,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<MaterialRequestKanbanStage | null>(null);
  const [hoveredRequestId, setHoveredRequestId] = useState<string | null>(null);

  const stageByRequestId = useMemo(() => {
    return requests.reduce<Record<string, MaterialRequestKanbanStage>>((acc, request) => {
      acc[request.id] = resolveRequestKanbanStage(
        request,
        fulfillmentBatches[request.id] || [],
        transactions,
        fulfillmentSummaries[request.id],
      );
      return acc;
    }, {});
  }, [fulfillmentBatches, fulfillmentSummaries, requests, transactions]);

  const requestsByStage = useMemo(() => {
    const grouped = MATERIAL_REQUEST_KANBAN_COLUMNS.reduce<Record<MaterialRequestKanbanStage, MaterialRequest[]>>((acc, column) => {
      acc[column.id] = [];
      return acc;
    }, {} as Record<MaterialRequestKanbanStage, MaterialRequest[]>);
    requests.forEach(request => {
      grouped[stageByRequestId[request.id] || 'draft'].push(request);
    });
    return grouped;
  }, [requests, stageByRequestId]);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (stage: MaterialRequestKanbanStage) => {
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
      <div className="grid min-w-[2580px] grid-cols-8 gap-4 p-4">
        {MATERIAL_REQUEST_KANBAN_COLUMNS.map((column, colIndex) => {
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
              className={`min-h-[520px] rounded-2xl border ${columnTone[column.id]} ${isDropTarget ? 'ring-2 ring-indigo-300' : ''}`}
            >
              <div className="border-b border-white/70 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-700">{column.label}</h4>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">{columnRequests.length}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] font-medium text-slate-400">{column.hint}</p>
              </div>

              <div className="space-y-2 p-2">
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
                  const workflowStepLabel = workflowSubject?.currentNode?.label || undefined;
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
                      onMouseEnter={() => setHoveredRequestId(request.id)}
                      onMouseLeave={() => setHoveredRequestId(null)}
                      className="group relative rounded-xl border border-white bg-white shadow-sm transition hover:border-indigo-100 hover:shadow-md"
                    >
                      <button
                        onClick={() => toggleExpanded(request.id)}
                        className="w-full px-3 py-3 text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs font-black text-indigo-600">{request.code}</div>
                            <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-400">
                              <UserRound size={11} />
                              <span className="truncate">{requester?.name || request.requesterId}</span>
                            </div>
                          </div>
                          {expanded ? <ChevronUp size={15} className="text-slate-300" /> : <ChevronDown size={15} className="text-slate-300" />}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${slaTone[slaState]}`}>
                            <Clock size={10} /> {formatSlaLabel(request)}
                          </span>
                          {handlerLabel && (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">
                              <UserRound size={10} /> {handlerLabel}
                            </span>
                          )}
                          {workflowStepLabel && (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[9px] font-black text-indigo-700">
                              <GitBranch size={10} /> {workflowStepLabel}
                            </span>
                          )}
                        </div>

                        {summary && summary.committedQty > 0 && (
                          <div className="mt-3">
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="mt-1 flex justify-between text-[9px] font-black text-slate-400">
                              <span>Nhận {summary.receivedQty.toLocaleString('vi-VN')}</span>
                              <span>Còn {summary.remainingToReceive.toLocaleString('vi-VN')}</span>
                            </div>
                          </div>
                        )}
                      </button>

                      {expanded && (
                        <div className="border-t border-slate-50 px-3 pb-3">
                          <div className="mt-3 space-y-1.5">
                            {(request.items || []).slice(0, 5).map((line: any, index: number) => {
                              const item = inventoryItemById.get(line.itemId);
                              const work = line.workBoqItemId ? workBoqItemById.get(line.workBoqItemId) : undefined;
                              return (
                                <div key={`${request.id}-${line.lineId || line.itemId}-${index}`} className="rounded-lg bg-slate-50 px-2 py-1.5">
                                  <div className="truncate text-[10px] font-black text-slate-700">
                                    {work?.wbsCode ? `${work.wbsCode} - ` : ''}{line.itemNameSnapshot || item?.name || line.itemId}
                                  </div>
                                  <div className="mt-0.5 text-[9px] font-bold text-slate-400">
                                    KL yêu cầu: {Number(line.requestQty || 0).toLocaleString('vi-VN')} {line.unitSnapshot || item?.unit || ''}
                                  </div>
                                </div>
                              );
                            })}
                            {(request.items || []).length > 5 && (
                              <div className="text-[9px] font-bold text-slate-400">+{(request.items || []).length - 5} dòng khác</div>
                            )}
                          </div>

                          <div className="mt-3 rounded-lg border border-slate-100 bg-white px-2 py-2">
                            <div className="mb-1.5 flex items-center gap-1 text-[9px] font-black uppercase text-slate-400">
                              <MessageSquare size={10} /> Timeline
                            </div>
                            <div className="space-y-1.5">
                              {events.slice(0, 4).map(event => (
                                <div key={event.id} className="text-[10px]">
                                  <div className="font-black text-slate-600">{event.action} <span className="font-medium text-slate-300">• {formatDateTime(event.createdAt)}</span></div>
                                  {event.note && <div className="line-clamp-2 text-slate-400">{event.note}</div>}
                                </div>
                              ))}
                              {events.length === 0 && (request.logs || []).slice(-3).reverse().map((log, index) => (
                                <div key={`${request.id}-log-${index}`} className="text-[10px]">
                                  <div className="font-black text-slate-600">{log.action} <span className="font-medium text-slate-300">• {formatDateTime(log.timestamp)}</span></div>
                                  {log.note && <div className="line-clamp-2 text-slate-400">{log.note}</div>}
                                </div>
                              ))}
                              {events.length === 0 && (!request.logs || request.logs.length === 0) && (
                                <div className="text-[10px] font-bold text-slate-300">Chưa có ghi chú xử lý.</div>
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
                      {isHovered && (
                        <div
                          className={`absolute z-50 w-[400px] rounded-2xl border border-slate-100 bg-white/95 backdrop-blur-md p-4 shadow-[0_20px_50px_rgba(0,0,0,0.15)] transition-all duration-300 ${
                            isRightSide ? 'right-full mr-3' : 'left-full ml-3'
                          } ${
                            alignBottom ? 'bottom-0' : 'top-0'
                          }`}
                          style={{ minHeight: '120px' }}
                          onClick={(e) => e.stopPropagation()} // Chống click bubble làm đóng/mở rộng card cha
                        >
                          <div className="space-y-4">
                            {/* Header */}
                            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
                              <div>
                                <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-indigo-600">
                                  Xem nhanh phiếu
                                </span>
                                <h4 className="mt-1 font-mono text-sm font-black text-indigo-600">
                                  {request.code}
                                </h4>
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase border ${columnTone[column.id].split(' ')[0]} ${columnTone[column.id].split(' ')[1]} ${columnTone[column.id].split(' ')[2] || ''}`}>
                                {column.label}
                              </span>
                            </div>

                            {/* General Info Grid */}
                            <div className="grid grid-cols-2 gap-3 text-[11px]">
                              <div className="space-y-1">
                                <span className="font-bold text-slate-400">Người yêu cầu:</span>
                                <div className="flex items-center gap-1 font-black text-slate-700">
                                  <UserRound size={12} className="text-slate-400" />
                                  <span className="truncate">{requester?.name || request.requesterId}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="font-bold text-slate-400">Người xử lý:</span>
                                <div className="flex items-center gap-1 font-black text-slate-700">
                                  <UserRound size={12} className="text-amber-500" />
                                  <span className="truncate">{handlerNames.length > 0 ? handlerNames.join(', ') : request.submittedToName || 'Chưa phân công'}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="font-bold text-slate-400">Ngày yêu cầu:</span>
                                <div className="flex items-center gap-1 font-semibold text-slate-600">
                                  <Clock size={12} className="text-slate-400" />
                                  <span>{formatDateTime(request.createdDate || request.date)}</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="font-bold text-slate-400">Hạn mong muốn:</span>
                                <div className="flex items-center gap-1 font-semibold text-slate-600">
                                  <Clock size={12} className="text-rose-400" />
                                  <span>{formatDateTime(request.expectedDate)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Note */}
                            {(request.note || request.submissionNote) && (
                              <div className="rounded-lg bg-amber-50/50 border border-amber-100/50 p-2 text-[10px] text-slate-600">
                                <div className="font-bold text-amber-800">Ghi chú:</div>
                                <p className="mt-0.5 italic">{request.note || request.submissionNote}</p>
                              </div>
                            )}
                            {workflowStepLabel && (
                              <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-2 text-[10px] text-indigo-700">
                                <div className="font-bold">Bước workflow hiện tại:</div>
                                <p className="mt-0.5 font-black">{workflowStepLabel}</p>
                              </div>
                            )}

                            {/* Items List */}
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                                <span>Danh sách vật tư ({request.items?.length || 0})</span>
                              </div>
                              <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
                                {(request.items || []).map((line: any, index: number) => {
                                  const item = inventoryItemById.get(line.itemId);
                                  const work = line.workBoqItemId ? workBoqItemById.get(line.workBoqItemId) : undefined;
                                  return (
                                    <div key={`${request.id}-hover-${line.lineId || line.itemId}-${index}`} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 border border-slate-100/80 px-2 py-1.5 hover:bg-slate-100/50 transition">
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[10px] font-black text-slate-700">
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
                              <div className="border-t border-slate-100 pt-3">
                                <div className="flex justify-between text-[10px] font-black text-slate-500 mb-1">
                                  <span>Tiến độ nhận hàng</span>
                                  <span>{progress}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
                                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                                </div>
                                <div className="mt-1 flex justify-between text-[9px] font-bold text-slate-400 font-mono">
                                  <span>Đã nhận: {summary.receivedQty.toLocaleString('vi-VN')}</span>
                                  <span>Còn lại: {summary.remainingToReceive.toLocaleString('vi-VN')}</span>
                                </div>
                              </div>
                            )}

                            {/* Timeline */}
                            <div className="border-t border-slate-100 pt-3">
                              <div className="mb-1.5 flex items-center gap-1 text-[9px] font-black uppercase text-slate-400">
                                <MessageSquare size={10} /> Hoạt động gần đây
                              </div>
                              <div className="space-y-2 max-h-[100px] overflow-y-auto pr-1">
                                {events.slice(0, 3).map(event => (
                                  <div key={event.id} className="text-[10px]">
                                    <div className="font-black text-slate-600">{event.action} <span className="font-medium text-slate-300">• {formatDateTime(event.createdAt)}</span></div>
                                    {event.note && <div className="line-clamp-2 text-slate-400 mt-0.5">{event.note}</div>}
                                  </div>
                                ))}
                                {events.length === 0 && (request.logs || []).slice(-3).reverse().map((log, index) => (
                                  <div key={`${request.id}-log-hover-${index}`} className="text-[10px]">
                                    <div className="font-black text-slate-600">{log.action} <span className="font-medium text-slate-300">• {formatDateTime(log.timestamp)}</span></div>
                                    {log.note && <div className="line-clamp-2 text-slate-400 mt-0.5">{log.note}</div>}
                                  </div>
                                ))}
                                {events.length === 0 && (!request.logs || request.logs.length === 0) && (
                                  <div className="text-[10px] font-bold text-slate-300">Chưa có hoạt động.</div>
                                )}
                              </div>
                            </div>

                            {/* Footer Action */}
                            <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-3">
                              <span className="text-[9px] font-bold text-slate-400">
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
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-3 py-8 text-center">
                    <Package size={20} className="mx-auto text-slate-200" />
                    <p className="mt-2 text-[10px] font-bold text-slate-300">Không có phiếu</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default MaterialRequestKanbanBoard;
