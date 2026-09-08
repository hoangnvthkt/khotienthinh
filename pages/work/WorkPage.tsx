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
import { workStatusLabels } from "../../lib/work/workPresentation";
import { WorkDetail } from "./WorkDetail";
import { WorkMutationSession } from "../../lib/work/workMutation";
import type { WorkUploadState } from "./WorkAttachments";
const taskService = createWorkTaskService(supabase),
  attachmentService = createWorkAttachmentService(supabase);
const views: { id: WorkTaskView; label: string }[] = [
  { id: "assigned_to_me", label: "Được giao" },
  { id: "created_by_me", label: "Tôi đã giao" },
  { id: "following", label: "Tôi theo dõi" },
  { id: "pinned", label: "Đã ghim" },
];
const priorities = {
  normal: "Bình thường",
  important: "Quan trọng",
  urgent: "Khẩn cấp",
};
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
}
export function WorkWorkspace({
  actorId,
  service,
  attachments,
  subscribe,
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
  const requested = params.get("view");
  const view = views.some((v) => v.id === requested)
    ? (requested as WorkTaskView)
    : "assigned_to_me";
  const [search, setSearch] = useState(params.get("q") || ""),
    [scopes, setScopes] = useState<WorkOption[]>([]),
    [drawer, setDrawer] = useState<{ clone?: WorkCloneForm } | null>(null),
    [notice, setNotice] = useState(""),
    [createError, setCreateError] = useState<unknown>(null);
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
    ...(params.get("scope")
      ? { scope: scopeFromKey(params.get("scope")!) }
      : {}),
    ...(params.get("deadlineFrom")
      ? { deadlineFrom: params.get("deadlineFrom")! }
      : {}),
    ...(params.get("deadlineTo")
      ? { deadlineTo: params.get("deadlineTo")! }
      : {}),
  };
  const list = useWorkTasks(service, actorId, view, filters);
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
  const returnTo = `/work/my${returnSearch ? "?" + returnSearch : ""}`;
  useEffect(() => {
    if (!taskCode && !list.loading) {
      const top =
        (routeLocation.state as { workScroll?: number } | null)?.workScroll ??
        listScroll.current;
      const id = requestAnimationFrame(() =>
        workScrollHost(root.current).scrollTo(0, top),
      );
      return () => cancelAnimationFrame(id);
    }
  }, [taskCode, list.loading]);
  return (
    <main className="work-module" ref={root}>
      <header className="work-heading">
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
      </header>
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
          <aside className="work-task-rail">
            <Link
              className="work-back"
              to={returnTo}
              state={{ workScroll: listScroll.current }}
            >
              ← Danh sách và bộ lọc
            </Link>
            {list.items.map((t) => (
              <Link
                key={t.id}
                aria-current={t.task_code === taskCode ? "page" : undefined}
                to={`/work/tasks/${encodeURIComponent(t.task_code)}${returnSearch ? "?" + returnSearch : ""}`}
                state={{
                  workListSearch: returnSearch,
                  workScroll: listScroll.current,
                }}
              >
                <small>{t.task_code}</small>
                <strong>{t.title}</strong>
                <span>{workStatusLabels[t.status]}</span>
              </Link>
            ))}
            {list.error && (
              <button onClick={() => void list.refresh()}>
                Thử tải danh sách
              </button>
            )}
            {list.cursor && (
              <button
                disabled={list.loading}
                onClick={() => void list.loadMore()}
              >
                Xem thêm công việc
              </button>
            )}
          </aside>
          <section className="work-detail">
            <Link
              className="work-back"
              to={returnTo}
              state={{ workScroll: listScroll.current }}
            >
              <ArrowLeft size={16} />
              Công việc của tôi
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
                <div className="work-detail-top">
                  <span className="work-code">
                    {currentDetail.data.task.task_code}
                  </span>
                  <div className="work-actions">
                    <button
                      className="work-secondary"
                      onClick={() => {
                        const url = new URL(window.location.href);
                        url.search = "";
                        url.hash = `/work/tasks/${encodeURIComponent(currentDetail.data!.task.task_code)}`;
                        navigator.clipboard
                          .writeText(url.toString())
                          .then(() =>
                            setNotice(
                              "Đã sao chép liên kết. Người mở vẫn cần quyền xem công việc.",
                            ),
                          )
                          .catch(() =>
                            setNotice(
                              "Không thể sao chép. Bạn có thể sao chép địa chỉ trên trình duyệt.",
                            ),
                          );
                      }}
                    >
                      <Copy size={16} />
                      Sao chép link
                    </button>
                    {currentDetail.data.capabilities.canClone && (
                      <button
                        className="work-secondary"
                        onClick={() => void cloneTask()}
                      >
                        Nhân bản
                      </button>
                    )}
                  </div>
                </div>
                <h2>{currentDetail.data.task.title}</h2>
                <WorkDetail
                  key={currentDetail.data.task.id}
                  detail={currentDetail.data}
                  service={service}
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
                />
              </>
            )}
          </section>
        </div>
      ) : (
        <>
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
                    to={`/work/tasks/${encodeURIComponent(task.task_code)}${params.toString() ? "?" + params.toString() : ""}`}
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
                      <span className="work-code">{task.task_code}</span>
                      <h2>{task.title}</h2>
                      <span className="work-scope">
                        {task.scope_type === "direct"
                          ? "Trực tiếp"
                          : task.scope_type === "department"
                            ? "Phòng ban"
                            : "Dự án"}
                        {task.privacy === "restricted" ? " · Hạn chế" : ""}
                      </span>
                      <span
                        className={`work-priority-inline priority-${task.priority}`}
                      >
                        {priorities[task.priority]}
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
                    <span className={`work-priority priority-${task.priority}`}>
                      {priorities[task.priority]}
                    </span>
                    <time
                      dateTime={task.deadline_at || undefined}
                      className={
                        task.deadline_at &&
                        new Date(task.deadline_at).getTime() < Date.now() &&
                        !["completed", "cancelled"].includes(task.status)
                          ? "work-overdue"
                          : ""
                      }
                    >
                      {when(task.deadline_at)}
                    </time>
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
            drawer.clone?.draft.scope || scopeFromKey(scopes[0]?.id || "direct")
          }
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
    />
  );
}
