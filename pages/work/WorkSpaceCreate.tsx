import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, FolderKanban, Users } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { canAccessRoute } from "../../lib/routeAccess";
import { canStartWorkWorkspace } from "../../lib/permissions/permissionService";
import { supabase } from "../../lib/supabase";
import {
  createWorkWorkspaceService,
  type WorkWorkspaceService,
  type WorkWorkspaceSource,
} from "../../lib/work/workWorkspaceService";
import type { WorkspaceKind } from "../../lib/work/workWorkspaceTypes";
import { workError } from "../../lib/work/workForm";
import { createWorkspaceDraft, resolvedWorkspaceRejection, WorkspaceCreateAttempt, workspaceTabRoute } from "./workspaceManagement";
import { workspaceCover, workspaceKindLabel } from "./workspacePresentation";
import "./work.css";
import "./workspace.css";

const defaultService = createWorkWorkspaceService(supabase);
const kinds: Array<{ id: WorkspaceKind; description: string; icon: typeof Building2 }> = [
  { id: "department", description: "Gắn với một phòng ban trong sơ đồ tổ chức.", icon: Building2 },
  { id: "project", description: "Gắn với một dự án mà anh/chị được phép xem.", icon: FolderKanban },
  { id: "collaboration", description: "Nhóm linh hoạt, độc lập với cơ cấu tổ chức.", icon: Users },
];

export function WorkSpaceCreateWorkspace({ service }: { service: WorkWorkspaceService }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<WorkspaceKind>("department");
  const [sources, setSources] = useState<WorkWorkspaceSource[]>([]);
  const [source, setSource] = useState<WorkWorkspaceSource | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sequence = useRef(0);
  const attempt = useRef(new WorkspaceCreateAttempt());

  useEffect(() => {
    setSource(null);
    setName("");
    setSources([]);
    if (kind === "collaboration") return;
    const n = ++sequence.current;
    const timer = setTimeout(async () => {
      setLoadingSources(true);
      setError(null);
      try {
        const page = await service.sources(kind, search.trim());
        if (n === sequence.current) setSources(page.items);
      } catch (nextError) {
        if (n === sequence.current) setError(nextError);
      } finally {
        if (n === sequence.current) setLoadingSources(false);
      }
    }, 180);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [kind, search, service]);

  const selectedKind = useMemo(() => kinds.find((item) => item.id === kind)!, [kind]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = createWorkspaceDraft(
        kind,
        name || source?.name || "",
        source?.id || null,
        kind === "project" ? "amber" : kind === "collaboration" ? "blue" : "teal",
        kind === "project" ? "briefcase" : kind === "collaboration" ? "users" : "building",
        kind === "project" ? "site" : kind === "collaboration" ? "team" : "office",
      );
      const request = attempt.current.begin(input);
      const created = await service.create(request.input, request.key);
      attempt.current.resolved();
      navigate(workspaceTabRoute(created.id, "tasks"), { replace: true });
    } catch (nextError) {
      if (resolvedWorkspaceRejection(nextError)) attempt.current.resolved();
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="work-home work-space-create">
      <Link className="work-space-preview-back" to="/work">← Không gian làm việc</Link>
      <header className="work-manage-heading">
        <div><p className="work-home-kicker">THIẾT LẬP WORKSPACE</p><h1>Tạo không gian làm việc</h1></div>
        <p>Người tạo trở thành quản trị viên đầu tiên và có thể thêm thành viên sau khi tạo.</p>
      </header>
      <form onSubmit={submit} className="work-create-flow">
        <section className="work-settings-card">
          <span className="work-step">01</span><h2>Chọn loại không gian</h2>
          <div className="work-kind-grid">
            {kinds.map((item) => {
              const Icon = item.icon;
              return <button type="button" key={item.id} disabled={!!attempt.current.pending} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>
                <img src={workspaceCover(item.id)} alt="" /><span><Icon size={20} /><strong>{workspaceKindLabel[item.id]}</strong><small>{item.description}</small></span>
              </button>;
            })}
          </div>
        </section>
        {kind !== "collaboration" && (
          <section className="work-settings-card">
            <span className="work-step">02</span><h2>Chọn {workspaceKindLabel[kind].toLowerCase()} nguồn</h2>
            <label className="work-label">Tìm trong nguồn được phép xem
              <input className="work-input" disabled={!!attempt.current.pending} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder={`Tìm ${workspaceKindLabel[kind].toLowerCase()}…`} />
            </label>
            {loadingSources && <p role="status">Đang tải nguồn…</p>}
            <div className="work-source-list">
              {sources.map((item) => <div key={item.id} className={source?.id === item.id ? "selected" : ""}>
                <button type="button" disabled={!!attempt.current.pending} onClick={() => { setSource(item); setName(item.name); }}><strong>{item.name}</strong><span>{item.existingWorkspaceId ? "Đã có Workspace" : "Có thể tạo"}</span></button>
                {item.existingWorkspaceId && <Link to={workspaceTabRoute(item.existingWorkspaceId, "tasks")}>Mở Workspace hiện có</Link>}
              </div>)}
            </div>
            {!loadingSources && !sources.length && !error && <p>Không có nguồn phù hợp với quyền hiện tại.</p>}
          </section>
        )}
        <section className="work-settings-card work-create-details">
          <span className="work-step">{kind === "collaboration" ? "02" : "03"}</span><h2>Đặt tên và kiểm tra</h2>
          <div className="work-create-review">
            <img src={workspaceCover(kind)} alt="" />
            <div><strong>{workspaceKindLabel[kind]}</strong><span>{selectedKind.description}</span></div>
          </div>
          <label className="work-label">Tên Workspace
            <input className="work-input" disabled={!!attempt.current.pending} required minLength={2} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên dễ nhận biết với thành viên" />
          </label>
          <p className="work-create-admin-note"><Users size={18} /> Anh/chị sẽ là quản trị viên đầu tiên. Thành viên chỉ thấy Workspace sau khi được thêm.</p>
          {error && <p className="work-error" role="alert">{workError(error)}</p>}
          {attempt.current.pending && <p className="work-notice">Kết quả lần tạo trước chưa rõ. Nội dung và mã yêu cầu được giữ nguyên để thử lại an toàn.</p>}
          <button className="work-home-primary" disabled={busy || !name.trim() || (kind !== "collaboration" && (!source || !!source.existingWorkspaceId))}>
            {busy ? "Đang tạo…" : attempt.current.pending ? "Thử lại cùng yêu cầu" : "Tạo Workspace"}
          </button>
        </section>
      </form>
    </main>
  );
}

export default function WorkSpaceCreate() {
  const { user } = useAuth();
  if (!user || !canAccessRoute(user, "/work/spaces/new") || !canStartWorkWorkspace(user)) return <Navigate to="/" replace />;
  return <WorkSpaceCreateWorkspace service={defaultService} />;
}
