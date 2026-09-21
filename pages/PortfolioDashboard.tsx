import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowRight, Building2, CheckCircle2, Download,
  FileSearch, GitBranch, Loader2, PackageCheck, RefreshCcw, Search, ShieldAlert,
  ShoppingCart, Warehouse, WalletCards,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { EmptyState, PageHeader, StatusBadge } from '../components/erp';
import { buildDocumentTracePath } from '../lib/documentTraceService';
import {
  type ManagementDatasetPage, type ManagementDatasetRow, type ManagementSeverity,
  type ManagementViewId,
} from '../lib/managementDataset';
import { managementDatasetService } from '../lib/managementDatasetService';

const VIEWS: Array<{ id: ManagementViewId; label: string; short: string; description: string; icon: React.ReactNode }> = [
  { id: 'M05', label: 'Điều hành tổng thể', short: 'Lãnh đạo', description: 'Dự án cần can thiệp và chất lượng nguồn', icon: <Building2 size={17} /> },
  { id: 'M01', label: 'Điều hành dự án', short: 'Dự án', description: 'Công tác thiếu vật tư và nhu cầu chưa bố trí', icon: <PackageCheck size={17} /> },
  { id: 'M02', label: 'Quản lý mua hàng', short: 'Mua hàng', description: 'Backlog, PO mở và giao trễ', icon: <ShoppingCart size={17} /> },
  { id: 'M03', label: 'Quản lý kho', short: 'Kho', description: 'QC và chênh lệch cần đối soát', icon: <Warehouse size={17} /> },
  { id: 'M04', label: 'Quản lý tài chính', short: 'Tài chính', description: 'AP, hóa đơn và thanh toán theo quyền', icon: <WalletCards size={17} /> },
];

const TRACE_TYPES = new Set([
  'project_task', 'material_request', 'purchase_order', 'purchase_delivery_batch', 'quality_check',
  'supplier_payable_document', 'supplier_invoice', 'supplier_payment_batch',
]);

const severityLabel: Record<ManagementSeverity, string> = {
  critical: 'Cần xử lý ngay', warning: 'Cần theo dõi', info: 'Thông tin',
};
const severityClass: Record<ManagementSeverity, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Chưa có hạn';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Ngày chưa hợp lệ' : date.toLocaleDateString('vi-VN');
};
const formatValue = (row: ManagementDatasetRow) => {
  if (row.value == null) return 'Chưa xác định';
  if (row.currency) return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: row.currency, maximumFractionDigits: 0 }).format(row.value);
  return `${row.value.toLocaleString('vi-VN')} ${row.unit === 'record' ? 'hồ sơ' : row.unit}`;
};
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const downloadCsv = (page: ManagementDatasetPage) => {
  const headers = ['view', 'metric', 'definition_version', 'as_of', 'project', 'title', 'severity', 'owner', 'due_at', 'value', 'unit', 'currency', 'vat_basis', 'completeness', 'quality_issues', 'source_type', 'source_id', 'inferred'];
  const rows = page.rows.map(row => [row.viewId, row.metricId, row.metricDefinitionVersion, page.asOf, row.projectName || row.projectId, row.title, row.severity, row.ownerName || row.ownerId, row.dueAt, row.value, row.unit, row.currency, row.vatBasis, row.completeness, row.qualityIssues.join('|'), row.source.type, row.source.id, row.source.inferred]);
  const blob = new Blob([[headers, ...rows].map(line => line.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `erp-management-${page.filter.viewId || 'dataset'}-${page.asOf.slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

type ManagementDatasetDataSource = Pick<typeof managementDatasetService,
  'list' | 'listAllForExport' | 'invalidate' | 'setActor' | 'bindRealtimeInvalidation'>;

export const PortfolioDashboardContent: React.FC<{
  actorId?: string | null;
  dataSource?: ManagementDatasetDataSource;
}> = ({ actorId, dataSource = managementDatasetService }) => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramView = params.get('view') as ManagementViewId | null;
  const [viewId, setViewId] = useState<ManagementViewId>(VIEWS.some(view => view.id === paramView) ? paramView! : 'M05');
  const [projectId, setProjectId] = useState(params.get('project') || '');
  const [severity, setSeverity] = useState<ManagementSeverity | ''>((params.get('severity') as ManagementSeverity) || '');
  const [search, setSearch] = useState(params.get('q') || '');
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState<ManagementDatasetPage | null>(null);
  const [projectOptions, setProjectOptions] = useState<ManagementDatasetPage['options']['projects']>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const requestGeneration = useRef(0);

  const filter = useMemo(() => ({
    viewId, ...(projectId ? { projectId } : {}), ...(severity ? { severity } : {}),
    ...(deferredSearch ? { search: deferredSearch } : {}),
  }), [viewId, projectId, severity, deferredSearch]);

  const load = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    setPage(null);
    try {
      const next = await dataSource.list({ ...filter, limit: 50 });
      if (requestId !== requestGeneration.current) return;
      setPage(next);
      setProjectOptions(current => next.options.projects.length >= current.length ? next.options.projects : current);
    } catch (nextError) {
      if (requestId === requestGeneration.current) setError(nextError);
    } finally {
      if (requestId === requestGeneration.current) setLoading(false);
    }
  }, [actorId, dataSource, filter, refreshVersion]);

  useEffect(() => {
    dataSource.setActor(actorId);
    setProjectOptions([]);
    setPage(null);
  }, [actorId, dataSource]);
  useEffect(() => {
    const next = new URLSearchParams();
    next.set('view', viewId);
    if (projectId) next.set('project', projectId);
    if (severity) next.set('severity', severity);
    if (deferredSearch) next.set('q', deferredSearch);
    setParams(next, { replace: true });
  }, [viewId, projectId, severity, deferredSearch, setParams]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => dataSource.bindRealtimeInvalidation(() => setRefreshVersion(value => value + 1)), [dataSource]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const denied = Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '42501');
  const stale = Boolean(page && Date.parse(page.staleAfter) < now);
  const unavailable = page?.catalog.filter(metric => metric.viewId === viewId && metric.availability !== 'available') || [];

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    const requestId = requestGeneration.current;
    setLoadingMore(true);
    try {
      const next = await dataSource.list({ ...filter, cursor: page.nextCursor, asOf: page.asOf, limit: 50 });
      if (requestId === requestGeneration.current) {
        setPage(current => current ? { ...next, rows: [...current.rows, ...next.rows] } : next);
      }
    } catch (nextError) {
      if (requestId === requestGeneration.current) setError(nextError);
    } finally {
      if (requestId === requestGeneration.current) setLoadingMore(false);
    }
  };
  const exportDataset = async () => {
    if (!page?.capabilities.canExport) return;
    setExporting(true);
    try { downloadCsv(await dataSource.listAllForExport(filter)); }
    catch (nextError) { setError(nextError); }
    finally { setExporting(false); }
  };
  const openTrace = (row: ManagementDatasetRow) => {
    if (TRACE_TYPES.has(row.source.type)) navigate(buildDocumentTracePath(row.source.type as Parameters<typeof buildDocumentTracePath>[0], row.source.id));
  };

  return <div className="space-y-5 pb-8">
    <PageHeader eyebrow="ERP Management Dataset · v1" icon={<Building2 size={19} />} title="Trung tâm điều hành"
      description="Ưu tiên các việc cần quyết định. Mỗi chỉ số dùng cùng nguồn, quyền và ngày chốt từ tổng quan đến export."
      meta={page ? <>
        <StatusBadge status="in_progress" label={`Chốt ${new Date(page.asOf).toLocaleString('vi-VN')}`} tone="info" size="md" />
        <StatusBadge status={stale ? 'warning' : 'completed'} label={stale ? 'Dữ liệu cần làm mới' : 'Dữ liệu đang hiệu lực'} tone={stale ? 'attention' : 'success'} size="md" />
        {page.totals.unknownCount > 0 && <StatusBadge status="warning" label={`${page.totals.unknownCount} dòng chưa đủ nguồn`} tone="attention" size="md" />}
      </> : undefined}
      secondaryActions={[
        { label: 'Làm mới', icon: <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />, onClick: () => { dataSource.invalidate(); setRefreshVersion(value => value + 1); }, disabled: loading },
        { label: exporting ? 'Đang xuất…' : 'Xuất đúng bộ lọc', icon: exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />, onClick: exportDataset, disabled: !page?.capabilities.canExport || exporting, title: page && !page.capabilities.canExport ? 'Bạn chưa có quyền export trong phạm vi này.' : undefined },
      ]} />

    <nav aria-label="Góc nhìn quản trị" className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      {VIEWS.map(view => {
        const active = view.id === viewId;
        return <button key={view.id} type="button" aria-pressed={active} onClick={() => setViewId(view.id)}
          className={`min-h-[82px] rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${active ? 'border-emerald-300 bg-emerald-50 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'}`}>
          <div className={`flex items-center gap-2 text-sm font-black ${active ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>{view.icon}<span>{view.short}</span></div>
          <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">{view.description}</p>
        </button>;
      })}
    </nav>

    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-label="Bộ lọc dataset">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_170px_auto]">
        <label className="relative block"><span className="sr-only">Tìm trong dataset</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm dự án, hồ sơ, người xử lý…" className="min-h-11 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" /></label>
        <label><span className="sr-only">Lọc dự án</span><select value={projectId} onChange={event => setProjectId(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"><option value="">Tất cả dự án được phép xem</option>{projectOptions.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label><span className="sr-only">Lọc mức độ</span><select value={severity} onChange={event => setSeverity(event.target.value as ManagementSeverity | '')} className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"><option value="">Mọi mức độ</option><option value="critical">Cần xử lý ngay</option><option value="warning">Cần theo dõi</option><option value="info">Thông tin</option></select></label>
        <button type="button" onClick={() => { setProjectId(''); setSeverity(''); setSearch(''); }} disabled={!projectId && !severity && !search} className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Xóa bộ lọc</button>
      </div>
    </section>

    {loading && <LoadingState />}
    {!loading && error && <section role="alert" className={`rounded-xl border p-5 ${denied ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30' : 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30'}`}><div className="flex gap-3">{denied ? <ShieldAlert className="mt-0.5 shrink-0 text-amber-600" /> : <AlertCircle className="mt-0.5 shrink-0 text-rose-600" />}<div><h2 className="font-black text-slate-900 dark:text-white">{denied ? 'Bạn chưa có quyền xem phạm vi này' : 'Không đọc được dataset quản trị'}</h2><p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{denied ? 'Hãy chọn dự án bạn được phân quyền hoặc liên hệ quản trị viên.' : 'Dữ liệu cũ không được giữ như dữ liệu mới. Hãy thử tải lại.'}</p><button type="button" onClick={() => setRefreshVersion(value => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-black text-white dark:bg-white dark:text-slate-900"><RefreshCcw size={14} /> Thử lại</button></div></div></section>}

    {!loading && !error && page && <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Tổng hợp ngoại lệ">
        <SummaryCard label="Tổng hồ sơ" value={page.totals.rowCount} icon={<FileSearch size={17} />} tone="slate" />
        <SummaryCard label="Cần xử lý ngay" value={page.totals.criticalCount} icon={<AlertCircle size={17} />} tone="rose" />
        <SummaryCard label="Cần theo dõi" value={page.totals.warningCount} icon={<AlertTriangle size={17} />} tone="amber" />
        <SummaryCard label="Chưa đủ nguồn" value={page.totals.unknownCount} icon={<ShieldAlert size={17} />} tone="violet" />
      </section>
      {unavailable.length > 0 && <section className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/20"><div className="flex items-start gap-3"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-violet-600" /><div><h2 className="text-sm font-black text-violet-950 dark:text-violet-200">Một số chỉ tiêu chưa thể công bố</h2><p className="mt-1 text-xs font-medium leading-5 text-violet-800 dark:text-violet-300">{unavailable.map(metric => metric.label).join(', ')}. Hệ thống giữ trạng thái chưa xác định thay vì hiển thị 0 hoặc dự báo thiếu căn cứ.</p></div></div></section>}
      {page.rows.length === 0 ? <EmptyState icon={<CheckCircle2 size={22} />} title="Không có hồ sơ trong bộ lọc này" message="Đây là kết quả rỗng hợp lệ tại ngày chốt hiện tại. Thử đổi góc nhìn hoặc bộ lọc để xem phạm vi khác." /> : <DatasetTable page={page} viewId={viewId} navigate={navigate} openTrace={openTrace} loadMore={loadMore} loadingMore={loadingMore} />}
    </>}
  </div>;
};

const LoadingState = () => <div className="grid gap-3" aria-label="Đang tải dataset quản trị" aria-busy="true"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div><div className="h-72 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /></div>;

const SummaryCard: React.FC<{ label: string; value: number; icon: React.ReactNode; tone: 'slate' | 'rose' | 'amber' | 'violet' }> = ({ label, value, icon, tone }) => {
  const color = { slate: 'text-slate-700 bg-slate-100 dark:bg-slate-800 dark:text-slate-200', rose: 'text-rose-700 bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300', amber: 'text-amber-700 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300', violet: 'text-violet-700 bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300' }[tone];
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>{icon}</div><div className="mt-3 text-2xl font-black text-slate-900 dark:text-white">{value.toLocaleString('vi-VN')}</div><div className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</div></div>;
};

const DatasetTable: React.FC<{ page: ManagementDatasetPage; viewId: ManagementViewId; navigate: ReturnType<typeof useNavigate>; openTrace: (row: ManagementDatasetRow) => void; loadMore: () => void; loadingMore: boolean }> = ({ page, viewId, navigate, openTrace, loadMore, loadingMore }) => <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800"><div><h2 className="text-sm font-black text-slate-900 dark:text-white">Việc cần xem xét</h2><p className="text-xs font-medium text-slate-500">{VIEWS.find(view => view.id === viewId)?.label} · {page.rows.length}/{page.totals.rowCount} hồ sơ đã tải</p></div><span className="hidden text-[10px] font-black uppercase tracking-wide text-slate-400 sm:block">Cùng cutoff và metric version</span></div>
  <div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950/50 dark:text-slate-400"><tr><th className="px-4 py-3">Việc / nguồn</th><th className="px-4 py-3">Tác động</th><th className="px-4 py-3">Người giữ</th><th className="px-4 py-3">Hạn</th><th className="px-4 py-3 text-right">Hành động</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{page.rows.map(row => <ManagementRow key={row.id} row={row} navigate={navigate} openTrace={openTrace} />)}</tbody></table></div>
  <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">{page.rows.map(row => <ManagementCard key={row.id} row={row} navigate={navigate} openTrace={openTrace} />)}</div>
  {page.nextCursor && <div className="border-t border-slate-200 p-3 text-center dark:border-slate-800"><button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{loadingMore && <Loader2 size={14} className="animate-spin" />} Tải thêm</button></div>}
</section>;

const ManagementRow: React.FC<{ row: ManagementDatasetRow; navigate: ReturnType<typeof useNavigate>; openTrace: (row: ManagementDatasetRow) => void }> = ({ row, navigate, openTrace }) => <tr className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/30"><td className="px-4 py-3"><RowIdentity row={row} /></td><td className="px-4 py-3"><div className="text-sm font-black text-slate-800 dark:text-slate-100">{formatValue(row)}</div>{row.completeness !== 'complete' && <div className="mt-1 text-[10px] font-bold text-violet-600 dark:text-violet-300">Nguồn chưa đầy đủ</div>}</td><td className="px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300">{row.ownerName || 'Chưa phân công'}</td><td className="px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300">{formatDate(row.dueAt)}</td><td className="px-4 py-3"><RowActions row={row} navigate={navigate} openTrace={openTrace} /></td></tr>;
const ManagementCard: React.FC<{ row: ManagementDatasetRow; navigate: ReturnType<typeof useNavigate>; openTrace: (row: ManagementDatasetRow) => void }> = ({ row, navigate, openTrace }) => <article className="space-y-3 p-4"><RowIdentity row={row} /><div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950/40"><div><div className="font-bold text-slate-400">Tác động</div><div className="mt-1 font-black text-slate-800 dark:text-slate-100">{formatValue(row)}</div></div><div><div className="font-bold text-slate-400">Người giữ · hạn</div><div className="mt-1 font-black text-slate-800 dark:text-slate-100">{row.ownerName || 'Chưa phân công'} · {formatDate(row.dueAt)}</div></div></div><RowActions row={row} navigate={navigate} openTrace={openTrace} mobile /></article>;
const RowIdentity: React.FC<{ row: ManagementDatasetRow }> = ({ row }) => <div className="min-w-[220px]"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${severityClass[row.severity]}`}>{severityLabel[row.severity]}</span><div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{row.title}</div>{row.description && <div className="mt-0.5 max-w-lg text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">{row.description}</div>}<div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-400"><span>{row.projectName || 'Phạm vi kho'}</span><span>•</span><span>{row.source.label}</span>{row.source.inferred && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">Lịch sử suy luận</span>}</div></div>;
const RowActions: React.FC<{ row: ManagementDatasetRow; navigate: ReturnType<typeof useNavigate>; openTrace: (row: ManagementDatasetRow) => void; mobile?: boolean }> = ({ row, navigate, openTrace, mobile }) => <div className={`flex gap-2 ${mobile ? '' : 'justify-end'}`}>{TRACE_TYPES.has(row.source.type) && <button type="button" onClick={() => openTrace(row)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><GitBranch size={13} /> Trace</button>}<button type="button" onClick={() => navigate(row.drill.path)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900">Mở nguồn <ArrowRight size={13} /></button></div>;

const PortfolioDashboard: React.FC = () => {
  const { user } = useAuth();
  return <PortfolioDashboardContent actorId={user?.id} />;
};

export default PortfolioDashboard;
