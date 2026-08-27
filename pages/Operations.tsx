
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { TransactionType, Transaction, TransactionStatus, TransactionItem, InventoryItem, Role, BusinessPartner, SupplierContract } from '../types';
import {
  Plus, Trash2, ArrowRight, Save, Send, Clock,
  CheckCircle, XCircle, FileText, User, History,
  AlertTriangle, Flame, ShieldAlert, PackageSearch,
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Inbox, Minus, Scale, Banknote, Lock, Loader2,
  Search, Printer, FileDown, Eye, LayoutList, LayoutGrid, Filter, RotateCcw, Layers, Check
} from 'lucide-react';
import ItemSelectionModal from '../components/ItemSelectionModal';
import WarningModal from '../components/WarningModal';
import ConfirmTransferModal from '../components/ConfirmTransferModal';
import TransactionDetailModal from '../components/TransactionDetailModal';
import MasterDataConfirmModal from '../components/MasterDataConfirmModal';
import Pagination from '../components/Pagination';
import SearchableSelect from '../components/common/SearchableSelect';
import MaterialIssuePanel from '../components/project/MaterialIssuePanel';
import { usePagination } from '../hooks/usePagination';
import { useReservedStock } from '../hooks/useReservedStock';
import { useModuleData } from '../hooks/useModuleData';
import { canApproveWmsTransaction, canReceiveWmsTransaction, canViewWmsTransaction, getWmsWarehouseAccess, isFulfillmentBatchTransaction, isWarehouseKeeper } from '../lib/wmsPermissions';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { clampQuantity, formatQuantityInput, parseQuantityInput, sanitizeQuantityInput } from '../lib/quantityInput';
import { getTransactionNextAction, getTransactionTypeLabel } from '../lib/erpWorkflow';
import { EmptyState, PageHeader, StatusBadge } from '../components/erp';
import { partnerService } from '../lib/partnerService';
import { supplierContractService } from '../lib/hdService';
import { buildWmsImportSupplySource, type WmsImportSupplySourceSelection } from '../lib/wmsSupplySource';
import { dateInputToTransactionTimestamp } from '../lib/transactionVoucherDates';
import { parseNonNegativeLocaleNumber } from '../lib/localeNumberInput';
import { purchasePackageService } from '../lib/purchasePackageService';

const ScannerModal = React.lazy(() => import('../components/ScannerModal'));

const readLocaleNumber = (value: unknown) => parseNonNegativeLocaleNumber(value ?? 0);

type HistoryColumnKey = 'import' | 'export' | 'transfer' | 'rejected';
type SupplySourceTab = 'supplier_contract' | 'business_partner';

type SupplySourceOption = {
  id: string;
  label: string;
  searchText: string;
  selection: WmsImportSupplySourceSelection;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatVoucherDate = (date: string) => new Date(date).toLocaleDateString('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formatVoucherCode = (tx: Transaction) => `TT ${formatVoucherDate(tx.date)}`;

const getVoucherTitle = (tx: Transaction) => {
  if (tx.status === TransactionStatus.CANCELLED) return 'Phiếu từ chối';
  switch (tx.type) {
    case TransactionType.IMPORT:
      return 'Phiếu nhập kho';
    case TransactionType.EXPORT:
      return 'Phiếu xuất kho';
    case TransactionType.TRANSFER:
      return 'Phiếu chuyển kho';
    case TransactionType.LIQUIDATION:
      return 'Phiếu xuất hủy';
    default:
      return 'Phiếu kho';
  }
};

const getHistoryColumnKey = (tx: Transaction): HistoryColumnKey => {
  if (tx.status === TransactionStatus.CANCELLED) return 'rejected';
  if (tx.type === TransactionType.IMPORT) return 'import';
  if (tx.type === TransactionType.TRANSFER) return 'transfer';
  return 'export';
};

const Operations: React.FC = () => {
  const location = useLocation();
  const { items, warehouses, suppliers, users, user, transactions, addTransaction, updateTransactionStatus, clearTransactionHistory } = useApp();
  useModuleData('wms');
  const toast = useToast();
  const { getStockSummary, getConflictingTxs } = useReservedStock();
  const [activeTab, setActiveTab] = useState<string>('IMPORT');
  const [opsSubTab, setOpsSubTab] = useState<'approvals' | 'history'>('approvals');
  const [approvalQueueFilter, setApprovalQueueFilter] = useState<'all' | 'stage1' | 'stage2'>('all');
  const [approvalSearch, setApprovalSearch] = useState('');
  const [historyViewMode, setHistoryViewMode] = useState<'table' | 'cards'>('table');
  const openedStateTransactionRef = useRef<string | null>(null);

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  useEffect(() => {
    const transactionId = location.state?.transactionId;
    if (!transactionId || openedStateTransactionRef.current === transactionId) return;
    const tx = transactions.find(item => item.id === transactionId);
    if (!tx) return;
    openedStateTransactionRef.current = transactionId;
    setActiveTab(location.state?.tab || 'PENDING');
    if (tx.status === TransactionStatus.COMPLETED || tx.status === TransactionStatus.CANCELLED) {
      setOpsSubTab('history');
    } else {
      setOpsSubTab('approvals');
    }
    void openTransactionDetails(tx);
  }, [location.state, transactions]);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isItemSelectOpen, setItemSelectOpen] = useState(false);

  const [warningState, setWarningState] = useState<{ isOpen: boolean; title: string; message: string }>({
    isOpen: false, title: '', message: ''
  });

  const [showConfirmTransfer, setShowConfirmTransfer] = useState(false);
  const [viewingHistoryTx, setViewingHistoryTx] = useState<Transaction | null>(null);

  async function openTransactionDetails(tx: Transaction) {
    if (tx.sourceType !== 'po_delivery_batch') {
      setViewingHistoryTx(tx);
      return;
    }
    try {
      const lookup = await purchasePackageService.getDeliveryByWmsTransactionId(tx.id);
      if (!lookup) {
        toast.warning('Không tìm thấy đợt giao', 'Phiếu kho chưa liên kết được với đợt giao của PO.');
        return;
      }
      if (
        user.assignedWarehouseId
        && lookup.purchaseOrder.targetWarehouseId
        && user.assignedWarehouseId !== lookup.purchaseOrder.targetWarehouseId
      ) {
        toast.warning('Sai kho nhận', 'Tài khoản của bạn không được phân công kho nhận của đợt giao này.');
        return;
      }
      setViewingHistoryTx(tx);
    } catch (error) {
      logApiError('operations.openPurchaseDelivery', error);
      toast.error('Không thể mở phiếu PO', getApiErrorMessage(error, 'Không thể tải dữ liệu đợt giao.'));
    }
  }

  const hasAssignedWh = !!user.assignedWarehouseId;
  const isAdmin = user.role === Role.ADMIN;
  const isKeeper = isWarehouseKeeper(user);
  const wmsViewAccess = useMemo(
    () => getWmsWarehouseAccess(user, warehouses, 'wms.transaction.view'),
    [user, warehouses],
  );

  // State quản lý kho bãi
  // - Nhập kho: selectedWarehouseId = kho nhận (kho của thủ kho)
  // - Xuất kho / Xuất hủy: selectedWarehouseId = kho xuất (kho của thủ kho)
  // - Chuyển kho: selectedWarehouseId = kho nguồn (kho của thủ kho), targetWarehouseId = kho đích
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [supplySourceTab, setSupplySourceTab] = useState<SupplySourceTab>('supplier_contract');
  const [supplySourceId, setSupplySourceId] = useState('');
  const [supplierContracts, setSupplierContracts] = useState<SupplierContract[]>([]);
  const [businessPartners, setBusinessPartners] = useState<BusinessPartner[]>([]);
  const [isLoadingSupplySources, setIsLoadingSupplySources] = useState(false);
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [txItems, setTxItems] = useState<TransactionItem[]>([]);
  const [transactionQuantityInputs, setTransactionQuantityInputs] = useState<Record<string, string>>({});
  const [submittingTx, setSubmittingTx] = useState(false);
  const [processingApproval, setProcessingApproval] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | TransactionType>('all');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | TransactionStatus.COMPLETED | TransactionStatus.CANCELLED>('all');
  const [historyWarehouseFilter, setHistoryWarehouseFilter] = useState('all');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  // State lưu thông tin kế toán khi NHẬP KHO: itemId -> { accountingQty, accountingPrice }
  const [accountingData, setAccountingData] = useState<Record<string, { qty: string; price: string }>>({});

  // Tự động gán kho cho Thủ kho khi mount hoặc đổi tab
  useEffect(() => {
    if (hasAssignedWh && user.assignedWarehouseId) {
      setSelectedWarehouseId(user.assignedWarehouseId);
    } else if (!selectedWarehouseId) {
      setSelectedWarehouseId(warehouses[0]?.id || '');
    }
  }, [user, hasAssignedWh, warehouses]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSupplySources(true);
    Promise.all([
      supplierContractService.list(),
      partnerService.list(),
    ]).then(([contracts, partners]) => {
      if (cancelled) return;
      setSupplierContracts(contracts);
      setBusinessPartners(partners);
    }).catch(err => {
      if (!cancelled) {
        logApiError('operations.loadSupplySources', err);
        toast.error('Không tải được nguồn cung cấp', getApiErrorMessage(err, 'Vui lòng thử tải lại trang.'));
      }
    }).finally(() => {
      if (!cancelled) setIsLoadingSupplySources(false);
    });
    return () => { cancelled = true; };
  }, [toast]);

  const supplySourceOptions = useMemo<SupplySourceOption[]>(() => {
    if (supplySourceTab === 'supplier_contract') {
      return supplierContracts.map(contract => ({
        id: contract.id,
        label: `${contract.code} – ${contract.supplierName || contract.name}`,
        searchText: [contract.code, contract.name, contract.supplierName, contract.supplierRepresentative].filter(Boolean).join(' '),
        selection: { kind: 'supplier_contract', contract },
      }));
    }
    return businessPartners.map(partner => ({
      id: partner.id,
      label: `${partner.code ? `${partner.code} – ` : ''}${partner.name}`,
      searchText: [partner.code, partner.name, partner.taxCode, partner.phone, partner.contactName, partner.email].filter(Boolean).join(' '),
      selection: { kind: 'business_partner', partner },
    }));
  }, [businessPartners, supplierContracts, supplySourceTab]);

  const selectedSupplySource = useMemo(
    () => supplySourceOptions.find(option => option.id === supplySourceId) || null,
    [supplySourceId, supplySourceOptions],
  );

  const getTransactionSupplyName = (transaction: Transaction) => {
    const supplierContract = transaction.sourceType === 'supplier_contract'
      ? supplierContracts.find(contract => contract.id === transaction.sourceId)
      : undefined;
    if (supplierContract) return `${supplierContract.code} – ${supplierContract.supplierName || supplierContract.name}`;
    return transaction.businessPartnerNameSnapshot
      || suppliers.find(item => item.id === transaction.supplierId)?.name
      || '-';
  };

  // Reset item list khi chuyển tab
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setTxItems([]);
    setTransactionQuantityInputs({});
    setAccountingData({});
    setTargetWarehouseId('');
    setSupplySourceId('');
    setVoucherDate(new Date().toISOString().slice(0, 10));
    setNote('');
  };

  // State cho duyệt đếm ngược
  const [approvalModal, setApprovalModal] = useState<{
    isOpen: boolean;
    txId: string;
    type: 'APPROVE' | 'CANCEL' | 'RECEIVE';
    title: string;
    message: string;
  }>({
    isOpen: false, txId: '', type: 'APPROVE', title: '', message: ''
  });
  const [approvalDate, setApprovalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [approvalNote, setApprovalNote] = useState('');

  // Lọc danh sách transaction đang chờ DUYỆT (PENDING - Chờ Admin)
  const pendingAdminTxs = useMemo(() => {
    const base = transactions.filter(t => t.status === TransactionStatus.PENDING);
    if (isAdmin) return base;
    if (isKeeper) return base.filter(t => canApproveWmsTransaction(user, t));
    return base.filter(t => t.requesterId === user.id);
  }, [transactions, isAdmin, isKeeper, user]);

  // Lọc danh sách transaction đang chờ NHẬN (APPROVED - Chờ Kho đích)
  const pendingReceiptTxs = useMemo(() => {
    const base = transactions.filter(t => t.status === TransactionStatus.APPROVED);
    if (isAdmin) return base;
    if (isKeeper) return base.filter(t => canReceiveWmsTransaction(user, t));
    return [];
  }, [transactions, isAdmin, isKeeper, user]);

  const filteredPendingAdminTxs = useMemo(() => {
    if (!approvalSearch.trim()) return pendingAdminTxs;
    const q = approvalSearch.trim().toLowerCase();
    return pendingAdminTxs.filter(tx => {
      const requester = users.find(u => u.id === tx.requesterId);
      const sourceWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
      const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
      const itemNames = tx.items.map(ti => {
        const item = items.find(i => i.id === ti.itemId);
        return [item?.name, item?.sku].filter(Boolean).join(' ');
      }).join(' ');
      const str = [
        formatVoucherCode(tx),
        getVoucherTitle(tx),
        tx.id,
        requester?.name,
        sourceWh?.name,
        targetWh?.name,
        tx.note,
        itemNames,
      ].filter(Boolean).join(' ').toLowerCase();
      return str.includes(q);
    });
  }, [pendingAdminTxs, approvalSearch, users, warehouses, items]);

  const filteredPendingReceiptTxs = useMemo(() => {
    if (!approvalSearch.trim()) return pendingReceiptTxs;
    const q = approvalSearch.trim().toLowerCase();
    return pendingReceiptTxs.filter(tx => {
      const requester = users.find(u => u.id === tx.requesterId);
      const sourceWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
      const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
      const itemNames = tx.items.map(ti => {
        const item = items.find(i => i.id === ti.itemId);
        return [item?.name, item?.sku].filter(Boolean).join(' ');
      }).join(' ');
      const str = [
        formatVoucherCode(tx),
        getVoucherTitle(tx),
        tx.id,
        requester?.name,
        sourceWh?.name,
        targetWh?.name,
        tx.note,
        itemNames,
      ].filter(Boolean).join(' ').toLowerCase();
      return str.includes(q);
    });
  }, [pendingReceiptTxs, approvalSearch, users, warehouses, items]);

  // Lọc danh sách lịch sử đã xử lý
  const historyTransactions = useMemo(() => {
    const baseHistory = transactions.filter(t =>
      t.status === TransactionStatus.COMPLETED || t.status === TransactionStatus.CANCELLED
    );
    if (isAdmin) return baseHistory;
    return baseHistory.filter(t => canViewWmsTransaction(user, t));
  }, [transactions, isAdmin, user]);

  const historyCounts = useMemo(() => {
    return {
      total: historyTransactions.length,
      import: historyTransactions.filter(t => t.type === TransactionType.IMPORT && t.status === TransactionStatus.COMPLETED).length,
      export: historyTransactions.filter(t => t.type === TransactionType.EXPORT && t.status === TransactionStatus.COMPLETED).length,
      transfer: historyTransactions.filter(t => t.type === TransactionType.TRANSFER && t.status === TransactionStatus.COMPLETED).length,
      liquidation: historyTransactions.filter(t => t.type === TransactionType.LIQUIDATION && t.status === TransactionStatus.COMPLETED).length,
      rejected: historyTransactions.filter(t => t.status === TransactionStatus.CANCELLED).length,
    };
  }, [historyTransactions]);

  const filteredHistoryTransactions = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    const fromTime = historyDateFrom ? new Date(`${historyDateFrom}T00:00:00`).getTime() : null;
    const toTime = historyDateTo ? new Date(`${historyDateTo}T23:59:59.999`).getTime() : null;

    return historyTransactions.filter(tx => {
      const txTime = new Date(tx.date).getTime();
      if (fromTime !== null && txTime < fromTime) return false;
      if (toTime !== null && txTime > toTime) return false;
      if (historyTypeFilter !== 'all' && tx.type !== historyTypeFilter) return false;
      if (historyStatusFilter !== 'all' && tx.status !== historyStatusFilter) return false;
      if (
        historyWarehouseFilter !== 'all' &&
        tx.sourceWarehouseId !== historyWarehouseFilter &&
        tx.targetWarehouseId !== historyWarehouseFilter
      ) {
        return false;
      }

      if (!keyword) return true;

      const requester = users.find(item => item.id === tx.requesterId);
      const approver = users.find(item => item.id === tx.approverId);
      const sourceWh = warehouses.find(item => item.id === tx.sourceWarehouseId);
      const targetWh = warehouses.find(item => item.id === tx.targetWarehouseId);
      const itemText = tx.items.map(line => {
        const product = items.find(item => item.id === line.itemId) || tx.pendingItems?.find(item => item.id === line.itemId);
        return [product?.sku, product?.name, line.quantity, product?.unit].filter(Boolean).join(' ');
      }).join(' ');

      const searchable = [
        getVoucherTitle(tx),
        formatVoucherCode(tx),
        tx.id,
        tx.type,
        tx.status,
        requester?.name,
        approver?.name,
        sourceWh?.name,
        targetWh?.name,
        getTransactionSupplyName(tx),
        tx.note,
        itemText,
      ].filter(Boolean).join(' ').toLowerCase();

      return searchable.includes(keyword);
    });
  }, [
    historyDateFrom,
    historyDateTo,
    historySearch,
    historyStatusFilter,
    historyTransactions,
    historyTypeFilter,
    historyWarehouseFilter,
    items,
    suppliers,
    supplierContracts,
    users,
    warehouses,
  ]);

  const { paginatedItems: paginatedHistory, currentPage: histPage, totalPages: histTotalPages, totalItems: histTotal, pageSize: histPageSize, setPage: histSetPage, setPageSize: histSetPageSize, startIndex: histStart, endIndex: histEnd } = usePagination<Transaction>(filteredHistoryTransactions, 15);

  // Tính tồn kho ON-HAND trong kho đang chọn (chỉ cho import fallback)
  const getStockInWarehouse = (itemId: string, warehouseId: string): number => {
    const item = items.find(i => i.id === itemId);
    return item?.stockByWarehouse[warehouseId] || 0;
  };

  const getMaxIssueQuantity = (itemId: string): number | undefined => {
    if (activeTab === TransactionType.IMPORT) return undefined;
    return getStockSummary(itemId, selectedWarehouseId).available;
  };

  const normalizeTransactionQuantity = (itemId: string, rawValue: number | string): number => {
    const parsed = typeof rawValue === 'number' ? rawValue : parseQuantityInput(rawValue);
    return clampQuantity(parsed, getMaxIssueQuantity(itemId));
  };

  const updateTransactionQuantityInput = (itemId: string, rawValue: string) => {
    const currentItem = txItems.find(item => item.itemId === itemId);
    const previousValue = transactionQuantityInputs[itemId] ?? formatQuantityInput(currentItem?.quantity ?? 0);
    const nextValue = sanitizeQuantityInput(rawValue, {
      max: getMaxIssueQuantity(itemId),
      previousValue,
    });
    setTransactionQuantityInputs(prev => ({ ...prev, [itemId]: nextValue }));
    const parsed = parseQuantityInput(nextValue);
    if (Number.isFinite(parsed)) {
      setTxItems(prev => prev.map(item => item.itemId === itemId
        ? { ...item, quantity: normalizeTransactionQuantity(itemId, parsed) }
        : item));
    }
  };

  const adjustTransactionQuantity = (itemId: string, adjustment: number) => {
    setTxItems(prev => prev.map(item => item.itemId === itemId
      ? { ...item, quantity: normalizeTransactionQuantity(itemId, item.quantity + adjustment) }
      : item));
    setTransactionQuantityInputs(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const getDefaultTransactionQuantity = (itemId: string): number => {
    if (activeTab === TransactionType.IMPORT) return 1;
    const maxQty = getMaxIssueQuantity(itemId) ?? 0;
    return maxQty > 0 ? Math.min(1, maxQty) : 0;
  };

  const handleSelectItem = (item: InventoryItem) => {
    const existing = txItems.find(i => i.itemId === item.id);
    if (existing) {
      adjustTransactionQuantity(item.id, 1);
    } else {
      setTxItems([...txItems, { itemId: item.id, quantity: getDefaultTransactionQuantity(item.id), price: item.priceIn || 0 }]);
    }
  };

  const executeSubmit = async () => {
    if (submittingTx) return;
    // Không validate tồn kho - thủ kho được phép đề xuất bất kỳ số lượng nào
    // Chỉ validate logic kho nguồn/đích cho Chuyển kho

    // Gắn thông tin kế toán vào từng txItem nếu đang NHẬP KHO
    const enrichedItems: TransactionItem[] = txItems.map(ti => {
      if (activeTab !== TransactionType.IMPORT) return ti;
      const acc = accountingData[ti.itemId];
      const product = items.find(i => i.id === ti.itemId);
      const hasDualUnit = product?.purchaseUnit && product.purchaseUnit !== product.unit;
      const accountingQty = parseQuantityInput(acc?.qty);
      if (hasDualUnit && Number.isFinite(accountingQty) && accountingQty > 0) {
        return {
          ...ti,
          accountingQty,
          accountingUnit: product!.purchaseUnit,
          accountingPrice: acc.price ? readLocaleNumber(acc.price) : undefined,
          // Cập nhật price (giá vốn mỗi cây) = tổng tiền / số lượng (nếu có đủ dữ liệu)
          price: (acc.qty && acc.price && ti.quantity > 0)
            ? Math.round((accountingQty * readLocaleNumber(acc.price)) / ti.quantity)
            : ti.price
        };
      }
      return ti;
    });

    const supplySource = activeTab === TransactionType.IMPORT && selectedSupplySource
      ? buildWmsImportSupplySource(selectedSupplySource.selection)
      : null;

    const newTx: Transaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: activeTab as TransactionType,
      date: activeTab === TransactionType.IMPORT
        ? dateInputToTransactionTimestamp(voucherDate) || new Date().toISOString()
        : new Date().toISOString(),
      items: enrichedItems,
      requesterId: user.id,
      status: TransactionStatus.PENDING,
      note,
      businessEventType: activeTab === TransactionType.IMPORT
        ? 'direct_supplier_receipt'
        : activeTab === TransactionType.TRANSFER
          ? 'warehouse_transfer'
          : activeTab === TransactionType.LIQUIDATION
            ? 'warehouse_loss'
            : undefined,
      businessEventReason: activeTab === TransactionType.LIQUIDATION ? note : undefined,
      // Nhập kho → kho nhận = selectedWarehouseId; nguồn cung cấp bắt buộc từ module Hợp đồng
      targetWarehouseId: activeTab === TransactionType.IMPORT ? selectedWarehouseId : (activeTab === TransactionType.TRANSFER ? targetWarehouseId : undefined),
      sourceWarehouseId: (activeTab === TransactionType.EXPORT || activeTab === TransactionType.TRANSFER || activeTab === TransactionType.LIQUIDATION) ? selectedWarehouseId : undefined,
      ...(supplySource || {}),
    };

    setSubmittingTx(true);
    try {
      await addTransaction(newTx);
      setTxItems([]);
      setTransactionQuantityInputs({});
      setAccountingData({});
      setNote('');
      setSupplySourceId('');
      setVoucherDate(new Date().toISOString().slice(0, 10));
      setShowConfirmTransfer(false);
      toast.success('Đã gửi đề xuất', 'Phiếu của bạn đang chờ Admin phê duyệt.');
    } catch (err: any) {
      logApiError('operations.createTransaction', err);
      toast.error('Không thể gửi đề xuất', getApiErrorMessage(err, 'Không thể lưu phiếu kho lên Supabase.'));
    } finally {
      setSubmittingTx(false);
    }
  };

  const handleSubmit = () => {
    if (txItems.length === 0) return setWarningState({ isOpen: true, title: 'Chưa có dữ liệu', message: 'Chọn ít nhất một vật tư.' });
    if (activeTab === TransactionType.IMPORT && !selectedSupplySource) {
      return setWarningState({
        isOpen: true,
        title: 'Thiếu nguồn cung cấp',
        message: 'Chọn một hợp đồng nhà cung cấp hoặc một đối tác trước khi gửi phiếu nhập kho.',
      });
    }
    const invalidQtyItem = txItems.find(ti => ti.quantity <= 0);
    if (invalidQtyItem) {
      const product = items.find(item => item.id === invalidQtyItem.itemId);
      return setWarningState({
        isOpen: true,
        title: 'Số lượng không hợp lệ',
        message: `${product?.name || 'Vật tư'} phải có số lượng lớn hơn 0.`,
      });
    }
    if (activeTab !== TransactionType.IMPORT) {
      const overAvailableItem = txItems.find(ti => ti.quantity > (getMaxIssueQuantity(ti.itemId) ?? 0));
      if (overAvailableItem) {
        const product = items.find(item => item.id === overAvailableItem.itemId);
        const maxQty = getMaxIssueQuantity(overAvailableItem.itemId) ?? 0;
        setTxItems(prev => prev.map(ti => ti.itemId === overAvailableItem.itemId ? { ...ti, quantity: maxQty } : ti));
        setTransactionQuantityInputs(prev => ({ ...prev, [overAvailableItem.itemId]: formatQuantityInput(maxQty) }));
        return setWarningState({
          isOpen: true,
          title: 'Vượt tồn khả dụng',
          message: `${product?.name || 'Vật tư'} chỉ còn tối đa ${maxQty} ${product?.unit || ''}. Hệ thống đã đưa số lượng về mức tối đa.`,
        });
      }
    }
    if (activeTab === TransactionType.TRANSFER && (!targetWarehouseId || selectedWarehouseId === targetWarehouseId)) {
      return setWarningState({ isOpen: true, title: "Lỗi logic", message: "Vui lòng kiểm tra lại kho nguồn và kho nhận." });
    }
    if (activeTab === TransactionType.TRANSFER) {
      setShowConfirmTransfer(true);
    } else {
      void executeSubmit();
    }
  };

  const triggerApproval = (txId: string, type: 'APPROVE' | 'CANCEL' | 'RECEIVE') => {
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;

    if (type === 'APPROVE') {
      setApprovalDate(new Date().toISOString().slice(0, 10));
      setApprovalNote('');
      const isNeedReceipt = tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER;
      const isFulfillmentTx = isFulfillmentBatchTransaction(tx);
      setApprovalModal({
        isOpen: true,
        txId,
        type,
        title: isFulfillmentTx ? "Duyệt số lượng/chất lượng đợt cấp" : isNeedReceipt ? "Phê duyệt (Chờ kho nhận)" : "Phê duyệt & Hoàn tất",
        message: isFulfillmentTx
          ? "Bạn đang kiểm tra và duyệt số lượng/chất lượng đợt cấp tới kho công trường. Sau bước này, phiếu sẽ chuyển sang chờ xác nhận nhận hàng."
          : isNeedReceipt
            ? "Bạn đang phê duyệt lệnh này. Sau khi duyệt, phiếu sẽ chuyển tới Kho đích để xác nhận nhận hàng thực tế."
          : "Phê duyệt lệnh này sẽ trừ kho ngay lập tức. Bạn có chắc chắn?"
      });
    } else if (type === 'RECEIVE') {
      setApprovalModal({
        isOpen: true,
        txId,
        type,
        title: "Xác nhận nhận hàng",
        message: "Hành động này xác nhận bạn đã nhận đủ hàng thực tế. Tồn kho tại kho của bạn sẽ được cộng thêm ngay lập tức."
      });
    } else if (type === 'CANCEL') {
      setApprovalModal({
        isOpen: true,
        txId,
        type,
        title: "Xác nhận Từ chối phiếu",
        message: "Hành động này sẽ hủy bỏ đề xuất này vĩnh viễn. Người yêu cầu sẽ nhận được thông báo về việc phiếu bị từ chối."
      });
    }
  };

  const handleConfirmAction = async () => {
    const tx = transactions.find(t => t.id === approvalModal.txId);
    if (!tx) return;

    setProcessingApproval(true);
    try {
      if (approvalModal.type === 'APPROVE') {
        const approval = {
          approvedAt: dateInputToTransactionTimestamp(approvalDate),
          approvalNote: approvalNote.trim() || undefined,
        };
        // Luồng mới: Nhập/Chuyển cần APPROVED trước khi COMPLETED
        if (tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER) {
          await updateTransactionStatus(tx.id, TransactionStatus.APPROVED, user.id, approval);
        } else {
          // Xuất/Hủy: Duyệt là COMPLETED luôn
          await updateTransactionStatus(tx.id, TransactionStatus.COMPLETED, user.id, approval);
        }
      } else if (approvalModal.type === 'RECEIVE') {
        await updateTransactionStatus(tx.id, TransactionStatus.COMPLETED, user.id);
      } else if (approvalModal.type === 'CANCEL') {
        await updateTransactionStatus(tx.id, TransactionStatus.CANCELLED, user.id);
      }

      setApprovalModal(prev => ({ ...prev, isOpen: false }));
      toast.success('Đã cập nhật phiếu kho');
    } catch (err: any) {
      logApiError('operations.updateTransactionStatus', err);
      toast.error('Không thể cập nhật phiếu kho', getApiErrorMessage(err, 'Không thể cập nhật trạng thái phiếu kho.'));
    } finally {
      setProcessingApproval(false);
    }
  };

  // Xác định filterWarehouseId cho ItemSelectionModal
  // Nhập kho → chọn từ toàn bộ vật tư (tìm theo mã, không cần tồn)
  // Xuất/Chuyển/Hủy → luôn xem tồn theo kho xuất đang chọn.
  // Trước đây Admin không truyền filterWarehouseId nên modal hiển thị tổng tồn toàn bộ kho.
  const itemSelectFilterWarehouseId = useMemo(() => {
    if (activeTab === TransactionType.IMPORT) return undefined;
    return selectedWarehouseId || undefined;
  }, [activeTab, selectedWarehouseId]);

  // Label cho kho chính
  const warehouseLabel = useMemo(() => {
    if (activeTab === TransactionType.IMPORT) return 'Kho nhận hàng';
    if (activeTab === TransactionType.LIQUIDATION) return 'Kho cần hủy vật tư';
    if (activeTab === TransactionType.TRANSFER) return 'Kho nguồn (kho xuất)';
    return 'Kho xuất đi';
  }, [activeTab]);

  const activeWarehouse = warehouses.find(w => w.id === user.assignedWarehouseId);
  const scopeBadgeLabel = wmsViewAccess.canViewAll
    ? 'Phạm vi: Tất cả kho'
    : activeWarehouse
      ? `Phạm vi: ${activeWarehouse.name}`
      : wmsViewAccess.warehouseIds.length > 1
        ? `Phạm vi: ${wmsViewAccess.warehouseIds.length} kho`
        : '';

  const handlePrintTransaction = (tx: Transaction, mode: 'print' | 'pdf' = 'print') => {
    const title = getVoucherTitle(tx);
    const code = formatVoucherCode(tx);
    const requester = users.find(item => item.id === tx.requesterId);
    const approver = users.find(item => item.id === tx.approverId);
    const sourceWh = warehouses.find(item => item.id === tx.sourceWarehouseId);
    const targetWh = warehouses.find(item => item.id === tx.targetWarehouseId);
    const supplyName = getTransactionSupplyName(tx);
    const documentTitle = `${mode === 'pdf' ? 'PDF_' : ''}${title}_${code}`.replace(/[^\p{L}\p{N}_-]+/gu, '_');
    const flowLabel = tx.type === TransactionType.IMPORT
      ? `Nhập vào: ${targetWh?.name || '-'}`
      : tx.type === TransactionType.TRANSFER
        ? `${sourceWh?.name || '-'} -> ${targetWh?.name || '-'}`
        : `Xuất từ: ${sourceWh?.name || '-'}`;

    const rows = tx.items.map((line, index) => {
      const product = items.find(item => item.id === line.itemId) || tx.pendingItems?.find(item => item.id === line.itemId);
      const amount = Number(line.quantity || 0) * Number(line.price || 0);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <strong>${escapeHtml(product?.name || 'Vật tư')}</strong>
            <div class="muted">${escapeHtml(product?.sku || line.itemId)}</div>
          </td>
          <td class="right">${Number(line.quantity || 0).toLocaleString('vi-VN')}</td>
          <td>${escapeHtml(product?.unit || '')}</td>
          <td class="right">${line.price ? Number(line.price).toLocaleString('vi-VN') : ''}</td>
          <td class="right">${amount ? amount.toLocaleString('vi-VN') : ''}</td>
        </tr>
      `;
    }).join('');

    const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(documentTitle)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
          .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px; }
          h1 { margin: 0; font-size: 26px; text-transform: uppercase; letter-spacing: 0.04em; }
          .code { font-size: 18px; font-weight: 800; margin-top: 8px; }
          .status { text-align: right; font-size: 12px; text-transform: uppercase; font-weight: 800; color: ${tx.status === TransactionStatus.CANCELLED ? '#dc2626' : '#059669'}; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; margin: 18px 0 22px; font-size: 13px; }
          .meta div { border-bottom: 1px solid #e2e8f0; padding-bottom: 7px; }
          .label { color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 800; display: block; margin-bottom: 3px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; color: #475569; }
          th, td { border: 1px solid #cbd5e1; padding: 9px 10px; vertical-align: top; }
          .right { text-align: right; }
          .muted { color: #64748b; font-size: 11px; margin-top: 2px; }
          .note { margin-top: 18px; border-left: 4px solid #94a3b8; background: #f8fafc; padding: 12px 14px; font-size: 13px; }
          .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 42px; text-align: center; font-size: 12px; font-weight: 800; }
          .signatures span { display: block; margin-top: 64px; font-weight: 400; color: #64748b; }
          @media print { body { margin: 18mm; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <div class="code">Mã phiếu: ${escapeHtml(code)}</div>
          </div>
          <div class="status">${tx.status === TransactionStatus.CANCELLED ? 'Từ chối' : 'Hoàn thành'}</div>
        </div>
        <div class="meta">
          <div><span class="label">Ngày lập</span>${escapeHtml(new Date(tx.date).toLocaleString('vi-VN'))}</div>
          <div><span class="label">Luồng kho</span>${escapeHtml(flowLabel)}</div>
          <div><span class="label">Người lập</span>${escapeHtml(requester?.name || 'Hệ thống')}</div>
          <div><span class="label">Người phê duyệt</span>${escapeHtml(approver?.name || '-')}</div>
          <div><span class="label">Ngày duyệt</span>${escapeHtml(tx.approvedAt ? new Date(tx.approvedAt).toLocaleDateString('vi-VN') : '-')}</div>
          <div><span class="label">Nguồn cung cấp</span>${escapeHtml(supplyName)}</div>
          <div><span class="label">Mã giao dịch hệ thống</span>${escapeHtml(tx.id)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>STT</th>
              <th>Vật tư</th>
              <th class="right">Số lượng</th>
              <th>ĐVT</th>
              <th class="right">Đơn giá</th>
              <th class="right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${tx.note ? `<div class="note"><strong>Ghi chú:</strong> ${escapeHtml(tx.note)}</div>` : ''}
        ${tx.approvalNote ? `<div class="note"><strong>Ghi chú duyệt:</strong> ${escapeHtml(tx.approvalNote)}</div>` : ''}
        <div class="signatures">
          <div>Người lập<span>Ký, ghi rõ họ tên</span></div>
          <div>Thủ kho<span>Ký, ghi rõ họ tên</span></div>
          <div>Người duyệt<span>Ký, ghi rõ họ tên</span></div>
        </div>
        <script>setTimeout(function(){ window.print(); }, 250);</script>
      </body>
      </html>`;

    const printWindow = window.open('', '_blank', 'width=980,height=720');
    if (!printWindow) {
      toast.error(mode === 'pdf' ? 'Không thể xuất PDF' : 'Không thể in phiếu', 'Trình duyệt đang chặn cửa sổ in/PDF.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    if (mode === 'pdf') {
      toast.info('Xuất PDF', 'Trong hộp thoại in, chọn "Save as PDF" để lưu file.');
    }
  };

  const historyColumnCounts = useMemo(() => {
    return filteredHistoryTransactions.reduce<Record<HistoryColumnKey, number>>((acc, tx) => {
      acc[getHistoryColumnKey(tx)] += 1;
      return acc;
    }, { import: 0, export: 0, transfer: 0, rejected: 0 });
  }, [filteredHistoryTransactions]);

  const historyColumns: Array<{
    key: HistoryColumnKey;
    title: string;
    description: string;
    icon: React.ReactNode;
    count: number;
    className: string;
    headerClassName: string;
  }> = [
    {
      key: 'import',
      title: 'Phiếu nhập kho',
      description: 'Đã nhập kho',
      icon: <ArrowDownLeft size={14} />,
      count: historyColumnCounts.import,
      className: 'border-emerald-100 bg-emerald-50/30',
      headerClassName: 'text-emerald-700 bg-emerald-100/80 border-emerald-200',
    },
    {
      key: 'export',
      title: 'Phiếu xuất kho',
      description: 'Xuất kho / xuất hủy',
      icon: <ArrowUpRight size={14} />,
      count: historyColumnCounts.export,
      className: 'border-blue-100 bg-blue-50/30',
      headerClassName: 'text-blue-700 bg-blue-100/80 border-blue-200',
    },
    {
      key: 'transfer',
      title: 'Phiếu chuyển kho',
      description: 'Điều chuyển nội bộ',
      icon: <ArrowLeftRight size={14} />,
      count: historyColumnCounts.transfer,
      className: 'border-violet-100 bg-violet-50/30',
      headerClassName: 'text-violet-700 bg-violet-100/80 border-violet-200',
    },
    {
      key: 'rejected',
      title: 'Từ chối',
      description: 'Phiếu đã hủy',
      icon: <XCircle size={14} />,
      count: historyColumnCounts.rejected,
      className: 'border-rose-100 bg-rose-50/30',
      headerClassName: 'text-rose-700 bg-rose-100/80 border-rose-200',
    },
  ];

  return (
    <div className="space-y-6">
      {isScannerOpen && (
        <React.Suspense fallback={null}>
          <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={(sku) => {
            const item = items.find(i => i.sku === sku);
            if (item) handleSelectItem(item);
          }} />
        </React.Suspense>
      )}

      <ItemSelectionModal
        isOpen={isItemSelectOpen}
        onClose={() => setItemSelectOpen(false)}
        onSelect={handleSelectItem}
        onOpenScanner={() => setScannerOpen(true)}
        filterWarehouseId={itemSelectFilterWarehouseId}
        allowAllItems={activeTab === TransactionType.IMPORT}
      />

      <WarningModal isOpen={warningState.isOpen} onClose={() => setWarningState(p => ({ ...p, isOpen: false }))} title={warningState.title} message={warningState.message} />
      <ConfirmTransferModal isOpen={showConfirmTransfer} onClose={() => setShowConfirmTransfer(false)} onConfirm={executeSubmit}
        sourceWarehouse={warehouses.find(w => w.id === selectedWarehouseId)} targetWarehouse={warehouses.find(w => w.id === targetWarehouseId)}
        items={txItems.map(ti => ({ product: items.find(i => i.id === ti.itemId)!, quantity: ti.quantity }))}
        isLoading={submittingTx}
      />

      <TransactionDetailModal
        isOpen={!!viewingHistoryTx}
        onClose={() => setViewingHistoryTx(null)}
        transaction={viewingHistoryTx}
        onUpdated={setViewingHistoryTx}
      />

      <MasterDataConfirmModal
        isOpen={approvalModal.isOpen}
        onClose={() => setApprovalModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmAction}
        title={approvalModal.title}
        message={approvalModal.message}
        type={approvalModal.type === 'CANCEL' ? 'danger' : (approvalModal.type === 'RECEIVE' ? 'success' : 'warning')}
        actionLabel={approvalModal.type === 'APPROVE' ? 'Xác nhận Duyệt' : (approvalModal.type === 'RECEIVE' ? 'Xác nhận Nhận hàng' : 'Từ chối phiếu')}
        countdownRequired={approvalModal.type !== 'RECEIVE'}
        isLoading={processingApproval}
      >
        {approvalModal.type === 'APPROVE' && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ngày duyệt phiếu</span>
              <input
                type="date"
                value={approvalDate}
                onChange={event => setApprovalDate(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú duyệt</span>
              <textarea
                value={approvalNote}
                onChange={event => setApprovalNote(event.target.value)}
                rows={3}
                placeholder="Nhập ghi chú cho lần duyệt này..."
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-orange-400"
              />
            </label>
          </div>
        )}
      </MasterDataConfirmModal>

      <PageHeader
        eyebrow="WMS"
        title="Nghiệp vụ kho"
        description="Tạo phiếu nhập, xuất, chuyển kho và xử lý các hàng đợi duyệt/nhận hàng."
        meta={
          <>
            <StatusBadge status="pending" label={`${pendingAdminTxs.length} chờ duyệt`} tone={pendingAdminTxs.length > 0 ? 'warning' : 'success'} size="md" />
            <StatusBadge status="approved" label={`${pendingReceiptTxs.length} chờ nhận`} tone={pendingReceiptTxs.length > 0 ? 'info' : 'success'} size="md" />
            <StatusBadge status="completed" label={`${historyTransactions.length} đã xử lý`} tone="neutral" size="md" />
            {scopeBadgeLabel && (
              <StatusBadge status="scope" label={scopeBadgeLabel} tone="info" size="md" />
            )}
          </>
        }
      />

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto bg-slate-50/50 scrollbar-hide">
          <button onClick={() => handleTabChange('IMPORT')} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'IMPORT' ? 'border-accent text-accent bg-white shadow-[0_-4px_0_inset_#2563eb]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>Nhập kho</button>
          <button onClick={() => handleTabChange('MATERIAL_ISSUE')} className={`flex-1 min-w-[140px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'MATERIAL_ISSUE' ? 'border-indigo-500 text-indigo-600 bg-white shadow-[0_-4px_0_inset_#6366f1]' : 'border-transparent text-slate-400 hover:text-indigo-500'}`}>Xuất cấp thi công</button>
          <button onClick={() => handleTabChange('TRANSFER')} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'TRANSFER' ? 'border-accent text-accent bg-white shadow-[0_-4px_0_inset_#2563eb]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>Chuyển kho</button>
          {isAdmin && (
            <button onClick={() => handleTabChange('LIQUIDATION')} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'LIQUIDATION' ? 'border-red-600 text-red-600 bg-white shadow-[0_-4px_0_inset_#dc2626]' : 'border-transparent text-slate-400 hover:text-red-400'}`}>Xuất hủy</button>
          )}
          <button onClick={() => setActiveTab('PENDING')} className={`flex-1 min-w-[120px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all relative ${activeTab === 'PENDING' ? 'border-orange-500 text-orange-600 bg-white shadow-[0_-4px_0_inset_#f97316]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Quản lý phiếu
            {(pendingAdminTxs.length + pendingReceiptTxs.length) > 0 && <span className="ml-2 bg-orange-500 text-white text-[8px] md:text-[10px] px-1.5 py-0.5 rounded-full ring-2 ring-white">{(pendingAdminTxs.length + pendingReceiptTxs.length)}</span>}
          </button>
        </div>

        <div className="p-6 bg-white">
          {activeTab === 'MATERIAL_ISSUE' ? (
            <MaterialIssuePanel />
          ) : activeTab === 'PENDING' ? (
            <div className="space-y-6">
              {/* SUB-NAVIGATION CHO QUẢN LÝ PHIẾU */}
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex rounded-2xl bg-slate-100/90 p-1.5 border border-slate-200/60 shadow-inner">
                  <button
                    type="button"
                    onClick={() => setOpsSubTab('approvals')}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all ${
                      opsSubTab === 'approvals'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <ShieldAlert size={15} className={opsSubTab === 'approvals' ? 'text-amber-500' : 'text-slate-400'} />
                    <span>Hàng đợi duyệt phiếu</span>
                    {(pendingAdminTxs.length + pendingReceiptTxs.length) > 0 && (
                      <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
                        {pendingAdminTxs.length + pendingReceiptTxs.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpsSubTab('history')}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all ${
                      opsSubTab === 'history'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <History size={15} className={opsSubTab === 'history' ? 'text-indigo-600' : 'text-slate-400'} />
                    <span>Lịch sử nhập xuất</span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700">
                      {historyTransactions.length}
                    </span>
                  </button>
                </div>

                <div className="text-xs font-semibold text-slate-400">
                  {opsSubTab === 'approvals'
                    ? 'Xử lý các phiếu chờ duyệt SL/CL và xác nhận nhận hàng'
                    : 'Tra cứu, in ấn và xuất PDF toàn bộ lịch sử giao dịch kho'}
                </div>
              </div>

              {/* VIEW 1: HÀNG ĐỢI DUYỆT PHIẾU */}
              {opsSubTab === 'approvals' && (
                <div className="space-y-6">
                  {/* KPI SUMMARY HÀNG ĐỢI */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div
                      onClick={() => setApprovalQueueFilter('stage1')}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                        approvalQueueFilter === 'stage1'
                          ? 'border-amber-400 bg-amber-50/50 shadow-sm ring-2 ring-amber-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500">Chờ duyệt SL/CL (GĐ 1)</span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                          <ShieldAlert size={15} />
                        </span>
                      </div>
                      <p className="mt-2 text-2xl font-black text-slate-900">{pendingAdminTxs.length}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Phiếu chờ phê duyệt</p>
                    </div>

                    <div
                      onClick={() => setApprovalQueueFilter('stage2')}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                        approvalQueueFilter === 'stage2'
                          ? 'border-blue-400 bg-blue-50/50 shadow-sm ring-2 ring-blue-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500">Chờ kho đích nhận (GĐ 2)</span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                          <Inbox size={15} />
                        </span>
                      </div>
                      <p className="mt-2 text-2xl font-black text-slate-900">{pendingReceiptTxs.length}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Phiếu đang trung chuyển</p>
                    </div>

                    <div
                      onClick={() => setApprovalQueueFilter('all')}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                        approvalQueueFilter === 'all'
                          ? 'border-indigo-400 bg-indigo-50/50 shadow-sm ring-2 ring-indigo-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500">Tổng phiếu cần xử lý</span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                          <CheckCircle size={15} />
                        </span>
                      </div>
                      <p className="mt-2 text-2xl font-black text-slate-900">{pendingAdminTxs.length + pendingReceiptTxs.length}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Tất cả hàng đợi</p>
                    </div>
                  </div>

                  {/* THANH LỌC VÀ TÌM KIẾM HÀNG ĐỢI DUYỆT */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setApprovalQueueFilter('all')}
                        className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                          approvalQueueFilter === 'all'
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Tất cả ({pendingAdminTxs.length + pendingReceiptTxs.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setApprovalQueueFilter('stage1')}
                        className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                          approvalQueueFilter === 'stage1'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Chờ duyệt SL/CL ({pendingAdminTxs.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setApprovalQueueFilter('stage2')}
                        className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                          approvalQueueFilter === 'stage2'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Chờ kho đích nhận ({pendingReceiptTxs.length})
                      </button>
                    </div>

                    <div className="relative w-full sm:w-72">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={approvalSearch}
                        onChange={event => setApprovalSearch(event.target.value)}
                        placeholder="Tìm trong hàng đợi..."
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-7 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                      />
                      {approvalSearch && (
                        <button
                          type="button"
                          onClick={() => setApprovalSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PHẦN 1: PHIẾU CHỜ DUYỆT SL/CL (GIAI ĐOẠN 1) */}
                  {(approvalQueueFilter === 'all' || approvalQueueFilter === 'stage1') && (
                    <section className="space-y-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-slate-800 flex items-center text-sm">
                          <ShieldAlert size={18} className="mr-2 text-red-500" />
                          {isAdmin ? 'Phiếu chờ duyệt (Giai đoạn 1)' : 'Phiếu chờ bạn duyệt số lượng/chất lượng'}
                        </h3>
                        <span className="text-[10px] font-black bg-slate-100 px-2 py-0.5 rounded text-slate-500 uppercase">
                          {filteredPendingAdminTxs.length} PHIẾU
                        </span>
                      </div>

                      {filteredPendingAdminTxs.length === 0 ? (
                        <EmptyState
                          icon={<ShieldAlert size={18} />}
                          title="Không có phiếu đang chờ duyệt"
                          message={approvalSearch ? 'Không tìm thấy phiếu phù hợp với từ khóa.' : 'Các phiếu cần bạn duyệt số lượng/chất lượng sẽ xuất hiện tại đây.'}
                        />
                      ) : (
                        <div className="grid grid-cols-1 gap-4">
                          {filteredPendingAdminTxs.map(tx => {
                            const requester = users.find(u => u.id === tx.requesterId);
                            const sourceWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
                            const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                            const displayWh = tx.type === TransactionType.IMPORT ? targetWh : (tx.type === TransactionType.TRANSFER ? sourceWh : sourceWh);

                            // ── Reserved Stock: kiểm tra conflict cho phiếu xuất/chuyển/hủy ──
                            const isExportType = tx.type === TransactionType.EXPORT ||
                              tx.type === TransactionType.TRANSFER ||
                              tx.type === TransactionType.LIQUIDATION;
                            const stockConflicts = isExportType && tx.sourceWarehouseId
                              ? tx.items.map(ti => ({
                                  ...ti,
                                  summary: getStockSummary(ti.itemId, tx.sourceWarehouseId!, { excludeTransactionId: tx.id }),
                                  product: items.find(i => i.id === ti.itemId),
                                })).filter(ti => ti.summary.reserved > 0 || ti.quantity > ti.summary.available)
                              : [];
                            const hasStockConflict = stockConflicts.length > 0;
                            const isFulfillmentTx = isFulfillmentBatchTransaction(tx);
                            const isMaterialIssueTx = tx.items.some(item => !!item.materialIssueOrderId);
                            const pendingLabel = isFulfillmentTx ? 'CHỜ DUYỆT SL/CL' : (isMaterialIssueTx ? 'CHỜ KHO XUẤT CẤP' : 'CHỜ DUYỆT');
                            const action = getTransactionNextAction(tx, user);
                            const typeLabel = getTransactionTypeLabel(tx.type);

                            return (
                              <div
                                key={tx.id}
                                onClick={() => void openTransactionDetails(tx)}
                                className={`bg-white border rounded-2xl p-4 hover:border-orange-200 transition-all cursor-pointer group shadow-sm ${
                                  hasStockConflict ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200/80'
                                }`}
                              >
                                <div className="flex flex-col md:flex-row justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                      <StatusBadge status={tx.status} label={pendingLabel} tone={action.tone} />
                                      <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-blue-50 text-blue-600 border border-blue-100">
                                        {isMaterialIssueTx ? 'Xuất cấp thi công' : typeLabel}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono font-bold">{new Date(tx.date).toLocaleString()}</span>
                                      {hasStockConflict && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-500 text-white">
                                          <Lock size={8} /> TỒN BỊ CHIẾM CHỖ
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <span className="text-sm font-black text-slate-700">{requester?.name}</span>
                                      {tx.type === TransactionType.TRANSFER ? (
                                        <>
                                          <ArrowRight size={14} className="mx-1 text-slate-300" />
                                          <span className="text-xs font-bold text-slate-500">{sourceWh?.name}</span>
                                          <ArrowRight size={14} className="mx-0.5 text-accent" />
                                          <span className="text-sm font-black text-accent">{targetWh?.name}</span>
                                        </>
                                      ) : (
                                        <>
                                          <ArrowRight size={14} className="mx-1 text-slate-300" />
                                          <span className="text-sm font-black text-accent">{displayWh?.name}</span>
                                        </>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl group-hover:bg-orange-50/50 transition-colors">
                                      {tx.items.length} vật tư • {tx.note || 'Không có ghi chú'}
                                    </div>
                                    <p className="mt-2 text-[11px] font-bold text-slate-500">{action.nextAction}</p>
                                    {hasStockConflict && (
                                      <div className="mt-2 space-y-1">
                                        {stockConflicts.map((ti, idx) => (
                                          <div key={idx} className="flex items-center justify-between text-[10px] bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                                            <span className="font-black text-slate-700 truncate max-w-[140px]">{ti.product?.name}</span>
                                            <div className="flex items-center gap-2 shrink-0">
                                              <span className="text-slate-400">Yêu cầu: <span className="font-black text-slate-600">{ti.quantity}</span></span>
                                              <span className="text-amber-600 font-black flex items-center gap-0.5">
                                                <Lock size={8} /> Giữ chỗ: {ti.summary.reserved}
                                              </span>
                                              <span className={`font-black ${
                                                ti.summary.available >= ti.quantity ? 'text-emerald-600' : 'text-red-600'
                                              }`}>
                                                Khả dụng: {ti.summary.available}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {canApproveWmsTransaction(user, tx) && (
                                    <div className="flex md:flex-col gap-2 min-w-[140px] pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4" onClick={(e) => e.stopPropagation()}>
                                      <button onClick={() => (tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER) ? void openTransactionDetails(tx) : triggerApproval(tx.id, 'APPROVE')} className="flex-1 py-2 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition">
                                        {isFulfillmentTx ? 'Duyệt SL/CL' : 'Duyệt Phiếu'}
                                      </button>
                                      <button onClick={() => triggerApproval(tx.id, 'CANCEL')} className="flex-1 py-2 bg-white border border-red-200 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition">
                                        Từ Chối
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}

                  {/* PHẦN 2: PHIẾU CHỜ KHO ĐÍCH XÁC NHẬN (GIAI ĐOẠN 2) */}
                  {(approvalQueueFilter === 'all' || approvalQueueFilter === 'stage2') && (
                    <section className="space-y-4 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-slate-800 flex items-center text-sm">
                          <Inbox size={18} className="mr-2 text-blue-500" />
                          {isAdmin ? 'Đã duyệt - Chờ kho đích nhận hàng (Giai đoạn 2)' : 'Hàng đang tới - Chờ bạn xác nhận nhập kho'}
                        </h3>
                        <span className="text-[10px] font-black bg-blue-50 px-2 py-0.5 rounded text-blue-500 uppercase">
                          {filteredPendingReceiptTxs.length} PHIẾU
                        </span>
                      </div>

                      {filteredPendingReceiptTxs.length === 0 ? (
                        <EmptyState
                          icon={<Inbox size={18} />}
                          title="Không có hàng đang chờ nhận"
                          message={approvalSearch ? 'Không tìm thấy phiếu phù hợp với từ khóa.' : 'Các phiếu đã duyệt và cần kho đích xác nhận sẽ nằm ở hàng đợi này.'}
                        />
                      ) : (
                        <div className="grid grid-cols-1 gap-4">
                          {filteredPendingReceiptTxs.map(tx => {
                            const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                            const isMyWarehouse = targetWh?.id === user.assignedWarehouseId;
                            const action = getTransactionNextAction(tx, user);
                            return (
                              <div
                                key={tx.id}
                                onClick={() => void openTransactionDetails(tx)}
                                className={`bg-white border rounded-2xl p-4 transition-all cursor-pointer group shadow-sm ${
                                  isMyWarehouse ? 'border-blue-200 bg-blue-50/5 shadow-md shadow-blue-500/5 hover:border-blue-400' : 'border-slate-200/80 hover:border-accent'
                                }`}
                              >
                                <div className="flex flex-col md:flex-row justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <StatusBadge status={tx.status} label="Đã duyệt - chờ nhận" tone={action.tone} />
                                      <span className="text-[10px] text-slate-400 font-mono font-bold">Admin đã duyệt lúc {new Date(tx.date).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <span className="text-xs font-bold text-slate-400 uppercase">Kho nhận:</span>
                                      <span className="text-sm font-black text-blue-600">{targetWh?.name}</span>
                                    </div>
                                    <div className="bg-white p-2.5 rounded-xl border border-slate-100 group-hover:bg-blue-50/30 transition-colors">
                                      {tx.items.slice(0, 2).map((ti, i) => {
                                        const it = items.find(item => item.id === ti.itemId);
                                        return <div key={i} className="text-xs font-bold text-slate-700 flex justify-between"><span>• {it?.name}</span> <span>{ti.quantity} {it?.unit}</span></div>
                                      })}
                                      {tx.items.length > 2 && <div className="text-[10px] text-slate-400 mt-1 italic text-center">... và {tx.items.length - 2} hạng mục khác</div>}
                                    </div>
                                    <p className="mt-2 text-[11px] font-bold text-slate-500">{action.nextAction}</p>
                                  </div>
                                  {canReceiveWmsTransaction(user, tx) && (
                                    <div className="flex md:flex-col gap-2 min-w-[160px] pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4" onClick={(e) => e.stopPropagation()}>
                                      <button onClick={() => (tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER) ? void openTransactionDetails(tx) : triggerApproval(tx.id, 'RECEIVE')} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition">
                                        <CheckCircle size={14} /> XÁC NHẬN NHẬN
                                      </button>
                                      {isAdmin && <div className="text-[9px] text-slate-400 text-center italic mt-1 font-bold">Chờ kho đích bấm nhận</div>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}

              {/* VIEW 2: LỊCH SỬ NHẬP XUẤT */}
              {opsSubTab === 'history' && (
                <div className="space-y-5">
                  {/* KPI SUMMARY CARDS */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    <div
                      onClick={() => { setHistoryTypeFilter('all'); setHistoryStatusFilter('all'); }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                        historyTypeFilter === 'all' && historyStatusFilter === 'all'
                          ? 'border-indigo-400 bg-indigo-50/50 shadow-sm ring-2 ring-indigo-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <p className="text-[11px] font-bold text-slate-500">Tất cả phiếu</p>
                      <p className="mt-1 text-2xl font-black text-slate-800">{historyCounts.total}</p>
                    </div>
                    <div
                      onClick={() => { setHistoryTypeFilter(TransactionType.IMPORT); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                        historyTypeFilter === TransactionType.IMPORT && historyStatusFilter === TransactionStatus.COMPLETED
                          ? 'border-emerald-400 bg-emerald-50/50 shadow-sm ring-2 ring-emerald-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <p className="text-[11px] font-bold text-emerald-600 flex items-center gap-1"><ArrowDownLeft size={13} /> Nhập kho</p>
                      <p className="mt-1 text-2xl font-black text-emerald-700">{historyCounts.import}</p>
                    </div>
                    <div
                      onClick={() => { setHistoryTypeFilter(TransactionType.EXPORT); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                        historyTypeFilter === TransactionType.EXPORT && historyStatusFilter === TransactionStatus.COMPLETED
                          ? 'border-blue-400 bg-blue-50/50 shadow-sm ring-2 ring-blue-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <p className="text-[11px] font-bold text-blue-600 flex items-center gap-1"><ArrowUpRight size={13} /> Xuất kho</p>
                      <p className="mt-1 text-2xl font-black text-blue-700">{historyCounts.export}</p>
                    </div>
                    <div
                      onClick={() => { setHistoryTypeFilter(TransactionType.TRANSFER); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                        historyTypeFilter === TransactionType.TRANSFER && historyStatusFilter === TransactionStatus.COMPLETED
                          ? 'border-violet-400 bg-violet-50/50 shadow-sm ring-2 ring-violet-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <p className="text-[11px] font-bold text-violet-600 flex items-center gap-1"><ArrowLeftRight size={13} /> Chuyển kho</p>
                      <p className="mt-1 text-2xl font-black text-violet-700">{historyCounts.transfer}</p>
                    </div>
                    <div
                      onClick={() => { setHistoryTypeFilter(TransactionType.LIQUIDATION); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                        historyTypeFilter === TransactionType.LIQUIDATION && historyStatusFilter === TransactionStatus.COMPLETED
                          ? 'border-red-400 bg-red-50/50 shadow-sm ring-2 ring-red-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <p className="text-[11px] font-bold text-red-600 flex items-center gap-1"><Trash2 size={13} /> Xuất hủy</p>
                      <p className="mt-1 text-2xl font-black text-red-700">{historyCounts.liquidation}</p>
                    </div>
                    <div
                      onClick={() => { setHistoryTypeFilter('all'); setHistoryStatusFilter(TransactionStatus.CANCELLED); }}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                        historyStatusFilter === TransactionStatus.CANCELLED
                          ? 'border-rose-400 bg-rose-50/50 shadow-sm ring-2 ring-rose-400/20'
                          : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <p className="text-[11px] font-bold text-rose-600 flex items-center gap-1"><XCircle size={13} /> Bị từ chối</p>
                      <p className="mt-1 text-2xl font-black text-rose-700">{historyCounts.rejected}</p>
                    </div>
                  </div>

                  {/* SMART FILTER TOOLBAR */}
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3.5 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 items-center">
                      {/* Search input */}
                      <div className="relative xl:col-span-5">
                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={historySearch}
                          onChange={event => setHistorySearch(event.target.value)}
                          placeholder="Tìm mã phiếu, người lập, kho, vật tư, SKU, NCC..."
                          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-8 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                        />
                        {historySearch && (
                          <button
                            type="button"
                            onClick={() => setHistorySearch('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-sm"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      {/* Warehouse dropdown filter */}
                      <div className="xl:col-span-3">
                        <select
                          value={historyWarehouseFilter}
                          onChange={event => setHistoryWarehouseFilter(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                        >
                          <option value="all">🏢 Tất cả kho</option>
                          {warehouses.map(warehouse => (
                            <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Date range inputs */}
                      <div className="grid grid-cols-2 gap-2 xl:col-span-3">
                        <input
                          type="date"
                          value={historyDateFrom}
                          onChange={event => setHistoryDateFrom(event.target.value)}
                          title="Từ ngày"
                          className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                        />
                        <input
                          type="date"
                          value={historyDateTo}
                          onChange={event => setHistoryDateTo(event.target.value)}
                          title="Đến ngày"
                          className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                        />
                      </div>

                      {/* View mode toggle */}
                      <div className="flex items-center justify-end gap-1.5 xl:col-span-1">
                        <button
                          type="button"
                          onClick={() => setHistoryViewMode('table')}
                          title="Xem dạng bảng tinh gọn"
                          className={`rounded-xl p-2.5 transition ${
                            historyViewMode === 'table'
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <LayoutList size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistoryViewMode('cards')}
                          title="Xem dạng thẻ phân loại"
                          className={`rounded-xl p-2.5 transition ${
                            historyViewMode === 'cards'
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <LayoutGrid size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Quick filter pills row */}
                    <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-200/60">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
                          <Filter size={12} /> Lọc nhanh:
                        </span>
                        <button
                          type="button"
                          onClick={() => { setHistoryTypeFilter('all'); setHistoryStatusFilter('all'); }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition ${
                            historyTypeFilter === 'all' && historyStatusFilter === 'all'
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Tất cả ({historyTransactions.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => { setHistoryTypeFilter(TransactionType.IMPORT); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition flex items-center gap-1 ${
                            historyTypeFilter === TransactionType.IMPORT && historyStatusFilter === TransactionStatus.COMPLETED
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          <ArrowDownLeft size={11} /> Nhập kho ({historyCounts.import})
                        </button>
                        <button
                          type="button"
                          onClick={() => { setHistoryTypeFilter(TransactionType.EXPORT); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition flex items-center gap-1 ${
                            historyTypeFilter === TransactionType.EXPORT && historyStatusFilter === TransactionStatus.COMPLETED
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-white border border-blue-200 text-blue-700 hover:bg-blue-50'
                          }`}
                        >
                          <ArrowUpRight size={11} /> Xuất kho ({historyCounts.export})
                        </button>
                        <button
                          type="button"
                          onClick={() => { setHistoryTypeFilter(TransactionType.TRANSFER); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition flex items-center gap-1 ${
                            historyTypeFilter === TransactionType.TRANSFER && historyStatusFilter === TransactionStatus.COMPLETED
                              ? 'bg-violet-600 text-white shadow-xs'
                              : 'bg-white border border-violet-200 text-violet-700 hover:bg-violet-50'
                          }`}
                        >
                          <ArrowLeftRight size={11} /> Chuyển kho ({historyCounts.transfer})
                        </button>
                        <button
                          type="button"
                          onClick={() => { setHistoryTypeFilter(TransactionType.LIQUIDATION); setHistoryStatusFilter(TransactionStatus.COMPLETED); }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition flex items-center gap-1 ${
                            historyTypeFilter === TransactionType.LIQUIDATION && historyStatusFilter === TransactionStatus.COMPLETED
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'bg-white border border-red-200 text-red-700 hover:bg-red-50'
                          }`}
                        >
                          <Trash2 size={11} /> Xuất hủy ({historyCounts.liquidation})
                        </button>
                        <button
                          type="button"
                          onClick={() => { setHistoryTypeFilter('all'); setHistoryStatusFilter(TransactionStatus.CANCELLED); }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition flex items-center gap-1 ${
                            historyStatusFilter === TransactionStatus.CANCELLED
                              ? 'bg-rose-600 text-white shadow-xs'
                              : 'bg-white border border-rose-200 text-rose-700 hover:bg-rose-50'
                          }`}
                        >
                          <XCircle size={11} /> Bị từ chối ({historyCounts.rejected})
                        </button>
                      </div>

                      {(historySearch || historyTypeFilter !== 'all' || historyStatusFilter !== 'all' || historyWarehouseFilter !== 'all' || historyDateFrom || historyDateTo) && (
                        <button
                          type="button"
                          onClick={() => {
                            setHistorySearch('');
                            setHistoryTypeFilter('all');
                            setHistoryStatusFilter('all');
                            setHistoryWarehouseFilter('all');
                            setHistoryDateFrom('');
                            setHistoryDateTo('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-200/80 px-2.5 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-300 hover:text-slate-900 transition"
                        >
                          <RotateCcw size={11} /> Xóa lọc
                        </button>
                      )}
                    </div>
                  </div>

                  {/* NỘI DUNG LỊCH SỬ: DẠNG BẢNG TINH GỌN (MẶC ĐỊNH) */}
                  {paginatedHistory.length === 0 ? (
                    <EmptyState
                      icon={<History size={18} />}
                      title="Không có phiếu phù hợp"
                      message="Thử đổi từ khóa, khoảng ngày, kho hoặc loại phiếu để xem thêm lịch sử."
                    />
                  ) : historyViewMode === 'table' ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[900px]">
                          <thead>
                            <tr className="border-b border-slate-200/80 bg-slate-50/90 text-[11px] font-black uppercase tracking-wider text-slate-500">
                              <th className="py-3.5 pl-5 pr-3">Mã & Ngày lập</th>
                              <th className="py-3.5 px-3">Loại phiếu</th>
                              <th className="py-3.5 px-3">Luồng kho / Đối tác</th>
                              <th className="py-3.5 px-3">Vật tư</th>
                              <th className="py-3.5 px-3">Trạng thái</th>
                              <th className="py-3.5 pr-5 pl-3 text-right">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                            {paginatedHistory.map(tx => {
                              const requester = users.find(u => u.id === tx.requesterId);
                              const sourceWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
                              const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                              const supplyName = getTransactionSupplyName(tx);
                              const isApproved = tx.status === TransactionStatus.COMPLETED;
                              const isMaterialIssueTx = tx.items.some(item => !!item.materialIssueOrderId);
                              const voucherTitle = getVoucherTitle(tx);

                              return (
                                <tr
                                  key={tx.id}
                                  onClick={() => void openTransactionDetails(tx)}
                                  className="hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                                >
                                  {/* Mã & Ngày lập */}
                                  <td className="py-3.5 pl-5 pr-3">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50/80 px-2 py-0.5 rounded-lg border border-indigo-100/70 group-hover:bg-indigo-100 group-hover:border-indigo-200 transition">
                                        {formatVoucherCode(tx)}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                                      <span>{new Date(tx.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                                      <span>•</span>
                                      <span className="text-slate-600 font-bold">{requester?.name || 'Hệ thống'}</span>
                                    </div>
                                  </td>

                                  {/* Loại phiếu */}
                                  <td className="py-3.5 px-3">
                                    <div className="flex flex-col gap-0.5">
                                      <span className={`inline-flex items-center gap-1 w-fit rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                                        tx.type === TransactionType.IMPORT
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                          : tx.type === TransactionType.TRANSFER
                                            ? 'bg-violet-50 text-violet-700 border border-violet-200/60'
                                            : tx.type === TransactionType.LIQUIDATION
                                              ? 'bg-red-50 text-red-700 border border-red-200/60'
                                              : isMaterialIssueTx
                                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
                                                : 'bg-blue-50 text-blue-700 border border-blue-200/60'
                                      }`}>
                                        {tx.type === TransactionType.IMPORT && <ArrowDownLeft size={10} />}
                                        {tx.type === TransactionType.TRANSFER && <ArrowLeftRight size={10} />}
                                        {tx.type === TransactionType.LIQUIDATION && <Trash2 size={10} />}
                                        {tx.type === TransactionType.EXPORT && <ArrowUpRight size={10} />}
                                        {isMaterialIssueTx ? 'Xuất cấp thi công' : voucherTitle}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Luồng kho / Đối tác */}
                                  <td className="py-3.5 px-3 max-w-[220px]">
                                    {tx.type === TransactionType.IMPORT ? (
                                      <div>
                                        <div className="font-bold text-slate-800 truncate">{targetWh?.name || 'Kho nhận'}</div>
                                        {supplyName !== '-' && (
                                          <div className="text-[11px] font-medium text-slate-400 truncate mt-0.5">
                                            Nguồn: {supplyName}
                                          </div>
                                        )}
                                      </div>
                                    ) : tx.type === TransactionType.TRANSFER ? (
                                      <div className="flex items-center gap-1 font-bold text-slate-800 text-xs">
                                        <span className="truncate">{sourceWh?.name || '-'}</span>
                                        <ArrowRight size={12} className="text-violet-500 shrink-0" />
                                        <span className="text-violet-700 truncate">{targetWh?.name || '-'}</span>
                                      </div>
                                    ) : (
                                      <div>
                                        <div className="font-bold text-slate-800 truncate">{sourceWh?.name || 'Kho xuất'}</div>
                                        {tx.note && (
                                          <div className="text-[11px] font-medium text-slate-400 truncate mt-0.5">
                                            {tx.note}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </td>

                                  {/* Vật tư */}
                                  <td className="py-3.5 px-3 max-w-[240px]">
                                    <div className="font-black text-xs text-slate-800">
                                      {tx.items.length} mặt hàng
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-slate-500 truncate space-y-0.5">
                                      {tx.items.slice(0, 2).map((item, idx) => {
                                        const product = items.find(i => i.id === item.itemId) || tx.pendingItems?.find(i => i.id === item.itemId);
                                        return (
                                          <div key={idx} className="truncate">
                                            • {product?.name || 'Vật tư'} ({item.quantity} {product?.unit})
                                          </div>
                                        );
                                      })}
                                      {tx.items.length > 2 && (
                                        <span className="text-[10px] font-bold text-slate-400 italic">
                                          +{tx.items.length - 2} mặt hàng khác
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Trạng thái */}
                                  <td className="py-3.5 px-3">
                                    <StatusBadge
                                      status={tx.status}
                                      label={isApproved ? 'Hoàn thành' : 'Từ chối'}
                                      tone={isApproved ? 'success' : 'danger'}
                                      size="sm"
                                    />
                                  </td>

                                  {/* Thao tác */}
                                  <td className="py-3.5 pr-5 pl-3 text-right" onClick={e => e.stopPropagation()}>
                                    <div className="inline-flex items-center gap-1.5 justify-end">
                                      <button
                                        type="button"
                                        onClick={() => void openTransactionDetails(tx)}
                                        title="Xem chi tiết"
                                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 transition shadow-xs"
                                      >
                                        <Eye size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handlePrintTransaction(tx, 'print')}
                                        title="In phiếu"
                                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 transition shadow-xs"
                                      >
                                        <Printer size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handlePrintTransaction(tx, 'pdf')}
                                        title="Xuất PDF"
                                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
                                      >
                                        <FileDown size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    /* DẠNG THẺ (CARDS VIEW) */
                    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                      {historyColumns.map(column => {
                        const columnTransactions = paginatedHistory.filter(tx => getHistoryColumnKey(tx) === column.key);
                        return (
                          <div key={column.key} className={`rounded-2xl border p-3 min-h-[220px] ${column.className}`}>
                            <div className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-2 ${column.headerClassName}`}>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide">
                                  {column.icon}
                                  <span className="truncate">{column.title}</span>
                                </div>
                                <p className="mt-0.5 text-[10px] font-bold opacity-75">{column.description}</p>
                              </div>
                              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-black">{column.count}</span>
                            </div>

                            <div className="space-y-2">
                              {columnTransactions.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-[11px] font-bold text-slate-400">
                                  Không có phiếu ở trang này
                                </div>
                              ) : columnTransactions.map(tx => {
                                const requester = users.find(u => u.id === tx.requesterId);
                                const sourceWh = warehouses.find(w => w.id === tx.sourceWarehouseId);
                                const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                                const supplyName = getTransactionSupplyName(tx);
                                const isApproved = tx.status === TransactionStatus.COMPLETED;
                                const flowLabel = tx.type === TransactionType.IMPORT
                                  ? (targetWh?.name || 'Kho nhận')
                                  : tx.type === TransactionType.TRANSFER
                                    ? `${sourceWh?.name || '-'} -> ${targetWh?.name || '-'}`
                                    : (sourceWh?.name || 'Kho xuất');
                                return (
                                  <div
                                    key={tx.id}
                                    onClick={() => void openTransactionDetails(tx)}
                                    className="group rounded-2xl border border-white bg-white p-3 shadow-sm transition-all hover:border-accent hover:shadow-md cursor-pointer"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <StatusBadge status={tx.status} label={isApproved ? 'Hoàn thành' : 'Từ chối'} tone={isApproved ? 'success' : 'danger'} />
                                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">{formatVoucherCode(tx)}</span>
                                        </div>
                                        <h4 className="mt-2 text-sm font-black text-slate-800 leading-snug">{getVoucherTitle(tx)}</h4>
                                        <p className="mt-1 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                                          {requester?.name || 'Hệ thống'} • {formatVoucherDate(tx.date)}
                                        </p>
                                      </div>
                                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isApproved ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                        {isApproved ? <CheckCircle size={17} /> : <XCircle size={17} />}
                                      </div>
                                    </div>

                                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-slate-400">Kho</span>
                                        <span className="truncate text-right">{flowLabel}</span>
                                      </div>
                                      {tx.type === TransactionType.IMPORT && supplyName !== '-' && (
                                        <div className="flex items-center justify-between gap-2 mt-1">
                                          <span className="text-slate-400">Nguồn</span>
                                          <span className="truncate text-right">{supplyName}</span>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between gap-2 mt-1">
                                        <span className="text-slate-400">Vật tư</span>
                                        <span>{tx.items.length} dòng</span>
                                      </div>
                                    </div>

                                    {tx.note && <p className="mt-2 line-clamp-2 text-[11px] font-semibold text-slate-500">{tx.note}</p>}

                                    <div className="mt-3 flex gap-2" onClick={event => event.stopPropagation()}>
                                      <button
                                        type="button"
                                        onClick={() => handlePrintTransaction(tx, 'print')}
                                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                                      >
                                        <Printer size={13} /> In
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handlePrintTransaction(tx, 'pdf')}
                                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-slate-700"
                                      >
                                        <FileDown size={13} /> PDF
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <Pagination
                    currentPage={histPage}
                    totalPages={histTotalPages}
                    totalItems={histTotal}
                    startIndex={histStart}
                    endIndex={histEnd}
                    onPageChange={histSetPage}
                    pageSize={histPageSize}
                    onPageSizeChange={histSetPageSize}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Form tạo phiếu */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                {/* Nguồn cung cấp - bắt buộc cho NHẬP KHO */}
                {activeTab === TransactionType.IMPORT && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Nguồn cung cấp <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                      <button
                        type="button"
                        onClick={() => { setSupplySourceTab('supplier_contract'); setSupplySourceId(''); }}
                        className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide transition ${supplySourceTab === 'supplier_contract' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        HĐ nhà cung cấp
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSupplySourceTab('business_partner'); setSupplySourceId(''); }}
                        className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide transition ${supplySourceTab === 'business_partner' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        Đối tác
                      </button>
                    </div>
                    <SearchableSelect
                      value={supplySourceId}
                      options={supplySourceOptions}
                      onChange={option => setSupplySourceId(option?.id || '')}
                      getOptionValue={option => option.id}
                      getOptionLabel={option => option.label}
                      getOptionSearchText={option => option.searchText}
                      renderOption={option => (
                        <div>
                          <div className="font-black">{option.label}</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                            {option.selection.kind === 'supplier_contract'
                              ? option.selection.contract.name
                              : [option.selection.partner.taxCode ? `MST ${option.selection.partner.taxCode}` : '', option.selection.partner.phone].filter(Boolean).join(' • ') || 'Đối tác'}
                          </div>
                        </div>
                      )}
                      placeholder={isLoadingSupplySources ? 'Đang tải nguồn cung cấp...' : supplySourceTab === 'supplier_contract' ? 'Tìm mã HĐ, NCC...' : 'Tìm tên, MST, SĐT đối tác...'}
                      emptyLabel={isLoadingSupplySources ? 'Đang tải...' : 'Không có nguồn phù hợp'}
                      disabled={isLoadingSupplySources}
                      inputClassName="rounded-xl bg-slate-50 p-3 text-sm"
                    />
                  </div>
                )}

                {activeTab === TransactionType.IMPORT && (
                  <label className="space-y-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ngày phiếu nhập</span>
                    <input
                      type="date"
                      value={voucherDate}
                      onChange={event => setVoucherDate(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-accent"
                    />
                  </label>
                )}

                {/* Kho chính (kho của thủ kho) */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {warehouseLabel}
                  </label>
                  <select
                    disabled={hasAssignedWh}
                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-accent outline-none font-black text-sm disabled:opacity-70 disabled:bg-slate-100"
                    value={selectedWarehouseId}
                    onChange={e => setSelectedWarehouseId(e.target.value)}
                  >
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  {hasAssignedWh && (
                    <p className="text-[10px] text-blue-500 font-bold flex items-center gap-1">
                      <ShieldAlert size={10} /> Kho được giao quản lý của bạn
                    </p>
                  )}
                </div>

                {/* Kho đích - chỉ cho CHUYỂN KHO */}
                {activeTab === TransactionType.TRANSFER && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kho đích nhận hàng</label>
                    <select
                      className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-accent outline-none font-black text-sm"
                      value={targetWarehouseId}
                      onChange={e => setTargetWarehouseId(e.target.value)}
                    >
                      <option value="">Chọn kho nhận...</option>
                      {warehouses.filter(w => w.id !== selectedWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                )}

                <div className={`space-y-2 ${activeTab === TransactionType.LIQUIDATION ? 'lg:col-span-2' : 'lg:col-span-1'}`}>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ghi chú & Lý do</label>
                  <input type="text" className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 outline-none font-bold text-sm" placeholder="Thông tin bổ sung..." value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>

              {/* Thông báo cho thủ kho: Nhập kho tìm theo mã vật tư */}
              {hasAssignedWh && activeTab === TransactionType.IMPORT && (
                <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3">
                  <PackageSearch size={18} className="text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-black text-blue-700">Nhập kho theo mã vật tư</p>
                    <p className="text-[11px] text-blue-600 font-medium mt-0.5">Tìm và chọn vật tư theo mã SKU hoặc tên. Số lượng đề xuất không bị giới hạn bởi tồn kho hiện tại.</p>
                  </div>
                </div>
              )}

              <div className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-black text-xs uppercase tracking-widest text-slate-800 flex items-center">
                    <PackageSearch size={18} className="mr-2 text-accent" /> Danh sách vật tư trong phiếu
                  </h3>
                  <button onClick={() => setItemSelectOpen(true)} className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-black text-[10px] uppercase tracking-widest shadow-lg shadow-slate-500/20">
                    <Plus size={16} className="mr-1.5" /> Thêm / Scan
                  </button>
                </div>
                {txItems.length === 0 ? (
                  <div onClick={() => setItemSelectOpen(true)} className="border-4 border-dashed border-slate-50 rounded-2xl p-10 md:p-16 text-center text-slate-300 font-black uppercase tracking-widest cursor-pointer hover:bg-slate-50 transition-all text-sm">Nhấn để chọn vật tư...</div>
                ) : (
                  <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                    {/* Desktop View - NHẬP KHO: hiển thị cột kế toán */}
                    <div className="hidden md:block">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-black tracking-widest border-b border-slate-100">
                          <tr>
                            <th className="p-4">Sản phẩm</th>
                            {/* Hiển thị tồn kho tham khảo khi XUẤT/CHUYỂN/HỦY */}
                            {(activeTab !== TransactionType.IMPORT) && (
                              <th className="p-4 w-36 text-right">Tồn kho hiện tại</th>
                            )}
                            {/* Cột kế toán: Số KG - chỉ hiện khi NHẬP KHO */}
                            {activeTab === TransactionType.IMPORT && (
                              <th className="p-4 w-40 text-center">
                                <span className="flex items-center justify-center gap-1 text-amber-600">
                                  <Scale size={10} /> SL Kế toán (đ.vị mua)
                                </span>
                              </th>
                            )}
                            {activeTab === TransactionType.IMPORT && (
                              <th className="p-4 w-36 text-center">
                                <span className="flex items-center justify-center gap-1 text-amber-600">
                                  <Banknote size={10} /> Đơn giá mua
                                </span>
                              </th>
                            )}
                            <th className="p-4 w-32 text-center">SL Nhập kho ({activeTab === TransactionType.IMPORT ? 'Đ.vị kho' : 'Số lượng'})</th>
                            <th className="p-4 w-16"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {txItems.map((item, idx) => {
                            const product = items.find(i => i.id === item.itemId);
                            // ── Reserved Stock: dùng Available thay vì On-hand ──
                            const stockSummary = getStockSummary(item.itemId, selectedWarehouseId);
                            const currentStock = stockSummary.onHand; // Giữ để tham chiếu
                            const isOverAvailable = activeTab !== TransactionType.IMPORT && item.quantity > stockSummary.available;
                            const isOverOnHand = activeTab !== TransactionType.IMPORT && item.quantity > stockSummary.onHand;
                            const hasDualUnit = activeTab === TransactionType.IMPORT && product?.purchaseUnit && product.purchaseUnit !== product.unit;
                            const accData = accountingData[item.itemId] || { qty: '', price: '' };
                            const totalAccValue = hasDualUnit && accData.qty && accData.price
                              ? parseQuantityInput(accData.qty) * readLocaleNumber(accData.price)
                              : undefined;
                            return (
                              <tr key={idx} className={`hover:bg-slate-50/50 ${
                                hasDualUnit ? 'bg-amber-50/30' : isOverAvailable && !isOverOnHand ? 'bg-amber-50/20' : isOverOnHand ? 'bg-red-50/20' : ''
                              }`}>
                                <td className="p-4">
                                  <div className="font-black text-slate-800 text-sm">{product?.name}</div>
                                  <div className="text-[10px] text-slate-400 font-bold uppercase">{product?.sku}</div>
                                  {hasDualUnit && (
                                    <div className="mt-1 inline-flex items-center gap-1 text-[9px] bg-amber-100 text-amber-700 font-black px-1.5 py-0.5 rounded border border-amber-200">
                                      <Scale size={8} /> Mua: {product?.purchaseUnit} → Kho: {product?.unit}
                                    </div>
                                  )}
                                </td>
                                {activeTab !== TransactionType.IMPORT && (
                                  <td className="p-4 text-right">
                                    {/* ── Hiển thị 3 chỉ số tồn kho ── */}
                                    <div className="space-y-0.5">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <span className="text-[9px] text-slate-400 font-bold uppercase">Thực tế</span>
                                        <span className="text-sm font-black text-slate-600">{stockSummary.onHand.toLocaleString()}</span>
                                        <span className="text-[10px] text-slate-400 uppercase font-bold">{product?.unit}</span>
                                      </div>
                                      {stockSummary.reserved > 0 && (
                                        <div className="flex items-center justify-end gap-1.5">
                                          <Lock size={8} className="text-amber-500" />
                                          <span className="text-[9px] text-amber-600 font-black">Đang giữ: {stockSummary.reserved}</span>
                                        </div>
                                      )}
                                      <div className={`flex items-center justify-end gap-1 px-1.5 py-0.5 rounded text-[9px] font-black ${
                                        stockSummary.available === 0 && stockSummary.onHand > 0
                                          ? 'bg-red-100 text-red-600'
                                          : isOverAvailable
                                          ? 'bg-amber-100 text-amber-700'
                                          : 'bg-emerald-50 text-emerald-700'
                                      }`}>
                                        {stockSummary.available === 0 && stockSummary.onHand > 0 ? (
                                          <><AlertTriangle size={8} /> Hết khả dụng</>
                                        ) : isOverAvailable ? (
                                          <><AlertTriangle size={8} /> KD: {stockSummary.available}</>
                                        ) : (
                                          <>KD: {stockSummary.available}</>
                                        )}
                                      </div>
                                    </div>
                                    {isOverOnHand && (
                                      <div className="text-[9px] text-red-500 font-black flex items-center justify-end gap-0.5 mt-0.5">
                                        <AlertTriangle size={9} /> Vượt tồn thực
                                      </div>
                                    )}
                                  </td>
                                )}

                                {/* Cột kế toán: SL mua (KG) */}
                                {activeTab === TransactionType.IMPORT && (
                                  <td className="p-4">
                                    {hasDualUnit ? (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text" inputMode="decimal"
                                          placeholder="0.00"
                                          value={accData.qty}
                                          onChange={e => setAccountingData(prev => ({
                                            ...prev,
                                            [item.itemId]: {
                                              ...accData,
                                              qty: sanitizeQuantityInput(e.target.value, { previousValue: accData.qty }),
                                            }
                                          }))}
                                          className="w-full border-2 border-amber-200 bg-amber-50 rounded-lg px-2 py-1.5 text-center font-black text-amber-800 text-sm outline-none focus:border-amber-400"
                                        />
                                        <span className="text-[10px] font-black text-amber-600 uppercase whitespace-nowrap">{product?.purchaseUnit}</span>
                                      </div>
                                    ) : (
                                      <div className="text-center text-[10px] text-slate-300 italic">—</div>
                                    )}
                                  </td>
                                )}
                                {/* Cột Đơn giá mua (KG) */}
                                {activeTab === TransactionType.IMPORT && (
                                  <td className="p-4">
                                    {hasDualUnit ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="text" inputMode="decimal" min="0"
                                            placeholder="0"
                                            value={accData.price}
                                            onChange={e => setAccountingData(prev => ({
                                              ...prev,
                                              [item.itemId]: { ...accData, price: e.target.value }
                                            }))}
                                            className="w-full border-2 border-amber-200 bg-amber-50 rounded-lg px-2 py-1.5 text-center font-black text-amber-800 text-sm outline-none focus:border-amber-400"
                                          />
                                          <span className="text-[10px] font-black text-amber-600 whitespace-nowrap">₫/{product?.purchaseUnit}</span>
                                        </div>
                                        {totalAccValue !== undefined && (
                                          <div className="text-[9px] text-amber-700 font-black text-center bg-amber-100 px-1 py-0.5 rounded">
                                            = {totalAccValue.toLocaleString('vi-VN')} ₫
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-center text-[10px] text-slate-300 italic">—</div>
                                    )}
                                  </td>
                                )}
                                <td className="p-4">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={transactionQuantityInputs[item.itemId] ?? formatQuantityInput(item.quantity)}
                                      onChange={(e) => updateTransactionQuantityInput(item.itemId, e.target.value)}
                                      className={`w-full border-2 rounded-lg px-2 py-1.5 text-center font-black text-accent outline-none focus:border-accent ${isOverOnHand ? 'border-red-300 bg-red-50' : isOverAvailable ? 'border-amber-300 bg-amber-50' : 'border-slate-100'}`}
                                    />
                                    <span className="text-[10px] font-black text-slate-400 uppercase">{product?.unit}</span>
                                  </div>
                                  {hasDualUnit && accData.qty && accData.price && item.quantity > 0 && (
                                    <div className="text-[9px] text-slate-400 font-bold text-center mt-1 italic">
                                      Giá vốn/cây: {Math.round(parseQuantityInput(accData.qty) * readLocaleNumber(accData.price) / item.quantity).toLocaleString('vi-VN')} ₫
                                    </div>
                                  )}
                                </td>
                                <td className="p-4 text-right">
                                  <button onClick={() => {
                                    setTxItems(txItems.filter(ti => ti.itemId !== item.itemId));
                                    setTransactionQuantityInputs(prev => {
                                      const next = { ...prev };
                                      delete next[item.itemId];
                                      return next;
                                    });
                                    setAccountingData(prev => { const n = { ...prev }; delete n[item.itemId]; return n; });
                                  }} className="text-slate-300 hover:text-red-500 p-2 rounded-lg transition-colors"><Trash2 size={18} /></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {txItems.map((item, idx) => {
                        const product = items.find(i => i.id === item.itemId);
                        const stockSummary = getStockSummary(item.itemId, selectedWarehouseId);
                        const currentStock = stockSummary.onHand;
                        const availableStock = stockSummary.available;
                        const isOverStock = activeTab !== TransactionType.IMPORT && item.quantity > availableStock;
                        return (
                          <div key={idx} className="p-4 space-y-3">
                            <div className="flex justify-between items-start">
                              <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-mono text-slate-400 font-bold uppercase mb-0.5">{product?.sku}</div>
                                <h4 className="font-black text-slate-800 text-sm truncate pr-4">{product?.name}</h4>
                                {activeTab !== TransactionType.IMPORT && (
                                  <div className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${isOverStock ? 'text-orange-500' : 'text-slate-400'}`}>
                                    {isOverStock && <AlertTriangle size={9} />}
                                    Tồn kho: {currentStock} {product?.unit}
                                    {stockSummary.reserved > 0 && `, khả dụng: ${availableStock}`}
                                    {isOverStock && ' (Vượt tồn)'}
                                  </div>
                                )}
                              </div>
                              <button onClick={() => {
                                setTxItems(txItems.filter(ti => ti.itemId !== item.itemId));
                                setTransactionQuantityInputs(prev => {
                                  const next = { ...prev };
                                  delete next[item.itemId];
                                  return next;
                                });
                              }} className="p-2 text-slate-300 hover:text-red-600 transition-colors shrink-0"><Trash2 size={18} /></button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Số lượng:</span>
                              <div className="flex items-center gap-3 bg-slate-50 p-1 rounded-lg border border-slate-100">
                                <button onClick={() => adjustTransactionQuantity(item.itemId, -1)} className="p-1.5 bg-white rounded border border-slate-200 text-slate-400"><Minus size={14} /></button>
                                <span className="w-12 text-center font-black text-sm">{formatQuantityInput(item.quantity)}</span>
                                <button onClick={() => adjustTransactionQuantity(item.itemId, 1)} className="p-1.5 bg-white rounded border border-slate-200 text-slate-400"><Plus size={14} /></button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {activeTab === TransactionType.IMPORT && (
                      <div className="p-4 border-t border-slate-100 bg-amber-50/30 text-right text-xs font-bold text-amber-700">
                        {(() => {
                          let totalAccQty = 0;
                          let totalAccValue = 0;
                          let hasDualUnitItem = false;

                          txItems.forEach(item => {
                            const product = items.find(i => i.id === item.itemId);
                            const hasDualUnit = product?.purchaseUnit && product.purchaseUnit !== product.unit;
                            if (hasDualUnit) {
                              hasDualUnitItem = true;
                              const accData = accountingData[item.itemId] || { qty: '', price: '' };
                              const qty = parseQuantityInput(accData.qty);
                              const price = readLocaleNumber(accData.price);
                              if (!isNaN(qty)) totalAccQty += qty;
                              if (!isNaN(qty) && !isNaN(price)) totalAccValue += qty * price;
                            }
                          });

                          if (hasDualUnitItem) {
                            return (
                              <>
                                <div className="flex justify-end items-center gap-1">
                                  <Scale size={10} /> Tổng SL Kế toán: <span className="font-black text-sm">{totalAccQty.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-end items-center gap-1 mt-1">
                                  <Banknote size={10} /> Tổng giá trị mua: <span className="font-black text-sm">{totalAccValue.toLocaleString('vi-VN')} ₫</span>
                                </div>
                              </>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tóm tắt và nút gửi */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center pt-6 border-t border-slate-100 gap-4">
                <div className="text-xs text-slate-400 font-medium">
                  {txItems.length > 0 && (
                    <span className="font-black text-slate-600">{txItems.length} vật tư</span>
                  )}
                  {(activeTab !== TransactionType.IMPORT) && txItems.some(ti => {
                    const summary = getStockSummary(ti.itemId, selectedWarehouseId);
                    return ti.quantity > summary.available;
                  }) && (
                    <span className="ml-3 text-amber-600 font-black flex items-center gap-1">
                      <Lock size={12} /> Một số mặt hàng vượt tồn khả dụng — Admin sẽ xét duyệt
                    </span>
                  )}
                  {(activeTab !== TransactionType.IMPORT) && txItems.some(ti => {
                    const stock = getStockInWarehouse(ti.itemId, selectedWarehouseId);
                    return ti.quantity > stock;
                  }) && (
                    <span className="ml-3 text-red-500 font-black flex items-center gap-1">
                      <AlertTriangle size={12} /> Một số mặt hàng vượt tồn thực tế
                    </span>
                  )}

                </div>
                <button
                  onClick={handleSubmit}
                  disabled={submittingTx}
                  className="px-12 py-4 bg-accent text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl hover:bg-blue-700 transition-all flex items-center shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submittingTx ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Send size={18} className="mr-2" />} {submittingTx ? 'Đang gửi...' : 'Gửi đề xuất phê duyệt'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Operations;
