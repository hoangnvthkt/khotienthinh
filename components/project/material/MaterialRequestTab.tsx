import React, { useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Calendar,
    ChevronDown,
    ChevronRight,
    Clock,
    Download,
    FileSpreadsheet,
    LayoutGrid,
    ListChecks,
    Loader2,
    Package,
    Plus,
    Search,
    Upload,
} from 'lucide-react';
import {
    InventoryItem,
    MaterialRequest,
    MaterialRequestEvent,
    MaterialRequestFulfillmentBatch,
    MaterialRequestFulfillmentSummary,
    MaterialRequestKanbanLaneId,
    ProjectWorkflowBoardFilter,
    RequestItem,
    RequestStatus,
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
import { getMaterialRequestSlaState, materialRequestService } from '../../../lib/materialRequestService';
import { matchesSearchQueryMultiple } from '../../../lib/searchUtils';
import { useApp } from '../../../context/AppContext';
import { useToast } from '../../../context/ToastContext';
import {
    generateMaterialRequestTemplate,
    parseMaterialRequestExcel,
    type MaterialRequestColumnMapping,
    type MaterialRequestImportGroup,
    type MaterialRequestImportPreview,
    type MaterialRequestImportRow,
} from '../../../lib/materialRequestImportService';
import { MaterialRequestImportPreviewModal } from './MaterialRequestImportPreviewModal';
import { MaterialRequestColumnMapModal } from './MaterialRequestColumnMapModal';

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
    const { addRequest, warehouses } = useApp();
    const toast = useToast();

    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('kanban');
    const [importPreview, setImportPreview] = useState<MaterialRequestImportPreview | null>(null);
    const [importStep, setImportStep] = useState<'none' | 'column_mapping' | 'preview'>('none');
    const [selectedFileBuffer, setSelectedFileBuffer] = useState<ArrayBuffer | null>(null);
    const [selectedFileName, setSelectedFileName] = useState<string>('');
    const [isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const workflowTemplateNodes = workflowConfiguration?.binding
        ? workflowNodes.filter(node => node.templateId === workflowConfiguration.binding?.workflowTemplateId)
        : [];
    const currentUser = userById.get(currentUserId) || users.find(item => item.id === currentUserId);

    const handleDownloadTemplate = async () => {
        try {
            await generateMaterialRequestTemplate();
            toast.success('Đã tải xuống file mẫu Đề xuất vật tư thành công!');
        } catch (err: any) {
            toast.error('Lỗi khi tải file mẫu', err?.message || String(err));
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const buffer = await file.arrayBuffer();
            setSelectedFileBuffer(buffer);
            setSelectedFileName(file.name);

            const inventoryItemsList = Array.from(inventoryItemById.values());
            const workBoqItemsList = Array.from(workBoqItemById.values());

            const preview = await parseMaterialRequestExcel(
                buffer,
                file.name,
                inventoryItemsList,
                workBoqItemsList,
                warehouses
            );

            setImportPreview(preview);

            // If required fields were auto-mapped confidently, go straight to preview; else open column mapping step
            if (preview.fileStructure.isAutoMapped) {
                setImportStep('preview');
            } else {
                setImportStep('column_mapping');
            }
        } catch (err: any) {
            toast.error('Lỗi đọc file Excel', err?.message || String(err));
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleCustomMappingConfirm = async (newMapping: MaterialRequestColumnMapping) => {
        if (!selectedFileBuffer) return;

        try {
            const inventoryItemsList = Array.from(inventoryItemById.values());
            const workBoqItemsList = Array.from(workBoqItemById.values());

            const preview = await parseMaterialRequestExcel(
                selectedFileBuffer,
                selectedFileName,
                inventoryItemsList,
                workBoqItemsList,
                warehouses,
                newMapping
            );

            setImportPreview(preview);
            setImportStep('preview');
        } catch (err: any) {
            toast.error('Lỗi khi áp dụng ánh xạ cột mới', err?.message || String(err));
        }
    };

    const handleConfirmImport = async (
        validRows: MaterialRequestImportRow[],
        importGroups: MaterialRequestImportGroup[],
        selectedSiteWarehouseId: string
    ) => {
        if (importGroups.length === 0) return;

        setIsImporting(true);
        let createdCount = 0;

        try {
            const targetWarehouseId = selectedSiteWarehouseId || warehouses[0]?.id || '';

            for (const group of importGroups) {
                if (group.rows.length === 0) continue;

                let nextCode = `MR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
                try {
                    nextCode = await materialRequestService.nextCode();
                } catch {
                    // Fallback local format if RPC fails
                }

                const requestItems: RequestItem[] = group.rows.map(row => ({
                    lineId: `line-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    itemId: row.matchedInventoryItem?.id || row.materialCode || `custom-${Date.now()}`,
                    requestQty: row.requestQty,
                    approvedQty: row.requestQty,
                    workBoqItemId: row.matchedWorkBoqItem?.id || null,
                    workBoqItemName: row.matchedWorkBoqItem?.name || null,
                    neededDate: row.neededDate,
                    note: row.note,
                    isOverBoq: row.isOverBoq,
                    overQty: row.overQty,
                }));

                const validDates = group.rows.map(r => r.neededDate).filter(Boolean) as string[];
                const expectedDate = validDates.length > 0
                    ? validDates.sort().reverse()[0]
                    : new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

                const newRequest: MaterialRequest = {
                    id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    code: nextCode,
                    title: group.requestTitle,
                    projectId: projectId || null,
                    constructionSiteId: constructionSiteId || null,
                    requestOrigin: 'project',
                    siteWarehouseId: group.rows[0]?.matchedSiteWarehouseId || targetWarehouseId,
                    requesterId: currentUserId,
                    status: RequestStatus.DRAFT,
                    items: requestItems,
                    createdDate: new Date().toISOString(),
                    date: new Date().toISOString().split('T')[0],
                    expectedDate,
                    note: `Nhập hàng loạt từ Excel: ${importPreview?.fileName || ''}`,
                    logs: [],
                };

                const success = await addRequest(newRequest);
                if (success) {
                    createdCount++;
                }
            }

            toast.success(`Đã tạo thành công ${createdCount} phiếu đề xuất vật tư với ${validRows.length} dòng vật tư!`);
            setImportPreview(null);
            setImportStep('none');
            setSelectedFileBuffer(null);
        } catch (err: any) {
            toast.error('Lỗi khi tạo phiếu đề xuất vật tư', err?.message || String(err));
        } finally {
            setIsImporting(false);
        }
    };

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
            <div className="p-4 space-y-3">
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
                    const overLines = (request.items || []).filter(line =>
                        !line.materialBudgetItemId ||
                        line.isOverBoq ||
                        Number(line.overQty || 0) > 0
                    );
                    const requesterName = requester?.name || request.requestedBy || 'Không rõ';
                    const initials = requesterName.split(' ').slice(-2).map(part => part[0]).join('').toUpperCase() || 'MR';

                    return (
                        <button
                            key={request.id}
                            type="button"
                            onClick={() => onOpenRequest(request)}
                            className="group flex w-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md dark:border-slate-700/80 dark:bg-slate-850 dark:hover:border-indigo-900/60 lg:flex-row lg:items-center"
                        >
                            <div className="space-y-1.5 min-w-0 pr-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs font-black text-indigo-650 dark:text-indigo-400">
                                        {request.code}
                                    </span>
                                    <StatusBadge status={request.status} label={statusView.label} tone={statusView.tone} />
                                </div>
                                <div className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">
                                    {request.title || 'Phiếu đề xuất vật tư'}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-medium text-slate-500">
                                        {request.items?.length || 0} đầu mục vật tư
                                    </span>
                                    {overLines.length > 0 && (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-650 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200/60 dark:border-amber-900/60">
                                            <AlertTriangle size={10} /> {overLines.length} vật tư vượt BOQ
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center space-x-3 mt-3 lg:mt-0">
                                <div className="text-right">
                                    <div className="text-[10px] font-bold text-slate-400">Người yêu cầu</div>
                                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{requesterName}</div>
                                </div>
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 font-bold text-indigo-600 text-xs dark:bg-indigo-950/50 dark:text-indigo-400">
                                    {initials}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
            {/* Hidden Excel File Input */}
            <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx, .xls"
                onChange={handleFileSelect}
                className="hidden"
            />

            <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
                        <Package size={16} className="text-emerald-600" /> Đề xuất vật tư ({requests.length})
                    </h3>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                        Danh sách vận hành nhanh và Kanban SLA theo luồng công trường - phòng vật tư - kho công trường
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black ${
                                viewMode === 'list'
                                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                            }`}
                        >
                            <ListChecks size={12} /> Danh sách
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('kanban')}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black ${
                                viewMode === 'kanban'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                            }`}
                        >
                            <LayoutGrid size={12} /> Kanban
                        </button>
                    </div>

                    <React.Suspense fallback={null}>
                        <ProjectWorkflowBindingPanel
                            projectId={projectId || null}
                            constructionSiteId={constructionSiteId || null}
                            templates={workflowTemplates}
                            onConfigurationChange={onConfigurationChange}
                        />
                    </React.Suspense>

                    {canCreateMaterialRequest && (
                        <>
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                className="flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 transition-all"
                                title="Tải xuống file Excel mẫu để nhập hàng loạt"
                            >
                                <FileSpreadsheet size={12} /> Tải mẫu Excel
                            </button>

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 transition-all"
                                title="Tải file Excel đề xuất vật tư (hỗ trợ cả file mẫu lẫn file tự do)"
                            >
                                <Upload size={12} /> Nhập từ Excel
                            </button>

                            <button
                                type="button"
                                onClick={onCreateRequest}
                                className="flex items-center gap-1 rounded-xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-[10px] font-bold text-purple-600 hover:bg-purple-100 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-900/60 transition-all"
                            >
                                <Plus size={12} /> Tạo đề xuất
                            </button>
                        </>
                    )}
                </div>
            </div>

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

            {requests.length === 0 ? (
                <div className="p-12 text-center">
                    <Package size={36} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm font-bold text-slate-400">Chưa có phiếu đề xuất vật tư</p>
                    <p className="mt-1 text-[10px] text-slate-300">Tạo đề xuất mới hoặc nhập hàng loạt từ Excel</p>
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

            {/* Bước 1: Modal Ánh xạ Cột Column Mapping (Hiển thị khi file tự do hoặc người dùng muốn chỉnh lại cột) */}
            {importStep === 'column_mapping' && importPreview && (
                <MaterialRequestColumnMapModal
                    fileStructure={importPreview.fileStructure}
                    activeMapping={importPreview.activeMapping}
                    onCancel={() => {
                        setImportStep('none');
                        setImportPreview(null);
                        setSelectedFileBuffer(null);
                    }}
                    onConfirmMapping={handleCustomMappingConfirm}
                />
            )}

            {/* Bước 2: Modal Import Preview Xem trước & Kiểm tra lỗi */}
            {importStep === 'preview' && importPreview && (
                <MaterialRequestImportPreviewModal
                    importPreview={importPreview}
                    isImporting={isImporting}
                    warehouses={warehouses}
                    onCancel={() => {
                        setImportStep('none');
                        setImportPreview(null);
                        setSelectedFileBuffer(null);
                    }}
                    onOpenColumnMapping={() => setImportStep('column_mapping')}
                    onConfirm={handleConfirmImport}
                />
            )}
        </div>
    );
};
