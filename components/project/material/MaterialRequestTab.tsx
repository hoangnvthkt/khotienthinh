import React, { useMemo, useState } from 'react';
import { AlertTriangle, LayoutGrid, ListChecks, Loader2, Package, Plus, Search } from 'lucide-react';
import {
    InventoryItem,
    MaterialRequest,
    MaterialRequestEvent,
    MaterialRequestFulfillmentBatch,
    MaterialRequestFulfillmentSummary,
    MaterialRequestKanbanLaneId,
    ProjectWorkflowBoardFilter,
    ProjectWorkflowConfiguration,
    ProjectWorkflowSubject,
    ProjectWorkBoqItem,
    Transaction,
    User,
    WorkflowNode,
    WorkflowRuntimeNode,
} from '../../../types';
import { EmptyState, StatusBadge } from '../../erp';
import { getMaterialRequestNextAction, getMaterialRequestStatusView } from '../../../lib/erpWorkflow';
import { getMaterialRequestSlaState } from '../../../lib/materialRequestService';
import { matchesSearchQueryMultiple } from '../../../lib/searchUtils';

const MaterialRequestKanbanBoard = React.lazy(() => import('../MaterialRequestKanbanBoard'));
const ProjectWorkflowAnalyticsPanel = React.lazy(() => import('../ProjectWorkflowAnalyticsPanel'));
const ProjectWorkflowBindingPanel = React.lazy(() => import('../ProjectWorkflowBindingPanel'));
const ProjectWorkflowInbox = React.lazy(() => import('../ProjectWorkflowInbox'));

const LazyPanelFallback = ({ label = 'Đang tải dữ liệu...' }: { label?: string }) => (
    <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-slate-100 bg-white text-xs font-bold text-slate-400 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <Loader2 size={14} className="mr-2 animate-spin text-indigo-500" /> {label}
    </div>
);

const formatDate = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

type MaterialRequestTabProps = {
    projectId?: string;
    constructionSiteId?: string;
    requests: MaterialRequest[];
    sortedRequests: MaterialRequest[];
    canCreateMaterialRequest: boolean;
    transitioningRequestId: string | null;
    workflowTemplates: any[];
    workflowConfiguration: ProjectWorkflowConfiguration | null;
    workflowNodes: WorkflowNode[];
    workflowRuntimeNodes: WorkflowRuntimeNode[];
    requestWorkflowSubjects: Record<string, ProjectWorkflowSubject>;
    requestFulfillmentSummaries: Record<string, MaterialRequestFulfillmentSummary>;
    requestFulfillmentBatches: Record<string, MaterialRequestFulfillmentBatch[]>;
    requestEventsByRequest: Record<string, MaterialRequestEvent[]>;
    transactions: Transaction[];
    inventoryItemById: Map<string, InventoryItem>;
    workBoqItemById: Map<string, ProjectWorkBoqItem>;
    userById: Map<string, User>;
    users: User[];
    currentUserId: string;
    workflowBoardFilter: ProjectWorkflowBoardFilter;
    workflowBoardSearch: string;
    hideEmptyWorkflowLanes: boolean;
    onCreateRequest: () => void;
    onConfigurationChange: (configuration: ProjectWorkflowConfiguration | null) => void;
    onWorkflowBoardFilterChange: (filter: ProjectWorkflowBoardFilter) => void;
    onWorkflowBoardSearchChange: (search: string) => void;
    onHideEmptyWorkflowLanesChange: (value: boolean) => void;
    canMoveMaterialRequest: (request: MaterialRequest, toStage: MaterialRequestKanbanLaneId, fromStage: MaterialRequestKanbanLaneId) => boolean;
    onMoveMaterialRequest: (request: MaterialRequest, toStage: MaterialRequestKanbanLaneId, fromStage: MaterialRequestKanbanLaneId) => void;
    onOpenRequest: (request: MaterialRequest) => void;
};

export const MaterialRequestTab: React.FC<MaterialRequestTabProps> = ({
    projectId,
    constructionSiteId,
    requests,
    sortedRequests,
    canCreateMaterialRequest,
    transitioningRequestId,
    workflowTemplates,
    workflowConfiguration,
    workflowNodes,
    workflowRuntimeNodes,
    requestWorkflowSubjects,
    requestFulfillmentSummaries,
    requestFulfillmentBatches,
    requestEventsByRequest,
    transactions,
    inventoryItemById,
    workBoqItemById,
    userById,
    users,
    currentUserId,
    workflowBoardFilter,
    workflowBoardSearch,
    hideEmptyWorkflowLanes,
    onCreateRequest,
    onConfigurationChange,
    onWorkflowBoardFilterChange,
    onWorkflowBoardSearchChange,
    onHideEmptyWorkflowLanesChange,
    canMoveMaterialRequest,
    onMoveMaterialRequest,
    onOpenRequest,
}) => {
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
    const workflowTemplateNodes = workflowConfiguration?.binding
        ? workflowNodes.filter(node => node.templateId === workflowConfiguration.binding?.workflowTemplateId)
        : [];
    const currentUser = userById.get(currentUserId) || users.find(item => item.id === currentUserId);

    const filteredListRequests = useMemo(() => {
        return sortedRequests.filter(request => {
            const subject = requestWorkflowSubjects[request.id];
            const assigneeIds = subject?.currentAssigneeUserIds?.length
                ? subject.currentAssigneeUserIds
                : subject?.currentAssigneeUserId
                    ? [subject.currentAssigneeUserId]
                    : request.submittedToUserId
                        ? [request.submittedToUserId]
                        : [];
            const requester = userById.get(request.requesterId);
            const handlerNames = assigneeIds.map(id => userById.get(id)?.name || id).join(' ');
            if (workflowBoardSearch.trim()) {
                const matched = matchesSearchQueryMultiple([
                    request.code,
                    request.title,
                    request.id,
                    requester?.name,
                    request.submittedToName,
                    handlerNames,
                    request.note,
                ], workflowBoardSearch);
                if (!matched) return false;
            }
            if (workflowBoardFilter === 'mine') {
                return Boolean(currentUserId && (assigneeIds.includes(currentUserId) || request.requesterId === currentUserId));
            }
            if (workflowBoardFilter === 'overdue') return getMaterialRequestSlaState(request) === 'overdue';
            if (workflowBoardFilter === 'returned') return subject?.status === 'RETURNED' || request.workflowStep === 'returned_to_creator';
            if (workflowBoardFilter === 'watching') {
                return Boolean(currentUserId && subject?.participants?.some(participant =>
                    participant.isActive && participant.role === 'WATCHER' && participant.userId === currentUserId
                ));
            }
            return true;
        });
    }, [currentUserId, requestWorkflowSubjects, sortedRequests, userById, workflowBoardFilter, workflowBoardSearch]);

    const actionCount = useMemo(() => (
        filteredListRequests.filter(request => {
            if (!currentUser) return false;
            return getMaterialRequestNextAction(request, currentUser).isActionable;
        }).length
    ), [currentUser, filteredListRequests]);

    const renderListMode = () => {
        if (filteredListRequests.length === 0) {
            return (
                <EmptyState
                    icon={<Package size={18} />}
                    title="Không có đề xuất vật tư phù hợp"
                    message="Thử xoá bộ lọc hoặc tìm theo mã phiếu, người yêu cầu, người xử lý."
                />
            );
        }

        return (
            <div className="p-4">
                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-700/60 dark:bg-slate-900/30">
                    {filteredListRequests.map(request => {
                    const subject = requestWorkflowSubjects[request.id];
                    const requester = userById.get(request.requesterId);
                    const assigneeIds = subject?.currentAssigneeUserIds?.length
                        ? subject.currentAssigneeUserIds
                        : subject?.currentAssigneeUserId
                            ? [subject.currentAssigneeUserId]
                            : request.submittedToUserId
                                ? [request.submittedToUserId]
                                : [];
                    const handlerNames = assigneeIds.map(id => userById.get(id)?.name || id).filter(Boolean);
                    const handlerLabel = handlerNames.length > 1
                        ? `${handlerNames[0]} + ${handlerNames.length - 1} người`
                        : handlerNames[0] || request.submittedToName || undefined;
                    const statusView = currentUser
                        ? getMaterialRequestNextAction(request, currentUser)
                        : {
                            ...getMaterialRequestStatusView(request.status),
                            nextAction: subject?.currentRuntimeNode?.label || subject?.currentNode?.label || 'Mở phiếu để xem bước xử lý hiện tại.',
                            actionLabel: 'Mở phiếu',
                            isActionable: false,
                        };
                    const summary = requestFulfillmentSummaries[request.id];
                    const overLines = (request.items || []).filter(line =>
                        !line.materialBudgetItemId ||
                        line.isOverBoq ||
                        Number(line.overQty || 0) > 0 ||
                        Number(line.overBudgetQtySnapshot || 0) > 0
                    );
                    const slaState = getMaterialRequestSlaState(request);
                    const materialSummary = `${request.items?.length || 0} dòng vật tư${summary ? ` • nhận ${summary.receivedQty.toLocaleString('vi-VN')}/${summary.committedQty.toLocaleString('vi-VN')}` : ''}`;

                    return (
                        <button
                            key={request.id}
                            type="button"
                            onClick={() => onOpenRequest(request)}
                            className="grid w-full grid-cols-1 gap-3 border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50/70 last:border-b-0 dark:border-slate-800 dark:hover:bg-slate-800/50 lg:grid-cols-[minmax(150px,0.75fr)_minmax(260px,1.35fr)_minmax(170px,0.8fr)_minmax(155px,0.7fr)_auto] lg:items-center"
                        >
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-800 dark:text-white">{request.title || 'Đề xuất vật tư'}</div>
                                <div className="mt-0.5 truncate font-mono text-[10px] font-bold text-purple-600">{request.code} - Đề xuất vật tư</div>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    <StatusBadge status={request.status} label={statusView.label} tone={statusView.tone} />
                                    {slaState === 'overdue' && <StatusBadge status="overdue" label="Quá hạn SLA" tone="attention" />}
                                </div>
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-800 dark:text-white">{materialSummary}</div>
                                <div className="mt-1 line-clamp-2 text-xs font-bold leading-relaxed text-slate-500 dark:text-slate-300">{statusView.nextAction}</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {overLines.length > 0 && <StatusBadge status="warning" label={`${overLines.length} dòng vượt/ngoài BOQ`} tone="attention" />}
                                    {request.overrideReason && <StatusBadge status="warning" label="Có lý do override" tone="warning" />}
                                </div>
                            </div>
                            <div className="min-w-0 text-xs">
                                <div className="font-black text-slate-400">Người yêu cầu</div>
                                <div className="mt-1 truncate font-bold text-slate-700 dark:text-slate-200">{requester?.name || request.requesterId || '-'}</div>
                                {handlerLabel && (
                                    <div className="mt-1 truncate text-[11px] font-bold text-slate-400">Xử lý: {handlerLabel}</div>
                                )}
                            </div>
                            <div className="min-w-0 text-xs">
                                <div className="font-black text-slate-400">Hạn / ngày tạo</div>
                                <div className="mt-1 truncate font-bold text-slate-700 dark:text-slate-200">{formatDate(request.workflowStepDueAt || request.expectedDate || request.createdDate)}</div>
                                <div className="mt-1 truncate text-[11px] font-bold text-slate-400">{formatDate(request.createdDate)}</div>
                            </div>
                            <div className="justify-self-start rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase text-slate-700 transition group-hover:border-purple-200 group-hover:text-purple-700 lg:justify-self-end">
                                {statusView.actionLabel}
                            </div>
                        </button>
                    );
                })}
                </div>
            </div>
        );
    };

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-black text-slate-700"><Package size={16} className="text-purple-500" /> Đề xuất vật tư ({requests.length})</h3>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">Danh sách vận hành nhanh và Kanban SLA theo luồng công trường - phòng vật tư - kho công trường</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                      <button
                          type="button"
                          onClick={() => setViewMode('list')}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                      >
                          <ListChecks size={12} /> Danh sách
                      </button>
                      <button
                          type="button"
                          onClick={() => setViewMode('kanban')}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black ${viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                      >
                          <LayoutGrid size={12} /> Kanban
                      </button>
                  </div>
                  {canCreateMaterialRequest && (
                    <button
                        onClick={onCreateRequest}
                        className="flex items-center gap-1 rounded-xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-[10px] font-bold text-purple-600 hover:bg-purple-100"
                    >
                        <Plus size={12} /> Tạo đề xuất
                    </button>
                  )}
                </div>
            </div>

            <React.Suspense fallback={<LazyPanelFallback label="Đang tải cấu hình workflow..." />}>
                <ProjectWorkflowBindingPanel
                    projectId={projectId || null}
                    constructionSiteId={constructionSiteId || null}
                    templates={workflowTemplates}
                    onConfigurationChange={onConfigurationChange}
                />
            </React.Suspense>

            {!canCreateMaterialRequest && (
                <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-[11px] font-bold text-amber-700">
                    Tài khoản chỉ đang có quyền xem. Muốn tạo/gửi đề xuất cần quyền submit trong Tổ chức dự án.
                </div>
            )}
            {transitioningRequestId && (
                <div className="border-b border-indigo-100 bg-indigo-50 px-5 py-2 text-[11px] font-bold text-indigo-700">
                    Đang cập nhật luồng phiếu {transitioningRequestId.slice(-6)}...
                </div>
            )}

            {requests.length > 0 && (
                <>
                    <React.Suspense fallback={<LazyPanelFallback label="Đang tải hộp việc workflow..." />}>
                        <ProjectWorkflowInbox
                            requests={sortedRequests}
                            subjectsByRequestId={requestWorkflowSubjects}
                            users={users}
                            currentUserId={currentUserId}
                            onOpenRequest={onOpenRequest}
                        />
                        <ProjectWorkflowAnalyticsPanel
                            requests={sortedRequests}
                            subjectsByRequestId={requestWorkflowSubjects}
                            users={users}
                        />
                    </React.Suspense>
                    <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap gap-1.5">
                            {([
                                ['all', 'Tất cả'],
                                ['mine', 'Của tôi'],
                                ['overdue', 'Quá hạn'],
                                ['returned', 'Đã trả lại'],
                                ['watching', 'Theo dõi'],
                            ] as Array<[ProjectWorkflowBoardFilter, string]>).map(([filter, label]) => (
                                <button
                                    key={filter}
                                    type="button"
                                    onClick={() => onWorkflowBoardFilterChange(filter)}
                                    className={`rounded-lg border px-3 py-1.5 text-[10px] font-black transition ${workflowBoardFilter === filter ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="inline-flex items-center gap-1 rounded-lg border border-orange-100 bg-orange-50 px-2.5 py-2 text-[10px] font-black text-orange-700">
                                <AlertTriangle size={12} /> {actionCount} cần xử lý
                            </div>
                            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
                                <input
                                    type="checkbox"
                                    checked={hideEmptyWorkflowLanes}
                                    onChange={event => onHideEmptyWorkflowLanesChange(event.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                                />
                                Chỉ hiện bước có phiếu
                            </label>
                            <div className="flex min-w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <Search size={14} className="shrink-0 text-slate-300" />
                                <input
                                    value={workflowBoardSearch}
                                    onChange={event => onWorkflowBoardSearchChange(event.target.value)}
                                    placeholder="Tìm mã phiếu, người yêu cầu, người xử lý..."
                                    className="w-full border-none bg-transparent text-xs font-bold text-slate-600 outline-none placeholder:text-slate-300"
                                />
                            </div>
                        </div>
                    </div>
                </>
            )}

            {requests.length === 0 ? (
                <div className="p-12 text-center">
                    <Package size={36} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm font-bold text-slate-400">Chưa có phiếu đề xuất vật tư</p>
                    <p className="mt-1 text-[10px] text-slate-300">Tạo đề xuất mới để yêu cầu vật tư từ Kho Tổng</p>
                </div>
            ) : viewMode === 'list' ? (
                renderListMode()
            ) : (
                <React.Suspense fallback={<LazyPanelFallback label="Đang tải kanban đề xuất..." />}>
                    <MaterialRequestKanbanBoard
                        requests={sortedRequests}
                        fulfillmentSummaries={requestFulfillmentSummaries}
                        fulfillmentBatches={requestFulfillmentBatches}
                        eventsByRequest={requestEventsByRequest}
                        transactions={transactions}
                        inventoryItemById={inventoryItemById}
                        workBoqItemById={workBoqItemById}
                        userById={userById}
                        workflowSubjectsByRequestId={requestWorkflowSubjects}
                        workflowNodes={workflowTemplateNodes}
                        workflowRuntimeNodes={workflowRuntimeNodes}
                        currentUserId={currentUserId}
                        boardFilter={workflowBoardFilter}
                        searchTerm={workflowBoardSearch}
                        hideEmptyWorkflowLanes={hideEmptyWorkflowLanes}
                        canMoveRequest={canMoveMaterialRequest}
                        onMoveRequest={onMoveMaterialRequest}
                        onOpenRequest={onOpenRequest}
                    />
                </React.Suspense>
            )}
        </div>
    );
};
