import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
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
  WalletCards,
  X,
} from 'lucide-react';
import { StatusBadge, type ErpStatusTone } from '../erp';
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
  canReceivePo: boolean;
  canDeletePo: boolean;
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

const PO_DETAIL_TABS: Array<{ key: DetailTabKey; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Tổng quan', icon: <ShieldCheck size={14} /> },
  { key: 'items', label: 'Hàng hóa', icon: <Package size={14} /> },
  { key: 'deliveries', label: 'Đợt giao', icon: <Truck size={14} /> },
  { key: 'documents', label: 'Chứng từ', icon: <FileText size={14} /> },
  { key: 'history', label: 'Lịch sử', icon: <History size={14} /> },
];

const fmtMoney = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
const fmtQty = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const actionIcon = (action: PurchaseOrderUiAction) => {
  if (action.id === 'request_approval') return <Send size={14} />;
  if (action.id === 'approve_po' || action.id === 'approve_supplemental') return <CheckCircle2 size={14} />;
  if (action.id === 'request_revision' || action.id === 'reject_supplemental') return <RefreshCcw size={14} />;
  if (action.id === 'create_delivery' || action.id === 'create_supplemental_delivery') return <Truck size={14} />;
  if (action.id === 'create_receipt') return <QrCode size={14} />;
  if (action.id === 'open_wms_transaction') return <ShieldCheck size={14} />;
  if (action.id === 'create_supplier_payable') return <WalletCards size={14} />;
  if (action.id === 'supplier_return') return <PackageX size={14} />;
  if (action.id.includes('print')) return <Printer size={14} />;
  if (action.id === 'edit_po') return <Edit2 size={14} />;
  if (action.id === 'remove_po') return <Trash2 size={14} />;
  return <FileText size={14} />;
};

const actionClass = (action: PurchaseOrderUiAction, primary = false) => {
  if (action.disabled) return 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed';
  if (action.intent === 'danger') return primary
    ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300';
  if (action.intent === 'success') return primary
    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (action.intent === 'warning') return primary
    ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
    : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300';
  if (action.intent === 'primary' || primary) return 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700';
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900';
};

const normalizeDeliveryTimelineStatus = (status?: string | null): PurchaseOrderDeliveryBatch['status'] => {
  if (status === 'received') return 'received';
  if (status === 'supplemental_pending') return 'supplemental_pending';
  if (status === 'wms_pending' || status === 'issued' || status === 'variance_pending') return 'wms_pending';
  if (status === 'cancelled' || status === 'returned') return 'cancelled';
  return 'planned';
};

const deliveryStatusView = (status?: string | null) => {
  const normalizedStatus = normalizeDeliveryTimelineStatus(status);
  if (normalizedStatus === 'received') return { label: 'Đã nhập kho', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (normalizedStatus === 'supplemental_pending') return { label: 'Chờ duyệt bổ sung', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (normalizedStatus === 'wms_pending') return { label: 'Chờ kho duyệt', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (normalizedStatus === 'cancelled') return { label: 'Từ chối', className: 'border-rose-200 bg-rose-50 text-rose-700' };
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
  canReceivePo,
  canDeletePo,
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
  const [activeTab, setActiveTab] = useState<DetailTabKey>('overview');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setActiveTab('overview');
    setMenuOpen(false);
  }, [po.id]);

  const receiptPercent = receiptStats.orderedQty > 0
    ? Math.min(100, Math.round((receiptStats.receivedQty / receiptStats.orderedQty) * 100))
    : 0;
  const payableRecognized = supplierPayableDocuments.reduce((sum, document) => sum + Number(document.recognizedAmount || 0), 0);
  const payablePaid = supplierPayableDocuments.reduce((sum, document) => sum + Number(document.paidAmount || 0), 0);
  const payableOutstanding = supplierPayableDocuments.reduce((sum, document) => sum + Number(document.outstandingAmount || 0), 0);
  const payableStatus = supplierPayableDocuments[0]?.status || 'none';
  const payableView = payableStatusView(payableStatus);
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
    const scheduleGroups = deliveryBatches.map(batch => {
      const printGroup = getPrintGroupForBatch(batch);
      const targetWarehouse = warehouses.find(row => row.id === (batch as any).targetWarehouseId)?.name || targetWarehouseName || '—';
      const totalQty = batch.lines.reduce((sum, line) => sum + Number(line.stockPlannedQty ?? line.plannedQty ?? 0), 0);
      const totalAmount = batch.lines.reduce((sum, line) => sum + Number(line.plannedQty || 0) * Number(line.deliveryUnitPrice || 0), 0);
      return {
        key: `schedule:${batch.id}`,
        source: 'schedule' as const,
        label: `Đợt ${batch.deliveryNo}`,
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
  }, [deliveryBatches, deliveryPrintGroups, getPrintGroupForBatch, getWmsTransactionIdForBatch, targetWarehouseName, warehouses]);

  const hasWmsPending = deliveryTimelineGroups.some(group => normalizeDeliveryTimelineStatus(group.status) === 'wms_pending');
  const hasReceivedDelivery = deliveryTimelineGroups.some(group => normalizeDeliveryTimelineStatus(group.status) === 'received') || receiptStats.receivedQty > 0;
  const hasDelivery = deliveryTimelineGroups.length > 0;

  const stepper = [
    { key: 'created', label: 'Tạo PO', done: true, current: po.status === 'draft' },
    { key: 'approved', label: 'Duyệt PO', done: !['draft', 'sent'].includes(po.status), current: po.status === 'sent' },
    { key: 'delivery', label: 'Giao hàng', done: hasDelivery || ['partial', 'delivered', 'closed'].includes(po.status), current: ['confirmed', 'in_transit'].includes(po.status) && !hasReceivedDelivery },
    { key: 'receipt', label: 'Nhập kho', done: hasReceivedDelivery, current: hasWmsPending || po.status === 'partial' },
    { key: 'payable', label: 'Công nợ NCC', done: supplierPayableDocuments.length > 0, current: hasReceivedDelivery && supplierPayableDocuments.length === 0 },
    { key: 'payment', label: 'Thanh toán', done: payableStatus === 'paid', current: supplierPayableDocuments.length > 0 && payableOutstanding > 0 },
  ];

  const statusCards = [
    { label: 'Trạng thái PO', value: statusLabel, tone: 'blue', note: sourceLabel },
    {
      label: 'Trạng thái đợt giao',
      value: deliveryTimelineGroups.length === 0 ? 'Chưa có đợt' : `${deliveryTimelineGroups.length} đợt`,
      tone: hasWmsPending ? 'amber' : hasReceivedDelivery ? 'emerald' : 'blue',
      note: hasWmsPending ? 'Có đợt chờ kho duyệt' : hasReceivedDelivery ? 'Đã có nhập kho' : 'Theo kế hoạch giao',
    },
    {
      label: 'Trạng thái WMS',
      value: hasWmsPending ? 'Chờ kho duyệt' : hasReceivedDelivery ? 'Đã nhập hàng' : 'Chưa phát sinh',
      tone: hasWmsPending ? 'amber' : hasReceivedDelivery ? 'emerald' : 'slate',
      note: hasWmsPending ? 'Mở phiếu WMS để xử lý' : 'Theo phiếu kho liên quan',
    },
    {
      label: 'Công nợ / thanh toán',
      value: payableView.label,
      tone: payableOutstanding > 0 ? 'rose' : payableStatus === 'paid' ? 'emerald' : 'slate',
      note: payableOutstanding > 0 ? `${fmtMoney(payableOutstanding)} đ còn phải trả` : supplierPayableDocuments.length ? 'Đã có chứng từ AP' : 'Chưa tạo chứng từ AP',
    },
  ];

  const renderActionButton = (action: PurchaseOrderUiAction, primary = false, className = '') => (
    <button
      key={`${action.id}:${action.deliveryBatchId || action.transactionId || action.label}`}
      type="button"
      disabled={action.disabled}
      title={action.disabledReason || action.label}
      onClick={() => void onRunAction(action)}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-black transition active:scale-[0.98] disabled:opacity-60 ${actionClass(action, primary)} ${className}`}
    >
      {actionIcon(action)}
      {action.label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/45 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[min(1320px,calc(100vw-24px))] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
        onClick={event => event.stopPropagation()}
      >
        <div className="sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-black uppercase tracking-wide text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{po.poNumber}</span>
                <StatusBadge status={po.status} label={statusLabel} tone={statusTone} showDot={false} size="md" />
                {uiPolicy.alerts.slice(0, 2).map(alert => (
                  <span
                    key={alert.id}
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${alert.tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                  >
                    {alert.label}
                  </span>
                ))}
              </div>
              <h3 className="mt-2 truncate text-lg font-black text-slate-900 dark:text-slate-100">{requestTitle}</h3>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>MR/Vật tư: <strong className="text-slate-700 dark:text-slate-200">{materialSummary}</strong></span>
                <span>NCC: <strong className="text-slate-700 dark:text-slate-200">{po.vendorName || '—'}</strong></span>
                <span>Kho nhận: <strong className="text-slate-700 dark:text-slate-200">{targetWarehouseName || '—'}</strong></span>
                {groupLabel && <span>{groupLabel}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-end">
              <div className="text-right">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Tổng thanh toán</div>
                <div className="text-xl font-black text-emerald-700 dark:text-emerald-300">{fmtMoney(paymentTotal)} đ</div>
                <div className="text-[10px] font-bold text-slate-400">Trước VAT {fmtMoney(displayAmount)} đ</div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(prev => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                  title="Hành động phụ"
                >
                  <MoreVertical size={17} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950">
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
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-black transition disabled:pointer-events-auto disabled:opacity-60 ${actionClass(action, false)}`}
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
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                title="Đóng chi tiết PO"
              >
                <X size={19} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid min-h-full gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-5">
            <main className="min-w-0 space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="grid gap-3 md:grid-cols-6">
                  {stepper.map((step, index) => {
                    const stateClass = step.done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : step.current
                        ? 'border-blue-200 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
                        : 'border-slate-200 bg-slate-50 text-slate-400';
                    return (
                      <div key={step.key} className={`relative rounded-lg border px-3 py-2 ${stateClass}`}>
                        <div className="text-[9px] font-black uppercase tracking-wider">Bước {index + 1}</div>
                        <div className="mt-1 text-xs font-black">{step.label}</div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <nav className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="flex min-w-max gap-1">
                  {PO_DETAIL_TABS.map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-black transition ${activeTab === tab.key ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-200'}`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </nav>

              {activeTab === 'overview' && (
                <section className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {statusCards.map(card => {
                      const toneClass = {
                        blue: 'border-blue-100 bg-blue-50/80 text-blue-700',
                        emerald: 'border-emerald-100 bg-emerald-50/80 text-emerald-700',
                        amber: 'border-amber-100 bg-amber-50/80 text-amber-700',
                        rose: 'border-rose-100 bg-rose-50/80 text-rose-700',
                        slate: 'border-slate-200 bg-slate-50 text-slate-600',
                      }[card.tone];
                      return (
                        <div key={card.label} className={`rounded-lg border p-4 ${toneClass}`}>
                          <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{card.label}</div>
                          <div className="mt-2 text-sm font-black">{card.value}</div>
                          <div className="mt-1 text-[11px] font-bold opacity-80">{card.note}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950 xl:col-span-2">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Thông tin chính</h4>
                      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        <div><span className="block text-slate-400">Nguồn PO</span><strong className="text-slate-700 dark:text-slate-200">{sourceLabel}</strong></div>
                        <div><span className="block text-slate-400">Ngày đặt</span><strong className="text-slate-700 dark:text-slate-200">{formatDate(po.orderDate)}</strong></div>
                        <div><span className="block text-slate-400">Ngày cần giao</span><strong className="text-slate-700 dark:text-slate-200">{formatDate(po.expectedDeliveryDate)}</strong></div>
                        <div><span className="block text-slate-400">Số dòng hàng</span><strong className="text-slate-700 dark:text-slate-200">{po.items.length} dòng</strong></div>
                        <div><span className="block text-slate-400">Đợt giao</span><strong className="text-slate-700 dark:text-slate-200">{deliveryTimelineGroups.length} đợt</strong></div>
                        <div><span className="block text-slate-400">Kho nhận</span><strong className="text-slate-700 dark:text-slate-200">{targetWarehouseName || '—'}</strong></div>
                      </div>
                      {po.note && (
                        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs font-bold leading-5 text-amber-800">
                          <span className="block text-[10px] font-black uppercase tracking-wider text-amber-600">Ghi chú</span>
                          {po.note}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Giá trị</h4>
                      <div className="mt-4 space-y-2 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Trước VAT</span><strong>{fmtMoney(displayAmount)} đ</strong></div>
                        <div className="flex justify-between"><span className="text-slate-500">VAT {vatRate.toLocaleString('vi-VN')}%</span><strong>{fmtMoney(vatAmount)} đ</strong></div>
                        <div className="flex justify-between border-t border-slate-100 pt-2 text-sm"><span className="font-black text-slate-700">Tổng thanh toán</span><strong className="text-emerald-700">{fmtMoney(paymentTotal)} đ</strong></div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'items' && (
                <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">Hàng hóa</h4>
                      <p className="text-[11px] font-bold text-slate-400">Đã nhận {fmtQty(receiptStats.receivedQty)}/{fmtQty(receiptStats.orderedQty)} • Còn thiếu {fmtQty(receiptStats.remainingQty)}</p>
                    </div>
                  </div>
                  <div id={`po-items-table-${po.id}`} className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Tên vật tư</th>
                          {uniqueSpecKeys.map(key => <th key={key} className="px-3 py-3 text-center">{getHeaderLabel(key, po.items)}</th>)}
                          <th className="px-3 py-3 text-right">SL đặt</th>
                          <th className="px-3 py-3 text-right">Đã nhận</th>
                          <th className="px-3 py-3 text-right">Còn thiếu</th>
                          <th className="px-3 py-3 text-right">Đơn giá</th>
                          <th className="px-3 py-3 text-right">Thành tiền</th>
                          <th className="px-4 py-3">Trạng thái</th>
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
                            <tr key={`${lineKey}:${index}`} className="hover:bg-blue-50/30 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-3 align-top">
                                <div className="font-black text-slate-800 dark:text-slate-100">{item.name}</div>
                                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-bold text-slate-400">
                                  {item.sku && <span className="font-mono">{item.sku}</span>}
                                  {item.requestCode && <span className="rounded border border-amber-100 bg-amber-50 px-1.5 text-amber-700">YC {item.requestCode}</span>}
                                  {item.materialBudgetItemName && <span className="rounded border border-emerald-100 bg-emerald-50 px-1.5 text-emerald-700">{item.materialBudgetItemName}</span>}
                                  {item.workBoqItemName && <span className="rounded border border-blue-100 bg-blue-50 px-1.5 text-blue-700">{item.workBoqItemName}</span>}
                                </div>
                                {(item.neededDate || item.note || item.pricingMode) && (
                                  <div className="mt-1 text-[10px] font-semibold text-slate-500">
                                    {item.neededDate ? `Ngày cần: ${item.neededDate}` : ''}
                                    {item.note ? ` ${item.note}` : ''}
                                    {item.pricingMode && item.pricingMode !== 'standard' ? ` ${formatPricingFormula(item)}` : ''}
                                  </div>
                                )}
                              </td>
                              {uniqueSpecKeys.map(key => (
                                <td key={key} className="px-3 py-3 text-center font-bold text-slate-600 dark:text-slate-300">
                                  {item.specs?.[key]?.value ?? '—'}
                                </td>
                              ))}
                              <td className="px-3 py-3 text-right font-black text-slate-700 dark:text-slate-200">{fmtQty(demandQty)} {stockUnit || item.unit}</td>
                              <td className="px-3 py-3 text-right font-black text-emerald-700">{fmtQty(netReceivedQty)}</td>
                              <td className={`px-3 py-3 text-right font-black ${remainingQty > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmtQty(remainingQty)}</td>
                              <td className="px-3 py-3 text-right font-bold text-slate-600">{fmtMoney(lineAmount.unitPrice)}</td>
                              <td className="px-3 py-3 text-right font-black text-slate-800 dark:text-slate-100">{fmtMoney(lineAmount.totalAmount)} đ</td>
                              <td className="px-4 py-3"><StatusBadge status={lineStatus.label} label={lineStatus.label} tone={lineStatus.tone} showDot={false} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {activeTab === 'deliveries' && (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">Đợt giao</h4>
                      <p className="text-[11px] font-bold text-slate-400">Một PO, mỗi đợt giao có luồng WMS/QR riêng.</p>
                    </div>
                    {isLoadingDeliveryPrintGroups && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black text-slate-400">
                        <Loader2 size={13} className="animate-spin" /> Đang tải WMS
                      </span>
                    )}
                  </div>
                  {deliveryTimelineGroups.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">Chưa có đợt giao.</div>
                  ) : (
                    <div className="space-y-3">
                      {deliveryTimelineGroups.map(group => {
                        const status = deliveryStatusView(group.status);
                        const batch = group.scheduleBatch;
                        const printGroup = group.printGroup;
                        const printPoKey = `${po.id}:${printGroup.key}:purchase_order`;
                        const printApprovalKey = `${po.id}:${printGroup.key}:approval_request`;
                        const normalizedStatus = normalizeDeliveryTimelineStatus(group.status);
                        const canEditPlannedBatch = !!batch && canMutatePoDocument && ['planned', 'supplemental_pending'].includes(batch.status) && !poHasStockImpact;
                        const isDeletingBatch = batch
                          ? deletingDeliveryKey === `batch:${batch.id}`
                          : deletingDeliveryKey === `group:${printGroup.key}`;
                        const wmsTransactionId = group.wmsTransactionId;
                        return (
                          <div key={group.key} className="relative rounded-lg border border-slate-200 bg-gradient-to-r from-white to-slate-50 p-4 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-slate-900">
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">{group.marker}</div>
                                  <div>
                                    <div className="text-sm font-black text-slate-800 dark:text-slate-100">{group.label}</div>
                                    <div className="text-[11px] font-bold text-slate-400">{formatDate(group.plannedDate)} • Kho {group.targetWarehouse}</div>
                                  </div>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${status.className}`}>{status.label}</span>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                  <div className="rounded-lg bg-white/80 p-2 dark:bg-slate-950/60"><span className="block text-[10px] font-black uppercase text-slate-400">Số dòng</span><strong>{group.lineCount} dòng</strong></div>
                                  <div className="rounded-lg bg-white/80 p-2 dark:bg-slate-950/60"><span className="block text-[10px] font-black uppercase text-slate-400">Tổng khối lượng</span><strong>{fmtQty(group.totalQty)}</strong></div>
                                  <div className="rounded-lg bg-white/80 p-2 dark:bg-slate-950/60"><span className="block text-[10px] font-black uppercase text-slate-400">Giá trị đợt</span><strong>{fmtMoney(group.totalAmount)} đ</strong></div>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-start justify-end gap-2 lg:max-w-[360px]">
                                {printGroup.lines.length > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void onPrintDeliveryGroup(printGroup, 'purchase_order')}
                                      disabled={printingPoId === printPoKey}
                                      className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[10px] font-black text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                                    >
                                      {printingPoId === printPoKey ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                                      In đơn
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void onPrintDeliveryGroup(printGroup, 'approval_request')}
                                      disabled={printingPoId === printApprovalKey}
                                      className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 text-[10px] font-black text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                                    >
                                      {printingPoId === printApprovalKey ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                                      In đề nghị
                                    </button>
                                  </>
                                )}
                                {canEditPlannedBatch && (
                                  <>
                                    <button type="button" onClick={onEditSchedule} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black text-slate-600 hover:bg-slate-50">
                                      <Edit2 size={13} /> Sửa
                                    </button>
                                    <button type="button" onClick={() => batch && void onRemovePlannedBatch(batch)} disabled={isDeletingBatch} className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 text-[10px] font-black text-red-700 hover:bg-red-100 disabled:opacity-60">
                                      {isDeletingBatch ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Xóa
                                    </button>
                                  </>
                                )}
                                {batch && canReceivePo && po.sourceMode === 'from_request' && ['confirmed', 'in_transit'].includes(po.status) && batch.status === 'planned' && (
                                  <button type="button" onClick={() => void onCreateDeliveryReceipt(batch)} disabled={creatingDeliveryBatchId === batch.id} className="inline-flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-[10px] font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                                    {creatingDeliveryBatchId === batch.id ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />} Tạo WMS
                                  </button>
                                )}
                                {normalizedStatus === 'wms_pending' && wmsTransactionId && (
                                  <button type="button" onClick={() => void onRunAction({ id: 'open_wms_transaction', label: 'Mở WMS', intent: 'primary', transactionId: wmsTransactionId })} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-[10px] font-black text-white hover:bg-blue-700">
                                    <ShieldCheck size={13} /> Mở WMS
                                  </button>
                                )}
                                {canDeletePo && normalizedStatus === 'cancelled' && (
                                  <button type="button" onClick={() => batch ? void onRemoveFailedDeliveryBatch(batch) : void onRemoveFailedDeliveryGroup(printGroup)} disabled={isDeletingBatch} className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 text-[10px] font-black text-red-700 hover:bg-red-100 disabled:opacity-60">
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
              )}

              {activeTab === 'documents' && (
                <section className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">Chứng từ in</h4>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {uiPolicy.menuActions.filter(action => action.id.includes('print')).map(action => renderActionButton(action))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">Công nợ NCC</h4>
                      {supplierPayableLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
                    </div>
                    {supplierPayableError ? (
                      <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">{supplierPayableError}</div>
                    ) : supplierPayableDocuments.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-400">Chưa có chứng từ công nợ NCC cho PO này.</div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {supplierPayableDocuments.map(document => (
                          <div key={document.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-black text-slate-800">{document.code || document.documentNo}</div>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${payableStatusView(document.status).className}`}>{payableStatusView(document.status).label}</span>
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <span>Ghi nhận: <strong>{fmtMoney(document.recognizedAmount)} đ</strong></span>
                              <span>Đã trả: <strong>{fmtMoney(document.paidAmount)} đ</strong></span>
                              <span>Còn lại: <strong>{fmtMoney(document.outstandingAmount)} đ</strong></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {activeTab === 'history' && (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">Lịch sử</h4>
                  <div className="mt-4 space-y-3">
                    {[
                      { title: 'Tạo PO', desc: `${po.poNumber} được tạo ngày ${formatDate(po.createdAt)}`, tone: 'blue' },
                      { title: 'Trạng thái hiện tại', desc: statusLabel, tone: 'emerald' },
                      ...deliveryTimelineGroups.map(group => ({ title: group.label, desc: `${formatDate(group.plannedDate)} • ${deliveryStatusView(group.status).label}`, tone: normalizeDeliveryTimelineStatus(group.status) === 'cancelled' ? 'rose' : 'blue' })),
                      ...supplierReturns.map(item => ({ title: `Trả hàng NCC ${item.returnNo}`, desc: `${item.status} • ${fmtQty(item.lines.reduce((sum, line) => sum + Number(line.returnQty || 0), 0))}`, tone: 'rose' })),
                      ...supplierPayableDocuments.map(document => ({ title: `Công nợ ${document.code || document.documentNo}`, desc: `${payableStatusView(document.status).label} • còn ${fmtMoney(document.outstandingAmount)} đ`, tone: 'amber' })),
                    ].map((event, index) => (
                      <div key={`${event.title}:${index}`} className="flex gap-3">
                        <div className={`mt-1 h-3 w-3 rounded-full ${event.tone === 'rose' ? 'bg-rose-500' : event.tone === 'amber' ? 'bg-amber-500' : event.tone === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 dark:text-slate-100">{event.title}</div>
                          <div className="text-[11px] font-bold text-slate-500">{event.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </main>

            <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Tổng thanh toán</div>
                    <div className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{fmtMoney(paymentTotal)} đ</div>
                  </div>
                  <WalletCards className="text-emerald-600" size={22} />
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-black text-slate-500">
                    <span>Tiến độ nhận hàng</span>
                    <span>{receiptPercent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" style={{ width: `${receiptPercent}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-slate-400">{fmtQty(receiptStats.receivedQty)}/{fmtQty(receiptStats.orderedQty)} • còn thiếu {fmtQty(receiptStats.remainingQty)}</div>
                </div>
              </section>

              <section className="rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50 to-emerald-50 p-4 shadow-sm dark:border-blue-900/40 dark:from-blue-950/30 dark:to-emerald-950/20">
                <div className="text-[10px] font-black uppercase tracking-wider text-blue-600">Việc cần làm</div>
                <p className="mt-2 text-sm font-black leading-5 text-slate-900 dark:text-slate-100">{uiPolicy.nextStep}</p>
                {uiPolicy.primaryAction ? (
                  <div className="mt-4">{renderActionButton(uiPolicy.primaryAction, true, 'w-full')}</div>
                ) : (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-center text-xs font-black text-slate-500">Không có thao tác chính</div>
                )}
                {uiPolicy.secondaryActions.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {uiPolicy.secondaryActions.map(action => renderActionButton(action, false, 'w-full'))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Trạng thái hiện tại</h4>
                <div className="mt-3 space-y-2">
                  {statusCards.map(card => (
                    <div key={card.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="text-[10px] font-black uppercase text-slate-400">{card.label}</div>
                      <div className="mt-1 text-xs font-black text-slate-800 dark:text-slate-100">{card.value}</div>
                      <div className="mt-0.5 text-[10px] font-bold text-slate-500">{card.note}</div>
                    </div>
                  ))}
                </div>
              </section>

              {supplierReturns.length > 0 && (
                <section className="rounded-lg border border-rose-100 bg-rose-50/60 p-4 text-xs shadow-sm">
                  <div className="font-black uppercase tracking-wider text-rose-700">Trả hàng NCC</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 font-bold text-rose-800">
                    <span>Đã nhận {fmtQty(totalReceivedQty)}</span>
                    <span>Đã hoàn {fmtQty(completedReturnQty)}</span>
                    <span>Chờ hoàn {fmtQty(pendingReturnQty)}</span>
                    <span>Có thể trả {fmtQty(supplierReturnableQty)}</span>
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
