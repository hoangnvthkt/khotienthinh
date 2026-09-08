import React, { useEffect, useRef, useState } from "react";
import { Eye, UserRoundCheck, UsersRound } from "lucide-react";
import type { WorkCollaborationCommand, WorkTaskDetail } from "../../lib/work/workTypes";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import { workError } from "../../lib/work/workForm";
import { workStatusLabels, workWhen } from "../../lib/work/workPresentation";

const Avatar = ({ name }: { name: string }) => <span className="work-avatar" aria-hidden="true">{name.trim().split(/\s+/).at(-1)?.[0] || "?"}</span>;

export function WorkTaskPeople({ detail, service, actorId, names, busy, run }: {
  detail: WorkTaskDetail;
  service: WorkTaskService;
  actorId: string;
  names: Record<string, string>;
  busy: boolean;
  run: (input: WorkCollaborationCommand) => Promise<boolean>;
}) {
  const watchers = detail.participants.filter((p) => p.participant_role === "watcher" && !p.ended_at);
  const currentIds = watchers.map((p) => p.user_id);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(currentIds);
  const [options, setOptions] = useState<Array<{ userId: string; name: string }>>([]);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => setSelected(currentIds), [detail.task.lock_version, currentIds.join(",")]);
  useEffect(() => {
    if (!editing) return;
    let live = true;
    dialog.current?.showModal();
    setError(null);
    setLoading(true);
    const timer = window.setTimeout(() => {
      service.watcherOptions(detail.task.id, search).then((page) => {
        if (!live) return;
        setOptions(page.items);
        setCursor(page.nextCursor);
      }).catch((caught) => live && setError(caught)).finally(() => live && setLoading(false));
    }, search ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [editing, service, detail.task.id, search]);
  const name = (id: string | null) => id ? names[id] || options.find((x) => x.userId === id)?.name || "Người tham gia" : "Chưa chỉ định";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const addUserIds = selected.filter((id) => !currentIds.includes(id));
    const removeUserIds = currentIds.filter((id) => !selected.includes(id));
    if (!addUserIds.length && !removeUserIds.length) return setEditing(false);
    const ok = await run({ command: "watchers_update", payload: { addUserIds, removeUserIds, expectedLockVersion: detail.task.lock_version } });
    if (ok) setEditing(false);
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await service.watcherOptions(detail.task.id, search, cursor);
      setOptions((items) => [...items, ...page.items.filter((item) => !items.some((old) => old.userId === item.userId))]);
      setCursor(page.nextCursor);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }

  return (
    <>
      <aside className="work-responsibility">
        <div className="work-people-title"><UsersRound size={18} aria-hidden="true" /><h3>Con người</h3></div>
        <div className="work-person-block">
          <small>Người giao việc</small>
          <div><Avatar name={name(detail.task.created_by)} /><span><strong>{name(detail.task.created_by)}</strong><small>Người tạo công việc</small></span></div>
        </div>
        <div className="work-person-block">
          <small>Người thực hiện</small>
          {detail.assignments.filter((a) => !a.ended_at).map((a) => <div key={a.id}><Avatar name={name(a.user_id)} /><span><strong>{name(a.user_id)}{a.user_id === actorId ? " (bạn)" : ""}</strong><small>{workStatusLabels[a.state as keyof typeof workStatusLabels] || "Đã chuyển"} · SLA {workWhen(a.execution_sla_due_at)}</small></span></div>)}
        </div>
        <div className="work-person-block">
          <small>Người đánh giá</small>
          <div><UserRoundCheck size={28} aria-hidden="true" /><span><strong>{detail.task.review_policy === "auto_complete" ? "Tự hoàn thành" : name(detail.task.reviewer_user_id)}</strong><small>{detail.task.review_policy === "auto_complete" ? "Không cần duyệt thủ công" : "Duyệt kết quả"}</small></span></div>
        </div>
        <div className="work-person-block">
          <div className="work-person-block-heading"><small>Người theo dõi</small>{detail.capabilities.canManageWatchers && <button type="button" className="work-text-button" disabled={busy} onClick={() => setEditing(true)} aria-label="Thêm / bỏ người theo dõi">Chỉnh sửa</button>}</div>
          {watchers.map((p) => <div key={p.id}><Avatar name={name(p.user_id)} /><span><strong>{name(p.user_id)}</strong><small>Theo dõi cập nhật</small></span></div>)}
          {!watchers.length && <p className="work-hint"><Eye size={15} aria-hidden="true" /> Chưa có người theo dõi.</p>}
        </div>
      </aside>
      {editing && <dialog ref={dialog} className="work-action-dialog" aria-labelledby="work-watchers-title" onCancel={(e) => { e.preventDefault(); if (!busy) setEditing(false); }}>
        <form onSubmit={save}>
          <h2 id="work-watchers-title">Người theo dõi</h2>
          <p>Chọn người được xem các cập nhật của công việc.</p>
          <label className="work-label">Tìm thành viên<input className="work-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nhập tên người theo dõi" /></label>
          <fieldset disabled={busy} className="work-watcher-options">
            {options.map((option) => <label key={option.userId}><input type="checkbox" checked={selected.includes(option.userId)} onChange={() => setSelected((ids) => ids.includes(option.userId) ? ids.filter((id) => id !== option.userId) : [...ids, option.userId])} /><Avatar name={option.name} /><span>{option.name}</span></label>)}
          </fieldset>
          {loading && <p className="work-hint">Đang tải thành viên…</p>}
          {cursor && <button type="button" className="work-secondary" disabled={loading} onClick={() => void loadMore()}>Tải thêm thành viên</button>}
          {error && <p className="work-error" role="alert">{workError(error)}</p>}
          <footer><button type="button" className="work-secondary" disabled={busy} onClick={() => setEditing(false)}>Đóng</button><button className="work-primary" disabled={busy || !!error}>Lưu người theo dõi</button></footer>
        </form>
      </dialog>}
    </>
  );
}
