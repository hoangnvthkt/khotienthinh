import React, { useState, useMemo, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    Plus, Edit2, Trash2, X, Save, Truck, Star, Phone, Mail, MapPin,
    FileText, CheckCircle2, Clock, Ban, Send, Package, ChevronDown,
    ChevronUp, Users, DollarSign, ShoppingCart, AlertTriangle, FileSpreadsheet,
    Upload, Printer, QrCode, Loader2, RefreshCcw
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
    PurchaseOrderSourceMode,
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
import { projectSubmissionService } from '../../lib/projectSubmissionService';
import SupplierCombobox from '../../components/SupplierCombobox';
import { useReservedStock } from '../../hooks/useReservedStock';
import { formatReservationSourceList } from '../../lib/inventoryStockGuard';
import { materialRequestService } from '../../lib/materialRequestService';

interface SupplyChainTabProps {
    constructionSiteId?: string;
    projectId?: string;
    canManageTab?: boolean;
    compact?: boolean;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const PO_STATUS: Record<POStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Clock size={12} /> },
    sent: { label: 'Đã gửi', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Send size={12} /> },
    confirmed: { label: 'Đã duyệt', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
    in_transit: { label: 'Đang giao', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200', icon: <Truck size={12} /> },
    partial: { label: 'Giao 1 phần', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', icon: <Package size={12} /> },
    delivered: { label: 'Đã giao', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={12} /> },
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

const createEmptyPoItem = (): PurchaseOrderItem => ({
    lineId: crypto.randomUUID(),
    itemId: '',
    vendorId: null,
    vendorName: null,
    sku: '',
    name: '',
    unit: '',
    qty: 0,
    unitPrice: 0,
    neededDate: '',
    note: '',
});

const normalizePoItem = (item: Partial<PurchaseOrderItem>, inventoryItems: InventoryItem[]): PurchaseOrderItem => {
    const matched = inventoryItems.find(inv =>
        inv.id === item.itemId ||
        (!!item.sku && inv.sku.toLowerCase() === item.sku.toLowerCase()) ||
        (!!item.name && inv.name.toLowerCase() === item.name.toLowerCase())
    );

    return {
        itemId: item.itemId || matched?.id || '',
        lineId: item.lineId || crypto.randomUUID(),
        vendorId: item.vendorId || null,
        vendorName: item.vendorName || null,
        sku: item.sku || matched?.sku || '',
        name: item.name || matched?.name || '',
        unit: item.unit || matched?.unit || '',
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
        previousRequestedQtySnapshot: Number(item.previousRequestedQtySnapshot || 0),
        previousOrderedQtySnapshot: Number(item.previousOrderedQtySnapshot || 0),
        previousReceivedQtySnapshot: Number(item.previousReceivedQtySnapshot || 0),
        overBudgetQtySnapshot: Number(item.overBudgetQtySnapshot || 0),
        overBudgetPercentSnapshot: Number(item.overBudgetPercentSnapshot || 0),
        overBudgetReason: item.overBudgetReason || '',
        isManualItem: item.isManualItem || (!matched && !!item.itemId?.startsWith('manual-')),
        itemNameSnapshot: item.itemNameSnapshot || item.name || matched?.name || '',
        unitSnapshot: item.unitSnapshot || item.unit || matched?.unit || '',
        specification: item.specification || '',
        manualReason: item.manualReason || '',
        note: item.note || '',
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

const SupplyChainTab: React.FC<SupplyChainTabProps> = ({ constructionSiteId, projectId, canManageTab = true, compact = false }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const { items: inventoryItems, warehouses, requests: materialRequests, loadModuleData, user, addTransaction, updateRequestStatus } = useApp();
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

    const ensureCanManage = (action: string) => {
        if (canManageTab) return true;
        toast.warning('Không có quyền quản trị tab', `Bạn cần quyền quản trị "Cung ứng" để ${action}.`);
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
            setPos([...byId.values()]);
            setPoRequestLinks(linkRows);
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
    const [savingPo, setSavingPo] = useState(false);
    const poSubmitLockRef = useRef(false);
    const poImportModeRef = useRef<ExcelImportMode>('create');
    const poBoqMetaScopeRef = useRef<string | null>(null);
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
    const orderedQtyByRequestLine = useMemo(() => {
        const map = new Map<string, number>();
        poRequestLinks.forEach(link => {
            const key = `${link.materialRequestId}:${link.requestLineId}`;
            map.set(key, (map.get(key) || 0) + Number(link.orderedQty || 0));
        });
        return map;
    }, [poRequestLinks]);
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
            RequestStatus.COMPLETED,
            RequestStatus.LEGACY_PENDING,
            RequestStatus.LEGACY_APPROVED,
        ]);
        return scopedMaterialRequests
            .filter(req => allowedStatuses.has(req.status))
            .flatMap(req => (req.items || []).map((line, index) => {
                const requestLineId = line.lineId || `${req.id}-${index}`;
                const requestedQty = Number(line.requestQty || 0);
                const fulfillmentLine = requestFulfillmentSummaries[req.id]?.lineSummaries.find(summary => summary.requestLineId === getRequestLineId(req, line, index));
                const hasFulfillmentBatches = (requestFulfillmentBatchCounts[req.id] || 0) > 0;
                const stockCoveredQty = hasFulfillmentBatches ? (fulfillmentLine?.receivedQty || 0) : Number(line.issuedQty || 0);
                const orderedQty = orderedQtyByRequestLine.get(`${req.id}:${requestLineId}`) || 0;
                const remainingQty = Math.max(0, requestedQty - stockCoveredQty - orderedQty);
                return {
                    key: `${req.id}:${requestLineId}`,
                    request: req,
                    line,
                    requestLineId,
                    requestedQty,
                    stockCoveredQty,
                    orderedQty,
                    remainingQty,
                };
            }))
            .filter(row => row.remainingQty > 0)
            .filter(row => !row.line.isManualItem && inventoryItems.some(item => item.id === row.line.itemId));
    }, [inventoryItems, orderedQtyByRequestLine, requestFulfillmentBatchCounts, requestFulfillmentSummaries, scopedMaterialRequests]);
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
                    map.set(line.materialBudgetItemId, (map.get(line.materialBudgetItemId) || 0) + Number(line.qty || 0));
                });
            });
        return map;
    }, [editingPo?.id, pos]);
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
            return sum + Number(line.qty || 0);
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
        const totalCommitted = previousRequested + previousOrdered + currentOtherQty + Number(line.qty || 0);
        const overBudgetQty = Math.max(0, totalCommitted - Number(budget.budgetQty || 0));
        return {
            ...line,
            workBoqItemId: line.workBoqItemId || budget.workBoqItemId || null,
            workBoqItemName: line.workBoqItemName || work?.name || null,
            materialBudgetItemId: budget.id,
            materialBudgetItemName: line.materialBudgetItemName || budget.itemName,
            budgetQtySnapshot: Number(budget.budgetQty || 0),
            previousRequestedQtySnapshot: previousRequested,
            previousOrderedQtySnapshot: previousOrdered,
            previousReceivedQtySnapshot: Number(budget.cumulativeImported || 0),
            overBudgetQtySnapshot: overBudgetQty,
            overBudgetPercentSnapshot: budget.budgetQty > 0 ? Math.round((overBudgetQty / budget.budgetQty) * 1000) / 10 : 0,
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
                sku: inventory?.sku || row.line.skuSnapshot || '',
                name: inventory?.name || row.line.itemNameSnapshot || row.line.materialBudgetItemName || '',
                unit: inventory?.unit || row.line.unitSnapshot || budget?.unit || '',
                qty: remainingQty,
                unitPrice: inventory?.priceIn || budget?.budgetUnitPrice || 0,
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
                previousRequestedQtySnapshot: row.line.previousRequestedQtySnapshot,
                overBudgetQtySnapshot: row.line.overBudgetQtySnapshot,
                overBudgetPercentSnapshot: row.line.overBudgetPercentSnapshot,
                overBudgetReason: row.line.overBudgetReason,
                isManualItem: false,
                itemNameSnapshot: inventory?.name || row.line.itemNameSnapshot,
                unitSnapshot: inventory?.unit || row.line.unitSnapshot,
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
                previousRequestedQtySnapshot: 0,
                previousOrderedQtySnapshot: 0,
                previousReceivedQtySnapshot: 0,
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
            Number(line.overBudgetQtySnapshot || 0) > 0 &&
            !line.overBudgetReason?.trim()
        );
        if (missingOverBudgetReason) {
            toast.warning(
                'Cần nhập lý do vượt ngân sách',
                `${missingOverBudgetReason.materialBudgetItemName || missingOverBudgetReason.name} vượt ${Number(missingOverBudgetReason.overBudgetQtySnapshot || 0).toLocaleString('vi-VN')} ${missingOverBudgetReason.unit || ''}.`
            );
            return;
        }
        const totalAmount = validItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
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
                    requestedQty: Number(sourceLine?.requestQty || item.qty || 0),
                    orderedQty: Number(item.qty || 0),
                    unit: item.unit || null,
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
                    totalAmount: groupItems.reduce((s, i) => s + i.qty * i.unitPrice, 0),
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
                        totalAmount: groupItems.reduce((s, i) => s + i.qty * i.unitPrice, 0),
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
        if (!ensureCanManage('cập nhật trạng thái PO')) return;
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
                    summary: getStockSummary(item.itemId, po.targetWarehouseId!),
                })).find(item => {
                    const qty = Number(item.receivedQty || 0);
                    if (qty <= 0) return false;
                    return item.summary.available < qty;
                });
                if (invalidReturnLine) {
                    const needQty = Number(invalidReturnLine.returnQty || 0);
                    const reason = needQty > invalidReturnLine.summary.onHand
                        ? `tồn thực ${invalidReturnLine.summary.onHand.toLocaleString('vi-VN')}`
                        : `tồn thực ${invalidReturnLine.summary.onHand.toLocaleString('vi-VN')}, đang giữ ${invalidReturnLine.summary.reserved.toLocaleString('vi-VN')}, khả dụng ${invalidReturnLine.summary.available.toLocaleString('vi-VN')}`;
                    const blockers = formatReservationSourceList(invalidReturnLine.summary.entries);
                    toast.warning('Không đủ tồn để hoàn', `${invalidReturnLine.sku || invalidReturnLine.name} tại kho nhận cần hoàn ${needQty.toLocaleString('vi-VN')}; ${reason}.${blockers ? ` Vị trí giữ chỗ: ${blockers}.` : ''} Vui lòng xử lý phiếu pending/giữ chỗ trước khi hoàn PO.`);
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
                        .map(item => ({
                            itemId: item.itemId,
                            quantity: Number(item.receivedQty || 0),
                            price: Number(item.unitPrice || 0),
                        })),
                    sourceWarehouseId: po.targetWarehouseId,
                    requesterId: user.id,
                    approverId: user.id,
                    status: TransactionStatus.COMPLETED,
                    note: `Hoàn hàng NCC theo PO ${po.poNumber}${po.vendorName ? ` - ${po.vendorName}` : ''}`,
                };
                await addTransaction(transaction);
            }
            await poService.updateStatus(id, updated);
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
                            'FULFILLMENT_SYNC',
                        );
                    }
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
            sku: selected?.sku || '',
            name: selected?.name || '',
            unit: selected?.unit || '',
            unitPrice: selected?.priceIn || 0,
            isManualItem: false,
            itemNameSnapshot: selected?.name || '',
            unitSnapshot: selected?.unit || '',
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
                previousRequestedQtySnapshot: 0,
                previousOrderedQtySnapshot: 0,
                previousReceivedQtySnapshot: 0,
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
        updatePoItem(index, {
            itemId: inventory.id,
            ...(pItems[index]?.vendorId ? {} : getDefaultSupplierPatchForInventory(inventory)),
            sku: inventory.sku,
            name: inventory.name,
            unit: inventory.unit,
            unitPrice: inventory.priceIn || budget.budgetUnitPrice || pItems[index]?.unitPrice || 0,
            isManualItem: false,
            itemNameSnapshot: inventory.name,
            unitSnapshot: inventory.unit,
            workBoqItemId: budget.workBoqItemId || null,
            workBoqItemName: work?.name || null,
            materialBudgetItemId: budget.id,
            materialBudgetItemName: budget.itemName,
            budgetQtySnapshot: Number(budget.budgetQty || 0),
        });
    };

    const handleDownloadPoTemplate = async () => {
        const XLSX = await loadXlsx();
        const headers = [['Mã SKU *', 'Tên vật tư', 'ĐVT', 'Khối lượng đặt *', 'Đơn giá', 'Ngày cần', 'Ghi chú']];
        const sample = inventoryItems[0]
            ? [[inventoryItems[0].sku, inventoryItems[0].name, inventoryItems[0].unit, 10, inventoryItems[0].priceIn || 0, new Date().toISOString().split('T')[0], '']]
            : [];
        const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
        const wb = XLSX.utils.book_new();
        ws['!cols'] = [{ wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Nhap_moi');

        const updateWs = XLSX.utils.aoa_to_sheet([
            ['Mã SKU *', 'Khối lượng đặt', 'Đơn giá', 'Ngày cần', 'Ghi chú'],
            inventoryItems[0] ? [inventoryItems[0].sku, 20, inventoryItems[0].priceIn || 0, new Date().toISOString().split('T')[0], 'Cập nhật PO'] : ['STEEL-001', 20, 0, '', ''],
        ]);
        updateWs['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, updateWs, 'Cap_nhat');

        const guideWs = XLSX.utils.aoa_to_sheet([
            ['Chức năng', 'Cách dùng'],
            ['Nhập mới', 'Dùng sheet Nhap_moi để nạp danh sách vật tư vào PO đang tạo/sửa. SKU trùng trong PO sẽ báo lỗi.'],
            ['Cập nhật', 'Dùng sheet Cap_nhat hoặc file chỉ gồm Mã SKU và cột muốn sửa. SKU phải đang có trong PO form.'],
            ['Ô trống', 'Trong chế độ Cập nhật, ô trống nghĩa là không đổi dữ liệu.'],
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
                    sku: item?.sku || sku,
                    name: item?.name || '',
                    unit: item?.unit || '',
                    qty: 0,
                    unitPrice: item?.priceIn || 0,
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

    const buildPoPrintSection = (printablePo: PurchaseOrder, qrSvg: string, pageBreak = false) => {
        const targetWh = warehouses.find(w => w.id === printablePo.targetWarehouseId);
        const rowsHtml = printablePo.items.map((item, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.sku)}</td>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.unit)}</td>
                <td class="right">${Number(item.qty || 0).toLocaleString('vi-VN')}</td>
                <td class="right">${Number(item.unitPrice || 0).toLocaleString('vi-VN')}</td>
                <td>${escapeHtml(item.neededDate || printablePo.expectedDeliveryDate || '')}</td>
                <td>${escapeHtml(item.note || '')}</td>
            </tr>
        `).join('');

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
                            <th>STT</th>
                            <th>Mã hàng hoá</th>
                            <th>Tên hàng hoá</th>
                            <th>ĐVT</th>
                            <th>Khối lượng</th>
                            <th>Đơn giá</th>
                            <th>Ngày cần</th>
                            <th>Ghi chú</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                ${printablePo.note ? `<div class="note"><strong>Ghi chú:</strong> ${escapeHtml(printablePo.note)}</div>` : ''}
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
                body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
                .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
                h1 { margin: 0; font-size: 24px; letter-spacing: .02em; }
                .meta { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13px; }
                .label { color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 10px; }
                table { width: 100%; border-collapse: collapse; margin-top: 28px; font-size: 12px; }
                th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
                th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
                .right { text-align: right; }
                .qr { text-align: center; font-size: 10px; color: #64748b; font-weight: 700; }
                .note { margin-top: 20px; font-size: 12px; color: #475569; }
                .page-break { page-break-before: always; break-before: page; }
                @media print { body { margin: 18mm; } }
            </style>
        </head>
        <body>${sectionsHtml}</body>
        </html>
    `;

    const handlePrintPo = async (po: PurchaseOrder) => {
        setPrintingPoId(po.id);
        try {
            const printablePo = await poService.ensureQrToken(po);
            if (!po.qrToken) {
                setPos(prev => prev.map(item => item.id === po.id ? printablePo : item));
            }
            const receiveUrl = buildPoReceiveUrl(printablePo.qrToken!);
            const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={132} level="H" includeMargin />);
            const html = buildPoPrintHtml(printablePo.poNumber, buildPoPrintSection(printablePo, qrSvg));

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
            toast.error('Không thể in PO', getApiErrorMessage(e, 'Không thể tạo phiếu PO có QR.'));
        } finally {
            setPrintingPoId(null);
        }
    };

    const handlePrintPoGroup = async (groupId: string) => {
        const groupOrders = pos
            .filter(po => po.procurementGroupId === groupId)
            .sort((a, b) => a.poNumber.localeCompare(b.poNumber));
        if (groupOrders.length === 0) return;
        setPrintingPoId(groupId);
        try {
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
            const html = buildPoPrintHtml(printableOrders[0].procurementGroupNo || 'Nhóm PO', sections);
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
            toast.error('Không thể in nhóm PO', getApiErrorMessage(e, 'Không thể tạo bộ phiếu PO có QR.'));
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

    const poTotalCalc = useMemo(() => pItems.reduce((s, i) => s + i.qty * i.unitPrice, 0), [pItems]);
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

            {/* Vendor Tab */}
            {subTab === 'vendor' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
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
                                                            {[1,2,3,4,5].map(s => (
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
                                return (
                                    <div key={po.id}>
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
                                                        <button onClick={e => { e.stopPropagation(); handlePrintPo(po); }} title="In/PDF có QR"
                                                            disabled={printingPoId === po.id}
                                                            className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 disabled:opacity-50">
                                                            {printingPoId === po.id ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                                                        </button>
                                                        {po.procurementGroupId && groupSize > 1 && (
                                                            <button onClick={e => { e.stopPropagation(); handlePrintPoGroup(po.procurementGroupId!); }} title="In tất cả PO trong nhóm"
                                                                disabled={printingPoId === po.procurementGroupId}
                                                                className="h-7 rounded-lg px-2 text-[9px] font-black text-violet-500 hover:bg-violet-50 hover:text-violet-700 border border-transparent hover:border-violet-200 disabled:opacity-50">
                                                                {printingPoId === po.procurementGroupId ? <Loader2 size={12} className="animate-spin" /> : 'In nhóm'}
                                                            </button>
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
                                        {isExpanded && (
                                            <div className="px-5 pb-4 bg-slate-50/30">
                                                <table className="w-full text-[11px]">
                                                    <thead>
                                                        <tr className="text-[9px] font-bold text-slate-400 uppercase">
                                                            <th className="text-left py-2 px-2">Vật tư</th>
                                                            <th className="text-center py-2 px-2">ĐVT</th>
                                                            <th className="text-right py-2 px-2">SL</th>
                                                            <th className="text-right py-2 px-2">Đã nhận</th>
                                                            <th className="text-right py-2 px-2">Đơn giá</th>
                                                            <th className="text-right py-2 px-2">Thành tiền</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/40">
                                                        {po.items.map((item, i) => {
                                                            const work = item.workBoqItemId ? workBoqMap.get(item.workBoqItemId) : undefined;
                                                            return (
                                                            <tr key={i}>
                                                                <td className="py-1.5 px-2 font-bold text-slate-700">
                                                                    {item.name}
                                                                    {item.sku && <div className="text-[9px] font-mono text-slate-400">{item.sku}</div>}
                                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                                        {item.requestCode && <span className="px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-[9px] text-amber-700">YC {item.requestCode}</span>}
                                                                        {(item.workBoqItemName || work?.name) && <span className="px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[9px] text-blue-700">{work?.wbsCode ? `${work.wbsCode} - ` : ''}{item.workBoqItemName || work?.name}</span>}
                                                                        {item.materialBudgetItemName && <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] text-emerald-700">{item.materialBudgetItemName}</span>}
                                                                        {Number(item.overBudgetQtySnapshot || 0) > 0 && <span className="px-1.5 py-0.5 rounded border border-orange-100 bg-orange-50 text-[9px] text-orange-700">Vượt {Number(item.overBudgetQtySnapshot || 0).toLocaleString('vi-VN')} {item.unit}</span>}
                                                                    </div>
                                                                    {(item.neededDate || item.note) && <div className="text-[9px] text-slate-400 font-medium mt-0.5">{item.neededDate || ''}{item.neededDate && item.note ? ' • ' : ''}{item.note || ''}</div>}
                                                                    {item.overBudgetReason && <div className="text-[9px] text-orange-600 font-medium">Lý do: {item.overBudgetReason}</div>}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-center text-slate-500">{item.unit}</td>
                                                                <td className="py-1.5 px-2 text-right text-slate-600">{item.qty.toLocaleString()}</td>
                                                                <td className="py-1.5 px-2 text-right text-emerald-600 font-bold">{(item.receivedQty || 0).toLocaleString()}</td>
                                                                <td className="py-1.5 px-2 text-right text-slate-500">{fmt(item.unitPrice)}</td>
                                                                <td className="py-1.5 px-2 text-right font-bold text-slate-700">{fmt(item.qty * item.unitPrice)} đ</td>
                                                            </tr>
                                                        );})}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="font-black text-xs">
                                                            <td colSpan={5} className="py-2 px-2 text-right text-slate-600">TỔNG:</td>
                                                            <td className="py-2 px-2 text-right text-slate-800">{fmt(po.totalAmount)} đ</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                                {po.note && <div className="mt-2 px-2 text-[10px] text-slate-400 italic">Ghi chú: {po.note}</div>}
                                                {canManageTab && (
                                                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                                                        <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Thao tác phiếu</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {po.status === 'draft' && (
                                                                <button onClick={() => updatePoStatus(po.id, 'sent')} className="px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-xs font-black hover:bg-amber-100 flex items-center gap-1.5">
                                                                    <Send size={14} /> Gửi đơn
                                                                </button>
                                                            )}
                                                            {po.status === 'sent' && (
                                                                <button onClick={() => updatePoStatus(po.id, 'confirmed')} className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-black hover:bg-emerald-100 flex items-center gap-1.5">
                                                                    <CheckCircle2 size={14} /> Duyệt PO
                                                                </button>
                                                            )}
                                                            {(po.status === 'sent' || po.status === 'confirmed') && (
                                                                <button onClick={() => updatePoStatus(po.id, 'draft')} className="px-3 py-2 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 text-xs font-black hover:bg-slate-100 flex items-center gap-1.5">
                                                                    <RefreshCcw size={14} /> Huỷ duyệt
                                                                </button>
                                                            )}
                                                            {po.status === 'confirmed' && (
                                                                <button onClick={() => updatePoStatus(po.id, 'in_transit')} className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-black hover:bg-indigo-100 flex items-center gap-1.5">
                                                                    <Truck size={14} /> Đánh dấu đang giao
                                                                </button>
                                                            )}
                                                            {po.status === 'in_transit' && (
                                                                <button onClick={() => updatePoStatus(po.id, 'returned')} className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black hover:bg-rose-100 flex items-center gap-1.5">
                                                                    <RefreshCcw size={14} /> Trả lại / hoàn hàng
                                                                </button>
                                                            )}
                                                            {po.status === 'delivered' && (
                                                                <button onClick={() => updatePoStatus(po.id, 'closed')} className="px-3 py-2 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 text-xs font-black hover:bg-slate-100 flex items-center gap-1.5">
                                                                    <FileText size={14} /> Đóng PO
                                                                </button>
                                                            )}
                                                            {po.status === 'closed' && (
                                                                <button onClick={() => updatePoStatus(po.id, 'returned')} className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black hover:bg-rose-100 flex items-center gap-1.5">
                                                                    <RefreshCcw size={14} /> Hoàn trả PO đã đóng
                                                                </button>
                                                            )}
                                                            {!['cancelled', 'closed', 'delivered', 'returned'].includes(po.status) && (
                                                                <button onClick={() => updatePoStatus(po.id, 'cancelled')} className="px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-black hover:bg-red-100 flex items-center gap-1.5">
                                                                    <Ban size={14} /> Huỷ PO
                                                                </button>
                                                            )}
                                                            {['cancelled', 'returned'].includes(po.status) && (
                                                                <span className="px-3 py-2 rounded-lg bg-slate-50 text-slate-400 border border-slate-200 text-xs font-bold">
                                                                    Không còn thao tác trạng thái
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
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
                            <table className="w-full text-xs min-w-[850px]">
                                <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase sticky top-0 whitespace-nowrap">
                                    <tr>
                                        <th className="px-4 py-3 text-center w-12"></th>
                                        <th className="px-4 py-3 text-left w-36">Phiếu</th>
                                        <th className="px-4 py-3 text-left">BOQ / Vật tư</th>
                                        <th className="px-4 py-3 text-right w-20">YC</th>
                                        <th className="px-4 py-3 text-right w-20">Đã cấp</th>
                                        <th className="px-4 py-3 text-right w-24">Đã đưa PO</th>
                                        <th className="px-4 py-3 text-right w-24">Còn lại</th>
                                        <th className="px-4 py-3 text-left w-28">Ngày cần</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                    {scopedRequestLines.map(row => {
                                        const inv = inventoryItems.find(item => item.id === row.line.itemId);
                                        const work = row.line.workBoqItemId ? workBoqMap.get(row.line.workBoqItemId) : undefined;
                                        const remaining = row.remainingQty;
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
                                                <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{row.requestedQty.toLocaleString('vi-VN')}</td>
                                                <td className="px-4 py-3 text-right text-blue-600 font-bold whitespace-nowrap">{row.stockCoveredQty.toLocaleString('vi-VN')}</td>
                                                <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{row.orderedQty.toLocaleString('vi-VN')}</td>
                                                <td className="px-4 py-3 text-right font-black text-amber-700 whitespace-nowrap">{remaining.toLocaleString('vi-VN')}</td>
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
                                    {[1,2,3,4,5].map(s => (
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
                                                {item.unit || 'ĐVT'}
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
                                                className="col-span-6 md:col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <input
                                                value={item.note || ''}
                                                onChange={e => updatePoItem(i, { note: e.target.value })}
                                                placeholder="Ghi chú"
                                                className="col-span-5 md:col-span-9 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <button
                                                onClick={() => setPItems(pItems.length > 1 ? pItems.filter((_, j) => j !== i) : [createEmptyPoItem()])}
                                                className="col-span-1 h-9 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center"
                                            >
                                                <X size={14} />
                                            </button>
                                            {(item.isManualItem || item.requestCode || item.materialBudgetItemName || item.workBoqItemName || rowWork?.name || overBudgetQty > 0) && (
                                                <div className="col-span-12 flex flex-wrap gap-1">
                                                    {item.isManualItem && <span className="px-1.5 py-0.5 rounded border border-rose-100 bg-rose-50 text-[9px] font-bold text-rose-700">Cần cấp mã vật tư trước</span>}
                                                    {item.requestCode && <span className="px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-[9px] font-bold text-amber-700">YC {item.requestCode}</span>}
                                                    {(item.workBoqItemName || rowWork?.name) && <span className="px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[9px] font-bold text-blue-700">{rowWork?.wbsCode ? `${rowWork.wbsCode} - ` : ''}{item.workBoqItemName || rowWork?.name}</span>}
                                                    {item.materialBudgetItemName && <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] font-bold text-emerald-700">{item.materialBudgetItemName}</span>}
                                                    {overBudgetQty > 0 && <span className="px-1.5 py-0.5 rounded border border-orange-100 bg-orange-50 text-[9px] font-bold text-orange-700">Vượt {overBudgetQty.toLocaleString('vi-VN')} {previewLine.unit}</span>}
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
                                    );})}
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
        </div>
    );
};

export default SupplyChainTab;
