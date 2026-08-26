import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Edit2,
  FileText,
  History,
  Loader2,
  MoreVertical,
  Package,
  PackageX,
  Printer,
  QrCode,
  RefreshCcw,
  Send,
  ShieldCheck,
  Trash2,
  Truck,
  User as UserIcon,
  WalletCards,
  X,
  AlertCircle,
} from 'lucide-react';
import { StatusBadge, type ErpStatusTone } from '../erp';
import { useApp } from '../../context/AppContext';
import {
  InventoryItem,
  MaterialRequestFulfillmentBatch,
  MaterialRequestFulfillmentLine,
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
  PurchaseOrderItem,
  PurchaseOrderRequestLineLink,
  PurchaseOrderSupplierReturn,
  SupplierPayableDocument,
  Warehouse,
} from '../../types';
import {
  DEFAULT_SPEC_METADATA,
  SPEC_KEY_ORDER,
  formatPricingFormula,
} from '../../lib/poSpecsUtils';
import {
  getPoLineStockUnit,
} from '../../lib/materialUnitConversion';
import { getPurchaseOrderDisplayLineAmount } from '../../lib/purchaseOrderAmount';
import { getPurchaseOrderLineDemandQty } from '../../lib/purchaseOrderDemand';
import { getPurchasePackageSummary } from '../../lib/purchasePackageDomain';
import { getPurchaseOrderScheduleLineUnitPrice } from '../../lib/purchaseOrderSchedulePricing';
import type {
  PurchaseOrderReceiptStats,
  PurchaseOrderUiAction,
  PurchaseOrderUiPolicy,
} from '../../lib/purchaseOrderUiPolicy';

type PrintTemplateKey = 'purchase_order' | 'approval_request';
type DetailTabKey = 'overview' | 'items' | 'deliveries' | 'documents' | 'history';

export type PurchaseOrderDeliveryPrintGroupView = {
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

export type PurchaseOrderCockpitDrawerProps = {
  po: PurchaseOrder;
  requestTitle: string;
  materialSummary: string;
  sourceLabel: string;
  targetWarehouseName: string;
  groupLabel?: string | null;
  statusLabel: string;
  statusTone: ErpStatusTone;
  uiPolicy: PurchaseOrderUiPolicy;
  receiptStats: PurchaseOrderReceiptStats;
  displayAmount: number;
  vatRate: number;
  vatAmount: number;
  paymentTotal: number;
  inventoryItems: InventoryItem[];
  warehouses: Warehouse[];
  poRequestLinks: PurchaseOrderRequestLineLink[];
  deliveryBatches: PurchaseOrderDeliveryBatch[];
  deliveryPrintGroups: PurchaseOrderDeliveryPrintGroupView[];
  supplierReturns: PurchaseOrderSupplierReturn[];
  supplierPayableDocuments: SupplierPayableDocument[];
  supplierPayableLoading?: boolean;
  supplierPayableError?: string | null;
  supplierReturnableQty: number;
  totalReceivedQty: number;
  completedReturnQty: number;
  pendingReturnQty: number;
  canMutatePoDocument: boolean;
  canConfirmPo: boolean;
  poHasStockImpact: boolean;
  creatingDeliveryBatchId?: string | null;
  deletingDeliveryKey?: string | null;
  printingPoId?: string | null;
  isLoadingDeliveryPrintGroups?: boolean;
  getPrintGroupForBatch: (batch: PurchaseOrderDeliveryBatch) => PurchaseOrderDeliveryPrintGroupView;
  getWmsTransactionIdForBatch?: (batch: PurchaseOrderDeliveryBatch) => string | null;
  onRunAction: (action: PurchaseOrderUiAction) => void | Promise<void>;
  onPrintDeliveryGroup: (group: PurchaseOrderDeliveryPrintGroupView, template: PrintTemplateKey) => void | Promise<void>;
  onEditSchedule: () => void;
  onRemovePlannedBatch: (batch: PurchaseOrderDeliveryBatch) => void | Promise<void>;
  onCreateDeliveryReceipt: (batch: PurchaseOrderDeliveryBatch) => void | Promise<void>;
  onRemoveFailedDeliveryBatch: (batch: PurchaseOrderDeliveryBatch) => void | Promise<void>;
  onRemoveFailedDeliveryGroup: (group: PurchaseOrderDeliveryPrintGroupView) => void | Promise<void>;
  onClose: () => void;
};

const PO_DETAIL_TABS: Array<{ key: DetailTabKey; label: string; icon: React.ReactNode; targetId: string }> = [
  { key: 'items', label: 'Hàng hóa', icon: <Package size={14} />, targetId: 'po-section-items' },
  { key: 'deliveries', label: 'Đợt giao', icon: <Truck size={14} />, targetId: 'po-section-deliveries' },
  { key: 'documents', label: 'Chứng từ', icon: <FileText size={14} />, targetId: 'po-section-documents' },
  { key: 'history', label: 'Lịch sử', icon: <History size={14} />, targetId: 'po-section-history' },
  { key: 'overview', label: 'Tổng quan', icon: <ShieldCheck size={14} />, targetId: 'po-section-overview' },
];

{/* role="tab" */}

const fmtMoney = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
const fmtUnitPrice = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const fmtQty = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const actionIcon = (action: PurchaseOrderUiAction) => {
  if (action.id === 'request_approval' || action.id === 'submit_package') return <Send size={14} />;
  if (action.id === 'approve_po' || action.id === 'approve_package' || action.id === 'approve_supplemental' || action.id === 'close_short') return <CheckCircle2 size={14} />;
  if (action.id === 'request_revision' || action.id === 'reject_supplemental') return <RefreshCcw size={14} />;
  if (action.id === 'create_delivery' || action.id === 'create_supplemental_delivery' || action.id === 'add_delivery' || action.id === 'clone_delivery' || action.id === 'cancel_delivery') return <Truck size={14} />;
  if (action.id === 'create_receipt' || action.id === 'open_delivery_qr') return <QrCode size={14} />;
  if (action.id === 'open_wms_transaction') return <ShieldCheck size={14} />;
  if (action.id === 'create_supplier_payable') return <WalletCards size={14} />;
  if (action.id === 'supplier_return') return <PackageX size={14} />;
  if (action.id.includes('print')) return <Printer size={14} />;
  if (action.id === 'clone_po') return <Copy size={14} />;
  if (action.id === 'edit_po') return <Edit2 size={14} />;
  if (action.id === 'remove_po') return <Trash2 size={14} />;
  return <FileText size={14} />;
};

const actionClass = (action: PurchaseOrderUiAction, primary = false) => {
  if (action.disabled) return 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed';
  if (action.intent === 'danger') return primary
    ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700 shadow-md shadow-rose-600/20'
    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300';
  if (action.intent === 'success') return primary
    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (action.intent === 'warning') return primary
    ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600 shadow-md shadow-amber-500/20'
    : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300';
  if (action.intent === 'primary' || primary) return 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20';
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900';
};

const normalizeDeliveryTimelineStatus = (status?: string | null): PurchaseOrderDeliveryBatch['status'] => {
  if (['received', 'received_short', 'received_over'].includes(status || '')) return 'received';
  if (status === 'quality_approved') return 'quality_approved';
  if (status === 'supplemental_pending') return 'supplemental_pending';
  if (status === 'wms_pending' || status === 'waiting_delivery' || status === 'receiving' || status === 'issued' || status === 'variance_pending') return 'wms_pending';
  if (status === 'cancelled' || status === 'returned') return 'cancelled';
  return 'planned';
};

const deliveryStatusView = (status?: string | null, approvalStatus?: PurchaseOrderDeliveryBatch['approvalStatus']) => {
  const normalizedStatus = normalizeDeliveryTimelineStatus(status);
  if (normalizedStatus === 'received') return { label: 'Đã nhập kho', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (normalizedStatus === 'quality_approved') return { label: 'Đã duyệt SL/CL', className: 'border-cyan-200 bg-cyan-50 text-cyan-700' };
  if (normalizedStatus === 'supplemental_pending') return { label: 'Chờ duyệt bổ sung', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (normalizedStatus === 'wms_pending') return { label: 'Chờ kho duyệt', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (normalizedStatus === 'cancelled') return { label: 'Từ chối', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  if (approvalStatus === 'pending_approval') return { label: 'Chờ duyệt đơn', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (approvalStatus === 'approved') return { label: 'Đã duyệt đơn', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (approvalStatus === 'revision_requested') return { label: 'Cần chỉnh sửa', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (approvalStatus === 'rejected') return { label: 'Từ chối', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  return { label: 'Kế hoạch', className: 'border-blue-200 bg-blue-50 text-blue-700' };
};

const payableStatusView = (status?: SupplierPayableDocument['status'] | 'none') => {
  if (status === 'paid') return { label: 'Đã thanh toán', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (status === 'partial') return { label: 'Thanh toán một phần', className: 'border-blue-200 bg-blue-50 text-blue-700' };
  if (status === 'open' || status === 'payable') return { label: 'Còn phải trả', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  if (status === 'draft') return { label: 'Nháp công nợ', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (status === 'cancelled') return { label: 'Đã hủy', className: 'border-slate-200 bg-slate-100 text-slate-500' };
  return { label: 'Chưa tạo AP', className: 'border-slate-200 bg-slate-50 text-slate-600' };
};

const getHeaderLabel = (key: string, items: PurchaseOrderItem[]) => {
  const meta = DEFAULT_SPEC_METADATA[key];
  if (meta) return meta.label + (meta.unit ? ` (${meta.unit})` : '');
  for (const item of items) {
    const spec = item.specs?.[key];
    if (spec?.label) return spec.label + (spec.unit ? ` (${spec.unit})` : '');
  }
  return key;
};

// Component Avatar Nhân Sự
const UserAvatar: React.FC<{
  name?: string | null;
  avatar?: string | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}> = ({ name, avatar, size = 'sm', className = '' }) => {
  const displayName = name || 'User';
  const sizeClasses = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
  }[size];

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={displayName}
        className={`${sizeClasses} rounded-full object-cover ring-2 ring-white dark:ring-slate-800 shrink-0 ${className}`}
      />
    );
  }

  const initial = (displayName.trim().split(' ').pop() || displayName).charAt(0).toUpperCase() || 'U';
  return (
    <div
      className={`${sizeClasses} rounded-full bg-gradient-to-br from-teal-500 to-indigo-600 text-white font-black flex items-center justify-center ring-2 ring-white dark:ring-slate-800 shrink-0 shadow-xs ${className}`}
      title={displayName}
    >
      {initial}
    </div>
  );
};

const PurchaseOrderCockpitDrawer: React.FC<PurchaseOrderCockpitDrawerProps> = ({
  po,
  requestTitle,
  materialSummary,
  sourceLabel,
  targetWarehouseName,
  groupLabel,
  statusLabel,
  statusTone,
  uiPolicy,
  receiptStats,
  displayAmount,
  vatRate,
  vatAmount,
  paymentTotal,
  inventoryItems,
  warehouses,
  poRequestLinks,
  deliveryBatches,
  deliveryPrintGroups,
  supplierReturns,
  supplierPayableDocuments,
  supplierPayableLoading = false,
  supplierPayableError = null,
  supplierReturnableQty,
  totalReceivedQty,
  completedReturnQty,
  pendingReturnQty,
  canMutatePoDocument,
  canConfirmPo,
  poHasStockImpact,
  creatingDeliveryBatchId,
  deletingDeliveryKey,
  printingPoId,
  isLoadingDeliveryPrintGroups,
  getPrintGroupForBatch,
  getWmsTransactionIdForBatch,
  onRunAction,
  onPrintDeliveryGroup,
  onEditSchedule,
  onRemovePlannedBatch,
  onCreateDeliveryReceipt,
  onRemoveFailedDeliveryBatch,
  onRemoveFailedDeliveryGroup,
  onClose,
}) => {
  const { users = [], employees = [] } = useApp();
  const [activeTab, setActiveTab] = useState<DetailTabKey>('overview');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setActiveTab('overview');
    setMenuOpen(false);
  }, [po.id]);

  // Helper resolve user avatar & name (an toàn tuyệt đối, không match nhầm khi undefined)
  const getUserInfo = (userIdOrName?: string | null) => {
    if (!userIdOrName || typeof userIdOrName !== 'string') return null;
    const clean = userIdOrName.trim();
    if (!clean) return null;

    const u = (users || []).find(
      user => (user.id && user.id === clean) ||
              (user.name && user.name.toLowerCase() === clean.toLowerCase()) ||
              (user.email && user.email.toLowerCase() === clean.toLowerCase()) ||
              (user.username && user.username.toLowerCase() === clean.toLowerCase())
    );

    const emp = (employees || []).find(
      e => (u?.id && e.userId && e.userId === u.id) ||
           (e.id && e.id === clean) ||
           (e.fullName && e.fullName.toLowerCase() === clean.toLowerCase()) ||
           (e.email && e.email.toLowerCase() === clean.toLowerCase())
    );

    if (!u && !emp) return null;

    const name = emp?.fullName || u?.name || clean;
    const avatar = emp?.avatarUrl || u?.avatar || null;
    const role = emp?.title || u?.role || '';
    return { id: u?.id || emp?.id || clean, name, avatar, role };
  };

  const receiptPercent = receiptStats.orderedQty > 0
    ? Math.min(100, Math.round((receiptStats.receivedQty / receiptStats.orderedQty) * 100))
    : 0;
  const payableRecognized = supplierPayableDocuments.reduce((sum, document) => sum + Number(document.recognizedAmount || 0), 0);
  const payablePaid = supplierPayableDocuments.reduce((sum, document) => sum + Number(document.paidAmount || 0), 0);
  const payableOutstanding = supplierPayableDocuments.reduce((sum, document) => sum + Number(document.outstandingAmount || 0), 0);
  const payableStatus = supplierPayableDocuments[0]?.status || 'none';
  const payableView = payableStatusView(payableStatus);
  const isPackageV2 = (po.purchaseMode === 'single' || po.purchaseMode === 'multiple') && po.sourceMode === 'from_request';
  const packageSummary = useMemo(() => getPurchasePackageSummary(po, deliveryBatches), [deliveryBatches, po]);
  const practicalQuantitySummary = useMemo(() => {
    const demandQty = po.items.reduce((sum, item) => sum + getPurchaseOrderLineDemandQty(
      po,
      item.lineId || item.itemId,
      poRequestLinks,
      inventoryItems,
    ), 0);
    const approvedBatches = deliveryBatches.filter(batch => (
      batch.status !== 'cancelled' && batch.approvalStatus === 'approved'
    ));
    const approvedQty = approvedBatches.reduce(
      (sum, batch) => sum + batch.lines.reduce((lineSum, line) => lineSum + Number(line.plannedQty || 0), 0),
      0,
    );
    const receivedQty = approvedBatches
      .filter(batch => ['received', 'received_short', 'received_over'].includes(batch.status))
      .reduce(
        (sum, batch) => sum + batch.lines.reduce((lineSum, line) => lineSum + Number(line.acceptedStockQty || 0), 0),
        0,
      );
    return { demandQty, approvedQty, receivedQty, remainingQty: demandQty - receivedQty };
  }, [deliveryBatches, inventoryItems, po, poRequestLinks]);
  const uniqueSpecKeys = useMemo(() => Array.from(
    new Set(
      po.items.flatMap(item =>
        item.specs ? Object.keys(item.specs).filter(key => {
          const value = item.specs?.[key]?.value;
          return value !== undefined && value !== null && value !== '';
        }) : [],
      ),
    ),
  ).sort((a, b) => {
    const indexA = SPEC_KEY_ORDER.indexOf(a);
    const indexB = SPEC_KEY_ORDER.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  }), [po.items]);

  const deliveryTimelineGroups = useMemo(() => {
    const itemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
    const scheduleGroups = deliveryBatches.map(batch => {
      const printGroup = getPrintGroupForBatch(batch);
      const targetWarehouse = warehouses.find(row => row.id === (batch as any).targetWarehouseId)?.name || targetWarehouseName || '—';
      const totalQty = batch.lines.reduce((sum, line) => sum + Number(line.stockPlannedQty ?? line.plannedQty ?? 0), 0);
      const totalAmount = batch.lines.reduce((sum, line) => (
        sum + Number(line.plannedQty || 0) * getPurchaseOrderScheduleLineUnitPrice({
          po,
          item: itemByLineId.get(line.purchaseOrderLineId),
          line,
        })
      ), 0);
      return {
        key: `schedule:${batch.id}`,
        source: 'schedule' as const,
        label: po.purchaseMode === 'single'
          ? 'Đơn mua hàng'
          : `Đợt ${String(batch.deliveryNo).padStart(2, '0')}`,
        marker: String(batch.deliveryNo),
        plannedDate: batch.plannedDeliveryDate || null,
        status: batch.status,
        targetWarehouse,
        lineCount: batch.lines.length,
        totalQty,
        totalAmount,
        printGroup,
        scheduleBatch: batch,
        wmsTransactionId: getWmsTransactionIdForBatch?.(batch) || null,
      };
    });

    const schedulePrintGroupKeys = new Set<string>();
    scheduleGroups.forEach(group => {
      schedulePrintGroupKeys.add(group.printGroup.key);
      if (group.scheduleBatch?.id) schedulePrintGroupKeys.add(group.scheduleBatch.id);
    });

    const supplementalGroups = deliveryPrintGroups
      .filter(group => !group.scheduleBatch && !schedulePrintGroupKeys.has(group.key))
      .map((group, index) => {
        const targetWarehouse = warehouses.find(row => row.id === group.targetWarehouseId)?.name || targetWarehouseName || '—';
        const totalQty = group.lines.reduce((sum, line) => sum + Number(line.issuedQty || line.receivedQty || 0), 0);
        const totalAmount = group.lines.reduce((sum, line) => sum + Number(line.issuedQty || 0) * Number(line.deliveryUnitPrice || 0), 0);
        const firstPendingBatch = group.batches.find(batch => ['issued', 'variance_pending'].includes(String(batch.status || '').toLowerCase()));
        return {
          key: `print-group:${group.key}`,
          source: 'print_group' as const,
          label: group.label || `Đợt bổ sung ${index + 1}`,
          marker: String(deliveryBatches.length + index + 1),
          plannedDate: group.plannedDate || null,
          status: group.status,
          targetWarehouse,
          lineCount: group.lines.length,
          totalQty,
          totalAmount,
          printGroup: group,
          scheduleBatch: null,
          wmsTransactionId: firstPendingBatch?.transactionId || group.batches[0]?.transactionId || null,
        };
      });

    return [...scheduleGroups, ...supplementalGroups].sort((a, b) => {
      const dateCompare = String(a.plannedDate || '').localeCompare(String(b.plannedDate || ''));
      if (dateCompare !== 0) return dateCompare;
      return a.label.localeCompare(b.label, 'vi');
    });
  }, [deliveryBatches, deliveryPrintGroups, getPrintGroupForBatch, getWmsTransactionIdForBatch, po, targetWarehouseName, warehouses]);

  const hasWmsPending = deliveryTimelineGroups.some(group => normalizeDeliveryTimelineStatus(group.status) === 'wms_pending');
  const hasReceivedDelivery = deliveryTimelineGroups.some(group => normalizeDeliveryTimelineStatus(group.status) === 'received') || receiptStats.receivedQty > 0;
  const hasDelivery = deliveryTimelineGroups.length > 0;

  // Resolve actors for the stepper (Chỉ gán người cho bước Tạo và bước Duyệt)
  const creatorUser = getUserInfo(po.createdById) || (po.lastActionBy ? getUserInfo(po.lastActionBy) : null);
  const isApproved = !['draft', 'sent'].includes(po.status);
  const approverUser = isApproved
    ? getUserInfo(po.lastActionBy) || getUserInfo(po.submittedToName) || getUserInfo(po.submittedToUserId)
    : getUserInfo(po.submittedToName) || getUserInfo(po.submittedToUserId) || getUserInfo(po.workflowStepActorUserId);

  const stepperWithAvatars = isPackageV2
    ? [
      {
        key: 'created',
        stepNo: 1,
        title: 'Tạo đơn',
        done: true,
        current: po.status === 'draft',
        user: creatorUser,
        icon: <UserIcon size={15} />,
        mainLabel: creatorUser?.name || 'Người tạo đơn',
        roleLabel: 'Người tạo đơn',
        dateLabel: formatDate(po.orderDate || po.createdAt),
        statusBadge: 'Đã tạo',
        tone: 'emerald',
      },
      {
        key: 'approved',
        stepNo: 2,
        title: 'Duyệt đơn',
        done: isApproved,
        current: po.status === 'sent',
        user: approverUser,
        icon: <ShieldCheck size={15} />,
        mainLabel: isApproved
          ? (approverUser?.name ? approverUser.name : 'Đã duyệt đơn')
          : (approverUser?.name ? `Chờ: ${approverUser.name}` : 'Chờ phê duyệt'),
        roleLabel: isApproved ? 'Người phê duyệt' : po.submittedToPermission ? `Quyền ${po.submittedToPermission}` : 'Chờ duyệt',
        dateLabel: isApproved ? formatDate(po.lastActionAt || po.orderDate) : 'Đang chờ xử lý',
        statusBadge: isApproved ? 'Đã duyệt' : po.status === 'sent' ? 'Chờ duyệt' : 'Chưa gửi',
        tone: isApproved ? 'emerald' : po.status === 'sent' ? 'amber' : 'slate',
      },
      {
        key: 'delivery',
        stepNo: 3,
        title: po.purchaseMode === 'single' ? 'Giao hàng' : 'Các đợt mua',
        done: hasDelivery || ['partial', 'delivered', 'closed'].includes(po.status),
        current: ['confirmed', 'in_transit'].includes(po.status) && !hasReceivedDelivery,
        user: null,
        icon: <Truck size={15} className="text-blue-600 dark:text-blue-400" />,
        mainLabel: isApproved ? (hasDelivery ? `${deliveryTimelineGroups.length} đợt giao` : 'Đang giao hàng') : 'Kế hoạch giao',
        roleLabel: targetWarehouseName ? `Kho ${targetWarehouseName}` : 'Kho nhận hàng',
        dateLabel: deliveryTimelineGroups.length > 0 ? `${deliveryTimelineGroups.length} đợt` : 'Theo tiến độ',
        statusBadge: hasDelivery ? `${deliveryTimelineGroups.length} đợt` : isApproved ? 'Đang giao' : 'Chưa có đợt',
        tone: hasDelivery ? 'emerald' : isApproved ? 'blue' : 'slate',
      },
      {
        key: 'receipt',
        stepNo: 4,
        title: 'SL / CL (KCS)',
        done: hasReceivedDelivery,
        current: hasWmsPending || po.status === 'partial',
        user: null,
        icon: <ShieldCheck size={15} className="text-amber-600 dark:text-amber-400" />,
        mainLabel: hasReceivedDelivery ? 'Đã nhận hàng' : hasWmsPending ? 'Chờ kho duyệt' : 'Kiểm nhận KCS',
        roleLabel: 'Kiểm nhận & KCS',
        dateLabel: `Nhận ${fmtQty(receiptStats.receivedQty)}/${fmtQty(receiptStats.orderedQty)}`,
        statusBadge: hasReceivedDelivery ? 'Đã nhận hàng' : hasWmsPending ? 'Chờ kho duyệt' : 'Chờ giao',
        tone: hasReceivedDelivery ? 'emerald' : hasWmsPending ? 'amber' : 'slate',
      },
      {
        key: 'closed',
        stepNo: 5,
        title: 'Hoàn tất',
        done: ['delivered', 'closed'].includes(po.status),
        current: po.status === 'partial',
        user: null,
        icon: <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />,
        mainLabel: ['delivered', 'closed'].includes(po.status) ? 'Đã hoàn tất' : 'Chờ hoàn tất đơn',
        roleLabel: 'Theo dõi đơn mua',
        dateLabel: ['delivered', 'closed'].includes(po.status) ? 'Hoàn thành' : 'Theo dõi',
        statusBadge: ['delivered', 'closed'].includes(po.status) ? 'Hoàn tất' : 'Chưa hoàn tất',
        tone: ['delivered', 'closed'].includes(po.status) ? 'emerald' : 'slate',
      },
    ]
    : [
      {
        key: 'created',
        stepNo: 1,
        title: 'Tạo PO',
        done: true,
        current: po.status === 'draft',
        user: creatorUser,
        icon: <UserIcon size={15} />,
        mainLabel: creatorUser?.name || 'Người tạo đơn',
        roleLabel: 'Người tạo đơn',
        dateLabel: formatDate(po.orderDate || po.createdAt),
        statusBadge: 'Đã tạo',
        tone: 'emerald',
      },
      {
        key: 'approved',
        stepNo: 2,
        title: 'Duyệt PO',
        done: isApproved,
        current: po.status === 'sent',
        user: approverUser,
        icon: <ShieldCheck size={15} />,
        mainLabel: isApproved
          ? (approverUser?.name ? approverUser.name : 'Đã duyệt PO')
          : (approverUser?.name ? `Chờ: ${approverUser.name}` : 'Chờ phê duyệt'),
        roleLabel: isApproved ? 'Người phê duyệt' : po.submittedToPermission ? `Quyền ${po.submittedToPermission}` : 'Chờ duyệt',
        dateLabel: isApproved ? formatDate(po.lastActionAt || po.orderDate) : 'Đang chờ xử lý',
        statusBadge: isApproved ? 'Đã duyệt' : po.status === 'sent' ? 'Chờ duyệt' : 'Chưa gửi',
        tone: isApproved ? 'emerald' : po.status === 'sent' ? 'amber' : 'slate',
      },
      {
        key: 'delivery',
        stepNo: 3,
        title: 'Giao hàng',
        done: hasDelivery || ['partial', 'delivered', 'closed'].includes(po.status),
        current: ['confirmed', 'in_transit'].includes(po.status) && !hasReceivedDelivery,
        user: null,
        icon: <Truck size={15} className="text-blue-600 dark:text-blue-400" />,
        mainLabel: isApproved ? (hasDelivery ? `${deliveryTimelineGroups.length} đợt giao` : 'Đang giao hàng') : 'Kế hoạch giao',
        roleLabel: targetWarehouseName ? `Kho ${targetWarehouseName}` : 'Kho nhận hàng',
        dateLabel: deliveryTimelineGroups.length > 0 ? `${deliveryTimelineGroups.length} đợt` : 'Theo tiến độ',
        statusBadge: hasDelivery ? `${deliveryTimelineGroups.length} đợt` : isApproved ? 'Đang giao' : 'Chưa có đợt',
        tone: hasDelivery ? 'emerald' : isApproved ? 'blue' : 'slate',
      },
      {
        key: 'receipt',
        stepNo: 4,
        title: 'Nhập kho',
        done: hasReceivedDelivery,
        current: hasWmsPending || po.status === 'partial',
        user: null,
        icon: <ShieldCheck size={15} className="text-amber-600 dark:text-amber-400" />,
        mainLabel: hasReceivedDelivery ? 'Đã nhập kho' : hasWmsPending ? 'Chờ kho duyệt' : 'Chờ nhận hàng',
        roleLabel: 'Kiểm nhận WMS',
        dateLabel: `Nhận ${fmtQty(receiptStats.receivedQty)}/${fmtQty(receiptStats.orderedQty)}`,
        statusBadge: hasReceivedDelivery ? 'Đã nhập kho' : hasWmsPending ? 'Chờ kho duyệt' : 'Chờ giao',
        tone: hasReceivedDelivery ? 'emerald' : hasWmsPending ? 'amber' : 'slate',
      },
      {
        key: 'payable',
        stepNo: 5,
        title: 'Công nợ NCC',
        done: supplierPayableDocuments.length > 0,
        current: hasReceivedDelivery && supplierPayableDocuments.length === 0,
        user: null,
        icon: <WalletCards size={15} className="text-indigo-600 dark:text-indigo-400" />,
        mainLabel: supplierPayableDocuments.length > 0 ? payableView.label : 'Công nợ NCC',
        roleLabel: 'Hạch toán AP',
        dateLabel: payableView.label,
        statusBadge: supplierPayableDocuments.length > 0 ? 'Có AP' : 'Chưa tạo AP',
        tone: supplierPayableDocuments.length > 0 ? 'emerald' : 'slate',
      },
      {
        key: 'payment',
        stepNo: 6,
        title: 'Thanh toán',
        done: payableStatus === 'paid',
        current: supplierPayableDocuments.length > 0 && payableOutstanding > 0,
        user: null,
        icon: <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />,
        mainLabel: payableStatus === 'paid' ? 'Đã thanh toán' : payableOutstanding > 0 ? 'Còn phải trả' : 'Thanh toán',
        roleLabel: 'Chi trả NCC',
        dateLabel: payableOutstanding > 0 ? `Còn ${fmtMoney(payableOutstanding)} đ` : 'Hoàn tất',
        statusBadge: payableStatus === 'paid' ? 'Đã chi' : 'Chưa trả hết',
        tone: payableStatus === 'paid' ? 'emerald' : 'slate',
      },
    ];

  const renderActionButton = (action: PurchaseOrderUiAction, primary = false, className = '') => (
    <button
      key={`${action.id}:${action.deliveryBatchId || action.transactionId || action.label}`}
      type="button"
      disabled={action.disabled}
      title={action.disabledReason || action.label}
      onClick={() => void onRunAction(action)}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-black transition active:scale-[0.98] disabled:opacity-60 ${actionClass(action, primary)} ${className}`}
    >
      {actionIcon(action)}
      {action.label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/45 backdrop-blur-xs animate-in fade-in duration-150" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[min(1760px,calc(100vw-48px))] max-w-[min(1320px,calc(100vw-24px))] flex-col overflow-hidden border-l border-slate-200 bg-slate-50/70 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
        onClick={event => event.stopPropagation()}
      >
        {/* HEADER TOP BAR */}
        <div className="sticky top-0 z-30 shrink-0 border-b border-slate-200/90 bg-white/95 px-5 py-4 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 font-mono text-sm font-black uppercase tracking-wide text-blue-700 dark:text-blue-300 border border-blue-200/60">
                  {po.poNumber}
                </span>
                <StatusBadge status={po.status} label={statusLabel} tone={statusTone} showDot={false} size="md" />
                {uiPolicy.alerts.slice(0, 2).map(alert => (
                  <span
                    key={alert.id}
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-black ${alert.tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                  >
                    {alert.label}
                  </span>
                ))}
              </div>
              <h3 className="mt-1.5 truncate text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100">
                {requestTitle}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>NCC: <strong className="text-slate-800 dark:text-slate-200">{po.vendorName || '—'}</strong></span>
                <span>Kho nhận: <strong className="text-slate-800 dark:text-slate-200">{targetWarehouseName || '—'}</strong></span>
                {groupLabel && <span>{groupLabel}</span>}
              </div>
            </div>

            {/* Quick Actions & Close */}
            <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-end">
              <div className="text-right bg-emerald-50/60 dark:bg-emerald-950/30 px-3.5 py-1.5 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  {isPackageV2 ? 'Giá trị chủ trương gồm VAT' : 'Tổng thanh toán gồm VAT'}
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-700 dark:text-emerald-300">
                  {fmtMoney(isPackageV2 ? packageSummary.referenceGross : paymentTotal)} đ
                </div>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(prev => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-950 shadow-xs"
                  title="Hành động phụ"
                >
                  <MoreVertical size={17} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950 animate-in fade-in">
                    {uiPolicy.menuActions.map(action => (
                      <button
                        key={action.id}
                        type="button"
                        disabled={action.disabled}
                        title={action.disabledReason || action.label}
                        onClick={() => {
                          setMenuOpen(false);
                          void onRunAction(action);
                        }}
                        className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-black transition disabled:pointer-events-auto disabled:opacity-60 ${actionClass(action, false)}`}
                      >
                        {actionIcon(action)}
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-950 shadow-xs"
                title="Đóng chi tiết PO"
              >
                <X size={19} />
              </button>
            </div>
          </div>
        </div>

        {/* BODY CONTAINER */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid min-h-full gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6">
            {/* MAIN COLUMN: TIẾN TRÌNH NHÂN SỰ + TIỀN + BẢNG HÀNG HÓA */}
            <main className="min-w-0 space-y-4">
              {/* STEPPER NHÂN SỰ VÀ TIẾN TRÌNH VỚI AVATAR */}
              <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2.5 flex items-center justify-between text-[11px] font-black uppercase text-slate-400">
                  <span>Tiến trình xử lý & Nhân sự phụ trách</span>
                  <span className="text-teal-600 font-bold">{stepperWithAvatars.length} Giai đoạn PO</span>
                </div>

                <div className={`grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 ${stepperWithAvatars.length > 5 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
                  {stepperWithAvatars.map(step => {
                    const isDone = step.done;
                    const isCurrent = step.current;
                    const containerClass = isDone
                      ? 'border-emerald-200/80 bg-emerald-50/40 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                      : isCurrent
                        ? 'border-teal-400 bg-teal-50/50 text-teal-900 ring-2 ring-teal-400/20 shadow-xs dark:border-teal-700 dark:bg-teal-950/30'
                        : 'border-slate-200/80 bg-slate-50/60 text-slate-400 dark:border-slate-800 dark:bg-slate-900/40';

                    return (
                      <div
                        key={step.key}
                        className={`relative rounded-xl border p-3 flex flex-col justify-between space-y-2 transition ${containerClass}`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-black uppercase tracking-wider opacity-75">
                            Bước {step.stepNo}: {step.title}
                          </span>
                          {isDone ? (
                            <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                          ) : isCurrent ? (
                            <Clock size={15} className="text-teal-600 animate-pulse shrink-0" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-700 shrink-0" />
                          )}
                        </div>

                        {/* Person Avatar or Step Icon */}
                        <div className="flex items-center gap-2 min-w-0 pt-0.5">
                          {step.user ? (
                            <UserAvatar
                              name={step.user.name}
                              avatar={step.user.avatar}
                              size="sm"
                              className={isCurrent ? 'ring-2 ring-teal-500 ring-offset-1' : ''}
                            />
                          ) : (
                            <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${
                              isDone ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' :
                              isCurrent ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' :
                              'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}>
                              {step.icon || <UserIcon size={14} />}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="font-black text-xs text-slate-800 dark:text-white truncate" title={step.mainLabel}>
                              {step.mainLabel}
                            </div>
                            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                              {step.roleLabel}
                            </div>
                          </div>
                        </div>

                        {/* Date / Status Tag */}
                        <div className="pt-1.5 border-t border-slate-200/50 dark:border-slate-800 flex items-center justify-between text-[10px] font-bold">
                          <span className="opacity-80">{step.dateLabel}</span>
                          <span className={`px-1.5 py-0.2 rounded font-black ${isDone ? 'bg-emerald-100 text-emerald-800' : isCurrent ? 'bg-teal-100 text-teal-800' : 'bg-slate-200/80 text-slate-600'}`}>
                            {step.statusBadge}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {isPackageV2 && (
                <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Nhu cầu MR</span>
                      <strong className="mt-1 block text-lg font-black text-slate-800">{fmtQty(practicalQuantitySummary.demandQty)}</strong>
                    </div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-blue-500">Đã duyệt đặt</span>
                      <strong className="mt-1 block text-lg font-black text-blue-700">{fmtQty(practicalQuantitySummary.approvedQty)}</strong>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-emerald-600">Đã thực nhập</span>
                      <strong className="mt-1 block text-lg font-black text-emerald-700">{fmtQty(practicalQuantitySummary.receivedQty)}</strong>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-amber-600">Còn lại / Vượt</span>
                      <strong className={`mt-1 block text-lg font-black ${practicalQuantitySummary.remainingQty < 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                        {practicalQuantitySummary.remainingQty < 0
                          ? `Vượt ${fmtQty(Math.abs(practicalQuantitySummary.remainingQty))}`
                          : fmtQty(practicalQuantitySummary.remainingQty)}
                      </strong>
                    </div>
                  </div>
                </section>
              )}

              {/* KHU VỰC TIỀN VÀ BASELINE (MONEY FOCUS BAR) */}
              <section className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/50 to-emerald-50/20 p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-center">
                  <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xs">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Tiền hàng trước VAT</span>
                    <strong className="text-base sm:text-lg font-black text-slate-800 dark:text-white mt-0.5 block">
                      {fmtMoney(displayAmount)} đ
                    </strong>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xs">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Thuế VAT ({vatRate}%)</span>
                    <strong className="text-base sm:text-lg font-black text-slate-800 dark:text-white mt-0.5 block">
                      {fmtMoney(vatAmount)} đ
                    </strong>
                  </div>

                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/30 shadow-xs">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      {isPackageV2 ? 'Tổng tham chiếu gồm VAT' : 'Tổng thanh toán gồm VAT'}
                    </span>
                    <strong className="text-lg sm:text-xl font-black text-emerald-700 dark:text-emerald-300 mt-0.5 block">
                      {fmtMoney(isPackageV2 ? packageSummary.referenceGross : paymentTotal)} đ
                    </strong>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xs">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400 mb-1">
                      <span>Tiến độ nhận hàng</span>
                      <span className="text-teal-600 font-mono">{receiptPercent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300" style={{ width: `${receiptPercent}%` }} />
                    </div>
                    <span className="mt-1 block text-[10px] font-bold text-slate-400 truncate">
                      Đã nhận {fmtQty(receiptStats.receivedQty)}/{fmtQty(receiptStats.orderedQty)} • Còn {fmtQty(receiptStats.remainingQty)}
                    </span>
                  </div>
                </div>
              </section>

              {/* KHU VỰC HÀNG HÓA VÀ VẬT TƯ (PRIMARY FOCUS) */}
              <section className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
                      <Package size={16} />
                    </div>
                    <div>
                      <h4 className="text-base font-black text-slate-800 dark:text-slate-100">
                        Danh mục Hàng hóa & Vật tư ({po.items.length} mặt hàng)
                      </h4>
                      <p className="text-xs font-semibold text-slate-400">
                        Đã nhận {fmtQty(receiptStats.receivedQty)}/{fmtQty(receiptStats.orderedQty)} • Còn thiếu {fmtQty(receiptStats.remainingQty)}
                      </p>
                    </div>
                  </div>
                </div>

                <div id={`po-items-table-${po.id}`} className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-slate-100/90 text-slate-600 dark:bg-slate-800/90 dark:text-slate-300 text-xs font-black uppercase tracking-wide border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-4 py-3">Tên vật tư</th>
                        {uniqueSpecKeys.map(key => <th key={key} className="px-3 py-3 text-center">{getHeaderLabel(key, po.items)}</th>)}
                        <th className="px-3 py-3 text-right">SL đặt</th>
                        <th className="px-3 py-3 text-right">Đã nhận</th>
                        <th className="px-3 py-3 text-right">Còn thiếu</th>
                        <th className="px-3 py-3 text-right">Đơn giá</th>
                        <th className="px-3 py-3 text-right">Thành tiền</th>
                        <th className="px-4 py-3 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {po.items.map((item, index) => {
                        const inventory = inventoryItems.find(row => row.id === item.itemId);
                        const stockUnit = getPoLineStockUnit(item, inventory);
                        const lineKey = item.lineId || item.itemId;
                        const demandQty = getPurchaseOrderLineDemandQty(po, lineKey, poRequestLinks, inventoryItems);
                        const completedReturnQty = Math.max(
                          Number(item.returnedQty || 0),
                          supplierReturns
                            .filter(returnDoc => returnDoc.status === 'completed')
                            .reduce((sum, returnDoc) => sum + returnDoc.lines
                              .filter(line => line.purchaseOrderLineId === lineKey)
                              .reduce((lineSum, line) => lineSum + Number(line.returnQty || 0), 0), 0),
                        );
                        const netReceivedQty = Math.max(0, Number(item.receivedQty || 0) - completedReturnQty);
                        const remainingQty = Math.max(0, demandQty - netReceivedQty);
                        const lineAmount = getPurchaseOrderDisplayLineAmount(po, item, deliveryBatches);
                        const lineStatus = remainingQty <= 0
                          ? { label: 'Đã đủ', tone: 'success' as ErpStatusTone }
                          : netReceivedQty > 0
                            ? { label: 'Nhận một phần', tone: 'attention' as ErpStatusTone }
                            : { label: 'Chờ nhận', tone: 'warning' as ErpStatusTone };
                        return (
                          <tr key={`${lineKey}:${index}`} className="hover:bg-teal-50/20 dark:hover:bg-slate-900/50 transition">
                            <td className="px-4 py-3.5 align-top">
                              <div className="text-sm font-black text-slate-800 dark:text-slate-100">{item.name}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold text-slate-400">
                                {item.sku && <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded text-[11px]">{item.sku}</span>}
                                {item.requestCode && <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700 text-[10px]">YC {item.requestCode}</span>}
                                {item.materialBudgetItemName && <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700 text-[10px]">{item.materialBudgetItemName}</span>}
                                {item.workBoqItemName && <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700 text-[10px]">{item.workBoqItemName}</span>}
                              </div>
                              {(item.neededDate || item.note || item.pricingMode) && (
                                <div className="mt-1 text-xs font-semibold text-slate-500">
                                  {item.neededDate ? `Ngày cần: ${item.neededDate}` : ''}
                                  {item.note ? ` ${item.note}` : ''}
                                  {item.pricingMode && item.pricingMode !== 'standard' ? ` ${formatPricingFormula(item)}` : ''}
                                </div>
                              )}
                            </td>
                            {uniqueSpecKeys.map(key => (
                              <td key={key} className="px-3 py-3.5 text-center font-bold text-slate-600 dark:text-slate-300">
                                {item.specs?.[key]?.value ?? '—'}
                              </td>
                            ))}
                            <td className="px-3 py-3.5 text-right font-black text-slate-800 dark:text-slate-100">
                              {fmtQty(demandQty)} <span className="text-xs text-slate-500 font-semibold">{stockUnit || item.unit}</span>
                            </td>
                            <td className="px-3 py-3.5 text-right font-black text-emerald-700">{fmtQty(netReceivedQty)}</td>
                            <td className={`px-3 py-3.5 text-right font-black ${remainingQty > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmtQty(remainingQty)}</td>
                            <td className="px-3 py-3.5 text-right font-bold text-slate-700 dark:text-slate-300">{fmtUnitPrice(lineAmount.unitPrice)}</td>
                            <td className="px-3 py-3.5 text-right font-black text-slate-900 dark:text-slate-100">{fmtMoney(lineAmount.totalAmount)} đ</td>
                            <td className="px-4 py-3.5 text-center"><StatusBadge status={lineStatus.label} label={lineStatus.label} tone={lineStatus.tone} showDot={false} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* KHU VỰC ĐỢT GIAO HÀNG */}
              <section className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                      <Truck size={16} />
                    </div>
                    <div>
                      <h4 className="text-base font-black text-slate-800 dark:text-slate-100">
                        {isPackageV2 ? (po.purchaseMode === 'single' ? 'Đơn mua hàng' : 'Các đợt mua') : 'Kế hoạch giao hàng'}
                      </h4>
                      <p className="text-xs font-semibold text-slate-400">
                        {po.purchaseMode === 'single'
                          ? 'Một đơn, một lần giao, duyệt SL/CL rồi nhập kho.'
                          : 'Mỗi đợt có số lượng, giá và VAT riêng theo thực tế.'}
                      </p>
                    </div>
                  </div>
                  {isLoadingDeliveryPrintGroups && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400">
                      <Loader2 size={14} className="animate-spin" /> Đang tải WMS
                    </span>
                  )}
                </div>

                {deliveryTimelineGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm font-bold text-slate-400">
                    Chưa có đợt giao hàng nào được lập.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {deliveryTimelineGroups.map(group => {
                      const batch = group.scheduleBatch;
                      const status = deliveryStatusView(group.status, batch?.approvalStatus);
                      const printGroup = group.printGroup;
                      const printPoKey = `${po.id}:${printGroup.key}:purchase_order`;
                      const printApprovalKey = `${po.id}:${printGroup.key}:approval_request`;
                      const normalizedStatus = normalizeDeliveryTimelineStatus(group.status);
                      const canEditPlannedBatch = !!batch && canMutatePoDocument
                        && ['planned', 'supplemental_pending'].includes(batch.status)
                        && (!isPackageV2 || ['draft', 'revision_requested', 'rejected'].includes(batch.approvalStatus || 'draft'))
                        && !poHasStockImpact;
                      const isDeletingBatch = batch
                        ? deletingDeliveryKey === `batch:${batch.id}`
                        : deletingDeliveryKey === `group:${printGroup.key}`;
                      const wmsTransactionId = group.wmsTransactionId;

                      return (
                        <div key={group.key} className="relative rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 transition hover:border-blue-400">
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-xs font-black text-white shadow-xs">
                                  {group.marker}
                                </div>
                                <div>
                                  <div className="text-sm font-black text-slate-800 dark:text-slate-100">{group.label}</div>
                                  <div className="text-[11px] font-semibold text-slate-400">{formatDate(group.plannedDate)} • Kho: {group.targetWarehouse}</div>
                                </div>
                                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-black ${status.className}`}>{status.label}</span>
                              </div>
                              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5"><span className="block text-[10px] font-black uppercase text-slate-400">Số dòng</span><strong className="text-xs font-black">{group.lineCount} dòng</strong></div>
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5"><span className="block text-[10px] font-black uppercase text-slate-400">Tổng KL</span><strong className="text-xs font-black">{fmtQty(group.totalQty)}</strong></div>
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5"><span className="block text-[10px] font-black uppercase text-slate-400">Giá trị đợt</span><strong className="text-xs font-black text-emerald-700">{fmtMoney(group.totalAmount)} đ</strong></div>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-start justify-end gap-1.5 lg:max-w-[360px]">
                              {printGroup.lines.length > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void onPrintDeliveryGroup(printGroup, 'purchase_order')}
                                    disabled={printingPoId === printPoKey}
                                    className="inline-flex h-8.5 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100 shadow-xs transition"
                                  >
                                    {printingPoId === printPoKey ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                                    In đơn
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void onPrintDeliveryGroup(printGroup, 'approval_request')}
                                    disabled={printingPoId === printApprovalKey}
                                    className="inline-flex h-8.5 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 shadow-xs transition"
                                  >
                                    {printingPoId === printApprovalKey ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                                    In đề nghị
                                  </button>
                                </>
                              )}
                              {canEditPlannedBatch && (
                                <>
                                  <button type="button" onClick={onEditSchedule} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 shadow-xs transition">
                                    <Edit2 size={13} /> Sửa
                                  </button>
                                  <button type="button" onClick={() => batch && void onRemovePlannedBatch(batch)} disabled={isDeletingBatch} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60 shadow-xs transition">
                                    {isDeletingBatch ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Xóa
                                  </button>
                                </>
                              )}
                              {isPackageV2 && batch && po.purchaseMode === 'multiple' && ['draft', 'revision_requested', 'rejected'].includes(batch.approvalStatus || 'draft') && (
                                <button type="button" onClick={() => void onRunAction({ id: 'submit_delivery_batch', label: 'Gửi duyệt đợt giao', intent: 'warning', deliveryBatchId: batch.id })} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-amber-500 px-3 text-xs font-black text-white hover:bg-amber-600 shadow-xs transition">
                                  <Send size={13} /> Gửi duyệt
                                </button>
                              )}
                              {isPackageV2 && batch && po.purchaseMode === 'multiple' && batch.approvalStatus === 'pending_approval' && canConfirmPo && (
                                <button type="button" onClick={() => void onRunAction({ id: 'approve_delivery_batch', label: 'Duyệt đợt giao', intent: 'success', deliveryBatchId: batch.id })} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700 shadow-xs transition">
                                  <CheckCircle2 size={13} /> Duyệt đợt
                                </button>
                              )}
                              {isPackageV2 && batch && (batch.qrToken || wmsTransactionId) && (
                                <button type="button" onClick={() => void onRunAction({ id: 'open_delivery_qr', label: 'Mở QR', intent: 'primary', deliveryBatchId: batch.id, transactionId: wmsTransactionId || undefined, qrToken: batch.qrToken || null })} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-black text-white hover:bg-blue-700 shadow-xs transition">
                                  <QrCode size={13} /> Mở QR
                                </button>
                              )}
                              {isPackageV2 && batch && canConfirmPo && po.purchaseMode === 'multiple' && (
                                <button type="button" onClick={() => void onRunAction({ id: 'clone_delivery', label: 'Clone đợt', intent: 'neutral', deliveryBatchId: batch.id })} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 shadow-xs transition">
                                  <RefreshCcw size={13} /> Clone
                                </button>
                              )}
                              {isPackageV2 && batch && canConfirmPo && po.purchaseMode === 'multiple' && ['planned', 'wms_pending', 'receiving'].includes(batch.status) && (
                                <button type="button" onClick={() => void onRunAction({ id: 'cancel_delivery', label: 'Hủy đợt giao', intent: 'danger', deliveryBatchId: batch.id })} disabled={isDeletingBatch} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60 shadow-xs transition">
                                  {isDeletingBatch ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Hủy
                                </button>
                              )}
                              {!isPackageV2 && batch && canConfirmPo && ['confirmed', 'in_transit'].includes(po.status) && batch.status === 'planned' && (
                                <button type="button" onClick={() => void onCreateDeliveryReceipt(batch)} disabled={creatingDeliveryBatchId === batch.id} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60 shadow-xs transition">
                                  {creatingDeliveryBatchId === batch.id ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />} Tạo WMS
                                </button>
                              )}
                              {['wms_pending', 'quality_approved'].includes(normalizedStatus) && wmsTransactionId && (
                                <button type="button" onClick={() => void onRunAction({ id: 'open_wms_transaction', label: 'Mở WMS', intent: 'primary', transactionId: wmsTransactionId })} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-black text-white hover:bg-blue-700 shadow-xs transition">
                                  <ShieldCheck size={13} /> Mở WMS
                                </button>
                              )}
                              {canConfirmPo && normalizedStatus === 'cancelled' && (
                                <button type="button" onClick={() => batch ? void onRemoveFailedDeliveryBatch(batch) : void onRemoveFailedDeliveryGroup(printGroup)} disabled={isDeletingBatch} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60 shadow-xs transition">
                                  {isDeletingBatch ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Xóa đợt bị từ chối
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* THÔNG TIN CHÍNH VÀ GHI CHÚ GỌN GÀNG */}
              <section className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <FileText size={14} className="text-teal-600" /> Thông tin chính đơn hàng
                </h4>
                <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4 pt-1">
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 bg-slate-50/50">
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Nguồn PO</span>
                    <strong className="text-xs font-black text-slate-800 dark:text-slate-100">{sourceLabel}</strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 bg-slate-50/50">
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Ngày đặt hàng</span>
                    <strong className="text-xs font-black text-slate-800 dark:text-slate-100">{formatDate(po.orderDate)}</strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 bg-slate-50/50">
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Hạn cần giao</span>
                    <strong className="text-xs font-black text-slate-800 dark:text-slate-100">{formatDate(po.expectedDeliveryDate)}</strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 bg-slate-50/50">
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Kho nhận hàng</span>
                    <strong className="text-xs font-black text-slate-800 dark:text-slate-100">{targetWarehouseName || '—'}</strong>
                  </div>
                </div>

                {po.note && (
                  <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 p-3 text-xs font-bold leading-relaxed text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Ghi chú</span>
                    {po.note}
                  </div>
                )}
              </section>

              {/* LỊCH SỬ VÀ CÔNG NỢ NCC */}
              <section className="grid gap-4 xl:grid-cols-2">
                {/* Lịch sử */}
                <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <History size={14} className="text-teal-600" /> Lịch sử sự kiện
                  </h4>
                  <div className="mt-3 space-y-2.5">
                    {[
                      { title: 'Tạo PO', desc: `${po.poNumber} được tạo ngày ${formatDate(po.createdAt)}`, tone: 'blue' },
                      { title: 'Trạng thái hiện tại', desc: statusLabel, tone: 'emerald' },
                      ...deliveryTimelineGroups.map(group => ({ title: group.label, desc: `${formatDate(group.plannedDate)} • ${deliveryStatusView(group.status).label}`, tone: normalizeDeliveryTimelineStatus(group.status) === 'cancelled' ? 'rose' : 'blue' })),
                      ...supplierReturns.map(item => ({ title: `Trả hàng NCC ${item.returnNo}`, desc: `${item.status} • ${fmtQty(item.lines.reduce((sum, line) => sum + Number(line.returnQty || 0), 0))}`, tone: 'rose' })),
                      ...supplierPayableDocuments.map(document => ({ title: `Công nợ ${document.code || document.documentNo}`, desc: `${payableStatusView(document.status).label} • còn ${fmtMoney(document.outstandingAmount)} đ`, tone: 'amber' })),
                    ].map((event, index) => (
                      <div key={`${event.title}:${index}`} className="flex gap-2.5 items-start">
                        <div className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${event.tone === 'rose' ? 'bg-rose-500' : event.tone === 'amber' ? 'bg-amber-500' : event.tone === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 dark:text-slate-100">{event.title}</div>
                          <div className="text-[11px] font-semibold text-slate-400">{event.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Công nợ NCC */}
                <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <WalletCards size={14} className="text-teal-600" /> Công nợ Nhà cung cấp
                    </h4>
                    {supplierPayableLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
                  </div>
                  {supplierPayableError ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">{supplierPayableError}</div>
                  ) : supplierPayableDocuments.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-xs font-bold text-slate-400 text-center">
                      Chưa có chứng từ công nợ NCC cho PO này.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {supplierPayableDocuments.map(document => (
                        <div key={document.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs font-semibold">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-black text-slate-800">{document.code || document.documentNo}</div>
                            <span className={`rounded-full border px-2 py-0.2 text-[10px] font-black ${payableStatusView(document.status).className}`}>{payableStatusView(document.status).label}</span>
                          </div>
                          <div className="mt-2 grid gap-1 sm:grid-cols-3 text-[11px]">
                            <span>Ghi nhận: <strong className="font-black text-slate-800">{fmtMoney(document.recognizedAmount)} đ</strong></span>
                            <span>Đã trả: <strong className="font-black text-slate-800">{fmtMoney(document.paidAmount)} đ</strong></span>
                            <span>Còn lại: <strong className="font-black text-emerald-700">{fmtMoney(document.outstandingAmount)} đ</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </main>

            {/* RIGHT SIDEBAR: APPROVAL & WORKFLOW ACTION CENTER */}
            <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              {/* TRUNG TÂM DUYỆT ĐƠN & VIỆC CẦN LÀM */}
              <section className="rounded-2xl border border-teal-200/90 bg-gradient-to-br from-teal-50/40 via-white to-emerald-50/40 p-4 sm:p-5 shadow-sm dark:border-teal-900/40 dark:from-slate-900 dark:to-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1">
                    <ShieldCheck size={14} /> Việc cần làm
                  </span>
                  <StatusBadge status={po.status} label={statusLabel} tone={statusTone} showDot={false} size="sm" />
                </div>

                <p className="text-xs sm:text-sm font-black leading-snug text-slate-900 dark:text-slate-100">
                  {uiPolicy.nextStep}
                </p>

                {uiPolicy.primaryAction ? (
                  <div className="pt-2">{renderActionButton(uiPolicy.primaryAction, true, 'w-full')}</div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white/80 dark:bg-slate-800 px-3 py-2 text-center text-xs font-bold text-slate-400">
                    Không có thao tác chờ
                  </div>
                )}

                {uiPolicy.secondaryActions.length > 0 && (
                  <div className="grid gap-2 pt-1">
                    {uiPolicy.secondaryActions.map(action => renderActionButton(action, false, 'w-full'))}
                  </div>
                )}
              </section>

              {/* TÓM TẮT ĐỐI TÁC & KHO NHẬN */}
              <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Thông tin giao nhận</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-start pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400 font-semibold">Nhà cung cấp:</span>
                    <strong className="text-slate-800 dark:text-slate-100 text-right font-black max-w-[180px]">{po.vendorName || '—'}</strong>
                  </div>
                  <div className="flex justify-between items-start pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400 font-semibold">Kho nhận:</span>
                    <strong className="text-slate-800 dark:text-slate-100 text-right font-black">{targetWarehouseName || '—'}</strong>
                  </div>
                  <div className="flex justify-between items-start pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400 font-semibold">Số dòng hàng:</span>
                    <strong className="text-slate-800 dark:text-slate-100 font-black">{po.items.length} dòng</strong>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400 font-semibold">Hạn giao hàng:</span>
                    <strong className="text-slate-800 dark:text-slate-100 font-black">{formatDate(po.expectedDeliveryDate)}</strong>
                  </div>
                </div>
              </section>

              {/* TRẢ HÀNG NCC (NẾU CÓ) */}
              {supplierReturns.length > 0 && (
                <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 text-xs shadow-xs dark:border-rose-900/40 dark:bg-rose-950/20 space-y-2">
                  <div className="font-black uppercase tracking-wider text-rose-700 flex items-center gap-1">
                    <PackageX size={14} /> Trả hàng Nhà cung cấp
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-bold text-rose-800 dark:text-rose-300 pt-1">
                    <span>Đã nhận: <strong>{fmtQty(totalReceivedQty)}</strong></span>
                    <span>Đã hoàn: <strong>{fmtQty(completedReturnQty)}</strong></span>
                    <span>Chờ hoàn: <strong>{fmtQty(pendingReturnQty)}</strong></span>
                    <span>Có thể trả: <strong>{fmtQty(supplierReturnableQty)}</strong></span>
                  </div>
                </section>
              )}
            </aside>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default PurchaseOrderCockpitDrawer;
