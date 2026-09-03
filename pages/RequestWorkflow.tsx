import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { MaterialRequest, MaterialRequestFulfillmentSummary, RequestStatus } from '../types';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calendar,
  Check,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Filter,
  Inbox,
  Layers,
  LayoutGrid,
  LayoutList,
  PackageSearch,
  Plus,
  RotateCcw,
  Send as SendIcon,
  ShieldAlert,
  Trash2,
  Truck,
  User,
  XCircle,
  Search,
} from 'lucide-react';
import { useModuleData } from '../hooks/useModuleData';
import { usePagination } from '../hooks/usePagination';
import { canApproveMaterialRequest, canExportMaterialRequest, canReceiveMaterialRequest, canViewMaterialRequest } from '../lib/wmsPermissions';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { matchesSearchQueryMultiple } from '../lib/searchUtils';
import { getMaterialRequestNextAction } from '../lib/erpWorkflow';
import { EmptyState, NextActionCard, PageHeader, StatusBadge } from '../components/erp';
import Pagination from '../components/Pagination';
import { isPerf02RequestPagingEnabled } from '../lib/featureFlags';
import { materialRequestService } from '../lib/materialRequestService';

const RequestModal = React.lazy(() => import('../components/RequestModal'));

const STATUS_FILTERS = [
  { id: 'ALL', label: 'Tất cả' },
  { id: RequestStatus.PENDING, label: 'Chờ duyệt' },
  { id: RequestStatus.APPROVED, label: 'Chờ xuất' },
  { id: RequestStatus.IN_TRANSIT, label: 'Đang giao' },
  { id: RequestStatus.COMPLETED, label: 'Đã nhận' },
  { id: RequestStatus.DRAFT, label: 'Nháp' },
  { id: RequestStatus.REJECTED, label: 'Từ chối' },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const formatDateOnly = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const RequestWorkflow: React.FC = () => {
  const { requests: contextRequests, warehouses, user, users, items, lastRealtimeEvent } = useApp();
  useModuleData('wms');

  const [reqSubTab, setReqSubTab] = useState<'actions' | 'all'>('actions');
  const [actionQueueFilter, setActionQueueFilter] = useState<'all' | 'approve' | 'export' | 'receive'>('all');
  const [actionSearch, setActionSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterWarehouse, setFilterWarehouse] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);
  const [fulfillmentSummaries, setFulfillmentSummaries] = useState<Record<string, MaterialRequestFulfillmentSummary>>({});
  const [pagedRequests, setPagedRequests] = useState<MaterialRequest[]>([]);
  const [requestCursor, setRequestCursor] = useState<string | null>(null);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [requestLoadError, setRequestLoadError] = useState<string | null>(null);
  const requests = useMemo(() => {
    if (!isPerf02RequestPagingEnabled) return contextRequests;
    const byId = new Map(pagedRequests.map(request => [request.id, request]));
    contextRequests.forEach(request => byId.set(request.id, request));
    return [...byId.values()].sort((left, right) => {
      const byDate = new Date(right.createdDate).getTime() - new Date(left.createdDate).getTime();
      return byDate || right.id.localeCompare(left.id);
    });
  }, [contextRequests, pagedRequests]);

  useEffect(() => {
    if (!isPerf02RequestPagingEnabled) return;
    let cancelled = false;
    setIsLoadingRequests(true);
    setRequestLoadError(null);
    materialRequestService.listWmsPage({ limit: 50 })
      .then(page => {
        if (cancelled) return;
        setPagedRequests(page.rows);
        setRequestCursor(page.nextCursor);
      })
      .catch(error => {
        if (!cancelled) setRequestLoadError(error instanceof Error ? error.message : 'Không thể tải danh sách đề xuất vật tư.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRequests(false);
      });
    return () => { cancelled = true; };
  }, [lastRealtimeEvent]);

  const loadMoreRequests = async () => {
    if (!isPerf02RequestPagingEnabled || !requestCursor || isLoadingRequests) return;
    setIsLoadingRequests(true);
    setRequestLoadError(null);
    try {
      const page = await materialRequestService.listWmsPage({ limit: 50, cursor: requestCursor });
      setPagedRequests(current => {
        const byId = new Map(current.map(request => [request.id, request]));
        page.rows.forEach(request => byId.set(request.id, request));
        return [...byId.values()];
      });
      setRequestCursor(page.nextCursor);
    } catch (error) {
      setRequestLoadError(error instanceof Error ? error.message : 'Không thể tải thêm đề xuất vật tư.');
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const candidates = requests.filter(req =>
      (req.requestOrigin === 'project' || !!req.projectId) &&
      ![RequestStatus.DRAFT, RequestStatus.PENDING, RequestStatus.REJECTED].includes(req.status as RequestStatus)
    );
    if (candidates.length === 0) {
      setFulfillmentSummaries({});
      return;
    }

    Promise.all(candidates.map(async req => {
      const batches = await materialRequestFulfillmentService.listByRequest(req.id);
      return [req.id, materialRequestFulfillmentService.summarizeRequest(req, batches)] as const;
    }))
      .then(entries => {
        if (!cancelled) setFulfillmentSummaries(Object.fromEntries(entries));
      })
      .catch(error => {
        console.warn('Failed to load material request fulfillment summaries:', error);
        if (!cancelled) setFulfillmentSummaries({});
      });

    return () => { cancelled = true; };
  }, [requests]);

  const getEffectiveStatus = (req: MaterialRequest): RequestStatus => {
    if ([RequestStatus.DRAFT, RequestStatus.PENDING, RequestStatus.REJECTED].includes(req.status as RequestStatus)) return req.status;
    const summary = fulfillmentSummaries[req.id];
    if (!summary) return req.status;
    if (summary.committedQty > 0 && summary.receivedQty >= summary.committedQty) return RequestStatus.COMPLETED;
    if (summary.issuedQty > 0 || summary.receivedQty > 0) return RequestStatus.IN_TRANSIT;
    return req.status;
  };

  const withEffectiveStatus = (req: MaterialRequest): MaterialRequest => {
    const status = getEffectiveStatus(req);
    return status === req.status ? req : { ...req, status };
  };

  const visibleRequests = useMemo(() => (
    requests
      .filter(req => canViewMaterialRequest(user, req))
      .map(withEffectiveStatus)
  ), [requests, user, fulfillmentSummaries]);

  const actionRequests = useMemo(() => (
    visibleRequests
      .map(req => ({ request: req, action: getMaterialRequestNextAction(req, user) }))
      .filter(item => item.action.isActionable)
      .sort((a, b) => new Date(a.request.expectedDate || a.request.createdDate).getTime() - new Date(b.request.expectedDate || b.request.createdDate).getTime())
  ), [visibleRequests, user]);

  const filteredActionRequests = useMemo(() => {
    return actionRequests.filter(({ request, action }) => {
      if (actionQueueFilter === 'approve' && request.status !== RequestStatus.PENDING) return false;
      if (actionQueueFilter === 'export' && request.status !== RequestStatus.APPROVED) return false;
      if (actionQueueFilter === 'receive' && request.status !== RequestStatus.IN_TRANSIT) return false;

      if (!actionSearch.trim()) return true;
      const q = actionSearch.trim().toLowerCase();
      const siteName = warehouses.find(w => w.id === request.siteWarehouseId)?.name || '';
      const sourceName = warehouses.find(w => w.id === request.sourceWarehouseId)?.name || '';
      const requesterName = users.find(u => u.id === request.requesterId)?.name || '';
      const itemNames = request.items.map(ti => {
        const item = items.find(i => i.id === ti.itemId);
        return [item?.name, item?.sku].filter(Boolean).join(' ');
      }).join(' ');

      const searchable = [
        request.code,
        request.note || '',
        siteName,
        sourceName,
        requesterName,
        action.label,
        action.nextAction,
        itemNames,
      ].join(' ').toLowerCase();

      return searchable.includes(q);
    });
  }, [actionRequests, actionQueueFilter, actionSearch, warehouses, users, items]);

  const filteredRequests = useMemo(() => {
    const fromTime = filterDateFrom ? new Date(`${filterDateFrom}T00:00:00`).getTime() : null;
    const toTime = filterDateTo ? new Date(`${filterDateTo}T23:59:59.999`).getTime() : null;

    return visibleRequests.filter(req => {
      const matchStatus = filterStatus === 'ALL' || req.status === filterStatus;
      if (!matchStatus) return false;

      if (
        filterWarehouse !== 'all' &&
        req.siteWarehouseId !== filterWarehouse &&
        req.sourceWarehouseId !== filterWarehouse
      ) {
        return false;
      }

      const reqDate = new Date(req.createdDate).getTime();
      if (fromTime !== null && reqDate < fromTime) return false;
      if (toTime !== null && reqDate > toTime) return false;

      if (!searchTerm.trim()) return true;

      const siteName = warehouses.find(w => w.id === req.siteWarehouseId)?.name || '';
      const sourceName = warehouses.find(w => w.id === req.sourceWarehouseId)?.name || '';
      const requesterName = users.find(u => u.id === req.requesterId)?.name || '';
      const itemText = req.items.map(line => {
        const product = items.find(item => item.id === line.itemId);
        return [product?.sku, product?.name, line.requestQty || line.approvedQty, product?.unit].filter(Boolean).join(' ');
      }).join(' ');

      return matchesSearchQueryMultiple([
        req.code,
        req.note || '',
        siteName,
        sourceName,
        requesterName,
        itemText,
      ], searchTerm);
    });
  }, [visibleRequests, filterStatus, filterWarehouse, filterDateFrom, filterDateTo, searchTerm, warehouses, users, items]);

  const {
    paginatedItems: paginatedRequests,
    currentPage: reqPage,
    totalPages: reqTotalPages,
    totalItems: reqTotal,
    pageSize: reqPageSize,
    setPage: reqSetPage,
    setPageSize: reqSetPageSize,
    startIndex: reqStart,
    endIndex: reqEnd,
  } = usePagination<MaterialRequest>(filteredRequests, 15);

  const statusCounts = useMemo(() => {
    return visibleRequests.reduce<Record<string, number>>((acc, req) => {
      acc[req.status] = (acc[req.status] || 0) + 1;
      return acc;
    }, {});
  }, [visibleRequests]);

  const handleOpenCreate = () => {
    setSelectedRequest(undefined);
    setModalOpen(true);
  };

  const handleOpenRequest = (req: MaterialRequest) => {
    setSelectedRequest(withEffectiveStatus(req));
    setModalOpen(true);
  };

  const clearFilters = () => {
    setFilterStatus('ALL');
    setFilterWarehouse('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchTerm('');
  };

  const isAnyFilterActive = filterStatus !== 'ALL' || filterWarehouse !== 'all' || filterDateFrom || filterDateTo || searchTerm;

  return (
    <div className="space-y-6">
      {isModalOpen && (
        <React.Suspense fallback={null}>
          <RequestModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} request={selectedRequest} />
        </React.Suspense>
      )}

      <PageHeader
        eyebrow="WMS"
        title="Điều phối & Đề xuất vật tư"
        description="Theo dõi, phê duyệt, xuất cấp điều phối và xác nhận nhận hàng vật tư giữa các kho và công trường."
        meta={
          <>
            <StatusBadge status="pending" label={`${statusCounts[RequestStatus.PENDING] || 0} chờ duyệt`} tone={statusCounts[RequestStatus.PENDING] ? 'warning' : 'neutral'} size="md" />
            <StatusBadge status="approved" label={`${statusCounts[RequestStatus.APPROVED] || 0} chờ xuất`} tone={statusCounts[RequestStatus.APPROVED] ? 'info' : 'neutral'} size="md" />
            <StatusBadge status="in_transit" label={`${statusCounts[RequestStatus.IN_TRANSIT] || 0} đang giao`} tone={statusCounts[RequestStatus.IN_TRANSIT] ? 'attention' : 'neutral'} size="md" />
            <StatusBadge status="completed" label={`${statusCounts[RequestStatus.COMPLETED] || 0} đã nhận`} tone="neutral" size="md" />
          </>
        }
        primaryAction={{
          label: 'Tạo đề xuất mới',
          icon: <Plus size={16} />,
          onClick: handleOpenCreate,
        }}
      />

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm overflow-hidden space-y-6">
        {/* SUB-NAVIGATION CHO ĐIỀU PHỐI VẬT TƯ */}
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-2xl bg-slate-100/90 p-1.5 border border-slate-200/60 shadow-inner">
            <button
              type="button"
              onClick={() => setReqSubTab('actions')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all ${
                reqSubTab === 'actions'
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldAlert size={15} className={reqSubTab === 'actions' ? 'text-amber-500' : 'text-slate-400'} />
              <span>Cần tôi xử lý</span>
              {actionRequests.length > 0 && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
                  {actionRequests.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setReqSubTab('all')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all ${
                reqSubTab === 'all'
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileText size={15} className={reqSubTab === 'all' ? 'text-indigo-600' : 'text-slate-400'} />
              <span>Tất cả đề xuất</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700">
                {visibleRequests.length}
              </span>
            </button>
          </div>

          <div className="text-xs font-semibold text-slate-400">
            {reqSubTab === 'actions'
              ? 'Các phiếu yêu cầu đang chờ bạn thẩm định, xuất kho hoặc xác nhận nhận hàng'
              : 'Tra cứu, theo dõi tiến độ và quản lý toàn bộ các phiếu yêu cầu vật tư'}
          </div>
        </div>

        {/* PHÂN KHU 1: HÀNG ĐỢI CẦN XỬ LÝ */}
        {reqSubTab === 'actions' && (
          <div className="space-y-6">
            {/* KPI SUMMARY HÀNG ĐỢI */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div
                onClick={() => setActionQueueFilter('all')}
                className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                  actionQueueFilter === 'all'
                    ? 'border-indigo-400 bg-indigo-50/50 shadow-sm ring-2 ring-indigo-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Tất cả cần làm</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                    <CheckCircle size={15} />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-black text-slate-900">{actionRequests.length}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Hàng đợi của bạn</p>
              </div>

              <div
                onClick={() => setActionQueueFilter('approve')}
                className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                  actionQueueFilter === 'approve'
                    ? 'border-amber-400 bg-amber-50/50 shadow-sm ring-2 ring-amber-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Chờ thẩm định</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <AlertCircle size={15} />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-black text-slate-900">
                  {actionRequests.filter(r => r.request.status === RequestStatus.PENDING).length}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Cần phê duyệt</p>
              </div>

              <div
                onClick={() => setActionQueueFilter('export')}
                className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                  actionQueueFilter === 'export'
                    ? 'border-blue-400 bg-blue-50/50 shadow-sm ring-2 ring-blue-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Chờ xuất kho</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                    <Truck size={15} />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-black text-slate-900">
                  {actionRequests.filter(r => r.request.status === RequestStatus.APPROVED).length}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Kho xuất chuẩn bị</p>
              </div>

              <div
                onClick={() => setActionQueueFilter('receive')}
                className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                  actionQueueFilter === 'receive'
                    ? 'border-emerald-400 bg-emerald-50/50 shadow-sm ring-2 ring-emerald-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Chờ nhận hàng</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                    <Inbox size={15} />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-black text-slate-900">
                  {actionRequests.filter(r => r.request.status === RequestStatus.IN_TRANSIT).length}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Kho nhận kiểm tra</p>
              </div>
            </div>

            {/* THANH LỌC VÀ TÌM KIẾM HÀNG ĐỢI */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActionQueueFilter('all')}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                    actionQueueFilter === 'all'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Tất cả ({actionRequests.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActionQueueFilter('approve')}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                    actionQueueFilter === 'approve'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Thẩm định ({actionRequests.filter(r => r.request.status === RequestStatus.PENDING).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActionQueueFilter('export')}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                    actionQueueFilter === 'export'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Xuất kho ({actionRequests.filter(r => r.request.status === RequestStatus.APPROVED).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActionQueueFilter('receive')}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                    actionQueueFilter === 'receive'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Nhận hàng ({actionRequests.filter(r => r.request.status === RequestStatus.IN_TRANSIT).length})
                </button>
              </div>

              <div className="relative w-full sm:w-72">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={actionSearch}
                  onChange={event => setActionSearch(event.target.value)}
                  placeholder="Tìm trong hàng đợi xử lý..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-7 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                />
                {actionSearch && (
                  <button
                    type="button"
                    onClick={() => setActionSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* DANH SÁCH THẺ HÀNG ĐỢI XỬ LÝ */}
            {filteredActionRequests.length === 0 ? (
              <EmptyState
                icon={<CheckCircle size={18} />}
                title="Không có phiếu cần bạn xử lý"
                message={actionSearch ? 'Không tìm thấy phiếu phù hợp với từ khóa.' : 'Các phiếu mới hoặc phiếu đang chờ bạn thao tác sẽ xuất hiện tại đây.'}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 xl:grid-cols-3">
                {filteredActionRequests.map(({ request, action }) => {
                  const siteName = warehouses.find(w => w.id === request.siteWarehouseId)?.name || 'Kho nhận';
                  const sourceName = warehouses.find(w => w.id === request.sourceWarehouseId)?.name || 'Chưa gán';
                  const requesterName = users.find(u => u.id === request.requesterId)?.name || 'N/A';

                  return (
                    <div
                      key={request.id}
                      onClick={() => handleOpenRequest(request)}
                      className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md relative overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                          {request.code}
                        </span>
                        <StatusBadge status={request.status} label={action.label} tone={action.tone} size="sm" />
                      </div>

                      <div className="mb-3">
                        <div className="text-xs text-slate-500 flex items-center gap-1 font-bold">
                          <User size={12} className="text-slate-400" />
                          <span>Người tạo: <strong className="text-slate-800">{requesterName}</strong></span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs font-black text-slate-800">
                          <span className="text-slate-500 font-semibold">{sourceName}</span>
                          <ArrowRight size={12} className="text-indigo-500 shrink-0" />
                          <span className="text-indigo-700">{siteName}</span>
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-xl p-2.5 text-xs text-slate-600 space-y-1 mb-3">
                        <div className="font-black text-slate-700 flex justify-between">
                          <span>{request.items.length} loại vật tư</span>
                          {request.expectedDate && (
                            <span className="text-[10px] text-amber-600 font-bold flex items-center gap-0.5">
                              <Calendar size={10} /> Cần: {formatDateOnly(request.expectedDate)}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate space-y-0.5">
                          {request.items.slice(0, 2).map((item, idx) => {
                            const product = items.find(i => i.id === item.itemId);
                            return (
                              <div key={idx} className="truncate">
                                • {product?.name || 'Vật tư'} ({item.requestQty || item.approvedQty} {product?.unit})
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <p className="text-[11px] font-semibold text-slate-500 truncate max-w-[180px]">
                          <Clock size={11} className="inline mr-1 text-slate-400" />
                          {action.nextAction}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleOpenRequest(request); }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black text-white shadow-xs transition active:scale-95 ${
                            request.status === RequestStatus.APPROVED
                              ? 'bg-blue-600 hover:bg-blue-700'
                              : request.status === RequestStatus.IN_TRANSIT
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : request.status === RequestStatus.PENDING
                                  ? 'bg-amber-600 hover:bg-amber-700'
                                  : 'bg-slate-900 hover:bg-slate-800'
                          }`}
                        >
                          {request.status === RequestStatus.APPROVED && <Truck size={13} />}
                          {request.status === RequestStatus.IN_TRANSIT && <CheckCircle size={13} />}
                          {request.status === RequestStatus.PENDING && <AlertCircle size={13} />}
                          {action.actionLabel}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PHÂN KHU 2: TẤT CẢ ĐỀ XUẤT & LỊCH SỬ */}
        {reqSubTab === 'all' && (
          <div className="space-y-5">
            {/* KPI SUMMARY CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div
                onClick={() => { setFilterStatus('ALL'); }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                  filterStatus === 'ALL'
                    ? 'border-indigo-400 bg-indigo-50/50 shadow-sm ring-2 ring-indigo-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <p className="text-[11px] font-bold text-slate-500">Tất cả đề xuất</p>
                <p className="mt-1 text-2xl font-black text-slate-800">{visibleRequests.length}</p>
              </div>
              <div
                onClick={() => { setFilterStatus(RequestStatus.PENDING); }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                  filterStatus === RequestStatus.PENDING
                    ? 'border-amber-400 bg-amber-50/50 shadow-sm ring-2 ring-amber-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <p className="text-[11px] font-bold text-amber-600 flex items-center gap-1"><AlertCircle size={13} /> Chờ duyệt</p>
                <p className="mt-1 text-2xl font-black text-amber-700">{statusCounts[RequestStatus.PENDING] || 0}</p>
              </div>
              <div
                onClick={() => { setFilterStatus(RequestStatus.APPROVED); }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                  filterStatus === RequestStatus.APPROVED
                    ? 'border-blue-400 bg-blue-50/50 shadow-sm ring-2 ring-blue-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <p className="text-[11px] font-bold text-blue-600 flex items-center gap-1"><Truck size={13} /> Chờ xuất</p>
                <p className="mt-1 text-2xl font-black text-blue-700">{statusCounts[RequestStatus.APPROVED] || 0}</p>
              </div>
              <div
                onClick={() => { setFilterStatus(RequestStatus.IN_TRANSIT); }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                  filterStatus === RequestStatus.IN_TRANSIT
                    ? 'border-violet-400 bg-violet-50/50 shadow-sm ring-2 ring-violet-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <p className="text-[11px] font-bold text-violet-600 flex items-center gap-1"><SendIcon size={13} /> Đang giao</p>
                <p className="mt-1 text-2xl font-black text-violet-700">{statusCounts[RequestStatus.IN_TRANSIT] || 0}</p>
              </div>
              <div
                onClick={() => { setFilterStatus(RequestStatus.COMPLETED); }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                  filterStatus === RequestStatus.COMPLETED
                    ? 'border-emerald-400 bg-emerald-50/50 shadow-sm ring-2 ring-emerald-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <p className="text-[11px] font-bold text-emerald-600 flex items-center gap-1"><CheckCircle size={13} /> Đã nhận</p>
                <p className="mt-1 text-2xl font-black text-emerald-700">{statusCounts[RequestStatus.COMPLETED] || 0}</p>
              </div>
              <div
                onClick={() => { setFilterStatus(RequestStatus.REJECTED); }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-all ${
                  filterStatus === RequestStatus.REJECTED
                    ? 'border-rose-400 bg-rose-50/50 shadow-sm ring-2 ring-rose-400/20'
                    : 'border-slate-200/70 bg-slate-50/60 hover:bg-slate-100/60'
                }`}
              >
                <p className="text-[11px] font-bold text-rose-600 flex items-center gap-1"><XCircle size={13} /> Từ chối</p>
                <p className="mt-1 text-2xl font-black text-rose-700">{statusCounts[RequestStatus.REJECTED] || 0}</p>
              </div>
            </div>

            {/* SMART FILTER TOOLBAR */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3.5 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 items-center">
                {/* Search input */}
                <div className="relative xl:col-span-5">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={event => setSearchTerm(event.target.value)}
                    placeholder="Tìm mã đề xuất, người lập, kho, vật tư, SKU..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-8 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-sm"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Warehouse dropdown filter */}
                <div className="xl:col-span-3">
                  <select
                    value={filterWarehouse}
                    onChange={event => setFilterWarehouse(event.target.value)}
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
                    value={filterDateFrom}
                    onChange={event => setFilterDateFrom(event.target.value)}
                    title="Từ ngày"
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                  />
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={event => setFilterDateTo(event.target.value)}
                    title="Đến ngày"
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 shadow-xs"
                  />
                </div>

                {/* View mode toggle */}
                <div className="flex items-center justify-end gap-1.5 xl:col-span-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    title="Xem dạng bảng tinh gọn"
                    className={`rounded-xl p-2.5 transition ${
                      viewMode === 'table'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <LayoutList size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('cards')}
                    title="Xem dạng thẻ"
                    className={`rounded-xl p-2.5 transition ${
                      viewMode === 'cards'
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
                  {STATUS_FILTERS.map(status => (
                    <button
                      key={status.id}
                      type="button"
                      onClick={() => setFilterStatus(status.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition ${
                        filterStatus === status.id
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {status.label}
                      {status.id === 'ALL'
                        ? ` (${visibleRequests.length})`
                        : statusCounts[status.id] !== undefined
                          ? ` (${statusCounts[status.id]})`
                          : ''}
                    </button>
                  ))}
                </div>

                {isAnyFilterActive && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-200/80 px-2.5 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-300 hover:text-slate-900 transition"
                  >
                    <RotateCcw size={11} /> Xóa lọc
                  </button>
                )}
              </div>
            </div>

            {/* BẢNG DỮ LIỆU TINH GỌN (MẶC ĐỊNH) */}
            {paginatedRequests.length === 0 ? (
              <EmptyState
                icon={<FileText size={18} />}
                title="Không tìm thấy phiếu yêu cầu phù hợp"
                message="Thử đổi từ khóa, khoảng ngày, kho hoặc trạng thái để xem thêm phiếu."
              />
            ) : viewMode === 'table' ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-slate-50/90 text-[11px] font-black uppercase tracking-wider text-slate-500">
                        <th className="py-3.5 pl-5 pr-3">Mã & Ngày lập</th>
                        <th className="py-3.5 px-3">Trạng thái</th>
                        <th className="py-3.5 px-3">Luồng kho điều phối</th>
                        <th className="py-3.5 px-3">Vật tư & Hạn cần</th>
                        <th className="py-3.5 px-3">Tiến trình</th>
                        <th className="py-3.5 pr-5 pl-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                      {paginatedRequests.map(req => {
                        const action = getMaterialRequestNextAction(req, user);
                        const siteName = warehouses.find(w => w.id === req.siteWarehouseId)?.name || 'N/A';
                        const sourceName = warehouses.find(w => w.id === req.sourceWarehouseId)?.name || 'Chưa gán';
                        const requesterName = users.find(u => u.id === req.requesterId)?.name || 'N/A';
                        const isIncoming = user.assignedWarehouseId === req.siteWarehouseId;
                        const isOutgoing = user.assignedWarehouseId === req.sourceWarehouseId;

                        return (
                          <tr
                            key={req.id}
                            onClick={() => handleOpenRequest(req)}
                            className="hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                          >
                            {/* Mã & Ngày lập */}
                            <td className="py-3.5 pl-5 pr-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50/80 px-2 py-0.5 rounded-lg border border-indigo-100/70 group-hover:bg-indigo-100 group-hover:border-indigo-200 transition">
                                  {req.code}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                                <span>{formatDateTime(req.createdDate)}</span>
                                <span>•</span>
                                <span className="text-slate-600 font-bold">{requesterName}</span>
                              </div>
                            </td>

                            {/* Trạng thái */}
                            <td className="py-3.5 px-3">
                              <StatusBadge status={req.status} label={action.label} tone={action.tone} size="sm" />
                            </td>

                            {/* Luồng điều phối kho */}
                            <td className="py-3.5 px-3 max-w-[240px]">
                              <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                                <span className="truncate">{sourceName}</span>
                                <ArrowRight size={12} className="text-indigo-500 shrink-0" />
                                <span className="text-indigo-700 truncate">{siteName}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-1">
                                {isIncoming && (
                                  <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-600 border border-blue-100">
                                    <Inbox size={9} className="mr-0.5" /> Kho nhận
                                  </span>
                                )}
                                {isOutgoing && (
                                  <span className="inline-flex items-center rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-black text-orange-600 border border-orange-100">
                                    <SendIcon size={9} className="mr-0.5" /> Kho xuất
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Vật tư & Hạn cần */}
                            <td className="py-3.5 px-3 max-w-[240px]">
                              <div className="font-black text-xs text-slate-800 flex items-center gap-2">
                                <span>{req.items.length} loại vật tư</span>
                                {req.expectedDate && (
                                  <span className="text-[10px] text-amber-600 font-bold flex items-center gap-0.5">
                                    <Calendar size={10} /> Cần: {formatDateOnly(req.expectedDate)}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 truncate space-y-0.5">
                                {req.items.slice(0, 2).map((item, idx) => {
                                  const product = items.find(i => i.id === item.itemId);
                                  return (
                                    <div key={idx} className="truncate">
                                      • {product?.name || 'Vật tư'} ({item.requestQty || item.approvedQty} {product?.unit})
                                    </div>
                                  );
                                })}
                                {req.items.length > 2 && (
                                  <span className="text-[10px] font-bold text-slate-400 italic">
                                    +{req.items.length - 2} loại khác
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Tiến trình / Next Action */}
                            <td className="py-3.5 px-3 max-w-[200px]">
                              <p className="text-xs font-semibold text-slate-600 truncate">
                                <Clock size={12} className="inline mr-1 text-slate-400" />
                                {action.nextAction}
                              </p>
                              {req.note && (
                                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                  {req.note}
                                </p>
                              )}
                            </td>

                            {/* Thao tác */}
                            <td className="py-3.5 pr-5 pl-3 text-right" onClick={e => e.stopPropagation()}>
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                {action.isActionable ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenRequest(req)}
                                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black text-white shadow-xs transition active:scale-95 ${
                                      req.status === RequestStatus.APPROVED
                                        ? 'bg-blue-600 hover:bg-blue-700'
                                        : req.status === RequestStatus.IN_TRANSIT
                                          ? 'bg-emerald-600 hover:bg-emerald-700'
                                          : req.status === RequestStatus.PENDING
                                            ? 'bg-amber-600 hover:bg-amber-700'
                                            : 'bg-slate-900 hover:bg-slate-800'
                                    }`}
                                  >
                                    {req.status === RequestStatus.APPROVED && <Truck size={12} />}
                                    {req.status === RequestStatus.IN_TRANSIT && <CheckCircle size={12} />}
                                    {req.status === RequestStatus.PENDING && <AlertCircle size={12} />}
                                    {action.actionLabel}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenRequest(req)}
                                    title="Xem chi tiết"
                                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 transition shadow-xs"
                                  >
                                    <Eye size={14} />
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
              </div>
            ) : (
              /* DẠNG THẺ (CARDS VIEW) */
              <div className="grid grid-cols-1 gap-4">
                {paginatedRequests.map((req) => {
                  const action = getMaterialRequestNextAction(req, user);
                  const siteName = warehouses.find(w => w.id === req.siteWarehouseId)?.name || 'N/A';
                  const sourceName = warehouses.find(w => w.id === req.sourceWarehouseId)?.name || 'Chưa gán';
                  const requesterName = users.find(u => u.id === req.requesterId)?.name || 'N/A';
                  const isIncoming = user.assignedWarehouseId === req.siteWarehouseId;
                  const isOutgoing = user.assignedWarehouseId === req.sourceWarehouseId;
                  const needsExport = canExportMaterialRequest(user, req);
                  const needsReceive = canReceiveMaterialRequest(user, req);
                  const needsApprove = req.status === RequestStatus.PENDING && canApproveMaterialRequest(user, req);

                  return (
                    <div
                      key={req.id}
                      onClick={() => handleOpenRequest(req)}
                      className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md ${
                        action.isActionable ? 'border-orange-200 ring-1 ring-orange-100' : 'border-slate-200'
                      }`}
                    >
                      {action.isActionable && <div className="absolute left-0 top-0 h-full w-1 bg-orange-500" />}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-black text-slate-600">{req.code}</span>
                            <StatusBadge status={req.status} label={action.label} tone={action.tone} />
                            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">Người tạo: {requesterName}</span>
                            {isIncoming && <span className="inline-flex items-center rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600"><Inbox size={10} className="mr-1" />Kho nhận</span>}
                            {isOutgoing && <span className="inline-flex items-center rounded-md border border-orange-100 bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-600"><SendIcon size={10} className="mr-1" />Kho xuất</span>}
                          </div>

                          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Cung cấp bởi</p>
                              <div className="flex items-center text-sm font-black text-slate-700">
                                <PackageSearch size={15} className="mr-2 text-slate-400" />
                                {sourceName}
                              </div>
                            </div>
                            <ArrowRight size={18} className="hidden text-slate-300 md:block" />
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Điều chuyển đến</p>
                              <div className="flex items-center text-sm font-black text-slate-800">
                                <Truck size={15} className="mr-2 text-slate-400" />
                                {siteName}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                            <span>{req.items.length} loại vật tư</span>
                            <span className="text-slate-300">•</span>
                            <span>Lập: {formatDateTime(req.createdDate)}</span>
                            {req.expectedDate && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span>Cần trước: {formatDateTime(req.expectedDate)}</span>
                              </>
                            )}
                          </div>
                          <p className="mt-3 text-xs font-bold leading-5 text-slate-600">
                            <Clock size={13} className="mr-1 inline align-[-2px] text-slate-400" />
                            {action.nextAction}
                          </p>
                        </div>

                        <div className="flex min-w-[180px] flex-col justify-center gap-2 border-t border-slate-100 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0" onClick={(event) => event.stopPropagation()}>
                          {needsExport && (
                            <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700">
                              <Truck size={14} className="mr-2" /> Xuất kho
                            </button>
                          )}
                          {needsReceive && (
                            <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-700">
                              <CheckCircle size={14} className="mr-2" /> Nhận hàng
                            </button>
                          )}
                          {needsApprove && (
                            <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white shadow-sm shadow-amber-500/20 hover:bg-amber-600">
                              <AlertCircle size={14} className="mr-2" /> Thẩm định
                            </button>
                          )}
                          {!needsExport && !needsReceive && !needsApprove && (
                            <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">
                              <FileText size={14} className="mr-2" /> Xem chi tiết
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <Pagination
              currentPage={reqPage}
              totalPages={reqTotalPages}
              totalItems={reqTotal}
              startIndex={reqStart}
              endIndex={reqEnd}
              onPageChange={reqSetPage}
              pageSize={reqPageSize}
              onPageSizeChange={reqSetPageSize}
            />
            {isPerf02RequestPagingEnabled && (requestCursor || requestLoadError) && (
              <div className="flex flex-col items-center gap-2">
                {requestLoadError && <p className="text-xs font-semibold text-rose-600">{requestLoadError}</p>}
                {requestCursor && (
                  <button
                    type="button"
                    onClick={() => void loadMoreRequests()}
                    disabled={isLoadingRequests}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {isLoadingRequests ? 'Đang tải thêm...' : 'Tải thêm đề xuất từ Cloud'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RequestWorkflow;
