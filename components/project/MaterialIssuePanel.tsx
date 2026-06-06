import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  PackagePlus,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
  Undo2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import InventoryItemCombobox from '../InventoryItemCombobox';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useReservedStock } from '../../hooks/useReservedStock';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { subcontractorContractService } from '../../lib/hdService';
import {
  MaterialIssueOrder,
  MaterialIssueRecipientType,
  MaterialIssueStatus,
  Role,
  BusinessPartner,
  SubcontractorContract,
  WorkGroup,
} from '../../types';
import { materialIssueService } from '../../lib/materialIssueService';
import { partnerService } from '../../lib/partnerService';
import { workGroupService } from '../../lib/workGroupService';
import { isGlobalWarehouseKeeper } from '../../lib/wmsPermissions';

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
  const parsed = Number(String(value ?? '').replace(',', '.'));
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
  } = useApp();
  const toast = useToast();
  const { getStockSummary } = useReservedStock();

  const [orders, setOrders] = useState<MaterialIssueOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [subcontracts, setSubcontracts] = useState<SubcontractorContract[]>([]);

  const [sourceWarehouseId, setSourceWarehouseId] = useState(defaultSourceWarehouseId || user.assignedWarehouseId || '');
  const [recipientType, setRecipientType] = useState<MaterialIssueRecipientType>('work_group');
  const [recipientId, setRecipientId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState(user.id);
  const [subcontractorContractId, setSubcontractorContractId] = useState('');
  const [neededDate, setNeededDate] = useState('');
  const [note, setNote] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedQty, setSelectedQty] = useState('1');
  const [selectedNote, setSelectedNote] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
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

  const activeUsers = useMemo(() => users.filter(item => item.isActive !== false), [users]);

  const recipientOptions = useMemo(() => {
    if (recipientType === 'employee') {
      return activeUsers.map(item => ({ id: item.id, name: item.name || item.email, contractId: '' }));
    }
    if (recipientType === 'work_group') {
      return workGroups.map(item => ({ id: item.id, name: item.name, contractId: '' }));
    }
    if (recipientType === 'subcontractor') {
      const contractOptions = subcontracts.map(item => ({
        id: item.id,
        name: `${item.subcontractorName} • ${item.name}`,
        contractId: item.id,
      }));
      const partnerOptions = partners
        .filter(item => item.classifications?.includes('contractor'))
        .map(item => ({ id: item.id, name: item.name, contractId: '' }));
      return [...contractOptions, ...partnerOptions];
    }
    if (recipientType === 'partner') {
      return partners.map(item => ({ id: item.id, name: item.name, contractId: '' }));
    }
    return [];
  }, [activeUsers, partners, recipientType, subcontracts, workGroups]);

  const selectedWarehouse = warehouses.find(warehouse => warehouse.id === sourceWarehouseId);

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
    void loadModuleData('wms');
    void loadOrders();
  }, [loadModuleData, loadOrders]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [groupRows, partnerRows, contractRows] = await Promise.all([
          workGroupService.listGroups({ activeOnly: true }).catch(() => []),
          partnerService.list({ includeInactive: false }).catch(() => []),
          projectId
            ? subcontractorContractService.listBySite(projectId, constructionSiteId || null).catch(() => [])
            : subcontractorContractService.list().catch(() => []),
        ]);
        if (cancelled) return;
        setWorkGroups(groupRows);
        setPartners(partnerRows);
        setSubcontracts(contractRows);
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
    if (sourceWarehouseId) return;
    setSourceWarehouseId(defaultSourceWarehouseId || user.assignedWarehouseId || selectableWarehouses[0]?.id || '');
  }, [defaultSourceWarehouseId, selectableWarehouses, sourceWarehouseId, user.assignedWarehouseId]);

  useEffect(() => {
    if (recipientType === 'manual') {
      setRecipientId('');
      setSubcontractorContractId('');
      return;
    }
    const option = recipientOptions.find(item => item.id === recipientId);
    if (option) {
      setRecipientName(option.name);
      setSubcontractorContractId(option.contractId);
    } else {
      setRecipientName('');
      setSubcontractorContractId('');
    }
  }, [recipientId, recipientOptions, recipientType]);

  const resetCreateForm = () => {
    setRecipientId('');
    setRecipientName('');
    setSubcontractorContractId('');
    setNeededDate('');
    setNote('');
    setSelectedItemId(null);
    setSelectedQty('1');
    setSelectedNote('');
    setDraftLines([]);
  };

  const addDraftLine = () => {
    const qty = parseQty(selectedQty);
    if (!selectedItemId || qty <= 0) {
      toast.warning('Chưa chọn vật tư', 'Chọn vật tư và nhập số lượng lớn hơn 0.');
      return;
    }
    const existing = draftLines.find(line => line.itemId === selectedItemId);
    if (existing) {
      setDraftLines(prev => prev.map(line => line.itemId === selectedItemId
        ? { ...line, quantity: String(parseQty(line.quantity) + qty), note: selectedNote || line.note }
        : line));
    } else {
      setDraftLines(prev => [...prev, {
        key: crypto.randomUUID(),
        itemId: selectedItemId,
        quantity: String(qty),
        note: selectedNote,
      }]);
    }
    setSelectedItemId(null);
    setSelectedQty('1');
    setSelectedNote('');
  };

  const handleCreateIssue = async () => {
    if (submitting) return;
    if (!sourceWarehouseId) {
      toast.warning('Chưa chọn kho xuất');
      return;
    }
    if (!recipientName.trim()) {
      toast.warning('Chưa chọn bên nhận', 'Chọn người/tổ đội/thầu phụ hoặc nhập tay tên bên nhận.');
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
      const created = await materialIssueService.createAndSubmit({
        projectId: projectId || null,
        constructionSiteId: constructionSiteId || null,
        sourceWarehouseId,
        recipientType,
        recipientId: recipientType === 'manual' ? null : recipientId || null,
        recipientName: recipientName.trim(),
        responsibleUserId: responsibleUserId || null,
        subcontractorContractId: subcontractorContractId || null,
        materialRequestId: materialRequestId || null,
        neededDate: neededDate || null,
        note: note.trim() || null,
        lines: draftLines.map(line => {
          const item = items.find(row => row.id === line.itemId);
          return {
            itemId: line.itemId,
            quantity: parseQty(line.quantity),
            unit: item?.unit || null,
            unitPrice: item?.priceIn || 0,
            subcontractorContractId: subcontractorContractId || null,
            note: line.note.trim() || null,
          };
        }),
      });
      toast.success('Đã tạo phiếu xuất cấp', `${created.issueNo} đang chờ kho xuất duyệt.`);
      resetCreateForm();
      await Promise.all([loadOrders(), loadModuleData('wms', true)]);
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
      if (type === 'receipt') defaults[line.id] = String(lineReceiptRemaining(line));
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
        await materialIssueService.createReturn({
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
      await Promise.all([loadOrders(), loadModuleData('wms', true)]);
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

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
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

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loại bên nhận</span>
              <select value={recipientType} onChange={event => {
                setRecipientType(event.target.value as MaterialIssueRecipientType);
                setRecipientId('');
                setRecipientName('');
              }}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400">
                {(Object.keys(RECIPIENT_LABELS) as MaterialIssueRecipientType[]).map(type => (
                  <option key={type} value={type}>{RECIPIENT_LABELS[type]}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 md:col-span-2 xl:col-span-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{getRecipientOptionLabel(recipientType)}</span>
              {recipientType === 'manual' ? (
                <input value={recipientName} onChange={event => setRecipientName(event.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                  placeholder="Tên tổ đội/thầu phụ/đơn vị nhận" />
              ) : (
                <select value={recipientId} onChange={event => setRecipientId(event.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400">
                  <option value="">Chọn bên nhận</option>
                  {recipientOptions.map(option => <option key={`${option.id}-${option.contractId}`} value={option.id}>{option.name}</option>)}
                </select>
              )}
            </label>

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
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ngày cần cấp</span>
              <input type="date" value={neededDate} onChange={event => setNeededDate(event.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú</span>
              <input value={note} onChange={event => setNote(event.target.value)}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                placeholder="Mục đích cấp, hạng mục thi công, điều kiện bàn giao..." />
            </label>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/60 overflow-hidden">
            <div className="p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,220px)_auto] gap-2 items-end">
              <InventoryItemCombobox
                value={selectedItemId}
                items={items}
                onChange={item => setSelectedItemId(item?.id || null)}
                placeholder="Chọn vật tư cần cấp"
                inputClassName="h-10"
              />
              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Số lượng</span>
                <input value={selectedQty} onChange={event => setSelectedQty(event.target.value)}
                  inputMode="decimal"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-indigo-400" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú dòng</span>
                <input value={selectedNote} onChange={event => setSelectedNote(event.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                  placeholder="Tùy chọn" />
              </label>
              <button onClick={addDraftLine}
                className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 flex items-center justify-center gap-1.5">
                <Plus size={13} /> Thêm
              </button>
            </div>

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
                        <input value={line.quantity} onChange={event => setDraftLines(prev => prev.map(row => row.key === line.key ? { ...row, quantity: event.target.value } : row))}
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
                return (
                  <div key={order.id} className="rounded-2xl border border-slate-100 bg-white p-4 hover:border-indigo-100 transition-colors">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-800">{order.issueNo}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${status.tone}`}>{status.label}</span>
                          <span className="text-[10px] font-bold text-slate-400">{new Date(order.createdAt || '').toLocaleString('vi-VN')}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                          <span className="inline-flex items-center gap-1"><Users size={11} /> {RECIPIENT_LABELS[order.recipientType]}: <b className="text-slate-700">{order.recipientName}</b></span>
                          <span>Kho xuất: <b className="text-slate-700">{warehouse?.name || order.sourceWarehouseId}</b></span>
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
                                onChange={event => setActionQtyByLine(prev => ({ ...prev, [line.id]: event.target.value }))}
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
