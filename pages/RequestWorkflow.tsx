import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { MaterialRequest, MaterialRequestFulfillmentSummary, RequestStatus } from '../types';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Inbox,
  PackageSearch,
  Plus,
  Send as SendIcon,
  Truck,
} from 'lucide-react';
import { useModuleData } from '../hooks/useModuleData';
import { canApproveMaterialRequest, canExportMaterialRequest, canReceiveMaterialRequest, canViewMaterialRequest } from '../lib/wmsPermissions';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { matchesSearchQueryMultiple } from '../lib/searchUtils';
import { getMaterialRequestNextAction } from '../lib/erpWorkflow';
import { EmptyState, FilterBar, NextActionCard, PageHeader, StatusBadge } from '../components/erp';

const RequestModal = React.lazy(() => import('../components/RequestModal'));

const STATUS_FILTERS = [
  { id: 'ALL', label: 'Tất cả' },
  { id: RequestStatus.DRAFT, label: 'Nháp' },
  { id: RequestStatus.PENDING, label: 'Chờ duyệt' },
  { id: RequestStatus.APPROVED, label: 'Chờ xuất' },
  { id: RequestStatus.IN_TRANSIT, label: 'Đang giao' },
  { id: RequestStatus.COMPLETED, label: 'Đã nhận' },
  { id: RequestStatus.REJECTED, label: 'Từ chối' },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const RequestWorkflow: React.FC = () => {
  const { requests, warehouses, user, users } = useApp();
  useModuleData('wms');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);
  const [fulfillmentSummaries, setFulfillmentSummaries] = useState<Record<string, MaterialRequestFulfillmentSummary>>({});

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

  const filteredRequests = useMemo(() => {
    return visibleRequests.filter(req => {
      const matchStatus = filterStatus === 'ALL' || req.status === filterStatus;
      const siteName = warehouses.find(w => w.id === req.siteWarehouseId)?.name || '';
      const sourceName = warehouses.find(w => w.id === req.sourceWarehouseId)?.name || '';
      const requesterName = users.find(u => u.id === req.requesterId)?.name || '';
      const matchSearch = !searchTerm.trim() || matchesSearchQueryMultiple([
        req.code,
        req.note || '',
        siteName,
        sourceName,
        requesterName,
      ], searchTerm);
      return matchStatus && matchSearch;
    });
  }, [visibleRequests, filterStatus, searchTerm, warehouses, users]);

  const actionRequests = useMemo(() => (
    visibleRequests
      .map(req => ({ request: req, action: getMaterialRequestNextAction(req, user) }))
      .filter(item => item.action.isActionable)
      .sort((a, b) => new Date(a.request.expectedDate || a.request.createdDate).getTime() - new Date(b.request.expectedDate || b.request.createdDate).getTime())
      .slice(0, 4)
  ), [visibleRequests, user]);

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
    setSearchTerm('');
  };

  return (
    <div className="space-y-6">
      {isModalOpen && (
        <React.Suspense fallback={null}>
          <RequestModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} request={selectedRequest} />
        </React.Suspense>
      )}

      <PageHeader
        eyebrow="WMS"
        title="Điều phối vật tư"
        description="Theo dõi nhanh các phiếu yêu cầu, duyệt, xuất kho và xác nhận nhận hàng."
        meta={
          <>
            <StatusBadge status="pending" label={`${statusCounts[RequestStatus.PENDING] || 0} chờ duyệt`} tone="warning" size="md" />
            <StatusBadge status="approved" label={`${statusCounts[RequestStatus.APPROVED] || 0} chờ xuất`} tone="info" size="md" />
            <StatusBadge status="in_transit" label={`${statusCounts[RequestStatus.IN_TRANSIT] || 0} đang giao`} tone="attention" size="md" />
          </>
        }
        primaryAction={{
          label: 'Tạo đề xuất mới',
          icon: <Plus size={16} />,
          onClick: handleOpenCreate,
        }}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-slate-800 dark:text-white">Cần tôi xử lý</h2>
          <span className="text-[11px] font-bold text-slate-400">{actionRequests.length} việc</span>
        </div>
        {actionRequests.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={18} />}
            title="Không có phiếu cần bạn xử lý"
            message="Các phiếu mới hoặc phiếu đang chờ bạn thao tác sẽ xuất hiện tại đây."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {actionRequests.map(({ request, action }) => (
              <NextActionCard
                key={request.id}
                title={`${warehouses.find(w => w.id === request.siteWarehouseId)?.name || 'Kho nhận'} - ${request.items.length} vật tư`}
                code={request.code}
                status={request.status}
                statusLabel={action.label}
                tone={action.tone}
                nextAction={action.nextAction}
                actorName={users.find(u => u.id === request.requesterId)?.name || 'N/A'}
                dueAt={request.expectedDate || request.createdDate}
                actionLabel={action.actionLabel}
                onClick={() => handleOpenRequest(request)}
              />
            ))}
          </div>
        )}
      </section>

      <FilterBar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Tìm mã phiếu, kho, người tạo..."
        canClear={!!searchTerm || filterStatus !== 'ALL'}
        onClear={clearFilters}
        filters={
          <>
            {STATUS_FILTERS.map(status => (
              <button
                key={status.id}
                type="button"
                onClick={() => setFilterStatus(status.id)}
                className={`min-h-9 rounded-lg px-3 text-xs font-black transition ${
                  filterStatus === status.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                }`}
              >
                {status.label}
              </button>
            ))}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4">
        {filteredRequests.map((req) => {
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
              className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:bg-slate-900 ${
                action.isActionable ? 'border-orange-200 ring-1 ring-orange-100 dark:border-orange-900/50 dark:ring-orange-950/30' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {action.isActionable && <div className="absolute left-0 top-0 h-full w-1 bg-orange-500" />}
              <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{req.code}</span>
                    <StatusBadge status={req.status} label={action.label} tone={action.tone} />
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800">BY: {requesterName}</span>
                    {isIncoming && <span className="inline-flex items-center rounded border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600"><Inbox size={10} className="mr-1" />KHO NHẬN</span>}
                    {isOutgoing && <span className="inline-flex items-center rounded border border-orange-100 bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-600"><SendIcon size={10} className="mr-1" />KHO XUẤT</span>}
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Cung cấp bởi</p>
                      <div className="flex items-center text-sm font-black text-slate-700 dark:text-slate-100">
                        <PackageSearch size={15} className="mr-2 text-slate-400" />
                        {sourceName}
                      </div>
                    </div>
                    <ArrowRight size={18} className="hidden text-slate-300 md:block" />
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Điều chuyển đến</p>
                      <div className="flex items-center text-sm font-black text-slate-800 dark:text-white">
                        <Truck size={15} className="mr-2 text-slate-400" />
                        {siteName}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
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
                  <p className="mt-3 text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">
                    <Clock size={13} className="mr-1 inline align-[-2px] text-slate-400" />
                    {action.nextAction}
                  </p>
                </div>

                <div className="flex min-w-[180px] flex-col justify-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0" onClick={(event) => event.stopPropagation()}>
                  {needsExport && (
                    <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700">
                      <Truck size={14} className="mr-2" /> Xuất kho
                    </button>
                  )}
                  {needsReceive && (
                    <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-700">
                      <CheckCircle size={14} className="mr-2" /> Nhận hàng
                    </button>
                  )}
                  {needsApprove && (
                    <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-white shadow-sm shadow-amber-500/20 hover:bg-amber-600">
                      <AlertCircle size={14} className="mr-2" /> Thẩm định
                    </button>
                  )}
                  {!needsExport && !needsReceive && !needsApprove && (
                    <button onClick={() => handleOpenRequest(req)} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      <FileText size={14} className="mr-2" /> Xem chi tiết
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filteredRequests.length === 0 && (
          <EmptyState
            icon={<FileText size={18} />}
            title="Không tìm thấy phiếu yêu cầu phù hợp"
            message="Thử xoá bộ lọc hoặc kiểm tra lại mã phiếu, kho, người tạo."
          />
        )}
      </div>
    </div>
  );
};

export default RequestWorkflow;
