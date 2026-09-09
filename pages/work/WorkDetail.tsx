import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, Pin, PinOff, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { WorkCollaborationCommand, WorkDetailContext, WorkLifecycleCommand, WorkTaskDetail } from "../../lib/work/workTypes";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import type { WorkMutationSession } from "../../lib/work/workMutation";
import { workError } from "../../lib/work/workForm";
import { workStatusLabels, workWhen } from "../../lib/work/workPresentation";
import { WorkActions } from "./WorkActions";
import { WorkAttachments, type WorkUploadState } from "./WorkAttachments";
import { WorkChecklist } from "./WorkChecklist";
import { WorkDiscussion } from "./WorkDiscussion";
import { WorkTaskChildren } from "./WorkTaskChildren";
import { WorkTaskHeader } from "./WorkTaskHeader";
import { WorkTaskPeople } from "./WorkTaskPeople";
import { WorkTaskDescription, WorkTaskProgress, WorkTaskResult } from "./WorkTaskContent";

export function WorkDetail({ detail, service, attachments, actorId, session, uploads, refresh, revision, anchorId, onAnchor, headerActions }: {
  detail: WorkTaskDetail;
  service: WorkTaskService;
  attachments: ReturnType<typeof createWorkAttachmentService>;
  actorId: string;
  session: WorkMutationSession;
  uploads: WorkUploadState;
  refresh: () => void;
  revision: number;
  anchorId: string | null;
  onAnchor: (id: string) => void;
  headerActions?: ReactNode;
}) {
  const { task, capabilities: caps } = detail;
  const [context, setContext] = useState<WorkDetailContext>({ names: {}, scopeName: "", bucketName: null });
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [contextError, setContextError] = useState<unknown>(null);
  const [contextRetry, setContextRetry] = useState(0);
  const [busy, setBusy] = useState(session.running);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [completed, setCompleted] = useState({ command: "", seq: 0 });
  const [metadata, setMetadata] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (metadata) dialog.current?.showModal(); }, [metadata]);
  const requestNames = useCallback((ids: string[]) => setExtraIds((old) => {
    const next = [...new Set([...old, ...ids.filter(Boolean)])];
    return next.length === old.length ? old : next;
  }), []);
  const ids = [...new Set([
    task.created_by,
    task.reviewer_user_id,
    ...detail.assignments.flatMap((a) => [a.user_id, a.assigned_by]),
    ...detail.participants.map((p) => p.user_id),
    ...detail.attachments.map((f) => f.uploader_user_id),
    ...(detail.currentSubmission ? [detail.currentSubmission.submitted_by, detail.currentSubmission.reviewed_by] : []),
    ...extraIds,
  ].filter((id): id is string => !!id))];
  useEffect(() => {
    let live = true;
    setContextError(null);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    if (!chunks.length) chunks.push([]);
    Promise.all(chunks.map((chunk) => service.detailContext(task.id, chunk))).then((results) => {
      if (live) setContext({ ...results[0], names: Object.assign({}, ...results.map((result) => result.names)) });
    }).catch((caught) => live && setContextError(caught));
    return () => { live = false; };
  }, [task.id, service, JSON.stringify(ids), contextRetry]);
  useEffect(() => {
    if (!session.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [tick, session.pending]);

  async function retry() {
    if (session.running || !session.pending) return false;
    const pendingRequest = session.pending;
    setBusy(true);
    setError(null);
    try {
      await session.run(service);
      if (alive.current) {
        setNotice("Đã ghi nhận thay đổi.");
        if (pendingRequest.taskId === task.id) setCompleted((value) => ({ command: pendingRequest.input.command, seq: value.seq + 1 }));
        refresh();
      }
      return true;
    } catch (caught) {
      if (alive.current) { setError(caught); if (!session.pending) refresh(); }
      return false;
    } finally {
      if (alive.current) { setBusy(false); setTick((value) => value + 1); }
    }
  }
  async function run(kind: "lifecycle" | "collaboration", input: WorkLifecycleCommand | WorkCollaborationCommand, version = task.lock_version) {
    if (input.command === "submit" && (uploads.busy || uploads.items.some((item) => !item.ready))) {
      setError(new Error("WORK_UPLOADS_PENDING"));
      return false;
    }
    try { session.begin(task.id, kind, input, version); }
    catch (caught) { setError(caught); return false; }
    return retry();
  }
  const collab = (input: WorkCollaborationCommand) => run("collaboration", input);
  const pending = !!session.pending;
  const locked = busy || pending;
  const name = (id: string | null) => id ? context.names[id] || "Người tham gia" : "Chưa chỉ định";
  const mine = detail.assignments.find((assignment) => assignment.user_id === actorId && !assignment.ended_at);
  const lead = detail.assignments.find((assignment) => !assignment.ended_at);
  const people = <WorkTaskPeople detail={detail} service={service} actorId={actorId} names={context.names} busy={locked} run={collab} />;

  return (
    <div className="work-detail-shell">
      <div className="work-detail-layout">
        <div className="work-detail-pane">
          <main className="work-detail-content">
            {notice && <p role="status" className="work-success">{notice}</p>}
            {error && <p role="alert" className="work-error">{workError(error)}</p>}
            {pending && <div className="work-notice" role="status">Yêu cầu {session.pending!.taskId === task.id ? "của công việc này" : "của công việc khác"} chưa rõ kết quả. Giữ nguyên yêu cầu khi thử lại. {session.pending!.taskId !== task.id && <Link to={`/work/tasks/${session.pending!.taskId}`}>Mở công việc đó</Link>} <button disabled={busy} className="work-secondary" onClick={() => void retry()}>Thử lại đúng yêu cầu</button></div>}
            {contextError && <p role="alert" className="work-error">{workError(contextError)} <button onClick={() => setContextRetry((value) => value + 1)}>Tải lại tên người tham gia</button></p>}

            <WorkTaskHeader
              detail={detail}
              scopeName={context.scopeName}
              bucketName={context.bucketName}
              busy={locked}
              run={collab}
              actions={headerActions}
              assigneeName={lead ? name(lead.user_id) : null}
              assigneeState={lead ? workStatusLabels[lead.state as keyof typeof workStatusLabels] || "Đã chuyển" : null}
            />
            <div className="work-preferences">
              {caps.canSetPreferences && <>
                <button className="work-secondary" disabled={locked} aria-pressed={detail.preferences.pinned} onClick={() => void collab({ command: "set_pin", payload: { pinned: !detail.preferences.pinned } })}>{detail.preferences.pinned ? <PinOff size={16} /> : <Pin size={16} />} {detail.preferences.pinned ? "Bỏ ghim" : "Ghim"}</button>
                <button className="work-secondary" disabled={locked} aria-pressed={!detail.preferences.notificationsEnabled} onClick={() => void collab({ command: "set_notifications", payload: { notificationsEnabled: !detail.preferences.notificationsEnabled } })}>{detail.preferences.notificationsEnabled ? <BellOff size={16} /> : <Bell size={16} />} {detail.preferences.notificationsEnabled ? "Tắt thông báo thường" : "Bật thông báo thường"}</button>
              </>}
              <button className="work-secondary work-metadata-trigger" onClick={() => setMetadata(true)}><UsersRound size={16} /> Trách nhiệm & SLA</button>
            </div>
            {!detail.preferences.notificationsEnabled && <p className="work-hint">Thông báo bắt buộc vẫn được gửi theo chính sách.</p>}
            {mine && !mine.acknowledged_at && <p className="work-notice">Bạn chưa xác nhận nhận việc. Hạn xác nhận: {workWhen(mine.acknowledgement_due_at)}.</p>}
            {task.blocked_reason && <p className="work-notice">Đang bị chặn: {task.blocked_reason}</p>}

            <WorkTaskProgress task={task} canUpdate={!!caps.canUpdateProgress} busy={locked} run={collab} />
            <WorkTaskDescription task={task} canUpdate={!!caps.canUpdateDescription} busy={locked} run={collab} />
            <WorkChecklist items={detail.checklist} assignments={detail.assignments} names={context.names} canManage={caps.canManageChecklist} busy={locked} run={collab} completed={completed} error={error} />
            <WorkTaskResult task={task} currentSubmission={detail.currentSubmission} canUpdate={!!caps.canUpdateResultDraft} busy={locked} run={collab} submitterName={name} />
            <WorkAttachments taskId={task.id} files={detail.attachments} caps={caps} service={attachments} onChanged={refresh} uploads={uploads} locked={locked} />
            {!task.parent_task_id && <WorkTaskChildren detail={detail} service={service} attachments={attachments} scopeLabel={context.scopeName} revision={revision} onCreated={() => refresh()} />}
            <WorkDiscussion taskId={task.id} service={service} canComment={caps.canComment} canHistory={caps.canViewHistory} names={context.names} requestNames={requestNames} revision={revision} run={collab} busy={locked} anchorId={anchorId} onAnchor={onAnchor} completed={completed} error={error} />
          </main>
          <WorkActions detail={detail} service={service} run={(input, version) => run("lifecycle", input, version)} retry={retry} busy={busy || uploads.busy} pending={pending} error={error} names={context.names} />
        </div>
        {people}
      </div>
      {metadata && <dialog className="work-metadata-sheet" ref={dialog} onCancel={() => setMetadata(false)} aria-label="Trách nhiệm và SLA"><button className="work-secondary" onClick={() => setMetadata(false)}>Đóng thông tin</button>{people}</dialog>}
    </div>
  );
}
