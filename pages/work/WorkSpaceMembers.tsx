import React, { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import type { WorkWorkspacePeopleService, WorkspaceSourceDiff } from "../../lib/work/workWorkspacePeopleService";
import type { WorkWorkspaceService } from "../../lib/work/workWorkspaceService";
import type { MembershipChange, MembershipPreview, WorkspaceCursor, WorkspaceMember, WorkspaceSummary } from "../../lib/work/workWorkspaceTypes";
import { workError } from "../../lib/work/workForm";
import { WorkSpaceMemberPicker } from "./WorkSpaceMemberPicker";
import { MembershipApplyAttempt, resolvedWorkspaceRejection } from "./workspaceManagement";

export function WorkSpaceMembers({ workspace, workspaceService, peopleService, changed }: {
  workspace: WorkspaceSummary;
  workspaceService: WorkWorkspaceService;
  peopleService: WorkWorkspacePeopleService;
  changed: () => void;
}) {
  const [items, setItems] = useState<WorkspaceMember[]>([]);
  const [cursor, setCursor] = useState<WorkspaceCursor | null>(null);
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<MembershipPreview | null>(null);
  const [reason, setReason] = useState("Cập nhật vai trò thành viên");
  const [sourceDiff, setSourceDiff] = useState<WorkspaceSourceDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sequence = useRef(0);
  const attempt = useRef(new MembershipApplyAttempt());
  async function load(append = false) {
    const n = ++sequence.current; setBusy(true); setError(null);
    try {
      const page = await workspaceService.members(workspace.id, search.trim(), append ? cursor : null);
      if (n === sequence.current) {
        setItems((old) => append ? [...new Map([...old, ...page.items].map((member) => [member.userId, member])).values()] : page.items);
        setCursor(page.nextCursor);
      }
    } catch (nextError) { if (n === sequence.current) setError(nextError); }
    finally { if (n === sequence.current) setBusy(false); }
  }
  useEffect(() => { setItems([]); setCursor(null); const timer = setTimeout(() => void load(), 180); return () => { clearTimeout(timer); sequence.current++; }; }, [workspace.id, search, workspaceService]);

  async function review(change: MembershipChange | MembershipChange[], message: string) {
    setReason(message); setBusy(true); setError(null);
    try { setPreview(await workspaceService.previewMembers(workspace.id, Array.isArray(change) ? change : [change])); }
    catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || preview.blockers.length) return;
    const request = attempt.current.begin({ workspaceId: workspace.id, preview, expectedVersion: workspace.lockVersion, reason });
    setBusy(true); setError(null);
    try {
      await workspaceService.applyMembers(request.workspaceId, request.preview, request.expectedVersion, request.reason, request.key);
      attempt.current.resolved(); setPreview(null); await load(); changed();
    } catch (nextError) {
      if (resolvedWorkspaceRejection(nextError)) {
        attempt.current.resolved(); setPreview(null); void load(); changed();
      }
      setError(nextError);
    }
    finally { setBusy(false); }
  }
  async function inspectSource() {
    setBusy(true); setError(null);
    try { setSourceDiff(await peopleService.sourceDiff(workspace.id)); }
    catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  }
  return <section className="work-space-panel" aria-labelledby="workspace-members-title">
    <div className="work-panel-heading"><div><h2 id="workspace-members-title">Thành viên</h2><p>Danh sách tối thiểu của những người đang hoạt động trong Workspace.</p></div>
      {workspace.capabilities.canManageMembers && workspace.status === "active" && <button className="work-home-primary" onClick={() => setPicker(true)}><Plus size={17} /> Thêm thành viên</button>}
    </div>
    <div className="work-member-toolbar"><label className="work-label">Tìm trong thành viên<input className="work-input" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} /></label>
      {workspace.capabilities.canManageMembers && <button className="work-home-secondary" disabled={busy} onClick={() => void inspectSource()}><RefreshCw size={16} /> Đối chiếu nguồn</button>}
    </div>
    {error && <p className="work-error" role="alert">{workError(error)}{attempt.current.pending ? " Yêu cầu cũ đang được giữ nguyên; hãy thử lại trước khi tạo thay đổi mới." : ""}</p>}
    {busy && !items.length && <p role="status">Đang tải thành viên…</p>}
    <ul className="work-members-list">
      {items.map((member) => <li key={member.userId}>
        <span className="work-person-avatar">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.name.slice(0, 1).toUpperCase()}</span>
        <div><strong>{member.name}</strong><span>{member.origin === "manual" ? "Thêm trực tiếp" : member.origin === "project" ? "Từ dự án" : "Từ sơ đồ tổ chức"}{member.expiresAt ? ` · đến ${new Date(member.expiresAt).toLocaleDateString("vi-VN")}` : ""}</span></div>
        <span className={`work-member-role role-${member.role}`}>{member.role === "admin" ? <ShieldCheck size={14} /> : <UserRound size={14} />}{member.role === "admin" ? "Quản trị" : "Thành viên"}</span>
        {workspace.capabilities.canManageMembers && workspace.status === "active" && <div className="work-member-actions">
          <button disabled={!!attempt.current.pending} onClick={() => void review({ operation: "set_role", userId: member.userId, role: member.role === "admin" ? "member" : "admin" }, member.role === "admin" ? "Chuyển thành thành viên" : "Bổ nhiệm quản trị viên")}>{member.role === "admin" ? "Bỏ quyền quản trị" : "Bổ nhiệm quản trị"}</button>
          <button disabled={!!attempt.current.pending} onClick={() => void review({ operation: "remove", userId: member.userId }, "Rời thành viên khỏi Workspace")}>Gỡ</button>
        </div>}
      </li>)}
    </ul>
    {cursor && <button className="work-space-more" disabled={busy} onClick={() => void load(true)}>{busy ? "Đang tải…" : "Tải thêm thành viên"}</button>}
    {!busy && !items.length && !error && <div className="work-space-empty"><h3>Không có thành viên phù hợp</h3></div>}
    {sourceDiff && <section className="work-source-diff"><div><h3>Đối chiếu với nguồn</h3><button aria-label="Đóng đối chiếu nguồn" onClick={() => setSourceDiff(null)}>×</button></div><p>Dấu vân tay: <code>{sourceDiff.fingerprint.slice(0, 12)}</code>. Kết quả chỉ để xem, chưa tự động gỡ thành viên thêm thủ công.</p>
      {sourceDiff.items.length ? <><ul>{sourceDiff.items.map((item) => <li key={`${item.reason}:${item.person.employeeId || item.person.userId}`}>{item.person.name} · {item.reason === "joined_source" ? "mới vào nguồn" : "đã rời nguồn"}</li>)}</ul><button className="work-home-primary" disabled={busy || !!attempt.current.pending} onClick={() => void review(sourceDiff.items.map((item) => item.change), "Đồng bộ thành viên với nguồn đã liên kết")}>Xem trước đồng bộ nguồn</button>{sourceDiff.nextCursor && <p>Còn thay đổi ở trang tiếp theo; áp dụng trang hiện tại rồi đối chiếu lại.</p>}</> : <p>Thành viên đang khớp với nguồn.</p>}
    </section>}
    {preview && <section className="work-member-preview" aria-label="Xem trước thay đổi thành viên"><h3>Xem trước thay đổi</h3>
      <p>{preview.changes.length === 1 ? `${preview.changes[0]?.operation === "remove" ? "Gỡ" : preview.changes[0]?.operation === "add" ? "Thêm" : "Đổi vai trò"} thành viên ${preview.changes[0]?.userId}.` : `${preview.changes.length} thay đổi nguồn sẽ được áp dụng sau khi xác nhận.`}</p>
      {preview.blockers.map((blocker) => <p className="work-error" role="alert" key={blocker.userId}>Cần bàn giao {blocker.openAssignmentCount} việc đang nhận và {blocker.openReviewCount} việc đang duyệt.</p>)}
      <label className="work-label">Lý do<input className="work-input" value={reason} minLength={3} onChange={(event) => setReason(event.target.value)} disabled={!!attempt.current.pending} /></label>
      <div className="work-settings-tabs"><button className="work-home-secondary" disabled={busy || !!attempt.current.pending} onClick={() => setPreview(null)}>Hủy xem trước</button><button className="work-home-primary" disabled={busy || !reason.trim() || !!preview.blockers.length} onClick={() => void apply()}>{busy ? "Đang áp dụng…" : attempt.current.pending ? "Thử lại cùng yêu cầu" : "Áp dụng thay đổi"}</button></div>
    </section>}
    {picker && <WorkSpaceMemberPicker workspaceId={workspace.id} workspaceKind={workspace.kind} lockVersion={workspace.lockVersion} workspaceService={workspaceService} peopleService={peopleService} close={() => setPicker(false)} applied={() => { setPicker(false); void load(); changed(); }} />}
  </section>;
}
