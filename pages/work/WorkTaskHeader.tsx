import React, { useEffect, useRef, useState, type ReactNode } from "react";
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
  actions,
  assigneeName,
  assigneeState,
}: {
  detail: WorkTaskDetail;
  scopeName: string;
  bucketName: string | null;
  busy: boolean;
  run: (input: WorkCollaborationCommand) => Promise<boolean>;
  actions?: ReactNode;
  assigneeName: string | null;
  assigneeState: string | null;
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
      <div className="work-task-hero-top">
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
        <div className="work-task-tools">
          <span className="work-task-code">{task.task_code}</span>
          {actions}
        </div>
      </div>
      <h2>{task.title}</h2>
      <div className="work-task-facts">
        <div className="work-task-fact">
          <span className="work-task-fact-label"><Layers3 size={16} aria-hidden="true" /> Workspace / Nhóm việc</span>
          <span className="work-task-fact-value"><strong>{scopeName || "Đang tải…"}</strong>{bucketName && <><span className="work-fact-separator">/</span><span className="work-task-label">{bucketName}</span></>}</span>
        </div>
        <div className="work-task-fact">
          <span className="work-task-fact-label"><CalendarDays size={16} aria-hidden="true" /> Lịch công việc</span>
          <span className="work-task-fact-value work-task-date-range">
            <span><small>Ngày bắt đầu</small><strong>{workWhen(task.planned_start_at || null)}</strong></span>
            <span className="work-fact-arrow">→</span>
            <span><small>Ngày kết thúc</small><strong>{workWhen(task.deadline_at)}</strong></span>
          </span>
          {detail.capabilities.canManageSchedule && (
            <button className="work-text-button" disabled={busy} onClick={() => setEditing(true)}>Chỉnh sửa</button>
          )}
        </div>
        <div className="work-task-fact">
          <span className="work-task-fact-label"><Clock3 size={16} aria-hidden="true" /> Hoàn thành thực tế</span>
          <span className="work-task-fact-value"><strong>{task.completed_at ? workWhen(task.completed_at) : task.started_at ? `Đã bắt đầu ${workWhen(task.started_at)}` : "Chưa hoàn thành"}</strong></span>
        </div>
      </div>
      <div className="work-task-assignment-line">
        <span className={`work-status status-${task.status}`}>{workStatusLabels[task.status]}</span>
        {assigneeName && (
          <span className="work-task-assignee">
            <span className="work-avatar" aria-hidden="true">{assigneeName.trim().split(/\s+/).at(-1)?.[0]}</span>
            <span><strong>{assigneeName}</strong><small>Người thực hiện{assigneeState ? ` · ${assigneeState}` : ""}</small></span>
          </span>
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
