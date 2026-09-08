import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Clock3, Eye, Plus, UserRoundCheck } from "lucide-react";
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
  const activeAssignments = detail.assignments.filter((assignment) => !assignment.ended_at);
  const sla = activeAssignments[0]?.sla_snapshot as Record<string, unknown> | undefined;
  const slaConfig = (sla?.execution || sla?.acknowledgement) as Record<string, unknown> | undefined;
  const calendar = slaConfig?.calendar as Record<string, unknown> | undefined;
  const weekdays = Array.isArray(calendar?.working_weekdays) ? calendar.working_weekdays as number[] : [];
  const intervals = Array.isArray(calendar?.working_intervals) ? calendar.working_intervals as Array<{ start?: string; end?: string }> : [];
  const schedule = intervals.length
    ? intervals.map((item) => `${String(item.start || "").slice(0, 5)}–${String(item.end || "").slice(0, 5)}`).join(" · ")
    : calendar?.workday_start && calendar?.workday_end
      ? `${String(calendar.workday_start).slice(0, 5)}–${String(calendar.workday_end).slice(0, 5)}`
      : "Theo lịch làm việc của phạm vi";

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
        <section className="work-side-card">
          <h3 className="work-side-title">Người giao việc <ChevronDown size={13} aria-hidden="true" /></h3>
          <div className="work-side-body"><div className="work-side-person"><Avatar name={name(detail.task.created_by)} /><span><strong>{name(detail.task.created_by)}</strong><small>Người tạo công việc</small></span></div></div>
        </section>
        <section className="work-side-card">
          <h3 className="work-side-title">Người thực hiện <span>{activeAssignments.length}</span></h3>
          <div className="work-side-body">{activeAssignments.map((assignment) => <div className="work-side-person" key={assignment.id}><Avatar name={name(assignment.user_id)} /><span><strong>{name(assignment.user_id)}{assignment.user_id === actorId ? " (bạn)" : ""}</strong><small>{workStatusLabels[assignment.state as keyof typeof workStatusLabels] || "Đã chuyển"} · SLA {workWhen(assignment.execution_sla_due_at)}</small></span></div>)}</div>
        </section>
        <section className="work-side-card">
          <h3 className="work-side-title">Người theo dõi <span>{watchers.length}</span></h3>
          <div className="work-side-body">
            {watchers.map((watcher) => <div className="work-side-person" key={watcher.id}><Avatar name={name(watcher.user_id)} /><span><strong>{name(watcher.user_id)}</strong><small>Theo dõi cập nhật</small></span></div>)}
            {!watchers.length && <p className="work-side-note"><Eye size={14} aria-hidden="true" /> Chưa có người theo dõi.</p>}
          </div>
          {detail.capabilities.canManageWatchers && <div className="work-side-actions"><button type="button" disabled={busy} onClick={() => setEditing(true)} aria-label="Thêm / bỏ người theo dõi"><Plus size={13} aria-hidden="true" /> Thêm / bỏ người theo dõi</button></div>}
        </section>
        <section className="work-side-card">
          <h3 className="work-side-title">Duyệt kết quả <ChevronDown size={13} aria-hidden="true" /></h3>
          <div className="work-side-body"><div className="work-side-person"><UserRoundCheck size={25} aria-hidden="true" /><span><strong>{detail.task.review_policy === "auto_complete" ? "Tự hoàn thành" : name(detail.task.reviewer_user_id)}</strong><small>{detail.task.review_policy === "auto_complete" ? "Không cần duyệt thủ công" : "Duyệt kết quả"}</small></span></div></div>
        </section>
        <section className="work-side-card">
          <h3 className="work-side-title">Lịch làm việc & SLA <ChevronDown size={13} aria-hidden="true" /></h3>
          <div className="work-side-body work-side-schedule"><span><CalendarDays size={14} aria-hidden="true" /> {weekdays.length === 6 && weekdays[0] === 1 && weekdays[5] === 6 ? "Thứ Hai – Thứ Bảy" : weekdays.length ? `${weekdays.length} ngày làm việc / tuần` : "Lịch theo phạm vi"}</span><strong>{schedule}</strong><p>Ngày bắt đầu và kết thúc là lịch dự kiến. SLA tính theo lịch làm việc của phạm vi.</p></div>
        </section>
        <section className="work-side-card work-side-timestamps">
          <span><Clock3 size={14} aria-hidden="true" /> Tạo: <strong>{workWhen(detail.task.created_at)}</strong></span>
          <span><Clock3 size={14} aria-hidden="true" /> Cập nhật: <strong>{workWhen(detail.task.updated_at)}</strong></span>
        </section>
        {detail.capabilities.canViewHistory && <a className="work-side-history" href="#work-task-history">Lịch sử hoạt động <ChevronDown size={13} aria-hidden="true" /></a>}
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
