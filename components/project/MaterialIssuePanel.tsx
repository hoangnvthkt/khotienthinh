import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  PackagePlus,
  Plus,
  RefreshCcw,
  Send,
  Search,
  Trash2,
  Undo2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useReservedStock } from '../../hooks/useReservedStock';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { supplierContractService } from '../../lib/hdService';
import {
  MaterialIssueOrder,
  MaterialIssueRecipientType,
  MaterialIssueStatus,
  Role,
  BusinessPartner,
  SupplierContract,
  InventoryItem,
} from '../../types';
import { materialIssueService } from '../../lib/materialIssueService';
import { partnerService } from '../../lib/partnerService';
import { isGlobalWarehouseKeeper } from '../../lib/wmsPermissions';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import { normalizeLookupText, SITE_WAREHOUSE_STOP_WORDS } from '../../lib/projectMaterialTabUtils';
import { buildMaterialIssueRecipientSource, type MaterialIssueRecipientSourceSelection } from '../../lib/materialIssueRecipientSource';
import { dateInputToTransactionTimestamp } from '../../lib/transactionVoucherDates';
import { formatQuantityInput, parseQuantityInput, sanitizeQuantityInput } from '../../lib/quantityInput';

type MaterialIssuePanelProps = {
  projectId?: string | null;
  constructionSiteId?: string | null;
  materialRequestId?: string | null;
  defaultSourceWarehouseId?: string | null;
  compact?: boolean;
  canCreate?: boolean;
  onChanged?: () => void;
};

type DraftLine = {
  key: string;
  itemId: string;
  quantity: string;
  note: string;
};

type StockItemOption = {
  item: InventoryItem;
  available: number;
  onHand: number;
  reserved: number;
};

type StockDraftInput = {
  quantity: string;
  note: string;
};

type RecipientSourceTab = 'supplier_contract' | 'business_partner';

type RecipientSourceOption = {
  id: string;
  label: string;
  searchText: string;
  selection: MaterialIssueRecipientSourceSelection;
};

type ActionType = 'receipt' | 'return' | 'consume' | 'loss' | 'cancel';

type ActionState = {
  type: ActionType;
  order: MaterialIssueOrder;
} | null;

const RECIPIENT_LABELS: Record<MaterialIssueRecipientType, string> = {
  employee: 'Nhân viên',
  work_group: 'Tổ đội',
  subcontractor: 'Thầu phụ',
  partner: 'Đối tác',
  manual: 'Nhập tay',
};

const STATUS_META: Record<MaterialIssueStatus, { label: string; tone: string }> = {
  draft: { label: 'Nháp', tone: 'bg-slate-100 text-slate-600' },
  submitted: { label: 'Đã gửi', tone: 'bg-blue-50 text-blue-600' },
  wms_pending: { label: 'Chờ kho xuất', tone: 'bg-amber-100 text-amber-700' },
  issued: { label: 'Đã xuất, chờ nhận', tone: 'bg-indigo-100 text-indigo-700' },
  partially_received: { label: 'Nhận một phần', tone: 'bg-cyan-100 text-cyan-700' },
  received: { label: 'Đã nhận', tone: 'bg-emerald-100 text-emerald-700' },
  settling: { label: 'Đang quyết toán', tone: 'bg-violet-100 text-violet-700' },
  partially_returned: { label: 'Hoàn trả một phần', tone: 'bg-rose-100 text-rose-700' },
  closed: { label: 'Đã đóng', tone: 'bg-slate-800 text-white' },
  rejected: { label: 'Kho từ chối', tone: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Đã hủy', tone: 'bg-slate-200 text-slate-500' },
};

const parseQty = (value: string | number | null | undefined) => {
  const parsed = parseQuantityInput(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQty = (value: number) => Number(value || 0).toLocaleString('vi-VN', {
  maximumFractionDigits: 3,
});

const lineOpenQty = (line: MaterialIssueOrder['lines'][number]) =>
  Math.max(0, Number(line.issuedQty || 0) - Number(line.returnedQty || 0) - Number(line.consumedQty || 0) - Number(line.lostQty || 0));

const lineReceiptRemaining = (line: MaterialIssueOrder['lines'][number]) =>
  Math.max(0, Number(line.issuedQty || 0) - Number(line.receivedQty || 0));

const getRecipientOptionLabel = (type: MaterialIssueRecipientType) => {
  if (type === 'employee') return 'Chọn nhân viên nhận';
  if (type === 'work_group') return 'Chọn tổ đội';
  if (type === 'subcontractor') return 'Chọn hợp đồng/thầu phụ';
  if (type === 'partner') return 'Chọn đối tác';
  return 'Tên bên nhận';
};

const getRecipientSourceLabel = (order: MaterialIssueOrder) => {
  if (order.recipientSourceType === 'supplier_contract') return 'HĐ nhà cung cấp';
  if (order.recipientSourceType === 'business_partner') return 'Đối tác';
  return RECIPIENT_LABELS[order.recipientType];
};

const MaterialIssuePanel: React.FC<MaterialIssuePanelProps> = ({
  projectId,
  constructionSiteId,
  materialRequestId,
  defaultSourceWarehouseId,
  compact = false,
  canCreate = true,
  onChanged,
}) => {
  const {
    items,
    warehouses,
    users,
    user,
    loadModuleData,
    refreshWmsRecords,
    constructionSites,
  } = useApp();
  const toast = useToast();
  const { getStockSummary } = useReservedStock();

  const [orders, setOrders] = useState<MaterialIssueOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);

  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [recipientSourceTab, setRecipientSourceTab] = useState<RecipientSourceTab>('supplier_contract');
  const [recipientSourceId, setRecipientSourceId] = useState('');
  const [supplierContracts, setSupplierContracts] = useState<SupplierContract[]>([]);
  const [recipientName, setRecipientName] = useState('');
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('');
  const [recipientMenuOpen, setRecipientMenuOpen] = useState(false);
  const [responsibleUserId, setResponsibleUserId] = useState(user.id);
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [stockMenuOpen, setStockMenuOpen] = useState(false);
  const [stockDraftByItemId, setStockDraftByItemId] = useState<Record<string, StockDraftInput>>({});
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(() => new Set());
  const [action, setAction] = useState<ActionState>(null);
  const [actionQtyByLine, setActionQtyByLine] = useState<Record<string, string>>({});
  const [actionReason, setActionReason] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [returnWarehouseId, setReturnWarehouseId] = useState('');

  const canUseAllWarehouses = user.role === Role.ADMIN || isGlobalWarehouseKeeper(user);
  const selectableWarehouses = useMemo(() => {
    const active = warehouses.filter(warehouse => !warehouse.isArchived);
    if (canUseAllWarehouses) return active;
    return active.filter(warehouse => warehouse.id === user.assignedWarehouseId);
  }, [warehouses, canUseAllWarehouses, user.assignedWarehouseId]);

  const computedProjectWarehouseId = useMemo(() => {
    if (defaultSourceWarehouseId) return defaultSourceWarehouseId;
    const activeSiteWarehouses = warehouses.filter(warehouse => !warehouse.isArchived && warehouse.type === 'SITE');
    const site = constructionSiteId ? (constructionSites || []).find(item => item.id === constructionSiteId) : undefined;
    const siteName = normalizeLookupText(site?.name);
    if (!siteName) return undefined;
    const exactName = activeSiteWarehouses.find(warehouse => normalizeLookupText(warehouse.name).includes(siteName));
    if (exactName) return exactName.id;
    const tokens = siteName.split(' ').filter(token => token.length > 1 && !SITE_WAREHOUSE_STOP_WORDS.has(token));
    if (tokens.length === 0) return undefined;
    const allTokenMatch = activeSiteWarehouses.find(warehouse => {
      const warehouseName = normalizeLookupText(warehouse.name);
      return tokens.every(token => warehouseName.includes(token));
    });
    if (allTokenMatch) return allTokenMatch.id;
    return activeSiteWarehouses.find(warehouse => {
      const warehouseName = normalizeLookupText(warehouse.name);
      return tokens.some(token => warehouseName.includes(token));
    })?.id;
  }, [constructionSiteId, constructionSites, defaultSourceWarehouseId, warehouses]);

  const activeUsers = useMemo(() => users.filter(item => item.isActive !== false), [users]);
  const selectedWarehouse = warehouses.find(warehouse => warehouse.id === sourceWarehouseId);

  const warehouseStockOptions = useMemo<StockItemOption[]>(() => {
    if (!sourceWarehouseId) return [];
    return items.flatMap(item => {
      const stock = getStockSummary(item.id, sourceWarehouseId);
      if (stock.available <= 0) return [];
      return [{
        item,
        available: stock.available,
        onHand: stock.onHand,
        reserved: stock.reserved,
      }];
    }).sort((a, b) => a.item.name.localeCompare(b.item.name, 'vi'));
  }, [items, sourceWarehouseId, getStockSummary]);

  const availableStockItemIdSet = useMemo(
    () => new Set(warehouseStockOptions.map(option => option.item.id)),
    [warehouseStockOptions],
  );

  const selectedStockOptions = useMemo(
    () => warehouseStockOptions.filter(option => selectedItemIds.includes(option.item.id)),
    [selectedItemIds, warehouseStockOptions],
  );

  const filteredWarehouseStockOptions = useMemo(() => {
    const query = stockSearchQuery.trim();
    const rows = query
      ? warehouseStockOptions.filter(option => matchesSearchQueryMultiple([
        option.item.sku,
        option.item.name,
        option.item.category,
        option.item.unit,
        selectedWarehouse?.name,
      ], query))
      : warehouseStockOptions;
    return rows.slice(0, 80);
  }, [selectedWarehouse?.name, stockSearchQuery, warehouseStockOptions]);

  const visibleStockOptionsSelected = filteredWarehouseStockOptions.length > 0
    && filteredWarehouseStockOptions.every(option => selectedItemIds.includes(option.item.id));

  const createDefaultStockDraft = (): StockDraftInput => ({ quantity: '1', note: '' });

  const toggleStockItemSelection = (itemId: string, checked: boolean) => {
    setSelectedItemIds(prev => checked
      ? [...new Set([...prev, itemId])]
      : prev.filter(id => id !== itemId)
    );
    setStockDraftByItemId(prev => {
      if (checked) {
        return prev[itemId] ? prev : { ...prev, [itemId]: createDefaultStockDraft() };
      }
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const toggleVisibleStockOptions = (checked: boolean) => {
    const visibleIds = filteredWarehouseStockOptions.map(option => option.item.id);
    setSelectedItemIds(prev => checked
      ? [...new Set([...prev, ...visibleIds])]
      : prev.filter(id => !visibleIds.includes(id))
    );
    setStockDraftByItemId(prev => {
      const next = { ...prev };
      if (checked) {
        visibleIds.forEach(id => {
          if (!next[id]) next[id] = createDefaultStockDraft();
        });
      } else {
        visibleIds.forEach(id => {
          delete next[id];
        });
      }
      return next;
    });
  };

  const updateStockDraft = (itemId: string, patch: Partial<StockDraftInput>) => {
    setStockDraftByItemId(prev => ({
      ...prev,
      [itemId]: {
        ...createDefaultStockDraft(),
        ...prev[itemId],
        ...patch,
      },
    }));
  };

  const clearStockSelection = () => {
    setSelectedItemIds([]);
    setStockDraftByItemId({});
    setStockSearchQuery('');
  };

  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const selectedStockSummary = useMemo(
    () => selectedStockOptions.length === 0
      ? ''
      : selectedStockOptions.length === 1
        ? `${selectedStockOptions[0].item.sku} - ${selectedStockOptions[0].item.name}`
        : `${selectedStockOptions.length} vật tư đã chọn`,
    [selectedStockOptions],
  );

  const recipientSourceOptions = useMemo<RecipientSourceOption[]>(() => {
    if (recipientSourceTab === 'supplier_contract') {
      return supplierContracts.map(contract => ({
        id: contract.id,
        label: `${contract.code} – ${contract.supplierName || contract.name}`,
        searchText: [contract.code, contract.name, contract.supplierName, contract.supplierRepresentative].filter(Boolean).join(' '),
        selection: { kind: 'supplier_contract', contract },
      }));
    }
    return partners.map(partner => ({
      id: partner.id,
      label: `${partner.code ? `${partner.code} – ` : ''}${partner.name}`,
      searchText: [partner.code, partner.name, partner.taxCode, partner.phone, partner.contactName, partner.email].filter(Boolean).join(' '),
      selection: { kind: 'business_partner', partner },
    }));
  }, [partners, recipientSourceTab, supplierContracts]);

  const filteredRecipientSourceOptions = useMemo(() => {
    if (!recipientSearchQuery.trim()) return recipientSourceOptions.slice(0, 50);
    return recipientSourceOptions.filter(option =>
      matchesSearchQueryMultiple([option.searchText], recipientSearchQuery)
    ).slice(0, 50);
  }, [recipientSearchQuery, recipientSourceOptions]);

  const selectedRecipientSource = useMemo(
    () => recipientSourceOptions.find(option => option.id === recipientSourceId) || null,
    [recipientSourceId, recipientSourceOptions],
  );

  const selectRecipientSource = (option: RecipientSourceOption) => {
    const recipient = buildMaterialIssueRecipientSource(option.selection);
    setRecipientSourceId(option.id);
    setRecipientName(recipient.recipientName);
    setRecipientSearchQuery('');
    setRecipientMenuOpen(false);
  };

  const clearRecipient = () => {
    setRecipientSourceId('');
    setRecipientName('');
    setRecipientSearchQuery('');
    setRecipientMenuOpen(false);
  };

  useEffect(() => {
    const handleOutsideClick = (event: PointerEvent) => {
      const el = document.getElementById('recipient-combobox-wrapper');
      if (el && !el.contains(event.target as Node)) {
        setRecipientMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: PointerEvent) => {
      const el = document.getElementById('stock-multi-select-wrapper');
      if (el && !el.contains(event.target as Node)) {
        setStockMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await materialIssueService.list({
        projectId: projectId || null,
        constructionSiteId: constructionSiteId || null,
        limit: compact ? 20 : 80,
      });
      setOrders(rows);
    } catch (error) {
      logApiError('materialIssueService.list', error);
      toast.error('Không thể tải phiếu xuất cấp', getApiErrorMessage(error, 'Vui lòng thử lại sau.'));
    } finally {
      setLoading(false);
    }
  }, [compact, constructionSiteId, projectId, toast]);

  useEffect(() => {
    void loadModuleData('wms-core');
    void loadOrders();
  }, [loadModuleData, loadOrders]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [partnerRows, contractRows] = await Promise.all([
          partnerService.list({ includeInactive: false }).catch(() => []),
          supplierContractService.list().catch(() => []),
        ]);
        if (cancelled) return;
        setPartners(partnerRows);
        setSupplierContracts(contractRows);
      } catch (error) {
        logApiError('MaterialIssuePanel.loadMasterData', error);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [constructionSiteId, projectId]);

  useEffect(() => {
    if (computedProjectWarehouseId) {
      setSourceWarehouseId(computedProjectWarehouseId);
    } else if (!sourceWarehouseId) {
      const initialWhId = defaultSourceWarehouseId || user.assignedWarehouseId || selectableWarehouses[0]?.id || '';
      if (initialWhId) {
        setSourceWarehouseId(initialWhId);
      }
    }
  }, [computedProjectWarehouseId, defaultSourceWarehouseId, selectableWarehouses, user.assignedWarehouseId]);

  useEffect(() => {
    setSelectedItemIds(prev => prev.filter(id => availableStockItemIdSet.has(id)));
    setStockDraftByItemId(prev => Object.fromEntries(
      Object.entries(prev).filter(([itemId]) => availableStockItemIdSet.has(itemId)),
    ));
  }, [availableStockItemIdSet]);

  const resetCreateForm = () => {
    setRecipientSourceId('');
    setRecipientName('');
    setRecipientSearchQuery('');
    setRecipientMenuOpen(false);
    setVoucherDate(new Date().toISOString().slice(0, 10));
    setNote('');
    setSelectedItemIds([]);
    setStockSearchQuery('');
    setStockMenuOpen(false);
    setStockDraftByItemId({});
    setDraftLines([]);
  };

  const addDraftLine = () => {
    const selectedRows = selectedStockOptions
      .filter(option => availableStockItemIdSet.has(option.item.id))
      .map(option => ({
        option,
        draft: stockDraftByItemId[option.item.id] || createDefaultStockDraft(),
        quantity: parseQty(stockDraftByItemId[option.item.id]?.quantity || '1'),
      }));

    if (selectedRows.length === 0) {
      toast.warning('Chưa chọn vật tư', 'Tick ít nhất một vật tư và nhập số lượng lớn hơn 0.');
      return;
    }
    const invalidQty = selectedRows.find(row => row.quantity <= 0);
    if (invalidQty) {
      toast.warning('Số lượng không hợp lệ', `Nhập số lượng lớn hơn 0 cho ${invalidQty.option.item.sku}.`);
      return;
    }
    const overStock = selectedRows.find(row => row.quantity > row.option.available);
    if (overStock) {
      toast.warning('Vượt tồn khả dụng', `${overStock.option.item.sku} chỉ còn khả dụng ${formatQty(overStock.option.available)} ${overStock.option.item.unit}.`);
      return;
    }

    setDraftLines(prev => {
      let next = [...prev];
      selectedRows.forEach(({ option, draft, quantity }) => {
        const itemId = option.item.id;
        const trimmedNote = draft.note.trim();
        const existing = next.find(line => line.itemId === itemId);
        if (existing) {
          next = next.map(line => line.itemId === itemId
            ? { ...line, quantity: formatQuantityInput(parseQty(line.quantity) + quantity), note: trimmedNote || line.note }
            : line);
        } else {
          next.push({
            key: crypto.randomUUID(),
            itemId,
            quantity: formatQuantityInput(quantity),
            note: trimmedNote,
          });
        }
      });
      return next;
    });
    setSelectedItemIds([]);
    setStockSearchQuery('');
    setStockMenuOpen(false);
    setStockDraftByItemId({});
  };

  const handleCreateIssue = async () => {
    if (submitting) return;
    if (!sourceWarehouseId) {
      toast.warning('Chưa chọn kho xuất');
      return;
    }
    if (!selectedRecipientSource) {
      toast.warning('Chưa chọn tổ đội', 'Chọn một hợp đồng nhà cung cấp hoặc một đối tác trước khi gửi phiếu xuất cấp.');
      return;
    }
    if (draftLines.length === 0) {
      toast.warning('Chưa có vật tư', 'Thêm ít nhất một dòng vật tư cần cấp.');
      return;
    }

    const invalidLine = draftLines.find(line => parseQty(line.quantity) <= 0 || !items.some(item => item.id === line.itemId));
    if (invalidLine) {
      toast.warning('Dòng vật tư không hợp lệ', 'Kiểm tra lại vật tư và số lượng.');
      return;
    }

    setSubmitting(true);
    try {
      const recipient = buildMaterialIssueRecipientSource(selectedRecipientSource.selection);
      const created = await materialIssueService.createAndSubmit({
        projectId: projectId || null,
        constructionSiteId: constructionSiteId || null,
        sourceWarehouseId,
        recipientType: recipient.recipientType,
        recipientId: recipient.recipientId,
        recipientName: recipient.recipientName,
        recipientSourceType: recipient.recipientSourceType,
        recipientSourceId: recipient.recipientSourceId,
        responsibleUserId: responsibleUserId || null,
        materialRequestId: materialRequestId || null,
        transactionDate: dateInputToTransactionTimestamp(voucherDate) || null,
        note: note.trim() || null,
        lines: draftLines.map(line => {
          const item = items.find(row => row.id === line.itemId);
          return {
            itemId: line.itemId,
            quantity: parseQty(line.quantity),
            unit: item?.unit || null,
            unitPrice: item?.priceIn || 0,
            note: line.note.trim() || null,
          };
        }),
      });
      toast.success('Đã tạo phiếu xuất cấp', `${created.issueNo} đang chờ kho xuất duyệt.`);
      resetCreateForm();
      await Promise.all([
        loadOrders(),
        refreshWmsRecords({
          itemIds: created.lines.map(line => line.itemId),
          transactionIds: [created.transactionId],
          requestIds: [created.materialRequestId || materialRequestId],
        }),
      ]);
      onChanged?.();
    } catch (error) {
      logApiError('materialIssueService.createAndSubmit', error);
      toast.error('Không thể tạo phiếu xuất cấp', getApiErrorMessage(error, 'Vui lòng kiểm tra quyền và dữ liệu.'));
    } finally {
      setSubmitting(false);
    }
  };

  const openAction = (type: ActionType, order: MaterialIssueOrder) => {
    const defaults: Record<string, string> = {};
    order.lines.forEach(line => {
      if (type === 'receipt') defaults[line.id] = formatQuantityInput(lineReceiptRemaining(line));
      else defaults[line.id] = '0';
    });
    setAction({ type, order });
    setActionQtyByLine(defaults);
    setActionReason('');
    setActionNote('');
    setReturnWarehouseId(order.sourceWarehouseId);
  };

  const handleActionSubmit = async () => {
    if (!action || actionLoading) return;
    const { order, type } = action;
    const selectedLines = order.lines
      .map(line => ({
        line,
        quantity: parseQty(actionQtyByLine[line.id]),
      }))
      .filter(row => row.quantity > 0);

    if (type !== 'cancel' && selectedLines.length === 0) {
      toast.warning('Chưa nhập số lượng', 'Nhập số lượng lớn hơn 0 cho ít nhất một dòng.');
      return;
    }
    if ((type === 'return' || type === 'consume' || type === 'loss' || type === 'cancel') && !actionReason.trim()) {
      toast.warning('Thiếu lý do', 'Nhập lý do để lưu vết quyết toán.');
      return;
    }
    if (type === 'return' && !returnWarehouseId) {
      toast.warning('Chưa chọn kho nhận trả');
      return;
    }

    setActionLoading(true);
    try {
      const touchedItemIds = order.lines.map(line => line.itemId);
      const touchedTransactionIds: Array<string | null | undefined> = [order.transactionId];
      if (type === 'receipt') {
        await materialIssueService.confirmReceipt({
          orderId: order.id,
          note: actionNote.trim() || null,
          lines: selectedLines.map(row => ({
            issueLineId: row.line.id,
            receivedQty: row.quantity,
          })),
        });
        toast.success('Đã xác nhận nhận hàng');
      } else if (type === 'return') {
        const materialReturn = await materialIssueService.createReturn({
          orderId: order.id,
          targetWarehouseId: returnWarehouseId,
          reason: actionReason.trim(),
          note: actionNote.trim() || null,
          lines: selectedLines.map(row => ({
            issueLineId: row.line.id,
            returnQty: row.quantity,
            reason: actionReason.trim(),
          })),
        });
        touchedTransactionIds.push(materialReturn.transactionId);
        toast.success('Đã tạo phiếu hoàn trả', 'Phiếu nhập trả đang chờ WMS duyệt để cộng tồn.');
      } else if (type === 'consume' || type === 'loss') {
        await materialIssueService.recordSettlement({
          orderId: order.id,
          settlementType: type,
          reason: actionReason.trim(),
          lines: selectedLines.map(row => ({
            issueLineId: row.line.id,
            quantity: row.quantity,
          })),
        });
        toast.success(type === 'consume' ? 'Đã ghi nhận sử dụng' : 'Đã ghi nhận hao hụt');
      } else if (type === 'cancel') {
        await materialIssueService.cancel(order.id, actionReason.trim());
        toast.success('Đã hủy phiếu xuất cấp');
      }
      setAction(null);
      await Promise.all([
        loadOrders(),
        refreshWmsRecords({
          itemIds: touchedItemIds,
          transactionIds: touchedTransactionIds,
          requestIds: [order.materialRequestId || materialRequestId],
        }),
      ]);
      onChanged?.();
    } catch (error) {
      logApiError('MaterialIssuePanel.handleActionSubmit', error);
      toast.error('Không thể cập nhật phiếu', getApiErrorMessage(error, 'Vui lòng thử lại.'));
    } finally {
      setActionLoading(false);
    }
  };

  const renderOrderActions = (order: MaterialIssueOrder) => {
    const canConfirm = ['issued', 'partially_received', 'settling', 'partially_returned'].includes(order.status);
    const canSettle = ['issued', 'partially_received', 'received', 'settling', 'partially_returned'].includes(order.status)
      && order.lines.some(line => lineOpenQty(line) > 0);
    const canCancel = ['draft', 'submitted', 'wms_pending'].includes(order.status);

    return (
      <div className="flex flex-wrap gap-2">
        {canConfirm && (
          <button onClick={() => openAction('receipt', order)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700">
            <ClipboardCheck size={13} /> Xác nhận nhận
          </button>
        )}
        {canSettle && (
          <>
            <button onClick={() => openAction('return', order)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-black uppercase tracking-widest hover:bg-blue-100">
              <Undo2 size={13} /> Hoàn trả
            </button>
            <button onClick={() => openAction('consume', order)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700">
              <PackageCheck size={13} /> Đã dùng
            </button>
            <button onClick={() => openAction('loss', order)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100">
              <AlertTriangle size={13} /> Hao hụt
            </button>
          </>
        )}
        {canCancel && (
          <button onClick={() => openAction('cancel', order)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-red-600 border border-red-100 text-[10px] font-black uppercase tracking-widest hover:bg-red-50">
            <XCircle size={13} /> Hủy
          </button>
        )}
      </div>
    );
  };

  const actionTitle = action
    ? action.type === 'receipt'
      ? 'Xác nhận nhận hàng'
      : action.type === 'return'
        ? 'Hoàn trả vật tư thừa'
        : action.type === 'consume'
          ? 'Ghi nhận sử dụng'
          : action.type === 'loss'
            ? 'Ghi nhận hao hụt'
            : 'Hủy phiếu xuất cấp'
    : '';

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <PackagePlus size={16} className="text-indigo-500" /> Xuất cấp thi công
            </h3>
            <p className="text-xs text-slate-400 mt-1">Cấp vật tư cho tổ đội, thầu phụ, đối tác và theo dõi trách nhiệm sau khi xuất khỏi kho.</p>
          </div>
          <button onClick={loadOrders} disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} Tải lại
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-visible">
        {canCreate && (
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black text-slate-700 dark:text-white uppercase tracking-widest">Tạo phiếu xuất cấp</div>
              <div className="text-[11px] text-slate-400 mt-1">Submit xong sẽ sinh phiếu xuất kho WMS ở trạng thái chờ duyệt.</div>
            </div>
            {selectedWarehouse && (
              <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black">
                Kho xuất: {selectedWarehouse.name}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kho xuất</span>
              <select value={sourceWarehouseId} onChange={event => setSourceWarehouseId(event.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400">
                <option value="">Chọn kho</option>
                {selectableWarehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>

            <div className="relative space-y-1 md:col-span-2" id="recipient-combobox-wrapper">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chọn tổ đội <span className="text-rose-500">*</span></span>
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => { setRecipientSourceTab('supplier_contract'); clearRecipient(); }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-black uppercase tracking-wide transition ${recipientSourceTab === 'supplier_contract' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  HĐ nhà cung cấp
                </button>
                <button
                  type="button"
                  onClick={() => { setRecipientSourceTab('business_partner'); clearRecipient(); }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-black uppercase tracking-wide transition ${recipientSourceTab === 'business_partner' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Đối tác
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={recipientMenuOpen ? recipientSearchQuery : recipientName}
                  onFocus={() => {
                    setRecipientMenuOpen(true);
                    setRecipientSearchQuery('');
                  }}
                  onChange={event => {
                    setRecipientSearchQuery(event.target.value);
                    setRecipientMenuOpen(true);
                  }}
                  placeholder={recipientSourceTab === 'supplier_contract' ? 'Tìm mã HĐ, NCC...' : 'Tìm tên, MST, SĐT đối tác...'}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 pr-8 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {recipientName && (
                  <button
                    type="button"
                    onClick={clearRecipient}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X size={14} />
                  </button>
                )}
                {recipientMenuOpen && (
                  <div className="absolute left-0 right-0 z-[1000] mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    {filteredRecipientSourceOptions.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => selectRecipientSource(option)}
                        className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        <div className="font-black">{option.label}</div>
                        <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                          {option.selection.kind === 'supplier_contract'
                            ? option.selection.contract.name
                            : [option.selection.partner.taxCode ? `MST ${option.selection.partner.taxCode}` : '', option.selection.partner.phone].filter(Boolean).join(' • ') || 'Đối tác'}
                        </div>
                      </button>
                    ))}
                    {filteredRecipientSourceOptions.length === 0 && (
                      <div className="px-3 py-2 text-xs font-semibold text-slate-400">Không có nguồn phù hợp</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Người chịu trách nhiệm</span>
              <select value={responsibleUserId} onChange={event => setResponsibleUserId(event.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400">
                <option value="">Không chọn</option>
                {activeUsers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ngày phiếu xuất cấp</span>
              <input type="date" value={voucherDate} onChange={event => setVoucherDate(event.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú</span>
              <input value={note} onChange={event => setNote(event.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                placeholder="Mục đích cấp, hạng mục thi công, điều kiện bàn giao..." />
            </label>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/60 overflow-visible">
            <div className="p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
              <div className="relative space-y-1" id="stock-multi-select-wrapper">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vật tư cần cấp</span>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={stockMenuOpen ? stockSearchQuery : selectedStockSummary}
                    disabled={!sourceWarehouseId}
                    onFocus={() => setStockMenuOpen(true)}
                    onChange={event => {
                      setStockSearchQuery(event.target.value);
                      setStockMenuOpen(true);
                    }}
                    placeholder={sourceWarehouseId ? 'Gõ SKU, tên vật tư trong kho đã chọn...' : 'Chọn kho xuất trước'}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-8 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  {selectedItemIds.length > 0 && (
                    <button
                      type="button"
                      onClick={clearStockSelection}
                      className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {stockMenuOpen && sourceWarehouseId && (
                  <div className="absolute left-0 right-0 z-[1200] mt-1 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    {filteredWarehouseStockOptions.length > 0 && (
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border-b border-slate-100 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-50">
                        <input
                          type="checkbox"
                          checked={visibleStockOptionsSelected}
                          onChange={event => toggleVisibleStockOptions(event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
                        />
                        Chọn tất cả kết quả đang hiển thị ({filteredWarehouseStockOptions.length})
                      </label>
                    )}
                    {filteredWarehouseStockOptions.length === 0 ? (
                      <div className="px-3 py-2 text-xs font-semibold text-slate-400">
                        Kho này chưa có vật tư khả dụng phù hợp
                      </div>
                    ) : (
                      filteredWarehouseStockOptions.map(option => {
                        const checked = selectedItemIds.includes(option.item.id);
                        return (
                          <label
                            key={option.item.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-xs hover:bg-indigo-50 hover:text-indigo-700 ${checked ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 dark:text-slate-100'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={event => toggleStockItemSelection(option.item.id, event.target.checked)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-black text-slate-800 dark:text-slate-100">
                                {option.item.sku} - {option.item.name}
                              </div>
                              <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                                {option.item.category || 'Chưa phân nhóm'} • {option.item.unit}
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-[10px] font-black">
                              <div className="text-emerald-600">Khả dụng {formatQty(option.available)}</div>
                              <div className="font-bold text-slate-400">Tồn {formatQty(option.onHand)} • Giữ {formatQty(option.reserved)}</div>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
                <div className="text-[10px] font-bold text-slate-400">
                  {sourceWarehouseId
                    ? selectedStockOptions.length > 0
                      ? `Đã chọn ${selectedStockOptions.length} vật tư từ kho ${selectedWarehouse?.name || ''}`
                      : `${warehouseStockOptions.length} vật tư đang có tồn khả dụng trong kho ${selectedWarehouse?.name || ''}`
                    : 'Chọn kho xuất để tải danh sách vật tư tồn kho.'}
                </div>
              </div>
              <button onClick={addDraftLine} disabled={selectedStockOptions.length === 0}
                className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 flex items-center justify-center gap-1.5">
                <Plus size={13} /> Thêm{selectedStockOptions.length > 0 ? ` (${selectedStockOptions.length})` : ''}
              </button>
            </div>

            {selectedStockOptions.length > 0 && (
              <div className="mx-3 mb-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[780px] text-left">
                  <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="p-3">Vật tư đã chọn</th>
                      <th className="p-3 text-right">Khả dụng</th>
                      <th className="p-3 text-right">Số lượng cấp</th>
                      <th className="p-3">Ghi chú dòng</th>
                      <th className="p-3 text-center">Bỏ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedStockOptions.map(option => {
                      const draft = stockDraftByItemId[option.item.id] || createDefaultStockDraft();
                      const quantity = parseQty(draft.quantity);
                      const isOver = quantity > option.available;
                      return (
                        <tr key={option.item.id} className="text-xs">
                          <td className="p-3">
                            <div className="font-black text-slate-800">{option.item.sku} - {option.item.name}</div>
                            <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                              {option.item.category || 'Chưa phân nhóm'} • {option.item.unit}
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            <div className="text-xs font-black text-emerald-600">{formatQty(option.available)} {option.item.unit}</div>
                            <div className="text-[10px] font-bold text-slate-400">Tồn {formatQty(option.onHand)} • Giữ {formatQty(option.reserved)}</div>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input
                                value={draft.quantity}
                                onChange={event => updateStockDraft(option.item.id, {
                                  quantity: sanitizeQuantityInput(event.target.value, { previousValue: draft.quantity }),
                                })}
                                inputMode="decimal"
                                className={`h-9 w-28 rounded-lg border px-2 text-right text-xs font-black outline-none focus:border-indigo-400 ${isOver ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-700'}`}
                              />
                              <span className="text-[10px] font-black text-slate-400">{option.item.unit}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <input
                              value={draft.note}
                              onChange={event => updateStockDraft(option.item.id, { note: event.target.value })}
                              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                              placeholder="Tùy chọn"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleStockItemSelection(option.item.id, false)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {draftLines.length > 0 && (
              <div className="border-t border-slate-100 bg-white divide-y divide-slate-100">
                {draftLines.map(line => {
                  const item = items.find(row => row.id === line.itemId);
                  const stock = sourceWarehouseId ? getStockSummary(line.itemId, sourceWarehouseId) : null;
                  const qty = parseQty(line.quantity);
                  const isOver = !!stock && qty > stock.available;
                  return (
                    <div key={line.key} className="p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_120px_40px] gap-3 items-center">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-800 truncate">{item?.sku} - {item?.name}</div>
                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">{line.note || 'Không có ghi chú dòng'}</div>
                      </div>
                      <div className="text-[10px] font-bold text-slate-500">
                        {stock ? (
                          <span className={isOver ? 'text-amber-600' : 'text-emerald-600'}>
                            Khả dụng: {formatQty(stock.available)} {item?.unit}
                          </span>
                        ) : 'Chưa chọn kho'}
                      </div>
                      <div className="flex items-center gap-1">
                        <input value={line.quantity} onChange={event => setDraftLines(prev => prev.map(row => row.key === line.key ? {
                          ...row,
                          quantity: sanitizeQuantityInput(event.target.value, { previousValue: line.quantity }),
                        } : row))}
                          inputMode="decimal"
                          className={`w-full h-9 rounded-lg border px-2 text-right text-xs font-black outline-none ${isOver ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-700'}`} />
                        <span className="text-[10px] font-black text-slate-400">{item?.unit}</span>
                      </div>
                      <button onClick={() => setDraftLines(prev => prev.filter(row => row.key !== line.key))}
                        className="w-9 h-9 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 flex items-center justify-center">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={handleCreateIssue} disabled={submitting}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-60">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Tạo và gửi kho duyệt
            </button>
          </div>
        </div>
        )}

        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Danh sách phiếu xuất cấp</h4>
            <span className="text-[10px] font-black text-slate-400">{orders.length} phiếu</span>
          </div>

          {loading ? (
            <div className="py-10 text-center text-slate-400 text-xs font-bold">
              <Loader2 className="mx-auto mb-2 animate-spin" size={22} /> Đang tải phiếu xuất cấp...
            </div>
          ) : orders.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl text-slate-400 text-xs font-bold">
              Chưa có phiếu xuất cấp thi công.
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(order => {
                const status = STATUS_META[order.status];
                const warehouse = warehouses.find(item => item.id === order.sourceWarehouseId);
                const totalIssued = order.lines.reduce((sum, line) => sum + Number(line.issuedQty || 0), 0);
                const totalOpen = order.lines.reduce((sum, line) => sum + lineOpenQty(line), 0);
                const expanded = expandedOrderIds.has(order.id);
                return (
                  <div key={order.id} className="rounded-2xl border border-slate-100 bg-white hover:border-indigo-100 transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleOrderExpanded(order.id)}
                      className="flex w-full items-center justify-between gap-3 p-4 text-left"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="truncate text-sm font-black text-slate-800">{order.issueNo}</span>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${status.tone}`}>{status.label}</span>
                      </div>
                      <span className="shrink-0 text-slate-400">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </button>

                    {expanded && (
                      <div className="border-t border-slate-100 p-4">
                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold text-slate-400">{new Date(order.createdAt || '').toLocaleString('vi-VN')}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                              <span className="inline-flex items-center gap-1"><Users size={11} /> {getRecipientSourceLabel(order)}: <b className="text-slate-700">{order.recipientName}</b></span>
                              <span>Kho xuất: <b className="text-slate-700">{warehouse?.name || order.sourceWarehouseId}</b></span>
                              {order.voucherDate && <span>Ngày phiếu: <b className="text-slate-700">{new Date(order.voucherDate).toLocaleDateString('vi-VN')}</b></span>}
                              {order.neededDate && <span>Cần cấp: <b className="text-slate-700">{new Date(order.neededDate).toLocaleDateString('vi-VN')}</b></span>}
                              {order.transactionId && <span>WMS: <b className="text-slate-700">{order.transactionId.slice(-8)}</b></span>}
                            </div>
                            {order.note && <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{order.note}</div>}
                          </div>
                          <div className="shrink-0 grid grid-cols-3 gap-2 text-center min-w-[260px]">
                            <div className="rounded-xl bg-slate-50 px-3 py-2">
                              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Dòng</div>
                              <div className="text-sm font-black text-slate-800">{order.lines.length}</div>
                            </div>
                            <div className="rounded-xl bg-indigo-50 px-3 py-2">
                              <div className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Đã xuất</div>
                              <div className="text-sm font-black text-indigo-700">{formatQty(totalIssued)}</div>
                            </div>
                            <div className="rounded-xl bg-amber-50 px-3 py-2">
                              <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Còn giữ</div>
                              <div className="text-sm font-black text-amber-700">{formatQty(totalOpen)}</div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
                          <table className="w-full text-left min-w-[720px]">
                            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                              <tr>
                                <th className="p-3">Vật tư</th>
                                <th className="p-3 text-right">Yêu cầu</th>
                                <th className="p-3 text-right">Đã xuất</th>
                                <th className="p-3 text-right">Đã nhận</th>
                                <th className="p-3 text-right">Đã dùng</th>
                                <th className="p-3 text-right">Trả</th>
                                <th className="p-3 text-right">Hao hụt</th>
                                <th className="p-3 text-right">Còn giữ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {order.lines.map(line => (
                                <tr key={line.id} className="text-xs">
                                  <td className="p-3">
                                    <div className="font-black text-slate-800">{line.skuSnapshot} - {line.itemNameSnapshot}</div>
                                    {line.note && <div className="text-[10px] text-slate-400 mt-0.5">{line.note}</div>}
                                  </td>
                                  <td className="p-3 text-right font-bold">{formatQty(line.requestedQty)} {line.unit}</td>
                                  <td className="p-3 text-right font-bold text-indigo-700">{formatQty(line.issuedQty)} {line.unit}</td>
                                  <td className="p-3 text-right font-bold text-emerald-700">{formatQty(line.receivedQty)} {line.unit}</td>
                                  <td className="p-3 text-right font-bold text-slate-700">{formatQty(line.consumedQty)} {line.unit}</td>
                                  <td className="p-3 text-right font-bold text-blue-700">{formatQty(line.returnedQty)} {line.unit}</td>
                                  <td className="p-3 text-right font-bold text-rose-700">{formatQty(line.lostQty)} {line.unit}</td>
                                  <td className="p-3 text-right font-black text-amber-700">{formatQty(lineOpenQty(line))} {line.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div className="text-[10px] font-bold text-slate-400">
                            {order.returns?.length ? `${order.returns.length} phiếu hoàn trả` : 'Chưa có hoàn trả'} • {order.receipts?.length ? `${order.receipts.length} lần xác nhận nhận` : 'Chưa xác nhận nhận'}
                          </div>
                          {renderOrderActions(order)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {action && (
        <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-800">{actionTitle}</h3>
                <p className="text-xs text-slate-400 mt-1">{action.order.issueNo} • {action.order.recipientName}</p>
              </div>
              <button onClick={() => setAction(null)} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {action.type === 'cancel' ? (
                <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-xs font-bold text-red-700">
                  Chỉ hủy được phiếu chưa phát sinh xuất kho hoàn tất. Nếu đã xuất kho, cần hoàn trả/quyết toán thay vì hủy trực tiếp.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-100 overflow-hidden">
                  <table className="w-full text-left min-w-[620px]">
                    <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <tr>
                        <th className="p-3">Vật tư</th>
                        <th className="p-3 text-right">Tối đa</th>
                        <th className="p-3 text-right">Số lượng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {action.order.lines.map(line => {
                        const maxQty = action.type === 'receipt' ? lineReceiptRemaining(line) : lineOpenQty(line);
                        return (
                          <tr key={line.id}>
                            <td className="p-3">
                              <div className="text-xs font-black text-slate-800">{line.itemNameSnapshot}</div>
                              <div className="text-[10px] text-slate-400">{line.skuSnapshot}</div>
                            </td>
                            <td className="p-3 text-right text-xs font-black text-slate-500">{formatQty(maxQty)} {line.unit}</td>
                            <td className="p-3 text-right">
                              <input
                                value={actionQtyByLine[line.id] || '0'}
                                onChange={event => setActionQtyByLine(prev => ({
                                  ...prev,
                                  [line.id]: sanitizeQuantityInput(event.target.value, {
                                    previousValue: prev[line.id] || '0',
                                  }),
                                }))}
                                inputMode="decimal"
                                disabled={maxQty <= 0}
                                className="w-28 h-9 rounded-lg border border-slate-200 text-right px-2 text-xs font-black outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-300"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {action.type === 'return' && (
                <label className="space-y-1 block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kho nhận hoàn trả</span>
                  <select value={returnWarehouseId} onChange={event => setReturnWarehouseId(event.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400">
                    <option value="">Chọn kho nhận</option>
                    {warehouses.filter(item => !item.isArchived).map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                  </select>
                </label>
              )}

              {(action.type === 'return' || action.type === 'consume' || action.type === 'loss' || action.type === 'cancel') && (
                <label className="space-y-1 block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lý do</span>
                  <textarea value={actionReason} onChange={event => setActionReason(event.target.value)}
                    className="w-full min-h-[88px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                    placeholder="Nhập lý do để lưu audit..." />
                </label>
              )}

              {(action.type === 'receipt' || action.type === 'return') && (
                <label className="space-y-1 block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú</span>
                  <input value={actionNote} onChange={event => setActionNote(event.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                    placeholder="Tùy chọn" />
                </label>
              )}
            </div>

            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setAction(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-500 hover:bg-slate-50">
                Đóng
              </button>
              <button onClick={handleActionSubmit} disabled={actionLoading}
                className="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-2">
                {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialIssuePanel;
