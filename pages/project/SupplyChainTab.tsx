import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiInsightPanel from '../../components/AiInsightPanel';
import { EmptyState, StatusBadge, type ErpStatusTone } from '../../components/erp';
import {
    calculateLineTotal,
    getComputedDimension,
    formatPoApprovalLineDetails,
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
    FileText, CheckCircle2, Clock, Ban, Send, Package, Wrench, ChevronDown,
    ChevronLeft, ChevronRight, Users, ShoppingCart, AlertTriangle, FileSpreadsheet,
    Upload, Printer, QrCode, Loader2, RefreshCcw, PackageX, MoreVertical, Search, ExternalLink, Image as ImageIcon
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
    PurchaseOrderDeliveryBatch,
    PurchaseOrderItem,
    PurchaseOrderRequestLineLink,
    PurchaseOrderSupplementalApproval,
    PurchaseOrderSupplierReturn,
    PurchaseOrderSourceMode,
    MaterialPlanningDraftPo,
    MaterialRequest,
    MaterialRequestFulfillmentBatch,
    MaterialRequestFulfillmentLine,
    MaterialRequestFulfillmentSummary,
    PurchaseOrderDeliveryGroup,
    RequestStatus,
    Attachment,
    SupplierPayableDocument,
    SiteDirectPurchase,
    SiteDirectPurchaseLine,
    SiteDirectPurchaseLineType,
    SiteDirectPurchaseMode,
    SiteDirectPurchasePaymentSource,
    SiteDirectPurchaseStatus,
    SiteSmallToolRecord,
    SiteSmallToolStatus,
    SupplierContract,
    SupplierContractLine,
    SupplierDeliveryStatement,
    SupplierDirectDeliveryLine,
    SupplierDirectDeliveryNote,
    Transaction,
    TransactionStatus,
} from '../../types';
import { boqService, vendorService, poService, poDeliveryScheduleService, poSupplementalApprovalService, workBoqService } from '../../lib/projectService';
import { materialRequestFulfillmentService, getRequestLineId } from '../../lib/materialRequestFulfillmentService';
import { partnerService } from '../../lib/partnerService';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import { loadXlsx } from '../../lib/loadXlsx';
import { buildPoReceiveUrl, createPoQrToken } from '../../lib/poQr';
import { buildDocumentTracePath } from '../../lib/documentTraceService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import ExcelImportReviewModal from '../../components/ExcelImportReviewModal';
import InventoryItemCombobox from '../../components/InventoryItemCombobox';
import { ExcelImportMode, ExcelImportPreview, applyImportChanges, buildImportPreview, parseExcelRows } from '../../lib/excelImport';
import ProjectSubmissionDialog from '../../components/project/ProjectSubmissionDialog';
import { projectSubmissionService } from '../../lib/projectSubmissionService';
import SupplierCombobox from '../../components/SupplierCombobox';
import { materialRequestService } from '../../lib/materialRequestService';
import { isAdmin, isGlobalWarehouseKeeper } from '../../lib/wmsPermissions';
import { purchaseOrderSupplierReturnService } from '../../lib/purchaseOrderSupplierReturnService';
import PurchaseOrderSupplierReturnDialog from '../../components/project/PurchaseOrderSupplierReturnDialog';
import PurchaseOrderCockpitDrawer from '../../components/project/PurchaseOrderCockpitDrawer';
import TransactionDetailModal from '../../components/TransactionDetailModal';
import { supplierPayableService } from '../../lib/supplierPayableService';
import { calculateSiteDirectPurchaseTotals, siteDirectPurchaseService } from '../../lib/siteDirectPurchaseService';
import { siteSmallToolService } from '../../lib/siteSmallToolService';
import { supplierContractService } from '../../lib/hdService';
import {
    isSupplierDirectDeliveryLineStatementReady,
    supplierContractLineService,
    supplierDeliveryStatementService,
    supplierDirectDeliveryService,
} from '../../lib/supplierDeliveryStatementService';
import {
    getSupplierDeliveryWmsSummary,
    SUPPLIER_DELIVERY_WMS_STATUS,
} from '../../lib/supplierDeliveryWmsSummary';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { useReservedStock } from '../../hooks/useReservedStock';
import {
    canUserRemovePurchaseOrder,
    canUserMutatePurchaseOrder,
    getPurchaseOrderEditBlockReason,
    getPurchaseOrderRemovalBlockReason,
    purchaseOrderHasStockImpact,
    summarizePurchaseOrderWork,
} from '../../lib/purchaseOrderMutationState';
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
import {
    getPoDeliveryDraftInitialLineValues,
    getPoDeliveryScheduleLineInitialValues,
    makePoDeliveryLineDraft as buildPoDeliveryLineDraft,
    shouldAutoCreatePoDeliveryScheduleForForm,
} from '../../lib/purchaseOrderDeliveryDraft';
import {
    applyPurchaseOrderSupplementalState,
    getPurchaseOrderReleaseSummary,
    getPurchaseOrderScheduleQuantityBlockReason,
    type PurchaseOrderSupplementalDraft,
} from '../../lib/purchaseOrderReleaseApproval';
import { buildPurchaseOrderListSummary } from '../../lib/purchaseOrderDisplay';
import { getPurchaseOrderDemandStats } from '../../lib/purchaseOrderDemand';
import {
    buildPurchaseOrderPrintLineAmounts,
    getPurchaseOrderDisplayAmount,
    getPurchaseOrderPrintAmount,
} from '../../lib/purchaseOrderAmount';
import {
    appendRequestRowsToPoItems,
    buildPurchaseOrderRequestLineLinks,
    filterRequestRowsForPoCart,
    hasRequestRowDefaultSupplierMismatch,
} from '../../lib/purchaseOrderRequestCart';
import { getPurchaseOrderUiPolicy, type PurchaseOrderUiAction } from '../../lib/purchaseOrderUiPolicy';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

interface SupplyChainTabProps {
    constructionSiteId?: string;
    projectId?: string;
    canManageTab?: boolean;
    poCapabilities?: PurchaseOrderCapabilities;
    directPurchaseCapabilities?: DirectPurchaseCapabilities;
    supplierDeliveryCapabilities?: SupplierDeliveryCapabilities;
    compact?: boolean;
    initialDraftPo?: MaterialPlanningDraftPo | null;
    initialDraftPoKey?: number;
    deepLinkPoId?: string | null;
}

type PurchaseOrderCapabilities = {
    canCreatePo?: boolean;
    canApprovePo?: boolean;
    canReceivePo?: boolean;
    canDeletePo?: boolean;
    canManagePo?: boolean;
};

type DirectPurchaseCapabilities = {
    canViewDirectPurchase?: boolean;
    canCreateDirectPurchase?: boolean;
    canEditDirectPurchase?: boolean;
    canDeleteDirectPurchase?: boolean;
    canRecordDirectPurchaseAp?: boolean;
};

type SupplierDeliveryCapabilities = {
    canViewSupplierDelivery?: boolean;
    canCreateSupplierDelivery?: boolean;
    canEditSupplierDelivery?: boolean;
    canDeleteSupplierDelivery?: boolean;
    canRecordSupplierDelivery?: boolean;
    canUnrecordSupplierDelivery?: boolean;
    canReconcileSupplierDelivery?: boolean;
};

type PoDeliveryScheduleMode = 'unknown' | 'first_batch' | 'multiple_batches';

type PendingPoSupplementalSubmission = {
    totalOverAmount: number;
    previousApprovedAmount: number;
    requestedTotalAmount: number;
    supplementalRequestCount: number;
};

const resolvePurchaseOrderCapabilities = (
    canManageTab: boolean,
    poCapabilities?: PurchaseOrderCapabilities,
): Required<PurchaseOrderCapabilities> => {
    if (!poCapabilities) {
        return {
            canCreatePo: canManageTab,
            canApprovePo: canManageTab,
            canReceivePo: canManageTab,
            canDeletePo: canManageTab,
            canManagePo: canManageTab,
        };
    }
    const canManagePo = Boolean(poCapabilities.canManagePo);
    return {
        canCreatePo: canManagePo || Boolean(poCapabilities.canCreatePo),
        canApprovePo: canManagePo || Boolean(poCapabilities.canApprovePo),
        canReceivePo: canManagePo || Boolean(poCapabilities.canReceivePo),
        canDeletePo: canManagePo || Boolean(poCapabilities.canDeletePo),
        canManagePo,
    };
};

const resolveDirectPurchaseCapabilities = (
    canManageTab: boolean,
    capabilities?: DirectPurchaseCapabilities,
): Required<DirectPurchaseCapabilities> => {
    if (!capabilities) {
        return {
            canViewDirectPurchase: true,
            canCreateDirectPurchase: canManageTab,
            canEditDirectPurchase: canManageTab,
            canDeleteDirectPurchase: canManageTab,
            canRecordDirectPurchaseAp: canManageTab,
        };
    }
    return {
        canViewDirectPurchase: Boolean(
            capabilities.canViewDirectPurchase
            || capabilities.canCreateDirectPurchase
            || capabilities.canEditDirectPurchase
            || capabilities.canDeleteDirectPurchase
            || capabilities.canRecordDirectPurchaseAp,
        ),
        canCreateDirectPurchase: Boolean(capabilities.canCreateDirectPurchase),
        canEditDirectPurchase: Boolean(capabilities.canEditDirectPurchase),
        canDeleteDirectPurchase: Boolean(capabilities.canDeleteDirectPurchase),
        canRecordDirectPurchaseAp: Boolean(capabilities.canRecordDirectPurchaseAp),
    };
};

const resolveSupplierDeliveryCapabilities = (
    canManageTab: boolean,
    capabilities?: SupplierDeliveryCapabilities,
): Required<SupplierDeliveryCapabilities> => {
    if (!capabilities) {
        return {
            canViewSupplierDelivery: true,
            canCreateSupplierDelivery: canManageTab,
            canEditSupplierDelivery: canManageTab,
            canDeleteSupplierDelivery: canManageTab,
            canRecordSupplierDelivery: canManageTab,
            canUnrecordSupplierDelivery: canManageTab,
            canReconcileSupplierDelivery: canManageTab,
        };
    }
    return {
        canViewSupplierDelivery: Boolean(
            capabilities.canViewSupplierDelivery
            || capabilities.canCreateSupplierDelivery
            || capabilities.canEditSupplierDelivery
            || capabilities.canDeleteSupplierDelivery
            || capabilities.canRecordSupplierDelivery
            || capabilities.canUnrecordSupplierDelivery
            || capabilities.canReconcileSupplierDelivery,
        ),
        canCreateSupplierDelivery: Boolean(capabilities.canCreateSupplierDelivery),
        canEditSupplierDelivery: Boolean(capabilities.canEditSupplierDelivery),
        canDeleteSupplierDelivery: Boolean(capabilities.canDeleteSupplierDelivery),
        canRecordSupplierDelivery: Boolean(capabilities.canRecordSupplierDelivery),
        canUnrecordSupplierDelivery: Boolean(capabilities.canUnrecordSupplierDelivery),
        canReconcileSupplierDelivery: Boolean(capabilities.canReconcileSupplierDelivery),
    };
};

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const fmtMoney = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

const fmtQty = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });

const normalizeVatRate = (value?: string | number | null) => {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(100, parsed);
};

const calculateVatAmount = (amount: number, vatRate?: string | number | null) =>
    Math.round(Number(amount || 0) * normalizeVatRate(vatRate) / 100);

const PO_STATUS: Record<POStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    draft: { label: 'Nháp', color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: <Clock size={12} /> },
    sent: { label: 'Đã gửi', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', icon: <Send size={12} /> },
    confirmed: { label: 'Đã duyệt', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <CheckCircle2 size={12} /> },
    in_transit: { label: 'Đang giao', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', icon: <Truck size={12} /> },
    partial: { label: 'Giao 1 phần', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', icon: <Package size={12} /> },
    delivered: { label: 'Hoàn thành', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <CheckCircle2 size={12} /> },
    closed: { label: 'Đã đóng', color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: <FileText size={12} /> },
    returned: { label: 'Hoàn hàng', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20', icon: <RefreshCcw size={12} /> },
    cancelled: { label: 'Huỷ', color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', icon: <Ban size={12} /> },
};

const PO_STATUS_TONE: Record<POStatus, ErpStatusTone> = {
    draft: 'neutral',
    sent: 'warning',
    confirmed: 'success',
    in_transit: 'info',
    partial: 'attention',
    delivered: 'success',
    closed: 'neutral',
    returned: 'warning',
    cancelled: 'danger',
};

const VENDOR_CATS = ['Xi măng', 'Thép', 'Cát & Đá', 'Gạch', 'Gỗ', 'Sơn', 'Ống/Phụ kiện nước', 'Dây & TB điện', 'VLXD khác'];

const PO_SOURCE_MODE: Record<PurchaseOrderSourceMode, { label: string; color: string }> = {
    from_request: { label: 'Từ đề xuất', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    proactive_project: { label: 'Mua chủ động dự án', color: 'bg-blue-500/10 text-blue-450 border-blue-500/20' },
    proactive_stock: { label: 'Mua dự trữ kho tổng', color: 'bg-muted text-muted-foreground border-border' },
    company_consolidated: { label: 'PO công ty', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    site_direct_planned: { label: 'Mua nóng có đề xuất', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
    site_direct_immediate: { label: 'Mua nóng ngay', color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
};

const DIRECT_PURCHASE_MODE: Record<SiteDirectPurchaseMode, { label: string; tone: string }> = {
    planned: { label: 'Đề xuất trước', tone: 'border-orange-200 bg-orange-50 text-orange-700' },
    immediate: { label: 'Mua ngay', tone: 'border-rose-200 bg-rose-50 text-rose-700' },
};

const DIRECT_PURCHASE_PAYMENT_SOURCE: Record<SiteDirectPurchasePaymentSource, string> = {
    site_cash: 'Quỹ công trường',
    company_bank: 'Công ty chuyển khoản',
    staff_paid: 'Cá nhân ứng trước',
    supplier_credit: 'Công nợ NCC',
};

const DIRECT_PURCHASE_STATUS: Record<SiteDirectPurchaseStatus, { label: string; tone: ErpStatusTone }> = {
    draft: { label: 'Nháp', tone: 'neutral' },
    submitted: { label: 'Đã trình', tone: 'warning' },
    approved_to_buy: { label: 'Được mua', tone: 'success' },
    purchased: { label: 'Đã mua', tone: 'attention' },
    received: { label: 'Đã nhập kho', tone: 'info' },
    finance_review: { label: 'Kế toán duyệt', tone: 'warning' },
    reconciled: { label: 'Đã ghi AP', tone: 'success' },
    closed: { label: 'Đã đóng', tone: 'neutral' },
    rejected: { label: 'Từ chối', tone: 'danger' },
    cancelled: { label: 'Huỷ', tone: 'danger' },
};

const DIRECT_PURCHASE_LINE_TYPE: Record<SiteDirectPurchaseLineType, { label: string; badge: string; defaultName: string; defaultUnit: string }> = {
    stock_item: { label: 'Vật tư tồn kho', badge: 'border-blue-200 bg-blue-50 text-blue-700', defaultName: '', defaultUnit: '' },
    expense_only: { label: 'Chi phí không kho', badge: 'border-violet-200 bg-violet-50 text-violet-700', defaultName: 'Chi phí mua nóng', defaultUnit: 'lần' },
    small_tool: { label: 'CCDC nhỏ', badge: 'border-amber-200 bg-amber-50 text-amber-700', defaultName: '', defaultUnit: 'cái' },
};

const SMALL_TOOL_STATUS: Record<SiteSmallToolStatus, { label: string; badge: string }> = {
    stored: { label: 'Đang lưu', badge: 'border-slate-200 bg-slate-50 text-slate-600' },
    in_use: { label: 'Đang dùng', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    damaged: { label: 'Hỏng', badge: 'border-orange-200 bg-orange-50 text-orange-700' },
    lost: { label: 'Mất', badge: 'border-red-200 bg-red-50 text-red-700' },
    disposed: { label: 'Thanh lý', badge: 'border-slate-300 bg-slate-100 text-slate-500' },
};

const SMALL_TOOL_STATUS_OPTIONS: Array<SiteSmallToolStatus | 'all'> = ['all', 'stored', 'in_use', 'damaged', 'lost', 'disposed'];

const SUPPLIER_DIRECT_DELIVERY_STATUS: Record<SupplierDirectDeliveryNote['status'], { label: string; tone: ErpStatusTone }> = {
    draft: { label: 'Nháp', tone: 'neutral' },
    submitted: { label: 'Đã trình', tone: 'warning' },
    site_confirmed: { label: 'Công trường xác nhận', tone: 'info' },
    finance_review: { label: 'Kế toán kiểm tra', tone: 'warning' },
    accepted: { label: 'Đã ghi', tone: 'success' },
    statemented: { label: 'Đã đối soát', tone: 'success' },
    rejected: { label: 'Từ chối', tone: 'danger' },
    cancelled: { label: 'Huỷ', tone: 'danger' },
};

const SUPPLIER_DELIVERY_STATEMENT_STATUS: Record<SupplierDeliveryStatement['status'], { label: string; tone: ErpStatusTone }> = {
    draft: { label: 'Nháp', tone: 'neutral' },
    posted: { label: 'Đã ghi AP', tone: 'success' },
    cancelled: { label: 'Huỷ', tone: 'danger' },
    reversed: { label: 'Đã đảo', tone: 'warning' },
};

const SUPPLIER_DELIVERY_WMS_FLOW_MODE: Record<NonNullable<SupplierDirectDeliveryLine['wmsFlowMode']>, { label: string; badge: string }> = {
    none: { label: 'Không qua kho', badge: 'border-slate-200 bg-slate-50 text-slate-600' },
    direct_in_out: { label: 'Nhập-xuất thẳng', badge: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
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
const PO_DELIVERY_DRAFT_STATUSES = new Set<POStatus>(['confirmed', 'in_transit', 'partial']);
const PO_DELIVERY_PRINT_AUTOLOAD_STATUSES = new Set<POStatus>(['confirmed', 'in_transit', 'partial', 'delivered', 'closed']);
const PO_PAGE_SIZE = 10;
type PurchaseOrderPrintTemplateKey = 'purchase_order' | 'approval_request';
type PoDeliveryDraftLine = {
    key: string;
    purchaseOrderLineId: string;
    materialRequestId: string;
    requestLineId: string;
    itemName: string;
    requestCode?: string | null;
    siteName?: string;
    unit?: string | null;
    remainingQty: number;
    allocatedQty: number;
    issuedQty: string;
    deliveryUnitPrice: string;
};
type PoDeliveryPrintGroup = {
    key: string;
    label: string;
    plannedDate?: string | null;
    status: string;
    note?: string | null;
    targetWarehouseId?: string | null;
    source?: 'schedule' | 'fulfillment';
    scheduleBatch?: PurchaseOrderDeliveryBatch | null;
    batches: MaterialRequestFulfillmentBatch[];
    lines: MaterialRequestFulfillmentLine[];
};
type PoApprovalDeliveryBatch = {
    deliveryNo?: string | number | null;
    plannedDeliveryDate?: string | null;
    lines: Array<{
        purchaseOrderLineId: string;
        plannedQty: number;
        unitPrice?: number | null;
    }>;
};

type SiteDirectPurchaseDetailState = {
    purchase: SiteDirectPurchase;
    lines: SiteDirectPurchaseLine[];
};

type SiteDirectPurchaseFormLine = SiteDirectPurchaseLine & {
    quantityInput?: string;
    unitPriceInput?: string;
    vatRateInput?: string;
};

type SupplierDirectDeliveryFormLine = SupplierDirectDeliveryLine & {
    quantityInput?: string;
    unitPriceInput?: string;
    vatRateInput?: string;
};

type SupplierDeliveryDetailState = {
    note: SupplierDirectDeliveryNote;
    lines: SupplierDirectDeliveryLine[];
};

type SupplierDeliveryStatementPricingLine = SupplierDirectDeliveryLine & {
    unitPriceInput: string;
    vatRateInput: string;
};

type SupplierDeliveryStatementPricingState = {
    note: SupplierDirectDeliveryNote;
    lines: SupplierDeliveryStatementPricingLine[];
};

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const safeStorageFileName = (name: string): string =>
    name.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'attachment';

const buildSiteDirectPurchaseCode = (mode: SiteDirectPurchaseMode, id: string) => {
    const date = todayIsoDate().replace(/-/g, '');
    return `${mode === 'planned' ? 'MNDX' : 'MNN'}-${date}-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
};

const buildSupplierDirectDeliveryCode = (id: string) => {
    const date = todayIsoDate().replace(/-/g, '');
    return `GHHD-${date}-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
};

const buildSupplierDeliveryStatementCode = (id: string, periodMonth: string) =>
    `DCHD-${periodMonth.replace(/-/g, '').slice(0, 6)}-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

const createEmptyDirectPurchaseLine = (
    directPurchaseId = '',
    lineNo = 1,
    lineType: SiteDirectPurchaseLineType = 'stock_item',
): SiteDirectPurchaseFormLine => ({
    id: crypto.randomUUID(),
    directPurchaseId,
    lineNo,
    lineType,
    itemId: null,
    skuSnapshot: null,
    itemNameSnapshot: DIRECT_PURCHASE_LINE_TYPE[lineType]?.defaultName || '',
    unitSnapshot: DIRECT_PURCHASE_LINE_TYPE[lineType]?.defaultUnit || '',
    quantity: 1,
    unitPrice: 0,
    vatRate: 0,
    lineAmount: 0,
    vatAmount: 0,
    acceptedQuantity: 0,
    acceptedAmount: 0,
    status: 'pending',
    smallToolCategory: lineType === 'small_tool' ? 'Dụng cụ nhỏ' : null,
    smallToolHolderType: lineType === 'small_tool' ? 'site' : null,
    smallToolHolderId: null,
    smallToolHolderNameSnapshot: lineType === 'small_tool' ? 'Công trường' : null,
    smallToolLocationNote: null,
    quantityInput: '1',
    unitPriceInput: '',
    vatRateInput: '0',
});

const createDirectPurchaseLineFromInventoryItem = (
    item: InventoryItem,
    directPurchaseId = '',
    lineNo = 1,
): SiteDirectPurchaseFormLine => ({
    ...createEmptyDirectPurchaseLine(directPurchaseId, lineNo, 'stock_item'),
    itemId: item.id,
    skuSnapshot: item.sku || null,
    itemNameSnapshot: item.name || '',
    unitSnapshot: item.purchaseUnit || item.unit || '',
    unitPrice: Number(item.priceIn || 0),
    unitPriceInput: item.priceIn ? String(item.priceIn) : '',
});

const hydrateDirectPurchaseFormLine = (line: SiteDirectPurchaseLine): SiteDirectPurchaseFormLine => ({
    ...line,
    quantityInput: String(line.quantity || ''),
    unitPriceInput: String(line.unitPrice || ''),
    vatRateInput: String(line.vatRate || 0),
});

const normalizeDirectPurchaseFormLine = (line: SiteDirectPurchaseFormLine, index: number, directPurchaseId: string): SiteDirectPurchaseLine => {
    const quantity = Number(line.quantityInput ?? line.quantity ?? 0);
    const unitPrice = Number(line.unitPriceInput ?? line.unitPrice ?? 0);
    const vatRate = Number(line.vatRateInput ?? line.vatRate ?? 0);
    const lineAmount = Math.round(quantity * unitPrice);
    const vatAmount = Math.round(lineAmount * Math.max(0, vatRate) / 100);
    return {
        ...line,
        directPurchaseId,
        lineNo: index + 1,
        itemId: line.lineType === 'stock_item' ? line.itemId || null : null,
        skuSnapshot: line.lineType === 'stock_item' ? line.skuSnapshot || null : null,
        unitSnapshot: line.unitSnapshot || DIRECT_PURCHASE_LINE_TYPE[line.lineType]?.defaultUnit || '',
        smallToolCategory: line.lineType === 'small_tool' ? line.smallToolCategory || null : null,
        smallToolHolderType: line.lineType === 'small_tool' ? line.smallToolHolderType || 'site' : null,
        smallToolHolderId: line.lineType === 'small_tool' ? line.smallToolHolderId || null : null,
        smallToolHolderNameSnapshot: line.lineType === 'small_tool' ? line.smallToolHolderNameSnapshot || 'Công trường' : null,
        smallToolLocationNote: line.lineType === 'small_tool' ? line.smallToolLocationNote || null : null,
        quantity,
        unitPrice,
        vatRate,
        lineAmount,
        vatAmount,
        acceptedQuantity: Number(line.acceptedQuantity || 0),
        acceptedAmount: Number(line.acceptedAmount || 0),
        status: line.status || 'pending',
    };
};

const createEmptySupplierDeliveryLine = (
    deliveryNoteId = '',
    supplierContractId = '',
    lineNo = 1,
    contractLine?: SupplierContractLine | null,
): SupplierDirectDeliveryFormLine => {
    const quantity = 1;
    return {
        id: crypto.randomUUID(),
        deliveryNoteId,
        supplierContractId,
        supplierContractLineId: contractLine?.id || null,
        lineNo,
        itemId: contractLine?.itemId || null,
        skuSnapshot: contractLine?.skuSnapshot || null,
        itemNameSnapshot: contractLine?.itemNameSnapshot || '',
        unitSnapshot: contractLine?.unitSnapshot || '',
        quantity,
        unitPrice: 0,
        vatRate: 0,
        lineAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        acceptedQuantity: 0,
        acceptedAmount: 0,
        status: 'pending',
        issueReason: null,
        workBoqItemId: null,
        materialBudgetItemId: null,
        statementId: null,
        wmsFlowMode: 'none',
        targetWarehouseId: null,
        wmsImportTransactionId: null,
        wmsExportTransactionId: null,
        wmsStatus: 'not_required',
        rejectionReason: null,
        note: null,
        quantityInput: '1',
        unitPriceInput: '',
        vatRateInput: '0',
    };
};

const hydrateSupplierDeliveryFormLine = (line: SupplierDirectDeliveryLine): SupplierDirectDeliveryFormLine => ({
    ...line,
    wmsFlowMode: line.wmsFlowMode || 'none',
    targetWarehouseId: line.targetWarehouseId || null,
    wmsImportTransactionId: line.wmsImportTransactionId || null,
    wmsExportTransactionId: line.wmsExportTransactionId || null,
    wmsStatus: line.wmsStatus || 'not_required',
    quantityInput: String(line.quantity || ''),
    unitPriceInput: String(line.unitPrice || ''),
    vatRateInput: String(line.vatRate || 0),
});

const normalizeSupplierDeliveryFormLine = (
    line: SupplierDirectDeliveryFormLine,
    index: number,
    deliveryNoteId: string,
    supplierContractId: string,
): SupplierDirectDeliveryLine => {
    const quantity = Number(line.quantityInput ?? line.quantity ?? 0);
    const wmsFlowMode = line.wmsFlowMode || 'none';
    return {
        ...line,
        deliveryNoteId,
        supplierContractId,
        lineNo: index + 1,
        wmsFlowMode,
        targetWarehouseId: wmsFlowMode === 'direct_in_out' ? line.targetWarehouseId || null : null,
        wmsImportTransactionId: line.wmsImportTransactionId || null,
        wmsExportTransactionId: line.wmsExportTransactionId || null,
        wmsStatus: line.wmsStatus || 'not_required',
        quantity,
        unitPrice: 0,
        vatRate: 0,
        lineAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        acceptedQuantity: Number(line.acceptedQuantity || 0),
        acceptedAmount: Number(line.acceptedAmount || 0),
        status: line.status || 'pending',
        issueReason: line.issueReason || null,
        workBoqItemId: line.workBoqItemId || null,
        materialBudgetItemId: line.materialBudgetItemId || null,
        statementId: line.statementId || null,
    };
};

const PO_PRINT_TEMPLATE_LABELS: Record<PurchaseOrderPrintTemplateKey, string> = {
    purchase_order: 'Đơn đặt hàng',
    approval_request: 'Đề nghị duyệt đơn hàng',
};

const procurementPanelClass = 'bg-card rounded-lg border border-border shadow-sm overflow-hidden';
const procurementTableHeadClass = 'bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 sticky top-0 z-10 dark:bg-slate-800 dark:text-slate-400';
const procurementInputClass = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

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

const hasPoStockImpactHint = (
    po: PurchaseOrder,
    supplierReturns: PurchaseOrderSupplierReturn[] = [],
): boolean => {
    const hasReceivedQty = po.items.some(item => Number(item.receivedQty || 0) > 0 || Number(item.returnedQty || 0) > 0);
    const hasReceiptTransactions = (po.receivedTransactionIds || []).length > 0;
    const hasCompletedSupplierReturn = supplierReturns.some(item => item.status === 'completed');
    return hasReceivedQty || hasReceiptTransactions || hasCompletedSupplierReturn;
};

const SupplyChainTab: React.FC<SupplyChainTabProps> = ({ constructionSiteId, projectId, canManageTab = true, poCapabilities, directPurchaseCapabilities, supplierDeliveryCapabilities, compact = false, initialDraftPo = null, initialDraftPoKey = 0, deepLinkPoId = null }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const reasonConfirm = useReasonConfirm();
    const { items: inventoryItems, warehouses, requests: materialRequests, constructionSites, transactions, loadModuleData, refreshWmsRecords, user, addTransaction, updateRequestStatus } = useApp();
    const { getStockSummary } = useReservedStock();
    const effectiveId = projectId || constructionSiteId || '';
    const [subTab, setSubTab] = useState<'vendor' | 'po' | 'direct'>('po');
    const [poPage, setPoPage] = useState(1);

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
    const effectivePoCapabilities = resolvePurchaseOrderCapabilities(canManageTab, poCapabilities);
    const effectiveDirectPurchaseCapabilities = resolveDirectPurchaseCapabilities(canManageTab, directPurchaseCapabilities);
    const effectiveSupplierDeliveryCapabilities = resolveSupplierDeliveryCapabilities(canManageTab, supplierDeliveryCapabilities);
    const legacyPoCanManageTab = poCapabilities ? false : canManageTab;

    const ensureCanManage = (action: string) => {
        if (canManageTab) return true;
        toast.warning('Không có quyền quản trị tab', `Bạn cần quyền quản trị "Cung ứng" để ${action}.`);
        return false;
    };

    const ensureDirectPurchase = (allowed: boolean, action: string) => {
        if (allowed) return true;
        toast.warning('Không có quyền mua nóng', `Bạn cần quyền phù hợp trong Tổ chức dự án để ${action}.`);
        return false;
    };

    const ensureSupplierDelivery = (allowed: boolean, action: string) => {
        if (allowed) return true;
        toast.warning('Không có quyền phiếu giao HĐ NCC', `Bạn cần quyền phù hợp trong Tổ chức dự án để ${action}.`);
        return false;
    };

    const ensureCanCreatePo = (action: string) => {
        if (effectivePoCapabilities.canCreatePo) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền tạo/sửa PO để ${action}.`);
        return false;
    };

    const ensureCanApprovePo = (action: string) => {
        if (effectivePoCapabilities.canApprovePo) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền duyệt PO để ${action}.`);
        return false;
    };

    const ensureCanReceivePo = (action: string) => {
        if (effectivePoCapabilities.canReceivePo) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền nhận hàng PO để ${action}.`);
        return false;
    };

    const ensureCanDeletePo = (action: string) => {
        if (effectivePoCapabilities.canDeletePo) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền xoá PO để ${action}.`);
        return false;
    };

    const ensureCanReturnSupplierPo = (action: string) => {
        if (effectivePoCapabilities.canManagePo || canRunRestrictedPoActions) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền quản trị PO hoặc quyền kho tổng để ${action}.`);
        return false;
    };

    const ensureCanRunRestrictedPoAction = (action: string) => {
        if (canRunRestrictedPoActions) return true;
        toast.warning('Không có quyền thao tác PO', `Chỉ Admin hoặc thủ kho tổng được ${action}.`);
        return false;
    };

    const ensureCanMutatePoDocument = (po: PurchaseOrder, action: string) => {
        if (canUserMutatePurchaseOrder(po, user, effectivePoCapabilities)) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền tạo/sửa PO, quyền quản trị PO, hoặc là người tạo PO để ${action}.`);
        return false;
    };

    const ensureCanRemovePoDocument = (po: PurchaseOrder, action: string) => {
        if (canUserRemovePurchaseOrder(po, user, effectivePoCapabilities)) return true;
        toast.warning('Không có quyền thao tác PO', `Bạn cần quyền xoá PO, quyền quản trị PO, hoặc là người tạo PO để ${action}.`);
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
            setLoadingDirectPurchases(true);
            setLoadingSmallTools(true);
            const [partnerRows, poRows, stockPoRows, linkRows, directPurchaseRows, smallToolRows, supplierContractRows, supplierDeliveryRows, supplierStatementRows] = await Promise.all([
                partnerService.list({ classification: 'supplier' }),
                poService.list(effectiveId, constructionSiteId || null),
                poService.listStockOrders().catch(() => [] as PurchaseOrder[]),
                poService.listRequestLineLinks(effectiveId, constructionSiteId || null).catch(() => [] as PurchaseOrderRequestLineLink[]),
                siteDirectPurchaseService.list({ projectId: projectId || null, constructionSiteId: constructionSiteId || null }).catch(error => {
                    console.warn('Failed to load site direct purchases', error);
                    return [] as SiteDirectPurchase[];
                }),
                siteSmallToolService.list({ projectId: projectId || null, constructionSiteId: constructionSiteId || null }).catch(error => {
                    console.warn('Failed to load site small tools', error);
                    return [] as SiteSmallToolRecord[];
                }),
                supplierContractService.listBySite(projectId || constructionSiteId || '', constructionSiteId || null).catch(error => {
                    console.warn('Failed to load supplier contracts', error);
                    return [] as SupplierContract[];
                }),
                supplierDirectDeliveryService.list({ projectId: projectId || null, constructionSiteId: constructionSiteId || null }).catch(error => {
                    console.warn('Failed to load supplier direct deliveries', error);
                    return [] as SupplierDirectDeliveryNote[];
                }),
                supplierDeliveryStatementService.list({ projectId: projectId || null, constructionSiteId: constructionSiteId || null }).catch(error => {
                    console.warn('Failed to load supplier delivery statements', error);
                    return [] as SupplierDeliveryStatement[];
                }),
            ]);
            setPartners(partnerRows);
            setVendors([]);
            setDirectPurchases(directPurchaseRows);
            setSmallToolRecords(smallToolRows);
            setSupplierContracts(supplierContractRows);
            setSupplierDeliveryNotes(supplierDeliveryRows);
            setSupplierDeliveryStatements(supplierStatementRows);
            const supplierDeliveryLineEntries = await Promise.all(supplierDeliveryRows.map(async note => {
                try {
                    const detail = await supplierDirectDeliveryService.getDetail(note.id);
                    return [note.id, detail.lines] as const;
                } catch (error) {
                    console.warn('Failed to load supplier delivery lines', error);
                    return [note.id, note.lines || []] as const;
                }
            }));
            setSupplierDeliveryLinesByNoteId(Object.fromEntries(supplierDeliveryLineEntries));
            const supplierDeliveryWmsTransactionIds = Array.from(new Set(supplierDeliveryLineEntries.flatMap(([, lines]) =>
                lines.flatMap(line => [line.wmsImportTransactionId, line.wmsExportTransactionId]).filter(Boolean),
            ))) as string[];
            if (supplierDeliveryWmsTransactionIds.length > 0) {
                await refreshWmsRecords({ transactionIds: supplierDeliveryWmsTransactionIds }).catch(error => {
                    console.warn('Failed to refresh supplier delivery WMS transactions', error);
                });
            }
            const scopedStockRows = stockPoRows.filter(po => !po.projectId && !po.constructionSiteId);
            const linkedPoIds = Array.from(new Set(linkRows.map(link => link.purchaseOrderId).filter(Boolean)));
            const linkedCompanyPoRows = await poService.listByIds(linkedPoIds)
                .then(rows => rows.filter(po => po.sourceMode === 'company_consolidated'))
                .catch(error => {
                    console.warn('Failed to load linked company purchase orders', error);
                    return [] as PurchaseOrder[];
                });
            const byId = new Map<string, PurchaseOrder>();
            [...poRows, ...scopedStockRows, ...linkedCompanyPoRows].forEach(po => byId.set(po.id, po));
            const allPos = [...byId.values()];
            setPos(allPos);
            setPoRequestLinks(linkRows);

            const [supplierReturnRows, deliveryScheduleRows, supplementalApprovalRows] = await Promise.all([
                purchaseOrderSupplierReturnService.listByPurchaseOrderIds(allPos.map(po => po.id)),
                poDeliveryScheduleService.listByPurchaseOrderIds(allPos.map(po => po.id)),
                poSupplementalApprovalService.listByPurchaseOrderIds(allPos.map(po => po.id)),
            ]).catch(error => {
                console.error('Failed to load PO dependent data', error);
                return [
                    [] as PurchaseOrderSupplierReturn[],
                    {} as Record<string, PurchaseOrderDeliveryBatch[]>,
                    {} as Record<string, PurchaseOrderSupplementalApproval[]>,
                ] as const;
            });
            setSupplierReturnsByPo(supplierReturnRows.reduce<Record<string, PurchaseOrderSupplierReturn[]>>((acc, item) => {
                acc[item.purchaseOrderId] = [...(acc[item.purchaseOrderId] || []), item];
                return acc;
            }, {}));
            setPoDeliveryBatchesByPo(deliveryScheduleRows);
            setPoSupplementalApprovalsByPo(supplementalApprovalRows);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingDirectPurchases(false);
            setLoadingSmallTools(false);
        }
    };

    useEffect(() => {
        loadSupplyData();
    }, [effectiveId, constructionSiteId]);

    const [showVendorForm, setShowVendorForm] = useState(false);
    const [editingVendor, setEditingVendor] = useState<ProjectVendor | null>(null);
    const [showPoForm, setShowPoForm] = useState(false);
    const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);
    const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
    const [selectedWmsTransaction, setSelectedWmsTransaction] = useState<Transaction | null>(null);
    const [poPayableDocumentsByPoId, setPoPayableDocumentsByPoId] = useState<Record<string, SupplierPayableDocument[]>>({});
    const [loadingPoPayableId, setLoadingPoPayableId] = useState<string | null>(null);
    const [poPayableErrorsByPoId, setPoPayableErrorsByPoId] = useState<Record<string, string | null>>({});
    const [directPurchases, setDirectPurchases] = useState<SiteDirectPurchase[]>([]);
    const [loadingDirectPurchases, setLoadingDirectPurchases] = useState(false);
    const [supplierContracts, setSupplierContracts] = useState<SupplierContract[]>([]);
    const [supplierContractLines, setSupplierContractLines] = useState<SupplierContractLine[]>([]);
    const [supplierDeliveryNotes, setSupplierDeliveryNotes] = useState<SupplierDirectDeliveryNote[]>([]);
    const [supplierDeliveryLinesByNoteId, setSupplierDeliveryLinesByNoteId] = useState<Record<string, SupplierDirectDeliveryLine[]>>({});
    const [supplierDeliveryStatements, setSupplierDeliveryStatements] = useState<SupplierDeliveryStatement[]>([]);
    const [showSupplierDeliveryForm, setShowSupplierDeliveryForm] = useState(false);
    const [editingSupplierDelivery, setEditingSupplierDelivery] = useState<SupplierDirectDeliveryNote | null>(null);
    const [savingSupplierDelivery, setSavingSupplierDelivery] = useState(false);
    const [supplierDeliveryActionLoading, setSupplierDeliveryActionLoading] = useState<string | null>(null);
    const [selectedSupplierDelivery, setSelectedSupplierDelivery] = useState<SupplierDeliveryDetailState | null>(null);
    const [supplierDeliveryStatementPricing, setSupplierDeliveryStatementPricing] = useState<SupplierDeliveryStatementPricingState | null>(null);
    const [postingSupplierDeliveryStatement, setPostingSupplierDeliveryStatement] = useState(false);
    const [smallToolRecords, setSmallToolRecords] = useState<SiteSmallToolRecord[]>([]);
    const [loadingSmallTools, setLoadingSmallTools] = useState(false);
    const [smallToolSearch, setSmallToolSearch] = useState('');
    const [smallToolStatusFilter, setSmallToolStatusFilter] = useState<SiteSmallToolStatus | 'all'>('all');
    const [smallToolActionLoading, setSmallToolActionLoading] = useState<string | null>(null);
    const [selectedDirectPurchase, setSelectedDirectPurchase] = useState<SiteDirectPurchaseDetailState | null>(null);
    const [showDirectPurchaseForm, setShowDirectPurchaseForm] = useState(false);
    const [editingDirectPurchase, setEditingDirectPurchase] = useState<SiteDirectPurchase | null>(null);
    const [savingDirectPurchase, setSavingDirectPurchase] = useState(false);
    const [directActionLoading, setDirectActionLoading] = useState<string | null>(null);
    const [showRequestPicker, setShowRequestPicker] = useState(false);
    const [requestPickerMode, setRequestPickerMode] = useState<'create_po' | 'append_to_po'>('create_po');
    const [selectedRequestLineKeys, setSelectedRequestLineKeys] = useState<string[]>([]);
    const [supplierReturnPo, setSupplierReturnPo] = useState<PurchaseOrder | null>(null);
    const [poDeliveryBatchesByPo, setPoDeliveryBatchesByPo] = useState<Record<string, PurchaseOrderDeliveryBatch[]>>({});
    const [poSupplementalApprovalsByPo, setPoSupplementalApprovalsByPo] = useState<Record<string, PurchaseOrderSupplementalApproval[]>>({});
    const [creatingDeliveryBatchId, setCreatingDeliveryBatchId] = useState<string | null>(null);
    const [deletingDeliveryKey, setDeletingDeliveryKey] = useState<string | null>(null);
    const [deliveryDraftPo, setDeliveryDraftPo] = useState<PurchaseOrder | null>(null);
    const [deliveryDraftLines, setDeliveryDraftLines] = useState<PoDeliveryDraftLine[]>([]);
    const [savingDeliveryDraft, setSavingDeliveryDraft] = useState(false);

    const [poSearch, setPoSearch] = useState('');
    const [poStatusFilter, setPoStatusFilter] = useState<string>('all');
    const [poSourceFilter, setPoSourceFilter] = useState<string>('all');

    useEffect(() => {
        setPoPage(1);
    }, [poSearch, poStatusFilter, poSourceFilter]);

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
    const [pNumAutoGenerated, setPNumAutoGenerated] = useState(false);
    const [pTargetWarehouseId, setPTargetWarehouseId] = useState('');
    const [pSourceMode, setPSourceMode] = useState<PurchaseOrderSourceMode>('proactive_project');
    const [pDate, setPDate] = useState(new Date().toISOString().split('T')[0]);
    const [pExpDate, setPExpDate] = useState('');
    const [pVatRate, setPVatRate] = useState('0');
    const [pItems, setPItems] = useState<PurchaseOrderItem[]>([createEmptyPoItem()]);
    const [pDeliveryBatches, setPDeliveryBatches] = useState<PurchaseOrderDeliveryBatch[]>([]);
    const [pDeliveryScheduleMode, setPDeliveryScheduleMode] = useState<PoDeliveryScheduleMode>('unknown');
    const [pApprovalRequestTitle, setPApprovalRequestTitle] = useState('');
    const [pNote, setPNote] = useState('');
    const [importingPo, setImportingPo] = useState(false);
    const [poImportMode, setPoImportMode] = useState<ExcelImportMode>('create');
    const [poImportPreview, setPoImportPreview] = useState<ExcelImportPreview<PurchaseOrderItem> | null>(null);
    const [submittingPo, setSubmittingPo] = useState<PurchaseOrder | null>(null);
    const [submittingDirectPurchase, setSubmittingDirectPurchase] = useState<SiteDirectPurchase | null>(null);
    const [pendingPoSupplementalSubmission, setPendingPoSupplementalSubmission] = useState<PendingPoSupplementalSubmission | null>(null);
    const [printingPoId, setPrintingPoId] = useState<string | null>(null);
    const directPurchaseFileInputRef = useRef<HTMLInputElement | null>(null);

    const [dpId, setDpId] = useState('');
    const [dpCode, setDpCode] = useState('');
    const [dpMode, setDpMode] = useState<SiteDirectPurchaseMode>('immediate');
    const [dpSupplierId, setDpSupplierId] = useState('');
    const [dpManualSupplierEnabled, setDpManualSupplierEnabled] = useState(false);
    const [dpManualSupplierName, setDpManualSupplierName] = useState('');
    const [dpPaymentSource, setDpPaymentSource] = useState<SiteDirectPurchasePaymentSource>('supplier_credit');
    const [dpTargetWarehouseId, setDpTargetWarehouseId] = useState('');
    const [dpPurchaseDate, setDpPurchaseDate] = useState(todayIsoDate());
    const [dpInvoiceNumber, setDpInvoiceNumber] = useState('');
    const [dpInvoiceDate, setDpInvoiceDate] = useState('');
    const [dpAttachmentName, setDpAttachmentName] = useState('');
    const [dpAttachmentUrl, setDpAttachmentUrl] = useState('');
    const [dpAttachments, setDpAttachments] = useState<Attachment[]>([]);
    const [dpAttachmentAccept, setDpAttachmentAccept] = useState<string>('*/*');
    const [uploadingDirectPurchaseFiles, setUploadingDirectPurchaseFiles] = useState(false);
    const [dpNote, setDpNote] = useState('');
    const [dpLines, setDpLines] = useState<SiteDirectPurchaseFormLine[]>([createEmptyDirectPurchaseLine()]);
    const [showDirectPurchaseItemPicker, setShowDirectPurchaseItemPicker] = useState(false);
    const [directPurchaseItemPickerQuery, setDirectPurchaseItemPickerQuery] = useState('');
    const [selectedDirectPurchaseItemIds, setSelectedDirectPurchaseItemIds] = useState<string[]>([]);
    const [sdId, setSdId] = useState('');
    const [sdCode, setSdCode] = useState('');
    const [sdSupplierContractId, setSdSupplierContractId] = useState('');
    const [sdDeliveryTicketNo, setSdDeliveryTicketNo] = useState('');
    const [sdDeliveryDate, setSdDeliveryDate] = useState(todayIsoDate());
    const [sdVehicleNo, setSdVehicleNo] = useState('');
    const [sdNote, setSdNote] = useState('');
    const [sdLines, setSdLines] = useState<SupplierDirectDeliveryFormLine[]>([createEmptySupplierDeliveryLine()]);

    const getPoNumberScope = useCallback((sourceMode: PurchaseOrderSourceMode) => ({
        projectId: sourceMode === 'proactive_stock' ? null : projectId || constructionSiteId || null,
        constructionSiteId: sourceMode === 'proactive_stock' ? null : constructionSiteId || null,
    }), [constructionSiteId, projectId]);

    const getLocalFallbackPoNumber = useCallback((sourceMode: PurchaseOrderSourceMode) => {
        const scope = getPoNumberScope(sourceMode);
        const maxNumber = pos.reduce((max, po) => {
            const sameScope = (po.projectId || null) === scope.projectId
                && (po.constructionSiteId || null) === scope.constructionSiteId;
            if (!sameScope) return max;
            const match = /^PO-(\d+)(?:$|-)/i.exec(po.poNumber || '');
            return match ? Math.max(max, Number(match[1]) || 0) : max;
        }, 0);
        return `PO-${String(maxNumber + 1).padStart(3, '0')}`;
    }, [getPoNumberScope, pos]);

    const loadNextPoNumber = useCallback(async (sourceMode: PurchaseOrderSourceMode) => {
        const scope = getPoNumberScope(sourceMode);
        try {
            return await poService.nextNumber(scope.projectId, scope.constructionSiteId);
        } catch (error) {
            console.warn('Failed to load next PO number from database:', error);
            return getLocalFallbackPoNumber(sourceMode);
        }
    }, [getLocalFallbackPoNumber, getPoNumberScope]);
    const [poPrintMenuId, setPoPrintMenuId] = useState<string | null>(null);
    const [poDeliveryPrintGroupsByPoId, setPoDeliveryPrintGroupsByPoId] = useState<Record<string, PoDeliveryPrintGroup[]>>({});
    const [loadingPoDeliveryPrintPoId, setLoadingPoDeliveryPrintPoId] = useState<string | null>(null);
    const poDeliveryPrintAutoLoadRef = useRef<Set<string>>(new Set());
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
    const lastDeepLinkPoIdRef = useRef<string | null>(null);
    const lastDeepLinkDirectPurchaseIdRef = useRef<string | null>(null);
    const workBoqMap = useMemo(() => new Map(workBoqItems.map(item => [item.id, item])), [workBoqItems]);
    const materialBudgetMap = useMemo(() => new Map(materialBudgetItems.map(item => [item.id, item])), [materialBudgetItems]);
    const supplierById = useMemo(() => new Map(partners.map(partner => [partner.id, partner])), [partners]);
    const supplierContractById = useMemo(() => new Map(supplierContracts.map(contract => [contract.id, contract])), [supplierContracts]);
    const selectedSupplierDeliveryContract = sdSupplierContractId ? supplierContractById.get(sdSupplierContractId) : undefined;
    const constructionSiteById = useMemo(() => new Map(constructionSites.map(site => [site.id, site])), [constructionSites]);
    const getSupplierPatch = (supplierId?: string | null): Pick<PurchaseOrderItem, 'vendorId' | 'vendorName'> => {
        const supplier = supplierId ? supplierById.get(supplierId) : undefined;
        return supplier ? { vendorId: supplier.id, vendorName: supplier.name } : { vendorId: null, vendorName: null };
    };
    const getDefaultSupplierPatchForInventory = (inventory?: InventoryItem): Pick<PurchaseOrderItem, 'vendorId' | 'vendorName'> => {
        if (inventory?.supplierId && supplierById.has(inventory.supplierId)) return getSupplierPatch(inventory.supplierId);
        if (pVendorId && supplierById.has(pVendorId)) return getSupplierPatch(pVendorId);
        return { vendorId: null, vendorName: null };
    };
    const resetDirectPurchaseForm = () => {
        const id = crypto.randomUUID();
        setEditingDirectPurchase(null);
        setDpId(id);
        setDpMode('immediate');
        setDpCode(buildSiteDirectPurchaseCode('immediate', id));
        setDpSupplierId('');
        setDpManualSupplierEnabled(false);
        setDpManualSupplierName('');
        setDpPaymentSource('supplier_credit');
        setDpTargetWarehouseId('');
        setDpPurchaseDate(todayIsoDate());
        setDpInvoiceNumber('');
        setDpInvoiceDate('');
        setDpAttachmentName('');
        setDpAttachmentUrl('');
        setDpAttachments([]);
        setDpNote('');
        setDpLines([createEmptyDirectPurchaseLine(id)]);
        setShowDirectPurchaseForm(false);
    };

    const resetSupplierDeliveryForm = () => {
        const id = crypto.randomUUID();
        setEditingSupplierDelivery(null);
        setSdId(id);
        setSdCode(buildSupplierDirectDeliveryCode(id));
        setSdSupplierContractId('');
        setSdDeliveryTicketNo('');
        setSdDeliveryDate(todayIsoDate());
        setSdVehicleNo('');
        setSdNote('');
        setSupplierContractLines([]);
        setSdLines([createEmptySupplierDeliveryLine(id)]);
        setShowSupplierDeliveryForm(false);
    };

    const loadSupplierContractLinesForForm = async (supplierContractId: string, deliveryNoteId = sdId) => {
        if (!supplierContractId) {
            setSupplierContractLines([]);
            setSdLines([createEmptySupplierDeliveryLine(deliveryNoteId)]);
            return;
        }
        try {
            const lines = await supplierContractLineService.listByContract(supplierContractId);
            setSupplierContractLines(lines);
            setSdLines(lines.length > 0
                ? lines.slice(0, 1).map((line, index) => createEmptySupplierDeliveryLine(deliveryNoteId, supplierContractId, index + 1, line))
                : [createEmptySupplierDeliveryLine(deliveryNoteId, supplierContractId)]);
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.contractLines', error);
            toast.error('Không tải được đơn giá HĐ', getApiErrorMessage(error, 'Không thể tải dòng đơn giá HĐ NCC.'));
        }
    };

    const openCreateSupplierDelivery = () => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canCreateSupplierDelivery, 'tạo phiếu giao nhận theo HĐ')) return;
        if (!constructionSiteId) {
            toast.warning('Thiếu công trường', 'Phiếu giao HĐ cần gắn công trường để đối soát và ghi AP.');
            return;
        }
        const id = crypto.randomUUID();
        setEditingSupplierDelivery(null);
        setSdId(id);
        setSdCode(buildSupplierDirectDeliveryCode(id));
        setSdSupplierContractId('');
        setSdDeliveryTicketNo('');
        setSdDeliveryDate(todayIsoDate());
        setSdVehicleNo('');
        setSdNote('');
        setSupplierContractLines([]);
        setSdLines([createEmptySupplierDeliveryLine(id)]);
        setShowSupplierDeliveryForm(true);
    };

    const openEditSupplierDelivery = async (note: SupplierDirectDeliveryNote) => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canEditSupplierDelivery, 'sửa phiếu giao nhận theo HĐ')) return;
        if (!['draft', 'cancelled'].includes(note.status)) {
            toast.warning('Không thể sửa phiếu đã ghi', 'Hãy bỏ ghi trước khi sửa phiếu giao HĐ.');
            return;
        }
        setSupplierDeliveryActionLoading(`edit:${note.id}`);
        try {
            const detail = await supplierDirectDeliveryService.getDetail(note.id);
            const hasWmsProgress = detail.lines.some(line => Boolean(line.wmsImportTransactionId || line.wmsExportTransactionId));
            if (hasWmsProgress) {
                toast.warning('Không thể sửa phiếu đã có WMS', 'Phiếu giao HĐ đã phát sinh WMS nên không sửa trực tiếp.');
                return;
            }
            const contractLines = await supplierContractLineService.listByContract(detail.note.supplierContractId).catch(() => [] as SupplierContractLine[]);
            setEditingSupplierDelivery(detail.note);
            setSdId(detail.note.id);
            setSdCode(detail.note.code);
            setSdSupplierContractId(detail.note.supplierContractId);
            setSdDeliveryTicketNo(detail.note.deliveryTicketNo);
            setSdDeliveryDate(detail.note.deliveryDate || todayIsoDate());
            setSdVehicleNo(detail.note.vehicleNo || '');
            setSdNote(detail.note.note || '');
            setSupplierContractLines(contractLines);
            setSdLines(detail.lines.length > 0
                ? detail.lines.map(hydrateSupplierDeliveryFormLine)
                : [createEmptySupplierDeliveryLine(detail.note.id, detail.note.supplierContractId)]);
            setShowSupplierDeliveryForm(true);
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.edit', error);
            toast.error('Không tải được phiếu giao HĐ', getApiErrorMessage(error, 'Không thể tải chi tiết phiếu giao HĐ.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const selectSupplierDeliveryContract = async (supplierContractId: string) => {
        setSdSupplierContractId(supplierContractId);
        await loadSupplierContractLinesForForm(supplierContractId, sdId);
    };

    const updateSupplierDeliveryLine = (lineId: string, patch: Partial<SupplierDirectDeliveryFormLine>) => {
        setSdLines(prev => prev.map(line => line.id === lineId ? { ...line, ...patch } : line));
    };

    const selectSupplierDeliveryInventoryItem = (lineId: string, itemId: string) => {
        const inventory = inventoryItems.find(item => item.id === itemId);
        updateSupplierDeliveryLine(lineId, {
            itemId: inventory?.id || null,
            skuSnapshot: inventory?.sku || null,
            itemNameSnapshot: inventory?.name || '',
            unitSnapshot: inventory?.purchaseUnit || inventory?.unit || '',
        });
    };

    const addSupplierDeliveryLine = (contractLine?: SupplierContractLine | null) => {
        setSdLines(prev => [...prev, createEmptySupplierDeliveryLine(sdId, sdSupplierContractId, prev.length + 1, contractLine)]);
    };

    const removeSupplierDeliveryLine = async (lineId: string) => {
        if (sdLines.length <= 1) return;
        const line = sdLines.find(item => item.id === lineId);
        const ok = await confirm({
            title: 'Xóa dòng giao nhận',
            targetName: line?.itemNameSnapshot || 'Dòng giao nhận',
            warningText: 'Dòng này sẽ bị xóa khỏi phiếu đang nhập. Thao tác chỉ lưu vào hệ thống khi bấm lưu/cập nhật phiếu.',
            actionLabel: 'Xóa dòng',
            cancelLabel: 'Giữ lại',
            intent: 'danger',
            countdownSeconds: 1,
        });
        if (!ok) return;
        setSdLines(prev => prev.length > 1 ? prev.filter(line => line.id !== lineId) : prev);
    };

    const saveSupplierDelivery = async () => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canCreateSupplierDelivery || effectiveSupplierDeliveryCapabilities.canEditSupplierDelivery, 'lưu phiếu giao nhận theo HĐ')) return;
        if (!constructionSiteId) {
            toast.warning('Thiếu công trường', 'Phiếu giao HĐ cần gắn công trường.');
            return;
        }
        const contract = selectedSupplierDeliveryContract;
        if (!contract) {
            toast.warning('Thiếu HĐ NCC', 'Chọn HĐ Nhà cung cấp trước khi lưu phiếu giao.');
            return;
        }
        if (!sdDeliveryTicketNo.trim()) {
            toast.warning('Thiếu số phiếu NCC', 'Nhập số phiếu giao/biên bản giao hàng của NCC.');
            return;
        }
        const normalizedLines = sdLines.map((line, index) => normalizeSupplierDeliveryFormLine(line, index, sdId, contract.id));
        const invalidLine = normalizedLines.find(line =>
            !line.itemNameSnapshot.trim()
            || Number(line.quantity || 0) <= 0
        );
        if (invalidLine) {
            toast.warning('Kiểm tra dòng giao nhận', 'Mỗi dòng cần tên vật tư và số lượng lớn hơn 0.');
            return;
        }
        const invalidWmsLine = normalizedLines.find(line =>
            (line.wmsFlowMode || 'none') === 'direct_in_out'
            && (!line.itemId || !line.targetWarehouseId)
        );
        if (invalidWmsLine) {
            toast.warning('Thiếu dữ liệu WMS', 'Dòng nhập-xuất thẳng cần chọn mã vật tư WMS và kho nhập/xuất.');
            return;
        }
        const note: SupplierDirectDeliveryNote = {
            id: sdId,
            code: sdCode || buildSupplierDirectDeliveryCode(sdId),
            projectId: projectId || null,
            constructionSiteId,
            supplierContractId: contract.id,
            supplierContractCode: contract.code,
            supplierId: contract.supplierId || null,
            supplierNameSnapshot: contract.supplierName || contract.supplierId || 'Nhà cung cấp',
            deliveryTicketNo: sdDeliveryTicketNo.trim(),
            deliveryDate: sdDeliveryDate || todayIsoDate(),
            vehicleNo: sdVehicleNo.trim() || null,
            status: 'draft',
            grossAmount: 0,
            vatAmount: 0,
            totalAmount: 0,
            attachments: editingSupplierDelivery?.attachments || [],
            qrToken: editingSupplierDelivery?.qrToken || `qr_supplier_delivery_${sdId.replace(/-/g, '').slice(0, 16)}`,
            createdBy: editingSupplierDelivery?.createdBy || user?.id || null,
            createdAt: editingSupplierDelivery?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: sdNote.trim() || null,
        };
        setSavingSupplierDelivery(true);
        try {
            const saved = await supplierDirectDeliveryService.upsert(note, normalizedLines);
            toast.success(
                editingSupplierDelivery ? 'Đã cập nhật phiếu giao HĐ' : 'Đã tạo phiếu giao HĐ',
                `${saved.code} - ${normalizedLines.length} dòng giao nhận`,
            );
            resetSupplierDeliveryForm();
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.save', error);
            toast.error('Không lưu được phiếu giao HĐ', getApiErrorMessage(error, 'Không thể lưu phiếu giao nhận theo HĐ NCC.'));
        } finally {
            setSavingSupplierDelivery(false);
        }
    };

    const openSupplierDeliveryDetail = async (note: SupplierDirectDeliveryNote) => {
        setSupplierDeliveryActionLoading(`detail:${note.id}`);
        try {
            const detail = await supplierDirectDeliveryService.getDetail(note.id);
            setSelectedSupplierDelivery(detail);
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.detail', error);
            toast.error('Không tải được phiếu giao HĐ', getApiErrorMessage(error, 'Không thể tải chi tiết phiếu giao HĐ NCC.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const recordSupplierDeliveryNote = async (note: SupplierDirectDeliveryNote) => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canRecordSupplierDelivery, 'ghi phiếu giao HĐ NCC')) return;
        setSupplierDeliveryActionLoading(`record:${note.id}`);
        try {
            const saved = await supplierDirectDeliveryService.record(note.id, user?.id || null);
            toast.success('Đã ghi phiếu giao HĐ', `${saved.code} đã khóa số lượng để WMS/đối soát.`);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.record', error);
            if (error?.wmsImportFailed && error.recordedNote) {
                toast.warning(
                    'Đã ghi phiếu giao HĐ, chưa tạo WMS',
                    getApiErrorMessage(error, 'Phiếu đã khóa số lượng, nhưng chưa tạo được WMS import. Vui lòng bấm Tạo WMS nhập sau khi kiểm tra dữ liệu kho.'),
                );
                await loadSupplyData();
                return;
            }
            toast.error('Không ghi được phiếu giao HĐ', getApiErrorMessage(error, 'Không thể ghi nhận số lượng phiếu giao.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const unrecordSupplierDeliveryNote = async (note: SupplierDirectDeliveryNote) => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canUnrecordSupplierDelivery, 'bỏ ghi phiếu giao HĐ NCC')) return;
        setSupplierDeliveryActionLoading(`unrecord:${note.id}`);
        try {
            const saved = await supplierDirectDeliveryService.unrecord(note.id);
            toast.success('Đã bỏ ghi phiếu giao HĐ', `${saved.code} có thể chỉnh sửa lại.`);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.unrecord', error);
            toast.error('Không bỏ ghi được phiếu giao HĐ', getApiErrorMessage(error, 'Phiếu đã phát sinh WMS/đối soát/AP thì không thể bỏ ghi.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const deleteSupplierDeliveryNote = async (note: SupplierDirectDeliveryNote) => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canDeleteSupplierDelivery, 'xóa phiếu giao HĐ NCC')) return;
        const ok = await confirm({
            targetName: note.code,
            title: 'Xóa phiếu giao HĐ NCC',
            warningText: 'Chỉ xóa được phiếu chưa ghi hoặc đã bỏ ghi, chưa phát sinh WMS/đối soát/AP.',
        });
        if (!ok) return;
        setSupplierDeliveryActionLoading(`delete:${note.id}`);
        try {
            await supplierDirectDeliveryService.deleteDraft(note.id);
            toast.success('Đã xóa phiếu giao HĐ', note.code);
            if (selectedSupplierDelivery?.note.id === note.id) setSelectedSupplierDelivery(null);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.delete', error);
            toast.error('Không xóa được phiếu giao HĐ', getApiErrorMessage(error, 'Không thể xóa phiếu đã phát sinh WMS/đối soát/AP.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const createSupplierDeliveryWmsImportDraft = async (note: SupplierDirectDeliveryNote) => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canRecordSupplierDelivery, 'tạo WMS import từ phiếu giao HĐ')) return;
        setSupplierDeliveryActionLoading(`wms:${note.id}`);
        try {
            const txs = await supplierDirectDeliveryService.createWmsImportDrafts(note.id, user?.id || '');
            await refreshWmsRecords({
                transactionIds: txs.map(tx => tx.id),
                itemIds: Array.from(new Set(txs.flatMap(tx => tx.items.map(item => item.itemId)))),
            });
            toast.success('Đã tạo WMS import', `${note.code} đã có ${txs.length} phiếu nhập chờ thủ kho xác nhận.`);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.createWms', error);
            toast.error('Không tạo được WMS import', getApiErrorMessage(error, 'Không thể tạo phiếu nhập WMS từ phiếu giao HĐ.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const openSupplierDeliveryStatementPricing = async (note: SupplierDirectDeliveryNote) => {
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canReconcileSupplierDelivery, 'đối soát phiếu giao HĐ NCC')) return;
        setSupplierDeliveryActionLoading(`statement:${note.id}`);
        try {
            const detail = await supplierDirectDeliveryService.getDetail(note.id);
            const acceptedLines = detail.lines.filter(line => line.status === 'accepted' || line.status === 'adjusted');
            if (acceptedLines.length === 0) {
                toast.warning('Chưa có dòng đã ghi', 'Ghi phiếu giao trước khi tạo đối soát/AP.');
                return;
            }
            const blockedWmsLine = acceptedLines.find(line => !isSupplierDirectDeliveryLineStatementReady(line));
            if (blockedWmsLine) {
                toast.warning('Chưa hoàn tất WMS xuất dùng', `Dòng ${blockedWmsLine.itemNameSnapshot} cần phiếu xuất WMS COMPLETED trước khi đối soát/AP.`);
                return;
            }
            const contractLines = await supplierContractLineService.listByContract(note.supplierContractId).catch(() => [] as SupplierContractLine[]);
            const contractLineById = new Map(contractLines.map(line => [line.id, line]));
            setSupplierDeliveryStatementPricing({
                note,
                lines: acceptedLines.map(line => {
                    const contractLine = line.supplierContractLineId ? contractLineById.get(line.supplierContractLineId) : undefined;
                    return {
                        ...line,
                        unitPriceInput: String(contractLine?.unitPrice || line.unitPrice || ''),
                        vatRateInput: String(contractLine?.vatRate ?? line.vatRate ?? 0),
                    };
                }),
            });
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.statement.prepare', error);
            toast.error('Không mở được đối soát/AP', getApiErrorMessage(error, 'Không thể tải dòng đã ghi để đối soát.'));
        } finally {
            setSupplierDeliveryActionLoading(null);
        }
    };

    const updateSupplierDeliveryStatementPrice = (lineId: string, patch: Partial<Pick<SupplierDeliveryStatementPricingLine, 'unitPriceInput' | 'vatRateInput'>>) => {
        setSupplierDeliveryStatementPricing(prev => prev
            ? { ...prev, lines: prev.lines.map(line => line.id === lineId ? { ...line, ...patch } : line) }
            : prev);
    };

    const submitSupplierDeliveryStatementPricing = async () => {
        const pricing = supplierDeliveryStatementPricing;
        if (!pricing) return;
        if (!ensureSupplierDelivery(effectiveSupplierDeliveryCapabilities.canReconcileSupplierDelivery, 'ghi đối soát/AP phiếu giao HĐ NCC')) return;
        const invalidLine = pricing.lines.find(line => {
            const unitPrice = Number(line.unitPriceInput || 0);
            const vatRate = Number(line.vatRateInput || 0);
            return !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100;
        });
        if (invalidLine) {
            toast.warning('Kiểm tra giá đối soát', 'Đơn giá phải lớn hơn hoặc bằng 0 và VAT trong khoảng 0-100%.');
            return;
        }
        const pricedLines = pricing.lines.map(line => {
            const acceptedQuantity = Number(line.acceptedQuantity || line.quantity || 0);
            const unitPriceSnapshot = Number(line.unitPriceInput || 0);
            const vatRateSnapshot = normalizeVatRate(line.vatRateInput);
            const lineAmount = Math.round(acceptedQuantity * unitPriceSnapshot);
            const vatAmount = Math.round(lineAmount * vatRateSnapshot / 100);
            return {
                ...line,
                unitPriceSnapshot,
                vatRateSnapshot,
                acceptedQuantity,
                acceptedAmount: lineAmount,
                unitPrice: unitPriceSnapshot,
                vatRate: vatRateSnapshot,
                lineAmount,
                vatAmount,
                totalAmount: lineAmount + vatAmount,
            } as SupplierDirectDeliveryLine & { unitPriceSnapshot: number; vatRateSnapshot: number };
        });
        const totals = pricedLines.reduce((sum, line) => ({
            grossAmount: sum.grossAmount + line.lineAmount,
            vatAmount: sum.vatAmount + line.vatAmount,
            totalAmount: sum.totalAmount + line.totalAmount,
        }), { grossAmount: 0, vatAmount: 0, totalAmount: 0 });
        if (totals.totalAmount <= 0) {
            toast.warning('Chưa có giá trị đối soát', 'Nhập đơn giá cho ít nhất một dòng trước khi ghi AP.');
            return;
        }
        const note = pricing.note;
        const statementId = crypto.randomUUID();
        const periodMonth = `${(note.deliveryDate || todayIsoDate()).slice(0, 7)}-01`;
        const statement: SupplierDeliveryStatement = {
            id: statementId,
            code: buildSupplierDeliveryStatementCode(statementId, periodMonth),
            projectId: note.projectId || projectId || null,
            constructionSiteId: note.constructionSiteId || constructionSiteId || null,
            supplierContractId: note.supplierContractId,
            supplierContractCode: note.supplierContractCode || null,
            supplierId: note.supplierId || null,
            supplierNameSnapshot: note.supplierNameSnapshot,
            periodMonth,
            statementDate: todayIsoDate(),
            status: 'draft',
            grossAmount: Math.round(totals.grossAmount),
            vatAmount: Math.round(totals.vatAmount),
            totalAmount: Math.round(totals.totalAmount),
            payableDocumentId: null,
            qrToken: `qr_supplier_statement_${statementId.replace(/-/g, '').slice(0, 16)}`,
            attachments: [],
            metadata: {
                deliveryNoteIds: [note.id],
                supplierContractId: note.supplierContractId,
                supplierContractCode: note.supplierContractCode || null,
            },
            createdBy: user?.id || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: `Đối soát từ phiếu giao ${note.code}`,
        };
        setPostingSupplierDeliveryStatement(true);
        try {
            const draft = await supplierDeliveryStatementService.upsert(statement, pricedLines);
            const posted = await supplierDeliveryStatementService.post(draft.id, user?.id || null);
            await supplierPayableService.syncDeliveryStatementById(posted.id).catch(() => null);
            toast.success('Đã đối soát và ghi AP', `${posted.code} - ${fmtMoney(posted.totalAmount)} đ`);
            setSupplierDeliveryStatementPricing(null);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.supplierDelivery.statement', error);
            toast.error('Không tạo được đối soát/AP', getApiErrorMessage(error, 'Không thể tạo bảng đối soát HĐ NCC.'));
        } finally {
            setPostingSupplierDeliveryStatement(false);
        }
    };
    const openCreateDirectPurchase = (mode: SiteDirectPurchaseMode = 'immediate') => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canCreateDirectPurchase, 'tạo phiếu mua nóng')) return;
        if (!constructionSiteId) {
            toast.warning('Thiếu công trường', 'Mua nóng cần scope công trường để theo dõi WMS/AP và hoàn ứng.');
            return;
        }
        const id = crypto.randomUUID();
        setEditingDirectPurchase(null);
        setDpId(id);
        setDpMode(mode);
        setDpCode(buildSiteDirectPurchaseCode(mode, id));
        setDpSupplierId('');
        setDpManualSupplierEnabled(false);
        setDpManualSupplierName('');
        setDpPaymentSource(mode === 'immediate' ? 'site_cash' : 'supplier_credit');
        setDpTargetWarehouseId('');
        setDpPurchaseDate(todayIsoDate());
        setDpInvoiceNumber('');
        setDpInvoiceDate('');
        setDpAttachmentName('');
        setDpAttachmentUrl('');
        setDpAttachments([]);
        setDpNote('');
        setDpLines([createEmptyDirectPurchaseLine(id)]);
        setShowDirectPurchaseForm(true);
    };
    const openEditDirectPurchase = async (purchase: SiteDirectPurchase) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canEditDirectPurchase, 'sửa phiếu mua nóng')) return;
        setDirectActionLoading(`edit:${purchase.id}`);
        try {
            const detail = await siteDirectPurchaseService.getDetail(purchase.id);
            setEditingDirectPurchase(detail.purchase);
            setDpId(detail.purchase.id);
            setDpCode(detail.purchase.code);
            setDpMode(detail.purchase.purchaseMode);
            const hasKnownSupplier = Boolean(detail.purchase.supplierId && supplierById.has(detail.purchase.supplierId));
            setDpSupplierId(hasKnownSupplier ? detail.purchase.supplierId || '' : '');
            setDpManualSupplierEnabled(!hasKnownSupplier);
            setDpManualSupplierName(hasKnownSupplier ? '' : detail.purchase.supplierNameSnapshot || '');
            setDpPaymentSource(detail.purchase.paymentSource);
            setDpTargetWarehouseId(detail.purchase.targetWarehouseId || '');
            setDpPurchaseDate(detail.purchase.purchaseDate || todayIsoDate());
            setDpInvoiceNumber(detail.purchase.invoiceNumber || '');
            setDpInvoiceDate(detail.purchase.invoiceDate || '');
            setDpAttachmentName(detail.purchase.attachments?.[0]?.name || '');
            setDpAttachmentUrl(detail.purchase.attachments?.[0]?.url || '');
            setDpAttachments(detail.purchase.attachments || []);
            setDpNote(detail.purchase.note || '');
            setDpLines(detail.lines.length > 0
                ? detail.lines.map(hydrateDirectPurchaseFormLine)
                : [createEmptyDirectPurchaseLine(detail.purchase.id)]);
            setShowDirectPurchaseForm(true);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.edit', error);
            toast.error('Không tải được phiếu mua nóng', getApiErrorMessage(error, 'Không thể tải chi tiết phiếu mua nóng.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const updateDirectPurchaseLine = (lineId: string, patch: Partial<SiteDirectPurchaseFormLine>) => {
        setDpLines(prev => prev.map(line => line.id === lineId ? { ...line, ...patch } : line));
    };
    const selectDirectPurchaseInventoryItem = (lineId: string, itemId: string) => {
        const inventory = inventoryItems.find(item => item.id === itemId);
        updateDirectPurchaseLine(lineId, {
            itemId: inventory?.id || null,
            skuSnapshot: inventory?.sku || null,
            itemNameSnapshot: inventory?.name || '',
            unitSnapshot: inventory?.purchaseUnit || inventory?.unit || '',
            unitPriceInput: inventory?.priceIn ? String(inventory.priceIn) : '',
            unitPrice: Number(inventory?.priceIn || 0),
        });
        if (!dpManualSupplierEnabled && !dpSupplierId && inventory?.supplierId && supplierById.has(inventory.supplierId)) {
            setDpSupplierId(inventory.supplierId);
        }
    };
    const addDirectPurchaseLine = (lineType: SiteDirectPurchaseLineType) => {
        setDpLines(prev => [...prev, createEmptyDirectPurchaseLine(dpId, prev.length + 1, lineType)]);
    };
    const toggleDirectPurchasePickerItem = (itemId: string) => {
        setSelectedDirectPurchaseItemIds(prev => prev.includes(itemId)
            ? prev.filter(id => id !== itemId)
            : [...prev, itemId]);
    };
    const addSelectedDirectPurchaseInventoryItems = () => {
        const selectedItems = selectedDirectPurchaseItemIds
            .map(itemId => inventoryItems.find(item => item.id === itemId))
            .filter(Boolean) as InventoryItem[];
        if (selectedItems.length === 0) {
            toast.warning('Chưa chọn vật tư', 'Tích ít nhất một mã vật tư tồn kho để thêm vào phiếu.');
            return;
        }
        setDpLines(prev => {
            const emptyStockIndex = prev.findIndex(line =>
                line.lineType === 'stock_item'
                && !line.itemId
                && !String(line.itemNameSnapshot || '').trim()
            );
            const newLines = selectedItems.map((item, index) =>
                createDirectPurchaseLineFromInventoryItem(item, dpId, prev.length + index + 1),
            );
            const merged = emptyStockIndex >= 0
                ? prev.flatMap((line, index) => index === emptyStockIndex
                    ? [{ ...newLines[0], id: line.id, directPurchaseId: line.directPurchaseId || dpId }, ...newLines.slice(1)]
                    : [line])
                : [...prev, ...newLines];
            return merged.map((line, index) => ({ ...line, lineNo: index + 1 }));
        });
        if (!dpManualSupplierEnabled && !dpSupplierId) {
            const supplierItem = selectedItems.find(item => item.supplierId && supplierById.has(item.supplierId));
            if (supplierItem?.supplierId) setDpSupplierId(supplierItem.supplierId);
        }
        setSelectedDirectPurchaseItemIds([]);
        setDirectPurchaseItemPickerQuery('');
        setShowDirectPurchaseItemPicker(false);
    };
    const removeDirectPurchaseLine = async (lineId: string) => {
        if (dpLines.length <= 1) return;
        const line = dpLines.find(item => item.id === lineId);
        const ok = await confirm({
            title: 'Xóa dòng mua nóng',
            targetName: line?.itemNameSnapshot || 'Dòng mua nóng',
            warningText: 'Dòng này sẽ bị xóa khỏi phiếu đang nhập. Thao tác chỉ lưu vào hệ thống khi bấm lưu/cập nhật phiếu.',
            actionLabel: 'Xóa dòng',
            cancelLabel: 'Giữ lại',
            intent: 'danger',
            countdownSeconds: 1,
        });
        if (!ok) return;
        setDpLines(prev => prev.length > 1 ? prev.filter(line => line.id !== lineId) : prev);
    };
    const pickDirectPurchaseFiles = (accept: string) => {
        setDpAttachmentAccept(accept);
        window.setTimeout(() => directPurchaseFileInputRef.current?.click(), 0);
    };
    const uploadDirectPurchaseFiles = async (files: File[]) => {
        if (files.length === 0) return;
        setUploadingDirectPurchaseFiles(true);
        try {
            const uploaded: Attachment[] = [];
            for (const file of files) {
                if (isSupabaseConfigured) {
                    const path = `site-direct-purchases/${projectId || constructionSiteId || effectiveId || 'scope'}/${dpId}/${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
                    const { error } = await supabase.storage.from('project-attachments').upload(path, file, {
                        cacheControl: '3600',
                        upsert: false,
                        contentType: file.type || undefined,
                    });
                    if (error) throw error;
                    const { data } = supabase.storage.from('project-attachments').getPublicUrl(path);
                    uploaded.push({
                        id: crypto.randomUUID(),
                        name: file.name,
                        fileName: file.name,
                        url: data.publicUrl,
                        fileType: file.type,
                        fileSize: file.size,
                        category: file.type.startsWith('image/') ? 'image' : 'invoice',
                        uploadedAt: new Date().toISOString(),
                        uploadedBy: user?.id,
                    });
                } else {
                    uploaded.push({
                        id: crypto.randomUUID(),
                        name: file.name,
                        fileName: file.name,
                        url: URL.createObjectURL(file),
                        fileType: file.type,
                        fileSize: file.size,
                        category: file.type.startsWith('image/') ? 'image' : 'invoice',
                        uploadedAt: new Date().toISOString(),
                        uploadedBy: user?.id,
                    });
                }
            }
            setDpAttachments(prev => [...prev, ...uploaded]);
            toast.success('Đã đính kèm chứng từ', `${uploaded.length} file đã được thêm vào phiếu mua nóng.`);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.uploadAttachment', error);
            toast.error('Không tải được file', getApiErrorMessage(error, 'Không thể upload file chứng từ mua nóng.'));
        } finally {
            setUploadingDirectPurchaseFiles(false);
            if (directPurchaseFileInputRef.current) directPurchaseFileInputRef.current.value = '';
        }
    };
    const saveDirectPurchase = async () => {
        if (!ensureDirectPurchase(
            editingDirectPurchase ? effectiveDirectPurchaseCapabilities.canEditDirectPurchase : effectiveDirectPurchaseCapabilities.canCreateDirectPurchase,
            'lưu phiếu mua nóng',
        )) return;
        if (!constructionSiteId) {
            toast.warning('Thiếu công trường', 'Mua nóng cần gắn công trường.');
            return;
        }
        const supplier = dpSupplierId ? supplierById.get(dpSupplierId) : null;
        const supplierNameSnapshot = dpManualSupplierEnabled ? dpManualSupplierName.trim() : supplier?.name;
        if (!supplierNameSnapshot) {
            toast.warning('Thiếu NCC', dpManualSupplierEnabled ? 'Nhập tên NCC/cửa hàng viết tay.' : 'Chọn nhà cung cấp cho phiếu mua nóng hoặc bật NCC viết tay.');
            return;
        }
        const normalizedLines = dpLines.map((line, index) => normalizeDirectPurchaseFormLine(line, index, dpId));
        const invalidLine = normalizedLines.find(line =>
            !line.itemNameSnapshot
            || Number(line.quantity || 0) <= 0
            || Number(line.unitPrice || 0) < 0
            || (line.lineType === 'stock_item' && !line.itemId)
        );
        if (invalidLine) {
            toast.warning('Kiểm tra dòng mua nóng', 'Dòng tồn kho cần mã vật tư; dòng chi phí/CCDC cần tên, số lượng lớn hơn 0 và đơn giá hợp lệ.');
            return;
        }
        const totals = calculateSiteDirectPurchaseTotals(normalizedLines);
        const status = editingDirectPurchase?.status || (dpMode === 'planned' ? 'draft' : 'purchased');
        const manualLinkAttachment: Attachment[] = dpAttachmentUrl.trim()
            ? [{
                id: editingDirectPurchase?.attachments?.[0]?.id || crypto.randomUUID(),
                name: dpAttachmentName.trim() || dpInvoiceNumber.trim() || 'Chứng từ mua nóng',
                url: dpAttachmentUrl.trim(),
                category: 'invoice',
                uploadedAt: editingDirectPurchase?.attachments?.[0]?.uploadedAt || new Date().toISOString(),
                uploadedBy: user?.id,
            }]
            : [];
        const attachments = [
            ...dpAttachments,
            ...manualLinkAttachment.filter(att => !dpAttachments.some(existing => existing.url === att.url)),
        ];
        const purchase: SiteDirectPurchase = {
            id: dpId,
            code: dpCode || buildSiteDirectPurchaseCode(dpMode, dpId),
            projectId: projectId || null,
            constructionSiteId,
            supplierId: dpManualSupplierEnabled ? null : supplier?.id || null,
            supplierNameSnapshot,
            purchaseMode: dpMode,
            paymentSource: dpPaymentSource,
            targetWarehouseId: dpTargetWarehouseId || null,
            status,
            purchaseDate: dpPurchaseDate || null,
            invoiceNumber: dpInvoiceNumber.trim() || null,
            invoiceDate: dpInvoiceDate || null,
            grossAmount: totals.grossAmount,
            vatAmount: totals.vatAmount,
            totalAmount: totals.totalAmount,
            poId: editingDirectPurchase?.poId || null,
            wmsTransactionId: editingDirectPurchase?.wmsTransactionId || null,
            siteCashSettlementId: editingDirectPurchase?.siteCashSettlementId || null,
            qrToken: editingDirectPurchase?.qrToken || `qr_site_direct_${dpId.replace(/-/g, '').slice(0, 16)}`,
            attachments,
            createdBy: editingDirectPurchase?.createdBy || user?.id || null,
            createdAt: editingDirectPurchase?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: dpNote.trim() || null,
        };
        setSavingDirectPurchase(true);
        let savedPurchase: SiteDirectPurchase | null = null;
        try {
            savedPurchase = await siteDirectPurchaseService.upsert(purchase, normalizedLines);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.save', error);
            toast.error('Không lưu được phiếu mua nóng', getApiErrorMessage(error, 'Không thể lưu phiếu mua nóng.'));
            setSavingDirectPurchase(false);
            return;
        }
        if (!savedPurchase) {
            setSavingDirectPurchase(false);
            return;
        }
        toast.success(editingDirectPurchase ? 'Đã cập nhật phiếu mua nóng' : 'Đã tạo phiếu mua nóng', `${savedPurchase.code} - ${fmtMoney(savedPurchase.totalAmount)} đ`);
        setShowDirectPurchaseForm(false);
        setEditingDirectPurchase(null);
        try {
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.reloadAfterSave', error);
            toast.warning('Đã lưu, chưa tải lại danh sách', getApiErrorMessage(error, 'Phiếu đã được lưu. Bấm tải lại hoặc reload nếu danh sách chưa cập nhật.'));
        } finally {
            setSavingDirectPurchase(false);
        }
    };
    const openDirectPurchaseDetail = async (purchase: SiteDirectPurchase) => {
        setDirectActionLoading(`detail:${purchase.id}`);
        try {
            const detail = await siteDirectPurchaseService.getDetail(purchase.id);
            setSelectedDirectPurchase(detail);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.detail', error);
            toast.error('Không tải được phiếu mua nóng', getApiErrorMessage(error, 'Không thể tải chi tiết phiếu mua nóng.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const openDirectPurchaseDetailById = async (id: string) => {
        const purchase = directPurchases.find(item => item.id === id);
        if (purchase) {
            await openDirectPurchaseDetail(purchase);
            return;
        }
        setDirectActionLoading(`detail:${id}`);
        try {
            const detail = await siteDirectPurchaseService.getDetail(id);
            setSelectedDirectPurchase(detail);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.detailById', error);
            toast.error('Không tải được phiếu mua nóng', getApiErrorMessage(error, 'Không thể tải chứng từ nguồn của CCDC.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const reloadSelectedDirectPurchase = async (id: string) => {
        const detail = await siteDirectPurchaseService.getDetail(id);
        setSelectedDirectPurchase(detail);
        await loadSupplyData();
    };
    const canDeleteDirectPurchaseDocument = (purchase: SiteDirectPurchase) =>
        !purchase.everSubmitted
        && !['submitted', 'approved_to_buy', 'finance_review', 'reconciled', 'closed'].includes(purchase.status)
        && !purchase.wmsTransactionId
        && !purchase.siteCashSettlementId
        && !purchase.poId;
    const canEditDirectPurchaseDocument = (purchase: SiteDirectPurchase) =>
        canDeleteDirectPurchaseDocument(purchase) || purchase.status === 'draft';
    const updateSmallToolCustody = async (record: SiteSmallToolRecord) => {
        if (!ensureCanManage('cập nhật bàn giao CCDC nhỏ')) return;
        const holderName = window.prompt('Người/bộ phận đang giữ CCDC', record.holderNameSnapshot || '');
        if (holderName === null) return;
        const locationNote = window.prompt('Vị trí đang để CCDC', record.locationNote || '');
        if (locationNote === null) return;
        setSmallToolActionLoading(`custody:${record.id}`);
        try {
            await siteSmallToolService.updateCustody(record.id, {
                holderType: 'manual',
                holderId: null,
                holderNameSnapshot: holderName.trim() || 'Chưa rõ người giữ',
                locationNote: locationNote.trim() || null,
            });
            toast.success('Đã cập nhật CCDC', `${record.code} đã được cập nhật người/vị trí giữ.`);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.smallTool.custody', error);
            toast.error('Không cập nhật được CCDC', getApiErrorMessage(error, 'Không thể cập nhật người/vị trí giữ.'));
        } finally {
            setSmallToolActionLoading(null);
        }
    };
    const updateSmallToolStatus = async (record: SiteSmallToolRecord, status: SiteSmallToolStatus) => {
        if (!ensureCanManage('cập nhật trạng thái CCDC nhỏ')) return;
        const needsNote = status === 'damaged' || status === 'lost' || status === 'disposed';
        const note = needsNote ? window.prompt(`Ghi chú ${SMALL_TOOL_STATUS[status].label.toLowerCase()}`, record.note || '') : record.note || null;
        if (needsNote && note === null) return;
        setSmallToolActionLoading(`status:${record.id}`);
        try {
            const saved = await siteSmallToolService.updateStatus(record.id, status, note || null);
            toast.success('Đã cập nhật CCDC', `${saved.code} - ${SMALL_TOOL_STATUS[saved.status].label}`);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.smallTool.status', error);
            toast.error('Không cập nhật được CCDC', getApiErrorMessage(error, 'Không thể cập nhật trạng thái CCDC.'));
        } finally {
            setSmallToolActionLoading(null);
        }
    };
    const updateDirectPurchaseStatus = async (purchase: SiteDirectPurchase, status: SiteDirectPurchaseStatus) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canEditDirectPurchase, 'cập nhật trạng thái mua nóng')) return;
        if (status === 'approved_to_buy') {
            const ok = await confirm({
                title: 'Duyệt mua nóng',
                targetName: purchase.code,
                subtitle: `${purchase.supplierNameSnapshot} • ${fmtMoney(purchase.totalAmount)} đ`,
                warningText: 'Phiếu sẽ được phép mua. Sau bước này nếu cần sửa phải hủy duyệt trước khi đánh dấu đã mua/phát sinh WMS/AP.',
                actionLabel: 'Duyệt mua',
                cancelLabel: 'Kiểm tra lại',
                intent: 'success',
                countdownSeconds: 1,
            });
            if (!ok) return;
        }
        setDirectActionLoading(`${status}:${purchase.id}`);
        try {
            const saved = status === 'approved_to_buy'
                ? await siteDirectPurchaseService.approveToBuy(purchase.id)
                : status === 'submitted'
                    ? await siteDirectPurchaseService.submit(purchase.id)
                    : await siteDirectPurchaseService.setStatus(purchase.id, status);
            toast.success('Đã cập nhật phiếu mua nóng', `${saved.code} - ${DIRECT_PURCHASE_STATUS[saved.status]?.label || saved.status}`);
            await reloadSelectedDirectPurchase(purchase.id);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.status', error);
            toast.error('Không cập nhật được phiếu mua nóng', getApiErrorMessage(error, 'Không thể cập nhật trạng thái.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const cancelDirectPurchaseApproval = async (purchase: SiteDirectPurchase) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canEditDirectPurchase, 'hủy duyệt phiếu mua nóng')) return;
        const reason = await reasonConfirm({
            title: 'Hủy duyệt mua nóng',
            targetName: purchase.code,
            subtitle: `${purchase.supplierNameSnapshot} • ${fmtMoney(purchase.totalAmount)} đ`,
            warningText: 'Phiếu sẽ quay về trạng thái đã trình. Chỉ hủy duyệt khi chưa đánh dấu đã mua hoặc phát sinh WMS/AP.',
            reasonLabel: 'Lý do hủy duyệt',
            reasonPlaceholder: 'VD: Cần bổ sung báo giá, sai nhà cung cấp, sai số lượng...',
            actionLabel: 'Hủy duyệt',
            cancelLabel: 'Giữ đã duyệt',
            intent: 'warning',
        });
        if (!reason) return;
        setDirectActionLoading(`cancel:${purchase.id}`);
        try {
            const saved = await siteDirectPurchaseService.cancelApproval(purchase.id, reason, user?.id || null);
            toast.success('Đã hủy duyệt phiếu mua nóng', `${saved.code} đã quay về trạng thái đã trình.`);
            await reloadSelectedDirectPurchase(purchase.id);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.cancelApproval', error);
            toast.error('Không hủy duyệt được phiếu mua nóng', getApiErrorMessage(error, 'Không thể hủy duyệt phiếu đã phát sinh bước sau.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const submitDirectPurchaseForApproval = async (purchase: SiteDirectPurchase, target: ProjectSubmissionTarget) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canEditDirectPurchase, 'gửi duyệt phiếu mua nóng')) return;
        setDirectActionLoading(`submitted:${purchase.id}`);
        try {
            const saved = await siteDirectPurchaseService.submit(purchase.id, target, user?.id || null);
            await projectSubmissionService.notifyTarget({
                target,
                actorId: user?.id,
                category: 'finance',
                title: `Phiếu mua nóng ${purchase.code} chờ duyệt`,
                message: `Bạn được chọn duyệt phiếu mua nóng ${purchase.code} của ${purchase.supplierNameSnapshot}.`,
                sourceType: 'site_direct_purchase',
                sourceId: purchase.id,
                constructionSiteId: purchase.constructionSiteId || constructionSiteId,
                link: '/da',
                metadata: {
                    projectId: purchase.projectId || projectId,
                    totalAmount: purchase.totalAmount,
                    supplierId: purchase.supplierId,
                    supplierName: purchase.supplierNameSnapshot,
                },
            }).catch(error => console.warn('Cannot notify direct purchase recipient', error));
            toast.success('Đã gửi duyệt phiếu mua nóng', `${saved.code} -> ${target.name || target.userId}`);
            setSubmittingDirectPurchase(null);
            await reloadSelectedDirectPurchase(purchase.id);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.submit', error);
            toast.error('Không gửi duyệt được phiếu mua nóng', getApiErrorMessage(error, 'Không thể gửi phiếu tới người duyệt.'));
            throw error;
        } finally {
            setDirectActionLoading(null);
        }
    };
    const reviewDirectPurchaseLine = async (line: SiteDirectPurchaseLine, status: 'accepted' | 'adjusted' | 'rejected') => {
        const detail = selectedDirectPurchase;
        if (!detail || !ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canRecordDirectPurchaseAp, 'duyệt dòng mua nóng')) return;
        if (status === 'accepted' || status === 'adjusted') {
            const ok = await confirm({
                title: status === 'accepted' ? 'Duyệt dòng mua nóng' : 'Duyệt điều chỉnh dòng mua nóng',
                targetName: line.itemNameSnapshot || line.skuSnapshot || line.id,
                subtitle: `${fmtQty(line.quantity)} ${line.unitSnapshot || ''} • ${fmtMoney(Number(line.lineAmount || 0) + Number(line.vatAmount || 0))} đ`,
                warningText: 'Dòng được duyệt sẽ đủ điều kiện đi tiếp WMS/AP theo loại dòng. Kiểm tra lại số lượng, đơn giá và chứng từ trước khi xác nhận.',
                actionLabel: 'Duyệt dòng',
                cancelLabel: 'Kiểm tra lại',
                intent: 'success',
                countdownSeconds: 1,
            });
            if (!ok) return;
        }
        setDirectActionLoading(`review:${line.id}`);
        try {
            await siteDirectPurchaseService.reviewLines(detail.purchase.id, [{
                lineId: line.id,
                status,
                acceptedQuantity: status === 'rejected' ? 0 : Number(line.quantity || 0),
                acceptedAmount: status === 'rejected' ? 0 : Number(line.lineAmount || 0) + Number(line.vatAmount || 0),
                reviewNote: status === 'rejected' ? 'Kế toán từ chối dòng chứng từ' : 'Kế toán chấp nhận dòng chứng từ',
            }]);
            await reloadSelectedDirectPurchase(detail.purchase.id);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.reviewLine', error);
            toast.error('Không duyệt được dòng mua nóng', getApiErrorMessage(error, 'Không thể duyệt dòng chứng từ.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const createDirectPurchaseWmsDraft = async (purchase: SiteDirectPurchase) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canEditDirectPurchase, 'tạo phiếu nhập WMS từ mua nóng')) return;
        setDirectActionLoading(`wms:${purchase.id}`);
        try {
            const tx = await siteDirectPurchaseService.createWmsImportDraft(purchase.id, user?.id || '');
            await refreshWmsRecords({
                transactionIds: [tx.id],
                itemIds: tx.items.map(item => item.itemId),
            });
            toast.success('Đã tạo phiếu nhập WMS', `${purchase.code} đã có phiếu ${tx.id}.`);
            await reloadSelectedDirectPurchase(purchase.id);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.createWms', error);
            toast.error('Không tạo được WMS import', getApiErrorMessage(error, 'Không thể tạo phiếu nhập WMS.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const syncDirectPurchasePayable = async (purchase: SiteDirectPurchase) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canRecordDirectPurchaseAp, 'ghi nhận AP mua nóng')) return;
        setDirectActionLoading(`ap:${purchase.id}`);
        try {
            const document = await siteDirectPurchaseService.syncPayable(purchase.id);
            await siteDirectPurchaseService.setStatus(purchase.id, 'reconciled').catch(() => document);
            toast.success('Đã ghi nhận AP mua nóng', `${document.documentNo || purchase.code}: ${fmtMoney(document.recognizedAmount)} đ`);
            await reloadSelectedDirectPurchase(purchase.id);
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.syncPayable', error);
            toast.error('Không ghi nhận được AP', getApiErrorMessage(error, 'Stock line cần WMS hoàn tất và dòng chứng từ đã được duyệt.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const deleteDirectPurchase = async (purchase: SiteDirectPurchase) => {
        if (!ensureDirectPurchase(effectiveDirectPurchaseCapabilities.canDeleteDirectPurchase, 'xóa phiếu mua nóng')) return;
        const ok = await confirm({
            targetName: purchase.code,
            title: 'Xóa phiếu mua nóng',
            warningText: 'Chỉ xóa được phiếu chưa phát sinh WMS, AP hoặc hoàn ứng/quỹ.',
        });
        if (!ok) return;
        setDirectActionLoading(`delete:${purchase.id}`);
        try {
            await siteDirectPurchaseService.deleteDraft(purchase.id);
            toast.success('Đã xóa phiếu mua nóng', purchase.code);
            if (selectedDirectPurchase?.purchase.id === purchase.id) setSelectedDirectPurchase(null);
            await loadSupplyData();
        } catch (error: any) {
            logApiError('supplyChain.siteDirect.delete', error);
            toast.error('Không xóa được phiếu mua nóng', getApiErrorMessage(error, 'Không thể xóa phiếu đã phát sinh WMS/AP/hoàn ứng.'));
        } finally {
            setDirectActionLoading(null);
        }
    };
    const openWmsTransactionById = (transactionId?: string | null) => {
        if (!transactionId) return;
        const tx = transactions.find(item => item.id === transactionId);
        if (!tx) {
            toast.info('Chưa tải phiếu WMS', 'Phiếu WMS có thể chưa nằm trong dữ liệu hiện tại. Vui lòng mở module Phiếu kho hoặc tải lại dữ liệu.');
            return;
        }
        setSelectedWmsTransaction(tx);
    };
    const openDocumentTrace = (path: string) => {
        window.location.hash = path;
    };
    const openDirectPurchaseWmsTransaction = (purchase: SiteDirectPurchase) => {
        openWmsTransactionById(purchase.wmsTransactionId);
    };
    const makePoDeliveryLineDraft = (
        batchId: string,
        purchaseOrderId: string,
        item: PurchaseOrderItem,
        plannedQty: number,
        deliveryUnitPrice?: number,
        existingId?: string,
        stockPlannedQty?: number | null,
    ) => {
        const inventory = inventoryItems.find(inv => inv.id === item.itemId);
        return buildPoDeliveryLineDraft({
            id: existingId,
            batchId,
            purchaseOrderId,
            item,
            inventory,
            plannedQty,
            deliveryUnitPrice,
            stockPlannedQty,
        });
    };
    const buildDefaultPoDeliveryBatches = (
        items: PurchaseOrderItem[],
        plannedDate = pExpDate,
        purchaseOrderId = editingPo?.id || '',
    ): PurchaseOrderDeliveryBatch[] => {
        const batchId = crypto.randomUUID();
        const activeItems = items.map(item => normalizePoItem(item, inventoryItems)).filter(item => item.itemId && Number(item.qty || 0) > 0);
        return [{
            id: batchId,
            purchaseOrderId,
            projectId: projectId || null,
            constructionSiteId: constructionSiteId || null,
            deliveryNo: 1,
            plannedDeliveryDate: plannedDate || null,
            status: 'planned',
            fulfillmentBatchIds: [],
            note: null,
            createdBy: user?.id || null,
            lines: activeItems.map(item => makePoDeliveryLineDraft(batchId, purchaseOrderId, item, Number(item.qty || 0))),
        }];
    };
    const getPoDeliveryBatchesForForm = (
        currentBatches: PurchaseOrderDeliveryBatch[] = pDeliveryBatches,
        items: PurchaseOrderItem[] = pItems,
        plannedDate = pExpDate,
        purchaseOrderId = editingPo?.id || '',
        sourceMode: PurchaseOrderSourceMode = pSourceMode,
        isEditing = Boolean(editingPo),
        scheduleMode: PoDeliveryScheduleMode = pDeliveryScheduleMode,
    ): PurchaseOrderDeliveryBatch[] => {
        if (currentBatches.length > 0) return currentBatches;
        if (scheduleMode === 'unknown') return [];
        if (!shouldAutoCreatePoDeliveryScheduleForForm({ isEditing, sourceMode })) return [];
        return buildDefaultPoDeliveryBatches(items, plannedDate, purchaseOrderId);
    };
    const normalizePoDeliveryBatchesForSave = (
        po: PurchaseOrder,
        items: PurchaseOrderItem[],
    ): PurchaseOrderDeliveryBatch[] => {
        const sourceBatches = getPoDeliveryBatchesForForm(
            pDeliveryBatches,
            items,
            po.expectedDeliveryDate || pExpDate,
            po.id,
            po.sourceMode || pSourceMode,
            Boolean(editingPo),
            pDeliveryScheduleMode,
        );
        const activeItems = items.filter(item => item.itemId && Number(item.qty || 0) > 0);
        const normalized = sourceBatches.map((batch, index) => {
            const batchId = batch.purchaseOrderId === po.id && batch.id ? batch.id : crypto.randomUUID();
            const lines = activeItems
                .map(item => {
                    const lineKey = item.lineId || item.itemId;
                    const existing = (batch.lines || []).find(line => line.purchaseOrderLineId === lineKey);
                    const plannedQty = existing
                        ? Number(existing.plannedQty || 0)
                        : sourceBatches.length === 1
                            ? Number(item.qty || 0)
                            : 0;
                    if (plannedQty <= 0) return null;
                    return makePoDeliveryLineDraft(
                        batchId,
                        po.id,
                        item,
                        plannedQty,
                        existing?.deliveryUnitPrice,
                        existing?.purchaseOrderId === po.id ? existing.id : undefined,
                        existing?.stockPlannedQty,
                    );
                })
                .filter((line): line is NonNullable<typeof line> => Boolean(line));
            return {
                ...batch,
                id: batchId,
                purchaseOrderId: po.id,
                projectId: po.projectId || null,
                constructionSiteId: po.constructionSiteId || null,
                deliveryNo: index + 1,
                plannedDeliveryDate: batch.plannedDeliveryDate || po.expectedDeliveryDate || pExpDate || null,
                status: batch.status || 'planned',
                fulfillmentBatchIds: batch.fulfillmentBatchIds || [],
                lines,
            };
        }).filter(batch => batch.lines.length > 0);

        return normalized;
    };
    const setPoDeliveryScheduleModeWithDraft = (mode: PoDeliveryScheduleMode) => {
        setPDeliveryScheduleMode(mode);
        if (mode === 'unknown') {
            setPDeliveryBatches([]);
            return;
        }
        setPDeliveryBatches(prev => {
            if (prev.length > 0) {
                const next = mode === 'first_batch' ? prev.slice(0, 1) : prev;
                return next.map((batch, index) => ({ ...batch, deliveryNo: index + 1 }));
            }
            return buildDefaultPoDeliveryBatches(pItems, pExpDate);
        });
    };
    const resetPoDeliveryDraftFromItems = (items = pItems, plannedDate = pExpDate) => {
        setPDeliveryScheduleMode('first_batch');
        setPDeliveryBatches(buildDefaultPoDeliveryBatches(items, plannedDate));
    };
    const getPoDeliveryLinePlannedQty = (batch: PurchaseOrderDeliveryBatch, lineKey: string): number => {
        const line = batch.lines.find(row => row.purchaseOrderLineId === lineKey);
        return Number(line?.plannedQty || 0);
    };
    const getPoDeliveryRemainingQty = (
        batches: PurchaseOrderDeliveryBatch[],
        lineKey: string,
        orderedQty: number,
        throughBatchIndex = batches.length - 1,
    ): number => {
        const scheduledQty = batches.slice(0, throughBatchIndex + 1).reduce((sum, batch) => (
            sum + getPoDeliveryLinePlannedQty(batch, lineKey)
        ), 0);
        return Number(orderedQty || 0) - scheduledQty;
    };
    const addPoDeliveryBatch = () => {
        const base = getPoDeliveryBatchesForForm();
        setPDeliveryScheduleMode(base.length > 0 ? 'multiple_batches' : 'first_batch');
        const batchId = crypto.randomUUID();
        const activeItems = pItems.map(item => normalizePoItem(item, inventoryItems)).filter(item => item.itemId && Number(item.qty || 0) > 0);
        setPDeliveryBatches([
            ...base,
            {
                id: batchId,
                purchaseOrderId: editingPo?.id || '',
                projectId: projectId || null,
                constructionSiteId: constructionSiteId || null,
                deliveryNo: base.length + 1,
                plannedDeliveryDate: pExpDate || null,
                status: 'planned',
                fulfillmentBatchIds: [],
                note: null,
                createdBy: user?.id || null,
                lines: activeItems.map(item => {
                    const lineKey = item.lineId || item.itemId;
                    const remainingQty = Math.max(0, getPoDeliveryRemainingQty(base, lineKey, Number(item.qty || 0)));
                    const lineInitialValues = getPoDeliveryScheduleLineInitialValues({
                        remainingQty,
                        unitPrice: Number(item.unitPrice || 0),
                        sourceMode: pSourceMode,
                    });
                    return makePoDeliveryLineDraft(
                        batchId,
                        editingPo?.id || '',
                        item,
                        lineInitialValues.plannedQty,
                        lineInitialValues.deliveryUnitPrice,
                    );
                }),
            },
        ]);
    };
    const updatePoDeliveryBatch = (batchId: string, patch: Partial<PurchaseOrderDeliveryBatch>) => {
        setPDeliveryBatches(prev => prev.map(batch => batch.id === batchId ? { ...batch, ...patch } : batch));
    };
    const getEditablePoDeliveryBatches = (currentBatches: PurchaseOrderDeliveryBatch[], renderedBatchId: string) => {
        if (currentBatches.length > 0) return currentBatches;
        if (!shouldAutoCreatePoDeliveryScheduleForForm({ isEditing: Boolean(editingPo), sourceMode: pSourceMode })) return [];
        return buildDefaultPoDeliveryBatches(pItems, pExpDate).map((batch, index) => {
            if (index !== 0) return batch;
            return {
                ...batch,
                id: renderedBatchId,
                lines: batch.lines.map(line => ({ ...line, deliveryBatchId: renderedBatchId })),
            };
        });
    };
    const updatePoDeliveryLineQty = (batchId: string, purchaseOrderLineId: string, plannedQty: number) => {
        setPDeliveryBatches(prev => getEditablePoDeliveryBatches(prev, batchId).map(batch => {
            if (batch.id !== batchId) return batch;
            const existingLine = batch.lines.find(line => line.purchaseOrderLineId === purchaseOrderLineId);
            if (!existingLine) {
                const sourceItem = pItems.map(item => normalizePoItem(item, inventoryItems))
                    .find(item => (item.lineId || item.itemId) === purchaseOrderLineId);
                if (!sourceItem) return batch;
                return {
                    ...batch,
                    lines: [
                        ...batch.lines,
                        makePoDeliveryLineDraft(
                            batch.id,
                            editingPo?.id || '',
                            sourceItem,
                            plannedQty,
                            pSourceMode === 'from_request' ? 0 : undefined,
                        ),
                    ],
                };
            }
            return {
                ...batch,
                lines: batch.lines.map(line => {
                    if (line.purchaseOrderLineId !== purchaseOrderLineId) return line;
                    const sourceItem = pItems.map(item => normalizePoItem(item, inventoryItems))
                        .find(item => (item.lineId || item.itemId) === purchaseOrderLineId);
                    if (!sourceItem) return { ...line, plannedQty: Number(plannedQty || 0) };
                    const inventory = inventoryItems.find(item => item.id === sourceItem.itemId);
                    return {
                        ...line,
                        plannedQty: Number(plannedQty || 0),
                        stockPlannedQty: poLinePurchaseToStockQty(sourceItem, Number(plannedQty || 0), inventory),
                        stockUnit: getPoLineStockUnit(sourceItem, inventory) || line.stockUnit || null,
                    };
                }),
            };
        }));
    };
    const updatePoDeliveryLineStockQty = (batchId: string, purchaseOrderLineId: string, stockPlannedQty: number) => {
        setPDeliveryBatches(prev => getEditablePoDeliveryBatches(prev, batchId).map(batch => {
            if (batch.id !== batchId) return batch;
            const existingLine = batch.lines.find(line => line.purchaseOrderLineId === purchaseOrderLineId);
            const sourceItem = pItems.map(item => normalizePoItem(item, inventoryItems))
                .find(item => (item.lineId || item.itemId) === purchaseOrderLineId);
            if (!sourceItem) return batch;
            const inventory = inventoryItems.find(item => item.id === sourceItem.itemId);
            if (!existingLine) {
                return {
                    ...batch,
                    lines: [
                        ...batch.lines,
                        makePoDeliveryLineDraft(
                            batch.id,
                            editingPo?.id || '',
                            sourceItem,
                            0,
                            pSourceMode === 'from_request' ? 0 : undefined,
                            undefined,
                            stockPlannedQty,
                        ),
                    ],
                };
            }
            return {
                ...batch,
                lines: batch.lines.map(line => line.purchaseOrderLineId === purchaseOrderLineId
                    ? {
                        ...line,
                        stockPlannedQty: Number(stockPlannedQty || 0),
                        stockUnit: getPoLineStockUnit(sourceItem, inventory) || line.stockUnit || null,
                    }
                    : line),
            };
        }));
    };
    const updatePoDeliveryLinePrice = (batchId: string, purchaseOrderLineId: string, deliveryUnitPrice: number) => {
        setPDeliveryBatches(prev => getEditablePoDeliveryBatches(prev, batchId).map(batch => {
            if (batch.id !== batchId) return batch;
            const existingLine = batch.lines.find(line => line.purchaseOrderLineId === purchaseOrderLineId);
            if (!existingLine) {
                const sourceItem = pItems.map(item => normalizePoItem(item, inventoryItems))
                    .find(item => (item.lineId || item.itemId) === purchaseOrderLineId);
                if (!sourceItem) return batch;
                return {
                    ...batch,
                    lines: [
                        ...batch.lines,
                        makePoDeliveryLineDraft(batch.id, editingPo?.id || '', sourceItem, 0, deliveryUnitPrice),
                    ],
                };
            }
            return {
                ...batch,
                lines: batch.lines.map(line => line.purchaseOrderLineId === purchaseOrderLineId
                    ? { ...line, deliveryUnitPrice: Number(deliveryUnitPrice || 0) }
                    : line),
            };
        }));
    };
    const removePoDeliveryBatch = (batchId: string) => {
        setPDeliveryBatches(prev => {
            const next = prev.filter(batch => batch.id !== batchId);
            if (next.length > 0) {
                setPDeliveryScheduleMode(next.length > 1 ? 'multiple_batches' : 'first_batch');
                return next.map((batch, index) => ({ ...batch, deliveryNo: index + 1 }));
            }
            setPDeliveryScheduleMode('unknown');
            return [];
        });
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
        let cancelled = false;
        void (async () => {
            await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata for planning draft:', error));
            if (cancelled) return;
            const normalizedItems = initialDraftPo.items.length > 0
                ? initialDraftPo.items.map(item => normalizePoItem(item, inventoryItems))
                : [createEmptyPoItem()];
            const sourceMode = initialDraftPo.sourceMode || 'proactive_project';
            const nextPoNumber = initialDraftPo.poNumber || await loadNextPoNumber(sourceMode);
            if (cancelled) return;
            const firstVendorId = normalizedItems.find(item => item.vendorId)?.vendorId || '';
            setEditingPo(null);
            setShowPoForm(true);
            setShowRequestPicker(false);
            setRequestPickerMode('create_po');
            setSelectedRequestLineKeys([]);
            setPVendorId(firstVendorId);
            setPNum(nextPoNumber);
            setPNumAutoGenerated(!initialDraftPo.poNumber);
            setPDate(new Date().toISOString().split('T')[0]);
            setPExpDate(initialDraftPo.expectedDeliveryDate || '');
            setPTargetWarehouseId(initialDraftPo.targetWarehouseId || '');
            setPSourceMode(sourceMode);
            setPVatRate('0');
            setPItems(normalizedItems);
            setPDeliveryScheduleMode('unknown');
            setPDeliveryBatches([]);
            setPApprovalRequestTitle('');
            setPNote(initialDraftPo.note || '');
        })().catch(error => {
            console.error('Failed to allocate PO number:', error);
            toast.error('Không thể cấp số PO', getApiErrorMessage(error, 'Vui lòng thử lại.'));
        });
        return () => { cancelled = true; };
    }, [initialDraftPo, initialDraftPoKey, inventoryItems, loadNextPoNumber, loadPoBoqMetaData, toast]);

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

    const companyPoRefsByRequestLine = useMemo(() => {
        const poById = new Map(pos.map(po => [po.id, po]));
        const map = new Map<string, string[]>();
        poRequestLinks.forEach(link => {
            const po = poById.get(link.purchaseOrderId);
            if (!po || po.sourceMode !== 'company_consolidated') return;
            const key = `${link.materialRequestId}:${link.requestLineId}`;
            const refs = map.get(key) || [];
            if (!refs.includes(po.poNumber)) refs.push(po.poNumber);
            map.set(key, refs);
        });
        return map;
    }, [poRequestLinks, pos]);
    const scopedMaterialRequests = useMemo(() => {
        if (!projectId) return [];
        const byId = new Map<string, MaterialRequest>();
        projectMaterialRequests.forEach(req => byId.set(req.id, req));
        materialRequests
            .filter(req => req.requestOrigin === 'project' && req.projectId === projectId)
            .forEach(req => byId.set(req.id, req));
        return [...byId.values()].sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
    }, [materialRequests, projectId, projectMaterialRequests]);
    const reloadRequestFulfillmentSummaries = useCallback(async (requestsToLoad = scopedMaterialRequests) => {
        if (requestsToLoad.length === 0) {
            setRequestFulfillmentSummaries({});
            setRequestFulfillmentBatchCounts({});
            return {};
        }
        const fulfillment = await materialRequestFulfillmentService.listSummariesByRequests(requestsToLoad);
        setRequestFulfillmentSummaries(prev => ({ ...prev, ...fulfillment.summariesByRequestId }));
        setRequestFulfillmentBatchCounts(prev => ({ ...prev, ...fulfillment.batchCountsByRequestId }));
        return fulfillment.summariesByRequestId;
    }, [scopedMaterialRequests]);

    useEffect(() => {
        let cancelled = false;
        reloadRequestFulfillmentSummaries(scopedMaterialRequests).catch(err => {
            console.warn('Failed to load material request fulfillment summaries for PO tab:', err);
            if (!cancelled) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
            }
        });
        return () => { cancelled = true; };
    }, [reloadRequestFulfillmentSummaries, scopedMaterialRequests]);
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
                const closedNeedQty = Number(fulfillmentLine?.closedNeedQty || 0);
                const openNeedQty = Number(fulfillmentLine?.openNeedQty ?? Math.max(0, requestedQty - stockCoveredQty - closedNeedQty));
                const openOrderedQty = openOrderedQtyByRequestLine.get(`${req.id}:${requestLineId}`) || 0;
                const remainingQty = Math.max(0, openNeedQty - openOrderedQty);
                return {
                    key: `${req.id}:${requestLineId}`,
                    request: req,
                    line,
                    requestLineId,
                    requestedQty,
                    stockCoveredQty,
                    closedNeedQty,
                    openNeedQty,
                    orderedQty: openOrderedQty,
                    remainingQty,
                };
            }))
            .filter(row => row.remainingQty > 0)
            .filter(row => !row.line.isManualItem && inventoryItems.some(item => item.id === row.line.itemId));
    }, [inventoryItems, openOrderedQtyByRequestLine, requestFulfillmentBatchCounts, requestFulfillmentSummaries, scopedMaterialRequests]);
    const appendableRequestLines = useMemo(
        () => filterRequestRowsForPoCart(scopedRequestLines, pItems),
        [pItems, scopedRequestLines],
    );
    const requestPickerRows = requestPickerMode === 'append_to_po' ? appendableRequestLines : scopedRequestLines;
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
                const completedReturns = (supplierReturnsByPo[po.id] || []).filter(item => item.status === 'completed');
                (po.items || []).forEach(line => {
                    if (!line.materialBudgetItemId) return;
                    const inventory = inventoryItems.find(item => item.id === line.itemId);
                    const lineKey = line.lineId || line.itemId;
                    const returnedQty = Math.max(
                        Number(line.returnedQty || 0),
                        completedReturns.reduce((sum, returnDoc) => sum + returnDoc.lines
                            .filter(returnLine => returnLine.purchaseOrderLineId === lineKey)
                            .reduce((lineSum, returnLine) => lineSum + Number(returnLine.returnQty || 0), 0), 0),
                    );
                    const netQty = Math.max(0, Number(line.qty || 0) - returnedQty);
                    const stockQty = poLinePurchaseToStockQty(line, netQty, inventory);
                    map.set(line.materialBudgetItemId, (map.get(line.materialBudgetItemId) || 0) + stockQty);
                });
            });
        return map;
    }, [editingPo?.id, inventoryItems, pos, supplierReturnsByPo]);
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
        setPVendorId(''); setPNum(''); setPNumAutoGenerated(false); setPDate(new Date().toISOString().split('T')[0]);
        setPSourceMode('proactive_project');
        setPTargetWarehouseId(''); setPExpDate(''); setPVatRate('0'); setPItems([createEmptyPoItem()]); setPDeliveryBatches([]); setPDeliveryScheduleMode('unknown'); setPApprovalRequestTitle(''); setPNote('');
        setPendingPoSupplementalSubmission(null);
        setRequestPickerMode('create_po');
        setSelectedRequestLineKeys([]);
    };
    const openCreatePo = async () => {
        if (!ensureCanCreatePo('tạo PO')) return;
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        try {
            const nextPoNumber = await loadNextPoNumber('proactive_project');
            resetPoForm();
            setPNum(nextPoNumber);
            setPNumAutoGenerated(true);
            setPDeliveryScheduleMode('unknown');
            setPDeliveryBatches([]);
            setShowPoForm(true);
        } catch (error) {
            toast.error('Không thể cấp số PO', getApiErrorMessage(error, 'Vui lòng thử lại.'));
        }
    };

    const openRequestPicker = async () => {
        if (!ensureCanCreatePo('tạo PO từ đề xuất')) return;
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        setRequestPickerMode('create_po');
        setSelectedRequestLineKeys([]);
        setShowRequestPicker(true);
    };

    const openAppendRequestPicker = async () => {
        if (!editingPo || pSourceMode !== 'from_request') return;
        if (!ensureCanMutatePoDocument(editingPo, 'thêm đề xuất vào PO')) return;
        const loadedDeliveryGroups = await loadPoDeliveryPrintGroups(editingPo, true);
        const fulfillmentBatches = loadedDeliveryGroups.flatMap(group => group.batches);
        const blockReason = getPurchaseOrderEditBlockReason(
            editingPo,
            user,
            fulfillmentBatches,
            poDeliveryBatchesByPo[editingPo.id] || [],
            supplierReturnsByPo[editingPo.id] || [],
            effectivePoCapabilities,
        );
        if (blockReason) {
            toast.warning('Chưa thể thêm đề xuất', blockReason);
            return;
        }
        if (purchaseOrderHasStockImpact(editingPo, supplierReturnsByPo[editingPo.id] || [])) {
            toast.warning('Không thể thêm đề xuất', 'PO đã phát sinh nhập kho/hoàn kho nên cần giữ nguyên để đối soát.');
            return;
        }
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        setRequestPickerMode('append_to_po');
        setSelectedRequestLineKeys([]);
        setShowRequestPicker(true);
    };

    const openEditPo = async (po: PurchaseOrder) => {
        if (!ensureCanMutatePoDocument(po, 'sửa đơn hàng')) return;
        if (po.sourceMode === 'company_consolidated') {
            toast.info('PO công ty', 'PO gộp cần được sửa tại màn Mua hàng công ty để không mất liên kết nhiều dự án.');
            return;
        }
        const loadedDeliveryGroups = await loadPoDeliveryPrintGroups(po, true);
        const fulfillmentBatches = loadedDeliveryGroups.flatMap(group => group.batches);
        const blockReason = getPurchaseOrderEditBlockReason(
            po,
            user,
            fulfillmentBatches,
            poDeliveryBatchesByPo[po.id] || [],
            supplierReturnsByPo[po.id] || [],
            effectivePoCapabilities,
        );
        if (blockReason) {
            toast.warning('Chưa thể sửa PO', blockReason);
            return;
        }
        if (purchaseOrderHasStockImpact(po, supplierReturnsByPo[po.id] || [])) {
            toast.warning('Không thể sửa PO', 'PO đã phát sinh nhập kho/hoàn kho nên cần giữ nguyên để đối soát.');
            return;
        }
        await loadPoBoqMetaData().catch(error => console.warn('Failed to load PO BOQ metadata:', error));
        const normalizedItems = po.items.map(i => normalizePoItem({
            ...i,
            vendorId: i.vendorId || po.vendorId,
            vendorName: i.vendorName || po.vendorName,
        }, inventoryItems));
        const nextSourceMode = normalizedItems.some(item => item.requestId) ? 'from_request' : (po.sourceMode || 'proactive_project');
        const existingDeliveryBatches = poDeliveryBatchesByPo[po.id] || [];
        setEditingPo(po); setPVendorId(po.vendorId); setPNum(po.poNumber); setPNumAutoGenerated(false);
        setPTargetWarehouseId(po.targetWarehouseId || '');
        setPSourceMode(nextSourceMode);
        setPDate(po.orderDate); setPExpDate(po.expectedDeliveryDate || '');
        setPVatRate(String(normalizeVatRate(po.vatRate)));
        setPItems(normalizedItems);
        setPDeliveryScheduleMode(existingDeliveryBatches.length > 1 ? 'multiple_batches' : existingDeliveryBatches.length === 1 ? 'first_batch' : 'unknown');
        setPDeliveryBatches(existingDeliveryBatches);
        setPApprovalRequestTitle(po.approvalRequestTitle || '');
        setPNote(po.note || ''); setRequestPickerMode('create_po'); setSelectedRequestLineKeys([]); setShowPoForm(true);
    };

    const openPoFromSelectedRequests = async () => {
        if (!ensureCanCreatePo('tạo PO từ đề xuất')) return;
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
        let nextPoNumber: string;
        try {
            nextPoNumber = await loadNextPoNumber('from_request');
        } catch (error) {
            toast.error('Không thể cấp số PO', getApiErrorMessage(error, 'Vui lòng thử lại.'));
            return;
        }
        setEditingPo(null);
        setPSourceMode('from_request');
        setPNum(nextPoNumber);
        setPNumAutoGenerated(true);
        setPDate(new Date().toISOString().split('T')[0]);
        setPVatRate('0');
        const selectedTargetWarehouses = Array.from(new Set(selectedRows.map(row => row.request.siteWarehouseId).filter(Boolean)));
        const selectedRequests = Array.from(new Map(selectedRows.map(row => [row.request.id, row.request])).values());
        const selectedRequestTitles = selectedRequests
            .map(request => (request.title || request.code || '').trim())
            .filter(Boolean);
        const selectedApprovalTitle = selectedRequestTitles.length > 1
            ? `${selectedRequestTitles[0]} +${selectedRequestTitles.length - 1} đề xuất`
            : selectedRequestTitles[0] || '';
        setPTargetWarehouseId(selectedTargetWarehouses.length === 1 ? selectedTargetWarehouses[0] : '');
        setPItems(rows);
        setPDeliveryScheduleMode('unknown');
        setPDeliveryBatches([]);
        setPApprovalRequestTitle(selectedApprovalTitle);
        setPNote(`Gom từ ${new Set(selectedRows.map(row => row.request.code)).size} đề xuất công trường`);
        setShowRequestPicker(false);
        setShowPoForm(true);
    };

    const appendSelectedRequestsToEditingPo = () => {
        if (!editingPo || pSourceMode !== 'from_request') return;
        const selectedRows = appendableRequestLines.filter(row => selectedRequestLineKeys.includes(row.key));
        if (selectedRows.length === 0) {
            toast.warning('Chưa chọn dòng đề xuất', 'Vui lòng chọn ít nhất một dòng còn nhu cầu để thêm vào PO.');
            return;
        }

        const currentVendorId = pVendorId || editingPo.vendorId || pItems.find(item => item.vendorId)?.vendorId || '';
        if (!currentVendorId || !supplierById.has(currentVendorId)) {
            toast.warning('Thiếu NCC PO', 'Vui lòng chọn nhà cung cấp cho PO trước khi thêm đề xuất.');
            return;
        }

        const mismatchedRow = selectedRows.find(row => hasRequestRowDefaultSupplierMismatch(
            row,
            inventoryItems.find(item => item.id === row.line.itemId),
            currentVendorId,
        ));
        if (mismatchedRow) {
            const inventory = inventoryItems.find(item => item.id === mismatchedRow.line.itemId);
            toast.warning(
                'Khác NCC mặc định',
                `${inventory?.name || mismatchedRow.line.itemNameSnapshot || mismatchedRow.line.itemId} đang có NCC mặc định khác PO hiện tại. V1 chỉ cho thêm đề xuất cùng NCC.`,
            );
            return;
        }

        const supplierPatch = getSupplierPatch(currentVendorId);
        setPItems(prev => appendRequestRowsToPoItems({
            existingItems: prev,
            rows: selectedRows,
            inventoryItems,
            materialBudgetItems,
            workBoqItems,
            supplierPatch,
            lineIdFactory: () => crypto.randomUUID(),
        }).map(item => normalizePoItem(item, inventoryItems)));

        const selectedTargetWarehouses = Array.from(new Set(selectedRows.map(row => row.request.siteWarehouseId).filter(Boolean)));
        if (!pTargetWarehouseId && selectedTargetWarehouses.length === 1) {
            setPTargetWarehouseId(selectedTargetWarehouses[0] || '');
        }
        setSelectedRequestLineKeys([]);
        setShowRequestPicker(false);
        toast.success('Đã thêm đề xuất vào PO', `${selectedRows.length} dòng đề xuất đã được đưa vào ${editingPo.poNumber}.`);
    };

    const closeRequestLineNeed = async (row: typeof scopedRequestLines[number]) => {
        if (!ensureCanManage('xác nhận đủ nhu cầu')) return;
        if (!user?.id) {
            toast.warning('Thiếu người thao tác', 'Không xác định được tài khoản đang xác nhận đủ nhu cầu.');
            return;
        }
        const stockUnit = row.line.unitSnapshot || inventoryItems.find(item => item.id === row.line.itemId)?.unit || '';
        const closedQty = Number(row.openNeedQty || 0);
        if (closedQty <= 0) {
            toast.info('Không còn nhu cầu mở', 'Dòng vật tư này đã hết phần cần cấp tiếp.');
            return;
        }
        const reason = await reasonConfirm({
            title: 'Xác nhận đủ nhu cầu',
            targetName: `${row.request.code} • ${row.line.itemNameSnapshot || row.line.materialBudgetItemName || row.line.itemId}`,
            subtitle: `Đóng ${closedQty.toLocaleString('vi-VN')} ${stockUnit || ''} còn thiếu/còn mở`,
            warningText: 'Dòng này sẽ không còn lên danh sách cần mua/cần giao tiếp, nhưng báo cáo vẫn giữ chênh lệch so với BOQ và đề xuất.',
            reasonLabel: 'Lý do công trường xác nhận đủ',
            reasonPlaceholder: 'VD: Khối lượng thực tế thi công đã đủ, không cần cấp tiếp...',
            actionLabel: 'Xác nhận đủ',
            cancelLabel: 'Huỷ',
            intent: 'success',
        });
        if (!reason) return;

        try {
            await materialRequestFulfillmentService.closeLineNeed({
                request: row.request,
                requestLineId: row.requestLineId,
                requestLine: row.line,
                closedQty,
                actualReceivedQtySnapshot: Number(row.stockCoveredQty || 0),
                reason,
                actorUserId: user.id,
            });
            const nextSummaries = await reloadRequestFulfillmentSummaries([row.request]);
            const nextSummary = nextSummaries[row.request.id];
            if (nextSummary && Number(nextSummary.openNeedQty ?? nextSummary.remainingToReceive ?? 0) <= 0) {
                await updateRequestStatus(
                    row.request.id,
                    RequestStatus.COMPLETED,
                    `Công trường xác nhận đủ nhu cầu: ${reason}`,
                    undefined,
                    row.request.sourceWarehouseId,
                    row.request.overrideReason,
                    'FULFILLMENT_RECEIVED',
                );
            }
            setSelectedRequestLineKeys(prev => prev.filter(key => key !== row.key));
            toast.success('Đã xác nhận đủ nhu cầu', 'Dòng vật tư sẽ không còn vào danh sách cần mua/cần giao tiếp.');
        } catch (error: any) {
            logApiError('supplyChain.closeRequestLineNeed', error);
            toast.error('Không thể xác nhận đủ nhu cầu', getApiErrorMessage(error, 'Vui lòng thử lại.'));
        }
    };

    const openPoDeliveryDraft = async (po: PurchaseOrder) => {
        if (!ensureCanReceivePo('tạo đợt giao PO')) return;
        if ((poDeliveryBatchesByPo[po.id] || []).some(batch => batch.status === 'supplemental_pending')) {
            toast.warning('Đang chờ duyệt bổ sung', 'PO còn đợt mua vượt giá trị đã duyệt nên chưa thể tạo WMS/đợt giao mới.');
            return;
        }
        const links = poRequestLinks.filter(link => link.purchaseOrderId === po.id);
        if (links.length === 0) {
            void updatePoStatus(po.id, 'in_transit');
            return;
        }

        const requestIds = Array.from(new Set(links.map(link => link.materialRequestId).filter(Boolean)));
        let batchesByRequest: Awaited<ReturnType<typeof materialRequestFulfillmentService.listByRequests>> = {};
        try {
            batchesByRequest = await materialRequestFulfillmentService.listByRequests(requestIds);
        } catch (error) {
            logApiError('supplyChain.openPoDeliveryDraft.loadBatches', error);
            toast.error('Không thể tải lịch giao', getApiErrorMessage(error, 'Vui lòng thử lại sau khi hệ thống tải lại dữ liệu.'));
            return;
        }

        const allocatedQtyByLinkId = new Map<string, number>();
        const allocatedQtyByLinkKey = new Map<string, number>();
        Object.values(batchesByRequest).flat().forEach(batch => {
            if (batch.status === 'cancelled' || batch.status === 'returned') return;
            batch.lines.forEach(line => {
                if (line.poId !== po.id) return;
                const allocatedQty = batch.status === 'issued'
                    ? Number(line.issuedQty || 0)
                    : Number(line.receivedQty || 0);
                if (allocatedQty <= 0) return;
                if (line.purchaseOrderRequestLineId) {
                    allocatedQtyByLinkId.set(
                        line.purchaseOrderRequestLineId,
                        (allocatedQtyByLinkId.get(line.purchaseOrderRequestLineId) || 0) + allocatedQty,
                    );
                }
                const linkKey = `${line.materialRequestId}:${line.requestLineId}:${line.poLineId || ''}`;
                allocatedQtyByLinkKey.set(linkKey, (allocatedQtyByLinkKey.get(linkKey) || 0) + allocatedQty);
            });
        });

        const rows = links.map(link => {
            const poItem = po.items.find(item => (item.lineId || item.itemId) === link.purchaseOrderLineId);
            if (!poItem) return null;
            const inventory = inventoryItems.find(item => item.id === (poItem.itemId || link.itemId));
            const fullPoStockQty = poLinePurchaseToStockQty(poItem, Number(poItem.qty || 0), inventory);
            const linkedStockQty = Number(link.orderedStockQtySnapshot || link.orderedQty || fullPoStockQty || 0);
            const linkKey = `${link.materialRequestId}:${link.requestLineId}:${link.purchaseOrderLineId}`;
            const allocatedQty = link.id
                ? (allocatedQtyByLinkId.get(link.id) ?? allocatedQtyByLinkKey.get(linkKey) ?? 0)
                : (allocatedQtyByLinkKey.get(linkKey) || 0);
            const remainingQty = Math.max(0, linkedStockQty - allocatedQty);
            if (remainingQty <= 0) return null;
            const request = scopedMaterialRequests.find(item => item.id === link.materialRequestId);
            const siteName = request?.constructionSiteId ? constructionSiteById.get(request.constructionSiteId)?.name || request.constructionSiteId : '';
            const unit = getPoLineStockUnit(poItem, inventory) || link.unit || inventory?.unit || '';
            const draftInitialValues = getPoDeliveryDraftInitialLineValues({
                remainingQty,
                unitPrice: getPoLineStockUnitPrice(poItem, inventory) || 0,
                sourceMode: po.sourceMode || 'from_request',
            });
            return {
                key: `${link.materialRequestId}:${link.requestLineId}:${link.purchaseOrderLineId}`,
                purchaseOrderLineId: link.purchaseOrderLineId,
                materialRequestId: link.materialRequestId,
                requestLineId: link.requestLineId,
                itemName: poItem.name || inventory?.name || link.itemId,
                requestCode: link.materialRequestCode,
                siteName,
                unit,
                remainingQty,
                allocatedQty,
                issuedQty: draftInitialValues.issuedQty,
                deliveryUnitPrice: draftInitialValues.deliveryUnitPrice,
            } as PoDeliveryDraftLine;
        }).filter(Boolean) as PoDeliveryDraftLine[];
        if (rows.length === 0) {
            toast.info('Không còn số lượng giao', 'Các dòng PO đã được lập đợt giao/ghi nhận đủ theo số lượng tham khảo hiện tại.');
            return;
        }
        setDeliveryDraftPo(po);
        setDeliveryDraftLines(rows);
    };

    const updateDeliveryDraftLine = (key: string, patch: Partial<PoDeliveryDraftLine>) => {
        setDeliveryDraftLines(prev => prev.map(line => line.key === key ? { ...line, ...patch } : line));
    };

    const submitPoDeliveryDraft = async () => {
        if (!deliveryDraftPo || savingDeliveryDraft) return;
        if (!ensureCanReceivePo('tạo đợt giao PO')) return;
        if (!user?.id) {
            toast.warning('Thiếu người thao tác', 'Không xác định được tài khoản tạo đợt giao.');
            return;
        }
        const validLines = deliveryDraftLines
            .map(line => ({
                ...line,
                issuedQtyNumber: Number(line.issuedQty || 0),
                deliveryUnitPriceNumber: Number(line.deliveryUnitPrice || 0),
            }))
            .filter(line => line.issuedQtyNumber > 0);
        if (validLines.length === 0) {
            toast.warning('Chưa có số lượng giao', 'Vui lòng nhập ít nhất một dòng có SL đợt này lớn hơn 0.');
            return;
        }
        setSavingDeliveryDraft(true);
        try {
            const statusPatch = {
                status: 'in_transit' as POStatus,
                ...projectSubmissionService.actionMeta(user.id, true),
            };
            await poService.updateStatus(deliveryDraftPo.id, statusPatch);
            const deliveryPo = { ...deliveryDraftPo, ...statusPatch, status: 'in_transit' as POStatus };
            const affectedRequestIds = await materialRequestFulfillmentService.ensurePoDeliveryBatches({
                po: deliveryPo,
                actorUserId: user.id,
                lineOverrides: validLines.map(line => ({
                    purchaseOrderLineId: line.purchaseOrderLineId,
                    materialRequestId: line.materialRequestId,
                    requestLineId: line.requestLineId,
                    issuedQty: line.issuedQtyNumber,
                    deliveryUnitPrice: line.deliveryUnitPriceNumber,
                })),
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
                        `PO ${deliveryDraftPo.poNumber} tạo đợt giao, chờ thủ kho kiểm tra SL/CL`,
                        undefined,
                        request.sourceWarehouseId,
                        request.overrideReason,
                        'FULFILLMENT_ISSUED',
                    );
                }
            }
            await loadSupplyData();
            poDeliveryPrintAutoLoadRef.current.delete(deliveryDraftPo.id);
            await loadPoDeliveryPrintGroups(deliveryPo, true);
            setDeliveryDraftPo(null);
            setDeliveryDraftLines([]);
            toast.success('Đã tạo đợt giao', 'Đợt giao đã được tách theo công trường/kho nhận và chờ xác nhận thực nhận.');
        } catch (error: any) {
            logApiError('supplyChain.submitPoDeliveryDraft', error);
            toast.error('Không thể tạo đợt giao', getApiErrorMessage(error, 'Vui lòng kiểm tra lại số lượng/kho nhận.'));
        } finally {
            setSavingDeliveryDraft(false);
        }
    };

    const getApprovedTotalAmountForPoSave = (sourcePo: PurchaseOrder | null, nextTotalAmount: number) => {
        if (!sourcePo || sourcePo.status === 'draft') return nextTotalAmount;
        return Number(sourcePo.approvedTotalAmount ?? sourcePo.totalAmount ?? nextTotalAmount);
    };

    const preparePoDeliveryScheduleForSave = (
        po: PurchaseOrder,
        groupItems: PurchaseOrderItem[],
    ): { batches: PurchaseOrderDeliveryBatch[]; supplementalRequests: PurchaseOrderSupplementalDraft[] } => {
        const normalizedBatches = normalizePoDeliveryBatchesForSave(po, groupItems);
        const quantityBlockReason = getPurchaseOrderScheduleQuantityBlockReason(po, normalizedBatches);
        if (quantityBlockReason) {
            throw new Error(quantityBlockReason);
        }
        return applyPurchaseOrderSupplementalState(po, normalizedBatches);
    };

    const getPendingSupplementalApprovalForPo = (
        poId: string,
        deliveryBatches: PurchaseOrderDeliveryBatch[] = poDeliveryBatchesByPo[poId] || [],
    ) => {
        const pendingBatchIds = new Set(
            deliveryBatches
                .filter(batch => batch.status === 'supplemental_pending')
                .map(batch => batch.id),
        );
        return (poSupplementalApprovalsByPo[poId] || [])
            .find(item => item.status === 'pending' && pendingBatchIds.has(item.deliveryBatchId)) || null;
    };

    const handleSavePo = async (supplementalSubmissionTarget?: ProjectSubmissionTarget | null) => {
        if (!ensureCanCreatePo('lưu đơn hàng')) return;
        if (poSubmitLockRef.current) return;
        let finalPoNumber = pNum.trim();
        const hasRequestLineTargets = pSourceMode === 'from_request' && pItems.some(item => {
            const sourceRequest = scopedMaterialRequests.find(req => req.id === item.requestId);
            return !!sourceRequest?.siteWarehouseId;
        });
        if (!finalPoNumber || (!pTargetWarehouseId && !hasRequestLineTargets)) {
            toast.warning('Thiếu thông tin PO', 'Vui lòng nhập số PO/nhóm mua hàng và kho nhận mặc định.');
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
        const totalAmount = validItems.reduce((s, i) => s + calculateLineTotal(i), 0);
        const vatRate = normalizeVatRate(pVatRate);
        const approvalRequestTitle = pApprovalRequestTitle.trim();
        const linkedRequestSiteIds = new Set(validItems
            .map(item => scopedMaterialRequests.find(req => req.id === item.requestId)?.constructionSiteId || null)
            .filter(Boolean) as string[]);
        const scopedProjectId = pSourceMode === 'proactive_stock' ? null : projectId || constructionSiteId || null;
        const scopedSiteId = pSourceMode === 'proactive_stock'
            ? null
            : pSourceMode === 'from_request'
                ? (linkedRequestSiteIds.size === 1 ? [...linkedRequestSiteIds][0] : null)
                : constructionSiteId || null;
        if (!editingPo && pNumAutoGenerated) {
            finalPoNumber = await loadNextPoNumber(pSourceMode);
            setPNum(finalPoNumber);
        }
        const groups = validItems.reduce<Map<string, PurchaseOrderItem[]>>((map, item) => {
            const key = item.vendorId!;
            map.set(key, [...(map.get(key) || []), item]);
            return map;
        }, new Map());
        const groupEntries = Array.from(groups.entries());
        const buildLinks = (po: PurchaseOrder, items: PurchaseOrderItem[]): PurchaseOrderRequestLineLink[] =>
            buildPurchaseOrderRequestLineLinks({
                po,
                items,
                requests: scopedMaterialRequests,
                inventoryItems,
                projectId,
                scopedSiteId,
                targetWarehouseId: pTargetWarehouseId,
                summariesByRequestId: requestFulfillmentSummaries,
            });

        if (editingPo && groupEntries.length > 1) {
            toast.warning('PO đang sửa chỉ được có một NCC', 'Nếu cần tách nhiều NCC, hãy tạo nhóm mua hàng mới từ form tạo PO.');
            return;
        }
        let supplementalPreviewRequests: PurchaseOrderSupplementalDraft[] = [];
        try {
            groupEntries.forEach(([vendorId, items]) => {
                const vendor = supplierById.get(vendorId)!;
                const groupItems = items.map(item => ({ ...item, vendorId, vendorName: vendor.name }));
                const groupTotalAmount = groupItems.reduce((s, item) => s + calculateLineTotal(item), 0);
                const previewPo = {
                    ...(editingPo || {
                        id: '__validate__',
                        projectId: scopedProjectId,
                        constructionSiteId: scopedSiteId,
                        vendorId,
                        vendorName: vendor.name,
                        poNumber: finalPoNumber,
                        items: groupItems,
                        totalAmount: groupTotalAmount,
                        orderDate: pDate,
                        status: 'draft',
                        createdById: user?.id || null,
                        createdAt: new Date().toISOString(),
                    } as PurchaseOrder),
                    vendorId,
                    vendorName: vendor.name,
                    items: groupItems,
                    totalAmount: groupTotalAmount,
                    approvedTotalAmount: getApprovedTotalAmountForPoSave(editingPo, groupTotalAmount),
                    expectedDeliveryDate: pExpDate || undefined,
                } as PurchaseOrder;
                const { supplementalRequests } = preparePoDeliveryScheduleForSave(previewPo, groupItems);
                supplementalPreviewRequests = [...supplementalPreviewRequests, ...supplementalRequests];
            });
        } catch (error: any) {
            toast.warning('Lịch giao chưa hợp lệ', error?.message || 'Vui lòng kiểm tra tổng số lượng các đợt giao.');
            return;
        }
        if (supplementalPreviewRequests.length > 0 && !supplementalSubmissionTarget) {
            const previousApprovedAmount = Math.max(...supplementalPreviewRequests.map(request => Number(request.previousApprovedAmount || 0)));
            const requestedTotalAmount = Math.max(...supplementalPreviewRequests.map(request => Number(request.requestedTotalAmount || 0)));
            setPendingPoSupplementalSubmission({
                totalOverAmount: Math.max(0, requestedTotalAmount - previousApprovedAmount),
                previousApprovedAmount,
                requestedTotalAmount,
                supplementalRequestCount: supplementalPreviewRequests.length,
            });
            return;
        }

        try {
            if (!editingPo) {
                const ok = await confirm({
                    title: groupEntries.length > 1 ? 'Xác nhận tách PO theo NCC' : 'Xác nhận tạo PO',
                    targetName: finalPoNumber,
                    confirmText: groupEntries.length > 1 ? 'Bạn có chắc chắn muốn tạo các PO theo từng NCC' : 'Bạn có chắc chắn muốn tạo đơn hàng PO',
                    subtitle: `${validItems.length} dòng vật tư • ${groupEntries.length} NCC • Tổng ${fmtMoney(totalAmount)} đ`,
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
            const normalizedSupplementalTarget = supplementalSubmissionTarget
                ? {
                    ...supplementalSubmissionTarget,
                    permissionCode: supplementalSubmissionTarget.permissionCode || 'project.material_po.approve',
                }
                : null;

            if (editingPo) {
                const [vendorId, items] = groupEntries[0];
                const vendor = supplierById.get(vendorId)!;
                const groupItems = items.map(item => ({ ...item, vendorId, vendorName: vendor.name }));
                const groupTotalAmount = groupItems.reduce((s, i) => s + calculateLineTotal(i), 0);
                const poItem: PurchaseOrder = {
                    ...editingPo,
                    vendorId,
                    vendorName: vendor.name,
                    poNumber: finalPoNumber,
                    items: groupItems,
                    totalAmount: groupTotalAmount,
                    approvedTotalAmount: getApprovedTotalAmountForPoSave(editingPo, groupTotalAmount),
                    supplementalApprovalStatus: 'none',
                    vatRate,
                    orderDate: pDate,
                    expectedDeliveryDate: pExpDate || undefined,
                    targetWarehouseId: pTargetWarehouseId || undefined,
                    qrToken: editingPo.qrToken || createPoQrToken(),
                    sourceMode: pSourceMode,
                    approvalRequestTitle: approvalRequestTitle || null,
                    projectId: scopedProjectId,
                    constructionSiteId: scopedSiteId,
                    procurementGroupId: editingPo.procurementGroupId || null,
                    procurementGroupNo: editingPo.procurementGroupNo || null,
                    note: pNote || undefined,
                };
                const { batches, supplementalRequests } = preparePoDeliveryScheduleForSave(poItem, groupItems);
                const poItemForSave = { ...poItem, supplementalApprovalStatus: supplementalRequests.length > 0 ? 'pending' as const : 'none' as const };
                await poService.upsert(poItemForSave);
                await poService.replaceRequestLineLinks(poItemForSave.id, buildLinks(poItemForSave, groupItems));
                await poDeliveryScheduleService.replaceForPurchaseOrder(poItemForSave, batches);
                await poSupplementalApprovalService.syncPendingForPurchaseOrder(
                    poItemForSave,
                    supplementalRequests,
                    normalizedSupplementalTarget,
                    user?.id || null,
                );
                if (supplementalRequests.length > 0 && normalizedSupplementalTarget) {
                    await projectSubmissionService.notifyTarget({
                        target: normalizedSupplementalTarget,
                        actorId: user?.id,
                        category: 'material',
                        title: `PO ${poItemForSave.poNumber} chờ duyệt bổ sung`,
                        message: `Đợt mua của ${poItemForSave.poNumber} vượt giá trị đã duyệt ${fmtMoney(Math.max(...supplementalRequests.map(item => item.overAmount)))} đ.`,
                        sourceType: 'purchase_order_supplemental_approval',
                        sourceId: poItemForSave.id,
                        constructionSiteId: poItemForSave.constructionSiteId || constructionSiteId,
                        link: '/da',
                        metadata: {
                            projectId: poItemForSave.projectId || projectId,
                            purchaseOrderId: poItemForSave.id,
                            poNumber: poItemForSave.poNumber,
                            vendorId: poItemForSave.vendorId,
                            vendorName: poItemForSave.vendorName,
                        },
                    }).catch(error => console.warn('Cannot notify PO supplemental approval recipient', error));
                }
            } else {
                const procurementGroupId = crypto.randomUUID();
                const procurementGroupNo = finalPoNumber;
                for (const [index, [vendorId, items]] of groupEntries.entries()) {
                    const vendor = supplierById.get(vendorId)!;
                    const groupItems = items.map(item => ({ ...item, vendorId, vendorName: vendor.name }));
                    const groupTotalAmount = groupItems.reduce((s, i) => s + calculateLineTotal(i), 0);
                    const poItem: PurchaseOrder = {
                        id: crypto.randomUUID(),
                        projectId: scopedProjectId,
                        constructionSiteId: scopedSiteId,
                        vendorId,
                        vendorName: vendor.name,
                        poNumber: groupEntries.length === 1 ? finalPoNumber : `${finalPoNumber}-${String(index + 1).padStart(2, '0')}`,
                        procurementGroupId,
                        procurementGroupNo,
                        items: groupItems,
                        totalAmount: groupTotalAmount,
                        approvedTotalAmount: groupTotalAmount,
                        supplementalApprovalStatus: 'none',
                        vatRate,
                        orderDate: pDate,
                        expectedDeliveryDate: pExpDate || undefined,
                        status: 'draft',
                        sourceMode: pSourceMode,
                        approvalRequestTitle: approvalRequestTitle || null,
                        targetWarehouseId: pTargetWarehouseId || undefined,
                        qrToken: createPoQrToken(),
                        receivedTransactionIds: [],
                        note: pNote || undefined,
                        createdById: user?.id || null,
                        createdAt: new Date().toISOString(),
                    };
                    const { batches, supplementalRequests } = preparePoDeliveryScheduleForSave(poItem, groupItems);
                    const poItemForSave = { ...poItem, supplementalApprovalStatus: supplementalRequests.length > 0 ? 'pending' as const : 'none' as const };
                    await poService.upsert(poItemForSave);
                    await poService.replaceRequestLineLinks(poItemForSave.id, buildLinks(poItemForSave, groupItems));
                    await poDeliveryScheduleService.replaceForPurchaseOrder(poItemForSave, batches);
                    await poSupplementalApprovalService.syncPendingForPurchaseOrder(
                        poItemForSave,
                        supplementalRequests,
                        normalizedSupplementalTarget,
                        user?.id || null,
                    );
                    if (supplementalRequests.length > 0 && normalizedSupplementalTarget) {
                        await projectSubmissionService.notifyTarget({
                            target: normalizedSupplementalTarget,
                            actorId: user?.id,
                            category: 'material',
                            title: `PO ${poItemForSave.poNumber} chờ duyệt bổ sung`,
                            message: `Đợt mua của ${poItemForSave.poNumber} vượt giá trị đã duyệt ${fmtMoney(Math.max(...supplementalRequests.map(item => item.overAmount)))} đ.`,
                            sourceType: 'purchase_order_supplemental_approval',
                            sourceId: poItemForSave.id,
                            constructionSiteId: poItemForSave.constructionSiteId || constructionSiteId,
                            link: '/da',
                            metadata: {
                                projectId: poItemForSave.projectId || projectId,
                                purchaseOrderId: poItemForSave.id,
                                poNumber: poItemForSave.poNumber,
                                vendorId: poItemForSave.vendorId,
                                vendorName: poItemForSave.vendorName,
                            },
                        }).catch(error => console.warn('Cannot notify PO supplemental approval recipient', error));
                    }
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
        if (status === 'returned') {
            if (!ensureCanReturnSupplierPo('trả hàng/hoàn hàng PO')) return;
        } else if (status === 'cancelled') {
            if (!ensureCanRunRestrictedPoAction('huỷ PO')) return;
        } else if (['sent', 'confirmed', 'draft'].includes(status)) {
            if (!ensureCanApprovePo('cập nhật trạng thái duyệt PO')) return;
        } else if (['in_transit', 'partial', 'delivered', 'closed'].includes(status)) {
            if (!ensureCanReceivePo('cập nhật trạng thái giao nhận PO')) return;
        } else if (!ensureCanCreatePo('cập nhật trạng thái PO')) {
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
            const receivedQty = po.items.reduce((sum, item) => sum + (Number(item.receivedQty) || 0), 0);
            if (['partial', 'delivered', 'closed'].includes(po.status) || receivedQty > 0) {
                setSupplierReturnPo(po);
                toast.info('Tạo phiếu trả NCC', 'PO đã phát sinh nhập kho nên hoàn trả sẽ đi qua phiếu SR và WMS duyệt xuất kho.');
                return;
            }
            toast.warning('Chưa thể hoàn NCC', 'PO chưa phát sinh nhập kho nên không ghi nhận Hoàn NCC. Hãy huỷ PO hoặc xoá các đợt giao bị từ chối trước nhập.');
            return;
        }
        const receiptStats = getPurchaseOrderDemandStats(po, poRequestLinks, inventoryItems);
        let partialCloseReason = '';
        if (status === 'delivered' && po.status === 'partial') {
            if (receiptStats.receivedQty <= 0) {
                toast.warning('Chưa có hàng đã nhận', 'PO chưa phát sinh số lượng nhận nên không thể kết thúc thiếu.');
                return;
            }
            if (receiptStats.remainingQty > 0) {
                const reason = await reasonConfirm({
                    targetName: po.poNumber,
                    title: 'Xác nhận kết thúc đơn hàng',
                    actionLabel: 'Kết thúc đơn hàng',
                    cancelLabel: 'Kiểm tra lại',
                    reasonLabel: 'Lý do kết thúc thiếu PO',
                    reasonPlaceholder: 'VD: NCC chỉ giao từng phần, phần còn lại sẽ xử lý bằng PO khác...',
                    warningText: `PO đã nhận ${receiptStats.receivedQty.toLocaleString('vi-VN')}/${receiptStats.orderedQty.toLocaleString('vi-VN')}. Phần thiếu ${receiptStats.remainingQty.toLocaleString('vi-VN')} sẽ không còn chờ nhận từ PO này; nếu công trường vẫn cần, hãy tạo PO lần tiếp theo từ đề xuất.`,
                    intent: 'warning',
                    countdownSeconds: 0,
                });
                if (!reason) return;
                partialCloseReason = reason;
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
            ...projectSubmissionService.actionMeta(user?.id, !['draft', 'cancelled'].includes(status)),
            actualDeliveryDate: status === 'delivered' ? new Date().toISOString().split('T')[0] : po.actualDeliveryDate,
            deliveryNote: status === 'delivered' && po.status === 'partial'
                ? [
                    po.deliveryNote,
                    `Kết thúc PO sau khi nhận ${receiptStats.receivedQty.toLocaleString('vi-VN')}/${receiptStats.orderedQty.toLocaleString('vi-VN')}; phần thiếu không còn chờ nhận từ PO này.${partialCloseReason ? ` Lý do: ${partialCloseReason}` : ''}`,
                ].filter(Boolean).join(' | ')
                : po.deliveryNote,
        };
        try {
            await poService.updateStatus(id, updated);
            if (status === 'in_transit') {
                const scheduleBatches = poDeliveryBatchesByPo[po.id] || [];
                const deliveryPo = { ...po, ...updated, status } as PurchaseOrder;
                const affectedRequestIds = scheduleBatches.length > 0
                    ? []
                    : await materialRequestFulfillmentService.ensurePoDeliveryBatches({
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
                        totalAmount: getPurchaseOrderDisplayAmount(po, poDeliveryBatchesByPo[po.id] || []),
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

    const handleCreatePoDeliveryReceipt = async (po: PurchaseOrder, deliveryBatch: PurchaseOrderDeliveryBatch) => {
        if (!ensureCanReceivePo('tạo phiếu nhận WMS/QR cho đợt giao')) return;
        if (!['confirmed', 'in_transit'].includes(po.status)) {
            toast.warning('Chưa thể tạo WMS', 'Chỉ tạo phiếu nhận theo đợt khi PO đã được duyệt hoặc đang giao.');
            return;
        }
        if (deliveryBatch.status === 'supplemental_pending') {
            toast.warning('Đang chờ duyệt bổ sung', 'Đợt mua vượt giá trị PO tổng đã duyệt nên chưa thể tạo WMS/QR.');
            return;
        }
        setCreatingDeliveryBatchId(deliveryBatch.id);
        try {
            const affectedRequestIds = await materialRequestFulfillmentService.createPoDeliveryReceiptBatch({
                po,
                deliveryBatch,
                actorUserId: user.id,
            });
            if (po.status === 'confirmed') {
                await poService.updateStatus(po.id, {
                    status: 'in_transit',
                    ...projectSubmissionService.actionMeta(user?.id, true),
                });
            }
            for (const requestId of affectedRequestIds) {
                const request = scopedMaterialRequests.find(item => item.id === requestId);
                if (!request) continue;
                const batches = await materialRequestFulfillmentService.listByRequest(requestId);
                const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, batches);
                if (nextStatus !== request.status || request.workflowStep !== 'site_quality_check') {
                    await updateRequestStatus(
                        request.id,
                        nextStatus,
                        `PO ${po.poNumber} đợt ${deliveryBatch.deliveryNo} đang giao, tạo phiếu chờ thủ kho kiểm tra SL/CL`,
                        undefined,
                        request.sourceWarehouseId,
                        request.overrideReason,
                        'FULFILLMENT_ISSUED',
                    );
                }
            }
            await loadSupplyData();
            const schedules = await poDeliveryScheduleService.listByPurchaseOrderIds([po.id]);
            const scheduleBatches = schedules[po.id] || [];
            setPoDeliveryBatchesByPo(prev => ({ ...prev, [po.id]: scheduleBatches }));
            await loadPoDeliveryPrintGroups({ ...po, status: 'in_transit' }, true, scheduleBatches);
            toast.success('Đã tạo phiếu nhận WMS/QR', `Đợt ${deliveryBatch.deliveryNo} của ${po.poNumber} đã chuyển sang chờ thủ kho kiểm tra.`);
        } catch (e: any) {
            logApiError('supplyChain.createPoDeliveryReceipt', e);
            toast.error('Không thể tạo phiếu nhận theo đợt', getApiErrorMessage(e, 'Không thể tạo WMS cho đợt giao này.'));
        } finally {
            setCreatingDeliveryBatchId(null);
        }
    };

    const handleRemovePlannedDeliveryBatch = async (po: PurchaseOrder, deliveryBatch: PurchaseOrderDeliveryBatch) => {
        if (!ensureCanMutatePoDocument(po, 'xoá đợt giao kế hoạch')) return;
        if (!['planned', 'supplemental_pending'].includes(deliveryBatch.status)) {
            toast.warning('Không thể xoá trực tiếp', 'Đợt giao đã tạo WMS/QR hoặc đã xử lý kho. Vui lòng xử lý phiếu WMS trước.');
            return;
        }
        const ok = await confirm({
            targetName: `${po.poNumber} - Đợt ${deliveryBatch.deliveryNo}`,
            title: 'Xoá đợt giao kế hoạch',
            confirmText: 'Xoá đợt giao',
            warningText: 'Chỉ xoá lịch giao chưa tạo WMS/QR. PO và các dòng vật tư trong đơn hàng vẫn được giữ nguyên.',
            intent: 'danger',
            countdownSeconds: 1,
        });
        if (!ok) return;

        setDeletingDeliveryKey(`batch:${deliveryBatch.id}`);
        try {
            const currentBatches = poDeliveryBatchesByPo[po.id] || [];
            const remainingBatches = currentBatches.filter(batch => batch.id !== deliveryBatch.id);
            const canRewriteSchedule = currentBatches.every(batch => ['planned', 'supplemental_pending', 'cancelled'].includes(batch.status));
            if (canRewriteSchedule) {
                await poDeliveryScheduleService.replaceForPurchaseOrder(po, remainingBatches);
            } else {
                await poDeliveryScheduleService.removePlannedBatch(deliveryBatch.id);
            }
            const schedules = await poDeliveryScheduleService.listByPurchaseOrderIds([po.id]);
            const scheduleBatches = schedules[po.id] || [];
            setPoDeliveryBatchesByPo(prev => ({ ...prev, [po.id]: scheduleBatches }));
            await loadPoDeliveryPrintGroups(po, true, scheduleBatches);
            toast.success('Đã xoá đợt giao kế hoạch');
        } catch (error: any) {
            logApiError('supplyChain.removePlannedDeliveryBatch', error);
            toast.error('Không xoá được đợt giao', getApiErrorMessage(error, 'Vui lòng kiểm tra trạng thái đợt giao.'));
        } finally {
            setDeletingDeliveryKey(null);
        }
    };

    const handleRemoveFailedDeliveryBatch = async (po: PurchaseOrder, deliveryBatch: PurchaseOrderDeliveryBatch) => {
        if (!ensureCanDeletePo('xoá đợt giao thất bại')) return;
        const ok = await confirm({
            targetName: `${po.poNumber} - Đợt ${deliveryBatch.deliveryNo}`,
            title: 'Xoá đợt giao bị từ chối',
            confirmText: 'Xoá đợt giao',
            warningText: 'Chỉ xoá được khi đợt giao chưa nhập kho, không có ledger kho và các phiếu SL/CL liên quan đã bị từ chối/huỷ.',
            intent: 'danger',
            countdownSeconds: 2,
        });
        if (!ok) return;

        setDeletingDeliveryKey(`batch:${deliveryBatch.id}`);
        try {
            await poDeliveryScheduleService.removeFailedBatch(deliveryBatch.id);
            const schedules = await poDeliveryScheduleService.listByPurchaseOrderIds([po.id]);
            const scheduleBatches = schedules[po.id] || [];
            setPoDeliveryBatchesByPo(prev => ({ ...prev, [po.id]: scheduleBatches }));
            await loadPoDeliveryPrintGroups(po, true, scheduleBatches);
            toast.success('Đã xoá đợt giao bị từ chối');
        } catch (error: any) {
            logApiError('supplyChain.removeFailedDeliveryBatch', error);
            toast.error('Không xoá được đợt giao', getApiErrorMessage(error));
        } finally {
            setDeletingDeliveryKey(null);
        }
    };

    const handleRemoveFailedDeliveryGroup = async (po: PurchaseOrder, group: PoDeliveryPrintGroup) => {
        if (!ensureCanDeletePo('xoá đợt giao thất bại')) return;
        const ok = await confirm({
            targetName: `${po.poNumber} - ${group.label}`,
            title: 'Xoá đợt giao bị từ chối',
            confirmText: 'Xoá đợt giao',
            warningText: 'Chỉ xoá được khi đợt giao chưa nhập kho, không có ledger kho và các phiếu SL/CL liên quan đã bị từ chối/huỷ.',
            intent: 'danger',
            countdownSeconds: 2,
        });
        if (!ok) return;

        setDeletingDeliveryKey(`group:${group.key}`);
        try {
            await materialRequestFulfillmentService.removeFailedPoDeliveryGroup(group.key);
            await loadPoDeliveryPrintGroups(po, true);
            toast.success('Đã xoá đợt giao bị từ chối');
        } catch (error: any) {
            logApiError('supplyChain.removeFailedDeliveryGroup', error);
            toast.error('Không xoá được đợt giao', getApiErrorMessage(error));
        } finally {
            setDeletingDeliveryKey(null);
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
        if (!ensureCanRemovePoDocument(po, 'xoá/lưu trữ đơn hàng')) return;
        const loadedDeliveryGroups = await loadPoDeliveryPrintGroups(po, true);
        const fulfillmentBatches = loadedDeliveryGroups.flatMap(group => group.batches);
        const blockReason = getPurchaseOrderRemovalBlockReason(
            po,
            user,
            fulfillmentBatches,
            poDeliveryBatchesByPo[po.id] || [],
            supplierReturnsByPo[po.id] || [],
            effectivePoCapabilities,
        );
        if (blockReason) {
            toast.warning('Chưa thể xoá/lưu trữ PO', blockReason);
            return;
        }
        const hasStockImpact = hasPoStockImpactHint(po, supplierReturnsByPo[po.id] || []);
        const ok = await confirm({
            targetName: po.poNumber,
            title: hasStockImpact ? 'Lưu trữ đơn hàng' : 'Xoá đơn hàng',
            warningText: hasStockImpact
                ? 'PO đã có dấu hiệu phát sinh kho nên sẽ được ẩn khỏi danh sách, nhưng giao dịch kho và phiếu trả NCC vẫn được giữ để đối soát.'
                : 'PO chưa có dấu hiệu phát sinh kho nên sẽ được xoá khỏi bảng Đơn đặt hàng. Các liên kết đặt hàng từ yêu cầu vật tư sẽ được dọn để có thể tạo PO lại khi cần.',
            confirmText: hasStockImpact ? 'Lưu trữ' : 'Xoá PO',
            intent: hasStockImpact ? 'warning' : 'danger',
            countdownSeconds: hasStockImpact ? 1 : 2,
        });
        if (!ok) return;
        try {
            const result = await poService.remove(po.id);
            await loadSupplyData();
            toast.success(result.action === 'deleted' ? 'Đã xoá PO' : 'Đã lưu trữ PO');
        } catch (e: any) {
            toast.error('Lỗi xoá/lưu trữ PO', e?.message);
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
        if (!ensureCanCreatePo('import PO')) return;
        poImportModeRef.current = mode;
        setPoImportMode(mode);
    };

    const handleImportPoExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!ensureCanCreatePo('import PO')) {
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
        if (!ensureCanCreatePo('áp dụng import PO')) return;
        if (!poImportPreview) return;
        const records = applyImportChanges(poImportPreview).map(item => normalizePoItem(item, inventoryItems));
        if (records.length === 0) {
            toast.warning('Không có dữ liệu cần ghi', 'File không có dòng PO hợp lệ để nạp.');
            return;
        }
        if (poImportPreview.mode === 'create') {
            setPItems(records);
            setPDeliveryScheduleMode('unknown');
            setPDeliveryBatches([]);
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
        return `Hưng Yên, ngày ${safeDate.getDate()} Tháng ${safeDate.getMonth() + 1} Năm ${safeDate.getFullYear()}`;
    };

    const getUserPositionLabel = () => {
        if (user.role === 'ADMIN') return 'Quản trị hệ thống';
        if (user.role === 'WAREHOUSE_KEEPER') return 'Thủ kho / Phòng vật tư';
        return 'Nhân viên';
    };

    const buildPoApprovalSubject = (po: PurchaseOrder) => {
        const customTitle = po.approvalRequestTitle?.trim();
        if (customTitle) return customTitle;
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

    const buildPoApprovalDeliveryBatches = (groups: PoDeliveryPrintGroup[]): PoApprovalDeliveryBatch[] =>
        groups.map((group, index) => ({
            deliveryNo: group.label || index + 1,
            plannedDeliveryDate: group.plannedDate || null,
            lines: group.lines.map(line => ({
                purchaseOrderLineId: line.poLineId || line.itemId,
                plannedQty: Number(line.issuedQty || 0),
                unitPrice: Number(line.deliveryUnitPrice || 0),
            })).filter(line => line.purchaseOrderLineId && line.plannedQty > 0),
        })).filter(batch => batch.lines.length > 0);

    const buildPrintablePoApprovalDeliveryBatch = (
        printablePo: PurchaseOrder,
        group?: Pick<PoDeliveryPrintGroup, 'label' | 'plannedDate'>,
    ): PoApprovalDeliveryBatch[] => [{
        deliveryNo: group?.label || printablePo.poNumber,
        plannedDeliveryDate: group?.plannedDate || printablePo.expectedDeliveryDate || null,
        lines: printablePo.items
            .map(item => ({
                purchaseOrderLineId: item.lineId || item.itemId,
                plannedQty: Number(item.qty || 0),
                unitPrice: Number(item.unitPrice || 0),
            }))
            .filter(line => line.purchaseOrderLineId && line.plannedQty > 0),
    }].filter(batch => batch.lines.length > 0);

    const buildPoApprovalRequestSection = (
        po: PurchaseOrder,
        pageBreak = false,
        deliveryBatches: PoApprovalDeliveryBatch[] = poDeliveryBatchesByPo[po.id] || [],
        qrSvg = '',
    ) => {
        const poHasConversion = po.items.some(item => {
            const conversionSource = {
                unit: getPoLineStockUnit(item),
                purchaseUnit: getPoLinePurchaseUnit(item),
                purchaseConversionFactor: item.purchaseConversionFactor ?? 1,
            };
            return hasPurchaseUnitConversion(conversionSource);
        });

        const itemByLineId = new Map(po.items.map(item => [item.lineId || item.itemId, item]));
        const hasDeliveryBatchLines = deliveryBatches.some(batch => batch.lines.length > 0);
        const totalAmount = Math.round(hasDeliveryBatchLines
            ? deliveryBatches.reduce((sum, batch) => sum + batch.lines.reduce((batchSum, line) => {
                const item = itemByLineId.get(line.purchaseOrderLineId);
                const unitPrice = Number(line.unitPrice ?? item?.unitPrice ?? 0);
                return batchSum + Number(line.plannedQty || 0) * unitPrice;
            }, 0), 0)
            : po.items.reduce((sum, item) => sum + calculateLineTotal(item), 0));
        const vatRate = normalizeVatRate(po.vatRate);
        const vatAmount = calculateVatAmount(totalAmount, vatRate);
        const paymentTotal = totalAmount + vatAmount;
        const approvalQrHtml = qrSvg
            ? `<div class="approval-qr-wrap"><div class="approval-qr-box">${qrSvg}<span>QR nhận hàng</span></div></div>`
            : '';
        const buildItemRow = (item: PurchaseOrderItem, index: number, qty: number, unitPriceOverride?: number | null) => {
            const stockUnit = getPoLineStockUnit(item);
            const purchaseUnit = getPoLinePurchaseUnit(item);
            const conversionSource = {
                unit: stockUnit,
                purchaseUnit: purchaseUnit,
                purchaseConversionFactor: item.purchaseConversionFactor ?? 1,
            };
            const itemHasConversion = hasPurchaseUnitConversion(conversionSource);

            const displayStockUnit = itemHasConversion ? stockUnit : purchaseUnit;
            const displayStockQty = itemHasConversion ? poLinePurchaseToStockQty(item, Number(qty || 0)) : qty;
            const displayPurchaseUnit = itemHasConversion ? purchaseUnit : '—';
            const displayPurchaseQty = itemHasConversion ? Number(qty || 0).toLocaleString('vi-VN') : '—';
            const lineDetailsHtml = formatPoApprovalLineDetails(item)
                .map(line => `<div class="approval-muted">${escapeHtml(line)}</div>`)
                .join('');

            const displayUnitPrice = Number(unitPriceOverride ?? item.unitPrice ?? 0);
            const lineAmount = Math.round(Number(qty || 0) * displayUnitPrice);

            return `
                <tr>
                    <td class="approval-center">${index + 1}</td>
                    <td>${escapeHtml(item.sku || item.itemId)}</td>
                    <td>
                        <strong>${escapeHtml(item.name)}</strong>
                        ${item.workBoqItemName ? `<div class="approval-muted">${escapeHtml(item.workBoqItemName)}</div>` : ''}
                        ${lineDetailsHtml}
                    </td>
                    <td class="approval-center">${escapeHtml(displayStockUnit)}</td>
                    <td class="approval-right">${Number(displayStockQty || 0).toLocaleString('vi-VN')}</td>
                    ${poHasConversion ? `
                    <td class="approval-center">${escapeHtml(displayPurchaseUnit)}</td>
                    <td class="approval-right">${displayPurchaseQty}</td>
                    ` : ''}
                    <td class="approval-right">${displayUnitPrice.toLocaleString('vi-VN')}</td>
                    <td class="approval-right">${lineAmount.toLocaleString('vi-VN')}</td>
                </tr>
            `;
        };
        const rowsHtml = deliveryBatches.length > 0
            ? deliveryBatches.map((batch, batchIndex) => {
                const batchLabel = batch.plannedDeliveryDate
                    ? `Chuyển giao ngày ${new Date(batch.plannedDeliveryDate).toLocaleDateString('vi-VN')}`
                    : `Chuyển giao đợt ${batch.deliveryNo || batchIndex + 1}`;
                const lineRows = batch.lines
                    .map(line => {
                        const item = itemByLineId.get(line.purchaseOrderLineId);
                        return item ? buildItemRow(item, batchIndex + 1, Number(line.plannedQty || 0), line.unitPrice) : '';
                    })
                    .join('');
                return `
                    <tr class="approval-delivery-row">
                        <td class="approval-center"><strong>${batchIndex + 1}</strong></td>
                        <td colspan="${poHasConversion ? 8 : 6}"><strong>${escapeHtml(batchLabel)}</strong></td>
                    </tr>
                    ${lineRows}
                `;
            }).join('')
            : po.items.map((item, index) => buildItemRow(item, index, Number(item.qty || 0))).join('');

        return `
            <section class="approval-sheet ${pageBreak ? 'page-break' : ''}">
                ${approvalQrHtml}

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
                            <td class="approval-label-cell" colspan="2"><em>Số PO:</em></td>
                            <td colspan="10" class="approval-value-cell"><strong>${escapeHtml(po.poNumber)}</strong></td>
                        </tr>
                        <tr>
                            <td colspan="12" class="approval-intro"><em>Đề nghị BGD duyệt đơn hàng:</em></td>
                        </tr>
                        <tr>
                            <td colspan="12" class="approval-subject">${escapeHtml(buildPoApprovalSubject(po))}</td>
                        </tr>
                    </tbody>
                </table>

                <table class="approval-lines">
                    <thead>
                        <tr>
                            <th style="width:36px;">STT</th>
                            <th style="width:85px;">Mã</th>
                            <th>Hàng hóa / nội dung</th>
                            <th style="width:45px;">ĐVT</th>
                            <th style="width:65px;">KL</th>
                            ${poHasConversion ? `
                            <th style="width:50px;">ĐVT(m)</th>
                            <th style="width:60px;">KL(m)</th>
                            ` : ''}
                            <th style="width:95px;">Đơn giá</th>
                            <th style="width:115px;">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="${poHasConversion ? 8 : 6}" class="approval-right"><strong>TỔNG CỘNG</strong></td>
                            <td class="approval-right"><strong>${totalAmount.toLocaleString('vi-VN')} đ</strong></td>
                        </tr>
                        <tr>
                            <td colspan="${poHasConversion ? 8 : 6}" class="approval-right"><strong>VAT (${vatRate.toLocaleString('vi-VN')}%)</strong></td>
                            <td class="approval-right"><strong>${vatAmount.toLocaleString('vi-VN')} đ</strong></td>
                        </tr>
                        <tr>
                            <td colspan="${poHasConversion ? 8 : 6}" class="approval-right"><strong>TỔNG TIỀN THANH TOÁN</strong></td>
                            <td class="approval-right"><strong>${paymentTotal.toLocaleString('vi-VN')} đ</strong></td>
                        </tr>
                    </tfoot>
                </table>

                ${po.note ? `<div class="approval-note"><strong>Ghi chú đơn hàng:</strong> ${escapeHtml(po.note)}</div>` : ''}

                <div class="approval-signatures">
                    <div><strong>BP Vật tư-TB</strong><span>${escapeHtml(user.name || '')}</span></div>
                    <div><strong>PT Phòng QLDA</strong><span>Lưu Công Danh</span></div>
                    
                    <div><strong>Giám đốc vật tư</strong><span>Nguyễn Thị Mơ</span></div>
                    <div><strong>Tổng giám đốc</strong><span>Dương Xuân Thịnh</span></div>
                </div>
            </section>
        `;
    };

    const buildPoPrintSection = (
        printablePo: PurchaseOrder,
        qrSvg: string,
        pageBreak = false,
        deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
    ) => {
        const targetWh = warehouses.find(w => w.id === printablePo.targetWarehouseId);

        const poHasConversion = printablePo.items.some(item => {
            const conversionSource = {
                unit: getPoLineStockUnit(item),
                purchaseUnit: getPoLinePurchaseUnit(item),
                purchaseConversionFactor: item.purchaseConversionFactor ?? 1,
            };
            return hasPurchaseUnitConversion(conversionSource);
        });

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

        const printLineAmounts = buildPurchaseOrderPrintLineAmounts(printablePo, deliveryBatches);
        const printLineAmountByKey = new Map(printLineAmounts.map(line => [line.lineKey, line]));

        const headersHtml = `
            <th class="center" style="width: 36px;">STT</th>
            <th style="width: 85px;">Mã hàng hoá</th>
            <th>Tên hàng hoá & Chi tiết kỹ thuật</th>
            <th class="center" style="width: 45px;">ĐVT</th>
            ${uniqueSpecKeys.map(k => `<th class="center" style="min-width: 70px;">${escapeHtml(getHeaderLabel(k))}</th>`).join('')}
            <th class="right" style="width: 65px;">Khối lượng</th>
            ${poHasConversion ? `
            <th class="center" style="width: 50px;">ĐVT(m)</th>
            <th class="right" style="width: 60px;">KL(m)</th>
            ` : ''}
            <th class="right" style="width: 95px;">Đơn giá</th>
            <th class="right" style="width: 115px;">Thành tiền</th>
        `;

        const rowsHtml = printablePo.items.map((item, index) => {
            const lineKey = item.lineId || item.itemId;
            const printLineAmount = printLineAmountByKey.get(lineKey);
            const printQty = printLineAmount?.scheduledQty ?? Number(item.qty || 0);
            const printUnitPrice = printLineAmount?.unitPrice ?? Number(item.unitPrice || 0);
            const printLineTotal = printLineAmount?.totalAmount ?? calculateLineTotal(item);
            const specCells = uniqueSpecKeys.map(k => {
                const val = item.specs?.[k]?.value;
                return `<td class="center font-semibold bg-slate-50/20">${val !== undefined && val !== null && val !== '' ? escapeHtml(val) : '—'}</td>`;
            }).join('');

            const formulaHtml = item.pricingMode && item.pricingMode !== 'standard'
                ? `<div class="pricing-formula">📐 Tính giá: ${escapeHtml(formatPricingFormula(item))}</div>`
                : '';

            const dateVal = item.neededDate || printablePo.expectedDeliveryDate;
            const noteBoxHtml = dateVal
                ? `
                    <div class="note-box">
                        <div class="note-box-date">📅 Ngày cần: ${escapeHtml(dateVal)}</div>
                    </div>
                `
                : '';

            const stockUnit = getPoLineStockUnit(item);
            const purchaseUnit = getPoLinePurchaseUnit(item);
            const conversionSource = {
                unit: stockUnit,
                purchaseUnit: purchaseUnit,
                purchaseConversionFactor: item.purchaseConversionFactor ?? 1,
            };
            const itemHasConversion = hasPurchaseUnitConversion(conversionSource);

            const displayStockUnit = itemHasConversion ? stockUnit : purchaseUnit;
            const displayStockQty = itemHasConversion ? poLinePurchaseToStockQty(item, printQty) : printQty;
            const displayPurchaseUnit = itemHasConversion ? purchaseUnit : '—';
            const displayPurchaseQty = itemHasConversion ? Number(printQty || 0).toLocaleString('vi-VN') : '—';

            return `
                <tr>
                    <td class="center font-mono">${index + 1}</td>
                    <td class="font-mono text-slate-500">${escapeHtml(item.sku)}</td>
                    <td>
                        <div style="font-weight: bold; font-size: 13px; color: #0f172a;">${escapeHtml(item.name)}</div>
                        ${formulaHtml}
                        ${noteBoxHtml}
                    </td>
                    <td class="center" style="font-weight: 500;">${escapeHtml(displayStockUnit)}</td>
                    ${specCells}
                    <td class="right font-mono" style="font-weight: bold;">${Number(displayStockQty || 0).toLocaleString('vi-VN')}</td>
                    ${poHasConversion ? `
                    <td class="center" style="font-weight: 500;">${escapeHtml(displayPurchaseUnit)}</td>
                    <td class="right font-mono">${displayPurchaseQty}</td>
                    ` : ''}
                    <td class="right font-mono">${Number(printUnitPrice || 0).toLocaleString('vi-VN')}</td>
                    <td class="right font-mono" style="font-weight: bold; color: #0f172a;">${Number(printLineTotal || 0).toLocaleString('vi-VN')} đ</td>
                </tr>
            `;
        }).join('');

        const totalAmount = getPurchaseOrderPrintAmount(printablePo, deliveryBatches);
        const vatRate = normalizeVatRate(printablePo.vatRate);
        const vatAmount = calculateVatAmount(totalAmount, vatRate);
        const paymentTotal = totalAmount + vatAmount;
        const totalLabelColspan = 6 + uniqueSpecKeys.length + (poHasConversion ? 2 : 0);

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
                            <td colspan="${totalLabelColspan}" class="center">TỔNG CỘNG ĐƠN HÀNG:</td>
                            <td class="right" style="color: #0f172a; font-size: 13px; font-weight: bold; text-decoration: underline; text-underline-offset: 4px;">${totalAmount.toLocaleString('vi-VN')} đ</td>
                        </tr>
                        <tr style="font-weight: bold; background: #f8fafc;">
                            <td colspan="${totalLabelColspan}" class="center">VAT (${vatRate.toLocaleString('vi-VN')}%):</td>
                            <td class="right" style="color: #0f172a; font-size: 13px; font-weight: bold;">${vatAmount.toLocaleString('vi-VN')} đ</td>
                        </tr>
                        <tr style="font-weight: bold; background: #ecfdf5;">
                            <td colspan="${totalLabelColspan}" class="center">TỔNG TIỀN THANH TOÁN:</td>
                            <td class="right" style="color: #047857; font-size: 14px; font-weight: bold; text-decoration: underline; text-underline-offset: 4px;">${paymentTotal.toLocaleString('vi-VN')} đ</td>
                        </tr>
                    </tfoot>
                </table>
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
                @page { size: A4 portrait; margin: 10mm 10mm 10mm 10mm; }
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0f172a; margin: 10mm 10mm 10mm 10mm; font-size: 12px; line-height: 1.4; }
                .header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
                h1 { margin: 0; font-size: 22px; letter-spacing: .02em; font-weight: 800; color: #0f172a; }
                .label { color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
                .meta { margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; color: #334155; }
                .meta > div { display: flex; flex-direction: column; gap: 2px; }
                .meta > div .label { font-size: 8px; }
                
                table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11.5px; }
                th, td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; line-height: 1.4; }
                th { background: #f8fafc; text-transform: uppercase; font-size: 9px; font-weight: 800; letter-spacing: .05em; color: #475569; border-bottom: 2px solid #cbd5e1; }
                
                .right { text-align: right; }
                .center { text-align: center; }
                .font-semibold { font-weight: 600; }
                .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
                .bg-slate-50\\/20 { background-color: rgba(248, 250, 252, 0.5); }
                .text-slate-500 { color: #64748b; }
                
                .qr { text-align: center; font-size: 9px; color: #64748b; font-weight: 700; display: flex; flex-direction: column; align-items: center; gap: 4px; }
                .qr svg { max-width: 90px; height: auto; }
                
                .note-box {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    padding: 6px 10px;
                    border-radius: 6px;
                    margin-top: 4px;
                    font-size: 10px;
                    color: #475569;
                    line-height: 1.5;
                }
                .note-box-date {
                    font-weight: 700;
                    color: #334155;
                    margin-bottom: 2px;
                }
                .note-box-italic {
                    font-style: italic;
                    color: #64748b;
                }
                
                .pricing-formula {
                    font-size: 8.5px;
                    color: #7c3aed;
                    margin-top: 3px;
                    font-weight: bold;
                    display: inline-block;
                    background: #f5f3ff;
                    border: 1px solid #ddd6fe;
                    padding: 2px 4px;
                    border-radius: 4px;
                }
                
                .note { margin-top: 16px; font-size: 11px; color: #334155; background: #fdfbf7; border: 1px solid #fef3c7; padding: 10px; border-radius: 6px; }
                .approval-sheet { position: relative; font-family: "Times New Roman", Times, serif; color: #000; font-size: 13.5px; line-height: 1.2; }
                .approval-header-table { width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; }
                .approval-header-table td { border: 1px solid #cfcfcf; padding: 4px 5px; }
                .approval-title { text-align: center; font-size: 18px; font-weight: 800; letter-spacing: .02em; }
                .approval-date { text-align: right; font-size: 13px; padding-right: 36px !important; }
                .approval-label-cell { width: 120px; white-space: nowrap; }
                .approval-value-cell { border-bottom: 1px dotted #333 !important; }
                .approval-intro { border-bottom: 0 !important; font-size: 13px; }
                .approval-subject { text-align: center; font-size: 15px; font-weight: 800; text-transform: uppercase; }
                .approval-qr-wrap { margin: 0 0 4px 0; display: flex; justify-content: flex-end; align-items: flex-start; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 10px; font-weight: 700; color: #334155; text-align: center; }
                .approval-qr-box { display: flex; flex-direction: column; align-items: center; gap: 2px; }
                .approval-qr-wrap svg { width: 72px; height: 72px; }
                .approval-lines { width: 100%; border-collapse: collapse; margin-top: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 11px; }
                .approval-lines th, .approval-lines td { border: 1px solid #cfcfcf; padding: 5px 6px; vertical-align: top; }
                .approval-lines th { background: #f3f4f6; color: #111; text-align: center; font-size: 9.5px; font-weight: 800; text-transform: uppercase; }
                .approval-lines tfoot td { background: #fafafa; }
                .approval-delivery-row td { background: #eef7e9; font-family: "Times New Roman", Times, serif; font-size: 12px; }
                .approval-center { text-align: center; }
                .approval-right { text-align: right; }
                .approval-muted { margin-top: 2px; color: #666; font-size: 10px; }
                .approval-note { margin-top: 10px; border: 1px solid #d7d7d7; padding: 6px 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 11.5px; }
                .approval-signatures { margin-top: 20px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; text-align: center; font-family: "Times New Roman", Times, serif; }
                .approval-signatures div { min-height: 120px; }
                .approval-signatures strong { display: block; margin-bottom: 85px; }
                .approval-signatures span { font-weight: 700; }
                .page-break { page-break-before: always; break-before: page; }
                @media print { 
                    body { margin: 0; } 
                    table { page-break-inside: auto; }
                    tr { page-break-inside: avoid; page-break-after: auto; }
                }
            </style>
        </head>
        <body>${sectionsHtml}</body>
        </html>
    `;

    const openPoPrintWindow = () => {
        const printWindow = window.open('', '_blank', 'width=980,height=720');
        if (!printWindow) {
            toast.error('Không thể mở cửa sổ in', 'Trình duyệt đang chặn popup in/PDF.');
            return null;
        }
        printWindow.document.write(`
            <!doctype html>
            <html>
            <head><meta charset="utf-8" /><title>Đang chuẩn bị bản in</title></head>
            <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:32px;color:#334155;">
                <strong>Đang chuẩn bị bản in...</strong>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        return printWindow;
    };

    const writePoPrintWindow = (printWindow: Window, html: string) => {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 300);
    };

    const closePoPrintWindow = (printWindow: Window | null) => {
        try {
            if (printWindow && !printWindow.closed) printWindow.close();
        } catch {
            // Ignore browser-specific close restrictions.
        }
    };

    const buildPoDeliveryPrintGroupFromSchedule = (
        po: PurchaseOrder,
        batch: PurchaseOrderDeliveryBatch,
    ): PoDeliveryPrintGroup => {
        const poItemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
        const linksByPoLine = poRequestLinks
            .filter(link => link.purchaseOrderId === po.id)
            .reduce<Map<string, PurchaseOrderRequestLineLink[]>>((map, link) => {
                map.set(link.purchaseOrderLineId, [...(map.get(link.purchaseOrderLineId) || []), link]);
                return map;
            }, new Map());
        const lines = (batch.lines || []).map((line, index) => {
            const sourceItem = poItemByLineId.get(line.purchaseOrderLineId);
            const inventory = inventoryItems.find(item => item.id === (sourceItem?.itemId || line.itemId));
            const requestLink = (linksByPoLine.get(line.purchaseOrderLineId) || [])[0];
            const purchaseUnit = line.unit || (sourceItem ? getPoLinePurchaseUnit(sourceItem, inventory) : inventory?.purchaseUnit || inventory?.unit) || '';
            const purchaseQty = Number(line.plannedQty || 0);
            const purchaseUnitPrice = Number(line.deliveryUnitPrice ?? sourceItem?.unitPrice ?? 0);
            return {
                id: line.id || `${batch.id}:${line.purchaseOrderLineId}:${index}`,
                batchId: batch.id,
                materialRequestId: requestLink?.materialRequestId || sourceItem?.requestId || '',
                requestLineId: requestLink?.requestLineId || sourceItem?.requestLineId || line.purchaseOrderLineId,
                itemId: line.itemId || sourceItem?.itemId || '',
                materialBudgetItemId: requestLink?.materialBudgetItemId || sourceItem?.materialBudgetItemId || null,
                workBoqItemId: requestLink?.workBoqItemId || sourceItem?.workBoqItemId || null,
                poId: po.id,
                poLineId: line.purchaseOrderLineId,
                poDeliveryLineId: line.id,
                purchaseOrderRequestLineId: requestLink?.id || null,
                requestedQtySnapshot: purchaseQty,
                committedQtySnapshot: purchaseQty,
                issuedQty: purchaseQty,
                receivedQty: 0,
                unit: purchaseUnit,
                deliveryUnit: purchaseUnit,
                deliveryUnitPrice: purchaseUnitPrice,
                varianceReason: null,
                note: `Đợt ${batch.deliveryNo} theo lịch giao ${po.poNumber}`,
            } as MaterialRequestFulfillmentLine;
        }).filter(line => line.itemId && Number(line.issuedQty || 0) > 0);

        return {
            key: batch.id,
            label: `Đợt ${batch.deliveryNo}`,
            plannedDate: batch.plannedDeliveryDate || po.expectedDeliveryDate || null,
            status: batch.status || 'planned',
            note: batch.note || null,
            targetWarehouseId: po.targetWarehouseId || null,
            source: 'schedule',
            scheduleBatch: batch,
            batches: [],
            lines,
        };
    };

    const getDeliveryPrintGroupStatusLabel = (status?: string | null) => {
        if (status === 'planned') return 'Kế hoạch';
        if (status === 'wms_pending') return 'Chờ kho duyệt';
        if (status === 'received') return 'Đã nhận';
        if (status === 'closed') return 'Đã đóng';
        if (status === 'cancelled') return 'Từ chối';
        if (status === 'draft') return 'Nháp';
        return 'Đang giao';
    };

    const getDeliveryPrintGroupSummary = (group: PoDeliveryPrintGroup) => {
        const totalQty = group.lines.reduce((sum, line) => sum + Number(line.issuedQty || 0), 0);
        const totalAmount = group.lines.reduce((sum, line) => sum + Number(line.issuedQty || 0) * Number(line.deliveryUnitPrice || 0), 0);
        const units = Array.from(new Set(group.lines.map(line => line.deliveryUnit || line.unit).filter(Boolean)));
        const prices = Array.from(
            new Set(
                group.lines
                    .map(line => Number(line.deliveryUnitPrice || 0))
                    .filter(price => Number.isFinite(price))
            )
        );

        return {
            totalQty,
            totalAmount,
            unitLabel: units.length === 1 ? units[0] : units.length > 1 ? 'nhiều ĐVT' : '',
            unitPriceLabel: prices.length === 1 ? `${prices[0].toLocaleString('vi-VN')} đ` : prices.length > 1 ? 'Nhiều đơn giá' : '0 đ',
        };
    };

    const loadPoDeliveryPrintGroups = async (
        po: PurchaseOrder,
        force = false,
        scheduleOverride?: PurchaseOrderDeliveryBatch[],
    ): Promise<PoDeliveryPrintGroup[]> => {
        if (!force && poDeliveryPrintGroupsByPoId[po.id]) return poDeliveryPrintGroupsByPoId[po.id];
        const scheduleBatches = scheduleOverride ?? poDeliveryBatchesByPo[po.id] ?? [];
        const links = poRequestLinks.filter(link => link.purchaseOrderId === po.id);
        const requestIds = Array.from(new Set(links.map(link => link.materialRequestId).filter(Boolean)));
        if (requestIds.length === 0) {
            const scheduleGroups = scheduleBatches
                .map(batch => buildPoDeliveryPrintGroupFromSchedule(po, batch))
                .filter(group => group.lines.length > 0);
            setPoDeliveryPrintGroupsByPoId(prev => ({ ...prev, [po.id]: scheduleGroups }));
            return scheduleGroups;
        }

        setLoadingPoDeliveryPrintPoId(po.id);
        try {
            const [batchesByRequest, deliveryGroups] = await Promise.all([
                materialRequestFulfillmentService.listByRequests(requestIds),
                materialRequestFulfillmentService.listDeliveryGroupsByPurchaseOrder(po.id),
            ]);
            const deliveryGroupById = new Map<string, PurchaseOrderDeliveryGroup>(
                deliveryGroups.map(group => [group.id, group])
            );
            const batches = Object.values(batchesByRequest)
                .flat()
                .map(batch => ({
                    ...batch,
                    lines: batch.lines.filter(line => line.poId === po.id),
                }))
                .filter(batch => batch.lines.length > 0);

            const grouped = batches.reduce<Map<string, MaterialRequestFulfillmentBatch[]>>((map, batch) => {
                const key = batch.poDeliveryGroupId || batch.poDeliveryBatchId || batch.id;
                map.set(key, [...(map.get(key) || []), batch]);
                return map;
            }, new Map());
            const scheduleBatchById = new Map(scheduleBatches.map(batch => [batch.id, batch]));

            const groups = Array.from(grouped.entries()).map(([key, groupBatches], index) => {
                const meta = deliveryGroupById.get(key);
                const scheduleMeta = scheduleBatchById.get(key)
                    || scheduleBatchById.get(groupBatches.find(batch => batch.poDeliveryBatchId)?.poDeliveryBatchId || '');
                const fallbackLines = groupBatches.flatMap(batch => batch.lines);
                const schedulePrintGroup = scheduleMeta ? buildPoDeliveryPrintGroupFromSchedule(po, scheduleMeta) : null;
                const lines = schedulePrintGroup?.lines.length ? schedulePrintGroup.lines : fallbackLines;
                const targetWarehouseIds = Array.from(new Set(groupBatches.map(batch => batch.targetWarehouseId).filter(Boolean)));
                const allReceived = groupBatches.every(batch => batch.status === 'received');
                const allRejected = groupBatches.every(batch =>
                    ['cancelled', 'returned'].includes(batch.status)
                    && batch.lines.every(line => Number(line.receivedQty || 0) <= 0)
                );
                return {
                    key,
                    label: meta?.deliveryNo || (scheduleMeta ? `Đợt ${scheduleMeta.deliveryNo}` : groupBatches[0]?.batchNo || `${po.poNumber}-DOT-${index + 1}`),
                    plannedDate: meta?.plannedDate || scheduleMeta?.plannedDeliveryDate || groupBatches[0]?.batchDate || null,
                    status: allRejected ? 'cancelled' : allReceived ? 'received' : scheduleMeta?.status || meta?.status || 'issued',
                    note: meta?.note || scheduleMeta?.note || groupBatches.map(batch => batch.note).filter(Boolean).join(' | ') || null,
                    targetWarehouseId: targetWarehouseIds.length === 1 ? targetWarehouseIds[0] : null,
                    source: scheduleMeta ? 'schedule' : 'fulfillment',
                    scheduleBatch: scheduleMeta || null,
                    batches: groupBatches,
                    lines,
                } as PoDeliveryPrintGroup;
            });
            const fulfilledScheduleBatchIds = new Set(
                batches.map(batch => batch.poDeliveryBatchId).filter((id): id is string => Boolean(id))
            );
            const pendingScheduleGroups = scheduleBatches
                .filter(batch => !fulfilledScheduleBatchIds.has(batch.id))
                .map(batch => buildPoDeliveryPrintGroupFromSchedule(po, batch))
                .filter(group => group.lines.length > 0);
            const groupsWithSchedules = [...pendingScheduleGroups, ...groups]
                .sort((a, b) => {
                    const dateCompare = String(a.plannedDate || '').localeCompare(String(b.plannedDate || ''));
                    if (dateCompare !== 0) return dateCompare;
                    return Number(a.scheduleBatch?.deliveryNo || 0) - Number(b.scheduleBatch?.deliveryNo || 0);
                });

            setPoDeliveryPrintGroupsByPoId(prev => ({ ...prev, [po.id]: groupsWithSchedules }));
            return groupsWithSchedules;
        } catch (error) {
            logApiError('supplyChain.loadPoDeliveryPrintGroups', error);
            toast.error('Không thể tải lịch giao hàng', getApiErrorMessage(error, 'Vui lòng thử lại.'));
            return [];
        } finally {
            setLoadingPoDeliveryPrintPoId(current => current === po.id ? null : current);
        }
    };

    const buildDeliveryGroupPrintablePo = (po: PurchaseOrder, group: PoDeliveryPrintGroup): PurchaseOrder => {
        const poItemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
        const printableItems = group.lines.map((line, index) => {
            const sourceItem = poItemByLineId.get(line.poLineId || line.itemId);
            const inventory = inventoryItems.find(item => item.id === (sourceItem?.itemId || line.itemId));
            const request = scopedMaterialRequests.find(item => item.id === line.materialRequestId);
            const siteName = request?.constructionSiteId
                ? constructionSiteById.get(request.constructionSiteId)?.name || request.constructionSiteId
                : '';
            const warehouseName = group.targetWarehouseId
                ? warehouses.find(warehouse => warehouse.id === group.targetWarehouseId)?.name || group.targetWarehouseId
                : line.batchId
                    ? warehouses.find(warehouse => warehouse.id === group.batches.find(batch => batch.id === line.batchId)?.targetWarehouseId)?.name
                    : '';
            const issuedQty = Number(line.issuedQty || 0);
            const receivedQty = Number(line.receivedQty || 0);
            const stockUnit = sourceItem ? getPoLineStockUnit(sourceItem, inventory) : inventory?.unit || line.unit || line.deliveryUnit || '';
            const purchaseUnit = sourceItem ? getPoLinePurchaseUnit(sourceItem, inventory) : line.deliveryUnit || line.unit || inventory?.purchaseUnit || inventory?.unit || '';
            const conversionSource = sourceItem ? {
                unit: stockUnit,
                purchaseUnit,
                purchaseConversionFactor: sourceItem.purchaseConversionFactor ?? inventory?.purchaseConversionFactor ?? 1,
            } : null;
            const itemHasConversion = sourceItem ? hasPurchaseUnitConversion(conversionSource) : false;
            const lineUnit = line.deliveryUnit || line.unit || purchaseUnit || stockUnit;
            const lineQtyIsPurchaseUnit = !itemHasConversion || lineUnit === purchaseUnit || group.source === 'schedule';
            const purchaseQty = sourceItem && itemHasConversion && !lineQtyIsPurchaseUnit
                ? poLineStockToPurchaseQty(sourceItem, issuedQty, inventory)
                : issuedQty;
            const purchaseUnitPrice = Number(line.deliveryUnitPrice ?? sourceItem?.unitPrice ?? inventory?.priceIn ?? 0);
            const detailNotes = [
                `Đợt: ${group.label}`,
                request?.code ? `Phiếu YC: ${request.code}` : null,
                siteName ? `Công trường: ${siteName}` : null,
                warehouseName ? `Kho nhận: ${warehouseName}` : null,
                receivedQty > 0 ? `Thực nhận: ${receivedQty.toLocaleString('vi-VN')} ${stockUnit || lineUnit}` : null,
                sourceItem?.note || null,
            ].filter(Boolean).join(' • ');

            return {
                ...(sourceItem || {
                    itemId: line.itemId,
                    sku: line.itemId,
                    name: line.itemId,
                    unit: lineUnit,
                    qty: 0,
                    unitPrice: 0,
                } as PurchaseOrderItem),
                lineId: `${sourceItem?.lineId || line.poLineId || line.itemId}-delivery-${line.id || index}`,
                itemId: sourceItem?.itemId || line.itemId,
                sku: sourceItem?.sku || inventory?.sku || line.itemId,
                name: sourceItem?.name || inventory?.name || line.itemId,
                unit: purchaseUnit || lineUnit,
                unitSnapshot: stockUnit || lineUnit,
                stockUnitSnapshot: stockUnit || lineUnit,
                purchaseUnitSnapshot: purchaseUnit || lineUnit,
                purchaseConversionFactor: sourceItem?.purchaseConversionFactor ?? inventory?.purchaseConversionFactor ?? 1,
                qty: purchaseQty,
                unitPrice: purchaseUnitPrice,
                pricingMode: 'standard',
                computedArea: undefined,
                computedWeight: undefined,
                computedLineTotal: purchaseQty * purchaseUnitPrice,
                requestId: line.materialRequestId,
                requestCode: request?.code || sourceItem?.requestCode || null,
                requestLineId: line.requestLineId,
                neededDate: group.plannedDate?.slice(0, 10) || sourceItem?.neededDate,
                note: detailNotes,
            } as PurchaseOrderItem;
        }).filter(item => Number(item.qty || 0) > 0);

        const groupTargetWarehouseId = group.targetWarehouseId || po.targetWarehouseId;
        return {
            ...po,
            poNumber: `${po.poNumber} / ${group.label}`,
            targetWarehouseId: groupTargetWarehouseId || po.targetWarehouseId,
            expectedDeliveryDate: group.plannedDate?.slice(0, 10) || po.expectedDeliveryDate,
            items: printableItems,
            totalAmount: printableItems.reduce((sum, item) => sum + calculateLineTotal(item), 0),
            note: [
                po.note,
                `In theo đợt giao ${group.label}`,
                group.note,
            ].filter(Boolean).join(' | '),
        };
    };

    const handlePrintPoDeliveryGroup = async (
        po: PurchaseOrder,
        group: PoDeliveryPrintGroup,
        template: PurchaseOrderPrintTemplateKey = 'purchase_order',
    ) => {
        const printWindow = openPoPrintWindow();
        if (!printWindow) return;
        const printKey = `${po.id}:${group.key}:${template}`;
        setPrintingPoId(printKey);
        setPoPrintMenuId(null);
        try {
            const printablePo = buildDeliveryGroupPrintablePo(po, group);
            if (printablePo.items.length === 0) {
                closePoPrintWindow(printWindow);
                toast.info('Không có dòng để in', 'Đợt giao này chưa có số lượng giao.');
                return;
            }
            let html = '';
            if (template === 'approval_request') {
                const poWithQr = await poService.ensureQrToken(po);
                if (!po.qrToken) setPos(prev => prev.map(item => item.id === po.id ? poWithQr : item));
                const receiveUrl = buildPoReceiveUrl(poWithQr.qrToken!);
                const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={90} level="H" includeMargin />);
                html = buildPoPrintHtml(
                    `Đề nghị duyệt ${printablePo.poNumber}`,
                    buildPoApprovalRequestSection(
                        { ...printablePo, qrToken: poWithQr.qrToken },
                        false,
                        buildPrintablePoApprovalDeliveryBatch(printablePo, group),
                        qrSvg,
                    ),
                );
            } else {
                const poWithQr = await poService.ensureQrToken(po);
                if (!po.qrToken) setPos(prev => prev.map(item => item.id === po.id ? poWithQr : item));
                const receiveUrl = buildPoReceiveUrl(poWithQr.qrToken!);
                const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={90} level="H" includeMargin />);
                html = buildPoPrintHtml(printablePo.poNumber, buildPoPrintSection({ ...printablePo, qrToken: poWithQr.qrToken }, qrSvg));
            }
            writePoPrintWindow(printWindow, html);
        } catch (e: any) {
            closePoPrintWindow(printWindow);
            logApiError('supplyChain.printPoDeliveryGroup', e);
            toast.error('Không thể in đợt giao', getApiErrorMessage(e, `Không thể tạo mẫu in "${PO_PRINT_TEMPLATE_LABELS[template]}" cho đợt này.`));
        } finally {
            setPrintingPoId(null);
        }
    };

    const handlePrintPo = async (po: PurchaseOrder, template: PurchaseOrderPrintTemplateKey = 'purchase_order') => {
        const printWindow = openPoPrintWindow();
        if (!printWindow) return;
        setPrintingPoId(po.id);
        setPoPrintMenuId(null);
        try {
            let html = '';
            if (template === 'approval_request') {
                const printablePo = await poService.ensureQrToken(po);
                if (!po.qrToken) {
                    setPos(prev => prev.map(item => item.id === po.id ? printablePo : item));
                }
                const approvalGroups = await loadPoDeliveryPrintGroups(po);
                const approvalDeliveryBatches = buildPoApprovalDeliveryBatches(approvalGroups);
                const receiveUrl = buildPoReceiveUrl(printablePo.qrToken!);
                const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={90} level="H" includeMargin />);
                html = buildPoPrintHtml(
                    `Đề nghị duyệt đơn hàng ${printablePo.poNumber}`,
                    buildPoApprovalRequestSection(printablePo, false, approvalDeliveryBatches, qrSvg),
                );
            } else {
                const printablePo = await poService.ensureQrToken(po);
                if (!po.qrToken) {
                    setPos(prev => prev.map(item => item.id === po.id ? printablePo : item));
                }
                const receiveUrl = buildPoReceiveUrl(printablePo.qrToken!);
                const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={90} level="H" includeMargin />);
                html = buildPoPrintHtml(
                    printablePo.poNumber,
                    buildPoPrintSection(printablePo, qrSvg, false, poDeliveryBatchesByPo[po.id] || []),
                );
            }

            writePoPrintWindow(printWindow, html);
        } catch (e: any) {
            closePoPrintWindow(printWindow);
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
        const printWindow = openPoPrintWindow();
        if (!printWindow) return;
        setPrintingPoId(groupId);
        setPoPrintMenuId(null);
        try {
            let html = '';
            if (template === 'approval_request') {
                const deliveryGroupsByPoId = new Map<string, PoDeliveryPrintGroup[]>();
                const printableOrders: PurchaseOrder[] = [];
                for (const po of groupOrders) {
                    const printablePo = await poService.ensureQrToken(po);
                    printableOrders.push(printablePo);
                    deliveryGroupsByPoId.set(po.id, await loadPoDeliveryPrintGroups(po));
                }
                setPos(prev => prev.map(po => printableOrders.find(item => item.id === po.id) || po));
                const sections = printableOrders.map((po, index) => {
                    const receiveUrl = buildPoReceiveUrl(po.qrToken!);
                    const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={90} level="H" includeMargin />);
                    return buildPoApprovalRequestSection(
                        po,
                        index > 0,
                        buildPoApprovalDeliveryBatches(deliveryGroupsByPoId.get(po.id) || []),
                        qrSvg,
                    );
                }).join('');
                html = buildPoPrintHtml(`Đề nghị duyệt nhóm ${printableOrders[0].procurementGroupNo || 'PO'}`, sections);
            } else {
                const printableOrders: PurchaseOrder[] = [];
                for (const po of groupOrders) {
                    const printablePo = await poService.ensureQrToken(po);
                    printableOrders.push(printablePo);
                }
                setPos(prev => prev.map(po => printableOrders.find(item => item.id === po.id) || po));
                const sections = printableOrders.map((po, index) => {
                    const receiveUrl = buildPoReceiveUrl(po.qrToken!);
                    const qrSvg = renderToStaticMarkup(<QRCodeSVG value={receiveUrl} size={90} level="H" includeMargin />);
                    return buildPoPrintSection(po, qrSvg, index > 0, poDeliveryBatchesByPo[po.id] || []);
                }).join('');
                html = buildPoPrintHtml(printableOrders[0].procurementGroupNo || 'Nhóm PO', sections);
            }
            writePoPrintWindow(printWindow, html);
        } catch (e: any) {
            closePoPrintWindow(printWindow);
            logApiError('supplyChain.printPoGroup', e);
            toast.error('Không thể in nhóm PO', getApiErrorMessage(e, `Không thể tạo bộ mẫu "${PO_PRINT_TEMPLATE_LABELS[template]}".`));
        } finally {
            setPrintingPoId(null);
        }
    };

    const openPoDetail = (po: PurchaseOrder) => {
        setSelectedPoId(po.id);
        setPoPrintMenuId(null);
        if (PO_DELIVERY_PRINT_AUTOLOAD_STATUSES.has(po.status)) void loadPoDeliveryPrintGroups(po);
    };

    const closePoDetail = () => {
        setSelectedPoId(null);
        setPoPrintMenuId(null);
    };

    const getPoActionIcon = (action: PurchaseOrderUiAction) => {
        if (action.id.includes('print')) return <Printer size={13} />;
        if (action.id === 'edit_po') return <Edit2 size={13} />;
        if (action.id === 'remove_po') return <Trash2 size={13} />;
        if (action.id === 'supplier_return') return <PackageX size={13} />;
        if (action.id === 'view_history') return <FileText size={13} />;
        if (action.id === 'approve_po' || action.id === 'approve_supplemental' || action.id === 'close_partial' || action.id === 'close_po') return <CheckCircle2 size={13} />;
        if (action.id === 'reject_supplemental') return <Ban size={13} />;
        if (action.id === 'request_approval') return <Send size={13} />;
        if (action.id === 'request_revision') return <RefreshCcw size={13} />;
        if (action.id === 'create_delivery' || action.id === 'create_supplemental_delivery') return <Truck size={13} />;
        if (action.id === 'create_receipt') return <QrCode size={13} />;
        return <FileText size={13} />;
    };

    const getPoMenuActionClass = (action: PurchaseOrderUiAction) => {
        if (action.disabled) return 'text-slate-300 cursor-not-allowed';
        if (action.intent === 'danger') return 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30';
        if (action.intent === 'success') return 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/30';
        if (action.intent === 'warning') return 'text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/30';
        if (action.intent === 'primary') return 'text-blue-700 hover:bg-blue-50 hover:text-blue-800 dark:hover:bg-blue-950/30';
        return 'text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800';
    };

    const runPoUiAction = async (po: PurchaseOrder, action: PurchaseOrderUiAction) => {
        if (action.disabled) {
            toast.warning('Không thể thao tác', action.disabledReason || 'Thao tác này chưa khả dụng với PO hiện tại.');
            return;
        }
        setPoPrintMenuId(null);
        switch (action.id) {
            case 'request_approval':
                await updatePoStatus(po.id, 'sent');
                return;
            case 'approve_po':
                await updatePoStatus(po.id, 'confirmed');
                return;
            case 'request_revision':
                await updatePoStatus(po.id, 'draft');
                return;
            case 'approve_supplemental':
                if (!ensureCanApprovePo('duyệt bổ sung PO')) return;
                if (!action.supplementalApprovalId) {
                    toast.warning('Thiếu yêu cầu duyệt', 'Không tìm thấy phiếu duyệt bổ sung của đợt mua này.');
                    return;
                }
                await poSupplementalApprovalService.approve(action.supplementalApprovalId, user?.id || null);
                await loadSupplyData();
                toast.success('Đã duyệt bổ sung PO', 'Đợt mua đã được mở để tạo WMS/QR.');
                return;
            case 'reject_supplemental':
                if (!ensureCanApprovePo('từ chối duyệt bổ sung PO')) return;
                if (!action.supplementalApprovalId) {
                    toast.warning('Thiếu yêu cầu duyệt', 'Không tìm thấy phiếu duyệt bổ sung của đợt mua này.');
                    return;
                }
                {
                    const ok = await confirm({
                        title: 'Từ chối duyệt bổ sung',
                        targetName: po.poNumber,
                        confirmText: 'Từ chối bổ sung',
                        warningText: 'Đợt mua vẫn được lưu nhưng tiếp tục bị chặn tạo WMS/QR cho tới khi sửa lại hoặc gửi duyệt bổ sung mới.',
                        intent: 'warning',
                        countdownSeconds: 1,
                    });
                    if (!ok) return;
                }
                await poSupplementalApprovalService.reject(action.supplementalApprovalId, user?.id || null);
                await loadSupplyData();
                toast.success('Đã từ chối duyệt bổ sung PO');
                return;
            case 'create_delivery':
            case 'create_supplemental_delivery':
                await openPoDeliveryDraft(po);
                return;
            case 'create_receipt': {
                const deliveryBatch = (poDeliveryBatchesByPo[po.id] || []).find(batch => batch.id === action.deliveryBatchId)
                    || (poDeliveryBatchesByPo[po.id] || []).find(batch => batch.status === 'planned');
                if (!deliveryBatch) {
                    openPoDetail(po);
                    toast.info('Chưa có đợt giao kế hoạch', 'Mở chi tiết PO để kiểm tra lịch giao hoặc tạo đợt giao mới.');
                    return;
                }
                await handleCreatePoDeliveryReceipt(po, deliveryBatch);
                return;
            }
            case 'close_partial':
                await updatePoStatus(po.id, 'delivered');
                return;
            case 'close_po':
                await updatePoStatus(po.id, 'closed');
                return;
            case 'print_purchase_order':
                await handlePrintPo(po, 'purchase_order');
                return;
            case 'print_approval_request':
                await handlePrintPo(po, 'approval_request');
                return;
            case 'print_group_purchase_order':
                if (po.procurementGroupId) await handlePrintPoGroup(po.procurementGroupId, 'purchase_order');
                return;
            case 'print_group_approval_request':
                if (po.procurementGroupId) await handlePrintPoGroup(po.procurementGroupId, 'approval_request');
                return;
            case 'edit_po':
                openEditPo(po);
                return;
            case 'remove_po':
                await handleDeletePo(po);
                return;
            case 'supplier_return':
                if (!ensureCanReturnSupplierPo('trả hàng NCC')) return;
                setSupplierReturnPo(po);
                return;
            case 'open_wms_transaction': {
                const transaction = transactions.find(tx => tx.id === action.transactionId);
                if (!transaction) {
                    toast.warning('Chưa tìm thấy phiếu WMS', 'Phiếu kho liên quan chưa được tải hoặc đã bị xoá.');
                    return;
                }
                setSelectedWmsTransaction(transaction);
                return;
            }
            case 'create_supplier_payable':
                try {
                    await supplierPayableService.syncPurchaseOrderById(po.id);
                    await loadPoPayableDocuments(po);
                    await loadSupplyData();
                    toast.success('Đã tạo công nợ NCC', `${po.poNumber} đã được đồng bộ sang chứng từ công nợ.`);
                } catch (error: any) {
                    logApiError('supplyChain.createSupplierPayable', error);
                    toast.error('Không thể tạo công nợ NCC', getApiErrorMessage(error, 'Vui lòng thử lại.'));
                }
                return;
            case 'view_history':
                openPoDetail(po);
                return;
            default:
                openPoDetail(po);
        }
    };

    // Stats
    const stats = useMemo(() => {
        const totalPo = pos.length;
        const totalValue = pos.reduce((s, p) => s + p.totalAmount, 0);
        const delivered = pos.filter(p => p.status === 'delivered' || p.status === 'closed').length;
        const inTransit = pos.filter(p => p.status === 'in_transit').length;
        const partial = pos.filter(p => p.status === 'partial').length;
        return { totalPo, totalValue, delivered, inTransit, partial };
    }, [pos]);
    const directPurchaseStats = useMemo(() => {
        const total = directPurchases.length;
        const totalValue = directPurchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount || 0), 0);
        const pendingWms = directPurchases.filter(purchase => !purchase.wmsTransactionId && purchase.status !== 'reconciled' && purchase.status !== 'closed').length;
        const payableReady = directPurchases.filter(purchase => ['finance_review', 'received', 'purchased'].includes(purchase.status)).length;
        return { total, totalValue, pendingWms, payableReady };
    }, [directPurchases]);
    const sortedDirectPurchases = useMemo(
        () => [...directPurchases].sort((a, b) => String(b.purchaseDate || b.createdAt || '').localeCompare(String(a.purchaseDate || a.createdAt || ''))),
        [directPurchases],
    );
    const filteredSmallToolRecords = useMemo(() => {
        const keyword = smallToolSearch.trim().toLowerCase();
        return smallToolRecords.filter(record => {
            const matchesStatus = smallToolStatusFilter === 'all' || record.status === smallToolStatusFilter;
            const haystack = [
                record.code,
                record.itemNameSnapshot,
                record.category,
                record.holderNameSnapshot,
                record.locationNote,
                record.supplierNameSnapshot,
                record.sourceCode,
            ].filter(Boolean).join(' ').toLowerCase();
            return matchesStatus && (!keyword || haystack.includes(keyword));
        });
    }, [smallToolRecords, smallToolSearch, smallToolStatusFilter]);
    const smallToolStats = useMemo(() => {
        const activeRecords = smallToolRecords.filter(record => record.status !== 'disposed');
        const inUse = activeRecords.filter(record => record.status === 'in_use').length;
        const issueCount = activeRecords.filter(record => record.status === 'damaged' || record.status === 'lost').length;
        const totalValue = activeRecords.reduce((sum, record) => sum + Number(record.totalAmount || 0), 0);
        return { total: activeRecords.length, inUse, issueCount, totalValue };
    }, [smallToolRecords]);

    const poDeliveryBatchesForForm = useMemo(
        () => getPoDeliveryBatchesForForm(),
        [constructionSiteId, editingPo, inventoryItems, pDeliveryBatches, pDeliveryScheduleMode, pExpDate, pItems, pSourceMode, projectId, user?.id],
    );
    const scheduledPItems = useMemo(
        () => pItems.map(item => ({ ...item })),
        [pItems],
    );
    const scheduledPItemByLineKey = useMemo(() => {
        const map = new Map<string, PurchaseOrderItem>();
        scheduledPItems.forEach(item => map.set(item.lineId || item.itemId, item));
        return map;
    }, [scheduledPItems]);
    const poTotalCalc = scheduledPItems.reduce((sum, item) => {
        const normalizedLine = normalizePoItem(item, inventoryItems);
        const previewLine = pSourceMode === 'proactive_stock' ? normalizedLine : buildPoBudgetSnapshot(normalizedLine);
        return sum + calculateLineTotal(previewLine);
    }, 0);
    const poReleaseSummaryPreview = useMemo(() => {
        const previewPo: PurchaseOrder = {
            ...(editingPo || {}),
            id: editingPo?.id || '__preview__',
            vendorId: pVendorId || '',
            vendorName: supplierById.get(pVendorId)?.name || '',
            poNumber: pNum || '',
            items: scheduledPItems,
            totalAmount: poTotalCalc,
            approvedTotalAmount: getApprovedTotalAmountForPoSave(editingPo, poTotalCalc),
            orderDate: pDate,
            status: editingPo?.status || 'draft',
            sourceMode: pSourceMode,
            createdAt: editingPo?.createdAt || new Date().toISOString(),
        };
        return getPurchaseOrderReleaseSummary(previewPo, poDeliveryBatchesForForm);
    }, [editingPo, pDate, pNum, pSourceMode, pVendorId, poDeliveryBatchesForForm, poTotalCalc, scheduledPItems, supplierById]);
    const directPurchaseFormLines = useMemo(
        () => dpLines.map((line, index) => normalizeDirectPurchaseFormLine(line, index, dpId)),
        [dpId, dpLines],
    );
    const directPurchaseFormTotals = useMemo(
        () => calculateSiteDirectPurchaseTotals(directPurchaseFormLines),
        [directPurchaseFormLines],
    );
    const filteredDirectPurchasePickerItems = useMemo(() => {
        const keyword = directPurchaseItemPickerQuery.trim();
        const selectedIds = new Set(dpLines.map(line => line.itemId).filter(Boolean) as string[]);
        return inventoryItems
            .filter(item => !selectedIds.has(item.id))
            .filter(item => !keyword || matchesSearchQueryMultiple([
                item.sku,
                item.name,
                item.category,
                item.unit,
                item.purchaseUnit,
            ], keyword))
            .slice(0, 80);
    }, [directPurchaseItemPickerQuery, dpLines, inventoryItems]);
    const supplierDeliveryFormLines = useMemo(
        () => sdLines.map((line, index) => normalizeSupplierDeliveryFormLine(line, index, sdId, sdSupplierContractId)),
        [sdId, sdLines, sdSupplierContractId],
    );
    const supplierDeliveryFormSummary = useMemo(
        () => supplierDeliveryFormLines.reduce((sum, line) => ({
            lineCount: sum.lineCount + 1,
            totalQuantity: sum.totalQuantity + Number(line.quantity || 0),
        }), { lineCount: 0, totalQuantity: 0 }),
        [supplierDeliveryFormLines],
    );
    const statementsByDeliveryNoteId = useMemo(() => {
        const map = new Map<string, SupplierDeliveryStatement[]>();
        supplierDeliveryStatements.forEach(statement => {
            const ids = Array.isArray(statement.metadata?.deliveryNoteIds) ? statement.metadata?.deliveryNoteIds : [];
            ids.forEach((id: string) => map.set(id, [...(map.get(id) || []), statement]));
        });
        return map;
    }, [supplierDeliveryStatements]);
    const poVatRateCalc = normalizeVatRate(pVatRate);
    const poVatAmountCalc = calculateVatAmount(poTotalCalc, poVatRateCalc);
    const poPaymentTotalCalc = poTotalCalc + poVatAmountCalc;
    const submittingPoDisplayAmount = useMemo(() => (
        submittingPo
            ? getPurchaseOrderDisplayAmount(submittingPo, poDeliveryBatchesByPo[submittingPo.id] || [])
            : 0
    ), [poDeliveryBatchesByPo, submittingPo]);
    const submittingPoVatRate = normalizeVatRate(submittingPo?.vatRate);
    const submittingPoVatAmount = calculateVatAmount(submittingPoDisplayAmount, submittingPoVatRate);
    const poHasRequestLines = useMemo(() => pItems.some(item => !!item.requestId), [pItems]);
    const procurementGroupCounts = useMemo(() => pos.reduce<Record<string, number>>((acc, po) => {
        if (po.procurementGroupId) acc[po.procurementGroupId] = (acc[po.procurementGroupId] || 0) + 1;
        return acc;
    }, {}), [pos]);
    const filteredPos = useMemo(() => {
        let result = [...pos];

        if (poStatusFilter !== 'all') {
            result = result.filter(po => po.status === poStatusFilter);
        }

        if (poSourceFilter !== 'all') {
            result = result.filter(po => po.sourceMode === poSourceFilter);
        }

        if (poSearch.trim() !== '') {
            const query = poSearch.toLowerCase().trim();
            result = result.filter(po => {
                const poNum = (po.poNumber || '').toLowerCase();
                const vendor = (po.vendorName || '').toLowerCase();
                const itemsMatch = po.items?.some(item =>
                    (item.name || '').toLowerCase().includes(query) ||
                    (item.sku || '').toLowerCase().includes(query)
                ) || false;
                return poNum.includes(query) || vendor.includes(query) || itemsMatch;
            });
        }

        return result;
    }, [pos, poStatusFilter, poSourceFilter, poSearch]);

    const sortedPos = useMemo(
        () => [...filteredPos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        [filteredPos],
    );
    const poPageCount = Math.max(1, Math.ceil(sortedPos.length / PO_PAGE_SIZE));
    const pagedPos = useMemo(
        () => sortedPos.slice((poPage - 1) * PO_PAGE_SIZE, poPage * PO_PAGE_SIZE),
        [poPage, sortedPos],
    );
    const poPageStart = sortedPos.length === 0 ? 0 : (poPage - 1) * PO_PAGE_SIZE + 1;
    const poPageEnd = Math.min(sortedPos.length, (poPage - 1) * PO_PAGE_SIZE + pagedPos.length);
    const selectedPo = useMemo(
        () => selectedPoId ? pos.find(po => po.id === selectedPoId) || null : null,
        [pos, selectedPoId],
    );

    const loadPoPayableDocuments = useCallback(async (po: PurchaseOrder) => {
        setLoadingPoPayableId(po.id);
        setPoPayableErrorsByPoId(prev => ({ ...prev, [po.id]: null }));
        try {
            const documents = await supplierPayableService.listDocuments({
                projectId: po.projectId || projectId || null,
                constructionSiteId: po.constructionSiteId || constructionSiteId || null,
                sourceType: 'purchase_order',
                sourceId: po.id,
            });
            setPoPayableDocumentsByPoId(prev => ({ ...prev, [po.id]: documents }));
            return documents;
        } catch (error: any) {
            logApiError('supplyChain.loadPoPayableDocuments', error);
            const message = getApiErrorMessage(error, 'Không thể tải chứng từ công nợ NCC.');
            setPoPayableErrorsByPoId(prev => ({ ...prev, [po.id]: message }));
            return [];
        } finally {
            setLoadingPoPayableId(current => current === po.id ? null : current);
        }
    }, [constructionSiteId, projectId]);

    useEffect(() => {
        if (!selectedPo) return;
        void loadPoPayableDocuments(selectedPo);
    }, [loadPoPayableDocuments, selectedPo]);

    useEffect(() => {
        if (!deepLinkPoId) {
            lastDeepLinkPoIdRef.current = null;
            return;
        }
        if (lastDeepLinkPoIdRef.current === deepLinkPoId) return;
        const targetIndex = sortedPos.findIndex(po => po.id === deepLinkPoId);
        if (targetIndex < 0) return;
        const targetPo = sortedPos[targetIndex];
        lastDeepLinkPoIdRef.current = deepLinkPoId;
        setPoPage(Math.floor(targetIndex / PO_PAGE_SIZE) + 1);
        setSelectedPoId(deepLinkPoId);
        setPoPrintMenuId(null);
        void loadPoDeliveryPrintGroups(targetPo);
    }, [deepLinkPoId, sortedPos]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const directPurchaseId = params.get('siteDirectPurchaseId');
        if (!directPurchaseId) {
            lastDeepLinkDirectPurchaseIdRef.current = null;
            return;
        }
        if (lastDeepLinkDirectPurchaseIdRef.current === directPurchaseId) return;
        const target = directPurchases.find(purchase => purchase.id === directPurchaseId);
        if (!target) return;
        lastDeepLinkDirectPurchaseIdRef.current = directPurchaseId;
        setSubTab('direct');
        void openDirectPurchaseDetail(target);
    }, [directPurchases]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('supplierDeliveryStatementId') || params.get('supplierContractId')) {
            setSubTab('direct');
        }
    }, [supplierDeliveryStatements]);

    useEffect(() => {
        if (deepLinkPoId) return;
        setPoPage(1);
    }, [constructionSiteId, deepLinkPoId, projectId, sortedPos.length]);

    useEffect(() => {
        if (poPage > poPageCount) setPoPage(poPageCount);
    }, [poPage, poPageCount]);

    useEffect(() => {
        pagedPos.forEach(po => {
            if (!PO_DELIVERY_PRINT_AUTOLOAD_STATUSES.has(po.status)) return;
            if (poDeliveryPrintGroupsByPoId[po.id]) return;
            if (poDeliveryPrintAutoLoadRef.current.has(po.id)) return;
            poDeliveryPrintAutoLoadRef.current.add(po.id);
            void loadPoDeliveryPrintGroups(po);
        });
    }, [pagedPos, poDeliveryPrintGroupsByPoId]);

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
            <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-1 shadow-sm">
                <button
                    type="button"
                    onClick={() => setSubTab('po')}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-xs font-black transition ${subTab === 'po' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900'}`}
                >
                    <FileText size={14} /> Đơn đặt hàng (PO)
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${subTab === 'po' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>{pos.length}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setSubTab('direct')}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-xs font-black transition ${subTab === 'direct' ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900'}`}
                >
                    <Package size={14} /> Mua nóng / CCDC
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${subTab === 'direct' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>{directPurchases.length + supplierDeliveryNotes.length + smallToolRecords.length}</span>
                </button>
            </div>
            {/* KPI */}
            {subTab === 'po' && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                        {
                            key: 'all',
                            label: 'Tổng đơn',
                            value: stats.totalPo,
                            icon: <ShoppingCart size={14} />,
                            tone: 'text-slate-800 dark:text-slate-100',
                            sub: `Tổng: ${fmt(stats.totalValue)} đ`
                        },
                        {
                            key: 'in_transit',
                            label: 'Đang giao',
                            value: stats.inTransit,
                            icon: <Clock size={14} />,
                            tone: 'text-amber-600 dark:text-amber-400',
                            sub: 'Đơn hàng đang vận chuyển'
                        },
                        {
                            key: 'delivered',
                            label: 'Đã giao',
                            value: stats.delivered,
                            icon: <Truck size={14} />,
                            tone: 'text-emerald-600 dark:text-emerald-400',
                            sub: 'Đơn hàng đã hoàn thành'
                        },
                        {
                            key: 'partial',
                            label: 'Giao 1 phần',
                            value: stats.partial,
                            icon: <Package size={14} />,
                            tone: 'text-indigo-650 dark:text-indigo-400',
                            sub: 'Giao nhận một phần'
                        },
                    ].map(metric => {
                        const isActive = poStatusFilter === metric.key;
                        if (metric.key === 'all') {
                            return (
                                <div
                                    key={metric.key}
                                    className="text-left rounded-xl border border-border bg-card p-4 shadow-sm"
                                >
                                    <div className="mb-2 flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                                {metric.icon}
                                            </span>
                                            {metric.label}
                                        </div>
                                    </div>
                                    <div className={`text-2xl font-black ${metric.tone}`}>{metric.value}</div>
                                    {metric.sub && <div className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">{metric.sub}</div>}
                                </div>
                            );
                        }
                        return (
                            <button
                                key={metric.key}
                                type="button"
                                onClick={() => {
                                    setPoStatusFilter(prev => prev === metric.key ? 'all' : metric.key);
                                }}
                                className="text-left rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:scale-[1.01] hover:shadow-md cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-900/30"
                            >
                                <div className="mb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                            {metric.icon}
                                        </span>
                                        {metric.label}
                                    </div>
                                </div>
                                <div className={`text-2xl font-black ${metric.tone}`}>{metric.value}</div>
                                {metric.sub && <div className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">{metric.sub}</div>}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Vendor Tab */}
            {subTab === 'vendor' && (
                <div className="bg-card rounded-2xl border border-border shadow-sm overflow-visible">
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

            {subTab === 'direct' && (
            <div className="space-y-6">
            {effectiveDirectPurchaseCapabilities.canViewDirectPurchase && (
            <div className={procurementPanelClass}>
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
                            <Package size={16} className="text-orange-500" /> Mua nóng công trường
                        </h3>
                        <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">Phiếu mua trực tiếp tại công trường, nối WMS/AP nhưng không thay thế PO chuẩn.</p>
                    </div>
                    {effectiveDirectPurchaseCapabilities.canCreateDirectPurchase && (
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => openCreateDirectPurchase('planned')}
                                className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-[10px] font-black text-orange-700 transition hover:bg-orange-100 active:scale-[0.98]"
                            >
                                <Send size={12} /> Đề xuất mua nóng
                            </button>
                            <button
                                type="button"
                                onClick={() => openCreateDirectPurchase('immediate')}
                                className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[10px] font-black text-rose-700 transition hover:bg-rose-100 active:scale-[0.98]"
                            >
                                <Plus size={12} /> Mua ngay
                            </button>
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/20 lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Tổng phiếu</div>
                        <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">{directPurchaseStats.total}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Giá trị</div>
                        <div className="mt-1 text-lg font-black text-orange-700">{fmtMoney(directPurchaseStats.totalValue)} đ</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Cần WMS/AP</div>
                        <div className="mt-1 text-lg font-black text-amber-700">{directPurchaseStats.pendingWms}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Sẵn sàng review</div>
                        <div className="mt-1 text-lg font-black text-emerald-700">{directPurchaseStats.payableReady}</div>
                    </div>
                </div>
                {loadingDirectPurchases ? (
                    <div className="flex items-center justify-center gap-2 p-8 text-sm font-bold text-slate-400">
                        <Loader2 size={16} className="animate-spin text-orange-500" /> Đang tải phiếu mua nóng...
                    </div>
                ) : sortedDirectPurchases.length === 0 ? (
                    <div className="p-4">
                        <EmptyState icon={<Package size={18} />} title="Chưa có phiếu mua nóng" message="Tạo phiếu mua nóng khi công trường cần mua trực tiếp ngoài luồng PO chuẩn." compact />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-left text-xs">
                            <thead className={procurementTableHeadClass}>
                                <tr>
                                    <th className="px-4 py-3">Phiếu</th>
                                    <th className="px-4 py-3">NCC / Nguồn tiền</th>
                                    <th className="px-4 py-3 text-right">Giá trị</th>
                                    <th className="px-4 py-3">WMS</th>
                                    <th className="px-4 py-3">AP</th>
                                    <th className="px-4 py-3 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                {sortedDirectPurchases.map(purchase => {
                                    const statusCfg = DIRECT_PURCHASE_STATUS[purchase.status] || DIRECT_PURCHASE_STATUS.draft;
                                    const modeCfg = DIRECT_PURCHASE_MODE[purchase.purchaseMode];
                                    const wmsTx = purchase.wmsTransactionId ? transactions.find(tx => tx.id === purchase.wmsTransactionId) : null;
                                    const isLoadingAction = directActionLoading?.endsWith(`:${purchase.id}`);
                                    return (
                                        <tr key={purchase.id} className="hover:bg-orange-50/40 dark:hover:bg-slate-900/50">
                                            <td className="px-4 py-3">
                                                <button type="button" onClick={() => openDirectPurchaseDetail(purchase)} className="font-mono text-xs font-black text-slate-900 hover:text-orange-700 dark:text-white">
                                                    {purchase.code}
                                                </button>
                                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${modeCfg.tone}`}>{modeCfg.label}</span>
                                                    <StatusBadge status={purchase.status} label={statusCfg.label} tone={statusCfg.tone} showDot={false} />
                                                </div>
                                                <div className="mt-1 text-[10px] font-bold text-slate-400">{purchase.purchaseDate || purchase.createdAt?.slice(0, 10) || '—'}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-black text-slate-700 dark:text-slate-200">{purchase.supplierNameSnapshot}</div>
                                                <div className="mt-1 text-[10px] font-bold text-slate-400">{DIRECT_PURCHASE_PAYMENT_SOURCE[purchase.paymentSource]}</div>
                                                {['site_cash', 'staff_paid'].includes(purchase.paymentSource) && (
                                                    <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black ${
                                                        purchase.siteCashSettlementId
                                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                            : 'border-amber-200 bg-amber-50 text-amber-700'
                                                    }`}>
                                                        {purchase.siteCashSettlementId ? 'Đã vào hoàn ứng' : 'Chờ hoàn ứng'}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right font-black text-orange-700 whitespace-nowrap">{fmtMoney(purchase.totalAmount)} đ</td>
                                            <td className="px-4 py-3">
                                                {purchase.wmsTransactionId ? (
                                                    <button type="button" onClick={() => openDirectPurchaseWmsTransaction(purchase)} className="font-mono text-[10px] font-black text-blue-700 hover:underline">
                                                        {purchase.wmsTransactionId.slice(-10)} {wmsTx?.status ? `• ${wmsTx.status}` : ''}
                                                    </button>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-slate-400">Chưa tạo</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {purchase.status === 'reconciled' || purchase.status === 'closed' ? (
                                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">Đã ghi AP</span>
                                                ) : (
                                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Chưa ghi AP</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex flex-wrap justify-end gap-1">
                                                    <button type="button" onClick={() => openDirectPurchaseDetail(purchase)} className="rounded-md px-2 py-1 text-[10px] font-black text-orange-700 hover:bg-orange-50">
                                                        <FileText size={11} className="inline" /> Chi tiết
                                                    </button>
                                                    {effectiveDirectPurchaseCapabilities.canEditDirectPurchase && canEditDirectPurchaseDocument(purchase) && (
                                                        <button type="button" onClick={() => openEditDirectPurchase(purchase)} disabled={isLoadingAction} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                                                            {isLoadingAction ? <Loader2 size={11} className="inline animate-spin" /> : <Edit2 size={11} className="inline" />} Sửa
                                                        </button>
                                                    )}
                                                    {effectiveDirectPurchaseCapabilities.canDeleteDirectPurchase && canDeleteDirectPurchaseDocument(purchase) && (
                                                        <button type="button" onClick={() => void deleteDirectPurchase(purchase)} disabled={isLoadingAction} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50 disabled:opacity-50">
                                                            {isLoadingAction ? <Loader2 size={11} className="inline animate-spin" /> : <Trash2 size={11} className="inline" />} Xóa
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            )}

            {effectiveSupplierDeliveryCapabilities.canViewSupplierDelivery && (
            <div className={procurementPanelClass}>
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
                            <Truck size={16} className="text-blue-500" /> Gọi hàng HĐ NCC
                        </h3>
                        <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">Cát, đá, xi măng, bê tông giao tới công trường dùng ngay: không PO, có thể không qua kho hoặc nhập-xuất thẳng WMS, AP vẫn từ bảng đối soát HĐ NCC.</p>
                    </div>
                    {effectiveSupplierDeliveryCapabilities.canCreateSupplierDelivery && (
                        <button
                            type="button"
                            onClick={openCreateSupplierDelivery}
                            className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-black text-blue-700 transition hover:bg-blue-100 active:scale-[0.98]"
                        >
                            <Plus size={12} /> Tạo phiếu giao HĐ
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/20 lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">HĐ NCC</div>
                        <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">{supplierContracts.length}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Phiếu giao</div>
                        <div className="mt-1 text-lg font-black text-blue-700">{supplierDeliveryNotes.length}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Đã đối soát</div>
                        <div className="mt-1 text-lg font-black text-emerald-700">{supplierDeliveryStatements.filter(item => item.status === 'posted').length}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Chờ đối soát</div>
                        <div className="mt-1 text-lg font-black text-blue-700">{supplierDeliveryNotes.filter(note => note.status === 'accepted').length}</div>
                    </div>
                </div>
                {supplierDeliveryNotes.length === 0 ? (
                    <div className="p-4">
                        <EmptyState icon={<Truck size={18} />} title="Chưa có phiếu giao theo HĐ" message="Chọn HĐ NCC đã khai trong module HD, nhập phiếu giao từng chuyến và đối soát cuối kỳ để sinh AP." compact />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1080px] text-left text-xs">
                            <thead className={procurementTableHeadClass}>
                                <tr>
                                    <th className="px-4 py-3">Phiếu giao</th>
                                    <th className="px-4 py-3">HĐ / NCC</th>
                                    <th className="px-4 py-3">Phiếu NCC</th>
                                    <th className="px-4 py-3 text-right">Số dòng</th>
                                    <th className="px-4 py-3">Đối soát/AP</th>
                                    <th className="px-4 py-3 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                {[...supplierDeliveryNotes]
                                    .sort((a, b) => String(b.deliveryDate || '').localeCompare(String(a.deliveryDate || '')))
                                    .map(note => {
                                        const statusCfg = SUPPLIER_DIRECT_DELIVERY_STATUS[note.status] || SUPPLIER_DIRECT_DELIVERY_STATUS.draft;
                                        const statements = statementsByDeliveryNoteId.get(note.id) || [];
                                        const postedStatement = statements.find(statement => statement.status === 'posted');
                                        const isBusy = supplierDeliveryActionLoading?.endsWith(`:${note.id}`);
                                        const noteLines = supplierDeliveryLinesByNoteId[note.id] || note.lines || [];
                                        const wmsSummary = getSupplierDeliveryWmsSummary(noteLines);
                                        const canCreateWmsImport = effectiveSupplierDeliveryCapabilities.canRecordSupplierDelivery
                                            && !postedStatement
                                            && (note.status === 'accepted' || note.status === 'statemented')
                                            && wmsSummary.canCreateImport;
                                        const canUnrecordNote = effectiveSupplierDeliveryCapabilities.canUnrecordSupplierDelivery
                                            && !postedStatement
                                            && note.status === 'accepted'
                                            && noteLines.every(line => !line.statementId && !line.wmsImportTransactionId && !line.wmsExportTransactionId);
                                        const statementBlockedByWms = wmsSummary.hasDirectLines && !wmsSummary.readyForStatement;
                                        return (
                                            <tr key={note.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-900/50">
                                                <td className="px-4 py-3">
                                                    <div className="font-mono text-xs font-black text-slate-900 dark:text-white">{note.code}</div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-1">
                                                        <StatusBadge status={note.status} label={statusCfg.label} tone={statusCfg.tone} showDot={false} />
                                                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${wmsSummary.badge}`}>{wmsSummary.label}</span>
                                                        {note.vehicleNo && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[9px] font-black text-slate-500">{note.vehicleNo}</span>}
                                                    </div>
                                                    <div className="mt-1 text-[10px] font-bold text-slate-400">{note.deliveryDate}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-mono text-[10px] font-black text-blue-700">{note.supplierContractCode || note.supplierContractId}</div>
                                                    <div className="mt-1 font-black text-slate-700 dark:text-slate-200">{note.supplierNameSnapshot}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-black text-slate-700 dark:text-slate-200">{note.deliveryTicketNo}</div>
                                                    <div className="mt-1 text-[10px] font-bold text-slate-400">{note.note || 'Không bắt buộc lý do cấp'}</div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-black text-blue-700 whitespace-nowrap">{noteLines.length || note.lines?.length || 0} dòng</td>
                                                <td className="px-4 py-3">
                                                    {postedStatement ? (
                                                        <div>
                                                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">Đã ghi AP</span>
                                                            <div className="mt-1 font-mono text-[10px] font-black text-emerald-700">{postedStatement.code}</div>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Chưa đối soát</span>
                                                            {statementBlockedByWms && (
                                                                <div className="mt-1 text-[10px] font-bold text-orange-600">Khóa AP đến khi WMS xuất dùng hoàn tất.</div>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex flex-wrap justify-end gap-1">
                                                        <button type="button" onClick={() => void openSupplierDeliveryDetail(note)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                                                            <FileText size={11} className="inline" /> Chi tiết
                                                        </button>
                                                        <button type="button" onClick={() => openDocumentTrace(buildDocumentTracePath('supplier_direct_delivery_note', note.id, note.qrToken))} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                                                            <QrCode size={11} className="inline" /> Truy vết
                                                        </button>
                                                        {effectiveSupplierDeliveryCapabilities.canEditSupplierDelivery && ['draft', 'cancelled'].includes(note.status) && (
                                                            <button type="button" onClick={() => void openEditSupplierDelivery(note)} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                                                                {isBusy ? <Loader2 size={11} className="inline animate-spin" /> : <Edit2 size={11} className="inline" />} Sửa
                                                            </button>
                                                        )}
                                                        {effectiveSupplierDeliveryCapabilities.canRecordSupplierDelivery && note.status !== 'accepted' && note.status !== 'statemented' && (
                                                            <button type="button" onClick={() => void recordSupplierDeliveryNote(note)} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                                                                {isBusy ? <Loader2 size={11} className="inline animate-spin" /> : <CheckCircle2 size={11} className="inline" />} Ghi
                                                            </button>
                                                        )}
                                                        {canUnrecordNote && (
                                                            <button type="button" onClick={() => void unrecordSupplierDeliveryNote(note)} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                                                                {isBusy ? <Loader2 size={11} className="inline animate-spin" /> : <RefreshCcw size={11} className="inline" />} Bỏ ghi
                                                            </button>
                                                        )}
                                                        {effectiveSupplierDeliveryCapabilities.canDeleteSupplierDelivery && ['draft', 'cancelled'].includes(note.status) && (
                                                            <button type="button" onClick={() => void deleteSupplierDeliveryNote(note)} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50 disabled:opacity-50">
                                                                {isBusy ? <Loader2 size={11} className="inline animate-spin" /> : <Trash2 size={11} className="inline" />} Xóa
                                                            </button>
                                                        )}
                                                        {canCreateWmsImport && (
                                                            <button type="button" onClick={() => void createSupplierDeliveryWmsImportDraft(note)} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                                                                {isBusy ? <Loader2 size={11} className="inline animate-spin" /> : <Truck size={11} className="inline" />} Tạo WMS nhập
                                                            </button>
                                                        )}
                                                        {wmsSummary.importTransactionIds.map((transactionId, index) => (
                                                            <button key={`import-${transactionId}`} type="button" onClick={() => openWmsTransactionById(transactionId)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                                                                <ExternalLink size={11} className="inline" /> Nhập {index + 1}
                                                            </button>
                                                        ))}
                                                        {wmsSummary.exportTransactionIds.map((transactionId, index) => (
                                                            <button key={`export-${transactionId}`} type="button" onClick={() => openWmsTransactionById(transactionId)} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                                                                <ExternalLink size={11} className="inline" /> Xuất {index + 1}
                                                            </button>
                                                        ))}
                                                        {effectiveSupplierDeliveryCapabilities.canReconcileSupplierDelivery && !postedStatement && (note.status === 'accepted' || note.status === 'statemented') && (
                                                            <button type="button" onClick={() => void openSupplierDeliveryStatementPricing(note)} disabled={isBusy || statementBlockedByWms} title={statementBlockedByWms ? 'Còn dòng nhập-xuất thẳng chưa WMS export COMPLETED.' : 'Tạo đối soát HĐ NCC và ghi AP'} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">
                                                                {isBusy ? <Loader2 size={11} className="inline animate-spin" /> : <FileText size={11} className="inline" />} Đối soát/AP
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                )}
                {supplierDeliveryStatements.length > 0 && (
                    <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                        <div className="mb-3 text-xs font-black uppercase text-slate-400">Bảng đối soát HĐ NCC gần đây</div>
                        <div className="grid gap-2 lg:grid-cols-2">
                            {[...supplierDeliveryStatements].slice(0, 4).map(statement => {
                                const cfg = SUPPLIER_DELIVERY_STATEMENT_STATUS[statement.status] || SUPPLIER_DELIVERY_STATEMENT_STATUS.draft;
                                return (
                                    <div key={statement.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="font-mono text-[10px] font-black text-blue-700">{statement.code}</div>
                                                <div className="mt-1 text-xs font-black text-slate-700 dark:text-slate-200">{statement.supplierContractCode || statement.supplierContractId} • {statement.supplierNameSnapshot}</div>
                                            </div>
                                            <StatusBadge status={statement.status} label={cfg.label} tone={cfg.tone} showDot={false} />
                                        </div>
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <button type="button" onClick={() => openDocumentTrace(buildDocumentTracePath('supplier_delivery_statement', statement.id, statement.qrToken))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30">
                                                <QrCode size={11} /> Truy vết
                                            </button>
                                            <div className="text-right text-sm font-black text-blue-700">{fmtMoney(statement.totalAmount)} đ</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
            )}

            <div className={procurementPanelClass}>
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
                            <Wrench size={16} className="text-amber-500" /> CCDC nhỏ / Ngoài kho
                        </h3>
                        <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">Theo dõi vật tư vụn và dụng cụ nhỏ không nhập WMS nhưng cần biết đang ở đâu, ai giữ.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative">
                            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={smallToolSearch}
                                onChange={event => setSmallToolSearch(event.target.value)}
                                className={`${procurementInputClass} min-h-9 w-full pl-8 sm:w-72`}
                                placeholder="Tìm CCDC, người giữ, nguồn..."
                            />
                        </div>
                        <select
                            value={smallToolStatusFilter}
                            onChange={event => setSmallToolStatusFilter(event.target.value as SiteSmallToolStatus | 'all')}
                            className={`${procurementInputClass} min-h-9`}
                        >
                            {SMALL_TOOL_STATUS_OPTIONS.map(status => (
                                <option key={status} value={status}>{status === 'all' ? 'Tất cả trạng thái' : SMALL_TOOL_STATUS[status].label}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/20 lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Đang theo dõi</div>
                        <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">{smallToolStats.total}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Đang dùng</div>
                        <div className="mt-1 text-lg font-black text-emerald-700">{smallToolStats.inUse}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Hỏng / mất</div>
                        <div className="mt-1 text-lg font-black text-red-600">{smallToolStats.issueCount}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="text-[10px] font-black uppercase text-slate-400">Giá trị snapshot</div>
                        <div className="mt-1 text-lg font-black text-amber-700">{fmtMoney(smallToolStats.totalValue)} đ</div>
                    </div>
                </div>
                {loadingSmallTools ? (
                    <div className="flex items-center justify-center gap-2 p-8 text-sm font-bold text-slate-400">
                        <Loader2 size={16} className="animate-spin text-amber-500" /> Đang tải sổ CCDC nhỏ...
                    </div>
                ) : filteredSmallToolRecords.length === 0 ? (
                    <div className="p-4">
                        <EmptyState icon={<Wrench size={18} />} title="Chưa có CCDC ngoài kho" message="Dòng mua nóng loại CCDC nhỏ sau khi được duyệt và ghi AP sẽ xuất hiện tại đây." compact />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1040px] text-left text-xs">
                            <thead className={procurementTableHeadClass}>
                                <tr>
                                    <th className="px-4 py-3">CCDC</th>
                                    <th className="px-4 py-3">Người / vị trí giữ</th>
                                    <th className="px-4 py-3 text-right">SL</th>
                                    <th className="px-4 py-3 text-right">Giá trị</th>
                                    <th className="px-4 py-3">Nguồn</th>
                                    <th className="px-4 py-3">Trạng thái</th>
                                    <th className="px-4 py-3 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                {filteredSmallToolRecords.map(record => {
                                    const statusCfg = SMALL_TOOL_STATUS[record.status] || SMALL_TOOL_STATUS.stored;
                                    const isBusy = smallToolActionLoading?.endsWith(`:${record.id}`);
                                    return (
                                        <tr key={record.id} className="hover:bg-amber-50/40 dark:hover:bg-slate-900/50">
                                            <td className="px-4 py-3">
                                                <div className="font-mono text-[10px] font-black text-slate-400">{record.code}</div>
                                                <div className="mt-1 font-black text-slate-800 dark:text-slate-100">{record.itemNameSnapshot}</div>
                                                <div className="mt-1 text-[10px] font-bold text-slate-400">{record.category || 'CCDC nhỏ'} • {record.supplierNameSnapshot || 'NCC viết tay'}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-black text-slate-700 dark:text-slate-200">{record.holderNameSnapshot || 'Chưa rõ'}</div>
                                                <div className="mt-1 text-[10px] font-bold text-slate-400">{record.locationNote || 'Chưa cập nhật vị trí'}</div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-black text-slate-800 dark:text-slate-100 whitespace-nowrap">{fmtQty(record.quantity)} {record.unitSnapshot || ''}</td>
                                            <td className="px-4 py-3 text-right font-black text-amber-700 whitespace-nowrap">{fmtMoney(record.totalAmount)} đ</td>
                                            <td className="px-4 py-3">
                                                <button type="button" onClick={() => void openDirectPurchaseDetailById(record.sourceId)} className="inline-flex items-center gap-1 font-mono text-[10px] font-black text-orange-700 hover:underline">
                                                    <ExternalLink size={11} /> {record.sourceCode || record.sourceId.slice(0, 8)}
                                                </button>
                                                <div className="mt-1 text-[10px] font-bold text-slate-400">{record.purchaseDate || record.createdAt?.slice(0, 10) || '—'}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusCfg.badge}`}>{statusCfg.label}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex flex-wrap justify-end gap-1">
                                                    <button type="button" onClick={() => void updateSmallToolCustody(record)} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                                                        Bàn giao
                                                    </button>
                                                    {record.status !== 'stored' && (
                                                        <button type="button" onClick={() => void updateSmallToolStatus(record, 'stored')} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                                                            Lưu kho
                                                        </button>
                                                    )}
                                                    {record.status !== 'in_use' && (
                                                        <button type="button" onClick={() => void updateSmallToolStatus(record, 'in_use')} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                                                            Đang dùng
                                                        </button>
                                                    )}
                                                    <button type="button" onClick={() => void updateSmallToolStatus(record, 'damaged')} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-orange-700 hover:bg-orange-50 disabled:opacity-50">
                                                        Hỏng
                                                    </button>
                                                    <button type="button" onClick={() => void updateSmallToolStatus(record, 'lost')} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50 disabled:opacity-50">
                                                        Mất
                                                    </button>
                                                    <button type="button" onClick={() => void updateSmallToolStatus(record, 'disposed')} disabled={isBusy} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                                                        Thanh lý
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            </div>
            )}

            {/* PO Tab */}
            {subTab === 'po' && (
                <div className={procurementPanelClass}>
                    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
                                <FileText size={16} className="text-blue-500" /> Đơn đặt hàng (PO)
                            </h3>
                            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">Quản lý PO theo nhà cung cấp, đợt giao, in chứng từ và trạng thái kho.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button onClick={handleDownloadPoTemplate}
                                className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-100 active:scale-[0.98] dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <FileSpreadsheet size={12} /> Mẫu Excel
                            </button>
                            {effectivePoCapabilities.canCreatePo && (
                                <>
                                    <button onClick={openRequestPicker}
                                        disabled={scopedRequestLines.length === 0}
                                        className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-black text-amber-700 transition hover:bg-amber-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                                        <Package size={12} /> Tạo từ đề xuất
                                    </button>
                                    <button onClick={openCreatePo}
                                        disabled={partners.length === 0 || inventoryItems.length === 0 || warehouses.length === 0}
                                        className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-black text-blue-700 transition hover:bg-blue-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300">
                                        <Plus size={12} /> Tạo PO
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Filter bar */}
                    {partners.length > 0 && inventoryItems.length > 0 && warehouses.length > 0 && pos.length > 0 && (
                        <div className="px-4 py-3 bg-slate-50/40 dark:bg-slate-900/10 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-3 md:items-center justify-between">
                            {/* Search Box */}
                            <div className="relative flex-grow max-w-md">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                                    <Search size={14} />
                                </span>
                                <input
                                    type="text"
                                    value={poSearch}
                                    onChange={e => setPoSearch(e.target.value)}
                                    placeholder="Tìm theo số PO, nhà cung cấp, vật tư..."
                                    className="w-full pl-9 pr-8 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                />
                                {poSearch && (
                                    <button
                                        onClick={() => setPoSearch('')}
                                        className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-350"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>

                            {/* Dropdown Filters */}
                            <div className="flex flex-wrap items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">Trạng thái:</span>
                                    <select
                                        value={poStatusFilter}
                                        onChange={e => setPoStatusFilter(e.target.value)}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors cursor-pointer"
                                    >
                                        <option value="all">Tất cả</option>
                                        {Object.entries(PO_STATUS).map(([key, value]) => (
                                            <option key={key} value={key}>{value.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">Nguồn:</span>
                                    <select
                                        value={poSourceFilter}
                                        onChange={e => setPoSourceFilter(e.target.value)}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors cursor-pointer"
                                    >
                                        <option value="all">Tất cả</option>
                                        {Object.entries(PO_SOURCE_MODE).map(([key, value]) => (
                                            <option key={key} value={key}>{value.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {partners.length === 0 ? (
                        <div className="p-4">
                            <EmptyState icon={<AlertTriangle size={18} />} title="Cần có đối tác trước khi tạo PO" message="Tạo đối tác tại Hợp đồng - Đối tác để chọn nhà cung cấp cho đơn hàng." compact />
                        </div>
                    ) : inventoryItems.length === 0 || warehouses.length === 0 ? (
                        <div className="p-4">
                            <EmptyState icon={<AlertTriangle size={18} />} title="Thiếu danh mục vật tư hoặc kho nhận" message="Cần có vật tư WMS và kho nhận trước khi tạo PO." compact />
                        </div>
                    ) : pos.length === 0 ? (
                        <div className="p-4">
                            <EmptyState icon={<FileText size={18} />} title="Chưa có đơn hàng" message="Tạo PO thủ công hoặc tạo từ đề xuất công trường để bắt đầu theo dõi." />
                        </div>
                    ) : filteredPos.length === 0 ? (
                        <div className="p-8 text-center bg-white dark:bg-slate-950 rounded-b-2xl">
                            <div className="flex flex-col items-center justify-center gap-2">
                                <div className="p-3 rounded-full bg-slate-50 dark:bg-slate-900 text-slate-400">
                                    <FileText size={24} />
                                </div>
                                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-350">Không tìm thấy đơn hàng phù hợp</h4>
                                <p className="text-xs text-slate-400">Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc của bạn.</p>
                                {(poSearch || poStatusFilter !== 'all' || poSourceFilter !== 'all') && (
                                    <button
                                        onClick={() => {
                                            setPoSearch('');
                                            setPoStatusFilter('all');
                                            setPoSourceFilter('all');
                                        }}
                                        className="mt-2 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/20 dark:hover:bg-blue-900/20 dark:text-blue-400 text-xs font-bold transition-colors"
                                    >
                                        Đặt lại bộ lọc
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50 dark:divide-slate-700/40">
                            {pagedPos.map(po => {
                                const stCfg = PO_STATUS[po.status];
                                const sourceCfg = PO_SOURCE_MODE[po.sourceMode || 'proactive_project'];
                                const groupSize = po.procurementGroupId ? (procurementGroupCounts[po.procurementGroupId] || 0) : 0;
                                const supplierReturns = supplierReturnsByPo[po.id] || [];
                                const deliveryBatches = poDeliveryBatchesByPo[po.id] || [];
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
                                const receiptStats = getPurchaseOrderDemandStats(po, poRequestLinks, inventoryItems);
                                const deliveryPrintGroups = poDeliveryPrintGroupsByPoId[po.id] || [];
                                const fulfillmentBatchesForPo = deliveryPrintGroups.flatMap(group => group.batches);
                                const poWorkSummary = summarizePurchaseOrderWork(po, fulfillmentBatchesForPo, deliveryBatches);
                                const poEditBlockReason = getPurchaseOrderEditBlockReason(po, user, fulfillmentBatchesForPo, deliveryBatches, supplierReturns, effectivePoCapabilities);
                                const poRemovalBlockReason = getPurchaseOrderRemovalBlockReason(po, user, fulfillmentBatchesForPo, deliveryBatches, supplierReturns, effectivePoCapabilities);
                                const pendingSupplementalApproval = getPendingSupplementalApprovalForPo(po.id, deliveryBatches);
                                const canMutatePoDocument = canUserMutatePurchaseOrder(po, user, effectivePoCapabilities);
                                const poHasStockImpact = hasPoStockImpactHint(po, supplierReturns);
                                const isCompanyConsolidatedPo = po.sourceMode === 'company_consolidated';
                                const editBlockReason = isCompanyConsolidatedPo
                                    ? 'PO công ty cần sửa tại màn Mua hàng công ty.'
                                    : poEditBlockReason || (poHasStockImpact ? 'PO đã phát sinh nhập kho/hoàn kho nên không thể sửa.' : null);
                                const poListSummary = buildPurchaseOrderListSummary(po, scopedMaterialRequests);
                                const poUiPolicy = getPurchaseOrderUiPolicy({
                                    po,
                                    receiptStats,
                                    deliveryBatches,
                                    supplierReturnableQty,
                                    canManageTab: legacyPoCanManageTab,
                                    canCreatePo: effectivePoCapabilities.canCreatePo,
                                    canApprovePo: effectivePoCapabilities.canApprovePo,
                                    canReceivePo: effectivePoCapabilities.canReceivePo,
                                    canDeletePo: effectivePoCapabilities.canDeletePo,
                                    canManagePo: effectivePoCapabilities.canManagePo,
                                    canRunRestrictedPoActions,
                                    canMutatePoDocument,
                                    editBlockReason,
                                    removalBlockReason: poRemovalBlockReason,
                                    hasStockImpact: poHasStockImpact,
                                    isRejectedBeforeReceipt: poWorkSummary.isRejectedBeforeReceipt,
                                    groupSize,
                                    pendingSupplementalApprovalId: pendingSupplementalApproval?.id || null,
                                    supplementalOverAmount: pendingSupplementalApproval?.overAmount || 0,
                                });
                                const isPrintMenuOpen = poPrintMenuId === po.id;
                                const poVatRate = normalizeVatRate(po.vatRate);
                                const poDisplayAmount = getPurchaseOrderDisplayAmount(po, deliveryBatches);
                                const poVatAmount = calculateVatAmount(poDisplayAmount, poVatRate);
                                const poPaymentTotal = poDisplayAmount + poVatAmount;
                                const receiptProgressLabel = receiptStats.orderedQty > 0
                                    ? `${fmtQty(receiptStats.receivedQty)}/${fmtQty(receiptStats.orderedQty)}`
                                    : '0/0';
                                const receiptRemainingLabel = receiptStats.remainingQty > 0
                                    ? `Còn thiếu ${fmtQty(receiptStats.remainingQty)}`
                                    : 'Đủ nhu cầu';
                                return (
                                    <div key={po.id} className={isPrintMenuOpen ? 'relative z-50' : 'relative z-0'}>
                                        <div className="px-5 py-4 transition hover:bg-slate-50/50 dark:hover:bg-slate-900/30">
                                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                                                <div className="min-w-0">
                                                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                                        <span className="font-mono text-[11px] font-black uppercase tracking-wide text-slate-400">{po.poNumber}</span>
                                                        <StatusBadge status={po.status} label={stCfg.label} tone={PO_STATUS_TONE[po.status]} showDot={false} />
                                                        {poUiPolicy.alerts.map(alert => (
                                                            <span
                                                                key={alert.id}
                                                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${alert.tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300' : alert.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
                                                            >
                                                                {alert.label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <div className="truncate text-sm font-black text-slate-900 dark:text-slate-100">
                                                        {poListSummary.requestTitle}
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                                        <span>{sourceCfg.label}</span>
                                                        <span>{po.vendorName || poListSummary.materialSummary}</span>
                                                        {po.procurementGroupNo && <span>Nhóm {po.procurementGroupNo}{groupSize > 1 ? ` - ${groupSize} PO` : ''}</span>}
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                                        <span>MR/Vật tư: <strong className="text-slate-700 dark:text-slate-200">{poListSummary.materialSummary}</strong></span>
                                                        <span>Nhận: <strong className="text-emerald-700 dark:text-emerald-300">{receiptProgressLabel}</strong></span>
                                                        <span className={receiptStats.remainingQty > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>{receiptRemainingLabel}</span>
                                                        {po.expectedDeliveryDate && <span>Giao gần nhất: {new Date(po.expectedDeliveryDate).toLocaleDateString('vi-VN')}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between gap-3 lg:justify-end">
                                                    <div className="text-right">
                                                        <div className="text-sm font-black text-slate-900 dark:text-slate-100">{fmtMoney(poPaymentTotal)} đ</div>
                                                        <div className="text-[9px] font-bold text-slate-400">
                                                            Trước VAT: {fmtMoney(poDisplayAmount)} đ{poVatRate > 0 ? ` - VAT ${poVatRate.toLocaleString('vi-VN')}%` : ''}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => openPoDetail(po)}
                                                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
                                                    >
                                                        <FileText size={14} /> Xử lý
                                                    </button>
                                                    <div className="relative">
                                                        <button
                                                            type="button"
                                                            onClick={event => {
                                                                event.stopPropagation();
                                                                setPoPrintMenuId(prev => prev === po.id ? null : po.id);
                                                            }}
                                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                                                            title="Thao tác khác"
                                                        >
                                                            <MoreVertical size={16} />
                                                        </button>
                                                        {isPrintMenuOpen && (
                                                            <div onClick={event => event.stopPropagation()} className="absolute right-0 top-10 z-[100] w-64 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
                                                                {poUiPolicy.menuActions.map(action => (
                                                                    <button
                                                                        key={action.id}
                                                                        type="button"
                                                                        disabled={action.disabled}
                                                                        title={action.disabledReason || action.label}
                                                                        onClick={() => void runPoUiAction(po, action)}
                                                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black transition disabled:pointer-events-auto disabled:opacity-60 ${getPoMenuActionClass(action)}`}
                                                                    >
                                                                        {getPoActionIcon(action)} {action.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="flex flex-col gap-3 bg-slate-50/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-xs font-bold text-slate-500">
                                    Đang xem {poPageStart}-{poPageEnd} trên {sortedPos.length} PO
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setPoPage(prev => Math.max(1, prev - 1))}
                                        disabled={poPage <= 1}
                                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <ChevronLeft size={14} /> Trước
                                    </button>
                                    <span className="min-w-[82px] text-center text-xs font-black text-slate-500">
                                        {poPage}/{poPageCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setPoPage(prev => Math.min(poPageCount, prev + 1))}
                                        disabled={poPage >= poPageCount}
                                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Sau <ChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {selectedPo && (() => {
                const po = selectedPo;
                const stCfg = PO_STATUS[po.status];
                const sourceCfg = PO_SOURCE_MODE[po.sourceMode || 'proactive_project'];
                const targetWh = warehouses.find(w => w.id === po.targetWarehouseId);
                const groupSize = po.procurementGroupId ? (procurementGroupCounts[po.procurementGroupId] || 0) : 0;
                const supplierReturns = supplierReturnsByPo[po.id] || [];
                const deliveryBatches = poDeliveryBatchesByPo[po.id] || [];
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
                const receiptStats = getPurchaseOrderDemandStats(po, poRequestLinks, inventoryItems);
                const isCompanyConsolidatedPo = po.sourceMode === 'company_consolidated';
                const poListSummary = buildPurchaseOrderListSummary(po, scopedMaterialRequests);
                const deliveryPrintGroups = poDeliveryPrintGroupsByPoId[po.id] || [];
                const fulfillmentBatchesForPo = deliveryPrintGroups.flatMap(group => group.batches);
                const poWorkSummary = summarizePurchaseOrderWork(po, fulfillmentBatchesForPo, deliveryBatches);
                const poEditBlockReason = getPurchaseOrderEditBlockReason(po, user, fulfillmentBatchesForPo, deliveryBatches, supplierReturns, effectivePoCapabilities);
                const poRemovalBlockReason = getPurchaseOrderRemovalBlockReason(po, user, fulfillmentBatchesForPo, deliveryBatches, supplierReturns, effectivePoCapabilities);
                const pendingSupplementalApproval = getPendingSupplementalApprovalForPo(po.id, deliveryBatches);
                const canMutatePoDocument = canUserMutatePurchaseOrder(po, user, effectivePoCapabilities);
                const poHasStockImpact = hasPoStockImpactHint(po, supplierReturns);
                const editBlockReason = isCompanyConsolidatedPo
                    ? 'PO công ty cần sửa tại màn Mua hàng công ty.'
                    : poEditBlockReason || (poHasStockImpact ? 'PO đã phát sinh nhập kho/hoàn kho nên không thể sửa.' : null);
                const poVatRate = normalizeVatRate(po.vatRate);
                const poDisplayAmount = getPurchaseOrderDisplayAmount(po, deliveryBatches);
                const poVatAmount = calculateVatAmount(poDisplayAmount, poVatRate);
                const poPaymentTotal = poDisplayAmount + poVatAmount;
                const payableDocuments = poPayableDocumentsByPoId[po.id] || [];
                const supplierPayableStatus = payableDocuments[0]?.status || 'none';
                const recognizedPayableAmount = payableDocuments.length > 0
                    ? payableDocuments.reduce((sum, document) => sum + Number(document.recognizedAmount || 0), 0)
                    : po.items.reduce((sum, item) => {
                        const netReceivedQty = Math.max(0, Number(item.receivedQty || 0) - Number(item.returnedQty || 0));
                        return sum + netReceivedQty * Number(item.unitPrice || 0);
                    }, 0);
                const getWmsTransactionIdForBatch = (batch: PurchaseOrderDeliveryBatch) => {
                    const fulfillmentBatch = fulfillmentBatchesForPo.find(item => item.poDeliveryBatchId === batch.id || item.id === batch.fulfillmentBatchIds?.[0]);
                    return fulfillmentBatch?.transactionId || null;
                };
                const pendingWmsTransactionId = deliveryBatches
                    .filter(batch => batch.status === 'wms_pending')
                    .map(getWmsTransactionIdForBatch)
                    .find(Boolean) || null;
                const poUiPolicy = getPurchaseOrderUiPolicy({
                    po,
                    receiptStats,
                    deliveryBatches,
                    supplierReturnableQty,
                    canManageTab: legacyPoCanManageTab,
                    canCreatePo: effectivePoCapabilities.canCreatePo,
                    canApprovePo: effectivePoCapabilities.canApprovePo,
                    canReceivePo: effectivePoCapabilities.canReceivePo,
                    canDeletePo: effectivePoCapabilities.canDeletePo,
                    canManagePo: effectivePoCapabilities.canManagePo,
                    canRunRestrictedPoActions,
                    canMutatePoDocument,
                    editBlockReason,
                    removalBlockReason: poRemovalBlockReason,
                    hasStockImpact: poHasStockImpact,
                    isRejectedBeforeReceipt: poWorkSummary.isRejectedBeforeReceipt,
                    groupSize,
                    pendingWmsTransactionId,
                    pendingSupplementalApprovalId: pendingSupplementalApproval?.id || null,
                    supplementalOverAmount: pendingSupplementalApproval?.overAmount || 0,
                    recognizedPayableAmount,
                    supplierPayableStatus,
                });
                return (
                    <PurchaseOrderCockpitDrawer
                        po={po}
                        requestTitle={poListSummary.requestTitle}
                        materialSummary={poListSummary.materialSummary}
                        sourceLabel={sourceCfg.label}
                        targetWarehouseName={targetWh?.name || '—'}
                        groupLabel={po.procurementGroupNo ? `Nhóm ${po.procurementGroupNo}${groupSize > 1 ? ` • ${groupSize} PO` : ''}` : null}
                        statusLabel={stCfg.label}
                        statusTone={PO_STATUS_TONE[po.status]}
                        uiPolicy={poUiPolicy}
                        receiptStats={receiptStats}
                        displayAmount={poDisplayAmount}
                        vatRate={poVatRate}
                        vatAmount={poVatAmount}
                        paymentTotal={poPaymentTotal}
                        inventoryItems={inventoryItems}
                        warehouses={warehouses}
                        poRequestLinks={poRequestLinks}
                        deliveryBatches={deliveryBatches}
                        deliveryPrintGroups={deliveryPrintGroups}
                        supplierReturns={supplierReturns}
                        supplierPayableDocuments={payableDocuments}
                        supplierPayableLoading={loadingPoPayableId === po.id}
                        supplierPayableError={poPayableErrorsByPoId[po.id] || null}
                        supplierReturnableQty={supplierReturnableQty}
                        totalReceivedQty={totalReceivedQty}
                        completedReturnQty={completedReturnQty}
                        pendingReturnQty={pendingReturnQty}
                        canMutatePoDocument={canMutatePoDocument}
                        canReceivePo={effectivePoCapabilities.canReceivePo}
                        canDeletePo={effectivePoCapabilities.canDeletePo}
                        poHasStockImpact={poHasStockImpact}
                        creatingDeliveryBatchId={creatingDeliveryBatchId}
                        deletingDeliveryKey={deletingDeliveryKey}
                        printingPoId={printingPoId}
                        isLoadingDeliveryPrintGroups={loadingPoDeliveryPrintPoId === po.id}
                        getPrintGroupForBatch={batch => deliveryPrintGroups.find(group => group.scheduleBatch?.id === batch.id || group.key === batch.id) || buildPoDeliveryPrintGroupFromSchedule(po, batch)}
                        getWmsTransactionIdForBatch={getWmsTransactionIdForBatch}
                        onRunAction={action => void runPoUiAction(po, action)}
                        onPrintDeliveryGroup={(group, template) => handlePrintPoDeliveryGroup(po, group, template)}
                        onEditSchedule={() => openEditPo(po)}
                        onRemovePlannedBatch={batch => handleRemovePlannedDeliveryBatch(po, batch)}
                        onCreateDeliveryReceipt={batch => handleCreatePoDeliveryReceipt(po, batch)}
                        onRemoveFailedDeliveryBatch={batch => handleRemoveFailedDeliveryBatch(po, batch)}
                        onRemoveFailedDeliveryGroup={group => handleRemoveFailedDeliveryGroup(po, group)}
                        onClose={closePoDetail}
                    />
                );
            })()}

            {selectedDirectPurchase && (() => {
                const { purchase, lines } = selectedDirectPurchase;
                const statusCfg = DIRECT_PURCHASE_STATUS[purchase.status] || DIRECT_PURCHASE_STATUS.draft;
                const modeCfg = DIRECT_PURCHASE_MODE[purchase.purchaseMode];
                const targetWarehouse = warehouses.find(warehouse => warehouse.id === purchase.targetWarehouseId);
                const wmsTransaction = purchase.wmsTransactionId ? transactions.find(tx => tx.id === purchase.wmsTransactionId) : null;
                const hasStockLines = lines.some(line => line.lineType === 'stock_item' && line.status !== 'rejected');
                const hasAcceptedLines = lines.some(line => line.status === 'accepted' || line.status === 'adjusted');
                const wmsCompleted = !hasStockLines || String(wmsTransaction?.status || '').toLowerCase() === String(TransactionStatus.COMPLETED).toLowerCase() || String(wmsTransaction?.status || '').toLowerCase() === 'completed';
                const actionBusy = Boolean(directActionLoading?.endsWith(`:${purchase.id}`));
                return (
                    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/40" onClick={event => event.target === event.currentTarget && setSelectedDirectPurchase(null)}>
                        <div className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl dark:bg-slate-950">
                            <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${modeCfg.tone}`}>{modeCfg.label}</span>
                                            <StatusBadge status={purchase.status} label={statusCfg.label} tone={statusCfg.tone} showDot={false} />
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                                {DIRECT_PURCHASE_PAYMENT_SOURCE[purchase.paymentSource]}
                                            </span>
                                        </div>
                                        <h3 className="mt-2 font-mono text-base font-black text-slate-900 dark:text-white">{purchase.code}</h3>
                                        <p className="mt-0.5 text-xs font-bold text-slate-500">{purchase.supplierNameSnapshot} • {purchase.purchaseDate || 'Chưa có ngày mua'}</p>
                                    </div>
                                    <button type="button" onClick={() => setSelectedDirectPurchase(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-5 py-3 text-xs dark:border-slate-800 lg:grid-cols-4">
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">Tổng tiền</div>
                                    <div className="mt-1 font-black text-orange-700">{fmtMoney(purchase.totalAmount)} đ</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">Kho nhận</div>
                                    <div className="mt-1 font-black text-slate-800 dark:text-slate-100">{targetWarehouse?.name || 'Không nhập kho'}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">WMS</div>
                                    <div className="mt-1 font-black text-blue-700">{purchase.wmsTransactionId ? `${purchase.wmsTransactionId.slice(-10)} ${wmsTransaction?.status ? `• ${wmsTransaction.status}` : ''}` : 'Chưa tạo'}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">Hoá đơn</div>
                                    <div className="mt-1 font-black text-slate-800 dark:text-slate-100">{purchase.invoiceNumber || '—'}</div>
                                    {(purchase.attachments || []).slice(0, 3).map(att => (
                                        <a key={att.id || att.url} href={att.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-[10px] font-black text-orange-700 hover:underline">
                                            {att.fileType?.startsWith('image/') ? <ImageIcon size={10} /> : <ExternalLink size={10} />}
                                            <span className="truncate">{att.name || 'Mở chứng từ'}</span>
                                        </a>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                                {effectiveDirectPurchaseCapabilities.canEditDirectPurchase && purchase.status === 'draft' && (
                                    <button type="button" onClick={() => setSubmittingDirectPurchase(purchase)} disabled={actionBusy} title="Chọn đích danh người có quyền sửa/duyệt mua nóng." className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[10px] font-black text-orange-700 hover:bg-orange-100 disabled:opacity-50">
                                        <Send size={12} /> Gửi duyệt
                                    </button>
                                )}
                                {effectiveDirectPurchaseCapabilities.canEditDirectPurchase && purchase.status === 'submitted' && (
                                    <button type="button" onClick={() => updateDirectPurchaseStatus(purchase, 'approved_to_buy')} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                                        <CheckCircle2 size={12} /> Duyệt mua
                                    </button>
                                )}
                                {effectiveDirectPurchaseCapabilities.canEditDirectPurchase && purchase.status === 'approved_to_buy' && (
                                    <>
                                        <button type="button" onClick={() => updateDirectPurchaseStatus(purchase, 'purchased')} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                                            <Package size={12} /> Đã mua
                                        </button>
                                        <button type="button" onClick={() => void cancelDirectPurchaseApproval(purchase)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                            <RefreshCcw size={12} /> Hủy duyệt
                                        </button>
                                    </>
                                )}
                                {effectiveDirectPurchaseCapabilities.canEditDirectPurchase && hasStockLines && !purchase.wmsTransactionId && (
                                    <button type="button" onClick={() => createDirectPurchaseWmsDraft(purchase)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[10px] font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                                        <Truck size={12} /> Tạo WMS import
                                    </button>
                                )}
                                {purchase.wmsTransactionId && (
                                    <button type="button" onClick={() => openDirectPurchaseWmsTransaction(purchase)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                                        <ExternalLink size={12} /> Mở WMS
                                    </button>
                                )}
                                {effectiveDirectPurchaseCapabilities.canRecordDirectPurchaseAp && hasAcceptedLines && (
                                    <button type="button" onClick={() => syncDirectPurchasePayable(purchase)} disabled={actionBusy} title={!wmsCompleted ? 'Hệ thống sẽ kiểm tra WMS trước khi ghi AP.' : 'Ghi nhận AP mua nóng'} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                                        <FileText size={12} /> Ghi AP
                                    </button>
                                )}
                                {effectiveDirectPurchaseCapabilities.canDeleteDirectPurchase && canDeleteDirectPurchaseDocument(purchase) && (
                                    <button type="button" onClick={() => void deleteDirectPurchase(purchase)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black text-red-600 hover:bg-red-100 disabled:opacity-50">
                                        <Trash2 size={12} /> Xóa
                                    </button>
                                )}
                                {actionBusy && <span className="inline-flex items-center gap-1 px-2 text-[10px] font-bold text-slate-400"><Loader2 size={12} className="animate-spin" /> Đang xử lý</span>}
                            </div>
                            {purchase.status === 'submitted' && (
                                <div className="border-b border-orange-100 bg-orange-50 px-5 py-2 text-[11px] font-bold text-orange-800 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-200">
                                    <span className="inline-flex items-center gap-1"><Users size={12} /> Chờ duyệt mua:</span>{' '}
                                    <b>{purchase.submittedToName || purchase.submittedToUserId || 'chưa ghi người nhận trên dữ liệu cũ'}</b>
                                    {purchase.submissionNote ? <span> • {purchase.submissionNote}</span> : null}
                                </div>
                            )}
                            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-900/40">
                                <div className="space-y-2">
                                    {lines.map(line => {
                                        const amount = Number(line.lineAmount || 0) + Number(line.vatAmount || 0);
                                        const inventory = line.itemId ? inventoryItems.find(item => item.id === line.itemId) : null;
                                        const lineTypeMeta = DIRECT_PURCHASE_LINE_TYPE[line.lineType] || DIRECT_PURCHASE_LINE_TYPE.expense_only;
                                        return (
                                            <div key={line.id} className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${lineTypeMeta.badge}`}>
                                                                {lineTypeMeta.label}
                                                            </span>
                                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${line.status === 'accepted' || line.status === 'adjusted' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : line.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                                                {line.status === 'accepted' ? 'Đã ghi nhận' : line.status === 'adjusted' ? 'Điều chỉnh' : line.status === 'rejected' ? 'Từ chối' : 'Chờ ghi'}
                                                            </span>
                                                        </div>
                                                        <div className="mt-2 font-black text-slate-900 dark:text-white">{line.itemNameSnapshot || inventory?.name || line.itemId}</div>
                                                        <div className="mt-1 text-[10px] font-bold text-slate-400">
                                                            {line.skuSnapshot || inventory?.sku || '—'} • {fmtQty(line.quantity)} {line.unitSnapshot || inventory?.unit || ''} × {fmtMoney(line.unitPrice)} đ • VAT {Number(line.vatRate || 0).toLocaleString('vi-VN')}%
                                                        </div>
                                                        {line.lineType === 'small_tool' && (
                                                            <div className="mt-1 text-[10px] font-bold text-amber-700">
                                                                {line.smallToolCategory || 'CCDC nhỏ'} • {line.smallToolHolderNameSnapshot || 'Công trường'}{line.smallToolLocationNote ? ` • ${line.smallToolLocationNote}` : ''}
                                                            </div>
                                                        )}
                                                        {line.note && <div className="mt-1 text-[10px] font-bold text-slate-500">{line.note}</div>}
                                                    </div>
                                                    <div className="shrink-0 text-left lg:text-right">
                                                        <div className="text-sm font-black text-orange-700">{fmtMoney(amount)} đ</div>
                                                        {effectiveDirectPurchaseCapabilities.canRecordDirectPurchaseAp && (
                                                            <div className="mt-2 flex flex-wrap justify-start gap-1 lg:justify-end">
                                                                {line.status !== 'accepted' && (
                                                                    <button type="button" onClick={() => void reviewDirectPurchaseLine(line, 'accepted')} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                                                                        Duyệt dòng
                                                                    </button>
                                                                )}
                                                                {line.status !== 'rejected' && (
                                                                    <button type="button" onClick={() => void reviewDirectPurchaseLine(line, 'rejected')} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50">
                                                                        Từ chối
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {selectedSupplierDelivery && (() => {
                const { note, lines } = selectedSupplierDelivery;
                const statusCfg = SUPPLIER_DIRECT_DELIVERY_STATUS[note.status] || SUPPLIER_DIRECT_DELIVERY_STATUS.draft;
                const statements = statementsByDeliveryNoteId.get(note.id) || [];
                const postedStatement = statements.find(statement => statement.status === 'posted');
                const wmsSummary = getSupplierDeliveryWmsSummary(lines);
                const actionBusy = Boolean(supplierDeliveryActionLoading?.endsWith(`:${note.id}`));
                const canUnrecordNote = effectiveSupplierDeliveryCapabilities.canUnrecordSupplierDelivery
                    && !postedStatement
                    && note.status === 'accepted'
                    && lines.every(line => !line.statementId && !line.wmsImportTransactionId && !line.wmsExportTransactionId);
                const statementBlockedByWms = wmsSummary.hasDirectLines && !wmsSummary.readyForStatement;
                return (
                    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/40" onClick={event => event.target === event.currentTarget && setSelectedSupplierDelivery(null)}>
                        <div className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl dark:bg-slate-950">
                            <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusBadge status={note.status} label={statusCfg.label} tone={statusCfg.tone} showDot={false} />
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${wmsSummary.badge}`}>{wmsSummary.label}</span>
                                            {postedStatement && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">Đã ghi AP</span>}
                                        </div>
                                        <h3 className="mt-2 font-mono text-base font-black text-slate-900 dark:text-white">{note.code}</h3>
                                        <p className="mt-0.5 text-xs font-bold text-slate-500">{note.supplierNameSnapshot} • {note.deliveryTicketNo} • {note.deliveryDate}</p>
                                    </div>
                                    <button type="button" onClick={() => setSelectedSupplierDelivery(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-5 py-3 text-xs dark:border-slate-800 lg:grid-cols-4">
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">HĐ NCC</div>
                                    <div className="mt-1 font-mono font-black text-blue-700">{note.supplierContractCode || note.supplierContractId}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">Số dòng</div>
                                    <div className="mt-1 font-black text-slate-800 dark:text-slate-100">{lines.length}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">Tổng SL</div>
                                    <div className="mt-1 font-black text-slate-800 dark:text-slate-100">{fmtQty(lines.reduce((sum, line) => sum + Number(line.acceptedQuantity || line.quantity || 0), 0))}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-slate-400">Đối soát</div>
                                    <div className="mt-1 font-mono font-black text-emerald-700">{postedStatement?.code || 'Chưa ghi AP'}</div>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                                {effectiveSupplierDeliveryCapabilities.canEditSupplierDelivery && ['draft', 'cancelled'].includes(note.status) && (
                                    <button type="button" onClick={() => void openEditSupplierDelivery(note)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                                        <Edit2 size={12} /> Sửa
                                    </button>
                                )}
                                {effectiveSupplierDeliveryCapabilities.canRecordSupplierDelivery && note.status !== 'accepted' && note.status !== 'statemented' && (
                                    <button type="button" onClick={() => void recordSupplierDeliveryNote(note)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                                        <CheckCircle2 size={12} /> Ghi
                                    </button>
                                )}
                                {canUnrecordNote && (
                                    <button type="button" onClick={() => void unrecordSupplierDeliveryNote(note)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                        <RefreshCcw size={12} /> Bỏ ghi
                                    </button>
                                )}
                                {effectiveSupplierDeliveryCapabilities.canDeleteSupplierDelivery && ['draft', 'cancelled'].includes(note.status) && (
                                    <button type="button" onClick={() => void deleteSupplierDeliveryNote(note)} disabled={actionBusy} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black text-red-600 hover:bg-red-100 disabled:opacity-50">
                                        <Trash2 size={12} /> Xóa
                                    </button>
                                )}
                                {effectiveSupplierDeliveryCapabilities.canReconcileSupplierDelivery && !postedStatement && (note.status === 'accepted' || note.status === 'statemented') && (
                                    <button type="button" onClick={() => void openSupplierDeliveryStatementPricing(note)} disabled={actionBusy || statementBlockedByWms} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50">
                                        <FileText size={12} /> Đối soát/AP
                                    </button>
                                )}
                                <button type="button" onClick={() => openDocumentTrace(buildDocumentTracePath('supplier_direct_delivery_note', note.id, note.qrToken))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                    <QrCode size={12} /> Truy vết
                                </button>
                                {actionBusy && <span className="inline-flex items-center gap-1 px-2 text-[10px] font-bold text-slate-400"><Loader2 size={12} className="animate-spin" /> Đang xử lý</span>}
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-900/40">
                                <div className="space-y-2">
                                    {lines.map(line => {
                                        const flowMode = line.wmsFlowMode || 'none';
                                        const flowMeta = SUPPLIER_DELIVERY_WMS_FLOW_MODE[flowMode];
                                        const wmsStatus = line.wmsStatus || 'not_required';
                                        const wmsMeta = SUPPLIER_DELIVERY_WMS_STATUS[wmsStatus];
                                        return (
                                            <div key={line.id} className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${flowMeta.badge}`}>{flowMeta.label}</span>
                                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${wmsMeta.badge}`}>{wmsMeta.label}</span>
                                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${line.status === 'accepted' || line.status === 'adjusted' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : line.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                                                {line.status === 'accepted' ? 'Đã ghi' : line.status === 'adjusted' ? 'Điều chỉnh' : line.status === 'rejected' ? 'Từ chối' : 'Chưa ghi'}
                                                            </span>
                                                        </div>
                                                        <div className="mt-2 font-black text-slate-900 dark:text-white">{line.itemNameSnapshot}</div>
                                                        <div className="mt-1 text-[10px] font-bold text-slate-400">
                                                            {line.skuSnapshot || line.itemId || '—'} • SL {fmtQty(line.acceptedQuantity || line.quantity)} {line.unitSnapshot || ''}{line.targetWarehouseId ? ` • Kho ${warehouses.find(warehouse => warehouse.id === line.targetWarehouseId)?.name || line.targetWarehouseId}` : ''}
                                                        </div>
                                                        {(line.issueReason || line.note) && <div className="mt-1 text-[10px] font-bold text-slate-500">{line.issueReason || line.note}</div>}
                                                    </div>
                                                    <div className="flex shrink-0 flex-wrap justify-start gap-1 lg:justify-end">
                                                        {line.wmsImportTransactionId && (
                                                            <button type="button" onClick={() => openWmsTransactionById(line.wmsImportTransactionId)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                                                                <ExternalLink size={11} className="inline" /> Nhập
                                                            </button>
                                                        )}
                                                        {line.wmsExportTransactionId && (
                                                            <button type="button" onClick={() => openWmsTransactionById(line.wmsExportTransactionId)} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                                                                <ExternalLink size={11} className="inline" /> Xuất
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showSupplierDeliveryForm && (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                            <div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">{editingSupplierDelivery ? 'Sửa phiếu giao HĐ NCC' : 'Tạo phiếu giao HĐ NCC'}</h3>
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Vật tư giao tới công trường dùng ngay, không PO; dòng cần trace kho có thể đi nhập-xuất thẳng WMS.</p>
                            </div>
                            <button onClick={() => setShowSupplierDeliveryForm(false)} disabled={savingSupplierDelivery} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <div className="md:col-span-2">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">HĐ Nhà cung cấp *</label>
                                    <select value={sdSupplierContractId} onChange={event => void selectSupplierDeliveryContract(event.target.value)} className={`${procurementInputClass} w-full`}>
                                        <option value="">Chọn HĐ NCC</option>
                                        {supplierContracts.map(contract => (
                                            <option key={contract.id} value={contract.id}>{contract.code} - {contract.name} - {contract.supplierName || 'NCC'}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mã phiếu</label>
                                    <input value={sdCode} onChange={event => setSdCode(event.target.value)} className={`${procurementInputClass} w-full`} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ngày giao</label>
                                    <input type="date" value={sdDeliveryDate} onChange={event => setSdDeliveryDate(event.target.value)} className={`${procurementInputClass} w-full`} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Số phiếu NCC *</label>
                                    <input value={sdDeliveryTicketNo} onChange={event => setSdDeliveryTicketNo(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="BBG/PN/No..." />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Xe/chuyến</label>
                                    <input value={sdVehicleNo} onChange={event => setSdVehicleNo(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="Biển số / mã chuyến" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Lý do cấp / ghi chú</label>
                                    <input value={sdNote} onChange={event => setSdNote(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="Không bắt buộc" />
                                </div>
                            </div>

                            {selectedSupplierDeliveryContract && (
                                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs dark:border-blue-900/40 dark:bg-blue-950/20">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="font-black text-blue-800 dark:text-blue-200">{selectedSupplierDeliveryContract.code} - {selectedSupplierDeliveryContract.name}</div>
                                            <div className="mt-1 font-bold text-blue-600 dark:text-blue-300">{selectedSupplierDeliveryContract.supplierName || 'Nhà cung cấp'}</div>
                                        </div>
                                        <div className="font-black text-blue-700">{supplierContractLines.length} dòng HĐ</div>
                                    </div>
                                </div>
                            )}

                            <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                                <div className="flex flex-col gap-2 border-b border-slate-100 p-3 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
                                    <h4 className="text-xs font-black uppercase text-slate-500">Dòng giao nhận</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {supplierContractLines.length > 0 && (
                                            <select
                                                onChange={event => {
                                                    const contractLine = supplierContractLines.find(line => line.id === event.target.value);
                                                    if (contractLine) addSupplierDeliveryLine(contractLine);
                                                    event.currentTarget.value = '';
                                                }}
                                                className={`${procurementInputClass} min-h-8`}
                                                defaultValue=""
                                            >
                                                <option value="">Thêm từ đơn giá HĐ</option>
                                                {supplierContractLines.map(line => (
                                                    <option key={line.id} value={line.id}>{line.itemNameSnapshot} - {line.unitSnapshot || '-'}</option>
                                                ))}
                                            </select>
                                        )}
                                        <button type="button" onClick={() => addSupplierDeliveryLine(null)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                            <Plus size={12} /> Dòng tự do
                                        </button>
                                    </div>
                                </div>
                                <div className="grid gap-2 border-b border-slate-100 p-3 text-[11px] font-bold text-slate-600 dark:border-slate-800 dark:text-slate-300 md:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                                        <span className="font-black text-slate-800 dark:text-slate-100">Không qua kho:</span> không sinh phiếu WMS; sau khi duyệt thực nhận có thể đưa vào đối soát/AP.
                                    </div>
                                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-200">
                                        <span className="font-black">Nhập-xuất thẳng:</span> bắt buộc chọn mã WMS và kho; hệ thống tạo nhập WMS rồi xuất dùng, AP chỉ mở khi xuất hoàn tất.
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[980px] text-left text-xs">
                                        <thead className={procurementTableHeadClass}>
                                            <tr>
                                                <th className="px-3 py-2 w-40">Luồng kho</th>
                                                <th className="px-3 py-2">Vật tư</th>
                                                <th className="px-3 py-2 w-52">Kho</th>
                                                <th className="px-3 py-2 w-24 text-right">SL</th>
                                                <th className="px-3 py-2 w-24">ĐVT</th>
                                                <th className="px-3 py-2 w-14"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {sdLines.map(line => {
                                                const flowMode = line.wmsFlowMode || 'none';
                                                const flowMeta = SUPPLIER_DELIVERY_WMS_FLOW_MODE[flowMode];
                                                const isDirectInOut = flowMode === 'direct_in_out';
                                                return (
                                                    <tr key={line.id}>
                                                        <td className="px-3 py-2">
                                                            <select
                                                                value={flowMode}
                                                                onChange={event => {
                                                                    const nextMode = event.target.value as NonNullable<SupplierDirectDeliveryLine['wmsFlowMode']>;
                                                                    updateSupplierDeliveryLine(line.id, {
                                                                        wmsFlowMode: nextMode,
                                                                        targetWarehouseId: nextMode === 'direct_in_out' ? line.targetWarehouseId || null : null,
                                                                        wmsStatus: nextMode === 'direct_in_out' ? line.wmsStatus || 'not_required' : 'not_required',
                                                                    });
                                                                }}
                                                                className={`${procurementInputClass} w-full`}
                                                            >
                                                                <option value="none">Không qua kho</option>
                                                                <option value="direct_in_out">Nhập-xuất thẳng</option>
                                                            </select>
                                                            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black ${flowMeta.badge}`}>{flowMeta.label}</span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {isDirectInOut ? (
                                                                <>
                                                                    <InventoryItemCombobox
                                                                        value={line.itemId || ''}
                                                                        items={inventoryItems}
                                                                        onChange={selected => selectSupplierDeliveryInventoryItem(line.id, selected?.id || '')}
                                                                        placeholder="Chọn mã WMS..."
                                                                        className="w-full"
                                                                    />
                                                                    {line.skuSnapshot && <div className="mt-1 font-mono text-[10px] font-black text-indigo-600">{line.skuSnapshot}</div>}
                                                                </>
                                                            ) : (
                                                                <input value={line.itemNameSnapshot} onChange={event => updateSupplierDeliveryLine(line.id, { itemNameSnapshot: event.target.value })} className={`${procurementInputClass} w-full`} placeholder="Cát, đá, xi măng, bê tông..." />
                                                            )}
                                                            <input value={line.issueReason || ''} onChange={event => updateSupplierDeliveryLine(line.id, { issueReason: event.target.value })} className={`${procurementInputClass} mt-1 w-full`} placeholder="Lý do cấp, không bắt buộc" />
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {isDirectInOut ? (
                                                                <select value={line.targetWarehouseId || ''} onChange={event => updateSupplierDeliveryLine(line.id, { targetWarehouseId: event.target.value || null })} className={`${procurementInputClass} w-full`}>
                                                                    <option value="">Chọn kho nhập/xuất</option>
                                                                    {warehouses.map(warehouse => (
                                                                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                                                    ))}
                                                                </select>
                                                            ) : (
                                                                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-500">Không qua kho</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <input type="number" min={0} step="any" value={line.quantityInput ?? ''} onChange={event => updateSupplierDeliveryLine(line.id, { quantityInput: event.target.value })} className={`${procurementInputClass} w-full text-right`} />
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <input value={line.unitSnapshot || ''} onChange={event => updateSupplierDeliveryLine(line.id, { unitSnapshot: event.target.value })} className={`${procurementInputClass} w-full`} placeholder="m3/tấn/bao" />
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <button type="button" onClick={() => removeSupplierDeliveryLine(line.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-900/40">
                                <span className="font-bold text-slate-500">Số dòng: <b className="text-slate-900 dark:text-white">{supplierDeliveryFormSummary.lineCount}</b></span>
                                <span className="text-base font-black text-blue-700">Tổng SL: {fmtQty(supplierDeliveryFormSummary.totalQuantity)}</span>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
                            <button type="button" onClick={() => setShowSupplierDeliveryForm(false)} disabled={savingSupplierDelivery} className="rounded-lg px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Huỷ</button>
                            <button type="button" onClick={saveSupplierDelivery} disabled={savingSupplierDelivery} className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                                {savingSupplierDelivery ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {editingSupplierDelivery ? 'Cập nhật phiếu giao HĐ' : 'Lưu phiếu giao HĐ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {supplierDeliveryStatementPricing && (() => {
                const pricing = supplierDeliveryStatementPricing;
                const totals = pricing.lines.reduce((sum, line) => {
                    const acceptedQuantity = Number(line.acceptedQuantity || line.quantity || 0);
                    const unitPrice = Number(line.unitPriceInput || 0);
                    const vatRate = normalizeVatRate(line.vatRateInput);
                    const grossAmount = Math.round(acceptedQuantity * unitPrice);
                    const vatAmount = Math.round(grossAmount * vatRate / 100);
                    return {
                        grossAmount: sum.grossAmount + grossAmount,
                        vatAmount: sum.vatAmount + vatAmount,
                        totalAmount: sum.totalAmount + grossAmount + vatAmount,
                    };
                }, { grossAmount: 0, vatAmount: 0, totalAmount: 0 });
                return (
                    <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
                        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
                            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                                <div className="min-w-0">
                                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">Đối soát AP phiếu giao HĐ NCC</h3>
                                    <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{pricing.note.code} • {pricing.note.supplierNameSnapshot} • {pricing.note.deliveryTicketNo}</p>
                                </div>
                                <button type="button" onClick={() => setSupplierDeliveryStatementPricing(null)} disabled={postingSupplierDeliveryStatement} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                                    <table className="w-full min-w-[860px] text-left text-xs">
                                        <thead className={procurementTableHeadClass}>
                                            <tr>
                                                <th className="px-3 py-2">Vật tư</th>
                                                <th className="px-3 py-2 w-28 text-right">SL ghi</th>
                                                <th className="px-3 py-2 w-28">ĐVT</th>
                                                <th className="px-3 py-2 w-36 text-right">Đơn giá</th>
                                                <th className="px-3 py-2 w-28 text-right">VAT %</th>
                                                <th className="px-3 py-2 w-36 text-right">Thành tiền</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {pricing.lines.map(line => {
                                                const acceptedQuantity = Number(line.acceptedQuantity || line.quantity || 0);
                                                const unitPrice = Number(line.unitPriceInput || 0);
                                                const vatRate = normalizeVatRate(line.vatRateInput);
                                                const grossAmount = Math.round(acceptedQuantity * unitPrice);
                                                const totalAmount = grossAmount + Math.round(grossAmount * vatRate / 100);
                                                return (
                                                    <tr key={line.id}>
                                                        <td className="px-3 py-2">
                                                            <div className="font-black text-slate-900 dark:text-white">{line.itemNameSnapshot}</div>
                                                            <div className="mt-1 font-mono text-[10px] font-bold text-slate-400">{line.skuSnapshot || line.itemId || '—'}</div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-black text-slate-700 dark:text-slate-200">{fmtQty(acceptedQuantity)}</td>
                                                        <td className="px-3 py-2 font-bold text-slate-500">{line.unitSnapshot || '—'}</td>
                                                        <td className="px-3 py-2">
                                                            <input type="number" min={0} step="any" value={line.unitPriceInput} onChange={event => updateSupplierDeliveryStatementPrice(line.id, { unitPriceInput: event.target.value })} className={`${procurementInputClass} w-full text-right`} />
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <input type="number" min={0} max={100} step="any" value={line.vatRateInput} onChange={event => updateSupplierDeliveryStatementPrice(line.id, { vatRateInput: event.target.value })} className={`${procurementInputClass} w-full text-right`} />
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-black text-blue-700 whitespace-nowrap">{fmtMoney(totalAmount)} đ</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-4 flex flex-wrap items-center justify-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-900/40">
                                    <span className="font-bold text-slate-500">Trước VAT: <b className="text-slate-900 dark:text-white">{fmtMoney(totals.grossAmount)} đ</b></span>
                                    <span className="font-bold text-slate-500">VAT: <b className="text-slate-900 dark:text-white">{fmtMoney(totals.vatAmount)} đ</b></span>
                                    <span className="text-base font-black text-blue-700">AP: {fmtMoney(totals.totalAmount)} đ</span>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
                                <button type="button" onClick={() => setSupplierDeliveryStatementPricing(null)} disabled={postingSupplierDeliveryStatement} className="rounded-lg px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Huỷ</button>
                                <button type="button" onClick={() => void submitSupplierDeliveryStatementPricing()} disabled={postingSupplierDeliveryStatement} className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                                    {postingSupplierDeliveryStatement ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    Ghi AP
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showDirectPurchaseForm && (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                            <div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">{editingDirectPurchase ? 'Sửa phiếu mua nóng' : 'Tạo phiếu mua nóng công trường'}</h3>
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Vật tư tồn kho đi WMS; chi phí không kho chỉ ghi AP; CCDC nhỏ sinh sổ ngoài kho.</p>
                            </div>
                            <button onClick={() => setShowDirectPurchaseForm(false)} disabled={savingDirectPurchase} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-5">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Số phiếu</label>
                                    <input value={dpCode} onChange={event => setDpCode(event.target.value)} className={`${procurementInputClass} w-full`} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mode</label>
                                    <select value={dpMode} onChange={event => {
                                        const nextMode = event.target.value as SiteDirectPurchaseMode;
                                        setDpMode(nextMode);
                                        if (!editingDirectPurchase) setDpCode(buildSiteDirectPurchaseCode(nextMode, dpId));
                                    }} className={`${procurementInputClass} w-full`}>
                                        <option value="planned">Đề xuất trước rồi mua</option>
                                        <option value="immediate">Mua ngay rồi cập nhật chứng từ</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <label className="block text-[10px] font-black uppercase text-slate-400">Nhà cung cấp</label>
                                        <label className="inline-flex items-center gap-1 text-[10px] font-black text-orange-700">
                                            <input
                                                type="checkbox"
                                                checked={dpManualSupplierEnabled}
                                                onChange={event => {
                                                    setDpManualSupplierEnabled(event.target.checked);
                                                    if (event.target.checked) setDpSupplierId('');
                                                    else setDpManualSupplierName('');
                                                }}
                                                className="accent-orange-600"
                                            />
                                            NCC viết tay
                                        </label>
                                    </div>
                                    {dpManualSupplierEnabled ? (
                                        <input
                                            value={dpManualSupplierName}
                                            onChange={event => setDpManualSupplierName(event.target.value)}
                                            className={`${procurementInputClass} w-full`}
                                            placeholder="VD: Tạp hoá cô Lan, Cửa hàng kim khí Hùng..."
                                        />
                                    ) : (
                                        <SupplierCombobox value={dpSupplierId} suppliers={partners} onChange={supplier => setDpSupplierId(supplier?.id || '')} inputClassName="rounded-lg py-2 text-xs" />
                                    )}
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Nguồn tiền</label>
                                    <select value={dpPaymentSource} onChange={event => setDpPaymentSource(event.target.value as SiteDirectPurchasePaymentSource)} className={`${procurementInputClass} w-full`}>
                                        {Object.entries(DIRECT_PURCHASE_PAYMENT_SOURCE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Kho nhận</label>
                                    <select value={dpTargetWarehouseId} onChange={event => setDpTargetWarehouseId(event.target.value)} className={`${procurementInputClass} w-full`}>
                                        <option value="">Không nhập kho / chưa chọn</option>
                                        {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ngày mua</label>
                                    <input type="date" value={dpPurchaseDate} onChange={event => setDpPurchaseDate(event.target.value)} className={`${procurementInputClass} w-full`} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ngày HĐ</label>
                                    <input type="date" value={dpInvoiceDate} onChange={event => setDpInvoiceDate(event.target.value)} className={`${procurementInputClass} w-full`} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Số HĐ/biên nhận</label>
                                    <input value={dpInvoiceNumber} onChange={event => setDpInvoiceNumber(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="VD: HD-001" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tên chứng từ</label>
                                    <input value={dpAttachmentName} onChange={event => setDpAttachmentName(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="Ảnh HĐ / phiếu giao" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Link chứng từ</label>
                                    <input value={dpAttachmentUrl} onChange={event => setDpAttachmentUrl(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="URL file hoá đơn/biên nhận" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Ghi chú</label>
                                    <input value={dpNote} onChange={event => setDpNote(event.target.value)} className={`${procurementInputClass} w-full`} placeholder="Lý do mua nóng, người mua, chứng từ kèm theo..." />
                                </div>
                                <div className="md:col-span-4 rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/30">
                                    <input
                                        ref={directPurchaseFileInputRef}
                                        type="file"
                                        multiple
                                        accept={dpAttachmentAccept}
                                        className="hidden"
                                        onChange={event => void uploadDirectPurchaseFiles(Array.from(event.target.files || []))}
                                    />
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-[10px] font-black uppercase text-slate-400">File / hình ảnh đính kèm</div>
                                            <div className="mt-0.5 text-[10px] font-bold text-slate-500">Hoá đơn, ảnh biên nhận, phiếu giao hàng hoặc file scan.</div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => pickDirectPurchaseFiles('image/*')}
                                                disabled={uploadingDirectPurchaseFiles}
                                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                            >
                                                <ImageIcon size={12} /> Hình ảnh
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => pickDirectPurchaseFiles('.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,image/*,application/pdf')}
                                                disabled={uploadingDirectPurchaseFiles}
                                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                            >
                                                {uploadingDirectPurchaseFiles ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} File
                                            </button>
                                        </div>
                                    </div>
                                    {dpAttachments.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {dpAttachments.map(att => (
                                                <span key={att.id || att.url} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                                                    {att.fileType?.startsWith('image/') ? <ImageIcon size={11} className="text-emerald-600" /> : <FileText size={11} className="text-blue-600" />}
                                                    <a href={att.url} target="_blank" rel="noreferrer" className="max-w-[220px] truncate hover:text-orange-700 hover:underline">{att.name}</a>
                                                    <button type="button" onClick={() => setDpAttachments(prev => prev.filter(item => (item.id || item.url) !== (att.id || att.url)))} className="ml-1 rounded text-slate-400 hover:text-red-600">
                                                        <X size={11} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
                                <table className="w-full min-w-[1120px] text-left text-xs">
                                    <thead className={procurementTableHeadClass}>
                                        <tr>
                                            <th className="px-3 py-2 w-36">Loại dòng</th>
                                            <th className="px-3 py-2">Vật tư / Chi phí</th>
                                            <th className="px-3 py-2 w-24 text-right">SL</th>
                                            <th className="px-3 py-2 w-24">ĐVT</th>
                                            <th className="px-3 py-2 w-32 text-right">Đơn giá</th>
                                            <th className="px-3 py-2 w-24 text-right">VAT %</th>
                                            <th className="px-3 py-2 w-36 text-right">Thành tiền</th>
                                            <th className="px-3 py-2 w-14"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                        {dpLines.map((line, index) => {
                                            const preview = directPurchaseFormLines[index];
                                            const total = Number(preview.lineAmount || 0) + Number(preview.vatAmount || 0);
                                            return (
                                                <tr key={line.id}>
                                                    <td className="px-3 py-2">
                                                        <select value={line.lineType} onChange={event => {
                                                            const nextType = event.target.value as SiteDirectPurchaseLineType;
                                                            const lineTypeMeta = DIRECT_PURCHASE_LINE_TYPE[nextType] || DIRECT_PURCHASE_LINE_TYPE.expense_only;
                                                            updateDirectPurchaseLine(line.id, {
                                                                lineType: nextType,
                                                                itemId: null,
                                                                skuSnapshot: null,
                                                                itemNameSnapshot: lineTypeMeta.defaultName,
                                                                unitSnapshot: lineTypeMeta.defaultUnit,
                                                                smallToolCategory: nextType === 'small_tool' ? line.smallToolCategory || 'Dụng cụ nhỏ' : null,
                                                                smallToolHolderType: nextType === 'small_tool' ? line.smallToolHolderType || 'site' : null,
                                                                smallToolHolderId: nextType === 'small_tool' ? line.smallToolHolderId || null : null,
                                                                smallToolHolderNameSnapshot: nextType === 'small_tool' ? line.smallToolHolderNameSnapshot || 'Công trường' : null,
                                                                smallToolLocationNote: nextType === 'small_tool' ? line.smallToolLocationNote || null : null,
                                                            });
                                                        }} className={`${procurementInputClass} w-full`}>
                                                            <option value="stock_item">Vật tư tồn kho</option>
                                                            <option value="expense_only">Chi phí không kho</option>
                                                            <option value="small_tool">CCDC nhỏ</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {line.lineType === 'stock_item' ? (
                                                            <InventoryItemCombobox
                                                                value={line.itemId || ''}
                                                                items={inventoryItems}
                                                                onChange={selected => selectDirectPurchaseInventoryItem(line.id, selected?.id || '')}
                                                                className="w-full"
                                                            />
                                                        ) : (
                                                            <input value={line.itemNameSnapshot} onChange={event => updateDirectPurchaseLine(line.id, { itemNameSnapshot: event.target.value })} className={`${procurementInputClass} w-full`} placeholder={line.lineType === 'small_tool' ? 'Tên CCDC nhỏ / vật tư ngoài kho' : 'Mô tả chi phí'} />
                                                        )}
                                                        {line.lineType === 'small_tool' && (
                                                            <div className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-3">
                                                                <input value={line.smallToolCategory || ''} onChange={event => updateDirectPurchaseLine(line.id, { smallToolCategory: event.target.value })} className={`${procurementInputClass} w-full`} placeholder="Nhóm CCDC" />
                                                                <input value={line.smallToolHolderNameSnapshot || ''} onChange={event => updateDirectPurchaseLine(line.id, { smallToolHolderType: 'manual', smallToolHolderNameSnapshot: event.target.value })} className={`${procurementInputClass} w-full`} placeholder="Người/bộ phận giữ" />
                                                                <input value={line.smallToolLocationNote || ''} onChange={event => updateDirectPurchaseLine(line.id, { smallToolLocationNote: event.target.value })} className={`${procurementInputClass} w-full`} placeholder="Vị trí để" />
                                                            </div>
                                                        )}
                                                        <input value={line.note || ''} onChange={event => updateDirectPurchaseLine(line.id, { note: event.target.value })} className={`${procurementInputClass} mt-1 w-full`} placeholder="Ghi chú dòng" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" min={0} step="any" value={line.quantityInput ?? ''} onChange={event => updateDirectPurchaseLine(line.id, { quantityInput: event.target.value })} className={`${procurementInputClass} w-full text-right`} />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input value={line.unitSnapshot || ''} onChange={event => updateDirectPurchaseLine(line.id, { unitSnapshot: event.target.value })} className={`${procurementInputClass} w-full`} />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" min={0} step="any" value={line.unitPriceInput ?? ''} onChange={event => updateDirectPurchaseLine(line.id, { unitPriceInput: event.target.value })} className={`${procurementInputClass} w-full text-right`} />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" min={0} max={100} step="any" value={line.vatRateInput ?? '0'} onChange={event => updateDirectPurchaseLine(line.id, { vatRateInput: event.target.value })} className={`${procurementInputClass} w-full text-right`} />
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-black text-orange-700 whitespace-nowrap">{fmtMoney(total)} đ</td>
                                                    <td className="px-3 py-2 text-right">
                                                        <button type="button" onClick={() => removeDirectPurchaseLine(line.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
                                                            <X size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedDirectPurchaseItemIds([]);
                                        setDirectPurchaseItemPickerQuery('');
                                        setShowDirectPurchaseItemPicker(true);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] font-black text-sky-700 hover:bg-sky-100"
                                >
                                    <CheckCircle2 size={12} /> Chọn nhiều vật tư
                                </button>
                                <button type="button" onClick={() => addDirectPurchaseLine('stock_item')} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-100">
                                    <Package size={12} /> Thêm vật tư tồn kho
                                </button>
                                <button type="button" onClick={() => addDirectPurchaseLine('expense_only')} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[10px] font-black text-violet-700 hover:bg-violet-100">
                                    <Plus size={12} /> Thêm chi phí không kho
                                </button>
                                <button type="button" onClick={() => addDirectPurchaseLine('small_tool')} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-700 hover:bg-amber-100">
                                    <Wrench size={12} /> Thêm CCDC nhỏ
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
                            <div className="text-xs font-bold text-slate-500">
                                Trước VAT <span className="font-black text-slate-800">{fmtMoney(directPurchaseFormTotals.grossAmount)} đ</span>
                                {' '}• VAT <span className="font-black text-blue-700">{fmtMoney(directPurchaseFormTotals.vatAmount)} đ</span>
                                {' '}• Tổng <span className="font-black text-orange-700">{fmtMoney(directPurchaseFormTotals.totalAmount)} đ</span>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button type="button" onClick={() => setShowDirectPurchaseForm(false)} disabled={savingDirectPurchase} className="rounded-lg px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Huỷ</button>
                                <button type="button" onClick={saveDirectPurchase} disabled={savingDirectPurchase} className="inline-flex items-center gap-2 rounded-lg border border-orange-600 bg-orange-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                                    {savingDirectPurchase ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                    Lưu phiếu mua nóng
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showDirectPurchaseItemPicker && (
                <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/45 px-4 py-6">
                    <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-black text-slate-800 dark:text-slate-100">Chọn nhiều vật tư tồn kho</h3>
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Các mã đã có trong phiếu được ẩn để tránh nhập trùng dòng.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDirectPurchaseItemPicker(false)}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                            <div className="relative">
                                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={directPurchaseItemPickerQuery}
                                    onChange={event => setDirectPurchaseItemPickerQuery(event.target.value)}
                                    className={`${procurementInputClass} w-full pl-9`}
                                    placeholder="Tìm theo SKU, tên vật tư, nhóm, đơn vị..."
                                />
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                                <span>{selectedDirectPurchaseItemIds.length} vật tư đã chọn • {filteredDirectPurchasePickerItems.length} kết quả</span>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDirectPurchaseItemIds(prev => Array.from(new Set([
                                            ...prev,
                                            ...filteredDirectPurchasePickerItems.map(item => item.id),
                                        ])))}
                                        className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[10px] font-black text-sky-700 hover:bg-sky-100"
                                    >
                                        Chọn tất cả đang lọc
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDirectPurchaseItemIds([])}
                                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                                    >
                                        Bỏ chọn
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            {filteredDirectPurchasePickerItems.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs font-bold text-slate-400">
                                    Không còn vật tư phù hợp để thêm.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                    {filteredDirectPurchasePickerItems.map(item => {
                                        const checked = selectedDirectPurchaseItemIds.includes(item.id);
                                        return (
                                            <label
                                                key={item.id}
                                                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-xs transition ${checked ? 'border-sky-300 bg-sky-50' : 'border-slate-100 bg-white hover:border-sky-200 hover:bg-sky-50/50 dark:border-slate-800 dark:bg-slate-950'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleDirectPurchasePickerItem(item.id)}
                                                    className="mt-1 accent-sky-600"
                                                />
                                                <span className="min-w-0">
                                                    <span className="block truncate font-black text-slate-800 dark:text-slate-100">{item.sku} - {item.name}</span>
                                                    <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-400">
                                                        {item.category || 'Chưa phân nhóm'} • {item.purchaseUnit || item.unit || '-'} • Giá nhập {fmtMoney(Number(item.priceIn || 0))} đ
                                                    </span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setShowDirectPurchaseItemPicker(false)}
                                className="rounded-lg px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                Huỷ
                            </button>
                            <button
                                type="button"
                                onClick={addSelectedDirectPurchaseInventoryItems}
                                disabled={selectedDirectPurchaseItemIds.length === 0}
                                className="inline-flex items-center gap-2 rounded-lg border border-sky-600 bg-sky-600 px-5 py-2.5 text-sm font-black text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Plus size={16} /> Thêm {selectedDirectPurchaseItemIds.length} vật tư
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showRequestPicker && (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                            <div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">
                                    {requestPickerMode === 'append_to_po' ? 'Thêm đề xuất vào PO' : 'Tạo PO từ đề xuất công trường'}
                                </h3>
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                    {requestPickerMode === 'append_to_po'
                                        ? 'Chọn các dòng còn nhu cầu để thêm vào PO hiện tại; lịch giao sẽ không tự thay đổi.'
                                        : 'Có thể chọn nhiều dòng từ nhiều phiếu; hệ thống giữ link theo từng dòng đề xuất.'}
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setShowRequestPicker(false);
                                    setSelectedRequestLineKeys([]);
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="overflow-auto flex-1">
                            {requestPickerRows.length === 0 ? (
                                <div className="p-4">
                                    <EmptyState
                                        icon={<Package size={18} />}
                                        title="Không có đề xuất khả dụng"
                                        message={requestPickerMode === 'append_to_po'
                                            ? 'Các dòng còn nhu cầu và chưa nằm trong PO hiện tại sẽ xuất hiện tại đây.'
                                            : 'Các dòng còn nhu cầu sẽ xuất hiện tại đây khi công trường gửi đề xuất vật tư.'}
                                        compact
                                    />
                                </div>
                            ) : (
                                <table className="w-full text-xs min-w-[1260px]">
                                    <thead className={`${procurementTableHeadClass} whitespace-nowrap`}>
                                        <tr>
                                            <th className="px-4 py-3 text-center w-12"></th>
                                            <th className="px-4 py-3 text-left w-36">Phiếu</th>
                                            <th className="px-4 py-3 text-left w-40">Công trường</th>
                                            <th className="px-4 py-3 text-left">BOQ / Vật tư</th>
                                            <th className="px-4 py-3 text-right w-20">YC</th>
                                            <th className="px-4 py-3 text-right w-20">Đã cấp</th>
                                            <th className="px-4 py-3 text-right w-24">Đã chốt đủ</th>
                                            <th className="px-4 py-3 text-right w-24">PO mở</th>
                                            <th className="px-4 py-3 text-right w-24">Còn lại</th>
                                            <th className="px-4 py-3 text-right w-32">Quy đổi mua</th>
                                            <th className="px-4 py-3 text-right w-32">Tạm tính</th>
                                            <th className="px-4 py-3 text-left w-28">Ngày cần</th>
                                            <th className="px-4 py-3 text-right w-36">Nhu cầu</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                        {requestPickerRows.map(row => {
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
                                            const siteName = row.request.constructionSiteId ? constructionSiteById.get(row.request.constructionSiteId)?.name : '';
                                            const companyPoRefs = companyPoRefsByRequestLine.get(row.key) || [];
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
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <div className="font-bold text-slate-700">{siteName || row.request.constructionSiteId || '—'}</div>
                                                        <div className="text-[10px] text-slate-400">{warehouses.find(warehouse => warehouse.id === row.request.siteWarehouseId)?.name || row.request.siteWarehouseId || 'Chưa có kho nhận'}</div>
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
                                                    <td className="px-4 py-3 text-right text-emerald-600 font-bold whitespace-nowrap">{row.closedNeedQty.toLocaleString('vi-VN')} {stockUnit}</td>
                                                    <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">
                                                        <div>{row.orderedQty.toLocaleString('vi-VN')} {stockUnit}</div>
                                                        {companyPoRefs.length > 0 && (
                                                            <div className="mt-1 text-[9px] font-black text-emerald-600">
                                                                Đã gom: {companyPoRefs.join(', ')}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-amber-700 whitespace-nowrap">{remaining.toLocaleString('vi-VN')} {stockUnit}</td>
                                                    <td className="px-4 py-3 text-right font-black text-cyan-700 whitespace-nowrap">
                                                        {purchaseQty.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {purchaseUnit}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-emerald-700 whitespace-nowrap">
                                                        {purchaseUnitPrice > 0 ? `${fmtMoney(estimatedAmount)} đ` : '—'}
                                                        {purchaseUnitPrice > 0 && (
                                                            <div className="text-[9px] font-bold text-slate-400">
                                                                {fmtMoney(purchaseUnitPrice)} đ/{purchaseUnit}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{row.line.neededDate || row.request.expectedDate?.slice(0, 10) || '—'}</td>
                                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                                        <button
                                                            type="button"
                                                            onClick={() => closeRequestLineNeed(row)}
                                                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700 hover:bg-emerald-100"
                                                        >
                                                            Xác nhận đủ
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                            <button
                                onClick={() => {
                                    setShowRequestPicker(false);
                                    setSelectedRequestLineKeys([]);
                                }}
                                className="rounded-lg px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 active:scale-[0.98] dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                Đóng
                            </button>
                            <button
                                onClick={requestPickerMode === 'append_to_po' ? appendSelectedRequestsToEditingPo : openPoFromSelectedRequests}
                                disabled={selectedRequestLineKeys.length === 0}
                                className="rounded-lg border border-amber-500 bg-amber-500 px-6 py-2.5 text-sm font-black text-white transition hover:bg-amber-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                                {requestPickerMode === 'append_to_po' ? 'Thêm vào PO' : 'Đưa vào PO'} ({selectedRequestLineKeys.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deliveryDraftPo && (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                            <div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">Tạo đợt giao PO</h3>
                                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{deliveryDraftPo.poNumber} • {deliveryDraftPo.vendorName || 'Nhà cung cấp'}</p>
                            </div>
                            <button
                                onClick={() => savingDeliveryDraft ? undefined : setDeliveryDraftPo(null)}
                                disabled={savingDeliveryDraft}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="overflow-auto flex-1">
                            {deliveryDraftLines.length === 0 ? (
                                <div className="p-4">
                                    <EmptyState icon={<Truck size={18} />} title="Không có dòng giao khả dụng" message="PO này không còn dòng có số lượng cần giao." compact />
                                </div>
                            ) : (
                                <table className="w-full text-xs min-w-[980px]">
                                    <thead className={`${procurementTableHeadClass} whitespace-nowrap`}>
                                        <tr>
                                            <th className="px-4 py-3 text-left">Công trường / Phiếu</th>
                                            <th className="px-4 py-3 text-left">Vật tư</th>
                                            <th className="px-4 py-3 text-right w-28">Còn lại</th>
                                            <th className="px-4 py-3 text-right w-32">SL đợt này</th>
                                            <th className="px-4 py-3 text-right w-32">Giá đợt</th>
                                            <th className="px-4 py-3 text-right w-36">Thành tiền</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                        {deliveryDraftLines.map(line => {
                                            const qty = Number(line.issuedQty || 0);
                                            const price = Number(line.deliveryUnitPrice || 0);
                                            const amount = qty * price;
                                            return (
                                                <tr key={line.key} className="hover:bg-indigo-50/40">
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-slate-700">{line.siteName || '—'}</div>
                                                        <div className="text-[10px] font-mono text-indigo-600">{line.requestCode || line.materialRequestId}</div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-black text-slate-800">{line.itemName}</div>
                                                        <div className="text-[10px] text-slate-400">{line.unit || ''}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                                        <div className="font-black text-amber-700">{line.remainingQty.toLocaleString('vi-VN')} {line.unit || ''}</div>
                                                        {line.allocatedQty > 0 && (
                                                            <div className="mt-1 text-[10px] font-bold text-slate-400">
                                                                Đã lập/nhận {line.allocatedQty.toLocaleString('vi-VN')} {line.unit || ''}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={line.issuedQty}
                                                            onChange={event => updateDeliveryDraftLine(line.key, { issuedQty: event.target.value })}
                                                            className={`${procurementInputClass} w-28 text-right text-indigo-700`}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={line.deliveryUnitPrice}
                                                            onChange={event => updateDeliveryDraftLine(line.key, { deliveryUnitPrice: event.target.value })}
                                                            className={`${procurementInputClass} w-28 text-right text-emerald-700`}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-emerald-700 whitespace-nowrap">
                                                        {amount > 0 ? `${amount.toLocaleString('vi-VN')} đ` : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                            <div className="text-xs font-bold text-slate-500">
                                Tổng đợt giao:{' '}
                                <span className="font-black text-emerald-700">
                                    {deliveryDraftLines.reduce((sum, line) => sum + Number(line.issuedQty || 0) * Number(line.deliveryUnitPrice || 0), 0).toLocaleString('vi-VN')} đ
                                </span>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={() => setDeliveryDraftPo(null)} disabled={savingDeliveryDraft} className="rounded-lg px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Huỷ</button>
                                <button onClick={submitPoDeliveryDraft} disabled={savingDeliveryDraft}
                                    className="flex items-center gap-2 rounded-lg border border-indigo-600 bg-indigo-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                                    {savingDeliveryDraft ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
                                    Tạo đợt giao
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Vendor Form Modal */}
            {showVendorForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
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
                                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${vCats.includes(c) ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-card border-border text-muted-foreground hover:border-border/80'}`}>
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
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingPo ? <><Edit2 size={18} /> Sửa PO</> : <><Plus size={18} /> Tạo đơn hàng</>}
                            </span>
                            <button onClick={savingPo ? undefined : resetPoForm} disabled={savingPo} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-50"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số PO · Tự sinh</label>
                                    <input value={pNum} readOnly aria-readonly="true" placeholder="Đang cấp số..."
                                        className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm font-bold text-slate-600 outline-none" />
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
                                    onChange={e => {
                                        const nextSourceMode = e.target.value as PurchaseOrderSourceMode;
                                        setPSourceMode(nextSourceMode);
                                        if (!editingPo && pNumAutoGenerated) {
                                            void loadNextPoNumber(nextSourceMode).then(setPNum);
                                        }
                                    }}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                    <option value="proactive_project">Mua chủ động cho dự án</option>
                                    <option value="proactive_stock">Mua dự trữ kho tổng</option>
                                    <option value="from_request">Từ đề xuất công trường</option>
                                </select>
                                {poHasRequestLines && <p className="mt-1 text-[10px] font-bold text-amber-600">PO đang có dòng từ đề xuất nên giữ nguồn “Từ đề xuất công trường”.</p>}
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nội dung đề nghị duyệt</label>
                                <textarea
                                    value={pApprovalRequestTitle}
                                    onChange={e => setPApprovalRequestTitle(e.target.value)}
                                    rows={2}
                                    placeholder="Ví dụ: Bạt mực và 1 vật tư khác Công trường Sơn miền Bắc --> Cửa hàng Thủy Cách"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">VAT (%)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="any"
                                        value={pVatRate}
                                        onChange={e => setPVatRate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
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
                                        {editingPo && pSourceMode === 'from_request' && (
                                            <button
                                                type="button"
                                                onClick={openAppendRequestPicker}
                                                disabled={appendableRequestLines.length === 0}
                                                className="text-amber-600 hover:text-amber-700 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center gap-0.5"
                                            >
                                                <Package size={10} /> Thêm đề xuất
                                            </button>
                                        )}
                                        <button type="button" onClick={() => setPItems([...pItems, createEmptyPoItem()])}
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
                                        const lineKey = normalizedLine.lineId || normalizedLine.itemId;
                                        const scheduledLine = scheduledPItemByLineKey.get(lineKey);
                                        const scheduleQtyPreview = Number(scheduledLine?.qty ?? previewLine.qty ?? 0);
                                        const scheduleUnitPricePreview = Number(scheduledLine?.unitPrice ?? previewLine.unitPrice ?? 0);
                                        const stockQtyPreview = poLinePurchaseToStockQty(previewLine, scheduleQtyPreview, inventory);
                                        const lineTotalPreview = calculateLineTotal({
                                            ...previewLine,
                                            qty: scheduleQtyPreview,
                                            unitPrice: scheduleUnitPricePreview,
                                        });
                                        const pricingPreviewLine = {
                                            ...item,
                                            qty: pSourceMode === 'from_request' ? scheduleQtyPreview : Number(item.qty || 0),
                                            unitPrice: pSourceMode === 'from_request' ? scheduleUnitPricePreview : Number(item.unitPrice || 0),
                                        };
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
                                                        className="col-span-12 px-2.5 py-2 rounded-lg border border-border bg-muted/30 text-foreground text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-muted disabled:text-muted-foreground"
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
                                                <div className="col-span-4 md:col-span-1 px-2.5 py-2 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground font-bold truncate">
                                                    {purchaseUnit || item.unit || 'ĐVT'}
                                                </div>
                                                {pSourceMode === 'from_request' ? (
                                                    <div className="col-span-4 md:col-span-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                                                        <span className="block text-[9px] font-black uppercase text-slate-400">Đã lập lịch</span>
                                                        <span className="block truncate text-xs font-black text-slate-800">{fmtQty(scheduleQtyPreview)}</span>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={1}
                                                        value={item.qty || ''}
                                                        onChange={e => updatePoItem(i, { qty: Number(e.target.value) || 0 })}
                                                        placeholder="SL"
                                                        className="col-span-4 md:col-span-1 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                )}
                                                {pSourceMode === 'from_request' ? (
                                                    <div className="col-span-4 md:col-span-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5">
                                                        <span className="block text-[9px] font-black uppercase text-emerald-500">Giá theo đợt</span>
                                                        <span className="block truncate text-xs font-black text-emerald-700">{fmtMoney(scheduleUnitPricePreview)} đ</span>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={item.unitPrice || ''}
                                                        onChange={e => updatePoItem(i, { unitPrice: Number(e.target.value) || 0 })}
                                                        placeholder="Đơn giá"
                                                        className="col-span-4 md:col-span-2 px-2.5 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                )}
                                                <input
                                                    type="date"
                                                    value={item.neededDate || ''}
                                                    onChange={e => updatePoItem(i, { neededDate: e.target.value })}
                                                    className="col-span-6 md:col-span-2 px-2.5 py-2 rounded-lg border border-border text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-muted/30 text-foreground"
                                                />
                                                <input
                                                    value={item.note || ''}
                                                    onChange={e => updatePoItem(i, { note: e.target.value })}
                                                    placeholder="Ghi chú"
                                                    className="col-span-2 md:col-span-7 px-2.5 py-2 rounded-lg border border-border text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-muted/30 text-foreground"
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
                                                        {pSourceMode === 'from_request' && (
                                                            <span className="px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[9px] font-bold text-blue-700">
                                                                Nhu cầu gốc {fmtQty(Number(previewLine.qty || 0))} {purchaseUnit || previewLine.unit}
                                                            </span>
                                                        )}
                                                        {pSourceMode === 'from_request' && (
                                                            <span className="px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-[9px] font-bold text-amber-700">
                                                                Đã lập lịch {fmtQty(scheduleQtyPreview)}, còn {fmtQty(Math.max(0, Number(previewLine.qty || 0) - scheduleQtyPreview))}
                                                            </span>
                                                        )}
                                                        {(item.workBoqItemName || rowWork?.name) && <span className="px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[9px] font-bold text-blue-700">{rowWork?.wbsCode ? `${rowWork.wbsCode} - ` : ''}{item.workBoqItemName || rowWork?.name}</span>}
                                                        {item.materialBudgetItemName && <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] font-bold text-emerald-700">{item.materialBudgetItemName}</span>}
                                                        {overBudgetQty > 0 && <span className="px-1.5 py-0.5 rounded border border-orange-100 bg-orange-50 text-[9px] font-bold text-orange-700">Vượt {overBudgetQty.toLocaleString('vi-VN')} {stockUnit || previewLine.unit}</span>}
                                                        {hasUnitConversion && (
                                                            <span className="px-1.5 py-0.5 rounded border border-cyan-100 bg-cyan-50 text-[9px] font-bold text-cyan-700">
                                                                Nhập kho {fmtQty(stockQtyPreview)} {stockUnit} (1 {purchaseUnit} = {fmtQty(Number(previewLine.purchaseConversionFactor || inventory?.purchaseConversionFactor || 1))} {stockUnit})
                                                            </span>
                                                        )}
                                                        {scheduleQtyPreview > 0 && scheduleUnitPricePreview > 0 && (
                                                            <span className="px-1.5 py-0.5 rounded border border-emerald-100 bg-emerald-50 text-[9px] font-bold text-emerald-700">
                                                                Tính tiền {fmtQty(scheduleQtyPreview)} {purchaseUnit || previewLine.unit} × {fmtMoney(scheduleUnitPricePreview)} = {fmtMoney(lineTotalPreview)} đ
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
                                                    <div className="col-span-12 mt-2 p-3 bg-card border border-border rounded-xl space-y-3">
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
                                                                    className="w-full px-2.5 py-1.5 rounded-lg border border-border text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-muted/30 text-foreground"
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
                                                                                    className="w-full pl-2 pr-6 py-1.5 rounded-lg border border-border text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-muted/30 text-foreground"
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
                                                                    {formatPricingFormula(pricingPreviewLine)} = <span className="text-sm font-black underline">{calculateLineTotal(pricingPreviewLine).toLocaleString('vi-VN')} đ</span>
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
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Lịch giao hàng</div>
                                        <div className="text-[10px] font-bold text-slate-400">PO giữ tổng đã duyệt; từng đợt có số lượng và giá riêng.</div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {([
                                            ['unknown', 'Chưa biết lịch'],
                                            ['first_batch', 'Tạo đợt đầu tiên'],
                                            ['multiple_batches', 'Chia nhiều đợt'],
                                        ] as const).map(([mode, label]) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => setPoDeliveryScheduleModeWithDraft(mode)}
                                                className={`px-3 py-1.5 rounded-lg border text-[10px] font-black ${pDeliveryScheduleMode === mode
                                                    ? 'border-blue-500 bg-blue-600 text-white'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                                    }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => resetPoDeliveryDraftFromItems()}
                                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-600 hover:bg-slate-100"
                                        >
                                            Tạo lại lịch
                                        </button>
                                        <button
                                            type="button"
                                            onClick={addPoDeliveryBatch}
                                            className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-[10px] font-black text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1"
                                        >
                                            <Plus size={12} /> Tạo giao đợt tiếp
                                        </button>
                                    </div>
                                </div>
                                <div className="grid gap-2 text-[11px] font-bold text-slate-500 sm:grid-cols-4">
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                        <span className="block text-[9px] font-black uppercase text-slate-400">Tổng đã duyệt</span>
                                        <strong className="text-slate-800">{fmtMoney(poReleaseSummaryPreview.approvedTotalAmount)} đ</strong>
                                    </div>
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                        <span className="block text-[9px] font-black uppercase text-slate-400">Giá trị đợt</span>
                                        <strong className="text-blue-700">{fmtMoney(poReleaseSummaryPreview.actualPlannedAmount)} đ</strong>
                                    </div>
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                        <span className="block text-[9px] font-black uppercase text-slate-400">Phần vượt duyệt</span>
                                        <strong className={poReleaseSummaryPreview.overAmount > 0 ? 'text-amber-700' : 'text-emerald-700'}>{fmtMoney(poReleaseSummaryPreview.overAmount)} đ</strong>
                                    </div>
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                        <span className="block text-[9px] font-black uppercase text-slate-400">Còn lại theo SL</span>
                                        <strong className="text-slate-800">
                                            {poReleaseSummaryPreview.lineSummaries.some(line => line.remainingQty < -0.000001)
                                                ? 'Có dòng vượt SL'
                                                : `${poReleaseSummaryPreview.lineSummaries.filter(line => line.remainingQty > 0.000001).length} dòng còn`}
                                        </strong>
                                    </div>
                                </div>
                                {poReleaseSummaryPreview.overAmount > 0 && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                                        Giá trị các đợt đang vượt tổng đã duyệt. Khi lưu, hệ thống sẽ gửi duyệt bổ sung và khóa WMS/QR cho đợt vượt.
                                    </div>
                                )}
                                <div className="space-y-2">
                                    {poDeliveryBatchesForForm.length === 0 && (
                                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs font-bold text-slate-400">
                                            Chưa có lịch mua/giao. PO vẫn lưu tổng khối lượng và tổng giá trị duyệt ban đầu; có thể thêm đợt khi biết lịch.
                                        </div>
                                    )}
                                    {poDeliveryBatchesForForm.map((batch, batchIndex, displayBatches) => {
                                        const activeItems = pItems.map(item => normalizePoItem(item, inventoryItems)).filter(item => item.itemId && Number(item.qty || 0) > 0);
                                        const showPurchaseColumns = activeItems.some(item => {
                                            const inventory = inventoryItems.find(inv => inv.id === item.itemId);
                                            return hasPurchaseUnitConversion({
                                                unit: getPoLineStockUnit(item, inventory),
                                                purchaseUnit: getPoLinePurchaseUnit(item, inventory),
                                                purchaseConversionFactor: item.purchaseConversionFactor ?? inventory?.purchaseConversionFactor ?? 1,
                                            });
                                        });
                                        return (
                                            <div key={batch.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-xs font-black text-indigo-700">{batchIndex + 1}</span>
                                                        <div>
                                                            <div className="text-xs font-black text-slate-700">Đợt giao {batchIndex + 1}</div>
                                                            <div className="text-[10px] font-bold text-slate-400">{batch.lines.filter(line => Number(line.plannedQty || 0) > 0).length} dòng có số lượng</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="date"
                                                            value={batch.plannedDeliveryDate || ''}
                                                            onChange={e => updatePoDeliveryBatch(batch.id, { plannedDeliveryDate: e.target.value || null })}
                                                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                                                        />
                                                        {poDeliveryBatchesForForm.length > 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removePoDeliveryBatch(batch.id)}
                                                                className="h-8 w-8 rounded-lg text-red-300 hover:bg-red-50 hover:text-red-600"
                                                                title="Xoá đợt giao"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-3 overflow-x-auto">
                                                    <table className={`w-full text-xs ${showPurchaseColumns ? 'min-w-[960px]' : 'min-w-[720px]'}`}>
                                                        <thead>
                                                            <tr className="border-b border-slate-100 text-[9px] font-black uppercase text-slate-400">
                                                                <th className="px-2 py-2 text-left">Vật tư</th>
                                                                <th className="px-2 py-2 text-center">ĐVT</th>
                                                                <th className="px-2 py-2 text-right">SL</th>
                                                                {showPurchaseColumns && (
                                                                    <>
                                                                        <th className="px-2 py-2 text-center">ĐVT(m)</th>
                                                                        <th className="px-2 py-2 text-right">SL(m)</th>
                                                                    </>
                                                                )}
                                                                <th className="px-2 py-2 text-right">Giá đợt</th>
                                                                <th className="px-2 py-2 text-right">{showPurchaseColumns ? 'Còn lại(m)' : 'Còn lại'}</th>
                                                                <th className="px-2 py-2 text-right">Thành tiền</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {activeItems.map(item => {
                                                                const lineKey = item.lineId || item.itemId;
                                                                const currentLine = batch.lines.find(line => line.purchaseOrderLineId === lineKey);
                                                                const deliveryInventory = inventoryItems.find(inv => inv.id === item.itemId);
                                                                const stockUnit = getPoLineStockUnit(item, deliveryInventory) || item.unit;
                                                                const purchaseUnit = getPoLinePurchaseUnit(item, deliveryInventory) || item.unit;
                                                                const itemHasConversion = hasPurchaseUnitConversion({
                                                                    unit: stockUnit,
                                                                    purchaseUnit,
                                                                    purchaseConversionFactor: item.purchaseConversionFactor ?? deliveryInventory?.purchaseConversionFactor ?? 1,
                                                                });
                                                                const purchaseQty = Number(currentLine?.plannedQty || 0);
                                                                const stockQty = itemHasConversion
                                                                    ? Number(currentLine?.stockPlannedQty ?? poLinePurchaseToStockQty(item, purchaseQty, deliveryInventory))
                                                                    : purchaseQty;
                                                                const remainingQty = getPoDeliveryRemainingQty(displayBatches, lineKey, Number(item.qty || 0), batchIndex);
                                                                const remainingTone = remainingQty < -0.000001
                                                                    ? 'text-red-600'
                                                                    : remainingQty > 0.000001
                                                                        ? 'text-amber-600'
                                                                        : 'text-emerald-600';
                                                                const deliveryPriceInputValue = currentLine
                                                                    ? (Number(currentLine.deliveryUnitPrice || 0) > 0 ? currentLine.deliveryUnitPrice : '')
                                                                    : (pSourceMode === 'from_request' ? '' : item.unitPrice ?? '');
                                                                return (
                                                                    <tr key={lineKey}>
                                                                        <td className="px-2 py-2">
                                                                            <div className="font-bold text-slate-700">{item.name || item.sku}</div>
                                                                            <div className="text-[10px] font-mono text-slate-400">{item.sku}</div>
                                                                        </td>
                                                                        <td className="px-2 py-2 text-center font-bold text-slate-500">{stockUnit || '—'}</td>
                                                                        <td className="px-2 py-2 text-right">
                                                                            {itemHasConversion ? (
                                                                                <input
                                                                                    type="number"
                                                                                    min={0}
                                                                                    step="any"
                                                                                    value={Number.isFinite(stockQty) ? stockQty : ''}
                                                                                    onChange={e => updatePoDeliveryLineStockQty(batch.id, lineKey, Number(e.target.value) || 0)}
                                                                                    className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs font-bold text-slate-700"
                                                                                />
                                                                            ) : (
                                                                                <input
                                                                                    type="number"
                                                                                    min={0}
                                                                                    step="any"
                                                                                    value={currentLine?.plannedQty || ''}
                                                                                    onChange={e => updatePoDeliveryLineQty(batch.id, lineKey, Number(e.target.value) || 0)}
                                                                                    className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs font-bold"
                                                                                />
                                                                            )}
                                                                        </td>
                                                                        {showPurchaseColumns && (
                                                                            <>
                                                                                <td className="px-2 py-2 text-center font-bold text-slate-500">{itemHasConversion ? purchaseUnit || '—' : '—'}</td>
                                                                                <td className="px-2 py-2 text-right">
                                                                                    {itemHasConversion ? (
                                                                                        <input
                                                                                            type="number"
                                                                                            min={0}
                                                                                            step="any"
                                                                                            value={currentLine?.plannedQty || ''}
                                                                                            onChange={e => updatePoDeliveryLineQty(batch.id, lineKey, Number(e.target.value) || 0)}
                                                                                            className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs font-bold"
                                                                                        />
                                                                                    ) : (
                                                                                        <span className="text-slate-300">—</span>
                                                                                    )}
                                                                                </td>
                                                                            </>
                                                                        )}
                                                                        <td className="px-2 py-2 text-right">
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                step="any"
                                                                                value={deliveryPriceInputValue}
                                                                                onChange={e => updatePoDeliveryLinePrice(batch.id, lineKey, Number(e.target.value) || 0)}
                                                                                className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs font-bold text-emerald-700"
                                                                            />
                                                                        </td>
                                                                        <td className={`px-2 py-2 text-right font-black ${remainingTone}`}>
                                                                            {remainingQty < -0.000001 ? `Vượt ${fmtQty(Math.abs(remainingQty))}` : fmtQty(remainingQty)}
                                                                        </td>
                                                                        {/* thành tiền */}
                                                                        <td className="px-2 py-2 text-right font-bold text-blue-600 " >
                                                                            {fmtQty(Number(currentLine?.deliveryUnitPrice ?? 0) * Number(currentLine?.plannedQty ?? 0))}
                                                                        </td>
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
                            </div>
                            {poTotalCalc > 0 && (
                                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-blue-400">Tổng cộng:</span>
                                        <span className="font-black text-blue-700 text-sm">{fmtMoney(poTotalCalc)} đ</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between">
                                        <span className="text-blue-400">VAT {poVatRateCalc.toLocaleString('vi-VN')}%:</span>
                                        <span className="font-black text-blue-700 text-sm">{fmtMoney(poVatAmountCalc)} đ</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between border-t border-blue-100 pt-1">
                                        <span className="font-black text-blue-500">Tổng thanh toán:</span>
                                        <span className="font-black text-emerald-700 text-base">{fmtMoney(poPaymentTotalCalc)} đ</span>
                                    </div>
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
                            <button onClick={() => void handleSavePo()} disabled={savingPo || !pNum || (!pTargetWarehouseId && !(pSourceMode === 'from_request' && pItems.some(item => !!scopedMaterialRequests.find(req => req.id === item.requestId)?.siteWarehouseId)))}
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
                        { label: 'Tổng giá trị', value: `${fmtMoney(submittingPoDisplayAmount)} đ` },
                        { label: 'VAT', value: `${submittingPoVatRate.toLocaleString('vi-VN')}% • ${fmtMoney(submittingPoVatAmount)} đ` },
                        { label: 'Tổng thanh toán', value: `${fmtMoney(submittingPoDisplayAmount + submittingPoVatAmount)} đ` },
                        { label: 'Số dòng', value: `${submittingPo.items.length} dòng vật tư` },
                        { label: 'Ngày cần giao', value: submittingPo.expectedDeliveryDate || '-' },
                    ]}
                    onCancel={() => setSubmittingPo(null)}
                    onConfirm={target => updatePoStatus(submittingPo.id, 'sent', target)}
                />
            )}
            {submittingDirectPurchase && (
                <ProjectSubmissionDialog
                    title="Gửi duyệt mua nóng"
                    actionLabel="Gửi duyệt"
                    documentLabel="Phiếu mua nóng"
                    documentName={`${submittingDirectPurchase.code} • ${submittingDirectPurchase.supplierNameSnapshot}`}
                    documentSubtitle={`Trạng thái hiện tại: ${DIRECT_PURCHASE_STATUS[submittingDirectPurchase.status]?.label || submittingDirectPurchase.status}`}
                    projectId={submittingDirectPurchase.projectId || projectId}
                    constructionSiteId={submittingDirectPurchase.constructionSiteId || constructionSiteId}
                    recipientPermissionCodes={['project.material_direct_purchase.edit']}
                    recipientHint="Chọn đích danh người có quyền kiểm tra và duyệt phiếu mua nóng tại dự án/công trường này."
                    details={[
                        { label: 'Nhà cung cấp', value: submittingDirectPurchase.supplierNameSnapshot },
                        { label: 'Nguồn thanh toán', value: DIRECT_PURCHASE_PAYMENT_SOURCE[submittingDirectPurchase.paymentSource] },
                        { label: 'Trước VAT', value: `${fmtMoney(submittingDirectPurchase.grossAmount)} đ` },
                        { label: 'VAT', value: `${fmtMoney(submittingDirectPurchase.vatAmount)} đ` },
                        { label: 'Tổng thanh toán', value: `${fmtMoney(submittingDirectPurchase.totalAmount)} đ` },
                        { label: 'Số dòng', value: `${submittingDirectPurchase.lines?.length || 0} dòng` },
                    ]}
                    onCancel={() => setSubmittingDirectPurchase(null)}
                    onConfirm={target => submitDirectPurchaseForApproval(submittingDirectPurchase, target)}
                />
            )}
            {pendingPoSupplementalSubmission && (
                <ProjectSubmissionDialog
                    title="Gửi duyệt bổ sung PO"
                    actionLabel="Gửi duyệt bổ sung"
                    documentLabel="Duyệt bổ sung PO"
                    documentName={`${pNum || editingPo?.poNumber || 'PO'} • ${pendingPoSupplementalSubmission.supplementalRequestCount} đợt vượt duyệt`}
                    documentSubtitle="Đợt mua vẫn được lưu, nhưng chưa thể tạo WMS/QR cho tới khi duyệt bổ sung."
                    projectId={projectId}
                    constructionSiteId={constructionSiteId || editingPo?.constructionSiteId}
                    recipientPermissionCodes={['project.material_po.approve']}
                    recipientHint="Chọn người có quyền duyệt PO để duyệt phần giá trị vượt."
                    details={[
                        { label: 'Tổng đã duyệt', value: `${fmtMoney(pendingPoSupplementalSubmission.previousApprovedAmount)} đ` },
                        { label: 'Tổng cần duyệt mới', value: `${fmtMoney(pendingPoSupplementalSubmission.requestedTotalAmount)} đ` },
                        { label: 'Phần vượt', value: `${fmtMoney(pendingPoSupplementalSubmission.totalOverAmount)} đ` },
                        { label: 'Số đợt chờ duyệt', value: `${pendingPoSupplementalSubmission.supplementalRequestCount} đợt` },
                    ]}
                    onCancel={() => setPendingPoSupplementalSubmission(null)}
                    onConfirm={async target => {
                        setPendingPoSupplementalSubmission(null);
                        await handleSavePo(target);
                    }}
                />
            )}
            <TransactionDetailModal
                isOpen={!!selectedWmsTransaction}
                transaction={selectedWmsTransaction}
                onClose={() => {
                    setSelectedWmsTransaction(null);
                    void loadSupplyData();
                    if (selectedPo) void loadPoDeliveryPrintGroups(selectedPo);
                }}
            />
            <PurchaseOrderSupplierReturnDialog
                purchaseOrder={supplierReturnPo}
                warehouses={warehouses}
                inventoryItems={inventoryItems}
                existingReturns={supplierReturnPo ? supplierReturnsByPo[supplierReturnPo.id] || [] : []}
                onClose={() => setSupplierReturnPo(null)}
                onCreated={async (createdReturn, itemIds) => {
                    await Promise.all([
                        loadSupplyData(),
                        refreshWmsRecords({
                            itemIds,
                            transactionIds: [createdReturn.transactionId],
                        }),
                    ]);
                }}
            />
        </div>
    );
};

export default SupplyChainTab;
