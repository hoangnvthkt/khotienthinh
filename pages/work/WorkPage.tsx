import { workScrollHost } from "../../lib/work/workScroll";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Plus,
  LayoutList,
  MessageSquare,
  Search,
  RefreshCw,
  Copy,
  ArrowLeft,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { canAccessRoute } from "../../lib/routeAccess";
import {
  createWorkTaskService,
  type WorkTaskService,
  type WorkCloneForm,
  type WorkOption,
} from "../../lib/work/workTaskService";
import { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import { subscribeWorkInvalidation } from "../../lib/work/workRealtime";
import {
  documentText,
  scopeFromKey,
  localDeadline,
  workError,
} from "../../lib/work/workForm";
import type {
  WorkTaskDetail,
  WorkTaskFilters,
  WorkTaskStatus,
  WorkTaskView,
} from "../../lib/work/workTypes";
import { useWorkTasks } from "../../hooks/work/useWorkTasks";
import { WorkCreateDrawer } from "./WorkCreateDrawer";
import { WorkPicker } from "./WorkPicker";
import "./work.css";
import "./workTaskDetail.css";
import { workDueInfo, workLevelLabels, workLevelOf, workStatusLabels, workUpdateInfo } from "../../lib/work/workPresentation";
import { createWorkBoardService, type WorkBoardService } from "../../lib/work/workBoardService";
import { createWorkGoalService, type WorkGoalService } from "../../lib/work/workGoals";
import { workAi as defaultWorkAi, type WorkAiService } from "../../lib/work/workAi";
import { WorkQuickAssign } from "./WorkQuickAssign";
import { WorkMyBoard } from "./WorkMyBoard";
import { WorkTeamBoard } from "./WorkTeamBoard";
import { WorkCompanyBoard } from "./WorkCompanyBoard";
import type { WorkBoardAccess } from "../../lib/work/workBoardService";
import { canPerform } from "../../lib/permissions/permissionService";
import { WorkDetail } from "./WorkDetail";
import { WorkMutationSession } from "../../lib/work/workMutation";
import type { WorkUploadState } from "./WorkAttachments";
import { workspaceTabRoute } from "./workspaceManagement";
const taskService = createWorkTaskService(supabase),
  attachmentService = createWorkAttachmentService(supabase),
  boardService = createWorkBoardService(supabase),
  goalService = createWorkGoalService(supabase);
const views: { id: WorkTaskView; label: string }[] = [
  { id: "assigned_to_me", label: "Được giao" },
  { id: "created_by_me", label: "Tôi đã giao" },
  { id: "following", label: "Tôi theo dõi" },
  { id: "pinned", label: "Đã ghim" },
];
/** Đợt 1: mức A / B / C (A = urgent, B = important, C = normal). */
const priorities = workLevelLabels;
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(iso))
    : "Chưa có deadline";
export interface WorkWorkspaceProps {
  actorId: string;
  service: WorkTaskService;
  attachments: ReturnType<typeof createWorkAttachmentService>;
  subscribe?: (invalidate: () => void) => () => void;
  /** Đợt 1: Giao nhanh, tóm tắt việc, dòng cập nhật. */
  board?: WorkBoardService;
  actorName?: string;
  canQuickAssign?: boolean;
  /** Đợt 1 PR-3: nháp AI (giao nhanh, biên bản, viết giúp cập nhật, tóm tắt). null = tắt. */
  ai?: WorkAiService | null;
  /** Đợt 2 PR-6: mục tiêu, chốt kỳ, lịch chốt. */
  goals?: WorkGoalService;
}
export function WorkWorkspace({
  actorId,
  service,
  attachments,
  subscribe,
  board = boardService,
  actorName = "Bạn",
  canQuickAssign = false,
  ai = defaultWorkAi,
  goals = goalService,
}: WorkWorkspaceProps) {
  const { taskCode } = useParams();
  const routeLocation = useLocation();
  const mutation = useRef(new WorkMutationSession());
  const uploadStates = useRef(new Map<string, WorkUploadState>());
  const listScroll = useRef(0);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        mutation.current.pending ||
        [...uploadStates.current.values()].some((s) =>
          s.items.some((i) => !i.ready),
        )
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const listSearch = useRef("");
  const [revision, setRevision] = useState(0);
  const [params, setParams] = useSearchParams();
  const workspaceContextId = params.get("workspace") || undefined;
  const requested = params.get("view");
  const view = views.some((v) => v.id === requested)
    ? (requested as WorkTaskView)
    : "assigned_to_me";
  const [search, setSearch] = useState(params.get("q") || ""),
    [scopes, setScopes] = useState<WorkOption[]>([]),
    [drawer, setDrawer] = useState<{ clone?: WorkCloneForm } | null>(null),
    [notice, setNotice] = useState(""),
    [createError, setCreateError] = useState<unknown>(null);
  const queryCreateOpened = useRef(false);
  const [detail, setDetail] = useState<{
    ref: string;
    data: WorkTaskDetail | null;
    error: unknown;
    loading: boolean;
  }>({ ref: "", data: null, error: null, loading: false });
  const status = params.get("status");
  const priority = params.get("priority");
  const filters: WorkTaskFilters = {
    ...(params.get("q") ? { search: params.get("q")! } : {}),
    ...(status && status in workStatusLabels
      ? { status: [status as WorkTaskStatus] }
      : {}),
    ...(priority && priority in priorities
      ? { priority: [priority as keyof typeof priorities] }
      : {}),
    ...(!workspaceContextId && params.get("scope")
      ? { scope: scopeFromKey(params.get("scope")!) }
      : {}),
    ...(params.get("deadlineFrom")
      ? { deadlineFrom: params.get("deadlineFrom")! }
      : {}),
    ...(params.get("deadlineTo")
      ? { deadlineTo: params.get("deadlineTo")! }
      : {}),
  };
  const list = useWorkTasks(
    service,
    actorId,
    view,
    filters,
    true,
    workspaceContextId,
  );
  // Việc của tôi (mockup v1): tab "Được giao" khi không tìm / lọc → bảng nhóm theo hạn; "Tìm & lọc" (mode=list) về danh sách cũ.
  // Phòng tôi / Toàn công ty (PR-4): tab theo quyền (trưởng đơn vị theo sơ đồ tổ chức · xem toàn công ty).
  const [access, setAccess] = useState<WorkBoardAccess | null>(null);
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    if (workspaceContextId || typeof board.boardAccess !== "function") return;
    let live = true;
    board.boardAccess().then((a) => { if (live) setAccess(a); }, () => { if (live) setAccess(null); });
    return () => { live = false; };
  }, [board, workspaceContextId, accessTick]);
  const requestedSpace = params.get("space");
  // Link bản tin kỳ (PR-7): ?space=…&from=…&to=…&report=1[&unit=…] — chỉ đọc lúc mở bảng.
  const boardLink = useMemo(() => (params.get("from") || params.get("report")
    ? { from: params.get("from"), to: params.get("to"), report: params.get("report") === "1", unit: params.get("unit") } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestedSpace]);
  const space = !taskCode && !workspaceContextId && access
    // BLĐ không làm trưởng đơn vị nào vẫn mở được "Phòng tôi" của một đơn vị qua link (?space=team&unit=…): máy chủ cho BLĐ xem mọi đơn vị.
    ? (requestedSpace === "team" && (access.myUnits.length || (access.company && params.get("unit"))) ? "team"
      : requestedSpace === "company" && access.company ? "company" : null) : null;
  const [preset, setPreset] = useState<{ assigneeId?: string; meeting?: boolean; nonce: number } | null>(null);
  const boardMode = !space && !taskCode && !workspaceContextId && view === "assigned_to_me" && params.get("mode") !== "list"
    && Object.keys(filters).length === 0 && typeof board.myBoard === "function";
  const [boardTick, setBoardTick] = useState(0);
  // Tải lại bảng khi danh sách tải lại (sau lệnh, realtime, quay lại tab) hoặc vừa giao nhanh.
  const boardKey = useMemo(() => ({}), [list.items, boardTick]);
  const detailSeq = useRef(0),
    alive = useRef(true);
  const refNow = useRef(taskCode);
  refNow.current = taskCode;
  const reloadDetail = useCallback(async () => {
    if (!taskCode) return;
    const n = ++detailSeq.current;
    setDetail((old) => ({
      ref: taskCode,
      data: old.ref === taskCode ? old.data : null,
      error: null,
      loading: true,
    }));
    try {
      const data = await service.detail(taskCode);
      if (
        alive.current &&
        n === detailSeq.current &&
        refNow.current === taskCode
      ) {
        setDetail({ ref: taskCode, data, error: null, loading: false });
        setRevision((x) => x + 1);
      }
    } catch (error) {
      if (
        alive.current &&
        n === detailSeq.current &&
        refNow.current === taskCode
      )
        setDetail({ ref: taskCode, data: null, error, loading: false });
    }
  }, [service, taskCode, actorId]);
  const refresh = useRef(() => {});
  refresh.current = () => {
    void list.refresh();
    void reloadDetail();
  };
  useEffect(() => {
    alive.current = true;
    service
      .options("scope", null)
      .then((page) => {
        if (alive.current) setScopes(page.items);
      })
      .catch((e) => {
        if (alive.current) setCreateError(e);
      });
    return () => {
      alive.current = false;
      detailSeq.current++;
    };
  }, [actorId, service]);
  useEffect(() => {
    if (params.get("create") === "1" && scopes.length > 0 && !queryCreateOpened.current) {
      queryCreateOpened.current = true;
      setDrawer({});
    }
  }, [params, scopes.length]);
  useEffect(() => {
    void reloadDetail();
    return () => {
      detailSeq.current++;
    };
  }, [reloadDetail]);
  useEffect(() => subscribe?.(() => refresh.current()), [subscribe]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (search.trim()) next.set("q", search.trim());
      else next.delete("q");
      if (next.toString() !== params.toString())
        setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, params.toString()]);
  useEffect(() => {
    setSearch(params.get("q") || "");
  }, [params.get("q")]);
  const setFilter = (key: string, value: string) => {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };
  async function cloneTask() {
    if (!detail.data) return;
    setCreateError(null);
    const sourceRef = taskCode;
    try {
      const form = await service.clone(detail.data.task.id);
      if (alive.current && refNow.current === sourceRef)
        setDrawer({ clone: form });
    } catch (e) {
      if (alive.current) setCreateError(e);
    }
  }
  const currentDetail = detail.ref === taskCode ? detail : null;
  if (!taskCode) listSearch.current = params.toString();
  const returnSearch =
    (routeLocation.state as { workListSearch?: string } | null)
      ?.workListSearch ??
    (listSearch.current ||
      (() => {
        const p = new URLSearchParams(params);
        p.delete("comment");
        return p.toString();
      })());
  const workspaceSearch = (() => {
    const next = new URLSearchParams(returnSearch);
    next.delete("workspace");
    next.delete("scope");
    next.delete("view");
    return next.toString();
  })();
  const returnTo = workspaceContextId
    ? `${workspaceTabRoute(workspaceContextId, "tasks")}${workspaceSearch ? `?${workspaceSearch}` : ""}`
    : `/work/my${returnSearch ? "?" + returnSearch : ""}`;
  const detailTo = (code: string) => {
    const next = new URLSearchParams(returnSearch);
    if (workspaceContextId) next.set("workspace", workspaceContextId);
    return `/work/tasks/${encodeURIComponent(code)}${next.toString() ? `?${next}` : ""}`;
  };
  const restoredLocation = useRef<string | null>(null);
  useEffect(() => {
    if (!taskCode && !list.loading && restoredLocation.current !== routeLocation.key) {
      restoredLocation.current = routeLocation.key;
      const top =
        (routeLocation.state as { workScroll?: number } | null)?.workScroll ??
        listScroll.current;
      const id = requestAnimationFrame(() =>
        workScrollHost(root.current).scrollTo(0, top),
      );
      return () => cancelAnimationFrame(id);
    }
  }, [taskCode, list.loading, routeLocation.key]);
  return (
    <main className={`work-module${taskCode ? " work-module-detail" : ""}`} ref={root}>
      {!taskCode && !workspaceContextId && access && (access.myUnits.length > 0 || access.company) && (
        <nav className="work-space-switch" aria-label="Phạm vi xem việc">
          {([["", "Việc của tôi", 0], ...(access.myUnits.length ? [["team", "Phòng tôi", access.reviewsWaitingMe]] : []),
            ...(access.company ? [["company", "Toàn công ty", access.claimsWaitingMe]] : [])] as Array<[string, string, number]>).map(([id, label, n]) => (
            <button type="button" key={id || "my"} aria-current={(space || "") === id ? "page" : undefined}
              onClick={() => setParams(() => { const next = new URLSearchParams(); if (id) next.set("space", id); return next; })}
              title={id === "team" && n ? `${n} việc chờ bạn duyệt` : id === "company" && n ? `${n} việc giao miệng chờ bạn xác nhận` : undefined}>
              {label}{n > 0 && <span className="work-space-badge">{n}</span>}
            </button>
          ))}
        </nav>
      )}
      {!boardMode && !space && <header className="work-heading">
        <div>
          <p className="work-eyebrow">VIOO WORK</p>
          <h1>{taskCode ? "Công việc" : "Công việc của tôi"}</h1>
          <p>Theo dõi trách nhiệm, phối hợp và hoàn thành công việc.</p>
        </div>
        {scopes.length > 0 && (
          <button className="work-primary" onClick={() => setDrawer({})}>
            <Plus size={18} />
            Tạo công việc
          </button>
        )}
      </header>}
      {notice && (
        <div className="work-success" role="status">
          {notice}
          <button aria-label="Đóng thông báo" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {createError && (
        <p className="work-error" role="alert">
          {workError(createError)}{" "}
          <button
            onClick={() => {
              setCreateError(null);
              service
                .options("scope", null)
                .then((p) => setScopes(p.items))
                .catch(setCreateError);
            }}
          >
            Thử lại
          </button>
        </p>
      )}
      {taskCode ? (
        <div className="work-master-detail">
          <aside className="work-task-rail" aria-label="Danh sách công việc">
            <header className="work-rail-heading">
              <strong>{views.find((item) => item.id === view)?.label}</strong>
              <span>{list.items.length}</span>
            </header>
            <label className="work-rail-search">
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="Tìm trong danh sách công việc"
                placeholder="Tìm công việc"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={200}
              />
            </label>
            <nav className="work-rail-tabs" aria-label="Đổi danh sách công việc">
              {views.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  aria-current={item.id === view ? "page" : undefined}
                  onClick={() => setFilter("view", item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="work-rail-scroll">
              {list.items.map((t) => (
                <Link
                  key={t.id}
                  aria-current={t.task_code === taskCode ? "page" : undefined}
                  to={detailTo(t.task_code)}
                  state={{
                    workListSearch: returnSearch,
                    workScroll: listScroll.current,
                  }}
                >
                  <span className={`work-rail-state status-${t.status}`} aria-hidden="true" />
                  <span className="work-rail-task">
                    <strong>{t.title}</strong>
                    <span className="work-rail-meta">
                      <span className="work-rail-scope">
                        {t.scope_type === "direct" ? "Trực tiếp" : t.scope_type === "department" ? "Phòng ban" : t.scope_type === "workspace" ? "Workspace" : "Dự án"}
                      </span>
                      <span className={`work-level-chip level-${workLevelOf(t.priority)}`} title={priorities[t.priority]}>{workLevelOf(t.priority)}</span>
                      <time dateTime={t.deadline_at || undefined}>{when(t.deadline_at)}</time>
                    </span>
                    <span className="work-rail-progress" aria-label={`Tiến độ ${t.progress_percent}%`}>
                      <span><i style={{ width: `${t.progress_percent}%` }} /></span>
                      <b>{t.progress_percent}%</b>
                    </span>
                  </span>
                </Link>
              ))}
              {list.error && (
                <button className="work-rail-retry" onClick={() => void list.refresh()}>
                  Thử tải danh sách
                </button>
              )}
              {list.cursor && (
                <button className="work-rail-more" disabled={list.loading} onClick={() => void list.loadMore()}>
                  Xem thêm công việc
                </button>
              )}
            </div>
            <Link className="work-rail-footer" to={returnTo} state={{ workScroll: listScroll.current }}>
              <ArrowLeft size={14} /> Danh sách và bộ lọc
            </Link>
          </aside>
          <section className="work-detail">
            <Link
              className="work-back"
              to={returnTo}
              state={{ workScroll: listScroll.current }}
            >
              <ArrowLeft size={16} />
              {workspaceContextId ? "Không gian làm việc" : "Công việc của tôi"}
            </Link>
            {(!currentDetail ||
              (currentDetail.loading && !currentDetail.data)) && (
              <p role="status">Đang tải công việc…</p>
            )}
            {currentDetail?.error && (
              <div role="alert">
                <p>{workError(currentDetail.error)}</p>
                <button
                  className="work-secondary"
                  onClick={() => void reloadDetail()}
                >
                  Thử lại
                </button>
              </div>
            )}
            {currentDetail?.data && (
              <>
                <WorkDetail
                  key={currentDetail.data.task.id}
                  detail={currentDetail.data}
                  service={service}
                  board={board}
                  ai={ai || undefined}
                  attachments={attachments}
                  actorId={actorId}
                  session={mutation.current}
                  uploads={(() => {
                    const id = currentDetail.data!.task.id;
                    if (!uploadStates.current.has(id))
                      uploadStates.current.set(id, { items: [], busy: false });
                    return uploadStates.current.get(id)!;
                  })()}
                  refresh={() => refresh.current()}
                  revision={revision}
                  anchorId={params.get("comment")}
                  onAnchor={(id) => setFilter("comment", id)}
                  headerActions={
                    <>
                      <button
                        className="work-secondary"
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.search = "";
                          url.hash = `/work/tasks/${encodeURIComponent(currentDetail.data!.task.task_code)}${workspaceContextId ? `?workspace=${encodeURIComponent(workspaceContextId)}` : ""}`;
                          navigator.clipboard
                            .writeText(url.toString())
                            .then(() => setNotice("Đã sao chép liên kết. Người mở vẫn cần quyền xem công việc."))
                            .catch(() => setNotice("Không thể sao chép. Bạn có thể sao chép địa chỉ trên trình duyệt."));
                        }}
                      >
                        <Copy size={15} /> Sao chép link
                      </button>
                      {currentDetail.data.capabilities.canClone && (
                        <button className="work-secondary" onClick={() => void cloneTask()}>
                          Nhân bản
                        </button>
                      )}
                    </>
                  }
                />
              </>
            )}
          </section>
        </div>
      ) : space === "team" && access ? (
        <WorkTeamBoard board={board} service={service} goalsService={goals} ai={ai} access={access} link={boardLink} detailTo={detailTo} onNotice={(m) => { setNotice(m); setAccessTick((v) => v + 1); }}
          onAssignTo={canQuickAssign ? (userId) => setPreset({ assigneeId: userId, nonce: Date.now() }) : undefined} key={`team-${boardTick}`}>
          {canQuickAssign && (<WorkQuickAssign service={service} board={board} ai={ai || undefined} actorName={actorName} preset={preset}
              onCreated={(message) => { setNotice(message); void list.refresh(); setBoardTick((v) => v + 1); setAccessTick((v) => v + 1); }} />)}
        </WorkTeamBoard>
      ) : space === "company" && access ? (
        <WorkCompanyBoard board={board} goalsService={goals} ai={ai} link={boardLink} detailTo={detailTo} onNotice={(m) => { setNotice(m); setAccessTick((v) => v + 1); }} key={`company-${boardTick}`}
          headerActions={canQuickAssign && ai && (
            <button className="work-secondary" onClick={() => setPreset({ meeting: true, nonce: Date.now() })}><MessageSquare size={17} /> Ghi chỉ đạo</button>
          )}>
          {canQuickAssign && (<WorkQuickAssign service={service} board={board} ai={ai || undefined} actorName={actorName} preset={preset}
              onCreated={(message) => { setNotice(message); void list.refresh(); setBoardTick((v) => v + 1); setAccessTick((v) => v + 1); }} />)}
        </WorkCompanyBoard>
      ) : boardMode ? (
        <WorkMyBoard board={board} service={service} refreshKey={boardKey} detailTo={detailTo} onNotice={setNotice}
          headerActions={scopes.length > 0 && (
            <button className="work-secondary" onClick={() => setDrawer({})}><Plus size={18} /> Tạo công việc</button>
          )}>
          {canQuickAssign && !workspaceContextId && (
            <WorkQuickAssign service={service} board={board} ai={ai || undefined} actorName={actorName}
              onCreated={(message) => { setNotice(message); void list.refresh(); setBoardTick((v) => v + 1); }} />
          )}
          <nav className="work-tabs" aria-label="Danh sách công việc">
            {views.map((tab) => (
              <button
                key={tab.id}
                aria-current={tab.id === view ? "page" : undefined}
                onClick={() => setFilter("view", tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <button className="work-tabs-extra" onClick={() => setFilter("mode", "list")} title="Tìm, lọc theo trạng thái, mức, phạm vi, hạn">
              <Search size={15} /> Tìm & lọc
            </button>
          </nav>
        </WorkMyBoard>
      ) : (
        <>
          {canQuickAssign && !workspaceContextId && (
            <WorkQuickAssign service={service} board={board} ai={ai || undefined} actorName={actorName}
              onCreated={(message) => { setNotice(message); void list.refresh(); }} />
          )}
          <nav className="work-tabs" aria-label="Danh sách công việc">
            {views.map((tab) => (
              <button
                key={tab.id}
                aria-current={tab.id === view ? "page" : undefined}
                onClick={() => setFilter("view", tab.id)}
              >
                {tab.label}
              </button>
            ))}
            {!workspaceContextId && view === "assigned_to_me" && (
              <button className="work-tabs-extra" onClick={() => setParams(() => new URLSearchParams())} title="Về bảng Việc của tôi (nhóm theo hạn)">
                <LayoutList size={15} /> Bảng việc của tôi
              </button>
            )}
          </nav>
          <section className="work-toolbar" aria-label="Bộ lọc công việc">
            <label className="work-search">
              <Search size={17} />
              <input
                aria-label="Tìm công việc"
                placeholder="Tìm mã hoặc nội dung công việc…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={200}
              />
            </label>
            <select
              className="work-input"
              aria-label="Lọc trạng thái"
              value={status || ""}
              onChange={(e) => setFilter("status", e.target.value)}
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(workStatusLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="work-input"
              aria-label="Lọc mức độ"
              value={priority || ""}
              onChange={(e) => setFilter("priority", e.target.value)}
            >
              <option value="">Mọi mức độ</option>
              {Object.entries(priorities).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className="work-secondary"
              title="Làm mới danh sách"
              aria-label="Làm mới danh sách"
              onClick={() => void list.refresh()}
              disabled={list.loading}
            >
              <RefreshCw size={17} />
            </button>
          </section>
          <details className="work-extra-filters">
            <summary>Phạm vi và deadline</summary>
            <div className="work-form-grid">
              <WorkPicker
                service={service}
                kind="filter_scope"
                scope={null}
                label="Phạm vi công việc"
                value={params.get("scope") ? [params.get("scope")!] : []}
                multiple={false}
                onChange={(ids) => setFilter("scope", ids[0] || "")}
              />
              {(["deadlineFrom", "deadlineTo"] as const).map((key) => (
                <label className="work-label" key={key}>
                  {key === "deadlineFrom" ? "Deadline từ ngày" : "Đến hết ngày"}
                  <input
                    className="work-input"
                    type="date"
                    value={
                      params.get(key) &&
                      Number.isFinite(Date.parse(params.get(key)!))
                        ? localDeadline(params.get(key)!).slice(0, 10)
                        : ""
                    }
                    onChange={(e) =>
                      setFilter(
                        key,
                        e.target.value
                          ? new Date(
                              e.target.value +
                                (key === "deadlineFrom"
                                  ? "T00:00:00"
                                  : "T23:59:59"),
                            ).toISOString()
                          : "",
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          {list.error && (
            <div role="alert" className="work-error">
              {workError(list.error)}{" "}
              <button onClick={() => void list.refresh()}>Thử lại</button>
            </div>
          )}
          {list.loading && list.items.length === 0 ? (
            <div role="status" className="work-empty">
              Đang tải công việc…
            </div>
          ) : !list.error && !list.items.length ? (
            <div className="work-empty">
              <ClipboardList size={36} />
              <h2>Chưa có công việc phù hợp</h2>
              <p>Đổi bộ lọc hoặc tạo công việc để bắt đầu phối hợp.</p>
            </div>
          ) : (
            <ul className="work-task-list">
              {list.items.map((task) => (
                <li key={task.id}>
                  <Link
                    to={detailTo(task.task_code)}
                    className={`work-level-row level-${workLevelOf(task.priority)}`}
                    state={{
                      workListSearch: params.toString(),
                      workScroll: workScrollHost(root.current).scrollTop,
                    }}
                    onClick={() => {
                      listScroll.current = workScrollHost(
                        root.current,
                      ).scrollTop;
                    }}
                  >
                    <div className="work-task-main">
                      <span className="work-code">
                        <span className={`work-level-chip level-${workLevelOf(task.priority)}`} title={priorities[task.priority]}>{workLevelOf(task.priority)}</span>
                        {task.task_code}
                      </span>
                      <h2>{task.title}</h2>
                      <span className="work-scope">
                        {task.scope_type === "direct"
                          ? "Trực tiếp"
                          : task.scope_type === "department"
                            ? "Phòng ban"
                            : "Dự án"}
                        {task.privacy === "restricted" ? " · Hạn chế" : ""}
                        {(() => {
                          const info = workUpdateInfo(task.last_progress_at, task.status);
                          return info ? <span className={info.stale ? " work-stale" : ""}> · {info.text}</span> : null;
                        })()}
                      </span>
                    </div>
                    <span className={`work-status status-${task.status}`}>
                      {workStatusLabels[task.status]}
                      {typeof task.assignment_count === "number" && (
                        <small className="work-ack">
                          {task.acknowledged_count}/{task.assignment_count} đã
                          nhận
                        </small>
                      )}
                    </span>
                    <span className="work-row-progress" aria-label={`Tiến độ ${task.progress_percent}%`}>
                      <span><i style={{ width: `${task.progress_percent}%` }} /></span>
                      <b>{task.progress_percent}%</b>
                    </span>
                    {(() => {
                      const due = workDueInfo(task.deadline_at, task.status);
                      return (
                        <time dateTime={task.deadline_at || undefined} className={`work-due tone-${due.tone}`}>
                          {due.text}
                        </time>
                      );
                    })()}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.cursor && (
            <div className="work-load-more">
              <button
                className="work-secondary"
                disabled={list.loading}
                onClick={() => void list.loadMore()}
              >
                {list.loading ? "Đang tải…" : "Xem thêm công việc"}
              </button>
            </div>
          )}
        </>
      )}
      {drawer && (
        <WorkCreateDrawer
          service={service}
          attachments={attachments}
          initialScope={
            drawer.clone?.draft.scope || (workspaceContextId
              ? { type: "workspace", workspaceId: workspaceContextId }
              : scopeFromKey(scopes[0]?.id || "direct"))
          }
          lockScope={!!workspaceContextId}
          clone={drawer.clone}
          scopeLabels={Object.fromEntries(scopes.map((s) => [s.id, s.name]))}
          onClose={() => setDrawer(null)}
          onCreated={(result) => {
            setNotice(
              `Đã tạo ${result.taskCode}: ${drawer.clone?.draft.title || "Công việc mới"}`,
            );
            void list.refresh();
          }}
        />
      )}
    </main>
  );
}
export default function WorkPage() {
  const { user, refreshProfile } = useAuth();
  const location = useLocation();
  const subscribe = useMemo(() => {
    if (!user) return undefined;
    return (invalidate: () => void) =>
      subscribeWorkInvalidation(
        supabase,
        (event) => {
          if (event.reason === "access_revision")
            void refreshProfile().catch(() => undefined);
          invalidate();
        },
        { actorId: user.id },
      );
  }, [user?.id, refreshProfile]);
  if (!user || !canAccessRoute(user, location.pathname))
    return (
      <div className="work-module" role="alert">
        Bạn không có quyền truy cập Vioo Work.
      </div>
    );
  return (
    <WorkWorkspace
      key={user.id}
      actorId={user.id}
      service={taskService}
      attachments={attachmentService}
      subscribe={subscribe}
      board={boardService}
      actorName={user.name}
      canQuickAssign={canPerform(user, "work.task.create", { scopeType: "own", scopeId: "*" })}
    />
  );
}
