import React, { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useWorkWorkspaces } from "../../hooks/work/useWorkWorkspaces";
import { canPerform, canStartWorkWorkspace } from "../../lib/permissions/permissionService";
import { canAccessRoute } from "../../lib/routeAccess";
import { supabase } from "../../lib/supabase";
import {
  createWorkWorkspaceService,
  type WorkWorkspaceService,
} from "../../lib/work/workWorkspaceService";
import type { WorkspaceKind } from "../../lib/work/workWorkspaceTypes";
import { workError } from "../../lib/work/workForm";
import { WorkWorkspaceCard } from "./WorkWorkspaceCard";
import "./workspace.css";

const defaultService = createWorkWorkspaceService(supabase);
const filters: Array<{ id: WorkspaceKind | null; label: string }> = [
  { id: null, label: "Tất cả" },
  { id: "department", label: "Phòng ban" },
  { id: "project", label: "Dự án" },
  { id: "collaboration", label: "Cộng tác" },
];

export function WorkHomeWorkspace({
  actorId,
  displayName,
  service,
  canCreateDirect,
  canCreateWorkspace = false,
}: {
  actorId: string;
  displayName: string;
  service: WorkWorkspaceService;
  canCreateDirect: boolean;
  canCreateWorkspace?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<WorkspaceKind | null>(null);
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const list = useWorkWorkspaces(service, actorId, search, kind);
  const pinned = useMemo(() => list.items.filter((item) => item.pinned), [list.items]);
  const actionCount = useMemo(
    () => list.items.reduce((total, item) => total + item.myActionCount, 0),
    [list.items],
  );
  const firstName = displayName.trim().split(/\s+/).at(-1) || displayName;

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(query.trim());
  };
  const togglePin = async (workspaceId: string, next: boolean) => {
    setPinBusy(workspaceId);
    try {
      await list.setPinned(workspaceId, next);
    } catch {
      /* The hook restores the server-backed item and exposes the error. */
    } finally {
      setPinBusy(null);
    }
  };

  return (
    <main className="work-home">
      <header className="work-home-hero">
        <div className="work-home-intro">
          <p className="work-home-kicker"><Sparkles size={15} /> VIOO WORK</p>
          <h1>Chào {firstName}, hôm nay mình làm việc ở đâu?</h1>
          <p>Chọn một không gian để xem hoạt động của phòng ban, dự án hoặc nhóm cộng tác.</p>
        </div>
        <div className="work-home-actions">
          {canCreateWorkspace && (
            <Link className="work-home-secondary" to="/work/spaces/new">
              <Plus size={18} /> Tạo Workspace
            </Link>
          )}
          {canCreateDirect && (
            <Link className="work-home-primary" to="/work/my?create=1">
              <Plus size={18} /> Giao việc trực tiếp
            </Link>
          )}
          <Link className="work-home-secondary" to="/work/my">
            <ClipboardList size={18} /> Công việc của tôi
          </Link>
        </div>
      </header>

      <section className="work-action-strip" aria-labelledby="work-action-title">
        <div className="work-action-icon"><CheckCircle2 size={23} /></div>
        <div>
          <p id="work-action-title">Việc cần tôi xử lý</p>
          <strong>{actionCount}</strong>
          <span> hoạt động trong các không gian đang hiển thị</span>
        </div>
        <Link to="/work/my?view=assigned_to_me">Xem danh sách <ArrowRight size={16} /></Link>
      </section>

      <section className="work-space-directory" aria-labelledby="work-space-title">
        <div className="work-space-heading">
          <div>
            <h2 id="work-space-title">Không gian làm việc</h2>
            <p>Mỗi thẻ là một nơi làm việc riêng với đúng thành viên và công việc liên quan.</p>
          </div>
          <form className="work-space-search" role="search" onSubmit={submitSearch}>
            <Search size={17} />
            <input
              aria-label="Tìm không gian"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm phòng ban, dự án…"
              maxLength={100}
            />
            <button type="submit">Tìm</button>
          </form>
        </div>
        <div className="work-space-filters" aria-label="Lọc loại không gian">
          {filters.map((filter) => (
            <button
              type="button"
              key={filter.label}
              aria-pressed={kind === filter.id}
              onClick={() => setKind(filter.id)}
            >{filter.label}</button>
          ))}
        </div>

        {list.error && (
          <div className="work-space-error" role="alert">
            <p>{workError(list.error)}</p>
            <button onClick={() => void list.refresh()}>Thử lại</button>
          </div>
        )}
        {list.loading && list.items.length === 0 && (
          <div className="work-space-grid" aria-label="Đang tải không gian">
            {Array.from({ length: 3 }, (_, index) => <div className="work-space-skeleton" key={index} />)}
          </div>
        )}
        {!list.loading && !list.error && list.items.length === 0 && (
          <div className="work-space-empty">
            <div><Search size={26} /></div>
            <h3>{search || kind ? "Không tìm thấy không gian phù hợp" : "Bạn chưa có không gian làm việc"}</h3>
            <p>{search || kind ? "Đổi từ khóa hoặc chọn lại loại không gian." : "Khi được thêm vào phòng ban, dự án hoặc nhóm cộng tác, không gian sẽ xuất hiện tại đây."}</p>
            {(search || kind) && <button onClick={() => { setQuery(""); setSearch(""); setKind(null); }}>Xóa bộ lọc</button>}
          </div>
        )}

        {pinned.length > 0 && (
          <div className="work-space-section">
            <h3>Đã ghim</h3>
            <div className="work-space-grid">
              {pinned.map((workspace) => (
                <WorkWorkspaceCard key={`pinned-${workspace.id}`} workspace={workspace}
                  pinBusy={pinBusy === workspace.id} onPin={(next) => void togglePin(workspace.id, next)} />
              ))}
            </div>
          </div>
        )}
        {list.items.length > 0 && (
          <div className="work-space-section">
            <h3>{pinned.length ? "Tất cả không gian" : "Không gian của tôi"}</h3>
            <div className="work-space-grid">
              {list.items.map((workspace) => (
                <WorkWorkspaceCard key={workspace.id} workspace={workspace}
                  pinBusy={pinBusy === workspace.id} onPin={(next) => void togglePin(workspace.id, next)} />
              ))}
            </div>
          </div>
        )}
        {list.cursor && (
          <button className="work-space-more" disabled={list.loading} onClick={() => void list.loadMore()}>
            {list.loading ? "Đang tải…" : "Xem thêm không gian"}
          </button>
        )}
      </section>
    </main>
  );
}

export default function WorkHome() {
  const { user } = useAuth();
  if (!user || !canAccessRoute(user, "/work")) return <Navigate to="/" replace />;
  return (
    <WorkHomeWorkspace
      actorId={user.id}
      displayName={user.name}
      service={defaultService}
      canCreateDirect={canPerform(user, "work.task.create", { scopeType: "own", scopeId: "*" })}
      canCreateWorkspace={canStartWorkWorkspace(user)}
    />
  );
}
