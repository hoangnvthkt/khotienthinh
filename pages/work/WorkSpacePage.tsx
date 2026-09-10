import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Plus, RefreshCw, Search, Settings, Users } from "lucide-react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useWorkTasks } from "../../hooks/work/useWorkTasks";
import { canAccessRoute } from "../../lib/routeAccess";
import { supabase } from "../../lib/supabase";
import { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import { createWorkConfigurationService, type WorkConfigurationService } from "../../lib/work/workConfigurationService";
import { createWorkTaskService, type WorkTaskService } from "../../lib/work/workTaskService";
import { subscribeWorkInvalidation } from "../../lib/work/workRealtime";
import { createWorkWorkspacePeopleService, type WorkWorkspacePeopleService } from "../../lib/work/workWorkspacePeopleService";
import { createWorkWorkspaceService, type WorkWorkspaceService } from "../../lib/work/workWorkspaceService";
import type { WorkTaskFilters, WorkTaskStatus } from "../../lib/work/workTypes";
import type { WorkspaceSummary } from "../../lib/work/workWorkspaceTypes";
import { workError } from "../../lib/work/workForm";
import { workStatusLabels } from "../../lib/work/workPresentation";
import { WorkCreateDrawer } from "./WorkCreateDrawer";
import { WorkSpaceMembers } from "./WorkSpaceMembers";
import { WorkSpaceSettings } from "./WorkSpaceSettings";
import { workspaceTabRoute, type WorkspaceTab } from "./workspaceManagement";
import { workspaceCover, workspaceKindLabel } from "./workspacePresentation";
import "./work.css";
import "./workspace.css";

const workspaceService = createWorkWorkspaceService(supabase);
const peopleService = createWorkWorkspacePeopleService(supabase);
const taskService = createWorkTaskService(supabase);
const attachmentService = createWorkAttachmentService(supabase);
const configurationService = createWorkConfigurationService(supabase);
const priorityLabels = { normal: "Bình thường", important: "Quan trọng", urgent: "Khẩn cấp" };

function currentTab(pathname: string): WorkspaceTab {
  if (pathname.endsWith("/members")) return "members";
  if (pathname.endsWith("/settings")) return "settings";
  return "tasks";
}

function WorkSpaceTasks({ workspace, actorId, service, attachments, accessRevision }: {
  workspace: WorkspaceSummary;
  actorId: string;
  service: WorkTaskService;
  attachments: ReturnType<typeof createWorkAttachmentService>;
  accessRevision: number;
}) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState("");
  const status = params.get("status");
  const priority = params.get("priority");
  const filters: WorkTaskFilters = {
    ...(params.get("q") ? { search: params.get("q")! } : {}),
    ...(status && status in workStatusLabels ? { status: [status as WorkTaskStatus] } : {}),
    ...(priority && priority in priorityLabels ? { priority: [priority as keyof typeof priorityLabels] } : {}),
  };
  const list = useWorkTasks(service, actorId, "assigned_to_me", filters, true, workspace.id, accessRevision);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (search.trim()) next.set("q", search.trim()); else next.delete("q");
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, params.toString()]);
  const filter = (name: string, value: string) => setParams((old) => { const next = new URLSearchParams(old); if (value) next.set(name, value); else next.delete(name); return next; });
  const taskQuery = () => {
    const next = new URLSearchParams(params);
    next.set("workspace", workspace.id);
    return next.toString();
  };
  return <section className="work-space-panel" aria-labelledby="workspace-tasks-title">
    <div className="work-panel-heading"><div><h2 id="workspace-tasks-title">Hoạt động công việc</h2><p>Tất cả công việc chuẩn mà anh/chị được phép xem trong Workspace.</p></div>
      {workspace.capabilities.canCreateTask && workspace.status === "active" && <button className="work-home-primary" onClick={() => setDrawer(true)}><Plus size={17} /> Tạo công việc</button>}
    </div>
    {notice && <p className="work-success" role="status">{notice}</p>}
    <div className="work-toolbar">
      <label className="work-search"><Search size={17} /><input aria-label="Tìm công việc trong Workspace" placeholder="Tìm mã hoặc nội dung…" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} /></label>
      <select className="work-input" aria-label="Lọc trạng thái" value={status || ""} onChange={(event) => filter("status", event.target.value)}><option value="">Mọi trạng thái</option>{Object.entries(workStatusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <select className="work-input" aria-label="Lọc mức độ" value={priority || ""} onChange={(event) => filter("priority", event.target.value)}><option value="">Mọi mức độ</option>{Object.entries(priorityLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <button className="work-secondary" aria-label="Làm mới công việc" disabled={list.loading} onClick={() => void list.refresh()}><RefreshCw size={17} /></button>
    </div>
    {list.error && <p className="work-error" role="alert">{workError(list.error)} <button onClick={() => void list.refresh()}>Thử lại</button></p>}
    {list.loading && !list.items.length ? <div className="work-empty" role="status">Đang tải công việc…</div> : !list.items.length && !list.error ? <div className="work-empty"><ClipboardList size={34} /><h3>Không gian chưa có công việc</h3><p>Tạo công việc đầu tiên để bắt đầu phối hợp.</p></div> : <ul className="work-task-list">
      {list.items.map((task) => <li key={task.id}><Link to={`/work/tasks/${encodeURIComponent(task.task_code)}?${taskQuery()}`} state={{ workspaceId: workspace.id, workspaceName: workspace.name }}>
        <div className="work-task-main"><span className="work-code">{task.task_code}</span><h2>{task.title}</h2><span className="work-scope">{workspace.name}{task.privacy === "restricted" ? " · Hạn chế" : ""}</span><span className={`work-priority-inline priority-${task.priority}`}>{priorityLabels[task.priority]}</span></div>
        <span className={`work-status status-${task.status}`}>{workStatusLabels[task.status]}</span><span className={`work-priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span><time dateTime={task.deadline_at || undefined}>{task.deadline_at ? new Date(task.deadline_at).toLocaleString("vi-VN") : "Chưa có deadline"}</time>
      </Link></li>)}
    </ul>}
    {list.cursor && <button className="work-space-more" disabled={list.loading} onClick={() => void list.loadMore()}>{list.loading ? "Đang tải…" : "Xem thêm công việc"}</button>}
    {drawer && <WorkCreateDrawer service={service} attachments={attachments} initialScope={{ type: "workspace", workspaceId: workspace.id }} lockScope scopeLabels={{ [`workspace:${workspace.id}`]: workspace.name }} onClose={() => setDrawer(false)} onCreated={(result) => { setNotice(`Đã tạo ${result.taskCode} trong ${workspace.name}.`); void list.refresh(); }} />}
  </section>;
}

export function WorkSpaceWorkspace({
  actorId,
  workspaceId,
  workspaceService: service,
  peopleService: people,
  taskService: tasks,
  attachments,
  configurationService: configuration = configurationService,
  subscribe,
}: {
  actorId: string;
  workspaceId: string;
  workspaceService: WorkWorkspaceService;
  peopleService: WorkWorkspacePeopleService;
  taskService: WorkTaskService;
  attachments: ReturnType<typeof createWorkAttachmentService>;
  configurationService?: WorkConfigurationService;
  subscribe?: (invalidate: () => void) => () => void;
}) {
  const location = useLocation();
  const tab = currentTab(location.pathname);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const live = useRef(true);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await service.get(workspaceId);
      if (live.current) { setWorkspace(result); setRevision((value) => value + 1); }
      void service.setPreference(workspaceId, null, true).catch(() => undefined);
    } catch (nextError) { if (live.current) setError(nextError); }
    finally { if (live.current) setLoading(false); }
  }, [service, workspaceId, actorId]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, [load]);
  useEffect(() => subscribe?.(() => void load()), [subscribe, load]);
  if (loading && !workspace) return <main className="work-home"><div className="work-space-skeleton" role="status" aria-label="Đang tải Workspace" /></main>;
  if (error || !workspace) return <main className="work-home"><div className="work-space-error" role="alert"><p>{workError(error)}</p><button onClick={() => void load()}>Thử lại</button><Link to="/work">Quay lại dashboard</Link></div></main>;
  const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof ClipboardList; visible: boolean }> = [
    { id: "tasks", label: "Công việc", icon: ClipboardList, visible: true },
    { id: "members", label: "Thành viên", icon: Users, visible: true },
    { id: "settings", label: "Cấu hình", icon: Settings, visible: workspace.capabilities.canConfigure || workspace.capabilities.canArchive },
  ];
  return <main className="work-home work-space-manage">
    <Link className="work-space-preview-back" to="/work">← Tất cả không gian</Link>
    <header className="work-space-manage-hero"><img src={workspaceCover(workspace.kind)} alt="" /><div><p>{workspaceKindLabel[workspace.kind]} · {workspace.sourceName || "Không gian độc lập"}</p><h1>{workspace.name}</h1><span>{workspace.memberCount} thành viên · {workspace.visibleOpenTaskCount} việc đang mở</span></div><strong>{workspace.status === "archived" ? "Đã lưu trữ · chỉ đọc" : workspace.capabilities.canManageMembers ? "Quản trị viên" : "Thành viên"}</strong></header>
    <nav className="work-space-tabs" aria-label="Khu vực Workspace">{tabs.filter((item) => item.visible).map((item) => { const Icon = item.icon; return <Link key={item.id} aria-current={tab === item.id ? "page" : undefined} to={workspaceTabRoute(workspace.id, item.id)}><Icon size={17} />{item.label}</Link>; })}</nav>
    {tab === "tasks" && <WorkSpaceTasks workspace={workspace} actorId={actorId} service={tasks} attachments={attachments} accessRevision={revision} />}
    {tab === "members" && <WorkSpaceMembers workspace={workspace} workspaceService={service} peopleService={people} changed={() => void load()} />}
    {tab === "settings" && <WorkSpaceSettings workspace={workspace} actorId={actorId} workspaceService={service} configurationService={configuration} changed={(updated) => setWorkspace(updated)} />}
  </main>;
}

export default function WorkSpacePage() {
  const { user, refreshProfile } = useAuth();
  const { workspaceId = "" } = useParams();
  const location = useLocation();
  const subscribe = useMemo(() => {
    if (!user) return undefined;
    return (invalidate: () => void) => subscribeWorkInvalidation(
      supabase,
      (event) => {
        if (event.reason === "access_revision") void refreshProfile().catch(() => undefined);
        invalidate();
      },
      { actorId: user.id },
    );
  }, [user?.id, refreshProfile]);
  if (!user || !canAccessRoute(user, location.pathname)) return <Navigate to="/" replace />;
  return <WorkSpaceWorkspace actorId={user.id} workspaceId={workspaceId} workspaceService={workspaceService} peopleService={peopleService} taskService={taskService} attachments={attachmentService} subscribe={subscribe} />;
}
