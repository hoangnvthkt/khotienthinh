import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Role, type Project } from '../../types';
import { projectMasterService } from '../../lib/projectMasterService';
import { projectV2ReadService, type ProjectV2PlanSummary,
  type ProjectV2WorkspaceSummary } from '../../lib/projectV2/readService';
import { projectV2CommandService } from '../../lib/projectV2/commandService';
import { createProjectV2RequestGate, parseProjectV2Query,
  serializeProjectV2Query, updateProjectV2Query } from '../../lib/projectV2/queryState';
import { ProjectV2Shell } from '../../components/project-v2/ProjectV2Shell';
import { ProjectV2PlanList } from '../../components/project-v2/ProjectV2PlanList';
import { ProjectV2CreatePlanDialog } from '../../components/project-v2/ProjectV2CreatePlanDialog';
import { ProjectV2MaterialPlanDialog } from '../../components/project-v2/ProjectV2MaterialPlanDialog';
import { getProjectV2StatusLabel } from '../../lib/projectV2/presentation';
import type { ProjectV2PlanStatus, ProjectV2PlanType } from '../../types/projectV2';

const typeLabels: Record<ProjectV2PlanType, string> = {
  month: 'Kế hoạch tháng', construction: 'Thi công', material: 'Vật tư',
};
const statusOptions: (ProjectV2PlanStatus | 'all')[] = [
  'all', 'draft', 'pending_approval', 'returned', 'approved', 'superseded', 'cancelled',
];
const PAGE_SIZE = 10;

function isInPeriod(plan: ProjectV2PlanSummary, month: string) {
  if (!month) return true;
  const first = `${month}-01`;
  const last = new Date(`${month}-01T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  return plan.periodStart <= last.toISOString().slice(0, 10) && plan.periodEnd >= first;
}

function currentWeekRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
}

function Metric({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
    {note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
  </div>;
}

const ProjectV2Workspace: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, users, hrmConstructionSites } = useApp();
  const isAdmin = user.role === Role.ADMIN;
  const query = useMemo(() => parseProjectV2Query(location.search), [location.search]);
  const requestGate = useRef(createProjectV2RequestGate());
  const [workspaces, setWorkspaces] = useState<ProjectV2WorkspaceSummary[] | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [plans, setPlans] = useState<ProjectV2PlanSummary[] | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [enrollmentProjects, setEnrollmentProjects] = useState<Project[]>([]);
  const [enrollmentSearch, setEnrollmentSearch] = useState('');
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentProjectId, setEnrollmentProjectId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const changeQuery = useCallback((patch: Partial<typeof query>) => {
    const next = updateProjectV2Query(query, patch);
    navigate({ pathname: '/project-v2', search: serializeProjectV2Query(next) });
  }, [navigate, query]);

  useEffect(() => {
    let active = true;
    setWorkspaceError(null);
    projectV2ReadService.listWorkspaces().then(data => {
      if (active) setWorkspaces(data.workspaces);
    }).catch(error => {
      if (active) setWorkspaceError(error instanceof Error ? error.message : 'Không tải được dự án V2');
    });
    return () => { active = false; };
  }, [refresh]);

  const selected = useMemo(() => workspaces?.find(item => item.projectId === query.projectId)
    ?? (query.projectId ? null : workspaces?.[0] ?? null), [workspaces, query.projectId]);

  useEffect(() => {
    if (selected && selected.projectId !== query.projectId) {
      navigate({ pathname: '/project-v2', search: serializeProjectV2Query({ ...query,
        projectId: selected.projectId }) }, { replace: true });
    }
  }, [navigate, query, selected]);

  useEffect(() => {
    const generation = requestGate.current.next();
    if (!selected) { setPlans(null); setCapabilities(null); return; }
    setPlans(null); setPlanError(null);
    (async () => {
      const collected: ProjectV2PlanSummary[] = [];
      let cursor: { createdAt: string; id: string } | null = null;
      let snapshotToken: string | null = null;
      let firstCapabilities: Record<string, unknown> | null = null;
      for (let page = 0; page < 100; page++) {
        const result = await projectV2ReadService.listPlans({ workspaceId: selected.id,
          planType: null, status: null, limit: 100, cursor, snapshotToken });
        if (!requestGate.current.isCurrent(generation)) return;
        if (firstCapabilities === null) firstCapabilities = result.capabilities;
        collected.push(...result.plans);
        if (!result.nextCursor) {
          setPlans(collected); setCapabilities(firstCapabilities); return;
        }
        cursor = result.nextCursor; snapshotToken = result.snapshotToken;
      }
      throw new Error('PROJECT_V2_RESULT_LIMIT');
    })().catch(error => {
      if (requestGate.current.isCurrent(generation)) {
        setPlanError(error instanceof Error ? error.message : 'Không tải được kế hoạch');
      }
    });
    return () => { requestGate.current.next(); };
  }, [selected?.id, refresh]);

  useEffect(() => {
    if (!isAdmin || workspaces === null || workspaces.length > 0) return;
    let active = true;
    setEnrollmentLoading(true);
    projectMasterService.listPage({ page: 1, pageSize: 100, query: enrollmentSearch }).then(data => {
      if (active) { setEnrollmentProjects(data.rows); setEnrollmentError(null); }
    }).catch(error => {
      if (active) setEnrollmentError(error instanceof Error ? error.message : 'Không tải được dự án');
    }).finally(() => { if (active) setEnrollmentLoading(false); });
    return () => { active = false; };
  }, [isAdmin, workspaces, enrollmentSearch]);

  const ownerNames = useMemo(() => Object.fromEntries(users.map(item => [item.id, item.name])), [users]);
  const filtered = useMemo(() => {
    if (!plans) return [];
    const keyword = query.search.toLocaleLowerCase('vi');
    const rows = plans.filter(plan => plan.planType === query.planType
      && (query.status === 'all' || plan.status === query.status)
      && (!keyword || `${plan.code} ${plan.title}`.toLocaleLowerCase('vi').includes(keyword))
      && isInPeriod(plan, query.period));
    rows.sort((a, b) => query.sort === 'code' ? a.code.localeCompare(b.code, 'vi')
      : query.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
        : b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return rows;
  }, [plans, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shownPage = Math.min(query.page, pageCount);
  const visible = filtered.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE);
  const month = new Date().toISOString().slice(0, 7);
  const [weekStart, weekEnd] = currentWeekRange();
  const pending = plans?.filter(plan => plan.status === 'pending_approval'
    && plan.creatorUserId !== user.id && plan.submitterUserId !== user.id
    && (capabilities?.[plan.planType] as Record<string, unknown> | undefined)?.approve === true) ?? [];
  const approvedMonth = plans?.filter(plan => plan.planType === 'month'
    && plan.status === 'approved' && isInPeriod(plan, month)).length;
  const currentWeek = plans?.filter(plan => plan.planType === 'construction'
    && plan.status === 'approved' && plan.periodStart <= weekEnd && plan.periodEnd >= weekStart).length;
  const selectedEnrollmentProject = enrollmentProjects.find(project => project.id === enrollmentProjectId);

  const enroll = async () => {
    if (!selectedEnrollmentProject || enrolling) return;
    setEnrolling(true); setEnrollmentError(null);
    try {
      await projectV2CommandService.activateWorkspace({ projectId: selectedEnrollmentProject.id,
        primaryConstructionSiteId: selectedEnrollmentProject.constructionSiteId ?? null,
        idempotencyKey: crypto.randomUUID() });
      setRefresh(value => value + 1);
      changeQuery({ projectId: selectedEnrollmentProject.id });
    } catch (error) {
      setEnrollmentError(error instanceof Error ? error.message : 'Không kích hoạt được dự án');
    } finally { setEnrolling(false); }
  };

  if (workspaceError) return <main className="mx-auto max-w-3xl px-4 py-12">
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
      <AlertCircle className="mb-3" aria-hidden="true" /><h1 className="font-semibold">Không tải được không gian Dự án V2</h1>
      <p className="mt-1 text-sm">{workspaceError}</p>
      <button className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold" onClick={() => setRefresh(value => value + 1)}>Thử lại</button>
    </div></main>;
  if (workspaces === null) return <main className="flex min-h-[40vh] items-center justify-center gap-2 text-slate-600">
    <Loader2 className="animate-spin" aria-hidden="true" /> Đang tải không gian dự án…</main>;
  if (!workspaces.length) return <main className="mx-auto max-w-2xl px-4 py-10">
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Dự án V2</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">Chưa có dự án thử nghiệm</h1>
      {isAdmin ? <>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Chọn một dự án hiện có để mở không gian lập kế hoạch V2. Dự án chỉ tham gia sau khi anh xác nhận.</p>
        <input aria-label="Tìm dự án hiện có" value={enrollmentSearch}
          onChange={event => setEnrollmentSearch(event.target.value)} placeholder="Tìm theo mã hoặc tên dự án"
          className="mt-5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm dark:border-slate-600 dark:bg-slate-800" />
        <label htmlFor="project-v2-enroll" className="mt-6 block text-sm font-semibold text-slate-800 dark:text-slate-100">Dự án hiện có</label>
        <select id="project-v2-enroll" value={enrollmentProjectId} onChange={event => setEnrollmentProjectId(event.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm dark:border-slate-600 dark:bg-slate-800">
          <option value="">Chọn dự án</option>{enrollmentProjects.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
        </select>
        {enrollmentLoading && <p className="mt-2 text-xs text-slate-500">Đang tìm dự án…</p>}
        {!enrollmentLoading && !enrollmentProjects.length && !enrollmentError && <p className="mt-2 text-xs text-slate-500">Không có dự án phù hợp. Thử mã hoặc tên khác.</p>}
        {selectedEnrollmentProject && <p className="mt-2 text-xs text-slate-500">Công trường: {hrmConstructionSites.find(site => site.id === selectedEnrollmentProject.constructionSiteId)?.name ?? 'Chưa liên kết'}</p>}
        {enrollmentError && <p role="alert" className="mt-3 text-sm text-red-700">{enrollmentError}</p>}
        <button type="button" disabled={!selectedEnrollmentProject || enrolling} onClick={enroll}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
          {enrolling && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          Đưa dự án thử nghiệm vào V2</button>
      </> : <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Anh chưa được cấp quyền vào dự án V2. Liên hệ quản trị dự án để được thêm vào không gian phù hợp.</p>}
    </div></main>;
  if (!selected) return <main className="mx-auto max-w-3xl px-4 py-12" role="alert">
    <h1 className="text-xl font-bold">Không tìm thấy dự án V2 này</h1>
    <p className="mt-2 text-sm text-slate-600">Dự án có thể chưa tham gia V2 hoặc anh chưa có quyền xem.</p>
  </main>;

  return <ProjectV2Shell projectName={selected.projectName} projectCode={selected.projectCode}
    clientName={selected.clientName} siteName={selected.siteName}
    planType={query.planType}
    primaryAction={<button type="button" disabled={
      (capabilities?.[query.planType] as Record<string, unknown> | undefined)?.create !== true}
      onClick={() => setCreating(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
      <Plus size={17} aria-hidden="true" /> Tạo {typeLabels[query.planType].toLowerCase()}</button>}>
    {creating && query.planType !== 'material' && <ProjectV2CreatePlanDialog key={`${selected.id}:${query.planType}`}
      workspaceId={selected.id} type={query.planType}
      canUseBaselineException={(capabilities?.construction as Record<string, unknown> | undefined)?.baselineException === true}
      onClose={() => setCreating(false)}
      onCreated={planId => { setCreating(false); navigate(`/project-v2/plans/${planId}`); }} />}
    {creating && query.planType === 'material' && <ProjectV2MaterialPlanDialog key={`${selected.id}:material`}
      workspaceId={selected.id} projectId={selected.projectId}
      siteId={selected.primaryConstructionSiteId} siteName={selected.siteName ?? 'Công trường'}
      onClose={() => setCreating(false)} onSaved={planId => { setCreating(false); navigate(`/project-v2/plans/${planId}`); }} />}
    {workspaces.length > 1 && <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Dự án
      <select value={selected.projectId} onChange={event => changeQuery({ projectId: event.target.value })}
        className="ml-3 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
        {workspaces.map(item => <option key={item.id} value={item.projectId}>{item.projectName}</option>)}
      </select></label>}
    {planError ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      Không tải được kế hoạch: {planError}<button className="ml-3 font-semibold underline" onClick={() => setRefresh(value => value + 1)}>Thử lại</button>
    </div> : plans === null ? <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Đang tải kế hoạch…</div> : <>
      <section aria-label="Chỉ số kế hoạch" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Cần anh xem" value={pending.length} note="Kế hoạch chờ duyệt phù hợp quyền" />
        <Metric label="Tháng hiện tại đã duyệt" value={approvedMonth ?? '—'} note="Kế hoạch tháng" />
        <Metric label="Thi công tuần này" value={currentWeek ?? '—'} note="Kế hoạch đã duyệt" />
        <Metric label="Hồ sơ sang Mua hàng" value="—" note="Chờ kết nối dữ liệu Mua hàng" />
      </section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 space-y-4" aria-label="Danh sách kế hoạch">
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Loại kế hoạch">
            {(['month', 'construction', 'material'] as const).map(type => <button key={type} type="button" role="tab"
              aria-selected={query.planType === type} onClick={() => changeQuery({ planType: type })}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${query.planType === type
                ? 'bg-teal-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200'}`}>
              {typeLabels[type]}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <input aria-label="Tìm kế hoạch" value={query.search} onChange={event => changeQuery({ search: event.target.value })}
              placeholder="Tìm mã hoặc tên" className="col-span-2 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 xl:col-span-1" />
            <select aria-label="Trạng thái" value={query.status} onChange={event => changeQuery({ status: event.target.value as typeof query.status })}
              className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
              {statusOptions.map(value => <option key={value} value={value}>{value === 'all' ? 'Mọi trạng thái' : getProjectV2StatusLabel(value)}</option>)}
            </select>
            <input aria-label="Tháng" type="month" value={query.period} onChange={event => changeQuery({ period: event.target.value })}
              className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
            <select aria-label="Sắp xếp" value={query.sort} onChange={event => changeQuery({ sort: event.target.value as typeof query.sort })}
              className="col-span-2 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 xl:col-span-1">
              <option value="newest">Mới nhất</option><option value="oldest">Cũ nhất</option><option value="code">Theo mã</option>
            </select>
          </div>
          <p className="text-xs text-slate-500">{filtered.length} kế hoạch phù hợp</p>
          <ProjectV2PlanList plans={visible} ownerNames={ownerNames} />
          {pageCount > 1 && <div className="flex items-center justify-between text-sm text-slate-600">
            <button type="button" disabled={shownPage <= 1} onClick={() => changeQuery({ page: shownPage - 1 })} className="rounded-lg border px-3 py-2 disabled:opacity-40">Trang trước</button>
            <span>Trang {shownPage}/{pageCount}</span>
            <button type="button" disabled={shownPage >= pageCount} onClick={() => changeQuery({ page: shownPage + 1 })} className="rounded-lg border px-3 py-2 disabled:opacity-40">Trang sau</button>
          </div>}
        </section>
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-semibold text-slate-900 dark:text-white">Cần anh xem</h2>
          {pending.length ? <ul className="mt-3 space-y-2">{pending.slice(0, 5).map(plan => <li key={plan.id}>
            <a href={`/project-v2/plans/${plan.id}`} className="flex items-start justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-800 hover:text-teal-700 dark:bg-slate-800 dark:text-slate-100">
              <span className="min-w-0 break-words">{plan.title}</span><ArrowRight size={15} className="shrink-0" aria-hidden="true" />
            </a></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Hiện không có kế hoạch chờ anh duyệt.</p>}
        </aside>
      </div>
      <button type="button" onClick={() => setRefresh(value => value + 1)} className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-teal-700">
        <RefreshCw size={14} aria-hidden="true" /> Cập nhật dữ liệu</button>
    </>}
  </ProjectV2Shell>;
};

export default ProjectV2Workspace;
