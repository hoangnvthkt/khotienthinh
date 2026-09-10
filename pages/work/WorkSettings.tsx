import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { canAccessRoute } from "../../lib/routeAccess";
import {
  ConfigAttempt,
  configurationScope,
  createWorkConfigurationService,
  type ConfigKind,
  type ConfigRecord,
  type ConfigScope,
  type WorkConfigurationService,
} from "../../lib/work/workConfigurationService";
import { localDeadline, workError } from "../../lib/work/workForm";
import { WorkConfigurationForm } from "./WorkConfigurationForm";
import "./work.css";
const service = createWorkConfigurationService(supabase);
const labels: Record<ConfigKind, string> = {
  group: "Nhóm việc",
  calendar: "Lịch làm việc",
  policy: "Chính sách SLA",
  exception: "Ngày ngoại lệ",
};

export function WorkConfigurationWorkspace({
  service,
  actorId,
}: {
  service: WorkConfigurationService;
  actorId: string;
}) {
  const [attempt] = useState(
    () => new ConfigAttempt(`work-configuration:${actorId}`),
  );
  const pendingScope = attempt.pending?.scope;
  const restoredScope = !pendingScope
    ? ""
    : pendingScope.type === "global"
      ? "global"
      : pendingScope.type === "department"
        ? `department:${pendingScope.departmentId}`
        : pendingScope.type === "project"
          ? `project:${pendingScope.projectId}`
          : `workspace:${pendingScope.workspaceId}`;
  const [search, setSearch] = useState(""),
    [scopes, setScopes] = useState<{ id: string; name: string }[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [scope, setScope] = useState(restoredScope),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  async function load(append = false) {
    const n = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const p = await service.scopes(search, append ? cursor : null);
      if (n !== sequence.current) return;
      setScopes((old) => (append ? [...old, ...p.items] : p.items));
      setCursor(p.nextCursor);
    } catch (e) {
      if (n === sequence.current) setError(e);
    } finally {
      if (n === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    setScopes([]);
    setCursor(null);
    const t = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(t);
      sequence.current++;
    };
  }, [search, service]);
  return (
    <main className="work-module work-settings">
      <header>
        <Link to="/work/my">← Công việc của tôi</Link>
        <h1>Cấu hình công việc</h1>
        <p>Nhóm việc, lịch làm việc và SLA theo phạm vi được cấp quyền.</p>
      </header>
      <section className="work-settings-card">
        <label className="work-label">
          Tìm phạm vi
          <input
            className="work-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
          />
        </label>
        {error && <p role="alert">{workError(error)}</p>}
        <div className="work-settings-tabs">
          {scopes.map((s) => (
            <button
              className="work-secondary"
              aria-pressed={scope === s.id}
              key={s.id}
              onClick={() => setScope(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        {busy ? (
          <p role="status">Đang tải phạm vi…</p>
        ) : (
          <button
            className="work-secondary"
            onClick={() => void load(!!cursor)}
          >
            {cursor ? "Thêm phạm vi" : "Tải lại phạm vi"}
          </button>
        )}
        {!busy && !error && !scopes.length && (
          <p>Không có phạm vi cấu hình phù hợp.</p>
        )}
      </section>
      {scope && (
        <ScopeSettings
          attempt={attempt}
          key={scope}
          service={service}
          scope={configurationScope(scope)}
        />
      )}
    </main>
  );
}
export function ScopeSettings({
  service,
  attempt,
  scope,
}: {
  service: WorkConfigurationService;
  scope: ConfigScope;
  attempt: ConfigAttempt;
}) {
  const restored = attempt.pending;
  const [kind, setKind] = useState<ConfigKind>(
      restored?.kind || (scope.type === "global" ? "calendar" : "group"),
    ),
    [parent, setParent] = useState<ConfigRecord | null>(
      restored?.kind === "exception"
        ? {
            id: String(restored.data.calendar_id),
            lock_version: 1,
            name: "Lịch của yêu cầu đang chờ",
          }
        : null,
    ),
    [editing, setEditing] = useState<ConfigRecord | null | undefined>(
      restored
        ? ({
            ...restored.data,
            id: restored.id || "",
            lock_version: restored.version || 0,
          } as ConfigRecord)
        : undefined,
    ),
    [revision, setRevision] = useState(0);
  return (
    <>
      <section className="work-settings-card">
        <div className="work-settings-tabs">
          {(["group", "calendar", "policy"] as const)
            .filter((k) => k !== "group" || scope.type !== "global")
            .map((k) => (
              <button
                className="work-secondary"
                key={k}
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setParent(null);
                }}
              >
                {labels[k]}
              </button>
            ))}
        </div>
        {parent && (
          <p>
            Ngày ngoại lệ của lịch <strong>{parent.name}</strong>
          </p>
        )}
        <ConfigurationList
          key={`${kind}:${parent?.id}:${revision}`}
          service={service}
          scope={scope}
          kind={kind}
          parent={parent?.id || null}
          edit={setEditing}
          exceptions={(cal) => {
            setParent(cal);
            setKind("exception");
          }}
        />
      </section>
      <SlaPreview service={service} scope={scope} key={revision} />
      <ConfigurationHistory
        service={service}
        scope={scope}
        key={`history:${revision}`}
      />
      {editing !== undefined && (
        <WorkConfigurationForm
          commandAttempt={attempt}
          service={service}
          scope={scope}
          kind={kind}
          record={editing}
          parent={parent?.id || null}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            setRevision((r) => r + 1);
          }}
        />
      )}
    </>
  );
}
function ConfigurationList({
  service,
  scope,
  kind,
  parent,
  edit,
  exceptions,
}: {
  service: WorkConfigurationService;
  scope: ConfigScope;
  kind: ConfigKind;
  parent: string | null;
  edit: (r: ConfigRecord | null) => void;
  exceptions: (r: ConfigRecord) => void;
}) {
  const [items, setItems] = useState<ConfigRecord[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const seq = useRef(0);
  async function load(append = false) {
    const n = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const p = await service.list(kind, scope, parent, append ? cursor : null);
      if (n !== seq.current) return;
      setItems((old) => (append ? [...old, ...p.items] : p.items));
      setCursor(p.nextCursor);
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, []);
  return (
    <>
      <div className="work-settings-heading">
        <h2>{labels[kind]}</h2>
        <button className="work-primary" onClick={() => edit(null)}>
          Thêm {labels[kind].toLowerCase()}
        </button>
      </div>
      {error && <p role="alert">{workError(error)}</p>}
      <ul className="work-config-list">
        {items.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.name || r.exception_date}</strong>
              <p>
                {kind === "calendar"
                  ? `${r.timezone} · ${(r.working_intervals || []).map((i) => `${i.start}–${i.end}`).join(", ")}`
                  : kind === "policy"
                    ? `Xác nhận: ${r.acknowledgement_minutes} phút làm việc · ${r.priority || "Mọi ưu tiên"}`
                    : kind === "exception"
                      ? r.is_working_day
                        ? "Ngày làm việc thay thế"
                        : "Ngày nghỉ"
                      : r.description}
              </p>
              <small>
                Phiên bản {r.lock_version}
                {r.is_active === false ? " · Đã ngừng sử dụng" : ""}
              </small>
            </div>
            <div className="work-settings-tabs">
              <button className="work-secondary" onClick={() => edit(r)}>
                Sửa{" "}
                <span className="sr-only">{r.name || r.exception_date}</span>
              </button>
              {kind === "calendar" && (
                <button
                  className="work-secondary"
                  onClick={() => exceptions(r)}
                >
                  Ngày ngoại lệ
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!busy && !error && !items.length && (
        <p>Chưa có {labels[kind].toLowerCase()} trong phạm vi này.</p>
      )}
      <button
        className="work-secondary"
        disabled={busy}
        onClick={() => void load(!!cursor)}
      >
        {busy ? "Đang tải…" : cursor ? "Tải thêm" : "Tải lại"}
      </button>
    </>
  );
}
function SlaPreview({
  service,
  scope,
}: {
  service: WorkConfigurationService;
  scope: ConfigScope;
}) {
  const [priority, setPriority] = useState("normal"),
    [at, setAt] = useState(() => localDeadline(new Date().toISOString())),
    [result, setResult] = useState<Awaited<
      ReturnType<WorkConfigurationService["preview"]>
    > | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function preview(e: React.FormEvent) {
    e.preventDefault();
    const n = ++sequence.current;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await service.preview(
        scope,
        priority,
        new Date(at).toISOString(),
      );
      if (n === sequence.current) setResult(r);
    } catch (e) {
      if (n === sequence.current) setError(e);
    } finally {
      if (n === sequence.current) setBusy(false);
    }
  }
  const when = (iso: string) =>
    new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: result?.timezone || "Asia/Ho_Chi_Minh",
    }).format(new Date(iso));
  return (
    <section className="work-settings-card">
      <h2>Kiểm tra SLA</h2>
      <p>
        Xác nhận được tính từ lúc giao việc; SLA thực hiện được tính từ lúc nhận
        việc. Bản xem thử dùng cùng thời điểm bắt đầu cho cả hai.
      </p>
      <form onSubmit={preview} className="work-settings-fields">
        <fieldset disabled={busy}>
          <label className="work-label">
            Mức ưu tiên
            <select
              className="work-input"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setResult(null);
              }}
            >
              <option value="normal">Bình thường</option>
              <option value="important">Quan trọng</option>
              <option value="urgent">Khẩn cấp</option>
            </select>
          </label>
          <label className="work-label">
            Bắt đầu (giờ trên thiết bị)
            <input
              className="work-input"
              type="datetime-local"
              required
              value={at}
              onChange={(e) => {
                setAt(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <button className="work-secondary">
            {busy ? "Đang tính…" : "Tính thử SLA"}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{workError(error)}</p>}
      {result && (
        <div role="status">
          <p>
            Lịch: {result.calendarName} ({result.timezone})
          </p>
          <p>
            Hạn xác nhận: {when(result.acknowledgementDueAt)} (
            {result.acknowledgementMinutes} phút làm việc)
          </p>
          <p>
            {result.executionDueAt
              ? `Hạn SLA thực hiện: ${when(result.executionDueAt)}`
              : "Không đặt SLA thực hiện riêng."}
          </p>
        </div>
      )}
    </section>
  );
}
export default function WorkSettings() {
  const { user } = useAuth();
  if (!user || !canAccessRoute(user, "/work/settings"))
    return (
      <main className="work-module" role="alert">
        Bạn không có quyền cấu hình Vioo Work.
      </main>
    );
  return (
    <WorkConfigurationWorkspace
      key={user.id}
      actorId={user.id}
      service={service}
    />
  );
}

function ConfigurationHistory({
  service,
  scope,
}: {
  service: WorkConfigurationService;
  scope: ConfigScope;
}) {
  const [rows, setRows] = useState<
      Awaited<ReturnType<WorkConfigurationService["history"]>>["items"]
    >([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  async function load() {
    setBusy(true);
    setError(null);
    try {
      const p = await service.history(scope, cursor);
      if (live.current) {
        setRows((old) => (cursor ? [...old, ...p.items] : p.items));
        setCursor(p.nextCursor);
      }
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="work-settings-card">
      <h2>Lịch sử cấu hình</h2>
      <button
        className="work-secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy
          ? "Đang tải…"
          : cursor
            ? "Lịch sử cũ hơn"
            : "Xem lịch sử cấu hình"}
      </button>
      {error && <p role="alert">{workError(error)}</p>}
      <ul className="work-config-list">
        {rows.map((r) => (
          <li key={r.id}>
            <div>
              <strong>
                {r.after_value?.name ||
                  r.before_value?.name ||
                  r.after_value?.exception_date ||
                  r.before_value?.exception_date}
              </strong>
              <p>
                {r.actor_name} ·{" "}
                {new Date(r.created_at).toLocaleString("vi-VN")} · {r.reason}
              </p>
              <details>
                <summary>Thay đổi trước / sau</summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(
                    { truoc: r.before_value, sau: r.after_value },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
