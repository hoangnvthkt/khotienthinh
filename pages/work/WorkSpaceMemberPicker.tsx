import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkWorkspacePeopleService, WorkspacePeopleSource, WorkspacePerson } from "../../lib/work/workWorkspacePeopleService";
import type { WorkWorkspaceService } from "../../lib/work/workWorkspaceService";
import type { MembershipPreview, WorkspaceCursor, WorkspaceKind, WorkspaceMemberOrigin } from "../../lib/work/workWorkspaceTypes";
import { workError } from "../../lib/work/workForm";
import { buildMembershipChanges, MembershipApplyAttempt, resolvedWorkspaceRejection } from "./workspaceManagement";

const sourceLabel: Record<WorkspacePeopleSource, string> = {
  organization: "Sơ đồ tổ chức",
  project: "Nhân sự dự án",
  directory: "Toàn bộ danh bạ",
};
const excludedLabel: Record<string, string> = {
  NO_APP_ACCOUNT: "Chưa có tài khoản Vioo",
  ACCOUNT_INACTIVE: "Tài khoản ngừng hoạt động",
  EMPLOYEE_INACTIVE: "Nhân sự đã ngừng làm việc",
};

export function WorkSpaceMemberPicker({
  workspaceId,
  workspaceKind,
  lockVersion,
  workspaceService,
  peopleService,
  close,
  applied,
}: {
  workspaceId: string;
  workspaceKind: WorkspaceKind;
  lockVersion: number;
  workspaceService: WorkWorkspaceService;
  peopleService: WorkWorkspacePeopleService;
  close: () => void;
  applied: (lockVersion: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primary: WorkspacePeopleSource = workspaceKind === "project" ? "project" : workspaceKind === "department" ? "organization" : "directory";
  const [source, setSource] = useState<WorkspacePeopleSource>(primary);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WorkspacePerson[]>([]);
  const [cursor, setCursor] = useState<WorkspaceCursor | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<MembershipPreview | null>(null);
  const [reason, setReason] = useState("Bổ sung thành viên Workspace");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sequence = useRef(0);
  const attempt = useRef(new MembershipApplyAttempt());
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    setItems([]); setCursor(null);
    const n = ++sequence.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const page = await peopleService.people(workspaceId, source, query.trim());
        if (n === sequence.current) { setItems(page.items); setCursor(page.nextCursor); }
      } catch (nextError) {
        if (n === sequence.current) setError(nextError);
      } finally {
        if (n === sequence.current) setLoading(false);
      }
    }, 180);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [workspaceId, source, query, peopleService]);

  async function loadMore() {
    if (!cursor || loading) return;
    const n = ++sequence.current; setLoading(true); setError(null);
    try {
      const page = await peopleService.people(workspaceId, source, query.trim(), cursor);
      if (n === sequence.current) {
        setItems((old) => [...new Map([...old, ...page.items].map((person) => [person.userId || person.employeeId || person.name, person])).values()]);
        setCursor(page.nextCursor);
      }
    } catch (nextError) { if (n === sequence.current) setError(nextError); }
    finally { if (n === sequence.current) setLoading(false); }
  }

  const selectable = useMemo(() => items.filter((person) => person.userId && person.eligibility === "ELIGIBLE" && !person.alreadyMember), [items]);
  const locked = busy || !!attempt.current.pending;
  const origin: WorkspaceMemberOrigin = workspaceKind === "department" && source === "organization"
    ? "organization"
    : workspaceKind === "project" && source === "project"
      ? "project"
      : "manual";
  function toggle(userId: string) {
    setPreview(null);
    setSelected((old) => old.includes(userId) ? old.filter((id) => id !== userId) : [...old, userId]);
  }
  async function requestPreview() {
    setBusy(true); setError(null);
    const sourceReference = origin === "manual"
      ? null
      : items.find((person) => person.userId && selected.includes(person.userId))?.sourceReference || null;
    try { setPreview(await workspaceService.previewMembers(workspaceId, buildMembershipChanges(selected, origin, sourceReference))); }
    catch (nextError) { setError(nextError); }
    finally { setBusy(false); }
  }
  async function applyPreview() {
    if (!preview || preview.blockers.length) return;
    const request = attempt.current.begin({ workspaceId, preview, expectedVersion: lockVersion, reason });
    attempt.current.running = true; setBusy(true); setError(null);
    try {
      const result = await workspaceService.applyMembers(request.workspaceId, request.preview, request.expectedVersion, request.reason, request.key);
      attempt.current.resolved();
      applied(result.lockVersion);
      close();
    } catch (nextError) {
      if (resolvedWorkspaceRejection(nextError)) {
        attempt.current.resolved();
        setPreview(null);
      }
      setError(nextError);
    } finally {
      attempt.current.running = false; setBusy(false);
    }
  }
  const requestClose = () => {
    if (busy || attempt.current.pending) return;
    dialog.current?.close(); close();
  };
  return (
    <dialog ref={dialog} className="work-member-dialog" onCancel={(event) => { event.preventDefault(); requestClose(); }} aria-labelledby="workspace-member-picker-title">
      <header><div><p className="work-home-kicker">THÀNH VIÊN</p><h2 id="workspace-member-picker-title">Thêm người vào Workspace</h2></div><button type="button" disabled={locked} aria-label="Đóng chọn thành viên" onClick={requestClose}>×</button></header>
      {!preview ? <>
        <div className="work-settings-tabs" aria-label="Nguồn gợi ý">
          {([primary, ...(["organization", "project", "directory"] as WorkspacePeopleSource[]).filter((item) => item !== primary)]).map((item) => <button type="button" key={item} aria-pressed={source === item} onClick={() => { setSource(item); setSelected([]); }}>{sourceLabel[item]}</button>)}
        </div>
        <label className="work-label">Tìm nhân viên<input className="work-input" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Tên, vị trí hoặc phòng ban…" /></label>
        <div className="work-member-select-tools"><span>Đã chọn {selected.length}/100</span><button type="button" onClick={() => setSelected(selectable.map((person) => person.userId!))}>Chọn trang này</button></div>
        {loading && <p role="status">Đang tìm thành viên…</p>}
        <ul className="work-people-list">
          {items.map((person) => {
            const eligible = !!person.userId && person.eligibility === "ELIGIBLE" && !person.alreadyMember;
            return <li key={person.employeeId || person.userId || person.name}>
              <label><input type="checkbox" disabled={!eligible || locked} checked={!!person.userId && selected.includes(person.userId)} onChange={() => person.userId && toggle(person.userId)} /><span className="work-person-avatar">{person.name.slice(0, 1).toUpperCase()}</span><span><strong>{person.name}</strong><small>{person.position || person.sourceLabel || "Nhân viên"}</small></span></label>
              <em>{person.alreadyMember ? "Đã là thành viên" : person.eligibility === "ELIGIBLE" ? "Có thể thêm" : excludedLabel[person.eligibility] || person.eligibility}</em>
            </li>;
          })}
        </ul>
        {cursor && <button type="button" className="work-space-more" disabled={loading} onClick={() => void loadMore()}>{loading ? "Đang tải…" : "Tải thêm nhân viên"}</button>}
        {!loading && !items.length && !error && <p>Không tìm thấy nhân viên phù hợp.</p>}
      </> : <section className="work-member-preview">
        <h3>Xem trước thay đổi</h3><p>{preview.changes.length} thành viên sẽ được thêm. Bản xem trước có dấu vân tay <code>{preview.fingerprint.slice(0, 12)}</code>.</p>
        {preview.blockers.length > 0 && <div className="work-error" role="alert"><strong>Cần xử lý trách nhiệm trước</strong>{preview.blockers.map((blocker) => <p key={blocker.userId}>{blocker.userId}: {blocker.openAssignmentCount} việc đang nhận, {blocker.openReviewCount} việc đang duyệt.</p>)}</div>}
        <label className="work-label">Lý do thay đổi<input className="work-input" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={locked} /></label>
      </section>}
      {error && <p className="work-error" role="alert">{workError(error)}{attempt.current.pending ? " Yêu cầu đang được giữ nguyên để thử lại an toàn." : ""}</p>}
      <footer>
        {!preview ? <button type="button" className="work-home-primary" disabled={!selected.length || busy} onClick={() => void requestPreview()}>Xem trước thay đổi</button> : <>
          <button type="button" className="work-home-secondary" disabled={locked} onClick={() => setPreview(null)}>Quay lại chọn</button>
          <button type="button" className="work-home-primary" disabled={busy || !reason.trim() || !!preview.blockers.length} onClick={() => void applyPreview()}>{busy ? "Đang áp dụng…" : attempt.current.pending ? "Thử lại cùng yêu cầu" : "Áp dụng thay đổi"}</button>
        </>}
      </footer>
    </dialog>
  );
}
