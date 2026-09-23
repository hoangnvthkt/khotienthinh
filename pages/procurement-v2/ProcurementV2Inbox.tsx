import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { procurementV2Service } from '../../lib/procurement/procurementV2Service';
import { parseProcurementV2Query, serializeProcurementV2Query } from '../../lib/procurement/procurementV2Query';
import { projectMasterService } from '../../lib/projectMasterService';
import { ProcurementV2Filters } from '../../components/procurement-v2/ProcurementV2Filters';
import { ProcurementV2DossierList } from '../../components/procurement-v2/ProcurementV2DossierList';
import type { ProcurementV2DossierCard, ProcurementV2Filter, ProcurementV2Page } from '../../types/procurementV2';

type LoadState = 'loading' | 'ready' | 'denied' | 'error' | 'stale';
const isDenied = (error: unknown) => !!error && typeof error === 'object'
  && 'code' in error && (error as { code: string }).code === '42501';
const isStale = (error: unknown) => !!error && typeof error === 'object'
  && 'code' in error && (error as { code: string }).code === '40001';

export const ProcurementV2InboxContent: React.FC<{
  page: ProcurementV2Page | null;
  state: LoadState;
  filter: ProcurementV2Filter;
  projects: Array<{ id: string; name: string }>;
  onFilterChange: (patch: Partial<ProcurementV2Filter>) => void;
  onOpen: (dossier: ProcurementV2DossierCard) => void;
  onRefresh: () => void;
  onMore: () => void;
  loadingMore?: boolean;
}> = ({ page, state, filter, projects, onFilterChange, onOpen, onRefresh, onMore, loadingMore = false }) => {
  const count = page?.counters.find(counter => counter.key === 'dossiers' && counter.grain === 'document')?.count;
  const hasFilters = Object.values(filter).some(Boolean);
  const projectNames = Object.fromEntries(projects.map(project => [project.id, project.name]));
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-white sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Mua hàng · Hồ sơ nhu cầu</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Hồ sơ cần xử lý</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Kế hoạch vật tư và đề xuất vật tư đã được duyệt sẽ đến đây. Mở từng hồ sơ để xem lượng còn phải bố trí và quyết định bước tiếp theo.</p></div>
        <button type="button" onClick={onRefresh} aria-label="Làm mới hồ sơ" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"><RefreshCw size={16} />Làm mới</button>
      </header>
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Hồ sơ trong bộ lọc</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{count === undefined ? '—' : count}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Đếm theo hồ sơ, không cộng lẫn số lượng các vật tư khác đơn vị.</p>
      </div>
      <ProcurementV2Filters filter={filter} projects={projects} onChange={onFilterChange} />
      {state === 'loading' && !page && <section role="status" className="grid min-h-56 place-items-center rounded-2xl border bg-white p-6 dark:border-slate-700 dark:bg-slate-900"><div className="text-center"><Loader2 className="mx-auto animate-spin text-emerald-700" /><p className="mt-2">Đang tải hồ sơ…</p></div></section>}
      {state === 'denied' && <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle className="mb-2" /><h2 className="font-semibold">Bạn chưa được cấp phạm vi xem hồ sơ mua hàng</h2><p className="mt-1 text-sm">Liên hệ người quản trị dự án để được cấp quyền phù hợp.</p></section>}
      {(state === 'error' || state === 'stale') && <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle className="mb-2" /><h2 className="font-semibold">{state === 'stale' ? 'Danh sách đã thay đổi' : 'Chưa tải được hồ sơ'}</h2><p className="mt-1 text-sm">{state === 'stale' ? 'Làm mới để xem dữ liệu hiện tại.' : 'Vui lòng thử lại.'}</p><button type="button" onClick={onRefresh} className="mt-3 min-h-11 rounded-xl bg-amber-900 px-4 text-sm font-semibold text-white">Thử lại</button></section>}
      {state === 'ready' && page?.items.length === 0 && <section className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900"><div><FolderOpen className="mx-auto text-slate-400" size={30} /><h2 className="mt-2 font-semibold">{hasFilters ? 'Không có hồ sơ phù hợp bộ lọc' : 'Chưa có hồ sơ cần xử lý'}</h2><p className="mt-1 text-sm text-slate-500">{hasFilters ? 'Thử đổi dự án, ngày cần hoặc trạng thái.' : 'Kế hoạch hoặc đề xuất đã duyệt sẽ xuất hiện tại đây.'}</p></div></section>}
      {state === 'ready' && !!page?.items.length && <><ProcurementV2DossierList dossiers={page.items} onOpen={onOpen} projectNames={projectNames} />
        {page.nextCursor && <button type="button" onClick={onMore} disabled={loadingMore} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">{loadingMore ? 'Đang tải thêm…' : 'Tải thêm hồ sơ'}</button>}</>}
    </div>
  </main>;
};

const ProcurementV2Inbox: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => parseProcurementV2Query(searchParams.toString()), [searchParams]);
  const [page, setPage] = useState<ProcurementV2Page | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [refresh, setRefresh] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const generationRef = useRef(0);
  const filterKey = searchParams.toString();
  useEffect(() => {
    let active = true;
    projectMasterService.list().then(rows => {
      if (active) setProjects(rows.map(row => ({ id: row.id, name: row.name })));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const generation = ++generationRef.current;
    setState('loading'); setPage(null); setNextCursor(null); setLoadingMore(false);
    const timer = window.setTimeout(() => {
      procurementV2Service.list(filter).then(result => {
        if (!active || generation !== generationRef.current) return;
        setPage(result); setNextCursor(result.nextCursor);
        setState(result.stale ? 'stale' : 'ready');
      }).catch(error => { if (active && generation === generationRef.current) setState(isDenied(error) ? 'denied' : isStale(error) ? 'stale' : 'error'); });
    }, filter.search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filterKey, refresh]);
  const onFilterChange = useCallback((patch: Partial<ProcurementV2Filter>) => {
    setSearchParams(serializeProcurementV2Query({ ...filter, ...patch }), { replace: true });
  }, [filter, setSearchParams]);
  const onMore = useCallback(() => {
    if (!nextCursor || !page || loadingMore) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    procurementV2Service.list(filter, nextCursor).then(result => {
      if (generation !== generationRef.current) return;
      setPage({ ...result, items: [...page.items, ...result.items] });
      setNextCursor(result.nextCursor); setState(result.stale ? 'stale' : 'ready');
    }).catch(error => { if (generation === generationRef.current) setState(isDenied(error) ? 'denied' : isStale(error) ? 'stale' : 'error'); })
      .finally(() => { if (generation === generationRef.current) setLoadingMore(false); });
  }, [filter, nextCursor, page, loadingMore]);
  return <ProcurementV2InboxContent page={page} state={state} filter={filter} projects={projects}
    onFilterChange={onFilterChange} onOpen={dossier => navigate(`/procurement-v2/demands/${encodeURIComponent(dossier.id)}${location.search}`)}
    onRefresh={() => setRefresh(value => value + 1)} onMore={onMore} loadingMore={loadingMore} />;
};
export default ProcurementV2Inbox;
