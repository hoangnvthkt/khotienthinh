import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock3, Flag, Layers3 } from "lucide-react";
import type {
  WorkCollaborationCommand,
  WorkTaskDetail,
} from "../../lib/work/workTypes";
import { localDeadline, validateWorkSchedule, workError } from "../../lib/work/workForm";
import { workStatusLabels, workWhen } from "../../lib/work/workPresentation";

export function WorkTaskHeader({
  detail,
  scopeName,
  bucketName,
  busy,
  run,
}: {
  detail: WorkTaskDetail;
  scopeName: string;
  bucketName: string | null;
  busy: boolean;
  run: (input: WorkCollaborationCommand) => Promise<boolean>;
}) {
  const { task } = detail;
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(localDeadline(task.planned_start_at || undefined));
  const [end, setEnd] = useState(localDeadline(task.deadline_at || undefined));
  const [error, setError] = useState<unknown>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (editing) dialog.current?.showModal();
  }, [editing]);
  useEffect(() => {
    setStart(localDeadline(task.planned_start_at || undefined));
    setEnd(localDeadline(task.deadline_at || undefined));
  }, [task.id, task.lock_version, task.planned_start_at, task.deadline_at]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const schedule = validateWorkSchedule(
        start ? new Date(start).toISOString() : null,
        end ? new Date(end).toISOString() : null,
      );
      setError(null);
      const ok = await run({
        command: "schedule_update",
        payload: { ...schedule, expectedLockVersion: task.lock_version },
      });
      if (ok) setEditing(false);
    } catch (caught) {
      setError(caught);
    }
  }

  const priority = {
    normal: "Bình thường",
    important: "Quan trọng",
    urgent: "Khẩn cấp",
  }[task.priority];

  return (
    <header className="work-task-header">
      <div className="work-task-kicker">
        <span className={`work-detail-priority priority-${task.priority}`}>
          <Flag size={14} aria-hidden="true" /> {priority}
        </span>
        <span className={`work-status status-${task.status}`}>
          {workStatusLabels[task.status]}
        </span>
        {task.labels.map((label) => (
          <span className="work-task-label" key={label}>{label}</span>
        ))}
      </div>
      <h2>{task.title}</h2>
      <p className="work-task-code">{task.task_code}</p>
      <div className="work-task-facts">
        <div>
          <Layers3 size={17} aria-hidden="true" />
          <span><small>Không gian</small><strong>{scopeName || "Đang tải…"}{bucketName ? ` · ${bucketName}` : ""}</strong></span>
        </div>
        <div>
          <CalendarDays size={17} aria-hidden="true" />
          <span><small>Thời hạn</small><strong>{workWhen(task.planned_start_at || null)} → {workWhen(task.deadline_at)}</strong></span>
          {detail.capabilities.canManageSchedule && (
            <button className="work-text-button" disabled={busy} onClick={() => setEditing(true)}>Chỉnh sửa</button>
          )}
        </div>
        {(task.started_at || task.completed_at) && (
          <div>
            <Clock3 size={17} aria-hidden="true" />
            <span><small>Thực tế</small><strong>{workWhen(task.started_at)}{task.completed_at ? ` → ${workWhen(task.completed_at)}` : ""}</strong></span>
          </div>
        )}
      </div>
      {editing && (
        <dialog ref={dialog} className="work-action-dialog" aria-labelledby="work-schedule-title" onCancel={(e) => { e.preventDefault(); if (!busy) setEditing(false); }}>
          <form onSubmit={save}>
            <h2 id="work-schedule-title">Chỉnh thời hạn công việc</h2>
            <div className="work-form-grid">
              <label className="work-label">Ngày bắt đầu<input className="work-input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="work-label">Ngày kết thúc<input className="work-input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            {error && <p role="alert" className="work-error">{workError(error)}</p>}
            <footer><button type="button" className="work-secondary" disabled={busy} onClick={() => setEditing(false)}>Đóng</button><button className="work-primary" disabled={busy}>Lưu thời hạn</button></footer>
          </form>
        </dialog>
      )}
    </header>
  );
}
