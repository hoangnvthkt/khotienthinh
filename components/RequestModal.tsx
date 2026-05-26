
import React, { useMemo, useState, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { X, Send, CheckCircle, Trash2, Info, Truck, PackageCheck, AlertCircle, XCircle, Plus, User, Loader2, Save } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import {
    MaterialBudgetItem,
    MaterialRequest,
    MaterialRequestFulfillmentMode,
    MaterialRequestOrigin,
    ProjectWorkBoqItem,
    ProjectSubmissionTarget,
    MaterialRequestFulfillmentBatch,
    MaterialRequestFulfillmentSourceType,
    RequestItem,
    RequestStatus,
    InventoryItem,
} from '../types';
import ItemSelectionModal from './ItemSelectionModal';
import ScannerModal from './ScannerModal';
import ProjectSubmissionDialog from './project/ProjectSubmissionDialog';
import { useReservedStock } from '../hooks/useReservedStock';
import { canApproveMaterialRequest, canExportMaterialRequest, canReceiveMaterialRequest, isAdmin, isGlobalWarehouseKeeper, isWarehouseKeeperFor } from '../lib/wmsPermissions';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { projectSubmissionService } from '../lib/projectSubmissionService';
import { materialRequestFulfillmentService, getCommittedQty, getRequestLineId } from '../lib/materialRequestFulfillmentService';
import { buildFulfillmentBatchReceiveUrl } from '../lib/fulfillmentBatchQr';

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
}

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

const activeBudgetStatuses = new Set<RequestStatus | string>([
    RequestStatus.PENDING,
    RequestStatus.APPROVED,
    RequestStatus.IN_TRANSIT,
    RequestStatus.COMPLETED,
    RequestStatus.LEGACY_PENDING,
    RequestStatus.LEGACY_APPROVED,
]);

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
    overBudgetReason: item.overBudgetReason || '',
    isManualItem: item.isManualItem || false,
    itemNameSnapshot: item.itemNameSnapshot || '',
    unitSnapshot: item.unitSnapshot || '',
    skuSnapshot: item.skuSnapshot || '',
    specification: item.specification || '',
    manualReason: item.manualReason || '',
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
}) => {
    const { items, warehouses, user, users, requests, addRequest, updateRequestStatus, loadModuleData } = useApp();
    const { getStockSummary, getOnHandStock } = useReservedStock();
    const toast = useToast();
    const confirm = useConfirm();
    const [step, setStep] = useState<'CREATE' | 'APPROVE' | 'VIEW'>('CREATE');
    const [showApprovalPanel, setShowApprovalPanel] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form State
    const [siteWarehouseId, setSiteWarehouseId] = useState('');
    const [sourceWarehouseId, setSourceWarehouseId] = useState('');
    const [stockPreviewWarehouseId, setStockPreviewWarehouseId] = useState('');
    const [note, setNote] = useState('');
    const [fulfillmentMode, setFulfillmentMode] = useState<MaterialRequestFulfillmentMode>(MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
    const [overrideReason, setOverrideReason] = useState('');
    const [reqItems, setReqItems] = useState<RequestLineDraft[]>([]);
    const [approvedItems, setApprovedItems] = useState<{ lineId?: string, itemId: string, qty: number }[]>([]);
    const [draftWorkBoqItemId, setDraftWorkBoqItemId] = useState('');
    const [draftMaterialBudgetItemId, setDraftMaterialBudgetItemId] = useState('');
    const [draftQty, setDraftQty] = useState('');
    const [draftNeededDate, setDraftNeededDate] = useState('');
    const [draftLineNote, setDraftLineNote] = useState('');
    const [submittingProjectRequest, setSubmittingProjectRequest] = useState<MaterialRequest | null>(null);
    const [fulfillmentBatches, setFulfillmentBatches] = useState<MaterialRequestFulfillmentBatch[]>([]);
    const [isLoadingFulfillment, setIsLoadingFulfillment] = useState(false);
    const [isIssuePanelOpen, setIsIssuePanelOpen] = useState(false);
    const [issueSourceType, setIssueSourceType] = useState<MaterialRequestFulfillmentSourceType>('stock');
    const [issueLines, setIssueLines] = useState<FulfillmentQtyDraft[]>([]);
    const [issueNote, setIssueNote] = useState('');
    const [receivingBatch, setReceivingBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
    const [selectedFulfillmentBatch, setSelectedFulfillmentBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
    const [receiveLines, setReceiveLines] = useState<ReceiveQtyDraft[]>([]);

    const [isItemSelectOpen, setItemSelectOpen] = useState(false);
    const [isScannerOpen, setScannerOpen] = useState(false);

    const isProjectRequest = requestOrigin === 'project' || request?.requestOrigin === 'project' || !!projectId || !!constructionSiteId;
    const effectiveProjectId = projectId || request?.projectId || null;
    const effectiveConstructionSiteId = constructionSiteId || request?.constructionSiteId || null;
    const workBoqMap = useMemo(() => new Map(workBoqItems.map(item => [item.id, item])), [workBoqItems]);
    const materialBudgetMap = useMemo(() => new Map(materialBudgetItems.map(item => [item.id, item])), [materialBudgetItems]);
    const budgetOptions = useMemo(
        () => materialBudgetItems.filter(item => !draftWorkBoqItemId || item.workBoqItemId === draftWorkBoqItemId),
        [draftWorkBoqItemId, materialBudgetItems],
    );

    const getBudgetRequestedQty = (materialBudgetItemId?: string | null, excludeRequestId?: string) => {
        if (!materialBudgetItemId) return 0;
        return requests
            .filter(req => req.id !== excludeRequestId)
            .filter(req => !effectiveConstructionSiteId || req.constructionSiteId === effectiveConstructionSiteId)
            .filter(req => activeBudgetStatuses.has(req.status))
            .flatMap(req => req.items || [])
            .filter(line => line.materialBudgetItemId === materialBudgetItemId)
            .reduce((sum, line) => sum + Number(line.requestQty || 0), 0);
    };

    const getDraftRequestedQty = (materialBudgetItemId?: string | null, excludeLineId?: string) => {
        if (!materialBudgetItemId) return 0;
        return reqItems
            .filter(line => line.lineId !== excludeLineId && line.materialBudgetItemId === materialBudgetItemId)
            .reduce((sum, line) => sum + Number(line.qty || 0), 0);
    };

    const buildLineBudgetSnapshot = (line: RequestLineDraft, excludeRequestId?: string) => {
        const budget = line.materialBudgetItemId ? materialBudgetMap.get(line.materialBudgetItemId) : undefined;
        const previousRequested = getBudgetRequestedQty(line.materialBudgetItemId, excludeRequestId);
        const draftRequested = getDraftRequestedQty(line.materialBudgetItemId, line.lineId);
        const totalRequested = previousRequested + draftRequested + Number(line.qty || 0);
        const budgetQty = Number(budget?.budgetQty || 0);
        const overBudgetQty = budgetQty > 0 ? Math.max(0, totalRequested - budgetQty) : 0;
        return {
            budget,
            previousRequested,
            totalRequested,
            budgetQty,
            overBudgetQty,
            overBudgetPercent: budgetQty > 0 ? (overBudgetQty / budgetQty) * 100 : 0,
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

    const getWarehouseName = (warehouseId?: string | null) =>
        warehouses.find(w => w.id === warehouseId)?.name || warehouseId || '-';

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

    useEffect(() => {
        if (isOpen) {
            setShowApprovalPanel(false);
            setIsSaving(false);
            setIsIssuePanelOpen(false);
            setReceivingBatch(null);
            if (request) {
                if (request.status === RequestStatus.PENDING && canApproveMaterialRequest(user, request)) {
                    setStep('APPROVE');
                } else {
                    setStep('VIEW');
                }

                setSiteWarehouseId(request.siteWarehouseId);
                setSourceWarehouseId(request.sourceWarehouseId || '');
                setStockPreviewWarehouseId('');
                setNote(request.note || '');
                setFulfillmentMode(request.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
                setOverrideReason(request.overrideReason || '');
                setReqItems(request.items.map(toDraftLine));
                setApprovedItems(request.items.map(i => ({ lineId: i.lineId, itemId: i.itemId, qty: i.approvedQty })));
            } else {
                setStep('CREATE');
                setSiteWarehouseId(defaultSiteWarehouseId || user.assignedWarehouseId || '');
                setSourceWarehouseId('');
                setStockPreviewWarehouseId('');
                setNote('');
                setFulfillmentMode(MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK);
                setOverrideReason('');
                setReqItems([]);
                setApprovedItems([]);
                setDraftWorkBoqItemId('');
                setDraftMaterialBudgetItemId('');
                setDraftQty('');
                setDraftNeededDate('');
                setDraftLineNote('');
            }
        }
    }, [isOpen, request, user, items, defaultSiteWarehouseId]);

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

    const handleAddBudgetLine = () => {
        const budget = materialBudgetMap.get(draftMaterialBudgetItemId);
        if (!budget) {
            toast.warning('Chưa chọn vật tư BOQ', 'Vui lòng chọn dòng vật tư/định mức thuộc BOQ triển khai.');
            return;
        }
        const inventoryItem = items.find(item =>
            item.id === budget.inventoryItemId ||
            (!!budget.materialCode && item.sku.toLowerCase() === budget.materialCode.toLowerCase()) ||
            item.name.toLowerCase() === budget.itemName.toLowerCase()
        );
        if (!inventoryItem) {
            toast.warning('Chưa có mã kho', 'Dòng BOQ này chưa liên kết với vật tư trong danh mục. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước.');
            return;
        }
        const qty = Math.max(0, Number(draftQty || 0));
        if (qty <= 0) {
            toast.warning('Thiếu khối lượng', 'Vui lòng nhập khối lượng đề xuất lớn hơn 0.');
            return;
        }
        const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
        setReqItems(prev => [...prev, {
            lineId: crypto.randomUUID(),
            itemId: inventoryItem.id,
            qty,
            workBoqItemId: budget.workBoqItemId || draftWorkBoqItemId || null,
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
        }]);
        setDraftMaterialBudgetItemId('');
        setDraftQty('');
        setDraftLineNote('');
    };

    const submitCreatedRequest = async (newRequest: MaterialRequest, submissionTarget?: ProjectSubmissionTarget) => {
        const requestToSave: MaterialRequest = submissionTarget
            ? { ...newRequest, ...projectSubmissionService.targetToUpdate(submissionTarget) }
            : newRequest;

        setIsSaving(true);
        try {
            const saved = await addRequest(requestToSave);
            if (!saved) {
                toast.error('Không thể gửi đề xuất', 'Không lưu được phiếu đề xuất lên hệ thống. Vui lòng thử lại.');
                if (submissionTarget) throw new Error('Không lưu được phiếu đề xuất lên hệ thống.');
                return;
            }
            setSubmittingProjectRequest(null);
            toast.success('Đã gửi đề xuất vật tư', submissionTarget?.name ? `Phiếu đã gửi tới ${submissionTarget.name}.` : 'Phiếu của bạn đang chờ xử lý.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.create', err);
            toast.error('Không thể gửi đề xuất', getApiErrorMessage(err, 'Không lưu được phiếu đề xuất lên hệ thống.'));
            if (submissionTarget) throw err;
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmitCreate = async () => {
        if (isSaving) return;
        if (!siteWarehouseId || (!isProjectRequest && !sourceWarehouseId) || reqItems.length === 0) {
            toast.warning('Thiếu thông tin', isProjectRequest ? 'Vui lòng chọn kho nhận và ít nhất 1 vật tư.' : 'Vui lòng chọn đầy đủ kho nhận, kho nguồn và ít nhất 1 vật tư.');
            return;
        }

        if (isProjectRequest) {
            const invalidLine = reqItems.find(line => {
                const snapshot = buildLineBudgetSnapshot(line);
                const outsideBoq = !line.materialBudgetItemId;
                return (outsideBoq || snapshot.overBudgetQty > 0) && !line.overBudgetReason?.trim();
            });
            if (invalidLine) {
                const item = items.find(i => i.id === invalidLine.itemId);
                toast.warning('Thiếu lý do vượt/ngoài BOQ', `${item?.name || invalidLine.itemId} cần nhập lý do để gửi đề xuất.`);
                return;
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
            if (!window.confirm(`Một số vật tư vượt tồn khả dụng và sẽ chỉ ghi nhận nhu cầu chờ duyệt:\n${shortageText}`)) return;
        }

        const newRequest: MaterialRequest = {
            id: `mr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            code: `MR-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000)}`,
            projectId: effectiveProjectId,
            constructionSiteId: effectiveConstructionSiteId,
            requestOrigin: isProjectRequest ? 'project' : 'wms',
            siteWarehouseId,
            sourceWarehouseId: sourceWarehouseId || undefined,
            requesterId: user.id,
            status: RequestStatus.PENDING,
            createdDate: new Date().toISOString(),
            expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
            note,
            fulfillmentMode,
            items: reqItems.map(i => {
                const snapshot = buildLineBudgetSnapshot(i);
                const work = i.workBoqItemId ? workBoqMap.get(i.workBoqItemId) : undefined;
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
                    previousRequestedQtySnapshot: snapshot.previousRequested,
                    overBudgetQtySnapshot: snapshot.overBudgetQty,
                    overBudgetPercentSnapshot: snapshot.overBudgetPercent,
                    overBudgetReason: i.overBudgetReason || undefined,
                    isManualItem: i.isManualItem || false,
                    itemNameSnapshot: i.itemNameSnapshot || getLineInventory(i.itemId)?.name || snapshot.budget?.itemName || undefined,
                    unitSnapshot: i.unitSnapshot || getLineInventory(i.itemId)?.unit || snapshot.budget?.unit || undefined,
                    skuSnapshot: i.skuSnapshot || getLineInventory(i.itemId)?.sku || undefined,
                    specification: i.specification || undefined,
                    manualReason: i.manualReason || undefined,
                };
            }),
            logs: [{ action: 'CREATED', userId: user.id, timestamp: new Date().toISOString() }]
        };

        if (isProjectRequest) {
            setSubmittingProjectRequest(newRequest);
            return;
        }

        await submitCreatedRequest(newRequest);
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
                const confirmMsg = `Có ${itemsWithExcess.length} vật tư được duyệt vượt mức yêu cầu ban đầu. Bạn có chắc chắn muốn tiếp tục phê duyệt?`;
                if (!window.confirm(confirmMsg)) return;
            }
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
                if (!window.confirm(`Bạn đang duyệt vượt tồn khả dụng:\n${shortageText}\n\nTiếp tục với lý do override?`)) return;
            }
        }

        if (status === RequestStatus.IN_TRANSIT || status === RequestStatus.COMPLETED) {
            const stockLines = approvedItems.filter(line => Number(line.qty || 0) > 0 && !!getLineInventory(line.itemId));
            if (stockLines.length > 0 && !sourceWarehouseId) {
                toast.error('Chưa chọn kho nguồn', 'Phòng vật tư cần chọn kho nguồn trước khi xuất vật tư có mã tồn kho.');
                return;
            }
            const stockShortages = stockLines
                .map(line => ({ ...line, onHand: getOnHandStock(line.itemId, sourceWarehouseId) }))
                .filter(line => Number(line.qty) > line.onHand);
            if (stockShortages.length > 0) {
                const shortage = stockShortages[0];
                const item = getLineInventory(shortage.itemId);
                const whName = warehouses.find(w => w.id === sourceWarehouseId)?.name || sourceWarehouseId;
                toast.error('Không đủ tồn thực tế', `Kho nguồn "${whName}" không đủ tồn cho dòng "${item?.name || shortage.itemId}". Tồn ${shortage.onHand}, cần ${shortage.qty}.`);
                return;
            }
        }

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
        const reason = window.prompt('Nhập lý do trả lại phiếu');
        if (!reason?.trim()) {
            toast.warning('Thiếu lý do trả lại', 'Vui lòng nhập lý do để người tạo phiếu biết cần bổ sung gì.');
            return;
        }
        setIsSaving(true);
        try {
            const saved = await updateRequestStatus(request.id, RequestStatus.PENDING, reason.trim(), undefined, undefined, undefined, 'RETURNED');
            if (!saved) {
                toast.error('Không thể trả lại phiếu', 'Không cập nhật được trạng thái phiếu trên hệ thống.');
                return;
            }
            toast.success('Đã trả lại phiếu', 'Phiếu đã quay về bước chờ xử lý.');
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
        const drafts = request.items
            .map((line, index) => {
                const requestLineId = getRequestLineId(request, line, index);
                const lineSummary = fulfillmentLineSummaryMap.get(requestLineId);
                const remaining = lineSummary?.remainingToIssue ?? getCommittedQty(line);
                return {
                    requestLineId,
                    itemId: line.itemId,
                    qty: remaining > 0 ? String(remaining) : '0',
                    reason: '',
                };
            })
            .filter(line => Number(line.qty || 0) > 0);
        if (drafts.length === 0) {
            toast.info('Đã cấp đủ', 'Không còn dòng vật tư nào cần tạo đợt cấp.');
            return;
        }
        setIssueLines(drafts);
        setIssueSourceType('stock');
        setIssueNote('');
        setIsIssuePanelOpen(true);
    };

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
        const shortage = validLines.find(line => {
            const onHand = getOnHandStock(line.itemId, effectiveSource);
            return line.issuedQty > onHand && !isAdmin(user);
        });
        if (shortage) {
            const item = getLineInventory(shortage.itemId);
            const onHand = getOnHandStock(shortage.itemId, effectiveSource);
            toast.error('Không đủ tồn thực tế', `${item?.name || shortage.itemId}: tồn ${onHand}, cần cấp ${shortage.issuedQty}.`);
            return;
        }

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
            await updateRequestStatus(request.id, nextStatus, issueNote.trim() || 'Tạo đợt cấp vật tư', undefined, effectiveSource, overrideReason.trim() || undefined, 'FULFILLMENT_SYNC');
            await loadModuleData('wms', true);
            toast.success('Đã tạo đợt cấp', 'Đợt cấp đã được ghi nhận và tạo phiếu kho chờ xác nhận nhận hàng.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.issue', err);
            toast.error('Không thể tạo đợt cấp', getApiErrorMessage(err, 'Không tạo được đợt cấp vật tư.'));
        } finally {
            setIsSaving(false);
        }
    };

    const openReceivePanel = (batch: MaterialRequestFulfillmentBatch) => {
        setSelectedFulfillmentBatch(null);
        setReceivingBatch(batch);
        setReceiveLines(batch.lines.map(line => ({
            lineId: line.id,
            qty: String(line.issuedQty || 0),
            reason: '',
        })));
    };

    const handleReceiveFulfillmentBatch = async () => {
        if (!request || !receivingBatch || isSaving) return;
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
            const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
            await updateRequestStatus(request.id, nextStatus, 'Xác nhận nhận đợt cấp vật tư', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_SYNC');
            await loadModuleData('wms', true);
            toast.success(
                savedBatch.status === 'variance_pending' ? 'Đã ghi nhận lệch' : 'Đã xác nhận nhận hàng',
                savedBatch.status === 'variance_pending'
                    ? 'Đợt cấp đang chờ phòng vật tư/admin chốt theo số thực nhận trước khi cập nhật tồn kho.'
                    : nextStatus === RequestStatus.COMPLETED ? 'Phiếu đề xuất đã đủ số lượng công trường đề xuất.' : 'Đã cập nhật lũy kế nhận hàng cho phiếu.'
            );
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.receive', err);
            toast.error('Không thể xác nhận nhận hàng', getApiErrorMessage(err, 'Không cập nhật được đợt cấp.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleReturnFulfillmentBatch = async (batch: MaterialRequestFulfillmentBatch) => {
        if (!request || isSaving) return;
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
            await updateRequestStatus(request.id, nextStatus, 'Trả lại/hoàn hàng đợt cấp vật tư', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_SYNC');
            await loadModuleData('wms', true);
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
            await updateRequestStatus(request.id, nextStatus, 'Chốt lệch đợt cấp vật tư theo thực nhận', undefined, sourceWarehouseId || request.sourceWarehouseId, overrideReason.trim() || undefined, 'FULFILLMENT_SYNC');
            await loadModuleData('wms', true);
            toast.success('Đã chốt lệch', nextStatus === RequestStatus.COMPLETED ? 'Phiếu đề xuất đã đủ số lượng công trường đề xuất.' : 'Tồn kho đã cập nhật theo số thực nhận.');
            onClose();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.resolveVariance', err);
            toast.error('Không thể chốt lệch', getApiErrorMessage(err, 'Không cập nhật được đợt cấp lệch.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handlePrintFulfillmentBatch = async (batch: MaterialRequestFulfillmentBatch) => {
        if (!request) return;
        try {
            const printableBatch = await materialRequestFulfillmentService.ensureQrToken(batch);
            setSelectedFulfillmentBatch(printableBatch);
            const receiveUrl = buildFulfillmentBatchReceiveUrl(printableBatch.qrToken!);
            const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={132} level="H" includeMargin />);
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
                    <title>${printableBatch.batchNo}</title>
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
                                Kho xuất: ${getWarehouseName(printableBatch.sourceWarehouseId)}<br/>
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
                    <script>window.print();</script>
                </body>
                </html>
            `;
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                toast.error('Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup in phiếu xuất kho.');
                return;
            }
            printWindow.document.write(html);
            printWindow.document.close();
        } catch (err: any) {
            logApiError('requestModal.fulfillment.print', err);
            toast.error('Không thể in phiếu xuất', getApiErrorMessage(err, 'Không tạo được mã QR cho đợt cấp.'));
        }
    };

    if (!isOpen) return null;

    const isEditable = step === 'CREATE';
    const isApproving = step === 'APPROVE';
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
    const canEditApprovalQuantities = isApproving || canPrepareIssue;
    const canCreateFulfillmentBatch = !!request
        && isBatchFulfillmentRequest
        && (request.status === RequestStatus.APPROVED || request.status === RequestStatus.IN_TRANSIT)
        && (
            isAdmin(user)
            || isGlobalWarehouseKeeper(user)
            || isWarehouseKeeperFor(user, sourceWarehouseId || request.sourceWarehouseId)
        );
    const canReturn = !!request
        && !request.relatedTransactionId
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

    const sourceWh = warehouses.find(w => w.id === sourceWarehouseId);
    const targetWh = warehouses.find(w => w.id === siteWarehouseId);
    const requester = users.find(u => u.id === (request?.requesterId || user.id));
    const showSourceWarehouseField = !isEditable || !isProjectRequest || canEditApprovalQuantities;
    const stockContextWarehouseId = isEditable && isProjectRequest ? stockPreviewWarehouseId : sourceWarehouseId;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-full lg:max-w-5xl shadow-2xl flex flex-col max-h-[95vh] sm:max-h-[95vh] overflow-hidden relative">

                {/* Decision Overlay */}
                {showApprovalPanel && (
                    <div className="absolute inset-0 z-[60] bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-200">
                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6">
                            <AlertCircle size={32} />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-2">Xác nhận xử lý phiếu</h3>
                        <p className="text-slate-500 mb-10 text-center max-w-md">Vui lòng chọn Phê duyệt để chuyển sang bước xuất kho, hoặc Từ chối để hủy yêu cầu này.</p>

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
                            className="mt-8 text-slate-400 font-bold hover:text-slate-600"
                        >
                            Quay lại xem thông tin
                        </button>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800">
                            {isEditable ? 'Tạo đề xuất vật tư' : `Phiếu đề xuất: ${request?.code}`}
                        </h3>
                        <p className="text-xs text-slate-500">
                            {isEditable ? 'Gửi nhu cầu về bộ phận điều phối' : `Trạng thái: ${request?.status}${request?.submittedToName ? ` • Gửi: ${request.submittedToName}` : ''}`}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Status Bar */}
                {!isEditable && (
                    <div className={`px-6 py-2 text-white text-[10px] font-bold flex justify-between items-center ${request?.status === RequestStatus.PENDING ? 'bg-amber-600' :
                        request?.status === RequestStatus.APPROVED ? 'bg-blue-600' :
                            request?.status === RequestStatus.IN_TRANSIT ? 'bg-indigo-600' :
                                request?.status === RequestStatus.COMPLETED ? 'bg-emerald-600' :
                                    request?.status === RequestStatus.REJECTED ? 'bg-red-600' : 'bg-slate-600'
                        }`}>
                        <div className="flex items-center uppercase tracking-widest">
                            <Info size={14} className="mr-2" />
                            {request?.status === RequestStatus.PENDING ? 'Đang chờ thẩm định' :
                                request?.status === RequestStatus.APPROVED ? 'Đã duyệt - Chờ xuất hàng' :
                                    request?.status === RequestStatus.IN_TRANSIT ? 'Đang trên đường vận chuyển' :
                                        request?.status === RequestStatus.COMPLETED ? (fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Đã cấp thẳng sử dụng' : 'Đã nhập kho công trường thành công') :
                                            request?.status === RequestStatus.REJECTED ? 'Đề xuất này đã bị từ chối' : 'Đề xuất đã đóng'}
                        </div>
                        <div className="font-mono">{new Date(request?.createdDate || '').toLocaleDateString('vi-VN')}</div>
                    </div>
                )}

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                            <label className="text-[10px] uppercase font-black text-slate-400">Người yêu cầu</label>
                            <div className="flex items-center gap-2 text-slate-800 font-bold">
                                <User size={18} className="text-slate-400" />
                                <span className="text-sm">{requester?.name || 'N/A'}</span>
                            </div>
                        </div>

                        {!isEditable && request?.submittedToName && (
                            <div className="bg-white p-4 rounded-xl border border-amber-100 shadow-sm space-y-2">
                                <label className="text-[10px] uppercase font-black text-amber-500">Người nhận xử lý</label>
                                <div className="flex items-center gap-2 text-amber-700 font-bold">
                                    <User size={18} className="text-amber-400" />
                                    <span className="text-sm">{request.submittedToName}</span>
                                </div>
                                {request.submissionNote && <div className="text-[10px] text-slate-400 truncate">{request.submissionNote}</div>}
                            </div>
                        )}

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
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
                            <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm space-y-2">
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

                        {isEditable && isProjectRequest && (
                            <div className="bg-white p-4 rounded-xl border border-cyan-100 shadow-sm space-y-2">
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

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
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
                        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm space-y-2">
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
                            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm space-y-2">
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
                        <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <div className="text-xs font-black text-slate-700">Thêm vật tư theo BOQ triển khai</div>
                                    <div className="text-[10px] font-bold text-slate-400">Warning tính theo định mức vật tư trong BOQ triển khai, gồm cả phiếu đang chờ duyệt.</div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                                <select
                                    value={draftWorkBoqItemId}
                                    onChange={event => {
                                        setDraftWorkBoqItemId(event.target.value);
                                        setDraftMaterialBudgetItemId('');
                                    }}
                                    className="md:col-span-4 px-3 py-2 rounded-xl border border-amber-100 bg-white text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"
                                >
                                    <option value="">Chọn đầu mục BOQ triển khai...</option>
                                    {workBoqItems.map(item => <option key={item.id} value={item.id}>{item.wbsCode ? `${item.wbsCode} - ` : ''}{item.name}</option>)}
                                </select>
                                <select
                                    value={draftMaterialBudgetItemId}
                                    onChange={event => setDraftMaterialBudgetItemId(event.target.value)}
                                    className="md:col-span-4 px-3 py-2 rounded-xl border border-amber-100 bg-white text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"
                                >
                                    <option value="">Chọn vật tư/định mức...</option>
                                    {budgetOptions.map(item => <option key={item.id} value={item.id}>{item.itemName} • Còn {Math.max(0, Number(item.budgetQty || 0) - getBudgetRequestedQty(item.id)).toLocaleString('vi-VN')} {item.unit}</option>)}
                                </select>
                                <input
                                    type="number"
                                    min={0}
                                    value={draftQty}
                                    onChange={event => setDraftQty(event.target.value)}
                                    placeholder="Số lượng"
                                    className="md:col-span-1 px-3 py-2 rounded-xl border border-amber-100 bg-white text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"
                                />
                                <input
                                    type="date"
                                    value={draftNeededDate}
                                    onChange={event => setDraftNeededDate(event.target.value)}
                                    className="md:col-span-2 px-3 py-2 rounded-xl border border-amber-100 bg-white text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"
                                />
                                <button onClick={handleAddBudgetLine} className="md:col-span-1 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600">
                                    Thêm
                                </button>
                                <input
                                    value={draftLineNote}
                                    onChange={event => setDraftLineNote(event.target.value)}
                                    placeholder="Ghi chú dòng..."
                                    className="md:col-span-12 px-3 py-2 rounded-xl border border-amber-100 bg-white text-xs outline-none focus:ring-2 focus:ring-amber-300"
                                />
                            </div>
                        </div>
                    )}

                    {/* Desktop table view */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden hidden md:block">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-4">Vật tư đề xuất</th>
                                    <th className="p-4 w-24 text-center">ĐVT</th>
                                    <th className="p-4 w-32 text-right">Số lượng Y/C</th>
                                    {!isEditable && (
                                        <>
                                            <th className="p-4 w-32 text-right text-blue-600 bg-blue-50/30">{stockContextWarehouseId ? 'Tồn kho' : 'Tổng tồn'}</th>
                                            <th className="p-4 w-32 text-right text-emerald-600 bg-emerald-50/30">Cam kết</th>
                                            <th className="p-4 w-28 text-right text-indigo-600 bg-indigo-50/30">Đã xuất</th>
                                            <th className="p-4 w-28 text-right text-cyan-600 bg-cyan-50/30">Đã nhận</th>
                                            <th className="p-4 w-28 text-right text-slate-500">Còn lại</th>
                                        </>
                                    )}
                                    {isEditable && <th className="p-4 w-12"></th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {(isEditable ? reqItems : (request?.items || [])).map((row, idx) => {
                                    const itemId = row.itemId;
                                    const requestQty = isEditable ? row.qty : row.requestQty;
                                    const itemInfo = getLineInventory(itemId);
                                    const stockSummary = getAggregateStockSummary(itemId, stockContextWarehouseId, request?.id);
                                    const sourceStock = stockSummary.available;
                                    const lineId = row.lineId;
                                    const requestLineId = request && !isEditable ? getRequestLineId(request, row as RequestItem, idx) : lineId;
                                    const lineFulfillment = requestLineId ? fulfillmentLineSummaryMap.get(requestLineId) : undefined;
                                    const approvedQty = approvedItems.find(ai => (lineId && ai.lineId === lineId) || (!lineId && ai.itemId === itemId))?.qty || 0;
                                    const issuedQty = lineFulfillment?.issuedQty || Number((row as RequestItem).issuedQty || 0);
                                    const receivedQty = lineFulfillment?.receivedQty || 0;
                                    const remainingToReceive = lineFulfillment?.remainingToReceive ?? Math.max(0, requestQty - receivedQty);
                                    const isExcess = !isEditable && approvedQty > requestQty;
                                    const budgetSnapshot = buildLineBudgetSnapshot(row as RequestLineDraft);
                                    const needsReason = isEditable && isProjectRequest && (!row.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0);

                                    return (
                                        <tr key={idx} className={`transition-colors ${isExcess ? 'bg-orange-50/50' : 'hover:bg-slate-50/50'}`}>
                                            <td className="p-4">
                                                <div>
                                                    <div className="font-bold text-slate-800">{getLineName(row)}</div>
                                                    <div className="text-[10px] font-mono text-slate-400">{getLineSku(row) || '—'}</div>
                                                    {row.specification && <div className="text-[10px] text-slate-400 mt-0.5">{row.specification}</div>}
                                                    {isProjectRequest && (
                                                        <div className="mt-1 space-y-1">
                                                            <div className="flex flex-wrap gap-1">
                                                                {(row.workBoqItemName || row.materialBudgetItemName) && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 text-[9px] font-bold">
                                                                        {row.workBoqItemName || 'BOQ'}{row.materialBudgetItemName ? ` • ${row.materialBudgetItemName}` : ''}
                                                                    </span>
                                                                )}
                                                                {!row.materialBudgetItemId && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 text-[9px] font-bold">Ngoài BOQ</span>}
                                                                {budgetSnapshot.overBudgetQty > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100 text-[9px] font-bold">Vượt {budgetSnapshot.overBudgetQty.toLocaleString('vi-VN')} {budgetSnapshot.budget?.unit || ''}</span>}
                                                            </div>
                                                            {needsReason && (
                                                                <input
                                                                    value={(row as RequestLineDraft).overBudgetReason || ''}
                                                                    onChange={event => handleUpdateItem(idx, 'overBudgetReason', event.target.value)}
                                                                    placeholder={!row.materialBudgetItemId ? 'Lý do ngoài BOQ/ngoài định mức...' : 'Lý do đề xuất vượt định mức...'}
                                                                    className="w-full px-2 py-1 rounded-lg border border-orange-200 text-[10px] outline-none focus:ring-1 focus:ring-orange-300"
                                                                />
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center text-slate-500 font-medium">{getLineUnit(row) || '-'}</td>
                                            <td className="p-4 text-right">
                                                {isEditable ? (
                                                    <input
                                                        type="number" min="1"
                                                        value={requestQty}
                                                        onChange={(e) => handleUpdateItem(idx, 'qty', e.target.value)}
                                                        className="w-20 text-right p-1 border border-slate-200 rounded font-bold"
                                                    />
                                                ) : (
                                                    <span className="font-bold text-slate-600">{requestQty}</span>
                                                )}
                                            </td>
                                            {!isEditable && (
                                                <>
                                                    <td className="p-4 text-right font-bold text-blue-600">
                                                        {sourceStock.toLocaleString()}
                                                        {stockSummary.reserved > 0 && (
                                                            <div className="text-[9px] text-amber-600 font-bold">Giữ chỗ: {stockSummary.reserved}</div>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        {canEditApprovalQuantities ? (
                                                            <div className="flex flex-col items-end">
                                                                <input
                                                                    type="number" min="0" max={!isProjectRequest && itemInfo ? sourceStock : undefined}
                                                                    value={approvedQty}
                                                                    onChange={(e) => handleUpdateApprovedItem(row as RequestItem, Number(e.target.value))}
                                                                    className={`w-20 text-right p-1 border rounded font-bold bg-white focus:ring-2 outline-none transition-colors ${isExcess ? 'border-orange-400 text-orange-700 focus:ring-orange-500' : 'border-emerald-200 text-emerald-700 focus:ring-emerald-500'}`}
                                                                />
                                                                {isExcess && <span className="text-[9px] text-orange-600 font-bold mt-1 uppercase">Duyệt vượt mức</span>}
                                                            </div>
                                                        ) : (
                                                            <span className={`font-bold ${isExcess ? 'text-orange-600 underline' : 'text-emerald-700'}`}>
                                                                {row.approvedQty || 0}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-right font-bold text-indigo-600">{issuedQty.toLocaleString('vi-VN')}</td>
                                                    <td className="p-4 text-right font-bold text-cyan-600">{receivedQty.toLocaleString('vi-VN')}</td>
                                                    <td className="p-4 text-right font-bold text-slate-500">{remainingToReceive.toLocaleString('vi-VN')}</td>
                                                </>
                                            )}
                                            {isEditable && (
                                                <td className="p-4 text-center">
                                                    <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {isEditable && (
                            <button onClick={handleAddItem} className="w-full py-4 text-accent font-bold hover:bg-slate-50 transition-colors border-t border-dashed border-slate-200 flex items-center justify-center">
                                <Plus size={16} className="mr-2" /> {isProjectRequest ? 'Thêm vật tư ngoài BOQ' : 'Thêm vật tư vào đề xuất'}
                            </button>
                        )}
                    </div>

                    {/* Mobile card view */}
                    <div className="md:hidden space-y-2">
                        {(isEditable ? reqItems : (request?.items || [])).map((row, idx) => {
                            const itemId = row.itemId;
                            const requestQty = isEditable ? row.qty : row.requestQty;
                            const itemInfo = getLineInventory(itemId);
                            const stockSummary = getAggregateStockSummary(itemId, stockContextWarehouseId, request?.id);
                            const sourceStock = stockSummary.available;
                            const lineId = row.lineId;
                            const requestLineId = request && !isEditable ? getRequestLineId(request, row as RequestItem, idx) : lineId;
                            const lineFulfillment = requestLineId ? fulfillmentLineSummaryMap.get(requestLineId) : undefined;
                            const approvedQty = approvedItems.find(ai => (lineId && ai.lineId === lineId) || (!lineId && ai.itemId === itemId))?.qty || 0;
                            const issuedQty = lineFulfillment?.issuedQty || Number((row as RequestItem).issuedQty || 0);
                            const receivedQty = lineFulfillment?.receivedQty || 0;
                            const remainingToReceive = lineFulfillment?.remainingToReceive ?? Math.max(0, requestQty - receivedQty);
                            const isExcess = !isEditable && approvedQty > requestQty;
                            const budgetSnapshot = buildLineBudgetSnapshot(row as RequestLineDraft);
                            const needsReason = isEditable && isProjectRequest && (!row.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0);

                            return (
                                <div key={idx} className={`bg-white rounded-xl p-3 border ${isExcess ? 'border-orange-200 bg-orange-50/50' : 'border-slate-200'} shadow-sm`}>
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-sm text-slate-800 truncate">{getLineName(row)}</div>
                                            <div className="text-[10px] font-mono text-slate-400">{getLineSku(row) || '—'} • {getLineUnit(row) || '-'}</div>
                                            {row.specification && <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{row.specification}</div>}
                                            {isProjectRequest && (row.workBoqItemName || row.materialBudgetItemName || !row.materialBudgetItemId || budgetSnapshot.overBudgetQty > 0) && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {(row.workBoqItemName || row.materialBudgetItemName) && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 text-[9px] font-bold">{row.workBoqItemName || 'BOQ'}{row.materialBudgetItemName ? ` • ${row.materialBudgetItemName}` : ''}</span>}
                                                    {!row.materialBudgetItemId && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 text-[9px] font-bold">Ngoài BOQ</span>}
                                                    {budgetSnapshot.overBudgetQty > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100 text-[9px] font-bold">Vượt {budgetSnapshot.overBudgetQty.toLocaleString('vi-VN')} {budgetSnapshot.budget?.unit || ''}</span>}
                                                </div>
                                            )}
                                        </div>
                                        {isEditable && (
                                            <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== idx))} className="p-1.5 text-red-400 hover:text-red-600 shrink-0">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {needsReason && (
                                        <input
                                            value={(row as RequestLineDraft).overBudgetReason || ''}
                                            onChange={event => handleUpdateItem(idx, 'overBudgetReason', event.target.value)}
                                            placeholder={!row.materialBudgetItemId ? 'Lý do ngoài BOQ/ngoài định mức...' : 'Lý do đề xuất vượt định mức...'}
                                            className="mt-2 w-full px-2 py-1.5 rounded-lg border border-orange-200 text-xs outline-none focus:ring-1 focus:ring-orange-300"
                                        />
                                    )}
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                            <div className="text-[9px] uppercase font-bold text-slate-400 mb-0.5">SL yêu cầu</div>
                                            {isEditable ? (
                                                <input
                                                    type="number" min="1"
                                                    value={requestQty}
                                                    onChange={(e) => handleUpdateItem(idx, 'qty', e.target.value)}
                                                    className="w-full text-center p-2 border border-slate-200 rounded-lg font-bold text-sm"
                                                />
                                            ) : (
                                                <div className="font-bold text-slate-700 text-sm">{requestQty}</div>
                                            )}
                                        </div>
                                        {!isEditable && (
                                            <>
                                                <div className="flex-1">
                                                    <div className="text-[9px] uppercase font-bold text-blue-400 mb-0.5">{stockContextWarehouseId ? 'Tồn kho' : 'Tổng tồn'}</div>
                                                    <div className="font-bold text-blue-600 text-sm">{sourceStock.toLocaleString()}</div>
                                                    {stockSummary.reserved > 0 && <div className="text-[9px] text-amber-600 font-bold">Giữ chỗ: {stockSummary.reserved}</div>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-[9px] uppercase font-bold text-emerald-400 mb-0.5">Duyệt</div>
                                                    {canEditApprovalQuantities ? (
                                                        <input
                                                            type="number" min="0" max={!isProjectRequest && itemInfo ? sourceStock : undefined}
                                                            value={approvedQty}
                                                            onChange={(e) => handleUpdateApprovedItem(row as RequestItem, Number(e.target.value))}
                                                            className={`w-full text-center p-2 border rounded-lg font-bold text-sm ${isExcess ? 'border-orange-400 text-orange-700' : 'border-emerald-200 text-emerald-700'}`}
                                                        />
                                                    ) : (
                                                        <div className={`font-bold text-sm ${isExcess ? 'text-orange-600' : 'text-emerald-700'}`}>
                                                            {row.approvedQty || 0}
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    {!isEditable && (
                                        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 border border-slate-100 p-2">
                                            <div>
                                                <div className="text-[9px] uppercase font-bold text-indigo-400">Đã xuất</div>
                                                <div className="text-xs font-black text-indigo-600">{issuedQty.toLocaleString('vi-VN')}</div>
                                            </div>
                                            <div>
                                                <div className="text-[9px] uppercase font-bold text-cyan-400">Đã nhận</div>
                                                <div className="text-xs font-black text-cyan-600">{receivedQty.toLocaleString('vi-VN')}</div>
                                            </div>
                                            <div>
                                                <div className="text-[9px] uppercase font-bold text-slate-400">Còn lại</div>
                                                <div className="text-xs font-black text-slate-600">{remainingToReceive.toLocaleString('vi-VN')}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {isEditable && (
                            <button onClick={handleAddItem} className="w-full py-3 text-accent font-bold rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center active:scale-95 transition-all">
                                <Plus size={16} className="mr-2" /> {isProjectRequest ? 'Thêm vật tư ngoài BOQ' : 'Thêm vật tư'}
                            </button>
                        )}
                    </div>

                    {!isEditable && request && isBatchFulfillmentRequest && (
                        <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-xs font-black text-slate-700">Lịch sử cấp hàng</div>
                                    <div className="text-[10px] font-bold text-slate-400">
                                        {fulfillmentSummary
                                            ? `Đã nhận ${fulfillmentSummary.receivedQty.toLocaleString('vi-VN')} / ${fulfillmentSummary.committedQty.toLocaleString('vi-VN')}`
                                            : 'Đang tải lũy kế cấp hàng'}
                                    </div>
                                </div>
                                {isLoadingFulfillment && <Loader2 size={14} className="text-slate-300 animate-spin" />}
                            </div>
                            {fulfillmentBatches.length === 0 ? (
                                <div className="p-4 text-xs font-bold text-slate-400">Chưa có đợt cấp hàng nào cho phiếu này.</div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {fulfillmentBatches.map(batch => (
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
                                            className="block w-full p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                                        >
                                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-mono text-xs font-black text-indigo-600">{batch.batchNo}</span>
                                                        <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black ${batch.status === 'received' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : batch.status === 'issued' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : batch.status === 'variance_pending' ? 'bg-amber-50 text-amber-700 border-amber-200' : batch.status === 'returned' ? 'bg-rose-50 text-rose-600 border-rose-200' : batch.status === 'cancelled' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                                            {batch.status === 'received' ? 'Đã nhận' : batch.status === 'issued' ? 'Đã xuất' : batch.status === 'variance_pending' ? 'Chờ chốt lệch' : batch.status === 'returned' ? 'Đã trả lại' : batch.status === 'cancelled' ? 'Đã huỷ' : 'Nháp'}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-slate-400">{new Date(batch.batchDate).toLocaleString('vi-VN')}</span>
                                                    </div>
                                                    <div className="mt-1 text-[10px] text-slate-400">
                                                        Nguồn: {getWarehouseName(batch.sourceWarehouseId)} • Đích: {batch.targetWarehouseId ? getWarehouseName(batch.targetWarehouseId) : 'Cấp thẳng sử dụng'}
                                                    </div>
                                                    {batch.note && <div className="mt-1 text-xs text-slate-500">{batch.note}</div>}
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mở chi tiết</span>
                                            </div>
                                            <div className="mt-3 overflow-x-auto">
                                                <table className="w-full text-[11px]">
                                                    <thead className="text-[9px] uppercase text-slate-400">
                                                        <tr>
                                                            <th className="py-1 text-left">Vật tư</th>
                                                            <th className="py-1 text-right">Xuất</th>
                                                            <th className="py-1 text-right">Nhận</th>
                                                            <th className="py-1 text-left pl-3">Lý do lệch</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {batch.lines.map(line => {
                                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                                            return (
                                                                <tr key={line.id} className="border-t border-slate-50">
                                                                    <td className="py-1.5 font-bold text-slate-600">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                                    <td className="py-1.5 text-right font-bold text-indigo-600">{Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                                                                    <td className="py-1.5 text-right font-bold text-cyan-600">{Number(line.receivedQty || 0).toLocaleString('vi-VN')}</td>
                                                                    <td className="py-1.5 pl-3 text-slate-400">{line.varianceReason || '-'}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center relative">
                    <div className="text-slate-400 text-[10px] uppercase font-black tracking-widest">
                        Security: {request?.id.slice(-6) || 'NEW-REQ'}
                    </div>

                    <div className="flex gap-3 items-center">
                        <button onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-white transition-colors">
                            Đóng
                        </button>

                        {canReturn && !isEditable && (
                            <button disabled={isSaving} onClick={handleReturnRequest} className="px-5 py-2 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 font-bold hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed flex items-center">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <AlertCircle size={18} className="mr-2" />} Trả lại
                            </button>
                        )}

                        {isEditable && (
                            <button disabled={isSaving} onClick={handleSubmitCreate} className="px-6 py-2 rounded-lg bg-accent text-white font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Send size={18} className="mr-2" />} {isSaving ? 'Đang gửi...' : 'Gửi đề xuất'}
                            </button>
                        )}

                        {isApproving && (
                            <button
                                disabled={isSaving}
                                onClick={() => setShowApprovalPanel(true)}
                                className="px-6 py-2 rounded-lg bg-accent text-white font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20 transition-all"
                            >
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <AlertCircle size={18} className="mr-2" />}
                                {isSaving ? 'ĐANG XỬ LÝ...' : 'XỬ LÝ ĐỀ XUẤT'}
                            </button>
                        )}

                        {canPrepareIssue && (
                            <button disabled={isSaving || !sourceWarehouseId} onClick={() => handleAction(RequestStatus.APPROVED)} className="px-6 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-blue-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Save size={18} className="mr-2" />} {isSaving ? 'Đang lưu...' : 'Lưu phân nguồn'}
                            </button>
                        )}

                        {canCreateFulfillmentBatch && (
                            <button disabled={isSaving || !(sourceWarehouseId || request?.sourceWarehouseId)} onClick={openIssuePanel} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-indigo-500/20">
                                <Truck size={18} className="mr-2" /> Tạo đợt cấp
                            </button>
                        )}

                        {canExport && (
                            <button disabled={isSaving} onClick={() => handleAction(RequestStatus.IN_TRANSIT)} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-indigo-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Truck size={18} className="mr-2" />} {isSaving ? 'Đang xử lý...' : 'Xác nhận xuất kho'}
                            </button>
                        )}

                        {canReceive && (
                            <button disabled={isSaving} onClick={() => handleAction(RequestStatus.COMPLETED)} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center shadow-lg shadow-emerald-500/20">
                                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin" /> : <CheckCircle size={18} className="mr-2" />} {isSaving ? 'Đang xử lý...' : fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION ? 'Xác nhận sử dụng' : 'Xác nhận nhận hàng'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {isIssuePanelOpen && request && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h4 className="text-base font-black text-slate-800">Tạo đợt cấp vật tư</h4>
                                <p className="text-xs font-bold text-slate-400">{request.code} • Kho nguồn: {getWarehouseName(sourceWarehouseId || request.sourceWarehouseId)}</p>
                            </div>
                            <button onClick={() => setIsIssuePanelOpen(false)} className="p-2 text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] uppercase font-black text-slate-400 block mb-1">Nguồn hàng</label>
                                    <select
                                        value={issueSourceType}
                                        onChange={event => setIssueSourceType(event.target.value as MaterialRequestFulfillmentSourceType)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"
                                    >
                                        <option value="stock">Tồn kho</option>
                                        <option value="po_receipt">Hàng đã nhập từ PO</option>
                                        <option value="mixed">Kết hợp</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-[10px] uppercase font-black text-slate-400 block mb-1">Ghi chú đợt cấp</label>
                                    <input
                                        value={issueNote}
                                        onChange={event => setIssueNote(event.target.value)}
                                        placeholder="VD: cấp đợt 1 theo tiến độ thi công..."
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
                                    />
                                </div>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
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
                                    <tbody className="divide-y divide-slate-100">
                                        {issueLines.map(line => {
                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                            const lineSummary = fulfillmentLineSummaryMap.get(line.requestLineId);
                                            const remaining = lineSummary?.remainingToIssue ?? (requestLine ? getCommittedQty(requestLine) : 0);
                                            const onHand = getOnHandStock(line.itemId, sourceWarehouseId || request.sourceWarehouseId || '');
                                            return (
                                                <tr key={line.requestLineId}>
                                                    <td className="p-3 font-bold text-slate-700">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                    <td className="p-3 text-right font-bold text-slate-500">{remaining.toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right font-bold text-blue-600">{onHand.toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={line.qty}
                                                            onChange={event => updateIssueLine(line.requestLineId, { qty: event.target.value })}
                                                            className="w-24 rounded-lg border border-indigo-200 px-2 py-1 text-right font-black text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-300"
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <input
                                                            value={line.reason}
                                                            onChange={event => updateIssueLine(line.requestLineId, { reason: event.target.value })}
                                                            placeholder="Bắt buộc nếu cấp lệch phần còn lại"
                                                            className="w-full rounded-lg border border-slate-200 px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-300"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setIsIssuePanelOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-bold">Huỷ</button>
                            <button disabled={isSaving} onClick={handleCreateFulfillmentBatch} className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-black hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />} Tạo đợt cấp
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedFulfillmentBatch && request && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chi tiết đợt cấp</div>
                                <h4 className="text-base font-black text-slate-800 mt-0.5">{selectedFulfillmentBatch.batchNo}</h4>
                                <p className="text-xs font-bold text-slate-400 mt-1">
                                    {request.code} • {new Date(selectedFulfillmentBatch.batchDate).toLocaleString('vi-VN')}
                                </p>
                            </div>
                            <button onClick={() => setSelectedFulfillmentBatch(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Trạng thái</div>
                                    <div className="mt-1 font-black text-slate-700">
                                        {selectedFulfillmentBatch.status === 'received' ? 'Đã nhận' : selectedFulfillmentBatch.status === 'issued' ? 'Đã xuất' : selectedFulfillmentBatch.status === 'variance_pending' ? 'Chờ chốt lệch' : selectedFulfillmentBatch.status === 'returned' ? 'Đã trả lại' : selectedFulfillmentBatch.status === 'cancelled' ? 'Đã huỷ' : 'Nháp'}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Nguồn</div>
                                    <div className="mt-1 font-black text-slate-700">{getWarehouseName(selectedFulfillmentBatch.sourceWarehouseId)}</div>
                                </div>
                                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                    <div className="text-[10px] uppercase font-black text-slate-400">Đích</div>
                                    <div className="mt-1 font-black text-slate-700">{selectedFulfillmentBatch.targetWarehouseId ? getWarehouseName(selectedFulfillmentBatch.targetWarehouseId) : 'Cấp thẳng sử dụng'}</div>
                                </div>
                            </div>
                            {selectedFulfillmentBatch.note && (
                                <div className="rounded-xl border border-slate-100 bg-white p-3 text-xs font-bold text-slate-500">
                                    {selectedFulfillmentBatch.note}
                                </div>
                            )}
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                                        <tr>
                                            <th className="p-3 text-left">Vật tư</th>
                                            <th className="p-3 text-right">Xuất</th>
                                            <th className="p-3 text-right">Thực nhận</th>
                                            <th className="p-3 text-left">Lý do lệch</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {selectedFulfillmentBatch.lines.map(line => {
                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                            return (
                                                <tr key={line.id}>
                                                    <td className="p-3 font-bold text-slate-700">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                    <td className="p-3 text-right font-black text-indigo-600">{Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right font-black text-cyan-600">{Number(line.receivedQty || 0).toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-slate-400">{line.varianceReason || '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setSelectedFulfillmentBatch(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-bold">Đóng</button>
                            <button
                                disabled={isSaving}
                                onClick={() => handlePrintFulfillmentBatch(selectedFulfillmentBatch)}
                                className="px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 font-black hover:bg-indigo-100 disabled:opacity-60 flex items-center gap-2"
                            >
                                <Truck size={16} /> In phiếu QR
                            </button>
                            {canReceiveFulfillmentBatch && selectedFulfillmentBatch.status === 'issued' && (
                                <>
                                    <button
                                        disabled={isSaving}
                                        onClick={() => openReceivePanel(selectedFulfillmentBatch)}
                                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
                                    >
                                        <CheckCircle size={16} /> Xác nhận nhận
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

            {receivingBatch && request && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h4 className="text-base font-black text-slate-800">Xác nhận nhận hàng</h4>
                                <p className="text-xs font-bold text-slate-400">{receivingBatch.batchNo} • {request.code}</p>
                            </div>
                            <button onClick={() => setReceivingBatch(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                                        <tr>
                                            <th className="p-3 text-left">Vật tư</th>
                                            <th className="p-3 text-right">Đã xuất</th>
                                            <th className="p-3 text-right">Thực nhận</th>
                                            <th className="p-3 text-left">Lý do lệch</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {receivingBatch.lines.map(line => {
                                            const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === line.requestLineId);
                                            const draft = receiveLines.find(item => item.lineId === line.id);
                                            return (
                                                <tr key={line.id}>
                                                    <td className="p-3 font-bold text-slate-700">{requestLine ? getLineName(requestLine) : line.itemId}</td>
                                                    <td className="p-3 text-right font-bold text-indigo-600">{Number(line.issuedQty || 0).toLocaleString('vi-VN')}</td>
                                                    <td className="p-3 text-right">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={draft?.qty || '0'}
                                                            onChange={event => updateReceiveLine(line.id, { qty: event.target.value })}
                                                            className="w-24 rounded-lg border border-emerald-200 px-2 py-1 text-right font-black text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-300"
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <input
                                                            value={draft?.reason || ''}
                                                            onChange={event => updateReceiveLine(line.id, { reason: event.target.value })}
                                                            placeholder="Bắt buộc nếu nhận lệch số xuất"
                                                            className="w-full rounded-lg border border-slate-200 px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-300"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setReceivingBatch(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-bold">Huỷ</button>
                            <button disabled={isSaving} onClick={handleReceiveFulfillmentBatch} className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2">
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} Xác nhận nhận
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
                filterWarehouseId={isProjectRequest ? stockPreviewWarehouseId : sourceWarehouseId}
                allowAllItems={isProjectRequest}
            />

            <ScannerModal
                isOpen={isScannerOpen}
                onClose={() => setScannerOpen(false)}
                onScan={(sku) => {
                    const item = items.find(i => i.sku === sku);
                    if (item) handleSelectFromModal(item);
                    setScannerOpen(false);
                }}
            />

            {submittingProjectRequest && (
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
                    onConfirm={target => submitCreatedRequest(submittingProjectRequest, target)}
                />
            )}
        </div>
    );
};

export default RequestModal;
