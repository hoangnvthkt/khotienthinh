import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, ClipboardList, FileWarning, Loader2, Search, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DemandPanel } from '../../components/procurement/DemandPanel';
import { ReconciliationPanel } from '../../components/procurement/ReconciliationPanel';
import { WorkbenchShell } from '../../components/procurement/WorkbenchShell';
import { WorkQueue } from '../../components/procurement/WorkQueue';
import { SupplyPlanDialog } from '../../components/procurement/SupplyPlanDialog';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { procurementDemandService } from '../../lib/procurement/demandService';
import { resolveProcurementDocument } from '../../lib/procurement/documentAdapters';
import { parseProcurementQuery, serializeProcurementQuery } from '../../lib/procurement/queryState';
import {
  isProcurementWorkbenchUnavailable,
  procurementWorkbenchService,
} from '../../lib/procurement/workbenchService';
import type { ProcurementDemandDetail, ProcurementQuery, ProcurementWorkbenchPage, ProcurementWorkbenchRow, ProcurementView } from '../../types/procurementWorkbench';

const CompanyProcurement = React.lazy(() => import('./CompanyProcurement'));
const MODERN_VIEWS = new Set<ProcurementView>(['work', 'demand', 'reconcile', 'overview']);

const isDenied = (error: unknown) => (error as { code?: string })?.code === '42501';

const WorkbenchState: React.FC<{ kind: 'loading' | 'empty' | 'error' | 'denied'; message?: string; onRetry?: () => void }> = ({ kind, message, onRetry }) => {
  const Icon = kind === 'loading' ? Loader2 : kind === 'denied' ? ShieldAlert : kind === 'error' ? AlertCircle : ClipboardList;
  const title = kind === 'loading' ? 'Đang tải công việc mới nhất'
    : kind === 'denied' ? 'Bạn chưa được cấp phạm vi mua hàng'
      : kind === 'error' ? 'Chưa thể cập nhật Workbench'
        : 'Không có công việc phù hợp';
  return <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
    <div className="max-w-md">
      <Icon size={28} className={`mx-auto ${kind === 'loading' ? 'animate-spin text-emerald-600' : kind === 'error' || kind === 'denied' ? 'text-amber-600' : 'text-slate-400'}`} />
      <h2 className="mt-3 text-lg font-black">{title}</h2>
      <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{message || (kind === 'empty' ? 'Thử xóa bộ lọc hoặc chọn phạm vi khác.' : 'Vui lòng chờ trong giây lát.')}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-black text-white dark:bg-white dark:text-slate-900">Thử lại</button>}
    </div>
  </div>;
};

const SummaryCards: React.FC<{ page: ProcurementWorkbenchPage }> = ({ page }) => {
  const needsPlan = page.items.filter(item => item.actionKind === 'plan_supply').length;
  const exceptions = page.items.filter(item => item.actionKind === 'reconcile').length;
  const due = page.items.filter(item => item.neededDate && item.neededDate <= new Date().toISOString().slice(0, 10)).length;
  const cards = [
    ['Chờ xử lý', page.counters.find(item => item.key === 'work')?.count ?? page.items.length, 'việc'],
    ['Cần lập phương án', needsPlan, 'dòng trên trang'],
    ['Đến hạn', due, 'dòng trên trang'],
    ['Cần đối chiếu', exceptions, 'dòng trên trang'],
  ];
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, count, suffix]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-2 text-3xl font-black tracking-tight">{count}</p>
    <p className="mt-1 text-xs font-semibold text-slate-500">{suffix}</p>
  </div>)}</div>;
};

const ContractGateway: React.FC<{ onOpen: () => void }> = ({ onOpen }) => <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
  <div>
    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">Hợp đồng & nhà cung cấp</p>
    <h2 className="mt-2 text-xl font-black">Tra cứu điều khoản tại hồ sơ hợp đồng hiện hữu</h2>
    <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500 dark:text-slate-400">Workbench chưa mở gọi hàng tự động cho hợp đồng legacy chưa có phiên bản điều khoản và chính sách hạn mức. Bạn vẫn có thể xem hợp đồng, phiếu giao và bảng đối soát theo đúng nguồn.</p>
    <button type="button" onClick={onOpen} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-black text-white hover:bg-blue-800"><ArrowUpRight size={16} />Mở Hợp đồng NCC</button>
  </div>
  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
    <FileWarning className="text-amber-700 dark:text-amber-300" size={22} />
    <p className="mt-2 font-black text-amber-900 dark:text-amber-200">Call-off đang giới hạn</p>
    <p className="mt-1 text-xs font-semibold leading-5 text-amber-800 dark:text-amber-300">Chỉ mở khi HĐ có revision, hiệu lực, đơn giá/thuế/tiền tệ và limit policy được cấu hình ở server.</p>
  </div>
</section>;

const ProcurementWorkbench: React.FC = () => {
  const { users } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => parseProcurementQuery(searchParams), [searchParams]);
  const listQuery = useMemo<ProcurementQuery>(() => ({
    view: query.view,
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.constructionSiteId ? { constructionSiteId: query.constructionSiteId } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.method ? { method: query.method } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(query.neededFrom ? { neededFrom: query.neededFrom } : {}),
    ...(query.neededTo ? { neededTo: query.neededTo } : {}),
  }), [
    query.assigneeId, query.constructionSiteId, query.method, query.neededFrom,
    query.neededTo, query.projectId, query.search, query.source, query.stage, query.view,
  ]);
  const [searchDraft, setSearchDraft] = useState(query.search || '');
  const [page, setPage] = useState<ProcurementWorkbenchPage | null>(null);
  const [detail, setDetail] = useState<ProcurementDemandDetail | null>(null);
  const [reconciliationRow, setReconciliationRow] = useState<ProcurementWorkbenchRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [legacyReason, setLegacyReason] = useState<'server_unavailable' | 'purchase' | null>(
    searchParams.get('legacy') === '1' ? 'server_unavailable' : null,
  );
  const legacyFallback = legacyReason !== null;
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  const setQuery = useCallback((patch: Partial<ProcurementQuery>, replace = false) => {
    const next = { ...query, ...patch };
    Object.keys(next).forEach(key => {
      if (next[key as keyof ProcurementQuery] == null || next[key as keyof ProcurementQuery] === '') delete next[key as keyof ProcurementQuery];
    });
    setSearchParams(serializeProcurementQuery(next), { replace });
  }, [query, setSearchParams]);

  useEffect(() => setSearchDraft(query.search || ''), [query.search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft.trim() !== (query.search || '')) setQuery({ search: searchDraft.trim() || undefined, demandId: undefined }, true);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query.search, searchDraft, setQuery]);

  const load = useCallback(async (cursor: string | null = null) => {
    if (!MODERN_VIEWS.has(listQuery.view) || legacyFallback) return;
    const generation = ++listGeneration.current;
    if (cursor) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await procurementWorkbenchService.list(listQuery, cursor, 50);
      if (generation !== listGeneration.current) return;
      setPage(previous => cursor && previous ? {
        ...result,
        items: [...previous.items, ...result.items],
      } : result);
    } catch (loadError) {
      if (generation !== listGeneration.current) return;
      if (isProcurementWorkbenchUnavailable(loadError)) {
        setLegacyReason('server_unavailable');
        return;
      }
      logApiError('procurementWorkbench.list', loadError);
      if (isDenied(loadError)) setPage(null);
      setError(loadError);
    } finally {
      if (generation === listGeneration.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [legacyFallback, listQuery]);

  useEffect(() => {
    listGeneration.current += 1;
    setPage(null);
    setError(null);
    setReconciliationRow(null);
  }, [listQuery]);
  useEffect(() => { void load(null); }, [load, refreshKey]);

  useEffect(() => {
    const demandId = query.demandId;
    if (!demandId || legacyFallback || !MODERN_VIEWS.has(query.view)) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const generation = ++detailGeneration.current;
    setDetailLoading(true);
    setDetailError(null);
    procurementWorkbenchService.getDemand(demandId).then(result => {
      if (generation === detailGeneration.current) setDetail(result);
    }).catch(loadError => {
      if (generation !== detailGeneration.current) return;
      logApiError('procurementWorkbench.detail', loadError);
      setDetail(null);
      setDetailError(getApiErrorMessage(loadError));
    }).finally(() => {
      if (generation === detailGeneration.current) setDetailLoading(false);
    });
  }, [legacyFallback, query.demandId, query.view, refreshKey]);

  const selectRow = (row: ProcurementWorkbenchRow) => {
    detailTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!row.demandId) {
      setQuery({ demandId: undefined }, false);
      setReconciliationRow(row);
      return;
    }
    setReconciliationRow(null);
    setQuery({ demandId: row.demandId }, false);
  };

  const closeDetail = useCallback(() => {
    setQuery({ demandId: undefined });
    setReconciliationRow(null);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }, [setQuery]);
  const closePlan = useCallback(() => setPlanOpen(false), []);
  const continuePurchase = useCallback(() => {
    setPlanOpen(false);
    setLegacyReason('purchase');
  }, []);

  useEffect(() => {
    if (!query.demandId || planOpen) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDetail();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeDetail, planOpen, query.demandId]);

  const assign = async (userId: string, reason: string) => {
    if (!detail) return;
    try {
      await procurementDemandService.assign({
        demandId: detail.id, assigneeUserId: userId, expectedVersion: Number(detail.version),
        reason, idempotencyKey: globalThis.crypto.randomUUID(),
      });
      toast.success('Đã giao việc', 'Người phụ trách mới đã được ghi vào lịch sử nhu cầu.');
      setRefreshKey(value => value + 1);
    } catch (assignError) {
      logApiError('procurementWorkbench.assign', assignError);
      toast.error('Không giao được việc', getApiErrorMessage(assignError));
      throw assignError;
    }
  };

  const legacyView = legacyFallback || (query.view !== 'partners' && !MODERN_VIEWS.has(query.view));
  return <WorkbenchShell
    view={query.view}
    onViewChange={view => { setLegacyReason(null); setReconciliationRow(null); setQuery({ view, demandId: undefined }); }}
    onRefresh={() => setRefreshKey(value => value + 1)}
    refreshing={loading}
  >
    {query.view === 'partners' && !legacyFallback ? <ContractGateway onOpen={() => navigate('/hd/supplier')} /> : legacyView ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {legacyFallback && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{legacyReason === 'purchase'
        ? 'Tiếp tục lập PO tại màn tương thích. PO, liên kết nhu cầu và allocation vẫn được lưu trong cùng một transaction.'
        : 'Máy chủ chưa mở read model Workbench cho phạm vi này. Các nghiệp vụ hiện hữu vẫn dùng màn tương thích bên dưới.'}</div>}
      <Suspense fallback={<WorkbenchState kind="loading" />}><CompanyProcurement /></Suspense>
    </div> : <>
      {page && <SummaryCards page={page} />}
      <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1" htmlFor="procurement-search">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input id="procurement-search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Tìm vật tư, mã đề xuất, SKU…" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950" />
        </label>
        <label className="relative sm:w-52" htmlFor="procurement-stage">
          <SlidersHorizontal size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select id="procurement-stage" value={query.stage || ''} onChange={event => setQuery({ stage: (event.target.value || undefined) as ProcurementQuery['stage'], demandId: undefined })} className="min-h-11 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950">
            <option value="">Mọi giai đoạn</option><option value="processing">Đang xử lý</option><option value="receiving">Giao nhận</option><option value="reconcile">Đối chiếu</option>
          </select>
        </label>
      </div>

      <div className={`mt-3 grid gap-3 ${query.demandId || reconciliationRow ? 'xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]' : ''}`}>
        <div>
          {loading && !page ? <WorkbenchState kind="loading" />
            : error && !page ? <WorkbenchState kind={isDenied(error) ? 'denied' : 'error'} message={getApiErrorMessage(error)} onRetry={isDenied(error) ? undefined : () => setRefreshKey(value => value + 1)} />
              : page?.items.length ? <>
                {error && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Chưa cập nhật · đang hiển thị dữ liệu lúc {new Date(page.asOf).toLocaleString('vi-VN')}</div>}
                <WorkQueue rows={page.items} selectedId={reconciliationRow?.id || page.items.find(item => item.demandId === query.demandId)?.id} onSelect={selectRow} />
                {page.nextCursor && <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void load(page.nextCursor)}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {loadingMore && <Loader2 size={16} className="animate-spin" />}
                  Xem thêm công việc
                </button>}
              </> : <WorkbenchState kind="empty" />}
        </div>
        {query.demandId && <div className="fixed inset-0 z-50 bg-slate-950/45 p-2 sm:p-4 xl:static xl:z-auto xl:bg-transparent xl:p-0">
          <DemandPanel
            detail={detail} loading={detailLoading} error={detailError} users={users}
            onClose={closeDetail}
            onAssign={assign}
            onPlanSupply={() => setPlanOpen(true)}
            onOpenDocument={ref => navigate(resolveProcurementDocument(ref, `${location.pathname}${location.search}`).route)}
          />
        </div>}
        {reconciliationRow && <div className="fixed inset-0 z-50 bg-slate-950/45 p-2 sm:p-4 xl:static xl:z-auto xl:bg-transparent xl:p-0">
          <ReconciliationPanel row={reconciliationRow} onClose={closeDetail} />
        </div>}
      </div>
      <SupplyPlanDialog
        open={planOpen}
        demandLabel={detail?.sourceCode || 'Nhu cầu đang chọn'}
        onClose={closePlan}
        onContinuePurchase={continuePurchase}
      />
    </>}
  </WorkbenchShell>;
};

export default ProcurementWorkbench;
