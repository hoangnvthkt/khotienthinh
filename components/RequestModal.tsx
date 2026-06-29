
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { X, Send, CheckCircle, Trash2, Info, Truck, PackageCheck, AlertCircle, XCircle, Plus, User, Loader2, Save, FileDown, Clock, ChevronDown, ChevronUp, ChevronRight, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import {
    MaterialBudgetItem,
    MaterialRequest,
    MaterialRequestFulfillmentMode,
    MaterialRequestOrigin,
    ProjectWorkBoqItem,
    ProjectSubmissionTarget,
    ProjectWorkflowActionContext,
    ProjectWorkflowSubject,
    WorkflowNode,
    WorkflowStepAssignment,
    MaterialRequestFulfillmentBatch,
    MaterialRequestFulfillmentSummary,
    MaterialRequestFulfillmentSourceType,
    RequestItem,
    RequestStatus,
    InventoryItem,
    Transaction,
    TransactionStatus,
    TransactionType,
    MaterialRequestMaterialGroupSnapshotData,
} from '../types';
import ItemSelectionModal from './ItemSelectionModal';
import ProjectSubmissionDialog from './project/ProjectSubmissionDialog';
import ProjectWorkflowPanel from './project/ProjectWorkflowPanel';
import ProjectWorkflowCommentsPanel from './project/ProjectWorkflowCommentsPanel';
import ProjectWorkflowStartDialog from './project/ProjectWorkflowStartDialog';
import MaterialIssuePanel from './project/MaterialIssuePanel';
import { useReservedStock } from '../hooks/useReservedStock';
import { canApproveMaterialRequest, canApproveWmsTransaction, canExportMaterialRequest, canReceiveMaterialRequest, canReceiveWmsTransaction, isAdmin, isGlobalWarehouseKeeper, isWarehouseKeeperFor } from '../lib/wmsPermissions';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { projectSubmissionService } from '../lib/projectSubmissionService';
import { projectWorkflowService } from '../lib/projectWorkflowService';
import { getMaterialRequestWorkflowPatch, materialRequestService } from '../lib/materialRequestService';
import { materialRequestFulfillmentService, getCommittedQty, getRequestLineId } from '../lib/materialRequestFulfillmentService';
import { buildFulfillmentBatchReceiveUrl } from '../lib/fulfillmentBatchQr';
import { formatReservationSourceList } from '../lib/inventoryStockGuard';
import { getMaterialIssueDraftQty } from '../lib/materialRequestIssueDraft';
import { BoqSummaryStrip } from './erp';

const ScannerModal = React.lazy(() => import('./ScannerModal'));

const formatFullDateTime = (isoString?: string | null) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toDatetimeLocalString = (isoString?: string | null) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toISOStringFromLocal = (localString?: string | null) => {
    if (!localString) return '';
    const d = new Date(localString);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
};

interface RequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    request?: MaterialRequest;
    defaultSiteWarehouseId?: string; // Pre-fill when opened from Project module
    projectId?: string | null;
    constructionSiteId?: string | null;
    requestOrigin?: MaterialRequestOrigin;
    workBoqItems?: ProjectWorkBoqItem[];
    materialBudgetItems?: MaterialBudgetItem[];
    requestFulfillmentSummariesByRequestId?: Record<string, MaterialRequestFulfillmentSummary>;
    initialDraft?: MaterialRequestInitialDraft | null;
    initialAction?: 'createFulfillmentBatch';
    canProcessProjectWorkflow?: boolean;
    canManageProjectWorkflow?: boolean;
    projectWorkflowSubject?: ProjectWorkflowSubject;
    projectWorkflowAssignments?: WorkflowStepAssignment[];
    projectWorkflowNodes?: WorkflowNode[];
    projectWorkflowNextNode?: WorkflowNode | null;
    projectWorkflowReturnTargetNode?: WorkflowNode | null;
    canViewAvailableStock?: boolean;
    onProjectWorkflowAction?: (context: ProjectWorkflowActionContext) => void | Promise<void>;
    onSaved?: (request: MaterialRequest) => void;
    onDeleted?: (requestId: string) => void;
}

export type MaterialRequestInitialDraft = {
    title?: string;
    workBoqItemId?: string | null;
    note?: string;
    neededDate?: string;
    lines: Array<{
        materialBudgetItemId?: string | null;
        itemId?: string | null;
        qty: number;
        neededDate?: string;
        note?: string;
        overBudgetReason?: string;
        materialGroupKey?: string | null;
        materialGroupSource?: 'summary_aggregate' | string | null;
        materialGroupSnapshot?: MaterialRequestMaterialGroupSnapshotData | null;
    }>;
};

type RequestLineDraft = {
    lineId: string;
    itemId: string;
    qty: number;
    workBoqItemId?: string | null;
    workBoqItemName?: string | null;
    materialBudgetItemId?: string | null;
    materialBudgetItemName?: string | null;
    neededDate?: string;
    note?: string;
    overBudgetReason?: string;
    isManualItem?: boolean;
    itemNameSnapshot?: string;
    unitSnapshot?: string;
    skuSnapshot?: string;
    specification?: string;
    manualReason?: string;
    materialGroupKey?: string | null;
    materialGroupSource?: 'summary_aggregate' | string | null;
    materialGroupSnapshot?: MaterialRequestMaterialGroupSnapshotData | null;
};

type RequestDisplayRow = RequestLineDraft | RequestItem;

type RequestDisplaySource = {
    row: RequestDisplayRow;
    index: number;
    requestQty: number;
    approvedQty: number;
    issuedQty: number;
    receivedQty: number;
    remainingToReceive: number;
    isExcess: boolean;
};

type RequestDisplayGroup = {
    key: string;
    itemId: string;
    name: string;
    sku: string;
    unit: string;
    specification?: string;
    sources: RequestDisplaySource[];
    requestQty: number;
    approvedQty: number;
    issuedQty: number;
    receivedQty: number;
    remainingToReceive: number;
    isExcess: boolean;
};

type FulfillmentQtyDraft = {
    requestLineId: string;
    itemId: string;
    qty: string;
    reason: string;
};

type ReceiveQtyDraft = {
    lineId: string;
    qty: string;
    reason: string;
};

type ReceivePanelMode = 'quality_review' | 'receipt';

const budgetHoldingStatuses = new Set<RequestStatus | string>([
    RequestStatus.DRAFT,
    RequestStatus.PENDING,
    RequestStatus.APPROVED,
    RequestStatus.IN_TRANSIT,
    RequestStatus.LEGACY_PENDING,
    RequestStatus.LEGACY_APPROVED,
]);

const budgetCompletedStatuses = new Set<RequestStatus | string>([
    RequestStatus.COMPLETED,
]);

type BudgetReservationSource = {
    requestId: string;
    code: string;
    qty: number;
    status: RequestStatus | string;
    statusLabel: string;
    requesterName: string;
    isCompleted: boolean;
};

const toDraftLine = (item: RequestItem): RequestLineDraft => ({
    lineId: item.lineId || crypto.randomUUID(),
    itemId: item.itemId,
    qty: Number(item.requestQty || 0),
    workBoqItemId: item.workBoqItemId || null,
    workBoqItemName: item.workBoqItemName || null,
    materialBudgetItemId: item.materialBudgetItemId || null,
    materialBudgetItemName: item.materialBudgetItemName || null,
    neededDate: item.neededDate || '',
    note: item.note || '',
    overBudgetReason: item.overBudgetReason || item.overReason || '',
    isManualItem: item.isManualItem || false,
    itemNameSnapshot: item.itemNameSnapshot || '',
    unitSnapshot: item.unitSnapshot || '',
    skuSnapshot: item.skuSnapshot || '',
    specification: item.specification || '',
    manualReason: item.manualReason || '',
    materialGroupKey: item.materialGroupKey || null,
    materialGroupSource: item.materialGroupSource || null,
    materialGroupSnapshot: item.materialGroupSnapshot || null,
});

const RequestModal: React.FC<RequestModalProps> = ({
    isOpen,
    onClose,
    request,
    defaultSiteWarehouseId,
    projectId,
    constructionSiteId,
    requestOrigin,
    workBoqItems = [],
    materialBudgetItems = [],
    requestFulfillmentSummariesByRequestId = {},
    initialDraft = null,
    initialAction,
    canProcessProjectWorkflow = false,
    canManageProjectWorkflow = false,
    projectWorkflowSubject,
    projectWorkflowAssignments = [],
    projectWorkflowNodes = [],
    projectWorkflowNextNode,
    projectWorkflowReturnTargetNode,
    canViewAvailableStock = false,
    onProjectWorkflowAction,
    onSaved,
    onDeleted,
}) => {
    const { items, warehouses, user, users, employees, orgUnits, requests, transactions, addRequest, updateRequestStatus, removeRequest, refreshWmsRecords, addTransaction, updateTransactionStatus } = useApp();
    const { getStockSummary, getOnHandStock } = useReservedStock();
    const toast = useToast();
    const confirm = useConfirm();
    const [step, setStep] = useState<'CREATE' | 'APPROVE' | 'VIEW'>('CREATE');
    const [showApprovalPanel, setShowApprovalPanel] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form State
    const [requestTitle, setRequestTitle] = useState('');
    const [siteWarehouseId, setSiteWarehouseId] = useState('');
    const [sourceWarehouseId, setSourceWarehouseId] = useState('');
    const [stockPreviewWarehouseId, setStockPreviewWarehouseId] = useState('');
    const [note, setNote] = useState('');
    const [expectedDate, setExpectedDate] = useState('');
    const [fulfillmentMode, setFulfillmentMode] = useState<MaterialRequestFulfillmentMode>(MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
    const [overrideReason, setOverrideReason] = useState('');
    const [reqItems, setReqItems] = useState<RequestLineDraft[]>([]);
    const [approvedItems, setApprovedItems] = useState<{ lineId?: string, itemId: string, qty: number }[]>([]);
    const [selectedWorkBoqItemIds, setSelectedWorkBoqItemIds] = useState<Set<string>>(() => new Set());
    const [boqSectionExpanded, setBoqSectionExpanded] = useState(false);
    const [draftWorkBoqSearch, setDraftWorkBoqSearch] = useState('');
    const [isWorkBoqSearchOpen, setWorkBoqSearchOpen] = useState(false);
    const [selectedMaterialBudgetIds, setSelectedMaterialBudgetIds] = useState<Set<string>>(() => new Set());
    const [draftBudgetQtyById, setDraftBudgetQtyById] = useState<Record<string, string>>({});
    const [draftNeededDate, setDraftNeededDate] = useState('');
    const [draftLineNote, setDraftLineNote] = useState('');
    const [submittingProjectRequest, setSubmittingProjectRequest] = useState<MaterialRequest | null>(null);
    const [fulfillmentBatches, setFulfillmentBatches] = useState<MaterialRequestFulfillmentBatch[]>([]);
    const [isLoadingFulfillment, setIsLoadingFulfillment] = useState(false);
    const [isIssuePanelOpen, setIsIssuePanelOpen] = useState(false);
    const [isExternalIssuePanelOpen, setIsExternalIssuePanelOpen] = useState(false);
    const initialActionHandledRef = useRef(false);
    const [issueSourceType, setIssueSourceType] = useState<MaterialRequestFulfillmentSourceType>('stock');
    const [issueLines, setIssueLines] = useState<FulfillmentQtyDraft[]>([]);
    const [issueNote, setIssueNote] = useState('');
    const [receivingBatch, setReceivingBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
    const [receivePanelMode, setReceivePanelMode] = useState<ReceivePanelMode>('receipt');
    const [selectedFulfillmentBatch, setSelectedFulfillmentBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
    const [receiveLines, setReceiveLines] = useState<ReceiveQtyDraft[]>([]);
    const [returningReceivedBatch, setReturningReceivedBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
    const [returnDestinationWarehouseId, setReturnDestinationWarehouseId] = useState('');
    const [returnReceivedReason, setReturnReceivedReason] = useState('');
    const [expandedMaterialGroupKeys, setExpandedMaterialGroupKeys] = useState<Set<string>>(() => new Set());
    const [poSourceLabelsById, setPoSourceLabelsById] = useState<Record<string, string>>({});

    useEffect(() => {
        if (isOpen) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [isOpen]);

    const [isItemSelectOpen, setItemSelectOpen] = useState(false);
    const [isScannerOpen, setScannerOpen] = useState(false);

    const isProjectRequest = requestOrigin === 'project' || request?.requestOrigin === 'project' || !!projectId || !!constructionSiteId;
    const effectiveProjectId = projectId || request?.projectId || null;
    const effectiveConstructionSiteId = constructionSiteId || request?.constructionSiteId || null;
    const isProjectWorkflowReviewStep = !!request
        && isProjectRequest
        && request.status === RequestStatus.PENDING
        && (
            projectWorkflowSubject?.status === 'RUNNING'
            || request.workflowStep === 'site_manager_review'
            || request.workflowStep === 'material_department_review'
        );
    const canReviewProjectWorkflow = isProjectWorkflowReviewStep && canProcessProjectWorkflow;
    const canPlanProjectFulfillment = !!request
        && isProjectRequest
        && request.status === RequestStatus.APPROVED
        && (request.workflowStep === 'batch_planning' || !request.workflowStep)
        && (
            request.submittedToUserId === user.id
            || canProcessProjectWorkflow
            || canManageProjectWorkflow
        );
    const workBoqMap = useMemo(() => new Map(workBoqItems.map(item => [item.id, item])), [workBoqItems]);
    const materialBudgetMap = useMemo(() => new Map(materialBudgetItems.map(item => [item.id, item])), [materialBudgetItems]);
    const getWorkBoqLabel = (item?: ProjectWorkBoqItem | null) => item
        ? `${item.wbsCode ? `${item.wbsCode} - ` : ''}${item.name}`
        : '';
    const selectedWorkBoqItems = useMemo(
        () => Array.from(selectedWorkBoqItemIds).map(id => workBoqMap.get(id)).filter((item): item is ProjectWorkBoqItem => Boolean(item)),
        [selectedWorkBoqItemIds, workBoqMap],
    );
    const selectedWorkBoqLabel = selectedWorkBoqItems.length === 1
        ? getWorkBoqLabel(selectedWorkBoqItems[0])
        : selectedWorkBoqItems.length > 1
            ? `${selectedWorkBoqItems.length} đầu mục công việc đã chọn`
            : 'Chọn đầu mục công việc để xem vật tư';
    const workBoqSearchOptions = useMemo(() => {
        const query = draftWorkBoqSearch.trim().toLowerCase();
        const candidates = query
            ? workBoqItems.filter(item => getWorkBoqLabel(item).toLowerCase().includes(query))
            : workBoqItems;
        return candidates.slice(0, 12);
    }, [draftWorkBoqSearch, workBoqItems]);
    const budgetOptions = useMemo(
        () => materialBudgetItems
            .filter(item => selectedWorkBoqItemIds.size > 0 && !!item.workBoqItemId && selectedWorkBoqItemIds.has(item.workBoqItemId))
            .filter(item => Number(item.budgetQty || 0) > 0),
        [materialBudgetItems, selectedWorkBoqItemIds],
    );

    const getRequestStatusLabel = (status: RequestStatus | string) => {
        switch (status) {
            case RequestStatus.DRAFT: return 'Nháp';
            case RequestStatus.PENDING:
            case RequestStatus.LEGACY_PENDING: return 'Chờ duyệt';
            case RequestStatus.APPROVED:
            case RequestStatus.LEGACY_APPROVED: return 'Chờ tạo đợt cấp';
            case RequestStatus.IN_TRANSIT: return 'Đang cấp';
            case RequestStatus.COMPLETED: return 'Đã nhận';
            case RequestStatus.REJECTED: return 'Từ chối';
            default: return String(status || '-');
        }
    };

    const isSameBudgetScope = (req: MaterialRequest) => {
        if (effectiveProjectId) return req.projectId === effectiveProjectId;
        if (effectiveConstructionSiteId) return req.constructionSiteId === effectiveConstructionSiteId;
        return true;
    };

    const getCompletedReceivedQtyForBudgetLine = (req: MaterialRequest, line: RequestItem, lineIndex: number) => {
        const summary = requestFulfillmentSummariesByRequestId[req.id];
        if (summary) {
            const requestLineId = getRequestLineId(req, line, lineIndex);
            const lineSummary = summary.lineSummaries.find(item => item.requestLineId === requestLineId);
            return Number(lineSummary?.receivedQty || 0);
        }
        return Number((line as any).receivedQty ?? line.issuedQty ?? line.approvedQty ?? line.requestQty ?? 0);
    };

    const getBudgetReservationSources = (materialBudgetItemId?: string | null, excludeRequestId?: string): BudgetReservationSource[] => {
        if (!materialBudgetItemId) return [];
        return requests
            .filter(req => req.id !== excludeRequestId)
            .filter(isSameBudgetScope)
            .filter(req => budgetHoldingStatuses.has(req.status) || budgetCompletedStatuses.has(req.status))
            .flatMap(req => (req.items || []).map((line, index) => ({ req, line, index })))
            .filter(({ line }) => line.materialBudgetItemId === materialBudgetItemId)
            .map(({ req, line, index }) => {
                const isCompleted = budgetCompletedStatuses.has(req.status);
                const qty = isCompleted
                    ? getCompletedReceivedQtyForBudgetLine(req, line, index)
                    : Number(line.requestQty || 0);
                return {
                    requestId: req.id,
                    code: req.code,
                    qty,
                    status: req.status,
                    statusLabel: getRequestStatusLabel(req.status),
                    requesterName: users.find(item => item.id === req.requesterId)?.name || req.requesterId || '-',
                    isCompleted,
                };
            })
            .filter(source => source.qty > 0);
    };

    const getBudgetReservationSnapshot = (materialBudgetItemId?: string | null, excludeRequestId?: string) => {
        const budget = materialBudgetItemId ? materialBudgetMap.get(materialBudgetItemId) : undefined;
        const budgetQty = Number(budget?.budgetQty || 0);
        const sources = getBudgetReservationSources(materialBudgetItemId, excludeRequestId);
        const reservedQty = sources.reduce((sum, source) => sum + source.qty, 0);
        return {
            budget,
            budgetQty,
            sources,
            pendingSources: sources.filter(source => !source.isCompleted),
            completedSources: sources.filter(source => source.isCompleted),
            reservedQty,
            availableQty: budgetQty - reservedQty,
        };
    };

    const getDraftRequestedQty = (materialBudgetItemId?: string | null, excludeLineId?: string) => {
        if (!materialBudgetItemId) return 0;
        return reqItems
            .filter(line => line.lineId !== excludeLineId && line.materialBudgetItemId === materialBudgetItemId)
            .reduce((sum, line) => sum + Number(line.qty || 0), 0);
    };

    const buildLineBudgetSnapshot = (line: RequestLineDraft, excludeRequestId?: string, draftBeforeQtyOverride?: number) => {
        const budget = line.materialBudgetItemId ? materialBudgetMap.get(line.materialBudgetItemId) : undefined;
        const reservation = getBudgetReservationSnapshot(line.materialBudgetItemId, excludeRequestId);
        const previousRequested = reservation.reservedQty;
        const draftRequested = draftBeforeQtyOverride ?? getDraftRequestedQty(line.materialBudgetItemId, line.lineId);
        const budgetQty = reservation.budgetQty;
        const reservedBeforeQty = previousRequested + draftRequested;
        const totalRequested = reservedBeforeQty + Number(line.qty || 0);
        const overBeforeQty = budgetQty > 0 ? Math.max(0, reservedBeforeQty - budgetQty) : 0;
        const overAfterQty = budgetQty > 0 ? Math.max(0, totalRequested - budgetQty) : 0;
        const overBudgetQty = Math.max(0, overAfterQty - overBeforeQty);
        return {
            budget,
            previousRequested,
            reservedQty: previousRequested,
            reservedBeforeQty,
            availableQty: budgetQty - reservedBeforeQty,
            pendingSources: reservation.pendingSources,
            totalRequested,
            budgetQty,
            overBudgetQty,
            overBudgetPercent: budgetQty > 0 ? (overBudgetQty / budgetQty) * 100 : 0,
        };
    };

    const buildSequentialLineBudgetSnapshots = (lines: RequestLineDraft[], excludeRequestId?: string) => {
        const runningDraftQtyByBudget = new Map<string, number>();
        return new Map(lines.map(line => {
            const budgetId = line.materialBudgetItemId || '';
            const draftBeforeQty = budgetId ? runningDraftQtyByBudget.get(budgetId) || 0 : 0;
            const snapshot = buildLineBudgetSnapshot(line, excludeRequestId, draftBeforeQty);
            if (budgetId) runningDraftQtyByBudget.set(budgetId, draftBeforeQty + Number(line.qty || 0));
            return [line.lineId, snapshot] as const;
        }));
    };

    const getNewLineBudgetSnapshot = (materialBudgetItemId?: string | null, currentQty = 0, excludeRequestId?: string) => {
        const reservation = getBudgetReservationSnapshot(materialBudgetItemId, excludeRequestId);
        const draftRequested = getDraftRequestedQty(materialBudgetItemId);
        const reservedBeforeQty = reservation.reservedQty + draftRequested;
        const totalRequested = reservedBeforeQty + Number(currentQty || 0);
        const budgetQty = reservation.budgetQty;
        const overBeforeQty = budgetQty > 0 ? Math.max(0, reservedBeforeQty - budgetQty) : 0;
        const overAfterQty = budgetQty > 0 ? Math.max(0, totalRequested - budgetQty) : 0;
        return {
            ...reservation,
            previousRequested: reservation.reservedQty,
            reservedBeforeQty,
            totalRequested,
            availableQty: budgetQty - reservedBeforeQty,
            overBudgetQty: Math.max(0, overAfterQty - overBeforeQty),
            overBudgetPercent: budgetQty > 0 ? (Math.max(0, overAfterQty - overBeforeQty) / budgetQty) * 100 : 0,
            overAfterQty,
        };
    };

    const getLineInventory = (itemId?: string) => items.find(i => i.id === itemId);

    const getLineName = (line: Partial<RequestLineDraft | RequestItem>) => {
        const inventory = getLineInventory(line.itemId);
        return inventory?.name || line.itemNameSnapshot || line.materialBudgetItemName || line.itemId || 'Dòng chưa có mã kho';
    };

    const getLineUnit = (line: Partial<RequestLineDraft | RequestItem>) => {
        const inventory = getLineInventory(line.itemId);
        return inventory?.unit || line.unitSnapshot || '';
    };

    const getLineSku = (line: Partial<RequestLineDraft | RequestItem>) => {
        const inventory = getLineInventory(line.itemId);
        return inventory?.sku || line.skuSnapshot || (line.isManualItem ? 'CHƯA MÃ' : '');
    };

    const buildDraftLineFromBudget = (budget: MaterialBudgetItem, qty: number, neededDate?: string, note?: string): RequestLineDraft | null => {
        const inventoryItem = items.find(item =>
            item.id === budget.inventoryItemId ||
            (!!budget.materialCode && item.sku.toLowerCase() === budget.materialCode.toLowerCase()) ||
            item.name.toLowerCase() === budget.itemName.toLowerCase()
        );
        if (!inventoryItem) return null;
        const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
        return {
            lineId: crypto.randomUUID(),
            itemId: inventoryItem.id,
            qty: Math.max(0, Number(qty || 0)),
            workBoqItemId: budget.workBoqItemId || initialDraft?.workBoqItemId || null,
            workBoqItemName: work?.name || '',
            materialBudgetItemId: budget.id,
            materialBudgetItemName: budget.itemName,
            neededDate: neededDate || initialDraft?.neededDate || '',
            note: note || '',
            isManualItem: false,
            itemNameSnapshot: inventoryItem.name,
            unitSnapshot: inventoryItem.unit,
            skuSnapshot: inventoryItem.sku,
            specification: budget.notes || '',
            overBudgetReason: '',
        };
    };

    const buildDraftLineFromInitialLine = (line: MaterialRequestInitialDraft['lines'][number]): RequestLineDraft | null => {
        if (line.materialBudgetItemId) {
            const budget = materialBudgetMap.get(line.materialBudgetItemId);
            return budget ? buildDraftLineFromBudget(budget, line.qty, line.neededDate, line.note) : null;
        }
        if (!line.itemId) return null;
        const inventoryItem = items.find(item => item.id === line.itemId);
        if (!inventoryItem) return null;
        return {
            lineId: crypto.randomUUID(),
            itemId: inventoryItem.id,
            qty: Math.max(0, Number(line.qty || 0)),
            workBoqItemId: initialDraft?.workBoqItemId || null,
            workBoqItemName: '',
            materialBudgetItemId: null,
            materialBudgetItemName: null,
            neededDate: line.neededDate || initialDraft?.neededDate || '',
            note: line.note || '',
            overBudgetReason: line.overBudgetReason || '',
            isManualItem: false,
            itemNameSnapshot: inventoryItem.name,
            unitSnapshot: inventoryItem.unit,
            skuSnapshot: inventoryItem.sku,
            specification: '',
            materialGroupKey: line.materialGroupKey || line.materialGroupSnapshot?.materialGroupKey || null,
            materialGroupSource: line.materialGroupSource || null,
            materialGroupSnapshot: line.materialGroupSnapshot || null,
        };
    };

    const getWarehouseName = (warehouseId?: string | null) =>
        warehouses.find(w => w.id === warehouseId)?.name || warehouseId || '-';

    const getBatchPoIds = (batch?: MaterialRequestFulfillmentBatch | null) =>
        Array.from(new Set((batch?.lines || []).map(line => line.poId).filter(Boolean) as string[]));

    const getFulfillmentPoSourceLabel = (batch: MaterialRequestFulfillmentBatch) => {
        const labels = getBatchPoIds(batch).map(poId => poSourceLabelsById[poId]).filter(Boolean);
        if (labels.length > 0) return Array.from(new Set(labels)).join(', ');
        if (batch.note?.toLowerCase().includes('po')) return batch.note;
        return 'Nhà cung cấp / PO';
    };

    const getFulfillmentSourceLabel = (batch?: MaterialRequestFulfillmentBatch | null) => {
        if (!batch) return '-';
        if (batch.sourceWarehouseId) return getWarehouseName(batch.sourceWarehouseId);
        if (batch.sourceType === 'po_receipt') return getFulfillmentPoSourceLabel(batch);
        if (batch.sourceType === 'mixed') return 'Nguồn kết hợp';
        return 'Chưa xác định nguồn';
    };

    const getAggregateStockSummary = (itemId: string, warehouseId?: string, excludeRequestId?: string) => {
        if (!getLineInventory(itemId)) {
            return { onHand: 0, softReserved: 0, hardReserved: 0, reserved: 0, available: 0, hasConflict: false, isCritical: false };
        }
        if (warehouseId) return getStockSummary(itemId, warehouseId, { excludeRequestId });
        return warehouses.reduce((sum, warehouse) => {
            const summary = getStockSummary(itemId, warehouse.id, { excludeRequestId });
            return {
                onHand: sum.onHand + summary.onHand,
                softReserved: sum.softReserved + summary.softReserved,
                hardReserved: sum.hardReserved + summary.hardReserved,
                reserved: sum.reserved + summary.reserved,
                available: sum.available + summary.available,
                hasConflict: sum.hasConflict || summary.hasConflict,
                isCritical: false,
            };
        }, { onHand: 0, softReserved: 0, hardReserved: 0, reserved: 0, available: 0, hasConflict: false, isCritical: false });
    };

    const isBatchFulfillmentRequest = !!request && (request.requestOrigin === 'project' || !!request.projectId || !!request.constructionSiteId);
    const fulfillmentSummary = useMemo(
        () => request ? materialRequestFulfillmentService.summarizeRequest(request, fulfillmentBatches) : null,
        [fulfillmentBatches, request],
    );
    const fulfillmentLineSummaryMap = useMemo(
        () => new Map((fulfillmentSummary?.lineSummaries || []).map(line => [line.requestLineId, line])),
        [fulfillmentSummary],
    );
    const actionableFulfillmentBatches = useMemo(
        () => fulfillmentBatches.filter(batch => batch.status === 'issued' || batch.status === 'variance_pending'),
        [fulfillmentBatches],
    );
    const getFulfillmentBatchTransaction = (batch?: MaterialRequestFulfillmentBatch | null): Transaction | null => {
        if (!batch?.transactionId) return null;
        return transactions.find(tx => tx.id === batch.transactionId) || null;
    };
    const getFulfillmentBatchUiStatus = (batch: MaterialRequestFulfillmentBatch) => {
        if (batch.status === 'issued') {
            const tx = getFulfillmentBatchTransaction(batch);
            if (!tx) return {
                label: 'Đang tải phiếu kho',
                color: 'bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800/40',
            };
            if (tx.status === TransactionStatus.PENDING) return {
                label: 'Chờ duyệt SL/CL',
                color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-405 border-amber-200 dark:border-amber-800/40',
            };
            if (tx.status === TransactionStatus.APPROVED) return {
                label: batch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Chờ xác nhận sử dụng' : 'Chờ xác nhận nhập kho',
                color: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-405 border-blue-200 dark:border-blue-800/40',
            };
            if (tx.status === TransactionStatus.COMPLETED) return {
                label: 'Phiếu kho đã hoàn tất',
                color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-405 border-emerald-200 dark:border-emerald-800/40',
            };
            if (tx.status === TransactionStatus.CANCELLED) return {
                label: 'Phiếu kho bị từ chối',
                color: 'bg-red-50 dark:bg-red-955/40 text-red-600 dark:text-red-405 border-red-200 dark:border-red-800/40',
            };
        }
        if (batch.status === 'received') return {
            label: 'Đã nhận',
            color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-405 border-emerald-200 dark:border-emerald-800/40',
        };
        if (batch.status === 'variance_pending') return {
            label: 'Chờ chốt lệch',
            color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-405 border-amber-200 dark:border-amber-800/40',
        };
        if (batch.status === 'returned') return {
            label: 'Đã trả lại',
            color: 'bg-rose-50 dark:bg-rose-955/40 text-rose-600 dark:text-rose-405 border-rose-200 dark:border-rose-800/40',
        };
        if (batch.status === 'cancelled') return {
            label: 'Đã huỷ',
            color: 'bg-red-50 dark:bg-red-955/40 text-red-600 dark:text-red-405 border-red-200 dark:border-red-800/40',
        };
        return {
            label: 'Nháp',
            color: 'bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800/40',
        };
    };

    const refreshFulfillmentBatches = async (requestId: string) => {
        setIsLoadingFulfillment(true);
        try {
            const batches = await materialRequestFulfillmentService.listByRequest(requestId);
            setFulfillmentBatches(batches);
            return batches;
        } finally {
            setIsLoadingFulfillment(false);
        }
    };

    const getFulfillmentBatchItemIds = (batches: Array<MaterialRequestFulfillmentBatch | null | undefined>) =>
        Array.from(new Set(batches.flatMap(batch => (batch?.lines || []).map(line => line.itemId).filter(Boolean))));

    const getFulfillmentBatchTransactionIds = (batches: Array<MaterialRequestFulfillmentBatch | null | undefined>) =>
        Array.from(new Set(batches.map(batch => batch?.transactionId).filter(Boolean) as string[]));

    const refreshFulfillmentWmsRecords = async (
        batches: Array<MaterialRequestFulfillmentBatch | null | undefined>,
        extra: {
            itemIds?: Array<string | null | undefined>;
            transactionIds?: Array<string | null | undefined>;
            requestIds?: Array<string | null | undefined>;
        } = {},
    ) => {
        await refreshWmsRecords({
            itemIds: [...getFulfillmentBatchItemIds(batches), ...(extra.itemIds || [])],
            transactionIds: [...getFulfillmentBatchTransactionIds(batches), ...(extra.transactionIds || [])],
            requestIds: [request?.id, ...(extra.requestIds || [])],
        });
    };

    useEffect(() => {
        if (!isOpen || fulfillmentBatches.length === 0) return;
        const missingPoIds = Array.from(new Set(fulfillmentBatches.flatMap(batch => getBatchPoIds(batch))))
            .filter(poId => !poSourceLabelsById[poId]);
        if (missingPoIds.length === 0) return;

        let cancelled = false;
        materialRequestFulfillmentService.listPurchaseOrderSourceLabels(missingPoIds)
            .then(labels => {
                if (!cancelled && Object.keys(labels).length > 0) {
                    setPoSourceLabelsById(prev => ({ ...prev, ...labels }));
                }
            })
            .catch(err => logApiError('requestModal.poSourceLabels', err));

        return () => {
            cancelled = true;
        };
    }, [isOpen, fulfillmentBatches, poSourceLabelsById]);

    useEffect(() => {
        if (!isOpen || !isBatchFulfillmentRequest || fulfillmentBatches.length === 0) return;
        const missingTransactionBatches = fulfillmentBatches.filter(batch =>
            !!batch.transactionId && !transactions.some(tx => tx.id === batch.transactionId)
        );
        if (missingTransactionBatches.length > 0) {
            void refreshFulfillmentWmsRecords(missingTransactionBatches);
        }
    }, [fulfillmentBatches, isBatchFulfillmentRequest, isOpen, transactions]);

    useEffect(() => {
        if (isOpen) {
            initialActionHandledRef.current = false;
            setShowApprovalPanel(false);
            setIsSaving(false);
            setIsIssuePanelOpen(false);
            setExpandedMaterialGroupKeys(new Set());
            setReceivingBatch(null);
            setReceivePanelMode('receipt');
            setReturningReceivedBatch(null);
            setReturnDestinationWarehouseId('');
            setReturnReceivedReason('');
            if (request) {
                if (request.status === RequestStatus.PENDING && (canReviewProjectWorkflow || (!isProjectRequest && canApproveMaterialRequest(user, request)))) {
                    setStep('APPROVE');
                } else if (request.status === RequestStatus.DRAFT && request.requesterId === user.id) {
                    setStep('CREATE');
                } else {
                    setStep('VIEW');
                }

                setSiteWarehouseId(request.siteWarehouseId);
                setSourceWarehouseId(request.sourceWarehouseId || '');
                setStockPreviewWarehouseId('');
                setRequestTitle(request.title || 'Đề xuất vật tư');
                setNote(request.note || '');
                setExpectedDate(request.expectedDate || '');
                setFulfillmentMode(request.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
                setOverrideReason(request.overrideReason || '');
                setReqItems(request.items.map(toDraftLine));
                setApprovedItems(request.items.map(i => ({ lineId: i.lineId, itemId: i.itemId, qty: i.approvedQty })));
            } else {
                setStep('CREATE');
                setSiteWarehouseId(defaultSiteWarehouseId || user.assignedWarehouseId || '');
                setSourceWarehouseId('');
                setStockPreviewWarehouseId('');
                setRequestTitle(initialDraft?.title || '');
                setNote(initialDraft?.note || '');
                setExpectedDate(initialDraft?.neededDate || new Date(Date.now() + 86400000 * 3).toISOString());
                setFulfillmentMode(MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
                setOverrideReason('');
                const initialLines = (initialDraft?.lines || [])
                    .map(buildDraftLineFromInitialLine)
                    .filter((line): line is RequestLineDraft => Boolean(line));
                setReqItems(initialLines);
                setApprovedItems([]);
                const initialWorkId = initialDraft?.workBoqItemId || '';
                setSelectedWorkBoqItemIds(new Set(initialWorkId ? [initialWorkId] : []));
                setDraftWorkBoqSearch(initialWorkId ? getWorkBoqLabel(workBoqMap.get(initialWorkId)) : '');
                setSelectedMaterialBudgetIds(new Set());
                setDraftBudgetQtyById({});
                setDraftNeededDate('');
                setDraftLineNote('');
            }
        }
    }, [canReviewProjectWorkflow, defaultSiteWarehouseId, initialDraft, isOpen, isProjectRequest, items, materialBudgetMap, request, user]);

    useEffect(() => {
        if (!isOpen || !request) {
            setFulfillmentBatches([]);
            return;
        }
        void refreshFulfillmentBatches(request.id).catch(err => {
            logApiError('requestModal.fulfillment.list', err);
            setFulfillmentBatches([]);
        });
    }, [isOpen, request?.id]);

    const handleAddItem = () => {
        if (items.length === 0) return;
        if (!isProjectRequest && !sourceWarehouseId) {
            toast.warning('Thiếu kho cung cấp', 'Vui lòng chọn kho cung cấp trước khi chọn vật tư.');
            return;
        }
        setItemSelectOpen(true);
    };

    const handleSelectFromModal = (item: InventoryItem) => {
        if (!isProjectRequest && reqItems.some(i => i.itemId === item.id)) {
            toast.warning('Vật tư đã tồn tại', 'Vật tư này đã có trong danh sách đề xuất.');
            return;
        }
        setReqItems([...reqItems, {
            lineId: crypto.randomUUID(),
            itemId: item.id,
            qty: 1,
            itemNameSnapshot: item.name,
            unitSnapshot: item.unit,
            skuSnapshot: item.sku,
            overBudgetReason: isProjectRequest ? '' : undefined,
        }]);
        setItemSelectOpen(false);
    };

    const handleUpdateItem = (index: number, field: keyof RequestLineDraft, value: any) => {
        const newItems = [...reqItems];
        newItems[index] = { ...newItems[index], [field]: value };
        setReqItems(newItems);
    };

    const handleUpdateApprovedItem = (line: RequestItem, qty: number) => {
        const itemId = line.itemId;
        const item = items.find(i => i.id === itemId);
        const stockSummary = getAggregateStockSummary(itemId, sourceWarehouseId, request?.id);
        const availableStock = stockSummary.available;
        const sourceStock = line.isManualItem || !item ? 0 : (isProjectRequest || isAdmin(user) ? Number.MAX_SAFE_INTEGER : availableStock);

        if (line.isManualItem || !item) {
            toast.warning('Dòng chưa có mã kho', 'Vui lòng tạo đề xuất cấp mã vật tư/vật liệu trước khi duyệt xuất hoặc đặt hàng.');
            qty = 0;
        }

        // Ràng buộc 1: Không vượt quá tồn kho
        if (!isProjectRequest && qty > sourceStock) {
            toast.warning('Vượt tồn khả dụng', `${sourceWarehouseId ? 'Kho nguồn' : 'Tổng các kho'} chỉ còn ${sourceStock} ${item?.unit || line.unitSnapshot || ''}.`);
            qty = sourceStock;
        }

        setApprovedItems(prev => {
            const existing = prev.find(i => (line.lineId && i.lineId === line.lineId) || (!line.lineId && i.itemId === itemId));
            if (existing) {
                return prev.map(i => ((line.lineId && i.lineId === line.lineId) || (!line.lineId && i.itemId === itemId)) ? { ...i, qty } : i);
            }
            return [...prev, { lineId: line.lineId, itemId, qty }];
        });
    };

    const getBudgetInventoryItem = (budget: MaterialBudgetItem) => items.find(item =>
        item.id === budget.inventoryItemId ||
        (!!budget.materialCode && item.sku.toLowerCase() === budget.materialCode.toLowerCase()) ||
        item.name.toLowerCase() === budget.itemName.toLowerCase()
    );

    const handleToggleWorkBoqItem = (item: ProjectWorkBoqItem) => {
        setSelectedWorkBoqItemIds(prev => {
            const next = new Set(prev);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
        });
        setSelectedMaterialBudgetIds(new Set());
        setDraftBudgetQtyById({});
    };

    const handleToggleBudgetSelection = (budget: MaterialBudgetItem) => {
        setSelectedMaterialBudgetIds(prev => {
            const next = new Set(prev);
            const isSelected = next.has(budget.id);
            if (isSelected) {
                next.delete(budget.id);
                setDraftBudgetQtyById(qtyMap => {
                    const { [budget.id]: _removed, ...rest } = qtyMap;
                    return rest;
                });
                return next;
            }
            next.add(budget.id);
            setDraftBudgetQtyById(qtyMap => {
                if (qtyMap[budget.id]) return qtyMap;
                const snapshot = getNewLineBudgetSnapshot(budget.id, 0, request?.id);
                const suggestedQty = canViewAvailableStock && snapshot.availableQty > 0
                    ? Math.max(0, snapshot.availableQty)
                    : '';
                return { ...qtyMap, [budget.id]: suggestedQty ? String(suggestedQty) : '' };
            });
            return next;
        });
    };

    const handleAddBudgetLines = () => {
        const selectedBudgets = budgetOptions.filter(budget => selectedMaterialBudgetIds.has(budget.id));
        if (selectedBudgets.length === 0) {
            toast.warning('Chưa chọn vật tư BOQ', 'Vui lòng tick một hoặc nhiều vật tư/định mức thuộc đầu mục công việc.');
            return;
        }

        const missingQty: string[] = [];
        const missingInventory: string[] = [];
        const validLines: Array<{ budget: MaterialBudgetItem; inventoryItem: InventoryItem; qty: number }> = [];
        const overBudgetLines: Array<{ budget: MaterialBudgetItem; snapshot: ReturnType<typeof getNewLineBudgetSnapshot> }> = [];

        selectedBudgets.forEach(budget => {
            const inventoryItem = getBudgetInventoryItem(budget);
            if (!inventoryItem) {
                missingInventory.push(budget.itemName);
                return;
            }
            const qty = Math.max(0, Number(draftBudgetQtyById[budget.id] || 0));
            if (qty <= 0) {
                missingQty.push(budget.itemName);
                return;
            }
            const snapshot = getNewLineBudgetSnapshot(budget.id, qty, request?.id);
            if (snapshot.budgetQty > 0 && snapshot.totalRequested > snapshot.budgetQty) {
                overBudgetLines.push({ budget, snapshot });
            }
            validLines.push({ budget, inventoryItem, qty });
        });

        if (missingInventory.length > 0) {
            toast.warning('Có vật tư chưa có mã kho', `${missingInventory.slice(0, 3).join(', ')}${missingInventory.length > 3 ? ` và ${missingInventory.length - 3} dòng khác` : ''}. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước.`);
        }
        if (missingQty.length > 0) {
            toast.warning('Thiếu khối lượng', `Vui lòng nhập số lượng lớn hơn 0 cho: ${missingQty.slice(0, 3).join(', ')}${missingQty.length > 3 ? ` và ${missingQty.length - 3} dòng khác` : ''}.`);
        }
        if (validLines.length === 0) return;

        if (overBudgetLines.length > 0) {
            const first = overBudgetLines[0];
            const message = canViewAvailableStock
                ? `${first.budget.itemName}: khả dụng ${Math.max(0, first.snapshot.availableQty).toLocaleString('vi-VN')} ${first.budget.unit}; sau dòng này vượt ${(first.snapshot.totalRequested - first.snapshot.budgetQty).toLocaleString('vi-VN')} ${first.budget.unit}${overBudgetLines.length > 1 ? `, và ${overBudgetLines.length - 1} dòng khác cũng vượt.` : '.'}`
                : `${overBudgetLines.length} dòng vượt phần khả dụng/định mức. Phiếu vẫn tạo được nếu nhập lý do.`;
            toast.warning('Vượt KL khả dụng BOQ', message);
        }

        setReqItems(prev => {
            let next = [...prev];
            validLines.forEach(({ budget, inventoryItem, qty }) => {
                const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
                const existingIndex = next.findIndex(line => line.materialBudgetItemId === budget.id);
                if (existingIndex >= 0) {
                    next = next.map((line, index) => {
                        if (index !== existingIndex) return line;
                        const nextNote = draftLineNote
                            ? [line.note, draftLineNote].filter(Boolean).join('; ')
                            : line.note;
                        return {
                            ...line,
                            qty: Number(line.qty || 0) + qty,
                            neededDate: draftNeededDate || line.neededDate,
                            note: nextNote,
                        };
                    });
                    return;
                }
                next.push({
                    lineId: crypto.randomUUID(),
                    itemId: inventoryItem.id,
                    qty,
                    workBoqItemId: budget.workBoqItemId || null,
                    workBoqItemName: work?.name || '',
                    materialBudgetItemId: budget.id,
                    materialBudgetItemName: budget.itemName,
                    neededDate: draftNeededDate || '',
                    note: draftLineNote || '',
                    isManualItem: false,
                    itemNameSnapshot: inventoryItem.name,
                    unitSnapshot: inventoryItem.unit,
                    skuSnapshot: inventoryItem.sku,
                    specification: budget.notes || '',
                    overBudgetReason: '',
                });
            });
            return next;
        });
        setSelectedMaterialBudgetIds(new Set());
        setDraftBudgetQtyById({});
        setDraftLineNote('');
    };

    const saveMaterialRequest = async (requestToSave: MaterialRequest, successTitle: string, successMessage: string) => {
        setIsSaving(true);
        try {
            const saved = await addRequest(requestToSave);
            if (!saved) {
                toast.error('Không thể lưu đề xuất', 'Không lưu được phiếu đề xuất lên hệ thống. Vui lòng thử lại.');
                throw new Error('Không lưu được phiếu đề xuất lên hệ thống.');
            }
            toast.success(successTitle, successMessage);
            onSaved?.(requestToSave);
            onClose();
        } catch (err: any) {
            logApiError('requestModal.save', err);
            toast.error('Không thể lưu đề xuất', getApiErrorMessage(err, 'Không lưu được phiếu đề xuất lên hệ thống.'));
            throw err;
        } finally {
            setIsSaving(false);
        }
    };

    const submitRequestForApproval = async (draftRequest: MaterialRequest, submissionTarget?: ProjectSubmissionTarget) => {
        if (!submissionTarget) return;
        const ok = await confirm({
            title: 'Gửi đề xuất duyệt',
            targetName: draftRequest.code,
            subtitle: `Phiếu sẽ chuyển sang Chờ duyệt và gửi tới ${submissionTarget.name}.`,
            confirmText: 'Xác nhận gửi',
            actionLabel: 'Gửi duyệt',
            cancelLabel: 'Kiểm tra lại',
            intent: 'success',
            countdownSeconds: 1,
        });
        if (!ok) return;

        const dynamicConfiguration = isProjectRequest
            ? await projectWorkflowService.getConfiguration('material_request', effectiveProjectId || null, effectiveConstructionSiteId || null)
            : null;
        if (isProjectRequest && (!dynamicConfiguration?.valid || !dynamicConfiguration.binding)) {
            throw new Error(dynamicConfiguration?.errors?.[0] || 'Dự án chưa cấu hình workflow đề xuất vật tư hợp lệ.');
        }
        const dynamicBinding = dynamicConfiguration?.binding || null;
        const now = new Date().toISOString();
        const requestToSave: MaterialRequest = {
            ...draftRequest,
            status: dynamicBinding ? RequestStatus.DRAFT : RequestStatus.PENDING,
            ...(dynamicBinding
                ? {
                    submittedToUserId: null,
                    submittedToName: null,
                    submittedToPermission: null,
                    submissionNote: null,
                }
                : projectSubmissionService.targetToUpdate(submissionTarget)),
            ...projectSubmissionService.actionMeta(user.id, !dynamicBinding),
            ...(isProjectRequest
                ? getMaterialRequestWorkflowPatch(dynamicBinding ? 'draft' : 'site_manager_review', user.id)
                : {}),
            logs: [
                ...(draftRequest.logs || []),
                { action: dynamicBinding ? 'DRAFT_SAVED' : 'SUBMITTED', userId: user.id, timestamp: now, note: submissionTarget.note || undefined },
            ],
        };

        setIsSaving(true);
        try {
            const saved = await addRequest(requestToSave);
            if (!saved) {
                toast.error('Không thể gửi đề xuất', 'Không lưu được phiếu đề xuất lên hệ thống. Vui lòng thử lại.');
                return;
            }
            if (dynamicBinding) {
                const targetUserIds = submissionTarget.userIds?.length
                    ? submissionTarget.userIds
                    : submissionTarget.userId
                        ? [submissionTarget.userId]
                        : [];
                await projectWorkflowService.startMaterialRequestWorkflowV2({
                    requestId: requestToSave.id,
                    templateId: dynamicBinding.workflowTemplateId,
                    firstAssigneeUserIds: targetUserIds,
                    comment: submissionTarget.note,
                });
            }
            setSubmittingProjectRequest(null);
            toast.success('Đã gửi đề xuất vật tư', `Phiếu đã gửi tới ${submissionTarget.name}.`);
            onSaved?.(requestToSave);
            onClose();
        } catch (err: any) {
            logApiError('requestModal.submitApproval', err);
            toast.error('Không thể gửi đề xuất', getApiErrorMessage(err, 'Không lưu được phiếu đề xuất lên hệ thống.'));
            throw err;
        } finally {
            setIsSaving(false);
        }
    };

    const allocateMaterialRequestCode = async (): Promise<string> => {
        if (request?.code) return request.code;
        return materialRequestService.nextCode();
    };

    const buildDraftRequestFromForm = (issuedCode?: string): MaterialRequest => {
        const now = new Date().toISOString();
        const isExistingDraft = !!request && request.status === RequestStatus.DRAFT;
        const workflowPatch = isProjectRequest
            ? getMaterialRequestWorkflowPatch(request?.workflowStep === 'returned_to_creator' ? 'returned_to_creator' : 'draft', user.id)
            : {};
        const sequentialSnapshots = buildSequentialLineBudgetSnapshots(reqItems, request?.id);
        const requestCode = request?.code || issuedCode;
        if (!requestCode) {
            throw new Error('Hệ thống chưa cấp được mã phiếu MR mới.');
        }
        return {
            ...(request || {}),
            id: request?.id || `mr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            code: requestCode,
            title: requestTitle.trim() || request?.title || 'Đề xuất vật tư',
            projectId: effectiveProjectId,
            constructionSiteId: effectiveConstructionSiteId,
            requestOrigin: isProjectRequest ? 'project' : 'wms',
            siteWarehouseId,
            sourceWarehouseId: sourceWarehouseId || undefined,
            requesterId: request?.requesterId || user.id,
            status: RequestStatus.DRAFT,
            submittedToUserId: null,
            submittedToName: null,
            submittedToPermission: null,
            submissionNote: null,
            ...workflowPatch,
            createdDate: request?.createdDate || now,
            expectedDate: expectedDate || new Date(Date.now() + 86400000 * 3).toISOString(),
            note,
            fulfillmentMode,
            items: reqItems.map(i => {
                const snapshot = sequentialSnapshots.get(i.lineId) || buildLineBudgetSnapshot(i, request?.id);
                const work = i.workBoqItemId ? workBoqMap.get(i.workBoqItemId) : undefined;
                const overReason = i.overBudgetReason || undefined;
                return {
                    lineId: i.lineId,
                    itemId: i.itemId,
                    requestQty: Number(i.qty),
                    approvedQty: 0,
                    workBoqItemId: i.workBoqItemId || null,
                    workBoqItemName: i.workBoqItemName || work?.name || null,
                    materialBudgetItemId: i.materialBudgetItemId || null,
                    materialBudgetItemName: i.materialBudgetItemName || snapshot.budget?.itemName || null,
                    neededDate: i.neededDate || undefined,
                    note: i.note || undefined,
                    budgetQtySnapshot: snapshot.budgetQty,
                    reservedBeforeQtySnapshot: snapshot.reservedBeforeQty,
                    previousRequestedQtySnapshot: snapshot.previousRequested,
                    isOverBoq: snapshot.overBudgetQty > 0,
                    overQty: snapshot.overBudgetQty,
                    overPercent: snapshot.overBudgetPercent,
                    overReason,
                    overBudgetQtySnapshot: snapshot.overBudgetQty,
                    overBudgetPercentSnapshot: snapshot.overBudgetPercent,
                    overBudgetReason: overReason,
                    isManualItem: i.isManualItem || false,
                    itemNameSnapshot: i.itemNameSnapshot || getLineInventory(i.itemId)?.name || snapshot.budget?.itemName || undefined,
                    unitSnapshot: i.unitSnapshot || getLineInventory(i.itemId)?.unit || snapshot.budget?.unit || undefined,
                    skuSnapshot: i.skuSnapshot || getLineInventory(i.itemId)?.sku || undefined,
                    specification: i.specification || undefined,
                    manualReason: i.manualReason || undefined,
                    materialGroupKey: i.materialGroupKey || undefined,
                    materialGroupSource: i.materialGroupSource || undefined,
                    materialGroupSnapshot: i.materialGroupSnapshot || undefined,
                };
            }),
            logs: [
                ...(request?.logs || []),
                { action: isExistingDraft ? 'UPDATED_DRAFT' : 'CREATED_DRAFT', userId: user.id, timestamp: now },
            ],
        };
    };

    const validateDraftForm = async () => {
        if (isProjectRequest && !requestTitle.trim()) {
            toast.warning('Thiếu tên đề xuất', 'Vui lòng nhập tên đề xuất vật tư.');
            return false;
        }
        if (!siteWarehouseId || (!isProjectRequest && !sourceWarehouseId) || reqItems.length === 0) {
            toast.warning('Thiếu thông tin', isProjectRequest ? 'Vui lòng chọn kho nhận và ít nhất 1 vật tư.' : 'Vui lòng chọn đầy đủ kho nhận, kho nguồn và ít nhất 1 vật tư.');
            return false;
        }

        const invalidQtyLine = reqItems.find(line => Number(line.qty || 0) <= 0);
        if (invalidQtyLine) {
            const item = items.find(i => i.id === invalidQtyLine.itemId);
            toast.warning('Thiếu khối lượng đề xuất', `${item?.name || invalidQtyLine.itemNameSnapshot || invalidQtyLine.itemId} cần nhập số lượng lớn hơn 0.`);
            return false;
        }

        if (isProjectRequest) {
            const sequentialSnapshots = buildSequentialLineBudgetSnapshots(reqItems, request?.id);
            const invalidLine = reqItems.find(line => {
                const snapshot = sequentialSnapshots.get(line.lineId) || buildLineBudgetSnapshot(line, request?.id);
                const outsideBoq = !line.materialBudgetItemId;
                return (outsideBoq || snapshot.overBudgetQty > 0) && !line.overBudgetReason?.trim();
            });
            if (invalidLine) {
                const item = items.find(i => i.id === invalidLine.itemId);
                toast.warning('Thiếu lý do vượt/ngoài BOQ', `${item?.name || invalidLine.itemId} cần nhập lý do để gửi đề xuất.`);
                return false;
            }
        }

        const shortages = sourceWarehouseId ? reqItems
            .filter(line => !line.isManualItem && !!getLineInventory(line.itemId))
            .map(line => ({ ...line, summary: getStockSummary(line.itemId, sourceWarehouseId) }))
            .filter(line => Number(line.qty) > line.summary.available) : [];
        if (!isProjectRequest && shortages.length > 0) {
            const shortageText = shortages.map(line => {
                const item = getLineInventory(line.itemId);
                const missing = Number(line.qty) - line.summary.available;
                return `${item?.name || line.itemId}: khả dụng ${line.summary.available}, thiếu ${missing}`;
            }).join('\n');
            const ok = await confirm({
                title: 'Tạo nháp vượt tồn khả dụng',
                targetName: 'Phiếu đề xuất vật tư',
                warningText: `Một số vật tư vượt tồn khả dụng:\n${shortageText}`,
                confirmText: 'Tạo phiếu nháp',
                actionLabel: 'Tiếp tục',
                cancelLabel: 'Kiểm tra lại',
                intent: 'warning',
            });
            if (!ok) return false;
        }
        return true;
    };

    const handleSubmitCreate = async () => {
        if (isSaving) return;
        const isValid = await validateDraftForm();
        if (!isValid) return;

        const isExistingDraft = !!request && request.status === RequestStatus.DRAFT;
        let newRequest: MaterialRequest;
        try {
            newRequest = buildDraftRequestFromForm(await allocateMaterialRequestCode());
        } catch (err: any) {
            logApiError('requestModal.allocateMaterialRequestCode', err);
            toast.error('Không thể cấp mã phiếu', getApiErrorMessage(err, 'Không lấy được mã MR mới từ hệ thống.'));
            return;
        }

        const ok = await confirm({
            title: isExistingDraft ? 'Lưu phiếu nháp' : 'Tạo đề xuất nháp',
            targetName: newRequest.code,
            subtitle: 'Phiếu sẽ lưu ở trạng thái Nháp. Anh/chị mở lại phiếu để kiểm tra rồi mới gửi duyệt.',
            confirmText: isExistingDraft ? 'Xác nhận lưu' : 'Xác nhận tạo',
            actionLabel: isExistingDraft ? 'Lưu nháp' : 'Tạo nháp',
            cancelLabel: 'Kiểm tra lại',
            intent: 'success',
            countdownSeconds: 1,
        });
        if (!ok) return;

        await saveMaterialRequest(
            newRequest,
            isExistingDraft ? 'Đã lưu phiếu nháp' : 'Đã tạo phiếu nháp',
            'Phiếu đang ở trạng thái Nháp. Mở lại phiếu để kiểm tra và gửi duyệt khi sẵn sàng.',
        );
    };

    const handleOpenSubmitDraft = async () => {
        if (isSaving || !request || request.status !== RequestStatus.DRAFT) return;
        const isValid = await validateDraftForm();
        if (!isValid) return;
        try {
            setSubmittingProjectRequest(buildDraftRequestFromForm(await allocateMaterialRequestCode()));
        } catch (err: any) {
            logApiError('requestModal.allocateSubmitDraftCode', err);
            toast.error('Không thể cấp mã phiếu', getApiErrorMessage(err, 'Không lấy được mã MR mới từ hệ thống.'));
        }
    };

    const handleProjectWorkflowPanelAction = async (context: ProjectWorkflowActionContext) => {
        if (!onProjectWorkflowAction) return;
        if (context.action !== 'resubmit') {
            await onProjectWorkflowAction(context);
            return;
        }

        if (isSaving || !request || request.status !== RequestStatus.DRAFT) return;
        const isValid = await validateDraftForm();
        if (!isValid) return;

        let draftToSave: MaterialRequest;
        try {
            draftToSave = buildDraftRequestFromForm(await allocateMaterialRequestCode());
        } catch (err: any) {
            logApiError('requestModal.allocateResubmitCode', err);
            toast.error('Không thể cấp mã phiếu', getApiErrorMessage(err, 'Không lấy được mã MR mới từ hệ thống.'));
            return;
        }
        setIsSaving(true);
        try {
            const saved = await addRequest(draftToSave);
            if (!saved) {
                toast.error('Không thể gửi lại đề xuất', 'Không lưu được nội dung sửa của phiếu trước khi gửi lại.');
                throw new Error('Không lưu được nội dung sửa của phiếu trước khi gửi lại.');
            }
            await onProjectWorkflowAction(context);
        } catch (err: any) {
            logApiError('requestModal.workflowResubmit', err);
            toast.error('Không thể gửi lại đề xuất', getApiErrorMessage(err, 'Không lưu/gửi lại được phiếu đề xuất.'));
            throw err;
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteRequest = async () => {
        if (isSaving || !request) return;
        const ok = await confirm({
            title: 'Xoá phiếu đề xuất',
            targetName: request.code,
            subtitle: 'Chỉ xoá được phiếu chưa phát sinh đợt cấp, PO hoặc phiếu kho liên quan.',
            confirmText: 'Xác nhận xoá',
            actionLabel: 'Xoá phiếu',
            cancelLabel: 'Giữ lại',
            intent: 'danger',
            countdownSeconds: 2,
        });
        if (!ok) return;

        setIsSaving(true);
        try {
            await removeRequest(request.id);
            onDeleted?.(request.id);
            toast.success('Đã xoá phiếu đề xuất', `Phiếu ${request.code} đã được xoá khỏi danh sách.`);
            onClose();
        } catch (err: any) {
            logApiError('requestModal.delete', err);
            toast.error('Không thể xoá phiếu', getApiErrorMessage(err, 'Phiếu không đủ điều kiện xoá hoặc bạn không có quyền xoá.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleAction = async (status: RequestStatus) => {
        if (isSaving) return;
        if (!request) return;

        // Ràng buộc 2: Kiểm tra duyệt vượt số lượng yêu cầu khi Phê duyệt
        if (status === RequestStatus.APPROVED) {
            const itemsWithExcess = approvedItems.filter(ai => {
                const originalReq = request.items.find(ri =>
                    (ri.lineId && ai.lineId === ri.lineId) ||
                    (!ri.lineId && ri.itemId === ai.itemId)
                );
                return originalReq && ai.qty > originalReq.requestQty;
            });

            if (itemsWithExcess.length > 0) {
                const ok = await confirm({
                    title: 'Duyệt vượt số lượng yêu cầu',
                    targetName: request.code,
                    warningText: `Có ${itemsWithExcess.length} vật tư được duyệt vượt mức yêu cầu ban đầu.`,
                    confirmText: 'Tiếp tục phê duyệt',
                    actionLabel: 'Duyệt vượt',
                    cancelLabel: 'Kiểm tra lại',
                    intent: 'warning',
                    countdownSeconds: 1,
                });
                if (!ok) return;
            }
        }

        if (status === RequestStatus.REJECTED && !(overrideReason.trim() || note.trim())) {
            toast.warning('Thiếu lý do từ chối', 'Vui lòng nhập lý do vào ô ghi chú/lý do override trước khi từ chối.');
            return;
        }

        if (status === RequestStatus.APPROVED && !isProjectRequest) {
            const stockShortages = sourceWarehouseId
                ? approvedItems
                    .filter(line => !!getLineInventory(line.itemId))
                    .map(line => ({ ...line, summary: getStockSummary(line.itemId, sourceWarehouseId, { excludeRequestId: request.id }) }))
                    .filter(line => Number(line.qty) > line.summary.available)
                : [];
            if (stockShortages.length > 0) {
                if (!isAdmin(user)) {
                    toast.warning('Vượt tồn khả dụng', 'Thủ kho không thể duyệt vượt tồn khả dụng. Vui lòng giảm số lượng duyệt hoặc xử lý phiếu đang giữ chỗ trước.');
                    return;
                }
                if (!overrideReason.trim()) {
                    toast.warning('Thiếu lý do override', 'Admin duyệt vượt tồn khả dụng phải nhập lý do override.');
                    return;
                }
                const shortageText = stockShortages.map(line => {
                    const item = items.find(i => i.id === line.itemId);
                    const missing = Number(line.qty) - line.summary.available;
                    return `${item?.name || line.itemId}: khả dụng ${line.summary.available}, vượt ${missing}`;
                }).join('\n');
                const ok = await confirm({
                    title: 'Duyệt vượt tồn khả dụng',
                    targetName: request.code,
                    warningText: `Bạn đang duyệt vượt tồn khả dụng:\n${shortageText}`,
                    confirmText: 'Tiếp tục duyệt',
                    actionLabel: 'Duyệt override',
                    cancelLabel: 'Kiểm tra lại',
                    intent: 'warning',
                    countdownSeconds: 1,
                });
                if (!ok) return;
            }
        }

        if (status === RequestStatus.IN_TRANSIT || status === RequestStatus.COMPLETED) {
            const stockLines = approvedItems.filter(line => Number(line.qty || 0) > 0 && !!getLineInventory(line.itemId));
            if (stockLines.length > 0 && !sourceWarehouseId) {
                toast.error('Chưa chọn kho nguồn', 'Phòng vật tư cần chọn kho nguồn trước khi xuất vật tư có mã tồn kho.');
                return;
            }
            const stockShortages = stockLines
                .map(line => ({ ...line, summary: getStockSummary(line.itemId, sourceWarehouseId, { excludeRequestId: request.id }) }))
                .filter(line => Number(line.qty) > line.summary.available);
            if (stockShortages.length > 0) {
                const shortage = stockShortages[0];
                const item = getLineInventory(shortage.itemId);
                const whName = warehouses.find(w => w.id === sourceWarehouseId)?.name || sourceWarehouseId;
                const reason = Number(shortage.qty) > shortage.summary.onHand
                    ? `tồn thực ${shortage.summary.onHand}`
                    : `tồn thực ${shortage.summary.onHand}, đang giữ ${shortage.summary.reserved}, khả dụng ${shortage.summary.available}`;
                const blockers = formatReservationSourceList(shortage.summary.entries);
                toast.error('Không đủ tồn khả dụng', `Kho nguồn "${whName}" không đủ tồn cho dòng "${item?.name || shortage.itemId}". Cần ${shortage.qty}; ${reason}.${blockers ? ` Vị trí giữ chỗ: ${blockers}.` : ''} Vui lòng xử lý phiếu đang giữ chỗ hoặc giảm số lượng xuất.`);
                return;
            }
        }

        const actionLabel = status === RequestStatus.APPROVED
            ? 'Phê duyệt'
            : status === RequestStatus.REJECTED
                ? 'Từ chối'
                : status === RequestStatus.IN_TRANSIT
                    ? 'Xác nhận xuất kho'
                    : status === RequestStatus.COMPLETED
                        ? 'Xác nhận hoàn thành'
                        : 'Cập nhật';
        const ok = await confirm({
            title: `${actionLabel} phiếu đề xuất`,
            targetName: request.code,
            subtitle: `Phiếu sẽ chuyển sang trạng thái ${status}.`,
            confirmText: `Xác nhận ${actionLabel.toLowerCase()}`,
            actionLabel,
            cancelLabel: 'Kiểm tra lại',
            intent: status === RequestStatus.REJECTED ? 'danger' : 'success',
            countdownSeconds: 1,
        });
        if (!ok) return;

        setIsSaving(true);
        try {
            const saved = await updateRequestStatus(request.id, status, note, approvedItems, sourceWarehouseId || undefined, overrideReason.trim() || undefined);
            if (!saved) {
                toast.error('Không thể cập nhật phiếu', 'Không cập nhật được trạng thái phiếu trên hệ thống. Vui lòng thử lại.');
                return;
            }
            toast.success('Đã cập nhật phiếu', `Trạng thái mới: ${status}.`);
            onClose();
        } catch (err: any) {
            logApiError('requestModal.updateStatus', err);
            toast.error('Không thể cập nhật phiếu', getApiErrorMessage(err, 'Không cập nhật được trạng thái phiếu trên hệ thống.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleReturnRequest = async () => {
        if (isSaving || !request) return;
        if (request.relatedTransactionId) {
            toast.error('Không thể trả lại trực tiếp', 'Phiếu đã phát sinh phiếu kho liên kết. Cần huỷ/rollback phiếu kho trước.');
            return;
        }
        const reason = overrideReason.trim() || note.trim();
        if (!reason) {
            toast.warning('Thiếu lý do trả lại', 'Vui lòng nhập lý do để người tạo phiếu biết cần bổ sung gì.');
            return;
        }
        const ok = await confirm({
            title: 'Trả lại phiếu đề xuất',
            targetName: request.code,
            subtitle: 'Phiếu sẽ quay về trạng thái Nháp và hiển thị nhãn Bị trả lại cho người tạo phiếu.',
            confirmText: 'Xác nhận trả lại',
            actionLabel: 'Trả lại',
            cancelLabel: 'Kiểm tra lại',
            intent: 'warning',
            countdownSeconds: 1,
        });
        if (!ok) return;
        setIsSaving(true);
        try {
            const saved = await updateRequestStatus(request.id, RequestStatus.DRAFT, reason, undefined, undefined, undefined, 'RETURNED');
            if (!saved) {
                toast.error('Không thể trả lại phiếu', 'Không cập nhật được trạng thái phiếu trên hệ thống.');
                return;
            }
            toast.success('Đã trả lại phiếu', 'Phiếu đã quay về Nháp để người tạo phiếu chỉnh sửa và gửi lại.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.returnRequest', err);
            toast.error('Không thể trả lại phiếu', getApiErrorMessage(err, 'Không cập nhật được trạng thái phiếu trên hệ thống.'));
        } finally {
            setIsSaving(false);
        }
    };

    const openIssuePanel = () => {
        if (!request || !fulfillmentSummary) return;
        const effectiveSourceWarehouseId = sourceWarehouseId || request.sourceWarehouseId || '';
        const drafts = request.items
            .map((line, index) => {
                const requestLineId = getRequestLineId(request, line, index);
                const lineSummary = fulfillmentLineSummaryMap.get(requestLineId);
                const remaining = lineSummary?.remainingToIssue ?? getCommittedQty(line);
                return {
                    remaining,
                    draft: {
                        requestLineId,
                        itemId: line.itemId,
                        qty: String(getMaterialIssueDraftQty(
                            'stock',
                            remaining,
                            getOnHandStock(line.itemId, effectiveSourceWarehouseId),
                        )),
                        reason: '',
                    },
                };
            })
            .filter(line => line.remaining > 0)
            .map(line => line.draft);
        if (drafts.length === 0) {
            toast.info('Đã cấp đủ', 'Không còn dòng vật tư nào cần tạo đợt cấp.');
            return;
        }
        setIssueLines(drafts);
        setIssueSourceType('stock');
        setIssueNote('');
        setIsIssuePanelOpen(true);
    };

    const handleIssueSourceTypeChange = (nextSourceType: MaterialRequestFulfillmentSourceType) => {
        setIssueSourceType(nextSourceType);
        if (!request) return;
        const effectiveSourceWarehouseId = sourceWarehouseId || request.sourceWarehouseId || '';
        setIssueLines(previous => previous.map(draft => {
            const requestLineIndex = request.items.findIndex((line, index) =>
                getRequestLineId(request, line, index) === draft.requestLineId
            );
            const requestLine = requestLineIndex >= 0 ? request.items[requestLineIndex] : undefined;
            const remaining = fulfillmentLineSummaryMap.get(draft.requestLineId)?.remainingToIssue
                ?? (requestLine ? getCommittedQty(requestLine) : 0);
            return {
                ...draft,
                qty: String(getMaterialIssueDraftQty(
                    nextSourceType,
                    remaining,
                    getOnHandStock(draft.itemId, effectiveSourceWarehouseId),
                )),
            };
        }));
    };

    useEffect(() => {
        if (!isOpen || !request || initialAction !== 'createFulfillmentBatch' || initialActionHandledRef.current || isLoadingFulfillment) return;
        initialActionHandledRef.current = true;
        openIssuePanel();
    }, [isOpen, request?.id, initialAction, isLoadingFulfillment]);

    const updateIssueLine = (requestLineId: string, patch: Partial<FulfillmentQtyDraft>) => {
        setIssueLines(prev => prev.map(line => line.requestLineId === requestLineId ? { ...line, ...patch } : line));
    };

    const updateReceiveLine = (lineId: string, patch: Partial<ReceiveQtyDraft>) => {
        setReceiveLines(prev => prev.map(line => line.lineId === lineId ? { ...line, ...patch } : line));
    };

    const handleCreateFulfillmentBatch = async () => {
        if (!request || isSaving) return;
        const effectiveSource = sourceWarehouseId || request.sourceWarehouseId || '';
        if (!effectiveSource) {
            toast.warning('Chưa chọn kho nguồn', 'Vui lòng chọn kho nguồn trước khi tạo đợt cấp.');
            return;
        }
        const validLines = issueLines
            .map(line => ({ ...line, issuedQty: Number(line.qty || 0) }))
            .filter(line => line.issuedQty > 0);
        if (validLines.length === 0) {
            toast.warning('Thiếu số lượng cấp', 'Vui lòng nhập ít nhất một dòng có số lượng cấp lớn hơn 0.');
            return;
        }
        const shortage = validLines
            .map(line => ({ ...line, summary: getStockSummary(line.itemId, effectiveSource) }))
            .find(line => line.issuedQty > line.summary.available);
        if (shortage) {
            const item = getLineInventory(shortage.itemId);
            const whName = warehouses.find(w => w.id === effectiveSource)?.name || effectiveSource;
            const reason = shortage.issuedQty > shortage.summary.onHand
                ? `tồn thực ${shortage.summary.onHand}`
                : `tồn thực ${shortage.summary.onHand}, đang giữ ${shortage.summary.reserved}, khả dụng ${shortage.summary.available}`;
            const blockers = formatReservationSourceList(shortage.summary.entries);
            toast.error('Không đủ tồn khả dụng', `Kho "${whName}" - ${item?.name || shortage.itemId}: cần cấp ${shortage.issuedQty}; ${reason}.${blockers ? ` Vị trí giữ chỗ: ${blockers}.` : ''} Vui lòng xử lý phiếu pending/giữ chỗ trước.`);
            return;
        }

        const ok = await confirm({
            title: 'Tạo đợt cấp vật tư',
            targetName: request.code,
            subtitle: `Tạo phiếu xuất kho nội bộ cho ${validLines.length} dòng vật tư từ ${getWarehouseName(effectiveSource)}.`,
            confirmText: 'Xác nhận tạo đợt cấp',
            actionLabel: 'Tạo đợt cấp',
            cancelLabel: 'Kiểm tra lại',
            intent: 'success',
            countdownSeconds: 1,
        });
        if (!ok) return;

        setIsSaving(true);
        try {
            await materialRequestFulfillmentService.createIssuedBatch({
                request,
                sourceWarehouseId: effectiveSource,
                sourceType: issueSourceType,
                actorUserId: user.id,
                note: issueNote.trim() || undefined,
                overrideReason: overrideReason.trim() || undefined,
                allowOverCommit: isAdmin(user),
                lines: validLines.map(line => ({
                    requestLineId: line.requestLineId,
                    itemId: line.itemId,
                    issuedQty: line.issuedQty,
                    varianceReason: line.reason.trim() || undefined,
                })),
            });
            const freshBatches = await refreshFulfillmentBatches(request.id);
            const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
            await updateRequestStatus(request.id, nextStatus, issueNote.trim() || 'Tạo đợt cấp vật tư', undefined, effectiveSource, overrideReason.trim() || undefined, 'FULFILLMENT_ISSUED');
            await refreshFulfillmentWmsRecords(freshBatches);
            toast.success('Đã tạo đợt cấp', 'Đợt cấp đã được ghi nhận; thủ kho công trường sẽ duyệt SL/CL rồi xác nhận nhập kho.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.issue', err);
            toast.error('Không thể tạo đợt cấp', getApiErrorMessage(err, 'Không tạo được đợt cấp vật tư.'));
        } finally {
            setIsSaving(false);
        }
    };

    const openReceivePanel = (batch: MaterialRequestFulfillmentBatch, mode: ReceivePanelMode = 'receipt') => {
        setSelectedFulfillmentBatch(null);
        setReceivingBatch(batch);
        setReceivePanelMode(mode);
        setReceiveLines(batch.lines.map(line => ({
            lineId: line.id,
            qty: String(line.issuedQty || 0),
            reason: '',
        })));
    };

    const buildFulfillmentQualityReviewLines = (
        batch: MaterialRequestFulfillmentBatch,
        transaction: Transaction,
    ) => transaction.items.map((item, index) => {
        const batchLine = batch.lines.find(line =>
            line.requestLineId === item.requestLineId
            || (line.itemId === item.itemId && item.fulfillmentBatchId === batch.id)
        );
        if (!batchLine) {
            throw new Error(`Dòng ${index + 1}: Không tìm thấy dòng đợt cấp tương ứng.`);
        }

        const draft = receiveLines.find(line => line.lineId === batchLine.id);
        const quantity = Number(draft?.qty || 0);
        const reason = draft?.reason?.trim() || '';

        if (!Number.isFinite(quantity) || quantity < 0) {
            throw new Error(`Dòng ${index + 1}: Số lượng duyệt không được âm.`);
        }

        return { index, quantity, reason };
    });

    const handleApproveFulfillmentQuality = async () => {
        if (!request || !receivingBatch || isSaving) return;
        const tx = getFulfillmentBatchTransaction(receivingBatch);
        if (!tx) {
            toast.warning('Chưa tải được phiếu kho', 'Vui lòng tải lại dữ liệu WMS rồi thử lại.');
            await refreshFulfillmentWmsRecords([receivingBatch]);
            return;
        }
        if (tx.status !== TransactionStatus.PENDING) {
            toast.warning('Không đúng trạng thái', 'Phiếu kho không còn ở trạng thái chờ duyệt SL/CL.');
            return;
        }
        if (!canApproveWmsTransaction(user, tx)) {
            toast.warning('Không có quyền duyệt', 'Tài khoản của bạn không được phân công duyệt SL/CL cho phiếu kho này.');
            return;
        }

        let qualityLines: ReturnType<typeof buildFulfillmentQualityReviewLines>;
        try {
            qualityLines = buildFulfillmentQualityReviewLines(receivingBatch, tx);
        } catch (err: any) {
            toast.warning('Kiểm tra số lượng', getApiErrorMessage(err, 'Số lượng duyệt không hợp lệ.'));
            return;
        }

        const hasVariance = qualityLines.some(line => line.quantity !== Number(tx.items[line.index]?.quantity || 0));
        const ok = await confirm({
            title: 'Duyệt SL/CL đợt cấp',
            targetName: receivingBatch.batchNo,
            subtitle: hasVariance
                ? 'Có chênh lệch so với số lượng xuất. Hệ thống chỉ duyệt SL/CL và cập nhật số lượng phiếu kho, chưa cộng tồn kho nhận.'
                : 'Hệ thống chuyển phiếu kho sang trạng thái chờ xác nhận nhập kho. Tồn kho nhận chưa được cộng ở bước này.',
            confirmText: 'Xác nhận duyệt SL/CL',
            actionLabel: 'Duyệt SL/CL',
            cancelLabel: 'Kiểm tra lại',
            intent: hasVariance ? 'warning' : 'success',
            countdownSeconds: 1,
        });
        if (!ok) return;

        setIsSaving(true);
        try {
            await materialRequestFulfillmentService.updateTransactionReceiptQuantities({
                transaction: tx,
                stage: 'approval',
                lines: qualityLines,
            });
            await updateTransactionStatus(tx.id, TransactionStatus.APPROVED, user.id);
            const freshBatches = await refreshFulfillmentBatches(request.id);
            const freshSelected = freshBatches.find(batch => batch.id === receivingBatch.id) || receivingBatch;
            await refreshFulfillmentWmsRecords(freshBatches, { transactionIds: [tx.id] });
            setReceivingBatch(null);
            setSelectedFulfillmentBatch(freshSelected);
            toast.success('Đã duyệt SL/CL', hasVariance ? 'Phiếu kho đã cập nhật theo số lượng duyệt và chờ xác nhận nhập kho.' : 'Phiếu kho đang chờ xác nhận nhập kho.');
        } catch (err: any) {
            logApiError('requestModal.fulfillment.qualityReview', err);
            toast.error('Không thể duyệt SL/CL', getApiErrorMessage(err, 'Không cập nhật được phiếu kho.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleReceiveFulfillmentBatch = async () => {
        if (!request || !receivingBatch || isSaving) return;
        if (receivePanelMode === 'quality_review') {
            await handleApproveFulfillmentQuality();
            return;
        }
        const hasVariance = receivingBatch.lines.some(line => {
            const draft = receiveLines.find(item => item.lineId === line.id);
            return Number(draft?.qty || 0) !== Number(line.issuedQty || 0);
        });
        const ok = await confirm({
            title: 'Xác nhận thực nhận đợt cấp',
            targetName: receivingBatch.batchNo,
            subtitle: hasVariance
                ? 'Có chênh lệch giữa số xuất và số thực nhận. Hệ thống sẽ ghi nhận theo số thực nhận và cập nhật tồn kho ngay sau xác nhận.'
                : 'Hệ thống sẽ cập nhật lũy kế thực nhận của phiếu đề xuất.',
            confirmText: 'Xác nhận nhận hàng',
            actionLabel: 'Xác nhận nhận',
            cancelLabel: 'Kiểm tra lại',
            intent: hasVariance ? 'warning' : 'success',
            countdownSeconds: 1,
        });
        if (!ok) return;
        setIsSaving(true);
        try {
            const savedBatch = await materialRequestFulfillmentService.receiveBatch({
                request,
                batch: receivingBatch,
                actorUserId: user.id,
                overrideReason: overrideReason.trim() || undefined,
                allowOverCommit: isAdmin(user),
                lines: receiveLines.map(line => ({
                    lineId: line.lineId,
                    receivedQty: Number(line.qty || 0),
                    varianceReason: line.reason.trim() || undefined,
                })),
            });
            const freshBatches = await refreshFulfillmentBatches(request.id);
            const summaries = await materialRequestFulfillmentService.listSummariesByRequests([request]);
            const summary = summaries.summariesByRequestId[request.id];
            const nextStatus = summary && Number(summary.openNeedQty ?? summary.remainingToReceive ?? 0) <= 0
                ? RequestStatus.COMPLETED
                : materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
            await updateRequestStatus(request.id, nextStatus, 'Xác nhận nhận đợt cấp vật tư', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_RECEIVED');
            await refreshFulfillmentWmsRecords(freshBatches, { transactionIds: [savedBatch.transactionId] });
            toast.success(
                hasVariance ? 'Đã xác nhận nhận lệch' : 'Đã xác nhận nhận hàng',
                nextStatus === RequestStatus.COMPLETED ? 'Phiếu đề xuất đã đủ số lượng công trường đề xuất.' : 'Đã cập nhật tồn kho và lũy kế nhận hàng cho phiếu.'
            );
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.receive', err);
            toast.error('Không thể xác nhận nhận hàng', getApiErrorMessage(err, 'Không cập nhật được đợt cấp.'));
        } finally {
            setIsSaving(false);
        }
    };

    const openReturnReceivedDialog = (batch: MaterialRequestFulfillmentBatch) => {
        setSelectedFulfillmentBatch(null);
        setReturningReceivedBatch(batch);
        setReturnDestinationWarehouseId(batch.sourceWarehouseId || '');
        setReturnReceivedReason(overrideReason.trim());
    };

    const executeReturnReceivedBatch = async (
        batch: MaterialRequestFulfillmentBatch,
        destinationWarehouseId: string,
        reason?: string,
    ) => {
        if (!request || isSaving) return;
        const isDirectConsumptionReturn = batch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION && !batch.targetWarehouseId;
        const effectiveDestinationWarehouseId = isDirectConsumptionReturn ? (batch.sourceWarehouseId || destinationWarehouseId) : destinationWarehouseId;
        if (!batch.targetWarehouseId && !isDirectConsumptionReturn) {
            toast.warning('Không thể hoàn trả', 'Đợt cấp đã nhận thiếu kho công trường/kho nhận nên không xác định được nơi trừ tồn.');
            return;
        }
        if (!effectiveDestinationWarehouseId) {
            toast.warning(
                isDirectConsumptionReturn ? 'Không thể hoàn trả' : 'Chưa chọn kho hoàn trả',
                isDirectConsumptionReturn
                    ? 'Đợt xuất thẳng sử dụng thiếu kho nguồn ban đầu nên không thể nhập hoàn lại.'
                    : 'Vui lòng chọn kho nhận hoàn trả để hệ thống tạo phiếu đảo tồn.',
            );
            return;
        }
        if (!isDirectConsumptionReturn && effectiveDestinationWarehouseId === batch.targetWarehouseId) {
            toast.warning('Kho hoàn trả không hợp lệ', 'Kho nhận hoàn trả phải khác kho công trường đang giữ hàng.');
            return;
        }

        if (!isDirectConsumptionReturn) {
            const shortage = batch.lines
                .map(line => ({ ...line, summary: getStockSummary(line.itemId, batch.targetWarehouseId!) }))
                .find(line => Number(line.receivedQty || 0) > line.summary.available);
            if (shortage) {
                const item = items.find(inv => inv.id === shortage.itemId);
                const needQty = Number(shortage.receivedQty || 0);
                const reasonText = needQty > shortage.summary.onHand
                    ? `tồn thực còn ${shortage.summary.onHand.toLocaleString('vi-VN')}`
                    : `tồn thực ${shortage.summary.onHand.toLocaleString('vi-VN')}, đang giữ ${shortage.summary.reserved.toLocaleString('vi-VN')}, khả dụng ${shortage.summary.available.toLocaleString('vi-VN')}`;
                const blockers = formatReservationSourceList(shortage.summary.entries);
                toast.error('Không đủ tồn để hoàn trả', `${item?.name || shortage.itemId}: cần hoàn ${needQty.toLocaleString('vi-VN')}; ${reasonText}.${blockers ? ` Vị trí giữ chỗ: ${blockers}.` : ''} Vui lòng xử lý phiếu pending/giữ chỗ tại kho nhận trước.`);
                return;
            }
        }

        const sourceLabel = getFulfillmentSourceLabel(batch);
        const returnSubtitle = isDirectConsumptionReturn
            ? `Hệ thống sẽ tạo phiếu nhập hoàn lại vào ${getWarehouseName(effectiveDestinationWarehouseId)} và loại đợt xuất thẳng này khỏi lũy kế thực nhận/sử dụng.`
            : `Hệ thống sẽ tạo phiếu hoàn kho từ ${getWarehouseName(batch.targetWarehouseId)} về ${getWarehouseName(effectiveDestinationWarehouseId)} và loại đợt này khỏi lũy kế thực nhận. Nguồn gốc đợt cấp: ${sourceLabel}.`;
        const ok = await confirm({
            title: 'Admin hoàn trả đợt đã nhận',
            targetName: batch.batchNo,
            confirmText: 'Xác nhận hoàn trả',
            subtitle: returnSubtitle,
            intent: 'danger',
            actionLabel: 'Hoàn trả và đảo tồn',
            cancelLabel: 'Giữ nguyên',
            countdownSeconds: 2,
        });
        if (!ok) return;

        setIsSaving(true);
        try {
            const returnTransactionId = `tx-mr-return-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const returnTransaction: Transaction = {
                id: returnTransactionId,
                type: isDirectConsumptionReturn ? TransactionType.IMPORT : TransactionType.TRANSFER,
                date: new Date().toISOString(),
                items: batch.lines
                    .filter(line => Number(line.receivedQty || 0) > 0)
                    .map(line => ({
                        itemId: line.itemId,
                        quantity: Number(line.receivedQty || 0),
                        materialRequestId: request.id,
                        requestLineId: line.requestLineId,
                    })),
                sourceWarehouseId: isDirectConsumptionReturn ? undefined : batch.targetWarehouseId,
                targetWarehouseId: effectiveDestinationWarehouseId,
                requesterId: user.id,
                approverId: user.id,
                status: TransactionStatus.COMPLETED,
                note: isDirectConsumptionReturn
                    ? `Admin hoàn trả đợt xuất thẳng sử dụng ${batch.batchNo} của phiếu ${request.code}. Nhập hoàn lại kho nguồn: ${sourceLabel}`
                    : `Admin hoàn trả đợt cấp ${batch.batchNo} của phiếu ${request.code}. Nguồn gốc: ${sourceLabel}`,
                relatedRequestId: request.id,
            };
            await addTransaction(returnTransaction);
            await materialRequestFulfillmentService.returnReceivedBatch({
                batch,
                actorUserId: user.id,
                reason: reason?.trim() || overrideReason.trim() || 'Admin hoàn trả đợt cấp đã nhận',
                returnTransactionId,
            });
            const freshBatches = await refreshFulfillmentBatches(request.id);
            const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
            await updateRequestStatus(request.id, nextStatus, 'Admin hoàn trả đợt cấp đã nhận và đảo tồn kho', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_RECEIVED');
            await refreshFulfillmentWmsRecords(freshBatches, { transactionIds: [batch.transactionId, returnTransactionId] });
            toast.success('Đã hoàn trả đợt cấp', nextStatus === RequestStatus.APPROVED ? 'Phiếu đề xuất đã quay lại trạng thái chờ cấp hàng.' : 'Đã đảo tồn và cập nhật lại lũy kế.');
            setReturningReceivedBatch(null);
            setReturnDestinationWarehouseId('');
            setReturnReceivedReason('');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.returnReceived', err);
            toast.error('Không thể hoàn trả đợt đã nhận', getApiErrorMessage(err, 'Không hoàn trả được tồn kho cho đợt cấp.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleReturnFulfillmentBatch = async (batch: MaterialRequestFulfillmentBatch) => {
        if (!request || isSaving) return;
        if (batch.status === 'received') {
            if (!isAdmin(user)) {
                toast.warning('Chỉ Admin được hoàn trả', 'Đợt cấp đã nhận đã phát sinh tồn kho, chỉ Admin được hoàn trả để đảo tồn.');
                return;
            }
            const isDirectConsumptionReturn = batch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION && !batch.targetWarehouseId;
            if (!batch.targetWarehouseId && !isDirectConsumptionReturn) {
                toast.warning('Không thể hoàn trả', 'Đợt cấp đã nhận thiếu kho công trường/kho nhận nên không xác định được nơi trừ tồn.');
                return;
            }
            if (isDirectConsumptionReturn) {
                await executeReturnReceivedBatch(batch, batch.sourceWarehouseId || '');
                return;
            }
            if (!batch.sourceWarehouseId) {
                openReturnReceivedDialog(batch);
                return;
            }
            await executeReturnReceivedBatch(batch, batch.sourceWarehouseId);
            return;
        }

        const ok = await confirm({
            title: 'Trả lại / hoàn hàng đợt cấp',
            targetName: batch.batchNo,
            confirmText: 'Xác nhận trả lại',
            subtitle: 'Đợt cấp đang vận chuyển sẽ bị hoàn về kho nguồn và phiếu đề xuất sẽ quay lại phần còn lại cần cấp.',
            intent: 'danger',
            actionLabel: 'Trả lại đợt cấp',
            cancelLabel: 'Giữ nguyên',
            countdownSeconds: 1,
        });
        if (!ok) return;
        setIsSaving(true);
        try {
            await materialRequestFulfillmentService.returnIssuedBatch({
                batch,
                actorUserId: user.id,
                reason: overrideReason.trim() || undefined,
            });
            const freshBatches = await refreshFulfillmentBatches(request.id);
            const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
            await updateRequestStatus(request.id, nextStatus, 'Trả lại/hoàn hàng đợt cấp vật tư', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_RECEIVED');
            await refreshFulfillmentWmsRecords(freshBatches, { transactionIds: [batch.transactionId] });
            toast.success('Đã trả lại đợt cấp', nextStatus === RequestStatus.APPROVED ? 'Phiếu đề xuất đã quay lại trạng thái chờ cấp hàng.' : 'Đã cập nhật lại lũy kế cấp/nhận cho phiếu.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.return', err);
            toast.error('Không thể trả lại đợt cấp', getApiErrorMessage(err, 'Không cập nhật được đợt cấp.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleResolveFulfillmentVariance = async (batch: MaterialRequestFulfillmentBatch) => {
        if (!request || isSaving) return;
        const ok = await confirm({
            title: 'Chốt lệch đợt cấp',
            targetName: batch.batchNo,
            confirmText: 'Chốt tồn kho theo số lượng công trường thực nhận',
            subtitle: 'Sau khi chốt, phiếu kho sẽ cập nhật theo số thực nhận thay vì số phòng vật tư đã xuất.',
            intent: 'warning',
            actionLabel: 'Chốt lệch',
            cancelLabel: 'Kiểm tra lại',
            countdownSeconds: 1,
        });
        if (!ok) return;
        setIsSaving(true);
        try {
            await materialRequestFulfillmentService.resolveVarianceBatch({
                batch,
                actorUserId: user.id,
            });
            const freshBatches = await refreshFulfillmentBatches(request.id);
            const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
            await updateRequestStatus(request.id, nextStatus, 'Chốt lệch đợt cấp vật tư theo thực nhận', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_RECEIVED');
            await refreshFulfillmentWmsRecords(freshBatches, { transactionIds: [batch.transactionId] });
            toast.success('Đã chốt lệch', nextStatus === RequestStatus.COMPLETED ? 'Phiếu đề xuất đã đủ số lượng công trường đề xuất.' : 'Tồn kho đã cập nhật theo số thực nhận.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.resolveVariance', err);
            toast.error('Không thể chốt lệch', getApiErrorMessage(err, 'Không cập nhật được đợt cấp lệch.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handlePrintMaterialRequest = () => {
        if (!request) return;
        const escapeHtml = (value: unknown) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        const requesterName = request.requestedBy
            || users.find(item => item.id === request.requesterId)?.name
            || employees.find(item => item.userId === request.requesterId)?.fullName
            || request.requesterId
            || '-';
        const rows = (request.items || []).map((line, index) => `
            <tr>
                <td class="center">${index + 1}</td>
                <td>${escapeHtml(getLineName(line))}</td>
                <td class="center">${escapeHtml(getLineUnit(line))}</td>
                <td class="right">${Number(line.requestQty || 0).toLocaleString('vi-VN')}</td>
            </tr>
        `).join('');
        const html = `
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8" />
                <title>${escapeHtml(request.code || 'Phieu_de_xuat_vat_tu')}</title>
                <style>
                    body { font-family: Arial, sans-serif; color: #111827; padding: 28px; }
                    h1 { margin: 0 0 18px; text-align: center; font-size: 21px; letter-spacing: 0; }
                    .meta { display: grid; grid-template-columns: 160px 1fr; gap: 8px 14px; margin-bottom: 18px; font-size: 13px; }
                    .meta span { color: #4b5563; font-weight: 700; }
                    .meta strong { color: #111827; }
                    table { width: 100%; border-collapse: collapse; font-size: 13px; }
                    th, td { border: 1px solid #9ca3af; padding: 8px 9px; text-align: left; vertical-align: top; }
                    th { background: #f3f4f6; text-align: center; font-size: 11px; text-transform: uppercase; }
                    .center { text-align: center; }
                    .right { text-align: right; font-weight: 700; }
                    .signatures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-top: 42px; text-align: center; font-size: 12px; font-weight: 700; }
                    .signature-space { height: 72px; }
                    @media print { body { padding: 18px; } }
                </style>
            </head>
            <body>
                <h1>PHIẾU ĐỀ XUẤT VẬT TƯ</h1>
                <div class="meta">
                    <span>Tên đề xuất</span><strong>${escapeHtml(request.title || request.code || '-')}</strong>
                    <span>Người yêu cầu</span><strong>${escapeHtml(requesterName)}</strong>
                    <span>Kho nhận hàng</span><strong>${escapeHtml(getWarehouseName(request.siteWarehouseId || siteWarehouseId || defaultSiteWarehouseId))}</strong>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:52px;">STT</th>
                            <th>Tên vật tư đề xuất</th>
                            <th style="width:90px;">ĐVT</th>
                            <th style="width:130px;">Số lượng YC</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="signatures">
                    <div>Người lập phiếu<div class="signature-space"></div></div>
                    <div>Phòng vật tư<div class="signature-space"></div></div>
                    <div>Phòng QLDA<div class="signature-space"></div></div>
                    <div>Giám đốc vật tư<div class="signature-space"></div></div>
                </div>
                <script>
                    window.addEventListener('load', function () {
                        window.focus();
                        setTimeout(function () { window.print(); }, 250);
                    });
                </script>
            </body>
            </html>
        `;
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            toast.error('Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup in phiếu đề xuất.');
            return;
        }
        printWindow.document.write(html);
        printWindow.document.close();
    };

    const handlePrintFulfillmentBatch = async (batch: MaterialRequestFulfillmentBatch, mode: 'print' | 'pdf' = 'print') => {
        if (!request) return;
        try {
            const printableBatch = await materialRequestFulfillmentService.ensureQrToken(batch);
            setSelectedFulfillmentBatch(printableBatch);
            const receiveUrl = buildFulfillmentBatchReceiveUrl(printableBatch.qrToken!);
            const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={132} level="H" includeMargin />);
            const documentTitle = `${mode === 'pdf' ? 'PDF_' : ''}Phieu_xuat_kho_${printableBatch.batchNo}`;
            const rows = printableBatch.lines.map(line => {
                const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                return `
                    <tr>
                        <td>${requestLine ? getLineName(requestLine) : line.itemId}</td>
                        <td class="right">${Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                        <td>${line.unit || requestLine?.unitSnapshot || ''}</td>
                    </tr>
                `;
            }).join('');
            const html = `
                <!doctype html>
                <html>
                <head>
                    <meta charset="utf-8" />
                    <title>${documentTitle}</title>
                    <style>
                        body { font-family: Arial, sans-serif; color: #0f172a; padding: 28px; }
                        .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
                        h1 { margin: 0; font-size: 22px; }
                        .meta { margin-top: 8px; color: #475569; font-size: 12px; line-height: 1.6; }
                        .qr { text-align: center; color: #64748b; font-size: 11px; font-weight: 700; }
                        table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 13px; }
                        th, td { border: 1px solid #cbd5e1; padding: 9px; text-align: left; }
                        th { background: #f1f5f9; text-transform: uppercase; font-size: 11px; color: #475569; }
                        .right { text-align: right; font-weight: 700; }
                        .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 42px; text-align: center; font-size: 12px; font-weight: 700; }
                        .signature-space { height: 64px; }
                        @media print { body { padding: 18px; } }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div>
                            <h1>PHIẾU XUẤT KHO NỘI BỘ</h1>
                            <div class="meta">
                                Mã đợt cấp: <b>${printableBatch.batchNo}</b><br/>
                                Phiếu đề xuất: <b>${request.code}</b><br/>
                                Ngày xuất: ${new Date(printableBatch.batchDate).toLocaleString('vi-VN')}<br/>
                                Kho xuất/Nguồn: ${getFulfillmentSourceLabel(printableBatch)}<br/>
                                Kho nhận: ${printableBatch.targetWarehouseId ? getWarehouseName(printableBatch.targetWarehouseId) : 'Cấp thẳng sử dụng'}
                            </div>
                        </div>
                        <div class="qr">${qrSvg}<div>CT quét QR để xác nhận thực nhận</div></div>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Vật tư</th><th>Số lượng xuất</th><th>ĐVT</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                    ${printableBatch.note ? `<div class="meta"><b>Ghi chú:</b> ${printableBatch.note}</div>` : ''}
                    <div class="signatures">
                        <div>Người lập<div class="signature-space"></div></div>
                        <div>Thủ kho xuất<div class="signature-space"></div></div>
                        <div>Thủ kho/CT nhận<div class="signature-space"></div></div>
                    </div>
                    <script>
                        window.addEventListener('load', function () {
                            window.focus();
                            setTimeout(function () { window.print(); }, 250);
                        });
                    </script>
                </body>
                </html>
            `;
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                toast.error(mode === 'pdf' ? 'Không thể mở cửa sổ xuất PDF' : 'Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup phiếu xuất kho.');
                return;
            }
            printWindow.document.write(html);
            printWindow.document.close();
            if (mode === 'pdf') {
                toast.info('Xuất PDF', 'Trong hộp thoại in, chọn "Save as PDF" để lưu file.');
            }
        } catch (err: any) {
            logApiError('requestModal.fulfillment.print', err);
            toast.error(mode === 'pdf' ? 'Không thể xuất PDF' : 'Không thể in phiếu xuất', getApiErrorMessage(err, 'Không tạo được mã QR cho đợt cấp.'));
        }
    };

    if (!isOpen) return null;

    const isEditable = step === 'CREATE';
    const isProjectWorkflowApproving = step === 'APPROVE' && canReviewProjectWorkflow;
    const isApproving = step === 'APPROVE' && !isProjectWorkflowApproving;
    const isViewing = step === 'VIEW';

    const permissionRequest = request ? { ...request, sourceWarehouseId: sourceWarehouseId || request.sourceWarehouseId } : undefined;
    const canPrepareIssue = !!request
        && request.status === RequestStatus.APPROVED
        && !request.relatedTransactionId
        && (
            isAdmin(user)
            || isGlobalWarehouseKeeper(user)
            || isWarehouseKeeperFor(user, sourceWarehouseId || request.sourceWarehouseId)
        );
    const canEditApprovalQuantities = isApproving || canPrepareIssue || canPlanProjectFulfillment;
    const canCreateFulfillmentBatch = !!request
        && isBatchFulfillmentRequest
        && (request.status === RequestStatus.APPROVED || request.status === RequestStatus.IN_TRANSIT)
        && (
            canPlanProjectFulfillment
            ||
            isAdmin(user)
            || isGlobalWarehouseKeeper(user)
            || isWarehouseKeeperFor(user, sourceWarehouseId || request.sourceWarehouseId)
        );
    const canReturn = !!request
        && !request.relatedTransactionId
        && !isProjectWorkflowApproving
        && (request.status === RequestStatus.PENDING || request.status === RequestStatus.APPROVED)
        && (
            isAdmin(user)
            || (request.status === RequestStatus.PENDING && canApproveMaterialRequest(user, request))
            || canPrepareIssue
        );
    const canExport = !isBatchFulfillmentRequest && permissionRequest ? canExportMaterialRequest(user, permissionRequest) : false;
    const canReceive = !isBatchFulfillmentRequest && request ? canReceiveMaterialRequest(user, request) : false;
    const canReceiveFulfillmentBatch = !!request
        && isBatchFulfillmentRequest
        && actionableFulfillmentBatches.length > 0
        && (
            isAdmin(user)
            || isGlobalWarehouseKeeper(user)
            || isWarehouseKeeperFor(user, request.siteWarehouseId)
            || (request.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION && isWarehouseKeeperFor(user, sourceWarehouseId || request.sourceWarehouseId))
        );
    const selectedFulfillmentTransaction = getFulfillmentBatchTransaction(selectedFulfillmentBatch);
    const selectedFulfillmentUiStatus = selectedFulfillmentBatch ? getFulfillmentBatchUiStatus(selectedFulfillmentBatch) : null;
    const canApproveSelectedFulfillmentTransaction = !!selectedFulfillmentTransaction && canApproveWmsTransaction(user, selectedFulfillmentTransaction);
    const canReceiveSelectedFulfillmentTransaction = !!selectedFulfillmentTransaction && canReceiveWmsTransaction(user, selectedFulfillmentTransaction);

    const sourceWh = warehouses.find(w => w.id === sourceWarehouseId);
    const targetWh = warehouses.find(w => w.id === siteWarehouseId);
    const requester = users.find(u => u.id === (request?.requesterId || user.id));
    const latestRequestLog = request?.logs?.[request.logs.length - 1];
    const isReturnedDraft = request?.status === RequestStatus.DRAFT && latestRequestLog?.action === 'RETURNED';
    const requestStatusText = isReturnedDraft
        ? 'Bị trả lại'
        : request?.status === RequestStatus.DRAFT
            ? 'Nháp'
            : request?.status || 'NEW';
    const canSeeAvailability = !isProjectRequest || canViewAvailableStock;
    const showSourceWarehouseField = !isEditable || !isProjectRequest || canEditApprovalQuantities;
    const stockContextWarehouseId = isEditable && isProjectRequest ? stockPreviewWarehouseId : sourceWarehouseId;
    const editableBudgetSnapshots = isEditable ? buildSequentialLineBudgetSnapshots(reqItems, request?.id) : null;
    const requestDisplayRows: RequestDisplayRow[] = isEditable ? reqItems : (request?.items || []);
    const materialDisplayGroups = requestDisplayRows.reduce<RequestDisplayGroup[]>((groups, row, index) => {
        const itemId = row.itemId;
        const sku = getLineSku(row);
        const unit = getLineUnit(row);
        const name = getLineName(row);
        const key = sku
            ? `sku:${sku.toLowerCase()}`
            : itemId
                ? `item:${itemId}`
                : `name:${(row.materialBudgetItemName || name || '').toLowerCase()}::${unit || ''}`;
        const requestQty = isEditable ? Number((row as RequestLineDraft).qty || 0) : Number((row as RequestItem).requestQty || 0);
        const lineId = row.lineId;
        const requestLineId = request && !isEditable ? getRequestLineId(request, row as RequestItem, index) : lineId;
        const lineFulfillment = requestLineId ? fulfillmentLineSummaryMap.get(requestLineId) : undefined;
        const approvedQty = approvedItems.find(ai => (lineId && ai.lineId === lineId) || (!lineId && ai.itemId === itemId))?.qty
            ?? (!isEditable ? Number((row as RequestItem).approvedQty || 0) : 0);
        const issuedQty = lineFulfillment?.issuedQty || Number((row as RequestItem).issuedQty || 0);
        const receivedQty = lineFulfillment?.receivedQty || 0;
        const remainingToReceive = lineFulfillment?.remainingToReceive ?? Math.max(0, requestQty - receivedQty);
        const source: RequestDisplaySource = {
            row,
            index,
            requestQty,
            approvedQty,
            issuedQty,
            receivedQty,
            remainingToReceive,
            isExcess: !isEditable && approvedQty > requestQty,
        };
        const existing = groups.find(group => group.key === key);
        if (existing) {
            existing.sources.push(source);
            existing.requestQty += requestQty;
            existing.approvedQty += approvedQty;
            existing.issuedQty += issuedQty;
            existing.receivedQty += receivedQty;
            existing.remainingToReceive += remainingToReceive;
            existing.isExcess = existing.isExcess || source.isExcess;
            return groups;
        }
        groups.push({
            key,
            itemId,
            name,
            sku: sku || '',
            unit: unit || '',
            specification: row.specification,
            sources: [source],
            requestQty,
            approvedQty,
            issuedQty,
            receivedQty,
            remainingToReceive,
            isExcess: source.isExcess,
        });
        return groups;
    }, []);
    const toggleMaterialGroup = (groupKey: string) => {
        setExpandedMaterialGroupKeys(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });
    };
    const canDeleteRequest = !!request
        && [RequestStatus.DRAFT, RequestStatus.PENDING, RequestStatus.REJECTED].includes(request.status)
        && (
            isAdmin(user)
            || (request.requesterId === user.id && (request.status === RequestStatus.DRAFT || request.status === RequestStatus.REJECTED))
        );
    const isDynamicReturnedDraft = !!request
        && request.status === RequestStatus.DRAFT
        && projectWorkflowSubject?.status === 'RETURNED'
        && request.requesterId === user.id;
    const canSubmitDraft = !!request
        && request.status === RequestStatus.DRAFT
        && request.requesterId === user.id
        && projectWorkflowSubject?.status !== 'RETURNED';

    return (
        <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 h-[100dvh] max-h-[100dvh] overflow-hidden">
            <div className="bg-card text-card-foreground border border-border rounded-t-2xl sm:rounded-2xl w-full sm:w-[70vw] xl:max-w-[1050px] 2xl:max-w-[1180px] shadow-2xl flex flex-col h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[85vh] overflow-hidden relative">

                {/* Decision Overlay */}
                {showApprovalPanel && (
                    <div className="absolute inset-0 z-[60] bg-card/95 text-card-foreground backdrop-blur-sm flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-200">
                        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mb-6">
                            <AlertCircle size={32} />
                        </div>
                        <h3 className="text-2xl font-bold text-foreground mb-2">Xác nhận xử lý phiếu</h3>
                        <p className="text-muted-foreground mb-10 text-center max-w-md">Vui lòng chọn Phê duyệt để chuyển sang bước xuất kho, hoặc Từ chối để hủy yêu cầu này.</p>

                        <div className="flex gap-4 w-full max-w-md">
                            <button
                                disabled={isSaving}
                                onClick={() => handleAction(RequestStatus.REJECTED)}
                                className="flex-1 py-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center shadow-lg shadow-red-500/20"
                            >
                                {isSaving ? <Loader2 size={20} className="mr-2 animate-spin" /> : <XCircle size={20} className="mr-2" />} {isSaving ? 'ĐANG XỬ LÝ...' : 'TỪ CHỐI'}
                            </button>
                            <button
                                disabled={isSaving}
                                onClick={() => handleAction(RequestStatus.APPROVED)}
                                className="flex-1 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center shadow-lg shadow-emerald-500/20"
                            >
                                {isSaving ? <Loader2 size={20} className="mr-2 animate-spin" /> : <CheckCircle size={20} className="mr-2" />} {isSaving ? 'ĐANG XỬ LÝ...' : 'PHÊ DUYỆT'}
                            </button>
                        </div>
                        <button
                            onClick={() => setShowApprovalPanel(false)}
                            className="mt-8 text-muted-foreground font-bold hover:text-foreground"
                        >
                            Quay lại xem thông tin
                        </button>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
                    <div className="min-w-0">
                        <h3 className="font-bold text-lg text-foreground">
                            {requestTitle.trim() || request?.title || (isEditable && !request ? 'Tạo đề xuất vật tư' : 'Đề xuất vật tư')}
                        </h3>
                        <p className="truncate text-xs text-muted-foreground">
                            {request?.code ? `${request.code} - Đề xuất vật tư` : 'Phiếu mới - Đề xuất vật tư'}
                            {request ? ` • Trạng thái: ${requestStatusText}${request.submittedToName ? ` • Gửi: ${request.submittedToName}` : ''}` : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Status Bar */}
                {!isEditable && (
                    <div className={`px-6 py-2 text-white text-[10px] font-bold flex justify-between items-center ${request?.status === RequestStatus.PENDING ? 'bg-amber-600' :
                        request?.status === RequestStatus.APPROVED ? 'bg-blue-600' :
                            request?.status === RequestStatus.IN_TRANSIT ? 'bg-indigo-600' :
                                request?.status === RequestStatus.COMPLETED ? 'bg-emerald-600' :
                                    request?.status === RequestStatus.REJECTED ? 'bg-red-655' :
                                        isReturnedDraft ? 'bg-rose-605' :
                                            request?.status === RequestStatus.DRAFT ? 'bg-slate-500' : 'bg-slate-600'
                        }`}>
                        <div className="flex items-center uppercase tracking-widest">
                            <Info size={14} className="mr-2" />
                            {request?.status === RequestStatus.PENDING ? 'Đang chờ thẩm định' :
                                request?.status === RequestStatus.APPROVED ? 'Đã duyệt - Chờ xuất hàng' :
                                    request?.status === RequestStatus.IN_TRANSIT ? 'Đang trên đường vận chuyển' :
                                        request?.status === RequestStatus.COMPLETED ? (fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Đã cấp thẳng sử dụng' : 'Đã nhập kho công trường thành công') :
                                            isReturnedDraft ? 'Phiếu bị trả lại - đang ở Nháp' :
                                                request?.status === RequestStatus.DRAFT ? 'Phiếu nháp - chưa gửi duyệt' :
                                                    request?.status === RequestStatus.REJECTED ? 'Đề xuất này đã bị từ chối' : 'Đề xuất đã đóng'}
                        </div>
                        <div className="font-mono">{new Date(request?.createdDate || '').toLocaleDateString('vi-VN')}</div>
                    </div>
                )}

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 min-h-0 bg-slate-50/10 dark:bg-background/20 -webkit-overflow-scrolling-touch">
                    {isEditable && (
                        <div className="mb-5 rounded-xl border border-blue-200/50 bg-card p-4 shadow-sm dark:border-blue-900/40">
                            <label className="mb-2 block text-[10px] font-black uppercase text-blue-600 dark:text-blue-400">
                                Tên đề xuất
                            </label>
                            <input
                                type="text"
                                value={requestTitle}
                                onChange={(event) => setRequestTitle(event.target.value)}
                                maxLength={200}
                                autoFocus={!request}
                                className="w-full bg-transparent text-base font-black text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground"
                                placeholder="Ví dụ: Vật tư thi công sàn tầng 4"
                            />
                        </div>
                    )}
                    {projectWorkflowSubject && request && (
                        <ProjectWorkflowPanel
                            subject={projectWorkflowSubject}
                            documentName={request.code}
                            requesterUserId={request.requesterId}
                            currentUserId={user.id}
                            users={users}
                            employees={employees}
                            orgUnits={orgUnits}
                            nodes={projectWorkflowNodes}
                            assignments={projectWorkflowAssignments}
                            nextNode={projectWorkflowNextNode}
                            returnTargetNode={projectWorkflowReturnTargetNode}
                            canAct={canReviewProjectWorkflow}
                            canReassign={canReviewProjectWorkflow || canManageProjectWorkflow}
                            canResubmit={isDynamicReturnedDraft && request.requesterId === user.id}
                            canRollback={canManageProjectWorkflow}
                            completionHandoff={{
                                required: true,
                                eligiblePermissionCodes: ['approve'],
                                actionLabel: 'Duyệt và bàn giao cấp hàng',
                                assigneeLabel: 'Người phụ trách tạo đợt cấp / đặt mua',
                                helperText: 'Workflow phê duyệt sẽ hoàn thành. Phiếu vật tư chuyển sang Chờ tạo đợt cấp và giao cho người được chọn để cấp hàng hoặc đặt mua.',
                            }}
                            disabled={isSaving}
                            onAction={handleProjectWorkflowPanelAction}
                        />
                    )}
                    {projectWorkflowSubject && request && (
                        <ProjectWorkflowCommentsPanel
                            subject={projectWorkflowSubject}
                            users={users}
                            currentUserId={user.id}
                            documentName={request.code}
                            disabled={isSaving}
                        />
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                        <div className="bg-card p-4 rounded-xl border border-border shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Người yêu cầu</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <User size={18} className="text-slate-400" />
                                <span className="text-sm">{requester?.name || 'N/A'}</span>
                            </div>
                        </div>

                        {!isEditable && request?.submittedToName && (
                            <div className="bg-card p-4 rounded-xl border border-amber-200/40 dark:border-amber-900/40 shadow-sm space-y-2">
                                <label className="text-[10px] uppercase font-black text-amber-500">Người nhận xử lý</label>
                                <div className="flex items-center gap-2 text-amber-700 font-bold">
                                    <User size={18} className="text-amber-400" />
                                    <span className="text-sm">{request.submittedToName}</span>
                                </div>
                                {request.submissionNote && <div className="text-[10px] text-slate-400 truncate">{request.submissionNote}</div>}
                            </div>
                        )}

                        <div className="bg-card p-4 rounded-xl border border-border shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Kho nhận hàng</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <Truck size={18} className="text-slate-400" />
                                {isEditable ? (
                                    <select
                                        value={siteWarehouseId}
                                        onChange={(e) => setSiteWarehouseId(e.target.value)}
                                        className="w-full bg-transparent outline-none text-sm"
                                    >
                                        <option value="">-- Chọn kho nhận --</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                ) : (
                                    <span className="text-sm">{targetWh?.name}</span>
                                )}
                            </div>
                        </div>

                        {showSourceWarehouseField && (
                            <div className="bg-card p-4 rounded-xl border border-blue-200/40 dark:border-blue-900/40 shadow-sm space-y-2">
                                <label className="text-[10px] uppercase font-black text-blue-400">Kho cung cấp</label>
                                <div className="flex items-center gap-2 text-blue-700 font-bold">
                                    <PackageCheck size={18} className="text-blue-400" />
                                    {isEditable || canEditApprovalQuantities ? (
                                        <select
                                            value={sourceWarehouseId}
                                            onChange={(e) => setSourceWarehouseId(e.target.value)}
                                            className="w-full bg-transparent outline-none text-sm"
                                        >
                                            <option value="">{isProjectRequest ? '-- Phòng vật tư phân nguồn sau --' : '-- Chọn kho nguồn --'}</option>
                                            {warehouses.filter(w => w.id !== siteWarehouseId).map(w => (
                                                <option key={w.id} value={w.id}>{w.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span className="text-sm">{sourceWh?.name || 'Chưa phân nguồn'}</span>
                                    )}
                                </div>
                            </div>
                        )}

                        {isEditable && isProjectRequest && canSeeAvailability && (
                            <div className="bg-card p-4 rounded-xl border border-cyan-200/40 dark:border-cyan-900/40 shadow-sm space-y-2">
                                <label className="text-[10px] uppercase font-black text-cyan-500">Xem tồn kho khi đề xuất</label>
                                <div className="flex items-center gap-2 text-cyan-700 font-bold">
                                    <PackageCheck size={18} className="text-cyan-400" />
                                    <select
                                        value={stockPreviewWarehouseId}
                                        onChange={(e) => setStockPreviewWarehouseId(e.target.value)}
                                        className="w-full bg-transparent outline-none text-sm"
                                    >
                                        <option value="">Tổng tồn tất cả kho</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Ngày giờ yêu cầu */}
                        <div className="bg-card p-4 rounded-xl border border-border shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Ngày giờ yêu cầu</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <Clock size={18} className="text-slate-400" />
                                <span className="text-sm font-bold font-mono">
                                    {isEditable && !request
                                        ? formatFullDateTime(new Date().toISOString())
                                        : formatFullDateTime(request?.createdDate || request?.date)}
                                </span>
                            </div>
                        </div>

                        {/* Hạn giao mong muốn */}
                        <div className="bg-card p-4 rounded-xl border border-rose-200/40 dark:border-rose-900/40 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-rose-500">Hạn giao mong muốn (Ngày cần)</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <Clock size={18} className="text-rose-400" />
                                {isEditable ? (
                                    <input
                                        type="datetime-local"
                                        value={toDatetimeLocalString(expectedDate)}
                                        onChange={(e) => setExpectedDate(toISOStringFromLocal(e.target.value))}
                                        className="w-full bg-transparent outline-none text-sm font-bold text-slate-700 font-mono"
                                    />
                                ) : (
                                    <span className="text-sm font-bold font-mono text-rose-700">
                                        {formatFullDateTime(request?.expectedDate)}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="bg-card p-4 rounded-xl border border-border shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Ghi chú phiếu</label>
                            <input
                                type="text"
                                disabled={!isEditable && !canEditApprovalQuantities}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="w-full bg-transparent outline-none text-sm text-slate-700"
                                placeholder="Lý do hoặc chỉ dẫn..."
                            />
                        </div>
                        <div className="bg-card p-4 rounded-xl border border-emerald-250/40 dark:border-emerald-900/40 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-emerald-500">Cách cấp vật tư</label>
                            {isEditable ? (
                                <select
                                    value={fulfillmentMode}
                                    onChange={(e) => setFulfillmentMode(e.target.value as MaterialRequestFulfillmentMode)}
                                    className="w-full bg-transparent outline-none text-sm font-bold text-slate-700"
                                >
                                    <option value={MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK}>Nhập kho công trường</option>
                                    <option value={MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION}>Cấp thẳng sử dụng</option>
                                </select>
                            ) : (
                                <span className="text-sm font-bold text-slate-700">
                                    {fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Cấp thẳng sử dụng' : 'Nhập kho công trường'}
                                </span>
                            )}
                        </div>

                        {canEditApprovalQuantities && isAdmin(user) && (
                            <div className="bg-card p-4 rounded-xl border border-amber-250/45 dark:border-amber-900/45 shadow-sm space-y-2">
                                <label className="text-[10px] uppercase font-black text-amber-600">Lý do override</label>
                                <input
                                    type="text"
                                    value={overrideReason}
                                    onChange={(e) => setOverrideReason(e.target.value)}
                                    className="w-full bg-transparent outline-none text-sm text-slate-700"
                                    placeholder="Bắt buộc nếu duyệt vượt tồn khả dụng"
                                />
                            </div>
                        )}
                    </div>

                    {isEditable && isProjectRequest && (
                        <div className="mb-5 rounded-xl border border-amber-200/30 dark:border-amber-900/30 bg-amber-50/10 dark:bg-amber-950/10 p-4">
                            <div className={`flex items-center justify-between gap-3 ${boqSectionExpanded ? 'mb-3' : ''}`}>
                                <div>
                                    <div className="text-xs font-black text-foreground">Thêm vật tư theo BOQ triển khai</div>
                                    <div className="text-[10px] font-bold text-muted-foreground">BOQ là mức trần cảnh báo; đề xuất vượt vẫn gửi được khi nhập lý do.</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setBoqSectionExpanded(!boqSectionExpanded)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 text-[10px] font-black text-amber-700 bg-white dark:bg-slate-900 hover:bg-amber-50/55 transition-colors active:scale-95 shrink-0"
                                >
                                    {boqSectionExpanded ? (
                                        <>
                                            Thu gọn <ChevronUp size={12} />
                                        </>
                                    ) : (
                                        <>
                                            Mở rộng <ChevronDown size={12} />
                                        </>
                                    )}
                                </button>
                            </div>
                            {boqSectionExpanded && (
	                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
	                                <div className="relative md:col-span-7">
		                                    <input
		                                        value={draftWorkBoqSearch}
		                                        onChange={event => {
		                                            setDraftWorkBoqSearch(event.target.value);
		                                            setWorkBoqSearchOpen(true);
		                                        }}
	                                        onFocus={() => setWorkBoqSearchOpen(true)}
	                                        onBlur={() => window.setTimeout(() => setWorkBoqSearchOpen(false), 150)}
	                                        placeholder="Tìm đầu mục công việc..."
	                                        className="w-full px-3 py-2 rounded-xl border border-amber-200/40 dark:border-amber-800/40 bg-card text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300 text-foreground"
	                                    />
	                                    {isWorkBoqSearchOpen && (
	                                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-amber-200/60 bg-card shadow-xl">
	                                            {workBoqSearchOptions.length === 0 ? (
	                                                <div className="px-3 py-3 text-xs font-bold text-muted-foreground">Không tìm thấy đầu mục phù hợp.</div>
		                                            ) : (
		                                                workBoqSearchOptions.map(item => (
		                                                    <button
		                                                        key={item.id}
		                                                        type="button"
		                                                        onMouseDown={event => event.preventDefault()}
		                                                        onClick={() => handleToggleWorkBoqItem(item)}
		                                                        className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left text-xs font-bold text-foreground hover:bg-amber-50 dark:hover:bg-amber-950/30 last:border-b-0"
		                                                    >
		                                                        <input
		                                                            type="checkbox"
		                                                            readOnly
		                                                            checked={selectedWorkBoqItemIds.has(item.id)}
		                                                            className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-300"
		                                                        />
		                                                        <span className="block min-w-0 flex-1 truncate">{getWorkBoqLabel(item)}</span>
		                                                    </button>
		                                                ))
		                                            )}
	                                        </div>
	                                    )}
	                                </div>
	                                <input
	                                    type="date"
	                                    value={draftNeededDate}
	                                    onChange={event => setDraftNeededDate(event.target.value)}
	                                    className="md:col-span-3 px-3 py-2 rounded-xl border border-amber-200/40 dark:border-amber-800/40 bg-card text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300 text-foreground"
	                                />
	                                <button
	                                    onClick={handleAddBudgetLines}
	                                    disabled={selectedMaterialBudgetIds.size === 0}
	                                    className="md:col-span-2 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
	                                >
	                                    Thêm {selectedMaterialBudgetIds.size > 0 ? `(${selectedMaterialBudgetIds.size})` : ''}
	                                </button>
		                                <div className="md:col-span-12 rounded-xl border border-amber-200/40 bg-card dark:border-amber-800/40">
		                                    <div className="border-b border-amber-100/60 px-3 py-2 text-[10px] font-black uppercase text-muted-foreground">
		                                        {selectedWorkBoqLabel}
		                                    </div>
		                                    <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
		                                        {selectedWorkBoqItemIds.size === 0 ? (
		                                            <div className="px-3 py-4 text-xs font-bold text-muted-foreground">Gõ tên hoặc mã WBS rồi tick một hoặc nhiều đầu mục công việc.</div>
		                                        ) : budgetOptions.length === 0 ? (
		                                            <div className="px-3 py-4 text-xs font-bold text-muted-foreground">Các đầu mục đã chọn chưa khai báo vật tư có KL dự toán.</div>
		                                        ) : (
		                                            budgetOptions.map(item => {
		                                                const checked = selectedMaterialBudgetIds.has(item.id);
		                                                const reservation = getNewLineBudgetSnapshot(item.id, Number(draftBudgetQtyById[item.id] || 0), request?.id);
		                                                const inventoryItem = getBudgetInventoryItem(item);
		                                                const work = item.workBoqItemId ? workBoqMap.get(item.workBoqItemId) : undefined;
		                                                const overQty = Math.max(0, reservation.totalRequested - reservation.budgetQty);
		                                                return (
	                                                    <label key={item.id} className="grid grid-cols-1 gap-2 px-3 py-2 text-xs md:grid-cols-12 md:items-center">
	                                                        <div className="flex min-w-0 items-start gap-2 md:col-span-7">
	                                                            <input
	                                                                type="checkbox"
	                                                                checked={checked}
	                                                                onChange={() => handleToggleBudgetSelection(item)}
	                                                                className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-300"
	                                                            />
		                                                            <div className="min-w-0">
		                                                                <div className="truncate font-black text-foreground">{item.itemName}</div>
		                                                                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-bold text-muted-foreground">
		                                                                    {selectedWorkBoqItemIds.size > 1 && work && (
		                                                                        <>
		                                                                            <span className="max-w-[260px] truncate text-amber-700">{getWorkBoqLabel(work)}</span>
		                                                                            <span>•</span>
		                                                                        </>
		                                                                    )}
		                                                                    <span>{inventoryItem?.sku || item.materialCode || 'Chưa có mã kho'}</span>
	                                                                    <span>•</span>
	                                                                    <span>{item.unit}</span>
	                                                                    {canSeeAvailability && (
	                                                                        <>
	                                                                            <span>•</span>
	                                                                            <span>Dự toán {reservation.budgetQty.toLocaleString('vi-VN')}</span>
	                                                                            <span>•</span>
	                                                                            <span>Đã giữ/nhận {reservation.reservedBeforeQty.toLocaleString('vi-VN')}</span>
	                                                                            <span>•</span>
	                                                                            <span>Khả dụng {Math.max(0, reservation.availableQty).toLocaleString('vi-VN')}</span>
	                                                                        </>
	                                                                    )}
	                                                                </div>
	                                                            </div>
	                                                        </div>
	                                                        <input
	                                                            type="number"
	                                                            min={0}
	                                                            value={draftBudgetQtyById[item.id] || ''}
	                                                            onChange={event => {
	                                                                const value = event.target.value;
	                                                                setDraftBudgetQtyById(prev => ({ ...prev, [item.id]: value }));
	                                                                if (value && !selectedMaterialBudgetIds.has(item.id)) {
	                                                                    setSelectedMaterialBudgetIds(prev => new Set(prev).add(item.id));
	                                                                }
	                                                            }}
	                                                            placeholder="Số lượng"
	                                                            className="md:col-span-2 px-3 py-2 rounded-xl border border-amber-200/40 dark:border-amber-800/40 bg-card text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300 text-foreground"
	                                                        />
	                                                        <div className="md:col-span-3 flex flex-wrap justify-start gap-1 md:justify-end">
	                                                            {!inventoryItem && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600 border border-red-200/60">Chưa có mã kho</span>}
	                                                            {canSeeAvailability && reservation.pendingSources.length > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 border border-amber-200/60">{reservation.pendingSources.length} phiếu giữ chỗ</span>}
	                                                            {overQty > 0 && <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-650 border border-orange-200/60">{canSeeAvailability ? `Vượt ${overQty.toLocaleString('vi-VN')}` : 'Vượt định mức'}</span>}
	                                                        </div>
	                                                    </label>
	                                                );
	                                            })
	                                        )}
	                                    </div>
	                                </div>
	                                <input
	                                    value={draftLineNote}
	                                    onChange={event => setDraftLineNote(event.target.value)}
                                    placeholder="Ghi chú dòng..."
                                    className="md:col-span-12 px-3 py-2 rounded-xl border border-amber-200/40 dark:border-amber-800/40 bg-card text-xs outline-none focus:ring-2 focus:ring-amber-300 text-foreground"
                                />
                            </div>
                            )}
                        </div>
                    )}

                    {/* Desktop table view */}
                    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden hidden md:block">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted text-muted-foreground font-bold border-b border-border">
                                <tr>
                                    <th className="p-4">Vật tư đề xuất</th>
                                    <th className="p-4 w-24 text-center">ĐVT</th>
                                    <th className="p-4 w-32 text-right">Số lượng Y/C</th>
                                    {!isEditable && (
                                        <>
                                            {canSeeAvailability && <th className="p-4 w-32 text-right text-blue-600 bg-blue-50/30">{stockContextWarehouseId ? 'Tồn kho' : 'Tổng tồn'}</th>}
                                            <th className="p-4 w-32 text-right text-emerald-600 bg-emerald-50/30">Cam kết</th>
                                            <th className="p-4 w-28 text-right text-indigo-600 bg-indigo-50/30">Đã xuất</th>
                                            <th className="p-4 w-28 text-right text-cyan-600 bg-cyan-50/30">Đã nhận</th>
                                            <th className="p-4 w-28 text-right text-slate-500">Còn lại</th>
                                        </>
                                    )}
                                    {isEditable && <th className="p-4 w-12"></th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {materialDisplayGroups.map(group => {
                                    const primary = group.sources[0];
                                    const primaryRow = primary.row;
                                    const hasMultipleSources = group.sources.length > 1;
                                    const isExpanded = expandedMaterialGroupKeys.has(group.key);
                                    const stockSummary = canSeeAvailability ? getAggregateStockSummary(group.itemId, stockContextWarehouseId, request?.id) : null;
                                    const sourceStock = stockSummary?.available || 0;
                                    const itemInfo = getLineInventory(group.itemId);
                                    const canEditGroupQty = isEditable && !hasMultipleSources;
                                    const canEditGroupApproval = !isEditable && canEditApprovalQuantities && !hasMultipleSources;
                                    const groupColSpan = isEditable ? 4 : canSeeAvailability ? 8 : 7;

                                    return (
                                        <React.Fragment key={group.key}>
                                            <tr className={`transition-colors ${group.isExcess ? 'bg-orange-50/50' : 'hover:bg-slate-50/50'}`}>
                                                <td className="p-4">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            {hasMultipleSources && (
                                                                <button
                                                                    onClick={() => toggleMaterialGroup(group.key)}
                                                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted"
                                                                    title={isExpanded ? 'Thu gọn chi tiết nguồn' : 'Xem chi tiết nguồn'}
                                                                >
                                                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                </button>
                                                            )}
                                                            <div className="min-w-0">
                                                                <div className="font-bold text-foreground">{group.name}</div>
                                                                <div className="text-[10px] font-mono text-muted-foreground">{group.sku || '—'}</div>
                                                            </div>
                                                            {hasMultipleSources && (
                                                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 border border-amber-200/60">
                                                                    {group.sources.length} hạng mục
                                                                </span>
                                                            )}
                                                        </div>
                                                        {group.specification && <div className="text-[10px] text-muted-foreground mt-0.5">{group.specification}</div>}
                                                        {!hasMultipleSources && isProjectRequest && (
                                                            <div className="mt-1 space-y-1">
                                                                {(() => {
                                                                    const budgetSnapshot = editableBudgetSnapshots?.get((primaryRow as RequestLineDraft).lineId) || buildLineBudgetSnapshot(primaryRow as RequestLineDraft, request?.id);
                                                                    const needsReason = isEditable && (!primaryRow.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0);
                                                                    return (
                                                                        <>
                                                                            <div className="flex flex-wrap gap-1">
                                                                                {(primaryRow.workBoqItemName || primaryRow.materialBudgetItemName) && (
                                                                                    <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/40 dark:border-amber-800/40 text-[9px] font-bold">
                                                                                        {primaryRow.workBoqItemName || 'BOQ'}{primaryRow.materialBudgetItemName ? ` • ${primaryRow.materialBudgetItemName}` : ''}
                                                                                    </span>
                                                                                )}
                                                                                {!primaryRow.materialBudgetItemId && <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-650 dark:text-red-400 border border-red-200/40 dark:border-red-900/40 text-[9px] font-bold">Ngoài BOQ</span>}
                                                                                {canSeeAvailability && isEditable && primaryRow.materialBudgetItemId && (
                                                                                    <span className="px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200/40 dark:border-cyan-800/40 text-[9px] font-bold">
                                                                                        Khả dụng trước dòng {Math.max(0, budgetSnapshot.availableQty).toLocaleString('vi-VN')} {budgetSnapshot.budget?.unit || ''}
                                                                                    </span>
                                                                                )}
                                                                                {canSeeAvailability && isEditable && budgetSnapshot.pendingSources.length > 0 && (
                                                                                    <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/40 dark:border-amber-800/40 text-[9px] font-bold">
                                                                                        {budgetSnapshot.pendingSources.length} phiếu đang giữ chỗ
                                                                                    </span>
                                                                                )}
                                                                                {budgetSnapshot.overBudgetQty > 0 && (
                                                                                    <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/40 text-orange-650 dark:text-orange-400 border border-orange-200/40 dark:border-orange-900/40 text-[9px] font-bold">
                                                                                        {canSeeAvailability ? `Vượt ${budgetSnapshot.overBudgetQty.toLocaleString('vi-VN')} ${budgetSnapshot.budget?.unit || ''}` : 'Vượt định mức'}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            {canSeeAvailability && isEditable && primaryRow.materialBudgetItemId && (
                                                                                <BoqSummaryStrip
                                                                                    budgetQty={budgetSnapshot.budgetQty}
                                                                                    reservedQty={budgetSnapshot.reservedBeforeQty}
                                                                                    currentQty={Number((primaryRow as RequestLineDraft).qty || 0)}
                                                                                    availableQty={budgetSnapshot.availableQty}
                                                                                    overBudgetQty={budgetSnapshot.overBudgetQty}
                                                                                    unit={budgetSnapshot.budget?.unit}
                                                                                    pendingCount={budgetSnapshot.pendingSources.length}
                                                                                    compact
                                                                                />
                                                                            )}
                                                                            {needsReason && (
                                                                                <input
                                                                                    value={(primaryRow as RequestLineDraft).overBudgetReason || ''}
                                                                                    onChange={event => handleUpdateItem(primary.index, 'overBudgetReason', event.target.value)}
                                                                                    placeholder={!primaryRow.materialBudgetItemId ? 'Lý do ngoài BOQ/ngoài định mức...' : 'Lý do đề xuất vượt định mức...'}
                                                                                    className="w-full px-2 py-1 rounded-lg border border-orange-200 dark:border-orange-800/40 bg-card text-foreground text-[10px] outline-none focus:ring-1 focus:ring-orange-300"
                                                                                />
                                                                            )}
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center text-muted-foreground font-medium">{group.unit || '-'}</td>
                                                <td className="p-4 text-right">
                                                    {canEditGroupQty ? (
                                                        <input
                                                            type="number" min="1"
                                                            value={primary.requestQty}
                                                            onChange={(e) => handleUpdateItem(primary.index, 'qty', e.target.value)}
                                                            className="w-20 text-right p-1 border border-border bg-card text-foreground rounded font-bold"
                                                        />
                                                    ) : (
                                                        <span className="font-bold text-foreground">{group.requestQty.toLocaleString('vi-VN')}</span>
                                                    )}
                                                </td>
                                                {!isEditable && (
                                                    <>
                                                        {canSeeAvailability && (
                                                            <td className="p-4 text-right font-bold text-blue-600">
                                                                {sourceStock.toLocaleString('vi-VN')}
                                                                {(stockSummary?.reserved || 0) > 0 && (
                                                                    <div className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">Giữ chỗ: {stockSummary?.reserved}</div>
                                                                )}
                                                            </td>
                                                        )}
                                                        <td className="p-4 text-right">
                                                            {canEditGroupApproval ? (
                                                                <div className="flex flex-col items-end">
                                                                    <input
                                                                        type="number" min="0" max={!isProjectRequest && itemInfo ? sourceStock : undefined}
                                                                        value={primary.approvedQty}
                                                                        onChange={(e) => handleUpdateApprovedItem(primaryRow as RequestItem, Number(e.target.value))}
                                                                        className={`w-20 text-right p-1 border rounded font-bold bg-card text-foreground focus:ring-2 outline-none transition-colors ${group.isExcess ? 'border-orange-400 text-orange-700 dark:text-orange-400 focus:ring-orange-500' : 'border-emerald-250 text-emerald-705 focus:ring-emerald-500'}`}
                                                                    />
                                                                    {group.isExcess && <span className="text-[9px] text-orange-600 dark:text-orange-400 font-bold mt-1 uppercase">Duyệt vượt mức</span>}
                                                                </div>
                                                            ) : (
                                                                <span className={`font-bold ${group.isExcess ? 'text-orange-600 dark:text-orange-400 underline' : 'text-emerald-750 dark:text-emerald-400'}`}>
                                                                    {group.approvedQty.toLocaleString('vi-VN')}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-4 text-right font-bold text-indigo-600">{group.issuedQty.toLocaleString('vi-VN')}</td>
                                                        <td className="p-4 text-right font-bold text-cyan-600">{group.receivedQty.toLocaleString('vi-VN')}</td>
                                                        <td className="p-4 text-right font-bold text-muted-foreground">{group.remainingToReceive.toLocaleString('vi-VN')}</td>
                                                    </>
                                                )}
                                                {isEditable && (
                                                    <td className="p-4 text-center">
                                                        <button onClick={() => setReqItems(reqItems.filter((_, i) => hasMultipleSources ? !group.sources.some(source => source.index === i) : i !== primary.index))} className="text-red-400 hover:text-red-600">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                            {hasMultipleSources && isExpanded && (
                                                <tr className="bg-muted/30">
                                                    <td colSpan={groupColSpan} className="px-4 pb-4">
                                                        <div className="mt-2 space-y-2 rounded-lg border border-border bg-card p-3">
                                                            {group.sources.map(source => {
                                                                const sourceRow = source.row;
                                                                const budgetSnapshot = editableBudgetSnapshots?.get((sourceRow as RequestLineDraft).lineId) || buildLineBudgetSnapshot(sourceRow as RequestLineDraft, request?.id);
                                                                const needsReason = isEditable && isProjectRequest && (!sourceRow.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0);
                                                                return (
                                                                    <div key={`${group.key}-${source.index}`} className="grid grid-cols-12 gap-2 rounded-lg border border-border/70 p-2 text-xs">
                                                                        <div className="col-span-12 md:col-span-6">
                                                                            <div className="font-bold text-foreground">{sourceRow.workBoqItemName || 'Ngoài BOQ'}</div>
                                                                            <div className="text-[10px] text-muted-foreground">{sourceRow.materialBudgetItemName || sourceRow.itemNameSnapshot || group.name}</div>
                                                                            {sourceRow.note && <div className="mt-1 text-[10px] text-muted-foreground">{sourceRow.note}</div>}
                                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                                {!sourceRow.materialBudgetItemId && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-650 border border-red-200/50">Ngoài BOQ</span>}
                                                                                {canSeeAvailability && isEditable && sourceRow.materialBudgetItemId && (
                                                                                    <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[9px] font-bold text-cyan-700 border border-cyan-200/50">
                                                                                        Khả dụng trước dòng {Math.max(0, budgetSnapshot.availableQty).toLocaleString('vi-VN')} {budgetSnapshot.budget?.unit || ''}
                                                                                    </span>
                                                                                )}
                                                                                {budgetSnapshot.overBudgetQty > 0 && (
                                                                                    <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-650 border border-orange-200/50">
                                                                                        {canSeeAvailability ? `Vượt ${budgetSnapshot.overBudgetQty.toLocaleString('vi-VN')} ${budgetSnapshot.budget?.unit || ''}` : 'Vượt định mức'}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="col-span-6 md:col-span-2 text-right">
                                                                            <div className="text-[9px] uppercase font-bold text-muted-foreground">Số lượng</div>
                                                                            {isEditable ? (
                                                                                <input
                                                                                    type="number" min="1"
                                                                                    value={source.requestQty}
                                                                                    onChange={(e) => handleUpdateItem(source.index, 'qty', e.target.value)}
                                                                                    className="mt-1 w-20 text-right p-1 border border-border bg-card text-foreground rounded font-bold"
                                                                                />
                                                                            ) : (
                                                                                <div className="font-black">{source.requestQty.toLocaleString('vi-VN')}</div>
                                                                            )}
                                                                        </div>
                                                                        {!isEditable && (
                                                                            <>
                                                                                <div className="col-span-6 md:col-span-1 text-right">
                                                                                    <div className="text-[9px] uppercase font-bold text-emerald-500">Cam kết</div>
                                                                                    <div className="font-black">{source.approvedQty.toLocaleString('vi-VN')}</div>
                                                                                </div>
                                                                                <div className="col-span-6 md:col-span-1 text-right">
                                                                                    <div className="text-[9px] uppercase font-bold text-indigo-500">Đã xuất</div>
                                                                                    <div className="font-black">{source.issuedQty.toLocaleString('vi-VN')}</div>
                                                                                </div>
                                                                                <div className="col-span-6 md:col-span-1 text-right">
                                                                                    <div className="text-[9px] uppercase font-bold text-cyan-500">Đã nhận</div>
                                                                                    <div className="font-black">{source.receivedQty.toLocaleString('vi-VN')}</div>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                        {isEditable && (
                                                                            <div className="col-span-6 md:col-span-4 flex items-start justify-end gap-2">
                                                                                <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== source.index))} className="mt-4 text-red-400 hover:text-red-600">
                                                                                    <Trash2 size={16} />
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                        {needsReason && (
                                                                            <div className="col-span-12">
                                                                                <input
                                                                                    value={(sourceRow as RequestLineDraft).overBudgetReason || ''}
                                                                                    onChange={event => handleUpdateItem(source.index, 'overBudgetReason', event.target.value)}
                                                                                    placeholder={!sourceRow.materialBudgetItemId ? 'Lý do ngoài BOQ/ngoài định mức...' : 'Lý do đề xuất vượt định mức...'}
                                                                                    className="w-full px-2 py-1 rounded-lg border border-orange-200 dark:border-orange-800/40 bg-card text-foreground text-[10px] outline-none focus:ring-1 focus:ring-orange-300"
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        {isEditable && (
                            <button onClick={handleAddItem} className="w-full py-4 text-accent font-bold hover:bg-muted transition-colors border-t border-dashed border-border flex items-center justify-center">
                                <Plus size={16} className="mr-2" /> {isProjectRequest ? 'Thêm vật tư ngoài BOQ' : 'Thêm vật tư vào đề xuất'}
                            </button>
                        )}
                    </div>

                    {/* Mobile card view */}
                    <div className="md:hidden space-y-2">
                        {materialDisplayGroups.map(group => {
                            const primary = group.sources[0];
                            const primaryRow = primary.row;
                            const hasMultipleSources = group.sources.length > 1;
                            const isExpanded = expandedMaterialGroupKeys.has(group.key);
                            const stockSummary = canSeeAvailability ? getAggregateStockSummary(group.itemId, stockContextWarehouseId, request?.id) : null;
                            const sourceStock = stockSummary?.available || 0;
                            const itemInfo = getLineInventory(group.itemId);
                            const canEditGroupQty = isEditable && !hasMultipleSources;
                            const canEditGroupApproval = !isEditable && canEditApprovalQuantities && !hasMultipleSources;
                            const budgetSnapshot = editableBudgetSnapshots?.get((primaryRow as RequestLineDraft).lineId) || buildLineBudgetSnapshot(primaryRow as RequestLineDraft, request?.id);
                            const needsReason = isEditable && isProjectRequest && !hasMultipleSources && (!primaryRow.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0);

                            return (
                                <div key={group.key} className={`bg-card rounded-xl p-3 border ${group.isExcess ? 'border-orange-200 bg-orange-50/10 dark:bg-orange-955/20' : 'border-border'} shadow-sm`}>
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                {hasMultipleSources && (
                                                    <button
                                                        onClick={() => toggleMaterialGroup(group.key)}
                                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground"
                                                        title={isExpanded ? 'Thu gọn chi tiết nguồn' : 'Xem chi tiết nguồn'}
                                                    >
                                                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                    </button>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm text-foreground truncate">{group.name}</div>
                                                    <div className="text-[10px] font-mono text-muted-foreground">{group.sku || '—'} • {group.unit || '-'}</div>
                                                </div>
                                                {hasMultipleSources && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 border border-amber-200/60">{group.sources.length} hạng mục</span>}
                                            </div>
                                            {group.specification && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{group.specification}</div>}
                                            {!hasMultipleSources && isProjectRequest && (primaryRow.workBoqItemName || primaryRow.materialBudgetItemName || !primaryRow.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0) && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {(primaryRow.workBoqItemName || primaryRow.materialBudgetItemName) && <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/40 dark:border-amber-800/40 text-[9px] font-bold">{primaryRow.workBoqItemName || 'BOQ'}{primaryRow.materialBudgetItemName ? ` • ${primaryRow.materialBudgetItemName}` : ''}</span>}
                                                    {!primaryRow.materialBudgetItemId && <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-650 dark:text-red-400 border border-red-200/40 dark:border-red-900/40 text-[9px] font-bold">Ngoài BOQ</span>}
                                                    {canSeeAvailability && isEditable && primaryRow.materialBudgetItemId && (
                                                        <span className="px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200/40 dark:border-cyan-800/40 text-[9px] font-bold">
                                                            Khả dụng trước dòng {Math.max(0, budgetSnapshot.availableQty).toLocaleString('vi-VN')} {budgetSnapshot.budget?.unit || ''}
                                                        </span>
                                                    )}
                                                    {budgetSnapshot.overBudgetQty > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/40 text-orange-650 dark:text-orange-400 border border-orange-200/40 dark:border-orange-900/40 text-[9px] font-bold">{canSeeAvailability ? `Vượt ${budgetSnapshot.overBudgetQty.toLocaleString('vi-VN')} ${budgetSnapshot.budget?.unit || ''}` : 'Vượt định mức'}</span>}
                                                </div>
                                            )}
                                            {canSeeAvailability && isProjectRequest && isEditable && !hasMultipleSources && primaryRow.materialBudgetItemId && (
                                                <div className="mt-2">
                                                    <BoqSummaryStrip
                                                        budgetQty={budgetSnapshot.budgetQty}
                                                        reservedQty={budgetSnapshot.reservedBeforeQty}
                                                        currentQty={Number((primaryRow as RequestLineDraft).qty || 0)}
                                                        availableQty={budgetSnapshot.availableQty}
                                                        overBudgetQty={budgetSnapshot.overBudgetQty}
                                                        unit={budgetSnapshot.budget?.unit}
                                                        pendingCount={budgetSnapshot.pendingSources.length}
                                                        compact
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        {isEditable && (
                                            <button onClick={() => setReqItems(reqItems.filter((_, i) => hasMultipleSources ? !group.sources.some(source => source.index === i) : i !== primary.index))} className="p-1.5 text-red-400 hover:text-red-600 shrink-0">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {needsReason && (
                                        <input
                                            value={(primaryRow as RequestLineDraft).overBudgetReason || ''}
                                            onChange={event => handleUpdateItem(primary.index, 'overBudgetReason', event.target.value)}
                                            placeholder={!primaryRow.materialBudgetItemId ? 'Lý do ngoài BOQ/ngoài định mức...' : 'Lý do đề xuất vượt định mức...'}
                                            className="mt-2 w-full px-2 py-1.5 rounded-lg border border-orange-200 dark:border-orange-800/40 bg-card text-foreground text-xs outline-none focus:ring-1 focus:ring-orange-300"
                                        />
                                    )}
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                            <div className="text-[9px] uppercase font-bold text-muted-foreground mb-0.5">SL yêu cầu</div>
                                            {canEditGroupQty ? (
                                                <input
                                                    type="number" min="1"
                                                    value={primary.requestQty}
                                                    onChange={(e) => handleUpdateItem(primary.index, 'qty', e.target.value)}
                                                    className="w-full text-center p-2 border border-border bg-card text-foreground rounded-lg font-bold text-sm"
                                                />
                                            ) : (
                                                <div className="font-bold text-foreground text-sm">{group.requestQty.toLocaleString('vi-VN')}</div>
                                            )}
                                        </div>
                                        {!isEditable && canSeeAvailability && (
                                            <div className="flex-1">
                                                <div className="text-[9px] uppercase font-bold text-blue-500 mb-0.5">{stockContextWarehouseId ? 'Tồn kho' : 'Tổng tồn'}</div>
                                                <div className="font-bold text-blue-600 dark:text-blue-400 text-sm">{sourceStock.toLocaleString('vi-VN')}</div>
                                                {(stockSummary?.reserved || 0) > 0 && <div className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">Giữ chỗ: {stockSummary?.reserved}</div>}
                                            </div>
                                        )}
                                        {!isEditable && (
                                            <div className="flex-1">
                                                <div className="text-[9px] uppercase font-bold text-emerald-500 mb-0.5">Duyệt</div>
                                                {canEditGroupApproval ? (
                                                    <input
                                                        type="number" min="0" max={!isProjectRequest && itemInfo ? sourceStock : undefined}
                                                        value={primary.approvedQty}
                                                        onChange={(e) => handleUpdateApprovedItem(primaryRow as RequestItem, Number(e.target.value))}
                                                        className={`w-full text-center p-2 border rounded-lg font-bold bg-card text-foreground text-sm ${group.isExcess ? 'border-orange-400 text-orange-700 dark:text-orange-450' : 'border-emerald-250 text-emerald-705'}`}
                                                    />
                                                ) : (
                                                    <div className={`font-bold text-sm ${group.isExcess ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-750 dark:text-emerald-400'}`}>
                                                        {group.approvedQty.toLocaleString('vi-VN')}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {!isEditable && (
                                        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted border border-border p-2">
                                            <div>
                                                <div className="text-[9px] uppercase font-bold text-indigo-505 dark:text-indigo-400">Đã xuất</div>
                                                <div className="text-xs font-black text-indigo-650 dark:text-indigo-400">{group.issuedQty.toLocaleString('vi-VN')}</div>
                                            </div>
                                            <div>
                                                <div className="text-[9px] uppercase font-bold text-cyan-505 dark:text-cyan-400">Đã nhận</div>
                                                <div className="text-xs font-black text-cyan-600 dark:text-cyan-400">{group.receivedQty.toLocaleString('vi-VN')}</div>
                                            </div>
                                            <div>
                                                <div className="text-[9px] uppercase font-bold text-muted-foreground">Còn lại</div>
                                                <div className="text-xs font-black text-foreground">{group.remainingToReceive.toLocaleString('vi-VN')}</div>
                                            </div>
                                        </div>
                                    )}
                                    {hasMultipleSources && isExpanded && (
                                        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-2">
                                            {group.sources.map(source => {
                                                const sourceRow = source.row;
                                                const sourceBudgetSnapshot = editableBudgetSnapshots?.get((sourceRow as RequestLineDraft).lineId) || buildLineBudgetSnapshot(sourceRow as RequestLineDraft, request?.id);
                                                const sourceNeedsReason = isEditable && isProjectRequest && (!sourceRow.materialBudgetItemId || sourceBudgetSnapshot.overBudgetQty > 0);
                                                return (
                                                    <div key={`${group.key}-${source.index}`} className="rounded-lg border border-border bg-card p-2">
                                                        <div className="text-xs font-bold text-foreground">{sourceRow.workBoqItemName || 'Ngoài BOQ'}</div>
                                                        <div className="text-[10px] text-muted-foreground">{sourceRow.materialBudgetItemName || sourceRow.itemNameSnapshot || group.name}</div>
                                                        <div className="mt-2 flex items-center gap-2">
                                                            <div className="flex-1">
                                                                <div className="text-[9px] uppercase font-bold text-muted-foreground">Số lượng</div>
                                                                {isEditable ? (
                                                                    <input
                                                                        type="number" min="1"
                                                                        value={source.requestQty}
                                                                        onChange={(e) => handleUpdateItem(source.index, 'qty', e.target.value)}
                                                                        className="mt-1 w-full text-center p-1.5 border border-border bg-card text-foreground rounded-lg font-bold text-sm"
                                                                    />
                                                                ) : (
                                                                    <div className="font-black">{source.requestQty.toLocaleString('vi-VN')}</div>
                                                                )}
                                                            </div>
                                                            {!isEditable && (
                                                                <>
                                                                    <div className="flex-1 text-right">
                                                                        <div className="text-[9px] uppercase font-bold text-indigo-500">Đã xuất</div>
                                                                        <div className="font-black">{source.issuedQty.toLocaleString('vi-VN')}</div>
                                                                    </div>
                                                                    <div className="flex-1 text-right">
                                                                        <div className="text-[9px] uppercase font-bold text-cyan-500">Đã nhận</div>
                                                                        <div className="font-black">{source.receivedQty.toLocaleString('vi-VN')}</div>
                                                                    </div>
                                                                </>
                                                            )}
                                                            {isEditable && (
                                                                <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== source.index))} className="mt-4 p-1.5 text-red-400 hover:text-red-600">
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        {sourceNeedsReason && (
                                                            <input
                                                                value={(sourceRow as RequestLineDraft).overBudgetReason || ''}
                                                                onChange={event => handleUpdateItem(source.index, 'overBudgetReason', event.target.value)}
                                                                placeholder={!sourceRow.materialBudgetItemId ? 'Lý do ngoài BOQ/ngoài định mức...' : 'Lý do đề xuất vượt định mức...'}
                                                                className="mt-2 w-full px-2 py-1.5 rounded-lg border border-orange-200 dark:border-orange-800/40 bg-card text-foreground text-xs outline-none focus:ring-1 focus:ring-orange-300"
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {isEditable && (
                            <button onClick={handleAddItem} className="w-full py-3 text-accent font-bold rounded-xl border-2 border-dashed border-border flex items-center justify-center active:scale-95 transition-all hover:bg-muted">
                                <Plus size={16} className="mr-2" /> {isProjectRequest ? 'Thêm vật tư ngoài BOQ' : 'Thêm vật tư'}
                            </button>
                        )}
                    </div>

                    {!isEditable && request && isBatchFulfillmentRequest && (
                        <div className="mt-5 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-xs font-black text-foreground">Lịch sử cấp hàng</div>
                                    <div className="text-[10px] font-bold text-muted-foreground">
                                        {fulfillmentSummary
                                            ? `Đã nhận ${fulfillmentSummary.receivedQty.toLocaleString('vi-VN')} / ${fulfillmentSummary.committedQty.toLocaleString('vi-VN')}`
                                            : 'Đang tải lũy kế cấp hàng'}
                                    </div>
                                </div>
                                {isLoadingFulfillment && <Loader2 size={14} className="text-muted-foreground animate-spin" />}
                            </div>
                            {fulfillmentBatches.length === 0 ? (
                                <div className="p-4 text-xs font-bold text-muted-foreground">Chưa có đợt cấp hàng nào cho phiếu này.</div>
                            ) : (
                                <div className="divide-y divide-border">
                                    {fulfillmentBatches.map(batch => {
                                        const batchUi = getFulfillmentBatchUiStatus(batch);
                                        return (
                                        <div
                                            key={batch.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedFulfillmentBatch(batch)}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    setSelectedFulfillmentBatch(batch);
                                                }
                                            }}
                                            className="block w-full p-4 text-left hover:bg-muted transition-colors cursor-pointer"
                                        >
                                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-mono text-xs font-black text-indigo-600 dark:text-indigo-400">{batch.batchNo}</span>
                                                        <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black ${batchUi.color}`}>
                                                            {batchUi.label}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-muted-foreground">{new Date(batch.batchDate).toLocaleString('vi-VN')}</span>
                                                    </div>
                                                    <div className="mt-1 text-[10px] text-muted-foreground">
                                                        Nguồn: {getFulfillmentSourceLabel(batch)} • Đích: {batch.targetWarehouseId ? getWarehouseName(batch.targetWarehouseId) : 'Cấp thẳng sử dụng'}
                                                    </div>
                                                    {batch.note && <div className="mt-1 text-xs text-muted-foreground">{batch.note}</div>}
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Mở chi tiết</span>
                                            </div>
                                            <div className="mt-3 overflow-x-auto">
                                                <table className="w-full text-[11px]">
                                                    <thead className="text-[9px] uppercase text-muted-foreground">
                                                        <tr>
                                                            <th className="py-1 text-left">Vật tư</th>
                                                            <th className="py-1 text-right">Đã xuất</th>
                                                            <th className="py-1 text-right">Thực nhận</th>
                                                            <th className="py-1 text-left pl-3">Lý do lệch</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {batch.lines.map(line => {
                                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                                            return (
                                                                <tr key={line.id} className="border-t border-border">
                                                                    <td className="py-1.5 font-bold text-foreground">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                                    <td className="py-1.5 text-right font-bold text-indigo-650 dark:text-indigo-400">{Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                                                                    <td className="py-1.5 text-right font-bold text-cyan-650 dark:text-cyan-400">{Number(line.receivedQty || 0).toLocaleString('vi-VN')}</td>
                                                                    <td className="py-1.5 pl-3 text-muted-foreground">{line.varianceReason || '-'}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-4 border-t border-border bg-muted/50 flex justify-between items-center relative">
                    <div className="hidden sm:block text-muted-foreground text-[10px] uppercase font-black tracking-widest">
                        Security: {request?.id.slice(-6) || 'NEW-REQ'}
                    </div>

                    <div className="flex gap-2 sm:gap-3 items-center w-full sm:w-auto justify-end overflow-x-auto whitespace-nowrap scrollbar-none py-1">
                        {request && (
                            <button onClick={handlePrintMaterialRequest} className="px-3 py-1.5 sm:px-5 sm:py-2 rounded-lg border border-blue-200/60 text-blue-700 bg-blue-50 text-xs sm:text-sm font-bold hover:bg-blue-100 transition-colors whitespace-nowrap flex items-center">
                                <Printer size={14} className="mr-1.5 sm:mr-2" /> In đề xuất
                            </button>
                        )}
                        <button onClick={onClose} className="px-3 py-1.5 sm:px-5 sm:py-2 rounded-lg border border-border text-foreground text-xs sm:text-sm font-bold hover:bg-muted transition-colors whitespace-nowrap">
                            Đóng
                        </button>

                        {canDeleteRequest && (
                            <button disabled={isSaving} onClick={handleDeleteRequest} className="px-3 py-1.5 sm:px-5 sm:py-2 rounded-lg border border-red-200/40 dark:border-red-905/40 text-red-750 dark:text-red-400 bg-red-50/10 dark:bg-red-955/20 text-xs sm:text-sm font-bold hover:bg-red-100/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <Trash2 size={14} className="mr-1.5 sm:mr-2" />} Xoá phiếu
                            </button>
                        )}

                        {canReturn && !isEditable && (
                            <button disabled={isSaving} onClick={handleReturnRequest} className="px-3 py-1.5 sm:px-5 sm:py-2 rounded-lg border border-amber-200/40 dark:border-amber-905/40 text-amber-700 dark:text-amber-400 bg-amber-50/10 dark:bg-amber-955/20 text-xs sm:text-sm font-bold hover:bg-amber-100/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <AlertCircle size={14} className="mr-1.5 sm:mr-2" />} Trả lại
                            </button>
                        )}

                        {isEditable && (
                            <button disabled={isSaving} onClick={handleSubmitCreate} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-slate-700 text-white text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-slate-500/20 whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <Save size={14} className="mr-1.5 sm:mr-2" />} {isSaving ? 'Đang lưu...' : request ? 'Lưu nháp' : 'Tạo đề xuất'}
                            </button>
                        )}

                        {canSubmitDraft && (
                            <button disabled={isSaving} onClick={handleOpenSubmitDraft} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-accent text-white text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20 whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <Send size={14} className="mr-1.5 sm:mr-2" />} Gửi duyệt
                            </button>
                        )}

                        {isApproving && (
                            <button
                                disabled={isSaving}
                                onClick={() => setShowApprovalPanel(true)}
                                className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-accent text-white text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20 transition-all whitespace-nowrap"
                            >
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <AlertCircle size={14} className="mr-1.5 sm:mr-2" />}
                                {isSaving ? 'ĐANG XỬ LÝ...' : 'XỬ LÝ ĐỀ XUẤT'}
                            </button>
                        )}

                        {canPrepareIssue && (
                            <button disabled={isSaving || !sourceWarehouseId} onClick={() => handleAction(RequestStatus.APPROVED)} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-blue-600 text-white text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20 whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <Save size={14} className="mr-1.5 sm:mr-2" />} {isSaving ? 'Đang lưu...' : 'Lưu phân nguồn'}
                            </button>
                        )}

                        {canCreateFulfillmentBatch && (
                            <button disabled={isSaving || !(sourceWarehouseId || request?.sourceWarehouseId)} onClick={openIssuePanel} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-indigo-600 text-white text-xs sm:text-sm font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-indigo-500/20 whitespace-nowrap">
                                <Truck size={14} className="mr-1.5 sm:mr-2" /> Tạo đợt cấp
                            </button>
                        )}

                        {canCreateFulfillmentBatch && (
                            <button disabled={isSaving || !(sourceWarehouseId || request?.sourceWarehouseId)} onClick={() => setIsExternalIssuePanelOpen(true)} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-slate-900 text-white text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-slate-500/20 whitespace-nowrap">
                                <PackageCheck size={14} className="mr-1.5 sm:mr-2" /> Xuất cấp thi công
                            </button>
                        )}

                        {canExport && (
                            <button disabled={isSaving} onClick={() => handleAction(RequestStatus.IN_TRANSIT)} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-indigo-600 text-white text-xs sm:text-sm font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-indigo-500/20 whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <Truck size={14} className="mr-1.5 sm:mr-2" />} {isSaving ? 'Đang xử lý...' : 'Xác nhận xuất kho'}
                            </button>
                        )}

                        {canReceive && (
                            <button disabled={isSaving} onClick={() => handleAction(RequestStatus.COMPLETED)} className="px-3 py-1.5 sm:px-6 sm:py-2 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-bold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-emerald-500/20 whitespace-nowrap">
                                {isSaving ? <Loader2 size={14} className="mr-1.5 sm:mr-2 animate-spin" /> : <CheckCircle size={14} className="mr-1.5 sm:mr-2" />} {isSaving ? 'Đang xử lý...' : fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Xác nhận sử dụng' : 'Xác nhận nhận hàng'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {isIssuePanelOpen && request && (
                <div className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-card border border-border shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                            <div>
                                <h4 className="text-base font-black text-foreground">Tạo đợt cấp vật tư</h4>
                                <p className="text-xs font-bold text-muted-foreground">{request.code} • Kho nguồn: {getWarehouseName(sourceWarehouseId || request.sourceWarehouseId)}</p>
                            </div>
                            <button onClick={() => setIsIssuePanelOpen(false)} className="p-2 text-muted-foreground hover:text-foreground"><X size={20} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] uppercase font-black text-muted-foreground block mb-1">Nguồn hàng</label>
                                    <select
                                        value={issueSourceType}
                                        onChange={event => handleIssueSourceTypeChange(event.target.value as MaterialRequestFulfillmentSourceType)}
                                        className="w-full px-3 py-2 rounded-xl border border-border bg-card text-foreground text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"
                                    >
                                        <option value="stock">Tồn kho</option>
                                        <option value="po_receipt">Hàng đã nhập từ PO</option>
                                        <option value="mixed">Kết hợp</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-[10px] uppercase font-black text-muted-foreground block mb-1">Ghi chú đợt cấp</label>
                                    <input
                                        value={issueNote}
                                        onChange={event => setIssueNote(event.target.value)}
                                        placeholder="VD: cấp đợt 1 theo tiến độ thi công..."
                                        className="w-full px-3 py-2 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-indigo-300"
                                    />
                                </div>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-border">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                                        <tr>
                                            <th className="p-3 text-left">Vật tư</th>
                                            <th className="p-3 text-right">Còn phải cấp</th>
                                            <th className="p-3 text-right">Tồn kho</th>
                                            <th className="p-3 text-right">Cấp đợt này</th>
                                            <th className="p-3 text-left">Lý do</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {issueLines.map(line => {
                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                            const lineSummary = fulfillmentLineSummaryMap.get(line.requestLineId);
                                            const remaining = lineSummary?.remainingToIssue ?? (requestLine ? getCommittedQty(requestLine) : 0);
                                            const onHand = getOnHandStock(line.itemId, sourceWarehouseId || request.sourceWarehouseId || '');
                                            return (
                                                <tr key={line.requestLineId}>
                                                    <td className="p-3 font-bold text-foreground">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                    <td className="p-3 text-right font-bold text-muted-foreground">{remaining.toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right font-bold text-blue-600">{onHand.toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={line.qty}
                                                            onChange={event => updateIssueLine(line.requestLineId, { qty: event.target.value })}
                                                            className="w-24 rounded-lg border border-indigo-200 dark:border-indigo-800/40 bg-card px-2 py-1 text-right font-black text-indigo-700 dark:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-300"
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <input
                                                            value={line.reason}
                                                            onChange={event => updateIssueLine(line.requestLineId, { reason: event.target.value })}
                                                            placeholder="Lý do nếu cần"
                                                            className="w-full rounded-lg border border-border bg-card text-foreground px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-300"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-border flex justify-end gap-3">
                            <button onClick={() => setIsIssuePanelOpen(false)} className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted font-bold">Huỷ</button>
                            <button disabled={isSaving} onClick={handleCreateFulfillmentBatch} className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-black hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />} Tạo đợt cấp
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isExternalIssuePanelOpen && request && (
                <div className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden rounded-2xl bg-card border border-border shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                            <div>
                                <h4 className="text-base font-black text-foreground">Xuất cấp thi công từ đề xuất</h4>
                                <p className="text-xs font-bold text-muted-foreground">
                                    {request.code} • Kho nguồn: {getWarehouseName(sourceWarehouseId || request.sourceWarehouseId)}
                                </p>
                            </div>
                            <button onClick={() => setIsExternalIssuePanelOpen(false)} className="p-2 text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <MaterialIssuePanel
                                projectId={request.projectId || projectId || null}
                                constructionSiteId={request.constructionSiteId || constructionSiteId || null}
                                materialRequestId={request.id}
                                defaultSourceWarehouseId={sourceWarehouseId || request.sourceWarehouseId || null}
                                compact
                                canCreate
                                onChanged={() => {
                                    void refreshWmsRecords({ requestIds: [request.id] });
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {selectedFulfillmentBatch && request && (
                <div className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-card border border-border shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Chi tiết đợt cấp</div>
                                <h4 className="text-base font-black text-foreground mt-0.5">{selectedFulfillmentBatch.batchNo}</h4>
                                <p className="text-xs font-bold text-muted-foreground mt-1">
                                    {request.code} • {new Date(selectedFulfillmentBatch.batchDate).toLocaleString('vi-VN')}
                                </p>
                            </div>
                            <button onClick={() => setSelectedFulfillmentBatch(null)} className="p-2 text-muted-foreground hover:text-foreground"><X size={20} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="rounded-xl border border-border bg-muted p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Trạng thái</div>
                                    <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${selectedFulfillmentUiStatus?.color || ''}`}>
                                        {selectedFulfillmentUiStatus?.label || '-'}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-border bg-muted p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Nguồn</div>
                                    <div className="mt-1 font-black text-foreground">{getFulfillmentSourceLabel(selectedFulfillmentBatch)}</div>
                                </div>
                                <div className="rounded-xl border border-border bg-muted p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Đích</div>
                                    <div className="mt-1 font-black text-foreground">{selectedFulfillmentBatch.targetWarehouseId ? getWarehouseName(selectedFulfillmentBatch.targetWarehouseId) : 'Cấp thẳng sử dụng'}</div>
                                </div>
                            </div>
                            {selectedFulfillmentBatch.note && (
                                <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs font-bold text-muted-foreground">
                                    {selectedFulfillmentBatch.note}
                                </div>
                            )}
                            <div className="overflow-x-auto rounded-xl border border-border">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                                        <tr>
                                            <th className="p-3 text-left">Vật tư</th>
                                            <th className="p-3 text-right">Xuất</th>
                                            <th className="p-3 text-right">Thực nhận</th>
                                            <th className="p-3 text-right">Giá đợt</th>
                                            <th className="p-3 text-right">Thành tiền</th>
                                            <th className="p-3 text-left">Lý do lệch</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {selectedFulfillmentBatch.lines.map(line => {
                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                            const unitPrice = Number(line.deliveryUnitPrice || 0);
                                            const amountQty = Number(line.receivedQty || line.issuedQty || 0);
                                            return (
                                                <tr key={line.id}>
                                                    <td className="p-3 font-bold text-foreground">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                    <td className="p-3 text-right font-black text-indigo-600">{Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right font-black text-cyan-600">{Number(line.receivedQty || 0).toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right font-bold text-muted-foreground">{unitPrice > 0 ? `${unitPrice.toLocaleString('vi-VN')} đ` : '-'}</td>
                                                    <td className="p-3 text-right font-black text-emerald-600">{unitPrice > 0 ? `${(amountQty * unitPrice).toLocaleString('vi-VN')} đ` : '-'}</td>
                                                    <td className="p-3 text-slate-400">{line.varianceReason || '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-border flex justify-end gap-3">
                            <button onClick={() => setSelectedFulfillmentBatch(null)} className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted font-bold">Đóng</button>
                            <button
                                disabled={isSaving}
                                onClick={() => handlePrintFulfillmentBatch(selectedFulfillmentBatch)}
                                className="px-4 py-2 rounded-lg border border-indigo-250 dark:border-indigo-900/40 bg-indigo-50/10 dark:bg-indigo-950/20 text-indigo-750 dark:text-indigo-400 font-black hover:bg-indigo-100/20 disabled:opacity-60 flex items-center gap-2"
                            >
                                <Truck size={16} /> In phiếu QR
                            </button>
                            <button
                                disabled={isSaving}
                                onClick={() => handlePrintFulfillmentBatch(selectedFulfillmentBatch, 'pdf')}
                                className="px-4 py-2 rounded-lg border border-border bg-card text-foreground font-black hover:bg-muted disabled:opacity-60 flex items-center gap-2"
                            >
                                <FileDown size={16} /> Xuất PDF
                            </button>
                            {canReceiveFulfillmentBatch && selectedFulfillmentBatch.status === 'issued' && !selectedFulfillmentTransaction && (
                                <button
                                    disabled
                                    className="px-4 py-2 rounded-lg bg-slate-200 text-slate-500 font-black disabled:opacity-70 flex items-center gap-2"
                                >
                                    <Loader2 size={16} className="animate-spin" /> Đang tải phiếu kho
                                </button>
                            )}
                            {canReceiveFulfillmentBatch && selectedFulfillmentBatch.status === 'issued' && selectedFulfillmentTransaction?.status === TransactionStatus.PENDING && (
                                <>
                                    <button
                                        disabled={isSaving || !canApproveSelectedFulfillmentTransaction}
                                        onClick={() => openReceivePanel(selectedFulfillmentBatch, 'quality_review')}
                                        title={canApproveSelectedFulfillmentTransaction ? undefined : 'Tài khoản này không có quyền duyệt SL/CL cho phiếu kho.'}
                                        className="px-4 py-2 rounded-lg bg-amber-600 text-white font-black hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        <CheckCircle size={16} /> Duyệt SL/CL
                                    </button>
                                    <button
                                        disabled={isSaving}
                                        onClick={() => handleReturnFulfillmentBatch(selectedFulfillmentBatch)}
                                        className="px-4 py-2 rounded-lg bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-60 flex items-center gap-2"
                                    >
                                        <XCircle size={16} /> Trả lại
                                    </button>
                                </>
                            )}
                            {canReceiveFulfillmentBatch && selectedFulfillmentBatch.status === 'issued' && selectedFulfillmentTransaction?.status === TransactionStatus.APPROVED && (
                                <>
                                    <button
                                        disabled={isSaving || !canReceiveSelectedFulfillmentTransaction}
                                        onClick={() => openReceivePanel(selectedFulfillmentBatch, 'receipt')}
                                        title={canReceiveSelectedFulfillmentTransaction ? undefined : 'Tài khoản này không có quyền xác nhận nhập kho cho phiếu kho.'}
                                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        <CheckCircle size={16} />
                                        {selectedFulfillmentBatch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Xác nhận sử dụng' : 'Xác nhận nhập kho'}
                                    </button>
                                    <button
                                        disabled={isSaving}
                                        onClick={() => handleReturnFulfillmentBatch(selectedFulfillmentBatch)}
                                        className="px-4 py-2 rounded-lg bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-60 flex items-center gap-2"
                                    >
                                        <XCircle size={16} /> Trả lại
                                    </button>
                                </>
                            )}
                            {isAdmin(user)
                                && selectedFulfillmentBatch.status === 'received'
                                && (selectedFulfillmentBatch.targetWarehouseId || selectedFulfillmentBatch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION) && (
                                <button
                                    disabled={isSaving}
                                    onClick={() => handleReturnFulfillmentBatch(selectedFulfillmentBatch)}
                                    className="px-4 py-2 rounded-lg bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-60 flex items-center gap-2"
                                >
                                    <XCircle size={16} /> Hoàn trả / đảo tồn
                                </button>
                            )}
                            {canReceiveFulfillmentBatch && selectedFulfillmentBatch.status === 'variance_pending' && (
                                <button
                                    disabled={isSaving}
                                    onClick={() => handleResolveFulfillmentVariance(selectedFulfillmentBatch)}
                                    className="px-4 py-2 rounded-lg bg-amber-600 text-white font-black hover:bg-amber-700 disabled:opacity-60 flex items-center gap-2"
                                >
                                    <AlertCircle size={16} /> Chốt lệch
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {returningReceivedBatch && request && (
                <div className="fixed inset-0 z-[1020] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-card border border-border shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-rose-500">Hoàn trả / đảo tồn</div>
                                <h4 className="text-base font-black text-foreground mt-0.5">{returningReceivedBatch.batchNo}</h4>
                                <p className="text-xs font-bold text-muted-foreground mt-1">{request.code} • Nguồn gốc: {getFulfillmentSourceLabel(returningReceivedBatch)}</p>
                            </div>
                            <button
                                onClick={() => setReturningReceivedBatch(null)}
                                className="p-2 text-muted-foreground hover:text-foreground"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-xl border border-border bg-muted p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Trừ tồn tại kho</div>
                                    <div className="mt-1 font-black text-foreground">
                                        {returningReceivedBatch.targetWarehouseId ? getWarehouseName(returningReceivedBatch.targetWarehouseId) : '-'}
                                    </div>
                                </div>
                                <label className="rounded-xl border border-rose-200/30 dark:border-rose-900/30 bg-rose-50/10 dark:bg-rose-955/10 p-3 block">
                                    <div className="text-[10px] uppercase font-black text-rose-500 dark:text-rose-450">Kho nhận hoàn trả</div>
                                    <select
                                        value={returnDestinationWarehouseId}
                                        onChange={event => setReturnDestinationWarehouseId(event.target.value)}
                                        className="mt-2 w-full rounded-lg border border-rose-200/40 dark:border-rose-800/40 bg-card text-foreground px-3 py-2 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-rose-200"
                                    >
                                        <option value="">Chọn kho nhận hoàn trả</option>
                                        {warehouses
                                            .filter(warehouse => warehouse.id !== returningReceivedBatch.targetWarehouseId)
                                            .map(warehouse => (
                                                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                            ))}
                                    </select>
                                </label>
                            </div>
                            <label className="block">
                                <div className="text-[10px] uppercase font-black text-slate-400 mb-1">Lý do hoàn trả</div>
                                <textarea
                                    value={returnReceivedReason}
                                    onChange={event => setReturnReceivedReason(event.target.value)}
                                    placeholder="Ví dụ: trả NCC do nhập nhầm đơn, hàng sai quy cách..."
                                    className="w-full min-h-[78px] rounded-xl border border-border bg-card text-foreground px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200"
                                />
                            </label>
                            <div className="overflow-x-auto rounded-xl border border-border">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                                        <tr>
                                            <th className="p-3 text-left">Vật tư</th>
                                            <th className="p-3 text-right">Số lượng hoàn</th>
                                            <th className="p-3 text-left">ĐVT</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {returningReceivedBatch.lines
                                            .filter(line => Number(line.receivedQty || 0) > 0)
                                            .map(line => {
                                                const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                                return (
                                                    <tr key={line.id}>
                                                        <td className="p-3 font-bold text-foreground">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                        <td className="p-3 text-right font-black text-rose-600 dark:text-rose-450">{Number(line.receivedQty || 0).toLocaleString('vi-VN')}</td>
                                                        <td className="p-3 text-slate-500">{line.unit || (requestLine ? getLineUnit(requestLine) : '')}</td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                            {!returningReceivedBatch.sourceWarehouseId && (
                                <div className="rounded-xl border border-amber-250/40 dark:border-amber-900/40 bg-amber-50/10 dark:bg-amber-955/20 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-400">
                                    Đợt này nhập trực tiếp từ PO/NCC nên không có kho nguồn ban đầu. Hệ thống cần chọn kho nhận hoàn trả để tạo phiếu đảo tồn từ kho công trường.
                                </div>
                            )}
                        </div>
                        <div className="px-5 py-4 border-t border-border flex justify-end gap-3">
                            <button
                                onClick={() => setReturningReceivedBatch(null)}
                                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted font-bold"
                            >
                                Huỷ
                            </button>
                            <button
                                disabled={isSaving || !returnDestinationWarehouseId}
                                onClick={() => executeReturnReceivedBatch(returningReceivedBatch, returnDestinationWarehouseId, returnReceivedReason)}
                                className="px-5 py-2 rounded-lg bg-rose-600 text-white font-black hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Hoàn trả và đảo tồn
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {receivingBatch && request && (
                <div className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-card border border-border shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                            <div>
                                <h4 className="text-base font-black text-foreground">
                                    {receivePanelMode === 'quality_review'
                                        ? 'Duyệt SL/CL đợt cấp'
                                        : receivingBatch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION
                                            ? 'Xác nhận sử dụng'
                                            : 'Xác nhận nhập kho'}
                                </h4>
                                <p className="text-xs font-bold text-muted-foreground">{receivingBatch.batchNo} • {request.code}</p>
                            </div>
                            <button onClick={() => setReceivingBatch(null)} className="p-2 text-muted-foreground hover:text-foreground"><X size={20} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <div className="overflow-x-auto rounded-xl border border-border">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                                        <tr>
                                            <th className="p-3 text-left">Vật tư</th>
                                            <th className="p-3 text-right">Đã xuất</th>
                                            <th className="p-3 text-right">Giá đợt</th>
                                            <th className="p-3 text-right">
                                                {receivePanelMode === 'quality_review' ? 'SL duyệt' : 'Thực nhận'}
                                            </th>
                                            <th className="p-3 text-right">Thành tiền</th>
                                            <th className="p-3 text-left">Lý do lệch</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {receivingBatch.lines.map(line => {
                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                            const draft = receiveLines.find(item => item.lineId === line.id);
                                            const draftQty = Number(draft?.qty || 0);
                                            const unitPrice = Number(line.deliveryUnitPrice || 0);
                                            return (
                                                <tr key={line.id}>
                                                    <td className="p-3 font-bold text-foreground">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                    <td className="p-3 text-right font-bold text-indigo-600">{Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right font-bold text-muted-foreground">{unitPrice > 0 ? `${unitPrice.toLocaleString('vi-VN')} đ` : '-'}</td>
                                                    <td className="p-3 text-right">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={draft?.qty || '0'}
                                                            onChange={event => updateReceiveLine(line.id, { qty: event.target.value })}
                                                            className={`w-24 rounded-lg border bg-card px-2 py-1 text-right font-black outline-none focus:ring-2 ${
                                                                receivePanelMode === 'quality_review'
                                                                    ? 'border-amber-250 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 focus:ring-amber-300'
                                                                    : 'border-emerald-250 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 focus:ring-emerald-300'
                                                            }`}
                                                        />
                                                    </td>
                                                    <td className="p-3 text-right font-black text-emerald-600">{unitPrice > 0 ? `${(draftQty * unitPrice).toLocaleString('vi-VN')} đ` : '-'}</td>
                                                    <td className="p-3">
                                                        <input
                                                            value={draft?.reason || ''}
                                                            onChange={event => updateReceiveLine(line.id, { reason: event.target.value })}
                                                            placeholder="Lý do nếu cần"
                                                            className={`w-full rounded-lg border border-border bg-card text-foreground px-2 py-1 outline-none focus:ring-2 ${
                                                                receivePanelMode === 'quality_review' ? 'focus:ring-amber-300' : 'focus:ring-emerald-300'
                                                            }`}
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-border flex justify-end gap-3">
                            <button onClick={() => setReceivingBatch(null)} className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted font-bold">Huỷ</button>
                            <button
                                disabled={isSaving}
                                onClick={handleReceiveFulfillmentBatch}
                                className={`px-5 py-2 rounded-lg text-white font-black disabled:opacity-60 flex items-center gap-2 ${
                                    receivePanelMode === 'quality_review'
                                        ? 'bg-amber-600 hover:bg-amber-700'
                                        : 'bg-emerald-600 hover:bg-emerald-700'
                                }`}
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                {receivePanelMode === 'quality_review'
                                    ? 'Duyệt SL/CL'
                                    : receivingBatch.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION
                                        ? 'Xác nhận sử dụng'
                                        : 'Xác nhận nhập kho'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals for selection */}
            <ItemSelectionModal
                isOpen={isItemSelectOpen}
                onClose={() => setItemSelectOpen(false)}
                onSelect={handleSelectFromModal}
                onOpenScanner={() => setScannerOpen(true)}
                filterWarehouseId={isProjectRequest && !canSeeAvailability ? undefined : isProjectRequest ? stockPreviewWarehouseId : sourceWarehouseId}
                allowAllItems={isProjectRequest}
                showStockQuantities={canSeeAvailability}
            />

            {isScannerOpen && (
                <React.Suspense fallback={null}>
                    <ScannerModal
                        isOpen={isScannerOpen}
                        onClose={() => setScannerOpen(false)}
                        onScan={(sku) => {
                            const item = items.find(i => i.sku === sku);
                            if (item) handleSelectFromModal(item);
                            setScannerOpen(false);
                        }}
                    />
                </React.Suspense>
            )}

            {submittingProjectRequest && isProjectRequest && (
                <ProjectWorkflowStartDialog
                    requestId={submittingProjectRequest.id}
                    requestCode={submittingProjectRequest.code}
                    requesterUserId={submittingProjectRequest.requesterId}
                    projectId={effectiveProjectId}
                    constructionSiteId={effectiveConstructionSiteId}
                    users={users}
                    employees={employees}
                    orgUnits={orgUnits}
                    onCancel={() => setSubmittingProjectRequest(null)}
                    onConfirm={input => submitRequestForApproval(submittingProjectRequest, {
                        userId: input.assigneeUserIds[0],
                        userIds: input.assigneeUserIds,
                        name: input.assigneeUserIds.map(id => users.find(item => item.id === id)?.name || id).join(', '),
                        note: input.comment,
                    })}
                />
            )}

            {submittingProjectRequest && !isProjectRequest && (
                <ProjectSubmissionDialog
                    title="Gửi đề xuất vật tư"
                    actionLabel="Gửi đề xuất"
                    documentLabel="Đề xuất vật tư dự án"
                    documentName={`${submittingProjectRequest.code} • ${getWarehouseName(submittingProjectRequest.siteWarehouseId)}`}
                    documentSubtitle="Trạng thái sau gửi: Chờ duyệt"
                    projectId={effectiveProjectId || undefined}
                    constructionSiteId={effectiveConstructionSiteId}
                    recipientPermissionCodes={['approve']}
                    recipientHint="Chọn đích danh người có quyền duyệt đề xuất vật tư trong tổ chức dự án."
                    details={[
                        { label: 'Kho nhận', value: getWarehouseName(submittingProjectRequest.siteWarehouseId) },
                        { label: 'Số dòng vật tư', value: `${submittingProjectRequest.items.length} dòng` },
                        { label: 'Cách cấp vật tư', value: submittingProjectRequest.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Cấp thẳng sử dụng' : 'Nhập kho công trường' },
                        { label: 'Ghi chú', value: submittingProjectRequest.note || '-' },
                    ]}
                    onCancel={() => setSubmittingProjectRequest(null)}
                    onConfirm={target => submitRequestForApproval(submittingProjectRequest, target)}
                />
            )}
        </div>
    );
};

export default RequestModal;
