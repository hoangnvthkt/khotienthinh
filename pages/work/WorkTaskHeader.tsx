import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock3, MessagesSquare, PenLine } from "lucide-react";
import type {
  WorkCollaborationCommand,
  WorkTaskDetail,
} from "../../lib/work/workTypes";
import { localDeadline, validateWorkSchedule, workError } from "../../lib/work/workForm";
import { workDayLabel, workDueInfo, workLevelLabels, workLevelOf, workStatusLabels, workUpdateInfo, workWhen } from "../../lib/work/workPresentation";
import type { WorkTaskBrief } from "../../lib/work/workBoardService";

export function WorkTaskHeader({
  detail,
  scopeName,
  bucketName,
  busy,
  run,
  actions,
  assigneeName,
  assigneeState,
  creatorName,
  reviewerName,
  brief,
}: {
  detail: WorkTaskDetail;
  scopeName: string;
  bucketName: string | null;
  busy: boolean;
  run: (input: WorkCollaborationCommand) => Promise<boolean>;
  actions?: ReactNode;
  assigneeName: string | null;
  assigneeState: string | null;
  /** Đợt 1: dải "người giao → người làm · người duyệt · hạn". */
  creatorName?: string;
  reviewerName?: string;
  brief?: WorkTaskBrief | null;
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

  const level = workLevelOf(task.priority);
  const due = workDueInfo(task.deadline_at, task.status);
  const update = workUpdateInfo(brief?.task.lastProgressAt, task.status);
  const origin = brief?.origin;
  const initial = (name: string | null | undefined) => (name || "?").trim().split(/\s+/).at(-1)?.[0] || "?";

  return (
    <header className="work-task-header">
      <div className="work-task-hero-top">
        <div className="work-task-kicker">
          <span className={`work-level-chip level-${level}`} title={workLevelLabels[task.priority]}>{level}</span>
          <span className="work-level-text">{workLevelLabels[task.priority].slice(4)}</span>
          <span className={`work-status status-${task.status}`}>
            {workStatusLabels[task.status]}
          </span>
          {task.labels.map((label) => (
            <span className="work-task-label" key={label}>#{label}</span>
          ))}
          {origin?.origin === "directive" && (
            <span className="work-origin-chip"><MessagesSquare size={13} aria-hidden="true" /> Chỉ đạo{origin.meeting ? ` · ${origin.meeting.title}` : ""}</span>
          )}
          {origin?.origin === "oral_claim" && (
            <span className={`work-origin-chip is-${origin.claimStatus}`}>
              <PenLine size={13} aria-hidden="true" /> Giao trực tiếp{origin.giver ? ` · ${origin.giver.name}` : ""}
              {origin.claimStatus === "pending" ? " · chờ xác nhận" : origin.claimStatus === "confirmed" ? " · đã xác nhận" : origin.claimStatus === "rejected" ? " · không xác nhận" : ""}
            </span>
          )}
        </div>
        <div className="work-task-tools">
          <span className="work-task-code">{task.task_code}</span>
          {actions}
        </div>
      </div>
      <h2>{task.title}</h2>
      <div className="work-flow" aria-label="Giao và hạn">
        <div className="work-flow-p">
          <span className="work-avatar" aria-hidden="true">{initial(creatorName)}</span>
          <span><small>Người giao</small><strong>{creatorName || "Đang tải…"}</strong></span>
        </div>
        <span className="work-flow-arrow" aria-hidden="true">→</span>
        <div className="work-flow-p">
          <span className="work-avatar" aria-hidden="true">{initial(assigneeName)}</span>
          <span><small>Người làm</small><strong>{assigneeName || "Chưa có"}</strong>{assigneeState && <em>{assigneeState}</em>}</span>
        </div>
        <div className="work-flow-p work-flow-reviewer">
          <span className="work-avatar" aria-hidden="true">{task.review_policy === "auto_complete" ? "✓" : initial(reviewerName)}</span>
          <span><small>Người duyệt</small><strong>{task.review_policy === "auto_complete" ? "Tự hoàn thành" : reviewerName || "Người giao"}</strong></span>
        </div>
        <div className={`work-flow-p work-flow-due tone-${due.tone}`}>
          <span className="work-flow-clock" aria-hidden="true"><Clock3 size={16} /></span>
          <span><small>Hạn</small><strong>{task.deadline_at ? workDayLabel(task.deadline_at) : "Chưa có"}</strong>{task.deadline_at && <em>{due.text}</em>}</span>
          {detail.capabilities.canManageSchedule && (
            <button className="work-text-button" disabled={busy} onClick={() => setEditing(true)}>Đổi hạn</button>
          )}
        </div>
      </div>
      <div className="work-flow-progress">
        <span className="work-flow-bar" aria-hidden="true"><i style={{ width: `${task.progress_percent}%` }} /></span>
        <b>{task.progress_percent}%</b>
        {update && <span className={update.stale ? "work-stale" : "work-hint"}>{update.text}</span>}
        <span className="work-flow-sub">
          {scopeName || "Đang tải…"}{bucketName ? ` / ${bucketName}` : ""}
          {task.planned_start_at ? ` · bắt đầu ${workWhen(task.planned_start_at)}` : ""}
          {task.completed_at ? ` · hoàn thành ${workWhen(task.completed_at)}` : task.started_at ? ` · đang làm từ ${workWhen(task.started_at)}` : ""}
        </span>
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
