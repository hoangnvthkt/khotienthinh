import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    calculateLineTotal,
    getComputedDimension,
    formatSpecsSummary,
    formatPricingFormula,
    DEFAULT_SPEC_METADATA,
    SPEC_KEY_ORDER,
    SPEC_PRESETS,
    calculateArea,
    calculateVolume,
    getSpecNumeric,
    SpecValue,
    PricingMode
} from '../../lib/poSpecsUtils';
import {
    Plus, Edit2, Trash2, X, Save, Truck, Star, Phone, Mail, MapPin,
    FileText, CheckCircle2, Clock, Ban, Send, Package, ChevronDown,
    ChevronUp, Users, DollarSign, ShoppingCart, AlertTriangle, FileSpreadsheet,
    Upload, Printer, QrCode, Loader2, RefreshCcw, PackageX
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
    InventoryItem,
    MaterialBudgetItem,
    POStatus,
    BusinessPartner,
    ProjectVendor,
    ProjectWorkBoqItem,
    ProjectSubmissionTarget,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderRequestLineLink,
    PurchaseOrderSupplierReturn,
    PurchaseOrderSourceMode,
    MaterialPlanningDraftPo,
    MaterialRequest,
    MaterialRequestFulfillmentSummary,
    RequestStatus,
    Transaction,
    TransactionStatus,
    TransactionType,
} from '../../types';
import { boqService, vendorService, poService, workBoqService } from '../../lib/projectService';
import { materialRequestFulfillmentService, getRequestLineId } from '../../lib/materialRequestFulfillmentService';
import { partnerService } from '../../lib/partnerService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import { loadXlsx } from '../../lib/loadXlsx';
import { buildPoReceiveUrl, createPoQrToken } from '../../lib/poQr';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import ExcelImportReviewModal from '../../components/ExcelImportReviewModal';
import InventoryItemCombobox from '../../components/InventoryItemCombobox';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, parseExcelRows } from '../../lib/excelImport';
import ProjectSubmissionDialog from '../../components/project/ProjectSubmissionDialog';
import MaterialIssuePanel from '../../components/project/MaterialIssuePanel';
import { projectSubmissionService } from '../../lib/projectSubmissionService';
import SupplierCombobox from '../../components/SupplierCombobox';
import { useReservedStock } from '../../hooks/useReservedStock';
import { formatReservationSourceList } from '../../lib/inventoryStockGuard';
import { materialRequestService } from '../../lib/materialRequestService';
import { isAdmin, isGlobalWarehouseKeeper } from '../../lib/wmsPermissions';
import { purchaseOrderSupplierReturnService } from '../../lib/purchaseOrderSupplierReturnService';
import PurchaseOrderSupplierReturnDialog from '../../components/project/PurchaseOrderSupplierReturnDialog';
import {
    buildPoUnitSnapshot,
    getPoLinePurchaseUnit,
    getPoLineStockUnit,
    getPoLineStockUnitPrice,
    hasPurchaseUnitConversion,
    poLinePurchaseToStockQty,
    poLineStockToPurchaseQty,
    stockUnitPriceToPurchaseUnitPrice,
} from '../../lib/materialUnitConversion';

interface SupplyChainTabProps {
    constructionSiteId?: string;
    projectId?: string;
    canManageTab?: boolean;
    compact?: boolean;
    initialDraftPo?: MaterialPlanningDraftPo | null;
    initialDraftPoKey?: number;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const fmtQty = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });

const PO_STATUS: Record<POStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
    sent: { label: 'Đã gửi', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Send size={12} /> },
    confirmed: { label: 'Đã duyệt', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    in_transit: { label: 'Đang giao', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200', icon: <Truck size={12} /> },
    partial: { label: 'Giao 1 phần', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', icon: <Package size={12} /> },
    delivered: { label: 'Hoàn thành', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    closed: { label: 'Đã đóng', color: 'text-slate-700', bg: 'bg-slate-100 border-slate-300', icon: <FileText size={12} /> },
    returned: { label: 'Hoàn hàng', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', icon: <RefreshCcw size={12} /> },
    cancelled: { label: 'Huỷ', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
};

const VENDOR_CATS = ['Xi măng', 'Thép', 'Cát & Đá', 'Gạch', 'Gỗ', 'Sơn', 'Ống/Phụ kiện nước', 'Dây & TB điện', 'VLXD khác'];

const PO_SOURCE_MODE: Record<PurchaseOrderSourceMode, { label: string; color: string }> = {
    from_request: { label: 'Từ đề xuất', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    proactive_project: { label: 'Mua chủ động dự án', color: 'bg-blue-50 text-blue-700 border-blue-200' },
    proactive_stock: { label: 'Mua dự trữ kho tổng', color: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const ACTIVE_REQUEST_BUDGET_STATUSES = new Set<RequestStatus | string>([
    RequestStatus.PENDING,
    RequestStatus.APPROVED,
    RequestStatus.IN_TRANSIT,
    RequestStatus.COMPLETED,
    RequestStatus.LEGACY_PENDING,
    RequestStatus.LEGACY_APPROVED,
]);

const ACTIVE_PO_BUDGET_STATUSES = new Set<POStatus>(['draft', 'sent', 'confirmed', 'in_transit', 'partial', 'delivered']);
const OPEN_PO_ORDER_STATUSES = new Set<POStatus>(['draft', 'sent', 'confirmed', 'in_transit']);
type PurchaseOrderPrintTemplateKey = 'purchase_order' | 'approval_request';

const PO_PRINT_TEMPLATE_LABELS: Record<PurchaseOrderPrintTemplateKey, string> = {
    purchase_order: 'Đơn đặt hàng',
    approval_request: 'Đề nghị duyệt đơn hàng',
};

const createEmptyPoItem = (): PurchaseOrderItem => ({
    lineId: crypto.randomUUID(),
    itemId: '',
    vendorId: null,
    vendorName: null,
    sku: '',
    name: '',
    unit: '',
    unitSnapshot: '',
    stockUnitSnapshot: '',
    purchaseUnitSnapshot: '',
    purchaseConversionFactor: 1,
    qty: 0,
    unitPrice: 0,
    neededDate: '',
    note: '',
    specs: undefined,
    pricingMode: undefined,
    computedArea: undefined,
    computedWeight: undefined,
    computedLineTotal: undefined,
});

const normalizePoItem = (item: Partial<PurchaseOrderItem>, inventoryItems: InventoryItem[]): PurchaseOrderItem => {
    const matched = inventoryItems.find(inv =>
        inv.id === item.itemId ||
        (!!item.sku && inv.sku.toLowerCase() === item.sku.toLowerCase()) ||
        (!!item.name && inv.name.toLowerCase() === item.name.toLowerCase())
    );
    const stockUnitSnapshot = item.stockUnitSnapshot || item.unitSnapshot || matched?.unit || item.unit || '';
    const purchaseUnitSnapshot = item.purchaseUnitSnapshot || item.unit || matched?.purchaseUnit || matched?.unit || '';
    const purchaseConversionFactor = Number(item.purchaseConversionFactor ?? (
        stockUnitSnapshot && purchaseUnitSnapshot && stockUnitSnapshot.toLowerCase() !== purchaseUnitSnapshot.toLowerCase()
            ? matched?.purchaseConversionFactor
            : 1
    ) ?? 1) || 1;

    return {
        itemId: item.itemId || matched?.id || '',
        lineId: item.lineId || crypto.randomUUID(),
        vendorId: item.vendorId || null,
        vendorName: item.vendorName || null,
        sku: item.sku || matched?.sku || '',
        name: item.name || matched?.name || '',
        unit: purchaseUnitSnapshot || item.unit || matched?.unit || '',
        qty: Number(item.qty) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        receivedQty: Number(item.receivedQty) || 0,
        neededDate: item.neededDate || '',
        workBoqItemId: item.workBoqItemId || null,
        workBoqItemName: item.workBoqItemName || null,
        materialBudgetItemId: item.materialBudgetItemId || null,
        materialBudgetItemName: item.materialBudgetItemName || null,
        requestId: item.requestId || null,
        requestCode: item.requestCode || null,
        requestLineId: item.requestLineId || null,
        budgetQtySnapshot: Number(item.budgetQtySnapshot || 0),
        reservedBeforeQtySnapshot: Number(item.reservedBeforeQtySnapshot || 0),
        previousRequestedQtySnapshot: Number(item.previousRequestedQtySnapshot || 0),
        previousOrderedQtySnapshot: Number(item.previousOrderedQtySnapshot || 0),
        previousReceivedQtySnapshot: Number(item.previousReceivedQtySnapshot || 0),
        isOverBoq: Boolean(item.isOverBoq ?? Number(item.overQty ?? item.overBudgetQtySnapshot ?? 0) > 0),
        overQty: Number(item.overQty ?? item.overBudgetQtySnapshot ?? 0),
        overPercent: Number(item.overPercent ?? item.overBudgetPercentSnapshot ?? 0),
        overReason: item.overReason || item.overBudgetReason || '',
        overBudgetQtySnapshot: Number(item.overBudgetQtySnapshot || 0),
        overBudgetPercentSnapshot: Number(item.overBudgetPercentSnapshot || 0),
        overBudgetReason: item.overBudgetReason || '',
        isManualItem: item.isManualItem || (!matched && !!item.itemId?.startsWith('manual-')),
        itemNameSnapshot: item.itemNameSnapshot || item.name || matched?.name || '',
        unitSnapshot: stockUnitSnapshot,
        stockUnitSnapshot,
        purchaseUnitSnapshot,
        purchaseConversionFactor,
        specification: item.specification || '',
        manualReason: item.manualReason || '',
        note: item.note || '',
        specs: item.specs || undefined,
        pricingMode: item.pricingMode || undefined,
        computedArea: item.computedArea != null ? Number(item.computedArea) : undefined,
        computedWeight: item.computedWeight != null ? Number(item.computedWeight) : undefined,
        computedLineTotal: item.computedLineTotal != null ? Number(item.computedLineTotal) : undefined,
    };
};

const normalizePoImportDate = (value: string): string => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
        const [day, month, year] = text.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return text;
};

const getPoReceiptStats = (po: PurchaseOrder) => {
    const orderedQty = po.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    const receivedQty = po.items.reduce((sum, item) => sum + (Number(item.receivedQty) || 0), 0);
    return {
        orderedQty,
        receivedQty,
        remainingQty: Math.max(0, orderedQty - receivedQty),
    };
};

const SupplyChainTab: React.FC<SupplyChainTabProps> = ({ constructionSiteId, projectId, canManageTab = true, compact = false, initialDraftPo = null, initialDraftPoKey = 0 }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const { items: inventoryItems, warehouses, requests: materialRequests, constructionSites, loadModuleData, user, addTransaction, updateRequestStatus } = useApp();
    const { getStockSummary } = useReservedStock();
    const effectiveId = projectId || constructionSiteId || '';
    const [subTab] = useState<'vendor' | 'po'>('po');

    // Vendors
    const [vendors, setVendors] = useState<ProjectVendor[]>([]);
    const [partners, setPartners] = useState<BusinessPartner[]>([]);
    // POs
    const [pos, setPos] = useState<PurchaseOrder[]>([]);
    const [workBoqItems, setWorkBoqItems] = useState<ProjectWorkBoqItem[]>([]);
    const [materialBudgetItems, setMaterialBudgetItems] = useState<MaterialBudgetItem[]>([]);
    const [poRequestLinks, setPoRequestLinks] = useState<PurchaseOrderRequestLineLink[]>([]);
    const [requestFulfillmentSummaries, setRequestFulfillmentSummaries] = useState<Record<string, MaterialRequestFulfillmentSummary>>({});
    const [requestFulfillmentBatchCounts, setRequestFulfillmentBatchCounts] = useState<Record<string, number>>({});
    const [projectMaterialRequests, setProjectMaterialRequests] = useState<MaterialRequest[]>([]);
    const [supplierReturnsByPo, setSupplierReturnsByPo] = useState<Record<string, PurchaseOrderSupplierReturn[]>>({});
    const canRunRestrictedPoActions = isAdmin(user) || isGlobalWarehouseKeeper(user);

    const ensureCanManage = (action: string) => {
        if (canManageTab) return true;
        toast.warning('Không có quyền quản trị tab', `Bạn cần quyền quản trị "Cung ứng" để ${action}.`);
        return false;
    };

    const ensureCanRunRestrictedPoAction = (action: string) => {
        if (canRunRestrictedPoActions) return true;
        toast.warning('Không có quyền thao tác PO', `Chỉ Admin hoặc thủ kho tổng được ${action}.`);
        return false;
    };

    useEffect(() => {
        loadModuleData('wms-core');
    }, [loadModuleData]);

    useEffect(() => {
        let cancelled = false;
        if (!projectId) {
            setProjectMaterialRequests([]);
            return;
        }
        materialRequestService.listByProject(projectId)
            .then(rows => {
                if (!cancelled) setProjectMaterialRequests(rows);
            })
            .catch(error => {
                console.error('Failed to load project material requests for supply chain', error);
                if (!cancelled) setProjectMaterialRequests([]);
            });
        return () => { cancelled = true; };
    }, [projectId]);

    const loadSupplyData = async () => {
        if (!effectiveId) return;
        try {
            const [partnerRows, poRows, stockPoRows, linkRows] = await Promise.all([
                partnerService.list({ classification: 'supplier' }),
                poService.list(effectiveId, constructionSiteId || null),
                poService.listStockOrders().catch(() => [] as PurchaseOrder[]),
                poService.listRequestLineLinks(effectiveId, constructionSiteId || null).catch(() => [] as PurchaseOrderRequestLineLink[]),
            ]);
            setPartners(partnerRows);
            setVendors([]);
            const scopedStockRows = stockPoRows.filter(po => !po.projectId && !po.constructionSiteId);
            const byId = new Map<string, PurchaseOrder>();
            [...poRows, ...scopedStockRows].forEach(po => byId.set(po.id, po));
            const allPos = [...byId.values()];
            setPos(allPos);
            setPoRequestLinks(linkRows);

            const supplierReturnRows = await purchaseOrderSupplierReturnService
                .listByPurchaseOrderIds(allPos.map(po => po.id))
                .catch(error => {
                    console.error('Failed to load supplier returns', error);
                    return [] as PurchaseOrderSupplierReturn[];
                });
            setSupplierReturnsByPo(supplierReturnRows.reduce<Record<string, PurchaseOrderSupplierReturn[]>>((acc, item) => {
                acc[item.purchaseOrderId] = [...(acc[item.purchaseOrderId] || []), item];
                return acc;
            }, {}));
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        loadSupplyData();
    }, [effectiveId, constructionSiteId]);

    const [showVendorForm, setShowVendorForm] = useState(false);
    const [editingVendor, setEditingVendor] = useState<ProjectVendor | null>(null);
    const [showPoForm, setShowPoForm] = useState(false);
    const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);
    const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
    const [showRequestPicker, setShowRequestPicker] = useState(false);
    const [selectedRequestLineKeys, setSelectedRequestLineKeys] = useState<string[]>([]);
    const [supplierReturnPo, setSupplierReturnPo] = useState<PurchaseOrder | null>(null);

    // Vendor Form
    const [vName, setVName] = useState('');
    const [vContact, setVContact] = useState('');
    const [vPhone, setVPhone] = useState('');
    const [vEmail, setVEmail] = useState('');
    const [vAddress, setVAddress] = useState('');
    const [vTax, setVTax] = useState('');
    const [vRating, setVRating] = useState(3);
    const [vCats, setVCats] = useState<string[]>([]);
    const [vNotes, setVNotes] = useState('');

    // PO Form
    const [pVendorId, setPVendorId] = useState('');
    const [pNum, setPNum] = useState('');
    const [pTargetWarehouseId, setPTargetWarehouseId] = useState('');
    const [pSourceMode, setPSourceMode] = useState<PurchaseOrderSourceMode>('proactive_project');
    const [pDate, setPDate] = useState(new Date().toISOString().split('T')[0]);
    const [pExpDate, setPExpDate] = useState('');
    const [pItems, setPItems] = useState<PurchaseOrderItem[]>([createEmptyPoItem()]);
    const [pNote, setPNote] = useState('');
    const [importingPo, setImportingPo] = useState(false);
    const [poImportMode, setPoImportMode] = useState<ExcelImportMode>('create');
    const [poImportPreview, setPoImportPreview] = useState<ExcelImportPreview<PurchaseOrderItem> | null>(null);
    const [submittingPo, setSubmittingPo] = useState<PurchaseOrder | null>(null);
    const [printingPoId, setPrintingPoId] = useState<string | null>(null);
    const [poPrintMenuId, setPoPrintMenuId] = useState<string | null>(null);
    const [savingPo, setSavingPo] = useState(false);
    const [expandedSpecsIdx, setExpandedSpecsIdx] = useState<Set<number>>(new Set());
    const toggleSpecsPanel = useCallback((idx: number) => setExpandedSpecsIdx(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
    }), []);
    const poSubmitLockRef = useRef(false);
    const poImportModeRef = useRef<ExcelImportMode>('create');
    const poBoqMetaScopeRef = useRef<string | null>(null);
    const lastInitialDraftPoKeyRef = useRef<number>(0);
    const workBoqMap = useMemo(() => new Map(workBoqItems.map(item => [item.id, item])), [workBoqItems]);
    const materialBudgetMap = useMemo(() => new Map(materialBudgetItems.map(item => [item.id, item])), [materialBudgetItems]);
    const supplierById = useMemo(() => new Map(partners.map(partner => [partner.id, partner])), [partners]);
    const getSupplierPatch = (supplierId?: string | null): Pick<PurchaseOrderItem, 'vendorId' | 'vendorName'> => {
        const supplier = supplierId ? supplierById.get(supplierId) : undefined;
        return supplier ? { vendorId: supplier.id, vendorName: supplier.name } : { vendorId: null, vendorName: null };
    };
    const getDefaultSupplierPatchForInventory = (inventory?: InventoryItem): Pick<PurchaseOrderItem, 'vendorId' | 'vendorName'> => {
        if (inventory?.supplierId && supplierById.has(inventory.supplierId)) return getSupplierPatch(inventory.supplierId);
        if (pVendorId && supplierById.has(pVendorId)) return getSupplierPatch(pVendorId);
        return { vendorId: null, vendorName: null };
    };

    const loadPoBoqMetaData = React.useCallback(async () => {
        const currentRows = { workRows: workBoqItems, budgetRows: materialBudgetItems };
        if (!effectiveId) return currentRows;
        const scopeKey = `${effectiveId}:${constructionSiteId || ''}`;
        if (poBoqMetaScopeRef.current === scopeKey) return currentRows;
        poBoqMetaScopeRef.current = scopeKey;
        try {
            const [workRows, budgetRows] = await Promise.all([
                workBoqService.list(effectiveId, constructionSiteId || null),
                boqService.list(effectiveId, constructionSiteId || null),
            ]);
            setWorkBoqItems(workRows);
            setMaterialBudgetItems(budgetRows);
            return { workRows, budgetRows };
        } catch (error) {
            poBoqMetaScopeRef.current = null;
            throw error;
        }
    }, [constructionSiteId, effectiveId, materialBudgetItems, workBoqItems]);

    useEffect(() => {
        if (!initialDraftPo || !initialDraftPoKey || lastInitialDraftPoKeyRef.current === initialDraftPoKey) return;
        lastInitialDraftPoKeyRef.current = initialDraftPoKey;
        void loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata for planning draft:', error));
        const normalizedItems = initialDraftPo.items.length > 0
            ? initialDraftPo.items.map(item => normalizePoItem(item, inventoryItems))
            : [createEmptyPoItem()];
        const firstVendorId = normalizedItems.find(item => item.vendorId)?.vendorId || '';
        setEditingPo(null);
        setShowPoForm(true);
        setShowRequestPicker(false);
        setSelectedRequestLineKeys([]);
        setPVendorId(firstVendorId);
        setPNum(initialDraftPo.poNumber || `PO-${String(pos.length + 1).padStart(3, '0')}`);
        setPDate(new Date().toISOString().split('T')[0]);
        setPExpDate(initialDraftPo.expectedDeliveryDate || '');
        setPTargetWarehouseId(initialDraftPo.targetWarehouseId || '');
        setPSourceMode(initialDraftPo.sourceMode || 'proactive_project');
        setPItems(normalizedItems);
        setPNote(initialDraftPo.note || '');
    }, [initialDraftPo, initialDraftPoKey, inventoryItems, loadPoBoqMetaData, pos.length]);

    const openOrderedQtyByRequestLine = useMemo(() => {
        const map = new Map<string, number>();
        const poById = new Map(pos.map(po => [po.id, po]));
        poRequestLinks.forEach(link => {
            const po = poById.get(link.purchaseOrderId);
            if (!po || !OPEN_PO_ORDER_STATUSES.has(po.status)) return;
            const poLine = po.items.find(item => (item.lineId || item.itemId) === link.purchaseOrderLineId);
            const orderedQty = Number(poLine?.qty ?? link.orderedQty ?? 0);
            const receivedQty = Number(poLine?.receivedQty || 0);
            const openQty = Math.max(0, orderedQty - receivedQty);
            if (openQty <= 0) return;
            const inventory = inventoryItems.find(item => item.id === (poLine?.itemId || link.itemId));
            const openStockQty = poLine ? poLinePurchaseToStockQty(poLine, openQty, inventory) : openQty;
            const key = `${link.materialRequestId}:${link.requestLineId}`;
            map.set(key, (map.get(key) || 0) + openStockQty);
        });
        return map;
    }, [inventoryItems, poRequestLinks, pos]);
    const scopedMaterialRequests = useMemo(() => {
        if (!projectId) return [];
        const byId = new Map<string, MaterialRequest>();
        projectMaterialRequests.forEach(req => byId.set(req.id, req));
        materialRequests
            .filter(req => req.requestOrigin === 'project' && req.projectId === projectId)
            .forEach(req => byId.set(req.id, req));
        return [...byId.values()].sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
    }, [materialRequests, projectId, projectMaterialRequests]);
    useEffect(() => {
        let cancelled = false;
        const loadFulfillment = async () => {
            if (scopedMaterialRequests.length === 0) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
                return;
            }
            const batchesByRequest = await materialRequestFulfillmentService.listByRequests(scopedMaterialRequests.map(req => req.id));
            if (cancelled) return;
            setRequestFulfillmentSummaries(scopedMaterialRequests.reduce<Record<string, MaterialRequestFulfillmentSummary>>((acc, req) => {
                acc[req.id] = materialRequestFulfillmentService.summarizeRequest(req, batchesByRequest[req.id] || []);
                return acc;
            }, {}));
            setRequestFulfillmentBatchCounts(scopedMaterialRequests.reduce<Record<string, number>>((acc, req) => {
                acc[req.id] = (batchesByRequest[req.id] || []).length;
                return acc;
            }, {}));
        };
        loadFulfillment().catch(err => {
            console.warn('Failed to load material request fulfillment summaries for PO tab:', err);
            if (!cancelled) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
            }
        });
        return () => { cancelled = true; };
    }, [scopedMaterialRequests]);
    const scopedRequestLines = useMemo(() => {
        const allowedStatuses = new Set<RequestStatus | string>([
            RequestStatus.PENDING,
            RequestStatus.APPROVED,
            RequestStatus.IN_TRANSIT,
            RequestStatus.LEGACY_PENDING,
            RequestStatus.LEGACY_APPROVED,
        ]);
        return scopedMaterialRequests
            .filter(req => allowedStatuses.has(req.status))
            .filter(req => req.workflowStep !== 'completed')
            .flatMap(req => (req.items || []).map((line, index) => {
                const requestLineId = line.lineId || `${req.id}-${index}`;
                const requestedQty = Number(line.requestQty || 0);
                const fulfillmentLine = requestFulfillmentSummaries[req.id]?.lineSummaries.find(summary => summary.requestLineId === getRequestLineId(req, line, index));
                const hasFulfillmentBatches = (requestFulfillmentBatchCounts[req.id] || 0) > 0;
                const stockCoveredQty = hasFulfillmentBatches ? (fulfillmentLine?.receivedQty || 0) : Number(line.issuedQty || 0);
                const openOrderedQty = openOrderedQtyByRequestLine.get(`${req.id}:${requestLineId}`) || 0;
                const remainingQty = Math.max(0, requestedQty - stockCoveredQty - openOrderedQty);
                return {
                    key: `${req.id}:${requestLineId}`,
                    request: req,
                    line,
                    requestLineId,
                    requestedQty,
                    stockCoveredQty,
                    orderedQty: openOrderedQty,
                    remainingQty,
                };
            }))
            .filter(row => row.remainingQty > 0)
            .filter(row => !row.line.isManualItem && inventoryItems.some(item => item.id === row.line.itemId));
    }, [inventoryItems, openOrderedQtyByRequestLine, requestFulfillmentBatchCounts, requestFulfillmentSummaries, scopedMaterialRequests]);
    const requestedQtyByBudget = useMemo(() => {
        const map = new Map<string, number>();
        scopedMaterialRequests
            .filter(req => ACTIVE_REQUEST_BUDGET_STATUSES.has(req.status))
            .forEach(req => {
                (req.items || []).forEach(line => {
                    if (!line.materialBudgetItemId) return;
                    map.set(line.materialBudgetItemId, (map.get(line.materialBudgetItemId) || 0) + Number(line.requestQty || 0));
                });
            });
        return map;
    }, [scopedMaterialRequests]);
    const existingOrderedQtyByBudget = useMemo(() => {
        const map = new Map<string, number>();
        pos
            .filter(po => po.id !== editingPo?.id)
            .filter(po => ACTIVE_PO_BUDGET_STATUSES.has(po.status))
            .forEach(po => {
                (po.items || []).forEach(line => {
                    if (!line.materialBudgetItemId) return;
                    const inventory = inventoryItems.find(item => item.id === line.itemId);
                    const stockQty = poLinePurchaseToStockQty(line, Number(line.qty || 0), inventory);
                    map.set(line.materialBudgetItemId, (map.get(line.materialBudgetItemId) || 0) + stockQty);
                });
            });
        return map;
    }, [editingPo?.id, inventoryItems, pos]);
    const findInventoryForBudget = (budget?: MaterialBudgetItem) => {
        if (!budget) return undefined;
        return inventoryItems.find(item =>
            item.id === budget.inventoryItemId ||
            (!!budget.materialCode && item.sku.toLowerCase() === budget.materialCode.toLowerCase()) ||
            item.name.toLowerCase() === budget.itemName.toLowerCase()
        );
    };
    const getFormQtyByBudget = (budgetId: string, excludedLineId?: string) => {
        return pItems.reduce((sum, line) => {
            if (line.materialBudgetItemId !== budgetId || (excludedLineId && line.lineId === excludedLineId)) return sum;
            const normalizedLine = normalizePoItem(line, inventoryItems);
            const inventory = inventoryItems.find(item => item.id === normalizedLine.itemId);
            return sum + poLinePurchaseToStockQty(normalizedLine, Number(normalizedLine.qty || 0), inventory);
        }, 0);
    };
    const buildPoBudgetSnapshot = (line: PurchaseOrderItem): PurchaseOrderItem => {
        if (!line.materialBudgetItemId) return line;
        const budget = materialBudgetMap.get(line.materialBudgetItemId);
        if (!budget) return line;
        const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
        const previousRequested = requestedQtyByBudget.get(budget.id) || 0;
        const previousOrdered = existingOrderedQtyByBudget.get(budget.id) || 0;
        const currentOtherQty = getFormQtyByBudget(budget.id, line.lineId);
        const inventory = inventoryItems.find(item => item.id === line.itemId);
        const lineStockQty = poLinePurchaseToStockQty(line, Number(line.qty || 0), inventory);
        const totalCommitted = previousRequested + previousOrdered + currentOtherQty + lineStockQty;
        const reservedBeforeQty = previousRequested + previousOrdered + currentOtherQty;
        const budgetQty = Number(budget.budgetQty || 0);
        const overBeforeQty = Math.max(0, reservedBeforeQty - budgetQty);
        const overAfterQty = Math.max(0, totalCommitted - budgetQty);
        const overBudgetQty = Math.max(0, overAfterQty - overBeforeQty);
        const overBudgetPercent = budgetQty > 0 ? Math.round((overBudgetQty / budgetQty) * 1000) / 10 : 0;
        return {
            ...line,
            workBoqItemId: line.workBoqItemId || budget.workBoqItemId || null,
            workBoqItemName: line.workBoqItemName || work?.name || null,
            materialBudgetItemId: budget.id,
            materialBudgetItemName: line.materialBudgetItemName || budget.itemName,
            budgetQtySnapshot: Number(budget.budgetQty || 0),
            reservedBeforeQtySnapshot: reservedBeforeQty,
            previousRequestedQtySnapshot: previousRequested,
            previousOrderedQtySnapshot: previousOrdered,
            previousReceivedQtySnapshot: Number(budget.cumulativeImported || 0),
            isOverBoq: overBudgetQty > 0,
            overQty: overBudgetQty,
            overPercent: overBudgetPercent,
            overReason: line.overReason || line.overBudgetReason || '',
            overBudgetQtySnapshot: overBudgetQty,
            overBudgetPercentSnapshot: overBudgetPercent,
        };
    };

    // Vendor CRUD
    const resetVendorForm = () => {
        setEditingVendor(null); setShowVendorForm(false);
        setVName(''); setVContact(''); setVPhone(''); setVEmail('');
        setVAddress(''); setVTax(''); setVRating(3); setVCats([]); setVNotes('');
    };
    const openEditVendor = (v: ProjectVendor) => {
        if (!ensureCanManage('sửa nhà cung cấp')) return;
        setEditingVendor(v); setVName(v.name); setVContact(v.contact);
        setVPhone(v.phone); setVEmail(v.email || ''); setVAddress(v.address || '');
        setVTax(v.taxCode || ''); setVRating(v.rating); setVCats([...v.categories]);
        setVNotes(v.notes || ''); setShowVendorForm(true);
    };
    const handleSaveVendor = async () => {
        if (!ensureCanManage('lưu nhà cung cấp')) return;
        if (!vName || !vPhone) return;
        const vendorPosData = pos.filter(p => editingVendor ? p.vendorId === editingVendor.id : false);
        const v: ProjectVendor = {
            id: editingVendor?.id || crypto.randomUUID(), projectId: projectId || constructionSiteId || null, constructionSiteId: constructionSiteId || null,
            name: vName, contact: vContact, phone: vPhone, email: vEmail || undefined,
            address: vAddress || undefined, taxCode: vTax || undefined, rating: vRating,
            categories: vCats, totalOrders: vendorPosData.length,
            totalValue: vendorPosData.reduce((s, p) => s + p.totalAmount, 0),
            notes: vNotes || undefined, createdAt: editingVendor?.createdAt || new Date().toISOString(),
        };
        await vendorService.upsert(v);
        setVendors(await vendorService.list(effectiveId, constructionSiteId || null));
        toast.success(editingVendor ? 'Cập nhật NCC' : 'Thêm NCC thành công');
        resetVendorForm();
    };

    // PO CRUD
    const resetPoForm = () => {
        setEditingPo(null); setShowPoForm(false);
        setPVendorId(''); setPNum(''); setPDate(new Date().toISOString().split('T')[0]);
        setPSourceMode('proactive_project');
        setPTargetWarehouseId(''); setPExpDate(''); setPItems([createEmptyPoItem()]); setPNote('');
        setSelectedRequestLineKeys([]);
    };
    const openCreatePo = async () => {
        if (!ensureCanManage('tạo PO')) return;
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        resetPoForm();
        setPNum(`PO-${String(pos.length + 1).padStart(3, '0')}`);
        setShowPoForm(true);
    };

    const openRequestPicker = async () => {
        if (!ensureCanManage('tạo PO từ đề xuất')) return;
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        setShowRequestPicker(true);
    };

    const openEditPo = async (po: PurchaseOrder) => {
        if (!ensureCanManage('sửa đơn hàng')) return;
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        const normalizedItems = po.items.map(i => normalizePoItem({
            ...i,
            vendorId: i.vendorId || po.vendorId,
            vendorName: i.vendorName || po.vendorName,
        }, inventoryItems));
        setEditingPo(po); setPVendorId(po.vendorId); setPNum(po.poNumber);
        setPTargetWarehouseId(po.targetWarehouseId || '');
        setPSourceMode(normalizedItems.some(item => item.requestId) ? 'from_request' : (po.sourceMode || 'proactive_project'));
        setPDate(po.orderDate); setPExpDate(po.expectedDeliveryDate || '');
        setPItems(normalizedItems);
        setPNote(po.note || ''); setShowPoForm(true);
    };

    const openPoFromSelectedRequests = async () => {
        if (!ensureCanManage('tạo PO từ đề xuất')) return;
        const { workRows, budgetRows } = await loadPoBoqMetaData().catch(error => {
            console.warn('Failed to load PO BOQ metadata:', error);
            return { workRows: workBoqItems, budgetRows: materialBudgetItems };
        });
        const budgetLookup = new Map(budgetRows.map(item => [item.id, item]));
        const workLookup = new Map(workRows.map(item => [item.id, item]));
        const selectedRows = scopedRequestLines.filter(row => selectedRequestLineKeys.includes(row.key));
        if (selectedRows.length === 0) {
            toast.warning('Chưa chọn dòng đề xuất', 'Vui lòng chọn ít nhất một dòng vật tư từ đề xuất công trường.');
            return;
        }
        const uncodedRow = selectedRows.find(row => row.line.isManualItem || !inventoryItems.some(item => item.id === row.line.itemId));
        if (uncodedRow) {
            toast.warning('Dòng chưa có mã kho', `${uncodedRow.line.itemNameSnapshot || uncodedRow.line.materialBudgetItemName || uncodedRow.line.itemId} cần được cấp mã vật tư trước khi tạo PO.`);
            return;
        }
        const rows = selectedRows.map(row => {
            const inventory = inventoryItems.find(item => item.id === row.line.itemId);
            const remainingQty = row.remainingQty;
            const budget = row.line.materialBudgetItemId ? budgetLookup.get(row.line.materialBudgetItemId) : undefined;
            const work = row.line.workBoqItemId ? workLookup.get(row.line.workBoqItemId) : undefined;
            const supplierPatch = getDefaultSupplierPatchForInventory(inventory);
            return normalizePoItem({
                lineId: crypto.randomUUID(),
                itemId: row.line.itemId,
                ...supplierPatch,
                ...buildPoUnitSnapshot(inventory),
                sku: inventory?.sku || row.line.skuSnapshot || '',
                name: inventory?.name || row.line.itemNameSnapshot || row.line.materialBudgetItemName || '',
                qty: poLineStockToPurchaseQty({
                    ...createEmptyPoItem(),
                    itemId: row.line.itemId,
                    ...buildPoUnitSnapshot(inventory),
                }, remainingQty, inventory),
                unitPrice: stockUnitPriceToPurchaseUnitPrice(
                    Number(inventory?.priceIn || budget?.budgetUnitPrice || 0),
                    inventory,
                ),
                receivedQty: 0,
                neededDate: row.line.neededDate || '',
                workBoqItemId: row.line.workBoqItemId || null,
                workBoqItemName: row.line.workBoqItemName || work?.name || null,
                materialBudgetItemId: row.line.materialBudgetItemId || null,
                materialBudgetItemName: row.line.materialBudgetItemName || budget?.itemName || null,
                requestId: row.request.id,
                requestCode: row.request.code,
                requestLineId: row.requestLineId,
                budgetQtySnapshot: row.line.budgetQtySnapshot,
                reservedBeforeQtySnapshot: row.line.reservedBeforeQtySnapshot,
                previousRequestedQtySnapshot: row.line.previousRequestedQtySnapshot,
                isOverBoq: row.line.isOverBoq,
                overQty: row.line.overQty,
                overPercent: row.line.overPercent,
                overReason: row.line.overReason || row.line.overBudgetReason,
                overBudgetQtySnapshot: row.line.overBudgetQtySnapshot,
                overBudgetPercentSnapshot: row.line.overBudgetPercentSnapshot,
                overBudgetReason: row.line.overBudgetReason,
                isManualItem: false,
                itemNameSnapshot: inventory?.name || row.line.itemNameSnapshot,
                unitSnapshot: inventory?.unit || row.line.unitSnapshot,
                stockUnitSnapshot: inventory?.unit || row.line.unitSnapshot,
                purchaseUnitSnapshot: inventory?.purchaseUnit || inventory?.unit || row.line.unitSnapshot || budget?.unit || '',
                purchaseConversionFactor: Number(inventory?.purchaseConversionFactor || 1),
                specification: row.line.specification,
                manualReason: '',
                note: row.line.note || `Từ đề xuất ${row.request.code}`,
            }, inventoryItems);
        });
        setEditingPo(null);
        setPSourceMode('from_request');
        setPNum(`PO-${String(pos.length + 1).padStart(3, '0')}`);
        setPDate(new Date().toISOString().split('T')[0]);
        setPItems(rows);
        setPNote(`Gom từ ${new Set(selectedRows.map(row => row.request.code)).size} đề xuất công trường`);
        setShowRequestPicker(false);
        setShowPoForm(true);
    };
    const handleSavePo = async () => {
        if (!ensureCanManage('lưu đơn hàng')) return;
        if (poSubmitLockRef.current) return;
        if (!pNum || !pTargetWarehouseId) {
            toast.warning('Thiếu thông tin PO', 'Vui lòng nhập số PO/nhóm mua hàng và kho nhận.');
            return;
        }
        const preparedItems = pItems
            .map(i => normalizePoItem(i, inventoryItems))
            .map(i => pSourceMode === 'proactive_stock' ? {
                ...i,
                workBoqItemId: null,
                workBoqItemName: null,
                materialBudgetItemId: null,
                materialBudgetItemName: null,
                requestId: null,
                requestCode: null,
                requestLineId: null,
                budgetQtySnapshot: 0,
                reservedBeforeQtySnapshot: 0,
                previousRequestedQtySnapshot: 0,
                previousOrderedQtySnapshot: 0,
                previousReceivedQtySnapshot: 0,
                isOverBoq: false,
                overQty: 0,
                overPercent: 0,
                overReason: '',
                overBudgetQtySnapshot: 0,
                overBudgetPercentSnapshot: 0,
                overBudgetReason: '',
            } : buildPoBudgetSnapshot(i))
            .map(i => {
                const supplierPatch = i.vendorId ? getSupplierPatch(i.vendorId) : getSupplierPatch(pVendorId);
                return { ...i, ...supplierPatch };
            })
            .filter(i => i.qty > 0);
        const uncodedItem = preparedItems.find(i => i.isManualItem || !inventoryItems.some(item => item.id === i.itemId));
        if (uncodedItem) {
            toast.warning('PO chỉ nhận mã vật tư có trong hệ thống', `${uncodedItem.name || uncodedItem.itemNameSnapshot || uncodedItem.itemId || 'Dòng vật tư'} chưa có mã kho. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước.`);
            return;
        }
        const validItems = preparedItems.filter(i => i.itemId && i.qty > 0 && i.sku && i.name);
        if (validItems.length === 0) {
            toast.warning('Chưa có vật tư', 'Vui lòng chọn ít nhất một dòng vật tư có mã trong hệ thống và khối lượng đặt.');
            return;
        }
        const missingVendor = validItems.find(line => !line.vendorId || !supplierById.has(line.vendorId));
        if (missingVendor) {
            toast.warning('Thiếu nhà cung cấp', `${missingVendor.sku || missingVendor.name} chưa chọn NCC. Mỗi dòng vật tư cần có NCC để tách PO.`);
            return;
        }
        const duplicatedSku = validItems.find((line, index) => {
            const key = `${line.vendorId || ''}|${line.itemId}|${line.materialBudgetItemId || ''}|${line.requestLineId || ''}`;
            return validItems.some((other, otherIndex) =>
                otherIndex !== index &&
                `${other.vendorId || ''}|${other.itemId}|${other.materialBudgetItemId || ''}|${other.requestLineId || ''}` === key
            );
        });
        if (duplicatedSku) {
            toast.warning('Vật tư bị trùng', `SKU ${duplicatedSku.sku} đang xuất hiện nhiều dòng cùng NCC và cùng nguồn BOQ/đề xuất trong PO.`);
            return;
        }
        const invalidReceivedQty = validItems.find(line => (Number(line.receivedQty) || 0) > (Number(line.qty) || 0));
        if (invalidReceivedQty) {
            toast.warning('Khối lượng đặt không hợp lệ', `SKU ${invalidReceivedQty.sku} có số đã nhận lớn hơn khối lượng đặt.`);
            return;
        }
        const missingOverBudgetReason = validItems.find(line =>
            pSourceMode !== 'proactive_stock' &&
            line.materialBudgetItemId &&
            Number(line.overQty ?? line.overBudgetQtySnapshot ?? 0) > 0 &&
            !(line.overReason || line.overBudgetReason)?.trim()
        );
        if (missingOverBudgetReason) {
            const missingOverQty = Number(missingOverBudgetReason.overQty ?? missingOverBudgetReason.overBudgetQtySnapshot ?? 0);
            const missingInventory = inventoryItems.find(item => item.id === missingOverBudgetReason.itemId);
            const missingStockUnit = getPoLineStockUnit(missingOverBudgetReason, missingInventory);
            toast.warning(
                'Cần nhập lý do vượt ngân sách',
                `${missingOverBudgetReason.materialBudgetItemName || missingOverBudgetReason.name} vượt ${missingOverQty.toLocaleString('vi-VN')} ${missingStockUnit || missingOverBudgetReason.unit || ''}.`
            );
            return;
        }
        const totalAmount = validItems.reduce((s, i) => s + calculateLineTotal(i), 0);
        const scopedProjectId = pSourceMode === 'proactive_stock' ? null : projectId || constructionSiteId || null;
        const scopedSiteId = pSourceMode === 'proactive_stock' ? null : constructionSiteId || null;
        const groups = validItems.reduce<Map<string, PurchaseOrderItem[]>>((map, item) => {
            const key = item.vendorId!;
            map.set(key, [...(map.get(key) || []), item]);
            return map;
        }, new Map());
        const groupEntries = Array.from(groups.entries());
        const buildLinks = (po: PurchaseOrder, items: PurchaseOrderItem[]): PurchaseOrderRequestLineLink[] => items
            .filter(item => item.requestId && item.requestLineId && item.lineId)
            .map(item => {
                const sourceRequest = scopedMaterialRequests.find(req => req.id === item.requestId);
                const sourceLine = sourceRequest?.items.find((line, index) => (line.lineId || `${sourceRequest.id}-${index}`) === item.requestLineId);
                const inventory = inventoryItems.find(inv => inv.id === item.itemId);
                const orderedStockQty = poLinePurchaseToStockQty(item, Number(item.qty || 0), inventory);
                return {
                    projectId: projectId || null,
                    constructionSiteId: constructionSiteId || null,
                    purchaseOrderId: po.id,
                    purchaseOrderLineId: item.lineId!,
                    materialRequestId: item.requestId!,
                    materialRequestCode: item.requestCode || null,
                    requestLineId: item.requestLineId!,
                    itemId: item.itemId,
                    workBoqItemId: item.workBoqItemId || null,
                    materialBudgetItemId: item.materialBudgetItemId || null,
                    requestedQty: Number(sourceLine?.requestQty || orderedStockQty || 0),
                    orderedQty: orderedStockQty,
                    unit: getPoLineStockUnit(item, inventory) || null,
                    note: item.note || null,
                };
            });

        if (editingPo && groupEntries.length > 1) {
            toast.warning('PO đang sửa chỉ được có một NCC', 'Nếu cần tách nhiều NCC, hãy tạo nhóm mua hàng mới từ form tạo PO.');
            return;
        }

        try {
            if (!editingPo) {
                const ok = await confirm({
                    title: groupEntries.length > 1 ? 'Xác nhận tách PO theo NCC' : 'Xác nhận tạo PO',
                    targetName: pNum,
                    confirmText: groupEntries.length > 1 ? 'Bạn có chắc chắn muốn tạo các PO theo từng NCC' : 'Bạn có chắc chắn muốn tạo đơn hàng PO',
                    subtitle: `${validItems.length} dòng vật tư • ${groupEntries.length} NCC • Tổng ${fmt(totalAmount)} đ`,
                    warningText: groupEntries.length > 1
                        ? 'Mỗi NCC sẽ có một PO riêng, một mã QR riêng và cùng chung mã nhóm mua hàng.'
                        : 'PO sẽ được lưu vào hệ thống và dùng để in QR nhận hàng từ nhà cung cấp.',
                    intent: 'success',
                    actionLabel: 'Xác nhận tạo',
                    cancelLabel: 'Kiểm tra lại',
                    countdownSeconds: 1,
                });
                if (!ok) return;
            }
            poSubmitLockRef.current = true;
            setSavingPo(true);

            if (editingPo) {
                const [vendorId, items] = groupEntries[0];
                const vendor = supplierById.get(vendorId)!;
                const groupItems = items.map(item => ({ ...item, vendorId, vendorName: vendor.name }));
                const poItem: PurchaseOrder = {
                    ...editingPo,
                    vendorId,
                    vendorName: vendor.name,
                    poNumber: pNum,
                    items: groupItems,
                    totalAmount: groupItems.reduce((s, i) => s + calculateLineTotal(i), 0),
                    orderDate: pDate,
                    expectedDeliveryDate: pExpDate || undefined,
                    targetWarehouseId: pTargetWarehouseId,
                    qrToken: editingPo.qrToken || createPoQrToken(),
                    sourceMode: pSourceMode,
                    projectId: scopedProjectId,
                    constructionSiteId: scopedSiteId,
                    procurementGroupId: editingPo.procurementGroupId || null,
                    procurementGroupNo: editingPo.procurementGroupNo || null,
                    note: pNote || undefined,
                };
                await poService.upsert(poItem);
                await poService.replaceRequestLineLinks(poItem.id, buildLinks(poItem, groupItems));
            } else {
                const procurementGroupId = crypto.randomUUID();
                const procurementGroupNo = pNum;
                for (const [index, [vendorId, items]] of groupEntries.entries()) {
                    const vendor = supplierById.get(vendorId)!;
                    const groupItems = items.map(item => ({ ...item, vendorId, vendorName: vendor.name }));
                    const poItem: PurchaseOrder = {
                        id: crypto.randomUUID(),
                        projectId: scopedProjectId,
                        constructionSiteId: scopedSiteId,
                        vendorId,
                        vendorName: vendor.name,
                        poNumber: groupEntries.length === 1 ? pNum : `${pNum}-${String(index + 1).padStart(2, '0')}`,
                        procurementGroupId,
                        procurementGroupNo,
                        items: groupItems,
                        totalAmount: groupItems.reduce((s, i) => s + calculateLineTotal(i), 0),
                        orderDate: pDate,
                        expectedDeliveryDate: pExpDate || undefined,
                        status: 'draft',
                        sourceMode: pSourceMode,
                        targetWarehouseId: pTargetWarehouseId,
                        qrToken: createPoQrToken(),
                        receivedTransactionIds: [],
                        note: pNote || undefined,
                        createdAt: new Date().toISOString(),
                    };
                    await poService.upsert(poItem);
                    await poService.replaceRequestLineLinks(poItem.id, buildLinks(poItem, groupItems));
                }
            }
            await loadSupplyData();
            toast.success(editingPo ? 'Cập nhật PO' : groupEntries.length > 1 ? `Đã tạo ${groupEntries.length} PO theo NCC` : 'Tạo đơn hàng thành công');
            resetPoForm();
        } catch (e: any) {
            logApiError('supplyChain.savePo', e);
            toast.error('Không thể lưu PO', getApiErrorMessage(e, 'Không thể lưu đơn hàng lên Supabase.'));
        } finally {
            poSubmitLockRef.current = false;
            setSavingPo(false);
        }
    };

    const updatePoStatus = async (id: string, status: POStatus, submissionTarget?: ProjectSubmissionTarget) => {
        const isRestrictedPoAction = status === 'returned' || status === 'cancelled';
        if (isRestrictedPoAction) {
            if (!ensureCanRunRestrictedPoAction(status === 'returned' ? 'trả hàng/hoàn hàng PO' : 'huỷ PO')) return;
        } else if (!ensureCanManage('cập nhật trạng thái PO')) {
            return;
        }
        const po = pos.find(p => p.id === id);
        if (!po) return;
        if (status === 'sent' && !submissionTarget) {
            setSubmittingPo(po);
            return;
        }
        if (status === 'draft') {
            const receivedQty = po.items.reduce((sum, item) => sum + (Number(item.receivedQty) || 0), 0);
            if (receivedQty > 0 || (po.receivedTransactionIds || []).length > 0) {
                toast.warning('Không thể huỷ duyệt', 'PO đã phát sinh nhập kho nên không thể trả về nháp.');
                return;
            }
            const ok = await confirm({
                targetName: po.poNumber,
                title: 'Huỷ duyệt PO',
                confirmText: 'Đưa về nháp',
                warningText: 'PO sẽ trở về trạng thái nháp để chỉnh sửa và gửi duyệt lại khi cần.',
            });
            if (!ok) return;
        }
        if (status === 'returned') {
            if (!['in_transit', 'closed'].includes(po.status)) {
                toast.warning('Không thể hoàn hàng', 'Chỉ PO đang giao hoặc đã đóng mới được đánh dấu trả lại/hoàn hàng.');
                return;
            }
            const receivedQty = po.items.reduce((sum, item) => sum + (Number(item.receivedQty) || 0), 0);
            if (po.status === 'in_transit' && (receivedQty > 0 || (po.receivedTransactionIds || []).length > 0)) {
                toast.warning('Không thể hoàn hàng', 'PO đã phát sinh nhập kho. Vui lòng hoàn hàng từ trạng thái Đã đóng để hệ thống trừ tồn kho.');
                return;
            }
            if (po.status === 'closed') {
                if (!po.targetWarehouseId) {
                    toast.warning('Thiếu kho nhận', 'PO chưa có kho nhận nên không thể tạo phiếu hoàn hàng.');
                    return;
                }
                if (receivedQty <= 0) {
                    toast.warning('Không có số lượng hoàn', 'PO đã đóng nhưng chưa có số lượng đã nhận để hoàn hàng.');
                    return;
                }
                const invalidReturnLine = po.items.map(item => ({
                    ...item,
                    returnQty: Number(item.receivedQty || 0),
                    returnStockQty: poLinePurchaseToStockQty(item, Number(item.receivedQty || 0), inventoryItems.find(inv => inv.id === item.itemId)),
                    summary: getStockSummary(item.itemId, po.targetWarehouseId!),
                })).find(item => {
                    const qty = Number(item.returnStockQty || 0);
                    if (qty <= 0) return false;
                    return item.summary.available < qty;
                });
                if (invalidReturnLine) {
                    const needQty = Number(invalidReturnLine.returnStockQty || 0);
                    const returnInventory = inventoryItems.find(inv => inv.id === invalidReturnLine.itemId);
                    const returnStockUnit = getPoLineStockUnit(invalidReturnLine, returnInventory);
                    const reason = needQty > invalidReturnLine.summary.onHand
                        ? `tồn thực ${invalidReturnLine.summary.onHand.toLocaleString('vi-VN')}`
                        : `tồn thực ${invalidReturnLine.summary.onHand.toLocaleString('vi-VN')}, đang giữ ${invalidReturnLine.summary.reserved.toLocaleString('vi-VN')}, khả dụng ${invalidReturnLine.summary.available.toLocaleString('vi-VN')}`;
                    const blockers = formatReservationSourceList(invalidReturnLine.summary.entries);
                    toast.warning('Không đủ tồn để hoàn', `${invalidReturnLine.sku || invalidReturnLine.name} tại kho nhận cần hoàn ${needQty.toLocaleString('vi-VN')} ${returnStockUnit || ''}; ${reason}.${blockers ? ` Vị trí giữ chỗ: ${blockers}.` : ''} Vui lòng xử lý phiếu pending/giữ chỗ trước khi hoàn PO.`);
                    return;
                }
            }
            const ok = await confirm({
                targetName: po.poNumber,
                title: 'Trả lại / hoàn hàng PO',
                confirmText: 'Xác nhận hoàn hàng',
                warningText: po.status === 'closed'
                    ? 'Hệ thống sẽ tạo phiếu xuất kho hoàn NCC từ kho nhận, sau đó chuyển PO sang trạng thái Hoàn hàng.'
                    : 'PO sẽ chuyển sang trạng thái Hoàn hàng và không còn tính vào đơn đang giao.',
            });
            if (!ok) return;
        }
        if (status === 'delivered' && po.status === 'partial') {
            const receiptStats = getPoReceiptStats(po);
            if (receiptStats.receivedQty <= 0) {
                toast.warning('Chưa có hàng đã nhận', 'PO chưa phát sinh số lượng nhận nên không thể kết thúc thiếu.');
                return;
            }
            if (receiptStats.remainingQty > 0) {
                const ok = await confirm({
                    targetName: po.poNumber,
                    title: 'Xác nhận kết thúc đơn hàng',
                    confirmText: 'Kết thúc đơn hàng',
                    warningText: `PO đã nhận ${receiptStats.receivedQty.toLocaleString('vi-VN')}/${receiptStats.orderedQty.toLocaleString('vi-VN')}. Phần thiếu ${receiptStats.remainingQty.toLocaleString('vi-VN')} sẽ không còn chờ nhận từ PO này; nếu công trường vẫn cần, hãy tạo PO lần tiếp theo từ đề xuất.`,
                    intent: 'warning',
                    countdownSeconds: 0,
                });
                if (!ok) return;
            }
        }
        const statusPatch =
            status === 'draft'
                ? {
                    submittedToUserId: null,
                    submittedToName: null,
                    submittedToPermission: null,
                    submissionNote: null,
                }
                : status === 'sent'
                    ? projectSubmissionService.targetToUpdate(submissionTarget)
                    : {};
        const updated = {
            status,
            ...statusPatch,
            ...projectSubmissionService.actionMeta(user?.id, status !== 'draft'),
            actualDeliveryDate: status === 'delivered' ? new Date().toISOString().split('T')[0] : po.actualDeliveryDate,
            deliveryNote: status === 'delivered' && po.status === 'partial'
                ? [
                    po.deliveryNote,
                    `Kết thúc PO sau khi nhận ${getPoReceiptStats(po).receivedQty.toLocaleString('vi-VN')}/${getPoReceiptStats(po).orderedQty.toLocaleString('vi-VN')}; phần thiếu được xử lý bằng PO bổ sung nếu cần.`,
                ].filter(Boolean).join(' | ')
                : po.deliveryNote,
        };
        try {
            if (status === 'returned' && po.status === 'closed') {
                const txId = `tx-po-return-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const transaction: Transaction = {
                    id: txId,
                    type: TransactionType.EXPORT,
                    date: new Date().toISOString(),
                    items: po.items
                        .filter(item => Number(item.receivedQty || 0) > 0)
                        .map(item => {
                            const inventory = inventoryItems.find(inv => inv.id === item.itemId);
                            const stockQty = poLinePurchaseToStockQty(item, Number(item.receivedQty || 0), inventory);
                            const purchaseUnit = getPoLinePurchaseUnit(item, inventory);
                            const hasConversion = hasPurchaseUnitConversion({
                                unit: getPoLineStockUnit(item, inventory),
                                purchaseUnit,
                                purchaseConversionFactor: item.purchaseConversionFactor ?? inventory?.purchaseConversionFactor ?? 1,
                            });
                            return {
                                itemId: item.itemId,
                                quantity: stockQty,
                                price: getPoLineStockUnitPrice(item, inventory),
                                ...(hasConversion ? {
                                    accountingQty: Number(item.receivedQty || 0),
                                    accountingUnit: purchaseUnit,
                                    accountingPrice: Number(item.unitPrice || 0),
                                } : {}),
                            };
                        }),
                    sourceWarehouseId: po.targetWarehouseId,
                    requesterId: user.id,
                    approverId: user.id,
                    status: TransactionStatus.COMPLETED,
                    note: `Hoàn hàng NCC theo PO ${po.poNumber}${po.vendorName ? ` - ${po.vendorName}` : ''}`,
                };
                await addTransaction(transaction);
            }
            await poService.updateStatus(id, updated);
            if (status === 'in_transit') {
                const deliveryPo = { ...po, ...updated, status } as PurchaseOrder;
                const affectedRequestIds = await materialRequestFulfillmentService.ensurePoDeliveryBatches({
                    po: deliveryPo,
                    actorUserId: user.id,
                });
                for (const requestId of affectedRequestIds) {
                    const request = scopedMaterialRequests.find(item => item.id === requestId);
                    if (!request) continue;
                    const batches = await materialRequestFulfillmentService.listByRequest(requestId);
                    const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, batches);
                    if (nextStatus !== request.status || request.workflowStep !== 'site_quality_check') {
                        await updateRequestStatus(
                            request.id,
                            nextStatus,
                            `PO ${po.poNumber} đang giao, tạo phiếu chờ thủ kho kiểm tra SL/CL`,
                            undefined,
                            request.sourceWarehouseId,
                            request.overrideReason,
                            'FULFILLMENT_ISSUED',
                        );
                    }
                }
            }
            if (status === 'returned') {
                const affectedRequestIds = await materialRequestFulfillmentService.markPoReceiptBatchesReturned(po.id, `PO ${po.poNumber} đã trả lại/hoàn hàng`);
                for (const requestId of affectedRequestIds) {
                    const request = scopedMaterialRequests.find(item => item.id === requestId);
                    if (!request) continue;
                    const batches = await materialRequestFulfillmentService.listByRequest(requestId);
                    const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, batches);
                    if (nextStatus !== request.status) {
                        await updateRequestStatus(
                            request.id,
                            nextStatus,
                            `Đồng bộ hoàn hàng PO ${po.poNumber}`,
                            undefined,
                            request.sourceWarehouseId,
                            request.overrideReason,
                            'FULFILLMENT_RECEIVED',
                        );
                    }
                }
            }
            if (status === 'delivered' && po.status === 'partial') {
                const receiptStats = getPoReceiptStats(po);
                const affectedRequestIds = Array.from(new Set([
                    ...po.items.map(item => item.requestId).filter(Boolean),
                    ...poRequestLinks
                        .filter(link => link.purchaseOrderId === po.id)
                        .map(link => link.materialRequestId)
                        .filter(Boolean),
                ])) as string[];

                for (const requestId of affectedRequestIds) {
                    const request = scopedMaterialRequests.find(item => item.id === requestId);
                    if (request?.status === RequestStatus.COMPLETED && request.workflowStep === 'completed') continue;
                    await updateRequestStatus(
                        requestId,
                        RequestStatus.COMPLETED,
                        `PO ${po.poNumber} đã kết thúc sau khi nhận ${receiptStats.receivedQty.toLocaleString('vi-VN')}/${receiptStats.orderedQty.toLocaleString('vi-VN')}; công trường chấp nhận phần thiếu.`,
                        undefined,
                        request?.sourceWarehouseId,
                        request?.overrideReason,
                        'FULFILLMENT_RECEIVED',
                    );
                }
            }
            if (status === 'sent' && submissionTarget) {
                await projectSubmissionService.notifyTarget({
                    target: submissionTarget,
                    actorId: user?.id,
                    category: 'material',
                    title: `PO ${po.poNumber} chờ xác nhận`,
                    message: `Bạn được chọn xử lý PO ${po.poNumber}${po.vendorName ? ` của ${po.vendorName}` : ''}.`,
                    sourceType: 'purchase_order',
                    sourceId: po.id,
                    constructionSiteId: po.constructionSiteId || constructionSiteId,
                    link: '/da',
                    metadata: {
                        projectId: po.projectId || projectId,
                        totalAmount: po.totalAmount,
                        vendorId: po.vendorId,
                        vendorName: po.vendorName,
                    },
                }).catch(error => console.warn('Cannot notify PO recipient', error));
                setSubmittingPo(null);
            }
            await loadSupplyData();
            toast.success(status === 'draft' ? 'Đã đưa PO về nháp' : 'Cập nhật trạng thái PO');
        } catch (e: any) {
            logApiError('supplyChain.updatePoStatus', e);
            toast.error('Không thể cập nhật PO', getApiErrorMessage(e, 'Không thể cập nhật trạng thái PO trên Supabase.'));
            if (status === 'sent' && submissionTarget) throw e;
        }
    };

    const handleDeleteVendor = async (v: ProjectVendor) => {
        if (!ensureCanManage('xoá nhà cung cấp')) return;
        const ok = await confirm({ targetName: v.name, title: 'Xoá nhà cung cấp', warningText: 'Các đơn hàng liên quan cũng sẽ bị ảnh hưởng.' });
        if (!ok) return;
        try {
            await vendorService.remove(v.id);
            setVendors(await vendorService.list(effectiveId, constructionSiteId || null));
            toast.success('Xoá NCC thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const handleDeletePo = async (po: PurchaseOrder) => {
        if (!ensureCanManage('xoá đơn hàng')) return;
        const ok = await confirm({ targetName: po.poNumber, title: 'Xoá đơn hàng' });
        if (!ok) return;
        try {
            await poService.remove(po.id);
            await loadSupplyData();
            toast.success('Xoá PO thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const updatePoItem = (index: number, patch: Partial<PurchaseOrderItem>) => {
        setPItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
    };

    const selectPoInventoryItem = (index: number, itemId: string) => {
        const selected = inventoryItems.find(item => item.id === itemId);
        const currentLine = pItems[index];
        const supplierPatch = currentLine?.vendorId ? {} : getDefaultSupplierPatchForInventory(selected);
        updatePoItem(index, {
            itemId,
            ...supplierPatch,
            ...(selected ? buildPoUnitSnapshot(selected) : {
                unit: '',
                unitSnapshot: '',
                stockUnitSnapshot: '',
                purchaseUnitSnapshot: '',
                purchaseConversionFactor: 1,
            }),
            sku: selected?.sku || '',
            name: selected?.name || '',
            unitPrice: stockUnitPriceToPurchaseUnitPrice(Number(selected?.priceIn || 0), selected),
            isManualItem: false,
            itemNameSnapshot: selected?.name || '',
            unitSnapshot: selected?.unit || '',
            stockUnitSnapshot: selected?.unit || '',
            purchaseUnitSnapshot: selected?.purchaseUnit || selected?.unit || '',
            purchaseConversionFactor: Number(selected?.purchaseConversionFactor || 1),
        });
    };

    const selectPoBudgetItem = (index: number, budgetId: string) => {
        if (!budgetId) {
            updatePoItem(index, {
                workBoqItemId: null,
                workBoqItemName: null,
                materialBudgetItemId: null,
                materialBudgetItemName: null,
                budgetQtySnapshot: 0,
                reservedBeforeQtySnapshot: 0,
                previousRequestedQtySnapshot: 0,
                previousOrderedQtySnapshot: 0,
                previousReceivedQtySnapshot: 0,
                isOverBoq: false,
                overQty: 0,
                overPercent: 0,
                overReason: '',
                overBudgetQtySnapshot: 0,
                overBudgetPercentSnapshot: 0,
                overBudgetReason: '',
            });
            return;
        }
        const budget = materialBudgetMap.get(budgetId);
        if (!budget) return;
        const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
        const inventory = findInventoryForBudget(budget);
        if (!inventory) {
            toast.warning('Chưa có mã kho', 'Dòng BOQ này chưa liên kết với vật tư trong danh mục. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước khi đặt hàng.');
            return;
        }
        const defaultStockUnitPrice = Number(inventory.priceIn || budget.budgetUnitPrice || 0);
        updatePoItem(index, {
            itemId: inventory.id,
            ...(pItems[index]?.vendorId ? {} : getDefaultSupplierPatchForInventory(inventory)),
            ...buildPoUnitSnapshot(inventory),
            sku: inventory.sku,
            name: inventory.name,
            unitPrice: defaultStockUnitPrice > 0
                ? stockUnitPriceToPurchaseUnitPrice(defaultStockUnitPrice, inventory)
                : Number(pItems[index]?.unitPrice || 0),
            isManualItem: false,
            itemNameSnapshot: inventory.name,
            unitSnapshot: inventory.unit,
            stockUnitSnapshot: inventory.unit,
            purchaseUnitSnapshot: inventory.purchaseUnit || inventory.unit,
            purchaseConversionFactor: Number(inventory.purchaseConversionFactor || 1),
            workBoqItemId: budget.workBoqItemId || null,
            workBoqItemName: work?.name || null,
            materialBudgetItemId: budget.id,
            materialBudgetItemName: budget.itemName,
            budgetQtySnapshot: Number(budget.budgetQty || 0),
        });
    };

    const handleDownloadPoTemplate = async () => {
        const XLSX = await loadXlsx();
        const headers = [['Mã SKU *', 'Tên vật tư', 'ĐVT mua', 'Khối lượng đặt *', 'Đơn giá theo ĐVT mua', 'Ngày cần', 'Ghi chú']];
        const sample = inventoryItems[0]
            ? [[
                inventoryItems[0].sku,
                inventoryItems[0].name,
                inventoryItems[0].purchaseUnit || inventoryItems[0].unit,
                10,
                stockUnitPriceToPurchaseUnitPrice(Number(inventoryItems[0].priceIn || 0), inventoryItems[0]),
                new Date().toISOString().split('T')[0],
                '',
            ]]
            : [];
        const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
        const wb = XLSX.utils.book_new();
        ws['!cols'] = [{ wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Nhap_moi');

        const updateWs = XLSX.utils.aoa_to_sheet([
            ['Mã SKU *', 'Khối lượng đặt', 'Đơn giá', 'Ngày cần', 'Ghi chú'],
            inventoryItems[0]
                ? [inventoryItems[0].sku, 20, stockUnitPriceToPurchaseUnitPrice(Number(inventoryItems[0].priceIn || 0), inventoryItems[0]), new Date().toISOString().split('T')[0], 'Cập nhật PO']
                : ['STEEL-001', 20, 0, '', ''],
        ]);
        updateWs['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, updateWs, 'Cap_nhat');

        const guideWs = XLSX.utils.aoa_to_sheet([
            ['Chức năng', 'Cách dùng'],
            ['Nhập mới', 'Dùng sheet Nhap_moi để nạp danh sách vật tư vào PO đang tạo/sửa. SKU trùng trong PO sẽ báo lỗi.'],
            ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã SKU và cột muốn sửa. SKU phải đang có trong PO form.'],
            ['Ô trống', 'Trong chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
            ['ĐVT mua', 'PO đặt theo Đơn vị mua của NCC trong danh mục vật tư. Khi nhập kho, hệ thống tự quy đổi sang ĐVT kho theo hệ số vật tư.'],
        ]);
        guideWs['!cols'] = [{ wch: 24 }, { wch: 100 }];
        XLSX.utils.book_append_sheet(wb, guideWs, 'Huong_dan');
        const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Vioo_PO_Template.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const buildPoImportPreview = (mode: ExcelImportMode, rows: Record<string, unknown>[]) => {
        const activeItems = pItems.map(item => normalizePoItem(item, inventoryItems)).filter(item => item.itemId);
        const inventoryBySku = (sku: string) => inventoryItems.find(item => item.sku.toLowerCase() === sku.trim().toLowerCase());
        return buildImportPreview<PurchaseOrderItem>({
            mode,
            keyLabel: 'Mã SKU',
            keyAliases: ['Mã SKU *', 'Mã SKU', 'SKU'],
            existingRecords: activeItems,
            getRecordKey: item => item.sku,
            validateKey: sku => inventoryBySku(sku) ? undefined : `SKU "${sku}" không tồn tại trong kho vật tư.`,
            createBaseRecord: sku => {
                const item = inventoryBySku(sku);
                const supplierPatch = getDefaultSupplierPatchForInventory(item);
                return {
                    lineId: crypto.randomUUID(),
                    itemId: item?.id || '',
                    ...supplierPatch,
                    ...buildPoUnitSnapshot(item),
                    sku: item?.sku || sku,
                    name: item?.name || '',
                    unit: item?.purchaseUnit || item?.unit || '',
                    qty: 0,
                    unitPrice: stockUnitPriceToPurchaseUnitPrice(Number(item?.priceIn || 0), item),
                    receivedQty: 0,
                    neededDate: '',
                    note: '',
                };
            },
            fields: [
                {
                    key: 'qty',
                    label: 'Khối lượng đặt',
                    aliases: ['Khối lượng đặt *', 'Khối lượng đặt', 'Số lượng', 'KL'],
                    requiredOnCreate: true,
                    normalize: value => Number(value) || 0,
                    validate: value => Number(value) > 0 ? undefined : 'Khối lượng đặt phải lớn hơn 0.',
                },
                {
                    key: 'unitPrice',
                    label: 'Đơn giá',
                    aliases: ['Đơn giá', 'Giá'],
                    normalize: value => Number(value) || 0,
                    validate: value => Number(value) >= 0 ? undefined : 'Đơn giá không hợp lệ.',
                },
                {
                    key: 'neededDate',
                    label: 'Ngày cần',
                    aliases: ['Ngày cần', 'Ngày giao', 'Ngày yêu cầu'],
                    normalize: value => normalizePoImportDate(value),
                    clearable: true,
                },
                {
                    key: 'note',
                    label: 'Ghi chú',
                    aliases: ['Ghi chú', 'Ghi chu', 'Note'],
                    clearable: true,
                },
            ],
        }, rows);
    };

    const openPoImport = (mode: ExcelImportMode) => {
        if (!ensureCanManage('import PO')) return;
        poImportModeRef.current = mode;
        setPoImportMode(mode);
    };

    const handleImportPoExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!ensureCanManage('import PO')) {
            event.target.value = '';
            return;
        }
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setImportingPo(true);
        try {
            const rows = await parseExcelRows(file, poImportModeRef.current === 'create' ? 'Nhap_moi' : 'Cap_nhat');
            const preview = buildPoImportPreview(poImportModeRef.current, rows);
            if (preview.totalRows === 0) {
                toast.warning('File Excel trống', 'Không có dòng vật tư hợp lệ để import.');
                return;
            }
            setPoImportPreview(preview);
        } catch (e: any) {
            logApiError('supplyChain.importPoExcel', e);
            toast.error('Không thể import Excel', getApiErrorMessage(e, 'Không thể đọc file Excel PO.'));
        } finally {
            setImportingPo(false);
        }
    };

    const handleConfirmPoImport = () => {
        if (!ensureCanManage('áp dụng import PO')) return;
        if (!poImportPreview) return;
        const records = applyImportChanges(poImportPreview).map(item => normalizePoItem(item, inventoryItems));
        if (records.length === 0) {
            toast.warning('Không có dữ liệu cần ghi', 'File không có dòng PO hợp lệ để nạp.');
            return;
        }
        if (poImportPreview.mode === 'create') {
            setPItems(records);
        } else {
            setPItems(prev => prev.map(item => {
                const patch = records.find(record => record.sku.toLowerCase() === item.sku.toLowerCase());
                return patch ? normalizePoItem({ ...item, ...patch }, inventoryItems) : item;
            }));
        }
        toast.success(
            poImportPreview.mode === 'create' ? 'Đã nạp dòng PO' : 'Đã cập nhật dòng PO',
            `${records.length} dòng hợp lệ đã được đưa vào PO form.`
        );
        setPoImportPreview(null);
    };

    const escapeHtml = (value: unknown) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const formatPoPrintDate = (value?: string | null) => {
        const date = value ? new Date(value) : new Date();
        const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
        return `Thái Bình, ngày ${safeDate.getDate()} Tháng ${safeDate.getMonth() + 1} Năm ${safeDate.getFullYear()}`;
    };

    const getUserPositionLabel = () => {
        if (user.role === 'ADMIN') return 'Quản trị hệ thống';
        if (user.role === 'WAREHOUSE_KEEPER') return 'Thủ kho / Phòng vật tư';
        return 'Nhân viên';
    };

    const buildPoApprovalSubject = (po: PurchaseOrder) => {
        const itemNames = Array.from(new Set(po.items.map(item => item.workBoqItemName || item.materialBudgetItemName || item.name).filter(Boolean)));
        const itemLabel = itemNames.length === 1
            ? itemNames[0]
            : itemNames.length > 1
                ? `${itemNames[0]} và ${itemNames.length - 1} vật tư khác`
                : po.poNumber;
        const siteId = po.constructionSiteId || constructionSiteId || '';
        const projectLabel = constructionSites.find(site => site.id === siteId)?.name || po.projectId || siteId;
        const vendorLabel = po.vendorName ? ` --> ${po.vendorName}` : '';
        return `${itemLabel}${projectLabel ? ` ${projectLabel}` : ''}${vendorLabel}`.toUpperCase();
    };

    const buildPoApprovalRequestSection = (po: PurchaseOrder, pageBreak = false) => {
        const totalAmount = po.items.reduce((sum, item) => sum + calculateLineTotal(item), 0);
        const rowsHtml = po.items.map((item, index) => `
            <tr>
                <td class="approval-center">${index + 1}</td>
                <td>${escapeHtml(item.sku || item.itemId)}</td>
                <td>
                    <strong>${escapeHtml(item.name)}</strong>
                    ${item.workBoqItemName ? `<div class="approval-muted">${escapeHtml(item.workBoqItemName)}</div>` : ''}
                    ${item.note ? `<div class="approval-muted">${escapeHtml(item.note)}</div>` : ''}
                </td>
                <td class="approval-center">${escapeHtml(item.unit)}</td>
                <td class="approval-right">${Number(item.qty || 0).toLocaleString('vi-VN')}</td>
                <td class="approval-right">${Number(item.unitPrice || 0).toLocaleString('vi-VN')}</td>
                <td class="approval-right">${Number(calculateLineTotal(item)).toLocaleString('vi-VN')}</td>
            </tr>
        `).join('');

        return `
            <section class="approval-sheet ${pageBreak ? 'page-break' : ''}">
                <table class="approval-header-table">
                    <tbody>
                        <tr>
                            <td colspan="12" class="approval-title">ĐỀ NGHỊ DUYỆT ĐƠN HÀNG</td>
                        </tr>
                        <tr>
                            <td colspan="12" class="approval-date"><em>${escapeHtml(formatPoPrintDate(po.orderDate))}</em></td>
                        </tr>
                        <tr>
                            <td class="approval-label-cell" colspan="2"><em>Kính gửi:</em></td>
                            <td colspan="10" class="approval-value-cell"><strong>Ban giám đốc Cty CP PTĐT & Xây lắp Tiến Thịnh</strong></td>
                        </tr>
                        <tr>
                            <td class="approval-label-cell" colspan="2"><em>Tên tôi là:</em></td>
                            <td colspan="10" class="approval-value-cell"><strong>${escapeHtml(user.name || '')}</strong></td>
                        </tr>
                        <tr>
                            <td class="approval-label-cell" colspan="2"><em>Chức vụ:</em></td>
                            <td colspan="10" class="approval-value-cell"><strong>${escapeHtml(getUserPositionLabel())}</strong></td>
                        </tr>
                        <tr>
                            <td colspan="12" class="approval-intro"><em>Đề nghị BGD duyệt đơn hàng:</em></td>
                        </tr>
                        <tr>
                            <td colspan="12" class="approval-subject">${escapeHtml(buildPoApprovalSubject(po))}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="approval-meta-grid">
                    <div><span>Số PO</span><strong>${escapeHtml(po.poNumber)}</strong></div>
                    <div><span>Nhà cung cấp</span><strong>${escapeHtml(po.vendorName || '-')}</strong></div>
                    <div><span>Nhóm mua hàng</span><strong>${escapeHtml(po.procurementGroupNo || '-')}</strong></div>
                    <div><span>Ngày cần giao</span><strong>${escapeHtml(po.expectedDeliveryDate || '-')}</strong></div>
                    <div><span>Tổng giá trị</span><strong>${totalAmount.toLocaleString('vi-VN')} đ</strong></div>
                    <div><span>Kho nhận</span><strong>${escapeHtml(warehouses.find(w => w.id === po.targetWarehouseId)?.name || '-')}</strong></div>
                </div>

                <table class="approval-lines">
                    <thead>
                        <tr>
                            <th style="width:42px;">STT</th>
                            <th style="width:96px;">Mã</th>
                            <th>Hàng hóa / nội dung</th>
                            <th style="width:60px;">ĐVT</th>
                            <th style="width:90px;">KL</th>
                            <th style="width:110px;">Đơn giá</th>
                            <th style="width:130px;">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="6" class="approval-right"><strong>TỔNG CỘNG</strong></td>
                            <td class="approval-right"><strong>${totalAmount.toLocaleString('vi-VN')} đ</strong></td>
                        </tr>
                    </tfoot>
                </table>

                ${po.note ? `<div class="approval-note"><strong>Ghi chú:</strong> ${escapeHtml(po.note)}</div>` : ''}

                <div class="approval-signatures">
                    <div><strong>Người đề nghị</strong><span>${escapeHtml(user.name || '')}</span></div>
                    <div><strong>Phòng/Bộ phận kiểm tra</strong><span></span></div>
                    <div><strong>Ban giám đốc duyệt</strong><span></span></div>
                </div>
            </section>
        `;
    };

    const buildPoPrintSection = (printablePo: PurchaseOrder, qrSvg: string, pageBreak = false) => {
        const targetWh = warehouses.find(w => w.id === printablePo.targetWarehouseId);

        const uniqueSpecKeys = Array.from(
            new Set(
                printablePo.items.flatMap(item =>
                    item.specs ? Object.keys(item.specs).filter(key => {
                        const val = item.specs?.[key]?.value;
                        return val !== undefined && val !== null && val !== '';
                    }) : []
                )
            )
        ).sort((a, b) => {
            const idxA = SPEC_KEY_ORDER.indexOf(a);
            const idxB = SPEC_KEY_ORDER.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        const getHeaderLabel = (k: string) => {
            const meta = DEFAULT_SPEC_METADATA[k];
            if (meta) {
                return meta.label + (meta.unit ? ` (${meta.unit})` : '');
            }
            for (const item of printablePo.items) {
                const specVal = item.specs?.[k];
                if (specVal?.label) {
                    return specVal.label + (specVal.unit ? ` (${specVal.unit})` : '');
                }
            }
            return k;
        };

        const headersHtml = `
            <th class="center" style="width: 45px;">STT</th>
            <th style="width: 100px;">Mã hàng hoá</th>
            <th>Tên hàng hoá & Chi tiết kỹ thuật</th>
            <th class="center" style="width: 60px;">ĐVT</th>
            ${uniqueSpecKeys.map(k => `<th class="center" style="min-width: 70px;">${escapeHtml(getHeaderLabel(k))}</th>`).join('')}
            <th class="right" style="width: 90px;">Khối lượng</th>
            <th class="right" style="width: 110px;">Đơn giá</th>
            <th class="right" style="width: 130px;">Thành tiền</th>
        `;

        const rowsHtml = printablePo.items.map((item, index) => {
            const specCells = uniqueSpecKeys.map(k => {
                const val = item.specs?.[k]?.value;
                return `<td class="center font-semibold bg-slate-50/20">${val !== undefined && val !== null && val !== '' ? escapeHtml(val) : '—'}</td>`;
            }).join('');

            const formulaHtml = item.pricingMode && item.pricingMode !== 'standard'
                ? `<div class="pricing-formula">📐 Tính giá: ${escapeHtml(formatPricingFormula(item))}</div>`
                : '';

            const dateVal = item.neededDate || printablePo.expectedDeliveryDate;
            const hasDateOrNote = dateVal || item.note;
            const noteBoxHtml = hasDateOrNote
                ? `
                    <div class="note-box">
                        ${dateVal ? `<div class="note-box-date">📅 Ngày cần: ${escapeHtml(dateVal)}</div>` : ''}
                        ${item.note ? `<div class="note-box-italic">📝 Ghi chú dòng: ${escapeHtml(item.note)}</div>` : ''}
                    </div>
                `
                : '';

            return `
                <tr>
                    <td class="center font-mono">${index + 1}</td>
                    <td class="font-mono text-slate-500">${escapeHtml(item.sku)}</td>
                    <td>
                        <div style="font-weight: bold; font-size: 13px; color: #0f172a;">${escapeHtml(item.name)}</div>
                        ${formulaHtml}
                        ${noteBoxHtml}
                    </td>
                    <td class="center" style="font-weight: 500;">${escapeHtml(item.unit)}</td>
                    ${specCells}
                    <td class="right font-mono" style="font-weight: bold;">${Number(item.qty || 0).toLocaleString('vi-VN')}</td>
                    <td class="right font-mono">${Number(item.unitPrice || 0).toLocaleString('vi-VN')}</td>
                    <td class="right font-mono" style="font-weight: bold; color: #0f172a;">${Number(calculateLineTotal(item)).toLocaleString('vi-VN')} đ</td>
                </tr>
            `;
        }).join('');

        const totalAmount = printablePo.items.reduce((sum, item) => sum + calculateLineTotal(item), 0);

        return `
            <section class="${pageBreak ? 'page-break' : ''}">
                <div class="header">
                    <div>
                        <div class="label">Phiếu đặt hàng nhà cung cấp</div>
                        <h1>${escapeHtml(printablePo.poNumber)}</h1>
                        <div class="meta">
                            <div><div class="label">Nhà cung cấp</div>${escapeHtml(printablePo.vendorName || '')}</div>
                            <div><div class="label">Kho nhận</div>${escapeHtml(targetWh?.name || '')}</div>
                            <div><div class="label">Nhóm mua hàng</div>${escapeHtml(printablePo.procurementGroupNo || '')}</div>
                            <div><div class="label">Ngày đặt</div>${escapeHtml(printablePo.orderDate)}</div>
                            <div><div class="label">Ngày cần</div>${escapeHtml(printablePo.expectedDeliveryDate || '')}</div>
                            <div><div class="label">Dự án/Công trường</div>${escapeHtml(printablePo.projectId || printablePo.constructionSiteId || '')}</div>
                        </div>
                    </div>
                    <div class="qr">${qrSvg}<div>Quét QR để nhập kho</div></div>
                </div>
                <table>
                    <thead>
                        <tr>
                            ${headersHtml}
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="font-weight: bold; background: #f8fafc;">
                            <td colspan="${6 + uniqueSpecKeys.length}" class="center">TỔNG CỘNG ĐƠN HÀNG:</td>
                            <td class="right" style="color: #0f172a; font-size: 13px; font-weight: bold; text-decoration: underline; text-underline-offset: 4px;">${totalAmount.toLocaleString('vi-VN')} đ</td>
                        </tr>
                    </tfoot>
                </table>
                ${printablePo.note ? `<div class="note"><strong>Ghi chú đơn hàng:</strong> ${escapeHtml(printablePo.note)}</div>` : ''}
            </section>
        `;
    };

    const buildPoPrintHtml = (title: string, sectionsHtml: string) => `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(title)}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0f172a; margin: 32px; font-size: 12.5px; line-height: 1.5; }
                .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
                h1 { margin: 0; font-size: 24px; letter-spacing: .02em; font-weight: 800; color: #0f172a; }
                .label { color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
                .meta { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; font-size: 13px; color: #334155; }
                .meta > div { display: flex; flex-direction: column; gap: 2px; }
                .meta > div .label { font-size: 8.5px; }
                
                table { width: 100%; border-collapse: collapse; margin-top: 28px; font-size: 12px; }
                th, td { border: 1px solid #e2e8f0; padding: 10px 12px; vertical-align: top; line-height: 1.5; }
                th { background: #f8fafc; text-transform: uppercase; font-size: 9.5px; font-weight: 800; letter-spacing: .05em; color: #475569; border-bottom: 2px solid #cbd5e1; }
                
                .right { text-align: right; }
                .center { text-align: center; }
                .font-semibold { font-weight: 600; }
                .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
                .bg-slate-50\\/20 { background-color: rgba(248, 250, 252, 0.5); }
                .text-slate-500 { color: #64748b; }
                
                .qr { text-align: center; font-size: 9px; color: #64748b; font-weight: 700; display: flex; flex-direction: column; align-items: center; gap: 6px; }
                .qr svg { max-width: 100px; height: auto; }
                
                .note-box {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    padding: 8px 12px;
                    border-radius: 8px;
                    margin-top: 6px;
                    font-size: 10.5px;
                    color: #475569;
                    line-height: 1.6;
                }
                .note-box-date {
                    font-weight: 700;
                    color: #334155;
                    margin-bottom: 3px;
                }
                .note-box-italic {
                    font-style: italic;
                    color: #64748b;
                }
                
                .pricing-formula {
                    font-size: 9px;
                    color: #7c3aed;
                    margin-top: 4px;
                    font-weight: bold;
                    display: inline-block;
                    background: #f5f3ff;
                    border: 1px solid #ddd6fe;
                    padding: 2px 6px;
                    border-radius: 4px;
                }
                
                .note { margin-top: 24px; font-size: 12px; color: #334155; background: #fdfbf7; border: 1px solid #fef3c7; padding: 12px; border-radius: 8px; }
                .approval-sheet { font-family: "Times New Roman", Times, serif; color: #000; font-size: 14px; line-height: 1.25; }
                .approval-header-table { width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; }
                .approval-header-table td { border: 1px solid #cfcfcf; padding: 5px 6px; }
                .approval-title { text-align: center; font-size: 20px; font-weight: 800; letter-spacing: .02em; }
                .approval-date { text-align: right; font-size: 14px; padding-right: 36px !important; }
                .approval-label-cell { width: 120px; white-space: nowrap; }
                .approval-value-cell { border-bottom: 1px dotted #333 !important; }
                .approval-intro { border-bottom: 0 !important; font-size: 14px; }
                .approval-subject { text-align: center; font-size: 16px; font-weight: 800; text-transform: uppercase; }
                .approval-meta-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
                .approval-meta-grid div { border: 1px solid #d7d7d7; padding: 8px 10px; min-height: 42px; }
                .approval-meta-grid span { display: block; color: #666; text-transform: uppercase; font-size: 9px; font-weight: 700; letter-spacing: .04em; margin-bottom: 3px; }
                .approval-meta-grid strong { font-size: 12px; color: #111; }
                .approval-lines { width: 100%; border-collapse: collapse; margin-top: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 11.5px; }
                .approval-lines th, .approval-lines td { border: 1px solid #cfcfcf; padding: 7px 8px; vertical-align: top; }
                .approval-lines th { background: #f3f4f6; color: #111; text-align: center; font-size: 10px; font-weight: 800; text-transform: uppercase; }
                .approval-lines tfoot td { background: #fafafa; }
                .approval-center { text-align: center; }
                .approval-right { text-align: right; }
                .approval-muted { margin-top: 2px; color: #666; font-size: 10px; }
                .approval-note { margin-top: 12px; border: 1px solid #d7d7d7; padding: 8px 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 12px; }
                .approval-signatures { margin-top: 34px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; text-align: center; font-family: "Times New Roman", Times, serif; }
                .approval-signatures div { min-height: 82px; }
                .approval-signatures strong { display: block; margin-bottom: 54px; }
                .approval-signatures span { font-weight: 700; }
                .page-break { page-break-before: always; break-before: page; }
                @media print { 
                    body { margin: 15mm; } 
                    table { page-break-inside: auto; }
                    tr { page-break-inside: avoid; page-break-after: auto; }
                }
            </style>
        </head>
        <body>${sectionsHtml}</body>
        </html>
    `;

    const handlePrintPo = async (po: PurchaseOrder, template: PurchaseOrderPrintTemplateKey = 'purchase_order') => {
        setPrintingPoId(po.id);
        setPoPrintMenuId(null);
        try {
            let html = '';
            if (template === 'approval_request') {
                html = buildPoPrintHtml(`Đề nghị duyệt đơn hàng ${po.poNumber}`, buildPoApprovalRequestSection(po));
            } else {
                const printablePo = await poService.ensureQrToken(po);
                if (!po.qrToken) {
                    setPos(prev => prev.map(item => item.id === po.id ? printablePo : item));
                }
                const receiveUrl = buildPoReceiveUrl(printablePo.qrToken!);
                const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={132} level="H" includeMargin />);
                html = buildPoPrintHtml(printablePo.poNumber, buildPoPrintSection(printablePo, qrSvg));
            }

            const printWindow = window.open('', '_blank', 'width=980,height=720');
            if (!printWindow) {
                toast.error('Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup in/PDF.');
                return;
            }
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 300);
        } catch (e: any) {
            logApiError('supplyChain.printPo', e);
            toast.error('Không thể in PO', getApiErrorMessage(e, `Không thể tạo mẫu in "${PO_PRINT_TEMPLATE_LABELS[template]}".`));
        } finally {
            setPrintingPoId(null);
        }
    };

    const handlePrintPoGroup = async (groupId: string, template: PurchaseOrderPrintTemplateKey = 'purchase_order') => {
        const groupOrders = pos
            .filter(po => po.procurementGroupId === groupId)
            .sort((a, b) => a.poNumber.localeCompare(b.poNumber));
        if (groupOrders.length === 0) return;
        setPrintingPoId(groupId);
        setPoPrintMenuId(null);
        try {
            let html = '';
            if (template === 'approval_request') {
                const sections = groupOrders.map((po, index) => buildPoApprovalRequestSection(po, index > 0)).join('');
                html = buildPoPrintHtml(`Đề nghị duyệt nhóm ${groupOrders[0].procurementGroupNo || 'PO'}`, sections);
            } else {
                const printableOrders: PurchaseOrder[] = [];
                for (const po of groupOrders) {
                    const printablePo = await poService.ensureQrToken(po);
                    printableOrders.push(printablePo);
                }
                setPos(prev => prev.map(po => printableOrders.find(item => item.id === po.id) || po));
                const sections = printableOrders.map((po, index) => {
                    const receiveUrl = buildPoReceiveUrl(po.qrToken!);
                    const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={132} level="H" includeMargin />);
                    return buildPoPrintSection(po, qrSvg, index > 0);
                }).join('');
                html = buildPoPrintHtml(printableOrders[0].procurementGroupNo || 'Nhóm PO', sections);
            }
            const printWindow = window.open('', '_blank', 'width=980,height=720');
            if (!printWindow) {
                toast.error('Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup in/PDF.');
                return;
            }
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 300);
        } catch (e: any) {
            logApiError('supplyChain.printPoGroup', e);
            toast.error('Không thể in nhóm PO', getApiErrorMessage(e, `Không thể tạo bộ mẫu "${PO_PRINT_TEMPLATE_LABELS[template]}".`));
        } finally {
            setPrintingPoId(null);
        }
    };

    // Stats
    const stats = useMemo(() => {
        const totalPo = pos.length;
        const totalValue = pos.reduce((s, p) => s + p.totalAmount, 0);
        const delivered = pos.filter(p => p.status === 'delivered' || p.status === 'closed').length;
        const pending = pos.filter(p => ['draft', 'sent', 'confirmed', 'in_transit', 'partial'].includes(p.status)).length;
        return { partnerCount: partners.length, totalPo, totalValue, delivered, pending };
    }, [partners, pos]);

    const poTotalCalc = pItems.reduce((sum, item) => {
        const normalizedLine = normalizePoItem(item, inventoryItems);
        const previewLine = pSourceMode === 'proactive_stock' ? normalizedLine : buildPoBudgetSnapshot(normalizedLine);
        return sum + calculateLineTotal(previewLine);
    }, 0);
    const poHasRequestLines = useMemo(() => pItems.some(item => !!item.requestId), [pItems]);
    const procurementGroupCounts = useMemo(() => pos.reduce<Record<string, number>>((acc, po) => {
        if (po.procurementGroupId) acc[po.procurementGroupId] = (acc[po.procurementGroupId] || 0) + 1;
        return acc;
    }, {}), [pos]);

    return (
        <div className="space-y-6">
            {poImportPreview && (
                <ExcelImportReviewModal
                    title={poImportPreview.mode === 'create' ? 'Preview nhập mới dòng PO' : 'Preview cập nhật dòng PO'}
                    preview={poImportPreview}
                    loading={importingPo}
                    onClose={() => setPoImportPreview(null)}
                    onConfirm={handleConfirmPoImport}
                />
            )}
            {!compact && (
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-700 dark:text-white">Đơn hàng vật tư (PO)</h3>
                    <AiInsightPanel module="supplychain" siteId={constructionSiteId} />
                </div>
            )}
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Users size={10} /> Đối tác HĐ</div>
                    <div className="text-2xl font-black text-slate-800">{stats.partnerCount}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><ShoppingCart size={10} /> Đơn hàng</div>
                    <div className="text-2xl font-black text-slate-800">{stats.totalPo}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Tổng: {fmt(stats.totalValue)} đ</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Truck size={10} /> Đã giao</div>
                    <div className="text-2xl font-black text-emerald-600">{stats.delivered}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Clock size={10} /> Chờ giao</div>
                    <div className="text-2xl font-black text-amber-600">{stats.pending}</div>
                </div>
            </div>

            {subTab === 'po' && (
                <MaterialIssuePanel
                    projectId={projectId || null}
                    constructionSiteId={constructionSiteId || null}
                    compact={compact}
                    canCreate={!!canManageTab}
                />
            )}

            {/* Vendor Tab */}
            {subTab === 'vendor' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-visible">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Users size={16} className="text-cyan-500" /> Danh sách NCC</h3>
                        {canManageTab && (
                            <button onClick={() => { resetVendorForm(); setShowVendorForm(true); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-cyan-600 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100">
                                <Plus size={12} /> Thêm NCC
                            </button>
                        )}
                    </div>
                    {vendors.length === 0 ? (
                        <div className="p-12 text-center">
                            <Users size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có nhà cung cấp</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50 dark:divide-slate-700/40">
                            {vendors.map(v => {
                                const vendorPos = pos.filter(p => p.vendorId === v.id);
                                const vendorValue = vendorPos.reduce((s, p) => s + p.totalAmount, 0);
                                return (
                                    <div key={v.id} className="px-5 py-4 hover:bg-slate-50/30 group">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-black shrink-0">
                                                    {v.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                        {v.name}
                                                        <span className="flex items-center gap-0.5">
                                                            {[1, 2, 3, 4, 5].map(s => (
                                                                <Star key={s} size={9} className={s <= v.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
                                                            ))}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                                                        {v.contact && <span className="flex items-center gap-0.5"><Users size={8} /> {v.contact}</span>}
                                                        <span className="flex items-center gap-0.5"><Phone size={8} /> {v.phone}</span>
                                                        {v.email && <span className="flex items-center gap-0.5"><Mail size={8} /> {v.email}</span>}
                                                    </div>
                                                    {v.categories.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {v.categories.map(c => (
                                                                <span key={c} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-600 border border-cyan-100">{c}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-right hidden md:block">
                                                    <div className="text-xs font-bold text-slate-700">{vendorPos.length} PO</div>
                                                    <div className="text-[10px] text-slate-400">{fmt(vendorValue)} đ</div>
                                                </div>
                                                {canManageTab && (
                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                        <button onClick={() => openEditVendor(v)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                        <button onClick={() => handleDeleteVendor(v)}
                                                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* PO Tab */}
            {subTab === 'po' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><FileText size={16} className="text-blue-500" /> Đơn đặt hàng (PO)</h3>
                        <div className="flex items-center gap-2">
                            <button onClick={handleDownloadPoTemplate}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100">
                                <FileSpreadsheet size={12} /> Mẫu Excel
                            </button>
                            {canManageTab && (
                                <>
                                    <button onClick={openRequestPicker}
                                        disabled={scopedRequestLines.length === 0}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed">
                                        <Package size={12} /> Tạo từ đề xuất
                                    </button>
                                    <button onClick={openCreatePo}
                                        disabled={partners.length === 0 || inventoryItems.length === 0 || warehouses.length === 0}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                                        <Plus size={12} /> Tạo PO
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    {partners.length === 0 ? (
                        <div className="p-8 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-300" />
                            <p className="text-xs font-bold text-slate-400">Cần tạo đối tác tại Hợp đồng → Đối tác trước khi tạo PO</p>
                        </div>
                    ) : inventoryItems.length === 0 || warehouses.length === 0 ? (
                        <div className="p-8 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-300" />
                            <p className="text-xs font-bold text-slate-400">Cần có danh mục vật tư WMS và kho nhận trước khi tạo PO</p>
                        </div>
                    ) : pos.length === 0 ? (
                        <div className="p-12 text-center">
                            <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có đơn hàng</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50 dark:divide-slate-700/40">
                            {pos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(po => {
                                const stCfg = PO_STATUS[po.status];
                                const sourceCfg = PO_SOURCE_MODE[po.sourceMode || 'proactive_project'];
                                const isExpanded = expandedPoId === po.id;
                                const targetWh = warehouses.find(w => w.id === po.targetWarehouseId);
                                const groupSize = po.procurementGroupId ? (procurementGroupCounts[po.procurementGroupId] || 0) : 0;
                                const groupPrintMenuKey = po.procurementGroupId ? `group:${po.procurementGroupId}` : '';
                                const isPrintMenuOpen = poPrintMenuId === po.id || (!!groupPrintMenuKey && poPrintMenuId === groupPrintMenuKey);
                                const supplierReturns = supplierReturnsByPo[po.id] || [];
                                const totalReceivedQty = po.items.reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);
                                const completedReturnQty = Math.max(
                                    po.items.reduce((sum, item) => sum + Number(item.returnedQty || 0), 0),
                                    supplierReturns
                                        .filter(item => item.status === 'completed')
                                        .reduce((sum, item) => sum + item.lines.reduce((lineSum, line) => lineSum + Number(line.returnQty || 0), 0), 0),
                                );
                                const pendingReturnQty = supplierReturns
                                    .filter(item => item.status === 'pending')
                                    .reduce((sum, item) => sum + item.lines.reduce((lineSum, line) => lineSum + Number(line.returnQty || 0), 0), 0);
                                const supplierReturnableQty = Math.max(0, totalReceivedQty - completedReturnQty - pendingReturnQty);
                                return (
                                    <div key={po.id} className={isPrintMenuOpen ? 'relative z-50' : 'relative z-0'}>
                                        <div className="px-5 py-4 hover:bg-slate-50/30 group cursor-pointer"
                                            onClick={() => setExpandedPoId(isExpanded ? null : po.id)}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                                        <FileText size={14} className="text-blue-500" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                                            {po.poNumber}
                                                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                                {stCfg.icon} {stCfg.label}
                                                            </span>
                                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${sourceCfg.color}`}>
                                                                {sourceCfg.label}
                                                            </span>
                                                            {po.procurementGroupNo && (
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-[9px] font-bold text-violet-700">
                                                                    Nhóm {po.procurementGroupNo}{groupSize > 1 ? ` • ${groupSize} PO` : ''}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                                            NCC: <span className="font-bold text-slate-500">{po.vendorName || '—'}</span>
                                                            {' • '}{new Date(po.orderDate).toLocaleDateString('vi-VN')}
                                                            {' • '}{po.items.length} mục
                                                            {targetWh && <>{' • '}Kho: <span className="font-bold text-slate-500">{targetWh.name}</span></>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <div className="text-right">
                                                        <div className="text-sm font-black text-slate-800">{fmt(po.totalAmount)} đ</div>
                                                        {po.expectedDeliveryDate && (
                                                            <div className="text-[9px] text-slate-400">
                                                                Giao: {new Date(po.expectedDeliveryDate).toLocaleDateString('vi-VN')}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <div className="relative">
                                                            <button onClick={e => { e.stopPropagation(); setPoPrintMenuId(prev => prev === po.id ? null : po.id); }} title="Chọn mẫu in/PDF"
                                                                disabled={printingPoId === po.id}
                                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 disabled:opacity-50">
                                                                {printingPoId === po.id ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                                                            </button>
                                                            {poPrintMenuId === po.id && (
                                                                <div onClick={event => event.stopPropagation()} className="absolute right-0 top-8 z-[100] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePrintPo(po, 'purchase_order')}
                                                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                                                                    >
                                                                        <Printer size={13} /> Đơn đặt hàng
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePrintPo(po, 'approval_request')}
                                                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                                                                    >
                                                                        <FileText size={13} /> Đề nghị duyệt đơn hàng
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {po.procurementGroupId && groupSize > 1 && (
                                                            <div className="relative">
                                                                <button onClick={e => { e.stopPropagation(); setPoPrintMenuId(prev => prev === `group:${po.procurementGroupId}` ? null : `group:${po.procurementGroupId}`); }} title="Chọn mẫu in tất cả PO trong nhóm"
                                                                    disabled={printingPoId === po.procurementGroupId}
                                                                    className="h-7 rounded-lg px-2 text-[9px] font-black text-violet-500 hover:bg-violet-50 hover:text-violet-700 border border-transparent hover:border-violet-200 disabled:opacity-50">
                                                                    {printingPoId === po.procurementGroupId ? <Loader2 size={12} className="animate-spin" /> : 'In nhóm'}
                                                                </button>
                                                                {poPrintMenuId === `group:${po.procurementGroupId}` && (
                                                                    <div onClick={event => event.stopPropagation()} className="absolute right-0 top-8 z-[100] w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handlePrintPoGroup(po.procurementGroupId!, 'purchase_order')}
                                                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black text-slate-600 hover:bg-violet-50 hover:text-violet-700"
                                                                        >
                                                                            <Printer size={13} /> Nhóm - Đơn đặt hàng
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handlePrintPoGroup(po.procurementGroupId!, 'approval_request')}
                                                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                                                                        >
                                                                            <FileText size={13} /> Nhóm - Đề nghị duyệt
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {canManageTab && (
                                                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                            <button onClick={e => { e.stopPropagation(); openEditPo(po); }} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                            <button onClick={async e => { e.stopPropagation(); handleDeletePo(po); }}
                                                                className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                        </div>
                                                    )}
                                                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Expanded items */}
                                        {isExpanded && (() => {
                                            const uniqueSpecKeys = Array.from(
                                                new Set(
                                                    po.items.flatMap(item =>
                                                        item.specs ? Object.keys(item.specs).filter(key => {
                                                            const val = item.specs?.[key]?.value;
                                                            return val !== undefined && val !== null && val !== '';
                                                        }) : []
                                                    )
                                                )
                                            ).sort((a, b) => {
                                                const idxA = SPEC_KEY_ORDER.indexOf(a);
                                                const idxB = SPEC_KEY_ORDER.indexOf(b);
                                                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                                                if (idxA !== -1) return -1;
                                                if (idxB !== -1) return 1;
                                                return a.localeCompare(b);
                                            });

                                            const getHeaderLabel = (k: string) => {
                                                const meta = DEFAULT_SPEC_METADATA[k];
                                                if (meta) {
                                                    return meta.label + (meta.unit ? ` (${meta.unit})` : '');
                                                }
                                                for (const item of po.items) {
                                                    const specVal = item.specs?.[k];
                                                    if (specVal?.label) {
                                                        return specVal.label + (specVal.unit ? ` (${specVal.unit})` : '');
                                                    }
                                                }
                                                return k;
                                            };

                                            return (
                                                <div className="px-5 pb-5 pt-2 bg-slate-50/50 dark:bg-slate-900/40">
                                                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-4 sm:p-5 space-y-6">
                                                        {/* Upper Section: Metadata Grid & Highlighted Action Bar */}
                                                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                                                            <div className="flex-1 min-w-0">
                                                                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Thông tin phiếu đặt hàng</h3>
                                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                                                                    <div>
                                                                        <span className="text-slate-400 block font-medium">Nhà cung cấp</span>
                                                                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate block">{po.vendorName || '—'}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-400 block font-medium">Kho nhận hàng</span>
                                                                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate block">{targetWh?.name || '—'}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-400 block font-medium">Ngày đặt đơn</span>
                                                                        <span className="font-bold text-slate-700 dark:text-slate-200 block">{new Date(po.orderDate).toLocaleDateString('vi-VN')}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-400 block font-medium">Ngày cần giao</span>
                                                                        <span className="font-bold text-slate-700 dark:text-slate-200 block">
                                                                            {po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString('vi-VN') : '—'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Big Total & Status Box */}
                                                            <div className="bg-slate-50 dark:bg-slate-800/40 p-3 sm:px-4 sm:py-3 rounded-xl border border-slate-150 dark:border-slate-800 flex items-center justify-between gap-6 shrink-0">
                                                                <div>
                                                                    <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-0.5">Tổng giá trị đơn</span>
                                                                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">{fmt(po.totalAmount)} đ</span>
                                                                </div>
                                                                <div className="flex flex-col items-end">
                                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Trạng thái</span>
                                                                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                                        {stCfg.icon}
                                                                        {stCfg.label}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Middle Section: Scrollable Items Table */}
                                                        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/10">
                                                            <table className="w-full text-xs border-collapse">
                                                                <thead>
                                                                    <tr className="bg-slate-50/80 dark:bg-slate-800/40 text-[9px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                                                        <th className="text-left py-3 px-4 min-w-[280px]">Mô tả vật tư</th>
                                                                        <th className="text-center py-3 px-3 w-16">ĐVT</th>
                                                                        {uniqueSpecKeys.map(k => (
                                                                            <th key={k} className="text-center py-3 px-3 min-w-[80px] whitespace-nowrap">{getHeaderLabel(k)}</th>
                                                                        ))}
                                                                        <th className="text-right py-3 px-3 w-20">SL</th>
                                                                        <th className="text-right py-3 px-3 w-20">Đã nhận</th>
                                                                        <th className="text-right py-3 px-3 w-24">Đơn giá</th>
                                                                        <th className="text-right py-3 px-4 w-28">Thành tiền</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-150 dark:divide-slate-800 bg-white dark:bg-slate-900">
                                                                    {po.items.map((item, i) => {
                                                                        const work = item.workBoqItemId ? workBoqMap.get(item.workBoqItemId) : undefined;
                                                                        const inventory = inventoryItems.find(inv => inv.id === item.itemId);
                                                                        const stockUnit = getPoLineStockUnit(item, inventory);
                                                                        return (
                                                                            <tr key={i} className="hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors">
                                                                                <td className="py-3.5 px-4 vertical-top">
                                                                                    <div className="font-bold text-slate-800 dark:text-slate-200 text-sm leading-snug">{item.name}</div>
                                                                                    {item.sku && <div className="text-[10px] font-mono text-slate-400 mt-0.5">{item.sku}</div>}

                                                                                    {/* Long Note & Description Box - wraps dynamically */}
                                                                                    {(item.neededDate || item.note) && (
                                                                                        <div className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/50 p-2.5 rounded-lg mt-2 whitespace-normal break-words leading-relaxed max-w-xl">
                                                                                            {item.neededDate && <div className="font-bold text-slate-600 dark:text-slate-300 mb-1">📅 Ngày cần: {item.neededDate}</div>}
                                                                                            {item.note && <div className="italic text-slate-700 dark:text-slate-300">📝 Ghi chú dòng: {item.note}</div>}
                                                                                        </div>
                                                                                    )}

                                                                                    <div className="flex flex-wrap gap-1 mt-2">
                                                                                        {item.requestCode && <span className="px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-[9px] font-bold text-amber-700">YC {item.requestCode}</span>}
                                                                                        {(item.workBoqItemName || work?.name) && <span className="px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[9px] font-bold text-blue-700">{work?.wbsCode ? `${work.wbsCode} - ` : ''}{item.workBoqItemName || work?.name}</span>}
                                                                                        {item.materialBudgetItemName && <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] font-bold text-emerald-700">{item.materialBudgetItemName}</span>}
                                                                                        {Number(item.overBudgetQtySnapshot || 0) > 0 && <span className="px-1.5 py-0.5 rounded border border-orange-100 bg-orange-50 text-[9px] font-bold text-orange-700">Vượt {Number(item.overBudgetQtySnapshot || 0).toLocaleString('vi-VN')} {stockUnit || item.unit}</span>}
                                                                                    </div>
                                                                                    {item.overBudgetReason && <div className="text-[10px] text-orange-600 font-semibold mt-1.5 bg-orange-50 border border-orange-100 p-1.5 rounded">Lý do mua vượt: {item.overBudgetReason}</div>}

                                                                                    {item.pricingMode && item.pricingMode !== 'standard' && (
                                                                                        <div className="text-[9.5px] text-violet-600 dark:text-violet-400 font-bold mt-2 bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 px-2 py-1 rounded inline-block">
                                                                                            📐 Tính giá: {formatPricingFormula(item)}
                                                                                        </div>
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-3.5 px-3 text-center text-slate-500 dark:text-slate-400 font-bold whitespace-nowrap">{item.unit}</td>
                                                                                {uniqueSpecKeys.map(k => {
                                                                                    const val = item.specs?.[k]?.value;
                                                                                    return (
                                                                                        <td key={k} className="py-3.5 px-3 text-center text-slate-700 dark:text-slate-300 font-semibold bg-slate-50/20 dark:bg-slate-800/10 whitespace-nowrap">
                                                                                            {val !== undefined && val !== null && val !== '' ? val : '—'}
                                                                                        </td>
                                                                                    );
                                                                                })}
                                                                                <td className="py-3.5 px-3 text-right text-slate-700 dark:text-slate-300 font-bold">{item.qty.toLocaleString()}</td>
                                                                                <td className="py-3.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-black">{(item.receivedQty || 0).toLocaleString()}</td>
                                                                                <td className="py-3.5 px-3 text-right text-slate-600 dark:text-slate-400 font-medium">{fmt(item.unitPrice)}</td>
                                                                                <td className="py-3.5 px-4 text-right font-black text-slate-850 dark:text-slate-100 text-sm">{fmt(calculateLineTotal(item))} đ</td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                                <tfoot>
                                                                    <tr className="bg-slate-50 dark:bg-slate-800/20 text-xs font-black border-t border-slate-200 dark:border-slate-800">
                                                                        <td colSpan={6 + uniqueSpecKeys.length} className="py-3 px-4 text-center text-slate-500">TỔNG CỘNG ĐƠN HÀNG:</td>
                                                                        <td className="py-3 px-4 text-right text-slate-800 dark:text-slate-100 text-sm underline decoration-double">{fmt(po.totalAmount)} đ</td>
                                                                    </tr>
                                                                </tfoot>
                                                            </table>
                                                        </div>

                                                        {/* Notes block */}
                                                        {po.note && (
                                                            <div className="p-3.5 bg-amber-50/30 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 whitespace-pre-wrap leading-relaxed">
                                                                <strong className="block mb-1">📝 GHI CHÚ ĐƠN HÀNG:</strong>
                                                                {po.note}
                                                            </div>
                                                        )}

                                                        {supplierReturns.length > 0 && (
                                                            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                                                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                                                    <div>
                                                                        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-500">Lịch sử trả hàng NCC</h4>
                                                                        <p className="mt-0.5 text-[10px] font-bold text-slate-400">
                                                                            Đã nhận {totalReceivedQty.toLocaleString('vi-VN')} · Đã trả {completedReturnQty.toLocaleString('vi-VN')} · Đang chờ duyệt {pendingReturnQty.toLocaleString('vi-VN')}
                                                                        </p>
                                                                    </div>
                                                                    <span className="text-xs font-black text-rose-600">Còn có thể trả: {supplierReturnableQty.toLocaleString('vi-VN')}</span>
                                                                </div>
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full min-w-[760px] text-left text-xs">
                                                                        <thead className="border-b border-slate-100 text-[9px] font-black uppercase text-slate-400 dark:border-slate-800">
                                                                            <tr>
                                                                                <th className="px-2 py-2">Phiếu trả NCC</th>
                                                                                <th className="px-2 py-2">Kho xuất</th>
                                                                                <th className="px-2 py-2 text-right">Số lượng</th>
                                                                                <th className="px-2 py-2">Trạng thái</th>
                                                                                <th className="px-2 py-2">Phiếu WMS</th>
                                                                                <th className="px-2 py-2">Lý do</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                                            {supplierReturns.map(item => {
                                                                                const quantity = item.lines.reduce((sum, line) => sum + Number(line.returnQty || 0), 0);
                                                                                const warehouse = warehouses.find(row => row.id === item.sourceWarehouseId);
                                                                                const statusLabel = item.status === 'completed' ? 'Đã trả NCC' : item.status === 'cancelled' ? 'Đã huỷ' : 'Chờ WMS duyệt';
                                                                                const statusClass = item.status === 'completed'
                                                                                    ? 'bg-emerald-50 text-emerald-700'
                                                                                    : item.status === 'cancelled'
                                                                                        ? 'bg-slate-100 text-slate-500'
                                                                                        : 'bg-amber-50 text-amber-700';
                                                                                return (
                                                                                    <tr key={item.id}>
                                                                                        <td className="px-2 py-2 font-black text-rose-700">{item.returnNo}</td>
                                                                                        <td className="px-2 py-2 font-bold text-slate-600">{warehouse?.name || item.sourceWarehouseId}</td>
                                                                                        <td className="px-2 py-2 text-right font-black text-slate-700">{quantity.toLocaleString('vi-VN')}</td>
                                                                                        <td className="px-2 py-2"><span className={`rounded px-2 py-1 text-[9px] font-black ${statusClass}`}>{statusLabel}</span></td>
                                                                                        <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{item.transactionId}</td>
                                                                                        <td className="max-w-xs px-2 py-2 text-slate-500">{item.reason}</td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Bottom Section: Command Bar for Leaders */}
                                                        {(canManageTab || canRunRestrictedPoActions) && (
                                                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                                    ⚡️ Thao tác phê duyệt & trạng thái
                                                                </div>
                                                                <div className="flex flex-wrap gap-2 justify-end">
                                                                    {canManageTab && po.status === 'draft' && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'sent')} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm border-0 cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0">
                                                                            <Send size={13} /> Gửi duyệt PO
                                                                        </button>
                                                                    )}
                                                                    {canManageTab && po.status === 'sent' && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'confirmed')} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/10 border-0 cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0">
                                                                            <CheckCircle2 size={14} /> Duyệt PO (Đặt hàng)
                                                                        </button>
                                                                    )}
                                                                    {canManageTab && (po.status === 'sent' || po.status === 'confirmed') && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'draft')} className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 border-solid font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all">
                                                                            <RefreshCcw size={13} /> Huỷ duyệt
                                                                        </button>
                                                                    )}
                                                                    {canManageTab && po.status === 'confirmed' && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'in_transit')} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm border-0 cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0">
                                                                            <Truck size={13} /> Đánh dấu đang giao
                                                                        </button>
                                                                    )}
                                                                    {canRunRestrictedPoActions && po.status === 'in_transit' && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'returned')} className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 border-solid font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all">
                                                                            <RefreshCcw size={13} /> Trả lại / hoàn hàng
                                                                        </button>
                                                                    )}
                                                                    {canManageTab && po.status === 'partial' && getPoReceiptStats(po).remainingQty > 0 && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'delivered')} className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black text-xs flex items-center gap-1.5 shadow-sm border-0 cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0">
                                                                            <CheckCircle2 size={13} /> Xác nhận hoàn thành đơn
                                                                        </button>
                                                                    )}
                                                                    {canManageTab && po.status === 'delivered' && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'closed')} className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 border-0 cursor-pointer transition-all">
                                                                            <FileText size={13} /> Đóng PO
                                                                        </button>
                                                                    )}
                                                                    {canRunRestrictedPoActions && ['partial', 'delivered', 'closed'].includes(po.status) && supplierReturnableQty > 0 && (
                                                                        <button onClick={() => setSupplierReturnPo(po)} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 border-0 cursor-pointer transition-all">
                                                                            <PackageX size={13} /> Trả hàng NCC ({supplierReturnableQty.toLocaleString('vi-VN')})
                                                                        </button>
                                                                    )}
                                                                    {canRunRestrictedPoActions && po.status === 'closed' && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'returned')} className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 border-solid font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all">
                                                                            <RefreshCcw size={13} /> Hoàn trả PO đã đóng
                                                                        </button>
                                                                    )}
                                                                    {canRunRestrictedPoActions && !['cancelled', 'closed', 'delivered', 'returned'].includes(po.status) && (
                                                                        <button onClick={() => updatePoStatus(po.id, 'cancelled')} className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 border-solid font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all">
                                                                            <Ban size={13} /> Huỷ PO
                                                                        </button>
                                                                    )}
                                                                    {['cancelled', 'returned'].includes(po.status) && (
                                                                        <span className="px-3 py-2 rounded-lg bg-slate-50 text-slate-400 border border-slate-200 border-solid text-xs font-bold">
                                                                            Không còn thao tác trạng thái
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {showRequestPicker && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-5xl max-h-[86vh] overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="font-black text-lg text-slate-800">Tạo PO từ đề xuất công trường</h3>
                                <p className="text-xs font-bold text-slate-400">Có thể chọn nhiều dòng từ nhiều phiếu; hệ thống giữ link theo từng dòng đề xuất.</p>
                            </div>
                            <button onClick={() => setShowRequestPicker(false)} className="w-8 h-8 rounded-xl text-slate-400 hover:bg-slate-100 flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="overflow-auto flex-1">
                            <table className="w-full text-xs min-w-[1040px]">
                                <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase sticky top-0 whitespace-nowrap">
                                    <tr>
                                        <th className="px-4 py-3 text-center w-12"></th>
                                        <th className="px-4 py-3 text-left w-36">Phiếu</th>
                                        <th className="px-4 py-3 text-left">BOQ / Vật tư</th>
                                        <th className="px-4 py-3 text-right w-20">YC</th>
                                        <th className="px-4 py-3 text-right w-20">Đã cấp</th>
                                        <th className="px-4 py-3 text-right w-24">PO mở</th>
                                        <th className="px-4 py-3 text-right w-24">Còn lại</th>
                                        <th className="px-4 py-3 text-right w-32">Quy đổi mua</th>
                                        <th className="px-4 py-3 text-right w-32">Tạm tính</th>
                                        <th className="px-4 py-3 text-left w-28">Ngày cần</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                    {scopedRequestLines.map(row => {
                                        const inv = inventoryItems.find(item => item.id === row.line.itemId);
                                        const work = row.line.workBoqItemId ? workBoqMap.get(row.line.workBoqItemId) : undefined;
                                        const remaining = row.remainingQty;
                                        const conversionLine = normalizePoItem({
                                            lineId: row.requestLineId,
                                            itemId: row.line.itemId,
                                            ...buildPoUnitSnapshot(inv),
                                            sku: inv?.sku || row.line.skuSnapshot || '',
                                            name: inv?.name || row.line.itemNameSnapshot || row.line.materialBudgetItemName || '',
                                        }, inventoryItems);
                                        const purchaseUnit = getPoLinePurchaseUnit(conversionLine, inv);
                                        const stockUnit = getPoLineStockUnit(conversionLine, inv) || row.line.unitSnapshot || '';
                                        const purchaseQty = poLineStockToPurchaseQty(conversionLine, remaining, inv);
                                        const purchaseUnitPrice = stockUnitPriceToPurchaseUnitPrice(Number(inv?.priceIn || 0), inv);
                                        const estimatedAmount = purchaseQty * purchaseUnitPrice;
                                        const lineName = inv?.name || row.line.itemNameSnapshot || row.line.materialBudgetItemName || row.line.itemId;
                                        return (
                                            <tr key={row.key} className="hover:bg-amber-50/40">
                                                <td className="px-4 py-3 text-center whitespace-nowrap">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedRequestLineKeys.includes(row.key)}
                                                        onChange={event => setSelectedRequestLineKeys(prev => event.target.checked ? [...prev, row.key] : prev.filter(key => key !== row.key))}
                                                        className="accent-amber-500"
                                                    />
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <div className="font-mono font-black text-indigo-600">{row.request.code}</div>
                                                    <div className="text-[10px] text-slate-400">{new Date(row.request.createdDate).toLocaleDateString('vi-VN')}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-slate-700">{lineName}</div>
                                                    <div className="text-[10px] text-slate-400">
                                                        {work?.wbsCode ? `${work.wbsCode} - ` : ''}{row.line.workBoqItemName || work?.name || 'Ngoài BOQ'}
                                                        {row.line.materialBudgetItemName ? ` • ${row.line.materialBudgetItemName}` : ''}
                                                    </div>
                                                    {row.line.isManualItem ? <div className="text-[10px] font-bold text-amber-600">Dòng cần cấp mã vật tư trước</div> : null}
                                                    {row.line.overBudgetQtySnapshot ? <div className="text-[10px] font-bold text-orange-600">Vượt định mức: {row.line.overBudgetReason || 'Đã nhập lý do'}</div> : null}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{row.requestedQty.toLocaleString('vi-VN')} {stockUnit}</td>
                                                <td className="px-4 py-3 text-right text-blue-600 font-bold whitespace-nowrap">{row.stockCoveredQty.toLocaleString('vi-VN')} {stockUnit}</td>
                                                <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{row.orderedQty.toLocaleString('vi-VN')} {stockUnit}</td>
                                                <td className="px-4 py-3 text-right font-black text-amber-700 whitespace-nowrap">{remaining.toLocaleString('vi-VN')} {stockUnit}</td>
                                                <td className="px-4 py-3 text-right font-black text-cyan-700 whitespace-nowrap">
                                                    {purchaseQty.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {purchaseUnit}
                                                </td>
                                                <td className="px-4 py-3 text-right font-black text-emerald-700 whitespace-nowrap">
                                                    {purchaseUnitPrice > 0 ? `${fmt(estimatedAmount)} đ` : '—'}
                                                    {purchaseUnitPrice > 0 && (
                                                        <div className="text-[9px] font-bold text-slate-400">
                                                            {fmt(purchaseUnitPrice)} đ/{purchaseUnit}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{row.line.neededDate || row.request.expectedDate?.slice(0, 10) || '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowRequestPicker(false)} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100">Đóng</button>
                            <button onClick={openPoFromSelectedRequests} disabled={selectedRequestLineKeys.length === 0}
                                className="px-6 py-2.5 rounded-xl text-sm font-black text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50">
                                Đưa vào PO ({selectedRequestLineKeys.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Vendor Form Modal */}
            {showVendorForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingVendor ? <><Edit2 size={18} /> Sửa NCC</> : <><Plus size={18} /> Thêm NCC</>}
                            </span>
                            <button onClick={resetVendorForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên NCC *</label>
                                <input value={vName} onChange={e => setVName(e.target.value)} placeholder="VD: Công ty TNHH Xi măng ABC"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Người liên hệ</label>
                                    <input value={vContact} onChange={e => setVContact(e.target.value)} placeholder="Tên"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Điện thoại *</label>
                                    <input value={vPhone} onChange={e => setVPhone(e.target.value)} placeholder="0901..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Email</label>
                                    <input value={vEmail} onChange={e => setVEmail(e.target.value)} placeholder="email@..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mã số thuế</label>
                                    <input value={vTax} onChange={e => setVTax(e.target.value)} placeholder="MST"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Địa chỉ</label>
                                <input value={vAddress} onChange={e => setVAddress(e.target.value)} placeholder="Địa chỉ..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đánh giá</label>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(s => (
                                        <button key={s} onClick={() => setVRating(s)} className="p-1">
                                            <Star size={20} className={s <= vRating ? 'fill-amber-400 text-amber-400' : 'text-slate-200 hover:text-amber-300'} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Loại vật tư cung cấp</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {VENDOR_CATS.map(c => (
                                        <button key={c} onClick={() => setVCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${vCats.includes(c) ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={vNotes} onChange={e => setVNotes(e.target.value)} rows={2} placeholder="..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-cyan-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetVendorForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveVendor} disabled={!vName || !vPhone}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingVendor ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PO Form Modal */}
            {showPoForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingPo ? <><Edit2 size={18} /> Sửa PO</> : <><Plus size={18} /> Tạo đơn hàng</>}
                            </span>
                            <button onClick={savingPo ? undefined : resetPoForm} disabled={savingPo} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-50"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số PO</label>
                                    <input value={pNum} onChange={e => setPNum(e.target.value)} placeholder="PO-001"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NCC mặc định</label>
                                    <SupplierCombobox
                                        value={pVendorId}
                                        suppliers={partners}
                                        onChange={supplier => {
                                            setPVendorId(supplier?.id || '');
                                            if (supplier) {
                                                setPItems(prev => prev.map(item => item.vendorId ? item : {
                                                    ...item,
                                                    vendorId: supplier.id,
                                                    vendorName: supplier.name,
                                                }));
                                            }
                                        }}
                                        inputClassName="rounded-xl py-2.5 text-sm"
                                    />
                                    <p className="mt-1 text-[10px] font-bold text-slate-400">Dùng để tự điền NCC cho các dòng chưa chọn. Mỗi dòng vẫn có thể chọn NCC riêng.</p>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nguồn mua hàng</label>
                                <select
                                    value={pSourceMode}
                                    disabled={poHasRequestLines}
                                    onChange={e => setPSourceMode(e.target.value as PurchaseOrderSourceMode)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                    <option value="proactive_project">Mua chủ động cho dự án</option>
                                    <option value="proactive_stock">Mua dự trữ kho tổng</option>
                                    <option value="from_request">Từ đề xuất công trường</option>
                                </select>
                                {poHasRequestLines && <p className="mt-1 text-[10px] font-bold text-amber-600">PO đang có dòng từ đề xuất nên giữ nguồn “Từ đề xuất công trường”.</p>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày đặt</label>
                                    <input type="date" value={pDate} onChange={e => setPDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày giao dự kiến</label>
                                    <input type="date" value={pExpDate} onChange={e => setPExpDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Kho nhận *</label>
                                    <select value={pTargetWarehouseId} onChange={e => setPTargetWarehouseId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option value="">— Chọn kho —</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                                    <span>Danh sách vật tư</span>
                                    <div className="flex items-center gap-2">
                                        <button onClick={handleDownloadPoTemplate}
                                            className="text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"><FileSpreadsheet size={10} /> Mẫu</button>
                                        <label onClick={() => openPoImport('create')} className={`text-blue-500 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer ${importingPo ? 'opacity-60 pointer-events-none' : ''}`}>
                                            {importingPo && poImportMode === 'create' ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} Nhập mới
                                            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportPoExcel} disabled={importingPo} />
                                        </label>
                                        <label onClick={() => openPoImport('update')} className={`text-violet-500 hover:text-violet-700 flex items-center gap-0.5 cursor-pointer ${importingPo ? 'opacity-60 pointer-events-none' : ''}`}>
                                            {importingPo && poImportMode === 'update' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCcw size={10} />} Cập nhật
                                            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportPoExcel} disabled={importingPo} />
                                        </label>
                                        <button onClick={() => setPItems([...pItems, createEmptyPoItem()])}
                                            className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5"><Plus size={10} /> Thêm dòng</button>
                                    </div>
                                </label>
                                <div className="space-y-2 mt-2">
                                    {pItems.map((item, i) => {
                                        const normalizedLine = normalizePoItem(item, inventoryItems);
                                        const previewLine = pSourceMode === 'proactive_stock' ? normalizedLine : buildPoBudgetSnapshot(normalizedLine);
                                        const overBudgetQty = Number(previewLine.overBudgetQtySnapshot || 0);
                                        const rowWork = item.workBoqItemId ? workBoqMap.get(item.workBoqItemId) : undefined;
                                        const inventory = inventoryItems.find(inv => inv.id === previewLine.itemId);
                                        const purchaseUnit = getPoLinePurchaseUnit(previewLine, inventory);
                                        const stockUnit = getPoLineStockUnit(previewLine, inventory);
                                        const stockQtyPreview = poLinePurchaseToStockQty(previewLine, Number(previewLine.qty || 0), inventory);
                                        const lineTotalPreview = calculateLineTotal(previewLine);
                                        const hasUnitConversion = hasPurchaseUnitConversion({
                                            unit: stockUnit,
                                            purchaseUnit,
                                            purchaseConversionFactor: previewLine.purchaseConversionFactor ?? inventory?.purchaseConversionFactor ?? 1,
                                        });
                                        return (
                                            <div key={i} className="grid grid-cols-12 gap-2 items-start rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                                                {pSourceMode !== 'proactive_stock' && (
                                                    <select
                                                        value={item.materialBudgetItemId || ''}
                                                        onChange={e => selectPoBudgetItem(i, e.target.value)}
                                                        disabled={!!item.requestId}
                                                        className="col-span-12 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                                    >
                                                        <option value="">Gắn BOQ triển khai / định mức vật tư (tuỳ chọn)</option>
                                                        {materialBudgetItems.map(budget => {
                                                            const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
                                                            return (
                                                                <option key={budget.id} value={budget.id}>
                                                                    {work?.wbsCode ? `${work.wbsCode} - ` : ''}{budget.itemName} ({Number(budget.budgetQty || 0).toLocaleString('vi-VN')} {budget.unit})
                                                                </option>
                                                            );
                                                        })}
                                                    </select>
                                                )}
                                                <InventoryItemCombobox
                                                    value={item.isManualItem ? '' : item.itemId}
                                                    items={inventoryItems}
                                                    onChange={selected => selectPoInventoryItem(i, selected?.id || '')}
                                                    className="col-span-12 md:col-span-4"
                                                />
                                                <SupplierCombobox
                                                    value={item.vendorId || ''}
                                                    suppliers={partners}
                                                    onChange={supplier => updatePoItem(i, {
                                                        vendorId: supplier?.id || null,
                                                        vendorName: supplier?.name || null,
                                                    })}
                                                    placeholder="NCC dòng vật tư..."
                                                    className="col-span-12 md:col-span-4"
                                                />
                                                <div className="col-span-4 md:col-span-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-500 font-bold truncate">
                                                    {purchaseUnit || item.unit || 'ĐVT'}
                                                </div>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={1}
                                                    value={item.qty || ''}
                                                    onChange={e => updatePoItem(i, { qty: Number(e.target.value) || 0 })}
                                                    placeholder="SL"
                                                    className="col-span-4 md:col-span-1 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={item.unitPrice || ''}
                                                    onChange={e => updatePoItem(i, { unitPrice: Number(e.target.value) || 0 })}
                                                    placeholder="Đơn giá"
                                                    className="col-span-4 md:col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                                <input
                                                    type="date"
                                                    value={item.neededDate || ''}
                                                    onChange={e => updatePoItem(i, { neededDate: e.target.value })}
                                                    className="col-span-6 md:col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                                />
                                                <input
                                                    value={item.note || ''}
                                                    onChange={e => updatePoItem(i, { note: e.target.value })}
                                                    placeholder="Ghi chú"
                                                    className="col-span-2 md:col-span-7 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSpecsPanel(i)}
                                                    className={`col-span-3 md:col-span-2 h-9 rounded-lg text-xs font-bold border transition-colors flex items-center justify-center gap-1 ${(item.pricingMode && item.pricingMode !== 'standard') || (item.specs && Object.keys(item.specs).length > 0)
                                                        ? 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                                                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                                        }`}
                                                >
                                                    📐 QC {expandedSpecsIdx.has(i) ? '▲' : '▼'}
                                                </button>
                                                <button
                                                    onClick={() => setPItems(pItems.length > 1 ? pItems.filter((_, j) => j !== i) : [createEmptyPoItem()])}
                                                    className="col-span-1 h-9 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center bg-transparent border-0 cursor-pointer"
                                                >
                                                    <X size={14} />
                                                </button>
                                                {(item.isManualItem || item.requestCode || item.materialBudgetItemName || item.workBoqItemName || rowWork?.name || overBudgetQty > 0 || hasUnitConversion || (item.specs && Object.keys(item.specs).length > 0)) && (
                                                    <div className="col-span-12 flex flex-wrap gap-1">
                                                        {item.isManualItem && <span className="px-1.5 py-0.5 rounded border border-rose-100 bg-rose-50 text-[9px] font-bold text-rose-700">Cần cấp mã vật tư trước</span>}
                                                        {item.requestCode && <span className="px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-[9px] font-bold text-amber-700">YC {item.requestCode}</span>}
                                                        {(item.workBoqItemName || rowWork?.name) && <span className="px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[9px] font-bold text-blue-700">{rowWork?.wbsCode ? `${rowWork.wbsCode} - ` : ''}{item.workBoqItemName || rowWork?.name}</span>}
                                                        {item.materialBudgetItemName && <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] font-bold text-emerald-700">{item.materialBudgetItemName}</span>}
                                                        {overBudgetQty > 0 && <span className="px-1.5 py-0.5 rounded border border-orange-100 bg-orange-50 text-[9px] font-bold text-orange-700">Vượt {overBudgetQty.toLocaleString('vi-VN')} {stockUnit || previewLine.unit}</span>}
                                                        {hasUnitConversion && (
                                                            <span className="px-1.5 py-0.5 rounded border border-cyan-100 bg-cyan-50 text-[9px] font-bold text-cyan-700">
                                                                Nhập kho {fmtQty(stockQtyPreview)} {stockUnit} (1 {purchaseUnit} = {fmtQty(Number(previewLine.purchaseConversionFactor || inventory?.purchaseConversionFactor || 1))} {stockUnit})
                                                            </span>
                                                        )}
                                                        {Number(previewLine.qty || 0) > 0 && Number(previewLine.unitPrice || 0) > 0 && (
                                                            <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] font-bold text-emerald-700">
                                                                Tính tiền {fmtQty(Number(previewLine.qty || 0))} {purchaseUnit || previewLine.unit} × {fmt(Number(previewLine.unitPrice || 0))} = {fmt(lineTotalPreview)} đ
                                                            </span>
                                                        )}
                                                        {formatSpecsSummary(item).map((badge, bIdx) => (
                                                            <span key={bIdx} className="px-1.5 py-0.5 rounded border border-violet-100 bg-violet-50 text-[9px] font-bold text-violet-700">
                                                                {badge}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Specs Form Panel */}
                                                {expandedSpecsIdx.has(i) && (
                                                    <div className="col-span-12 mt-2 p-3 bg-white border border-slate-200 rounded-xl space-y-3">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Mẫu quy cách nhanh:</span>
                                                            <div className="flex flex-wrap gap-1">
                                                                {Object.entries(SPEC_PRESETS).map(([key, preset]) => {
                                                                    const isPresetActive = item.pricingMode === preset.pricingMode && item.specs && Object.keys(item.specs).every(k => preset.fields.some(f => f.key === k));
                                                                    return (
                                                                        <button
                                                                            key={key}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const nextSpecs: Record<string, SpecValue> = {};
                                                                                preset.fields.forEach(f => {
                                                                                    nextSpecs[f.key] = { value: '', label: f.label, unit: f.unit };
                                                                                });
                                                                                updatePoItem(i, {
                                                                                    pricingMode: preset.pricingMode,
                                                                                    specs: nextSpecs,
                                                                                    computedArea: undefined,
                                                                                    computedWeight: undefined
                                                                                });
                                                                            }}
                                                                            className={`px-2 py-1 rounded text-[10px] font-semibold border ${isPresetActive
                                                                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                                                                }`}
                                                                        >
                                                                            {preset.label}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-12 gap-2">
                                                            <div className="col-span-12 md:col-span-6">
                                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Phương thức tính giá</label>
                                                                <select
                                                                    value={item.pricingMode || 'standard'}
                                                                    onChange={e => {
                                                                        const mode = e.target.value as PricingMode;
                                                                        updatePoItem(i, {
                                                                            pricingMode: mode,
                                                                            computedArea: mode === 'by_area' ? calculateArea(item.specs) : undefined,
                                                                            computedWeight: mode === 'by_weight' ? getSpecNumeric(item.specs, 'weight') : undefined,
                                                                        });
                                                                    }}
                                                                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-700"
                                                                >
                                                                    <option value="standard">Tiêu chuẩn (SL × Đơn giá)</option>
                                                                    <option value="by_area">Theo diện tích (Rộng × Cao × SL × Đơn giá/m²)</option>
                                                                    <option value="by_length">Theo chiều dài (Dài × SL × Đơn giá/m)</option>
                                                                    <option value="by_weight">Theo trọng lượng (Trọng lượng × SL × Đơn giá/kg)</option>
                                                                    <option value="by_volume">Theo thể tích (Rộng × Cao × Dài × SL × Đơn giá/m³)</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        {item.specs && Object.keys(item.specs).length > 0 && (
                                                            <div className="grid grid-cols-12 gap-2 mt-2 pt-2 border-t border-slate-100">
                                                                {Object.entries(item.specs).map(([key, specVal]) => {
                                                                    const isText = DEFAULT_SPEC_METADATA[key]?.unit === '';
                                                                    return (
                                                                        <div key={key} className="col-span-6 md:col-span-3">
                                                                            <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                                                                {specVal.label || key} {specVal.unit ? `(${specVal.unit})` : ''}
                                                                            </label>
                                                                            <div className="relative flex items-center">
                                                                                <input
                                                                                    type={isText ? 'text' : 'number'}
                                                                                    value={specVal.value ?? ''}
                                                                                    onChange={e => {
                                                                                        const val = e.target.value;
                                                                                        const nextSpecs = { ...(item.specs || {}) };
                                                                                        nextSpecs[key] = {
                                                                                            ...specVal,
                                                                                            value: isText ? val : (Number(val) || 0)
                                                                                        };
                                                                                        const area = item.pricingMode === 'by_area' ? calculateArea(nextSpecs) : undefined;
                                                                                        const weight = item.pricingMode === 'by_weight' ? getSpecNumeric(nextSpecs, 'weight') : undefined;
                                                                                        updatePoItem(i, {
                                                                                            specs: nextSpecs,
                                                                                            computedArea: area,
                                                                                            computedWeight: weight
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập..."
                                                                                    className="w-full pl-2 pr-6 py-1.5 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-700"
                                                                                />
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        const nextSpecs = { ...(item.specs || {}) };
                                                                                        delete nextSpecs[key];
                                                                                        updatePoItem(i, { specs: nextSpecs });
                                                                                    }}
                                                                                    className="absolute right-1 top-1 w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500 bg-transparent border-0 cursor-pointer"
                                                                                    title="Xoá thuộc tính này"
                                                                                >
                                                                                    <X size={10} />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-100">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase">Thêm nhanh thuộc tính khác:</span>
                                                            {Object.entries(DEFAULT_SPEC_METADATA)
                                                                .filter(([k]) => !item.specs || !item.specs[k])
                                                                .slice(0, 8)
                                                                .map(([k, meta]) => (
                                                                    <button
                                                                        key={k}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const nextSpecs = { ...(item.specs || {}) };
                                                                            nextSpecs[k] = { value: '', label: meta.label, unit: meta.unit };
                                                                            updatePoItem(i, { specs: nextSpecs });
                                                                        }}
                                                                        className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[9px] text-slate-600 font-semibold border-0 cursor-pointer"
                                                                    >
                                                                        + {meta.label}
                                                                    </button>
                                                                ))}
                                                        </div>

                                                        <div className="mt-2.5 p-2 bg-slate-50 border border-slate-150 rounded-lg text-xs space-y-1">
                                                            {item.pricingMode === 'by_area' && (
                                                                <div className="text-slate-600">
                                                                    📐 Diện tích tính toán: <span className="font-bold text-slate-800">{calculateArea(item.specs)} m²</span>
                                                                    {item.specs?.width?.value && item.specs?.height?.value && (
                                                                        <span className="text-[10px] text-slate-400 ml-1">
                                                                            (tính từ {item.specs.width.value} × {item.specs.height.value} mm)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {item.pricingMode === 'by_length' && (
                                                                <div className="text-slate-600">
                                                                    📐 Chiều dài tính toán: <span className="font-bold text-slate-800">{(getSpecNumeric(item.specs, 'length') / 1000)} m</span>
                                                                    {item.specs?.length?.value && (
                                                                        <span className="text-[10px] text-slate-400 ml-1">
                                                                            (tính từ {item.specs.length.value} mm)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {item.pricingMode === 'by_weight' && (
                                                                <div className="text-slate-600">
                                                                    📐 Trọng lượng tính toán: <span className="font-bold text-slate-800">{getSpecNumeric(item.specs, 'weight')} kg</span>
                                                                </div>
                                                            )}
                                                            {item.pricingMode === 'by_volume' && (
                                                                <div className="text-slate-600">
                                                                    📐 Thể tích tính toán: <span className="font-bold text-slate-800">{calculateVolume(item.specs)} m³</span>
                                                                </div>
                                                            )}
                                                            <div className="text-blue-700 font-bold flex flex-wrap items-center justify-between">
                                                                <span>Công thức & Thành tiền tạm tính:</span>
                                                                <span>
                                                                    {formatPricingFormula(item)} = <span className="text-sm font-black underline">{calculateLineTotal(item).toLocaleString('vi-VN')} đ</span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {overBudgetQty > 0 && pSourceMode !== 'proactive_stock' && (
                                                    <input
                                                        value={item.overBudgetReason || ''}
                                                        onChange={e => updatePoItem(i, { overBudgetReason: e.target.value })}
                                                        placeholder="Nhập lý do mua vượt ngân sách/định mức"
                                                        className="col-span-12 px-2.5 py-2 rounded-lg border border-orange-200 bg-orange-50 text-xs font-bold text-orange-700 focus:ring-2 focus:ring-orange-400 outline-none"
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            {poTotalCalc > 0 && (
                                <div className="px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-xs flex items-center justify-between">
                                    <span className="text-blue-400">Tổng giá trị:</span>
                                    <span className="font-black text-blue-700 text-sm">{fmt(poTotalCalc)} đ</span>
                                </div>
                            )}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={pNote} onChange={e => setPNote(e.target.value)} rows={2} placeholder="..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetPoForm} disabled={savingPo} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">Huỷ</button>
                            <button onClick={handleSavePo} disabled={savingPo || !pNum || !pTargetWarehouseId}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg flex items-center gap-2 disabled:opacity-50">
                                {savingPo ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {savingPo ? (editingPo ? 'Đang lưu...' : 'Đang tạo...') : (editingPo ? 'Lưu' : 'Tạo')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {submittingPo && (
                <ProjectSubmissionDialog
                    title="Gửi đơn hàng vật tư"
                    actionLabel="Gửi đơn"
                    documentLabel="PO vật tư"
                    documentName={`${submittingPo.poNumber} • ${submittingPo.vendorName || 'Nhà cung cấp'}`}
                    documentSubtitle={`Trạng thái hiện tại: ${PO_STATUS[submittingPo.status].label}`}
                    projectId={projectId}
                    constructionSiteId={constructionSiteId || submittingPo.constructionSiteId}
                    recipientPermissionCodes={['confirm']}
                    recipientHint="Chọn đích danh người nhận/xác nhận đơn hàng vật tư."
                    details={[
                        { label: 'Nhà cung cấp', value: submittingPo.vendorName || '-' },
                        { label: 'Tổng giá trị', value: `${fmt(submittingPo.totalAmount)} đ` },
                        { label: 'Số dòng', value: `${submittingPo.items.length} dòng vật tư` },
                        { label: 'Ngày cần giao', value: submittingPo.expectedDeliveryDate || '-' },
                    ]}
                    onCancel={() => setSubmittingPo(null)}
                    onConfirm={target => updatePoStatus(submittingPo.id, 'sent', target)}
                />
            )}
            <PurchaseOrderSupplierReturnDialog
                purchaseOrder={supplierReturnPo}
                warehouses={warehouses}
                inventoryItems={inventoryItems}
                existingReturns={supplierReturnPo ? supplierReturnsByPo[supplierReturnPo.id] || [] : []}
                onClose={() => setSupplierReturnPo(null)}
                onCreated={async () => {
                    await Promise.all([
                        loadSupplyData(),
                        loadModuleData('wms-core', true),
                    ]);
                }}
            />
        </div>
    );
};

export default SupplyChainTab;
