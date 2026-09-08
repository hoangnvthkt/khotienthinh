import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  WorkTaskDetail,
  WorkCollaborationCommand,
  WorkLifecycleCommand,
  WorkDetailContext,
} from "../../lib/work/workTypes";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import type { WorkMutationSession } from "../../lib/work/workMutation";
import { documentText, workError } from "../../lib/work/workForm";
import { workStatusLabels, workWhen } from "../../lib/work/workPresentation";
import { WorkActions } from "./WorkActions";
import { WorkChecklist } from "./WorkChecklist";
import { WorkDiscussion } from "./WorkDiscussion";
import { WorkAttachments, type WorkUploadState } from "./WorkAttachments";
export function WorkDetail({
  detail,
  service,
  attachments,
  actorId,
  session,
  uploads,
  refresh,
  revision,
  anchorId,
  onAnchor,
}: {
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
}) {
  const { task, capabilities: caps } = detail;
  const [allWatchers, setAllWatchers] = useState(false);
  const watchers = detail.participants.filter(
    (p) => p.participant_role === "watcher",
  );
  const [context, setContext] = useState<WorkDetailContext>({
      names: {},
      scopeName: "",
      bucketName: null,
    }),
    [extraIds, setExtraIds] = useState<string[]>([]),
    [contextError, setContextError] = useState<unknown>(null),
    [contextRetry, setContextRetry] = useState(0);
  const [busy, setBusy] = useState(session.running),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(""),
    [completed, setCompleted] = useState<{ command: string; seq: number }>({
      command: "",
      seq: 0,
    }),
    [metadata, setMetadata] = useState(false);
  const alive = useRef(true),
    dialog = useRef<HTMLDialogElement>(null),
    [tick, setTick] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (metadata) dialog.current?.showModal();
  }, [metadata]);
  const requestNames = useCallback(
    (ids: string[]) =>
      setExtraIds((old) => {
        const next = [...new Set([...old, ...ids.filter(Boolean)])];
        return next.length === old.length ? old : next;
      }),
    [],
  );
  const ids = [
    ...new Set(
      [
        task.created_by,
        task.reviewer_user_id,
        ...detail.assignments.flatMap((a) => [a.user_id, a.assigned_by]),
        ...detail.participants.map((p) => p.user_id),
        ...detail.attachments.map((f) => f.uploader_user_id),
        ...(detail.currentSubmission
          ? [
              detail.currentSubmission.submitted_by,
              detail.currentSubmission.reviewed_by,
            ]
          : []),
        ...extraIds,
      ].filter((id): id is string => !!id),
    ),
  ];
  useEffect(() => {
    let live = true;
    setContextError(null);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100)
      chunks.push(ids.slice(i, i + 100));
    if (!chunks.length) chunks.push([]);
    Promise.all(chunks.map((c) => service.detailContext(task.id, c)))
      .then((results) => {
        if (live)
          setContext({
            ...results[0],
            names: Object.assign({}, ...results.map((r) => r.names)),
          });
      })
      .catch((e) => {
        if (live) setContextError(e);
      });
    return () => {
      live = false;
    };
  }, [task.id, service, JSON.stringify(ids), contextRetry]);
  useEffect(() => {
    if (!session.pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [tick, session.pending]);
  async function retry() {
    if (session.running) return false;
    const p = session.pending;
    if (!p) return false;
    setBusy(true);
    setError(null);
    try {
      await session.run(service);
      if (alive.current) {
        setNotice("Đã ghi nhận thay đổi.");
        if (p.taskId === task.id)
          setCompleted((c) => ({ command: p.input.command, seq: c.seq + 1 }));
        refresh();
      }
      return true;
    } catch (e) {
      if (alive.current) {
        setError(e);
        if (!session.pending) refresh();
      }
      return false;
    } finally {
      if (alive.current) {
        setBusy(false);
        setTick((x) => x + 1);
      }
    }
  }
  async function run(
    kind: "lifecycle" | "collaboration",
    input: WorkLifecycleCommand | WorkCollaborationCommand,
    version = task.lock_version,
  ) {
    if (
      input.command === "submit" &&
      (uploads.busy || uploads.items.some((i) => !i.ready))
    ) {
      setError(new Error("WORK_UPLOADS_PENDING"));
      return false;
    }
    try {
      session.begin(task.id, kind, input, version);
    } catch (e) {
      setError(e);
      return false;
    }
    return retry();
  }
  const collab = (input: WorkCollaborationCommand) =>
    run("collaboration", input);
  const pending = !!session.pending,
    locked = busy || pending;
  const name = (id: string | null) =>
    id ? context.names[id] || "Người tham gia" : "Chưa chỉ định";
  const mine = detail.assignments.find(
    (a) => a.user_id === actorId && !a.ended_at,
  );
  const people = (
    <>
      <h3>Trách nhiệm</h3>
      <dl className="work-metadata">
        <dt>Người tạo</dt>
        <dd>{name(task.created_by)}</dd>
        <dt>Người đánh giá</dt>
        <dd>
          {task.review_policy === "auto_complete"
            ? "Tự hoàn thành"
            : name(task.reviewer_user_id)}
        </dd>
        <dt>Phạm vi</dt>
        <dd>
          {context.scopeName || "Đang tải…"}
          {context.bucketName ? ` · ${context.bucketName}` : ""}
        </dd>
        <dt>Quyền xem</dt>
        <dd>{task.privacy === "restricted" ? "Hạn chế" : "Theo phạm vi"}</dd>
        <dt>Deadline chung</dt>
        <dd>{workWhen(task.deadline_at)}</dd>
      </dl>
      <h4>
        Người nhận ·{" "}
        {detail.assignments.filter((a) => a.acknowledged_at).length}/
        {detail.assignments.length} đã nhận
      </h4>
      <ul className="work-assignees">
        {detail.assignments.map((a) => (
          <li key={a.id}>
            <strong>
              {name(a.user_id)}
              {a.user_id === actorId ? " (bạn)" : ""}
            </strong>
            <small>Người giao: {name(a.assigned_by)}</small>
            <span>
              {workStatusLabels[a.state as keyof typeof workStatusLabels] ||
                "Đã chuyển"}
            </span>
            {a.acknowledged_at ? (
              <small>Đã nhận: {workWhen(a.acknowledged_at)}</small>
            ) : (
              <small
                className={
                  a.acknowledgement_due_at &&
                  Date.parse(a.acknowledgement_due_at) < Date.now() &&
                  !a.ended_at
                    ? "work-overdue"
                    : ""
                }
              >
                Hạn nhận: {workWhen(a.acknowledgement_due_at)}
              </small>
            )}
            <small>Hạn SLA thực hiện: {workWhen(a.execution_sla_due_at)}</small>
            {a.clarification_note && (
              <p className="work-prose">{a.clarification_note}</p>
            )}
          </li>
        ))}
      </ul>
      <h4>Người theo dõi</h4>
      <ul className="work-watchers">
        {watchers.slice(0, allWatchers ? watchers.length : 5).map((p) => (
          <li key={p.id}>
            <span className="work-avatar" aria-hidden="true">
              {name(p.user_id).split(" ").at(-1)?.slice(0, 1)}
            </span>
            {name(p.user_id)}
          </li>
        ))}
      </ul>
      {watchers.length > 5 && (
        <button
          type="button"
          className="work-text-button"
          onClick={() => setAllWatchers(!allWatchers)}
        >
          {allWatchers ? "Thu gọn" : `+${watchers.length - 5} người theo dõi`}
        </button>
      )}
      {!watchers.length && <p>Chưa có người theo dõi.</p>}
      <small>Tạo lúc {workWhen(task.created_at)}</small>
    </>
  );
  return (
    <div className="work-detail-layout">
      <div className="work-detail-content">
        {notice && (
          <p role="status" className="work-success">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="work-error">
            {workError(error)}
          </p>
        )}
        {pending && (
          <div className="work-notice" role="status">
            Yêu cầu{" "}
            {session.pending!.taskId === task.id
              ? "của công việc này"
              : "của công việc khác"}{" "}
            chưa rõ kết quả. Giữ nguyên yêu cầu khi thử lại.{" "}
            {session.pending!.taskId !== task.id && (
              <Link to={`/work/tasks/${session.pending!.taskId}`}>
                Mở công việc đó
              </Link>
            )}
            <button
              disabled={busy}
              className="work-secondary"
              onClick={() => void retry()}
            >
              Thử lại đúng yêu cầu
            </button>
          </div>
        )}
        {contextError && (
          <p role="alert">
            {workError(contextError)}{" "}
            <button onClick={() => setContextRetry((x) => x + 1)}>
              Tải lại tên người tham gia
            </button>
          </p>
        )}
        <div className="work-detail-tags">
          <span className={`work-detail-priority priority-${task.priority}`}>
            {
              {
                normal: "Bình thường",
                important: "Quan trọng",
                urgent: "Khẩn cấp",
              }[task.priority]
            }
          </span>
          <span className={`work-status status-${task.status}`}>
            {workStatusLabels[task.status]}
          </span>
          <span>
            {context.scopeName}
            {context.bucketName ? ` · ${context.bucketName}` : ""}
          </span>
          <time>{workWhen(task.deadline_at)}</time>
        </div>
        <div className="work-preferences">
          {caps.canSetPreferences && (
            <>
              <button
                className="work-secondary"
                disabled={locked}
                aria-pressed={detail.preferences.pinned}
                onClick={() =>
                  void collab({
                    command: "set_pin",
                    payload: { pinned: !detail.preferences.pinned },
                  })
                }
              >
                {detail.preferences.pinned ? "Bỏ ghim" : "Ghim công việc"}
              </button>
              <button
                className="work-secondary"
                disabled={locked}
                aria-pressed={!detail.preferences.notificationsEnabled}
                onClick={() =>
                  void collab({
                    command: "set_notifications",
                    payload: {
                      notificationsEnabled:
                        !detail.preferences.notificationsEnabled,
                    },
                  })
                }
              >
                {detail.preferences.notificationsEnabled
                  ? "Tắt thông báo thường"
                  : "Bật thông báo thường"}
              </button>
            </>
          )}
          <button
            className="work-secondary work-metadata-trigger"
            onClick={() => setMetadata(true)}
          >
            Trách nhiệm & SLA
          </button>
        </div>
        {!detail.preferences.notificationsEnabled && (
          <p className="work-hint">
            Thông báo bắt buộc vẫn được gửi theo chính sách.
          </p>
        )}
        {mine && !mine.acknowledged_at && (
          <p className="work-notice">
            Bạn chưa xác nhận nhận việc. Hạn xác nhận:{" "}
            {workWhen(mine.acknowledgement_due_at)}.
          </p>
        )}
        {task.blocked_reason && (
          <p className="work-notice">Đang bị chặn: {task.blocked_reason}</p>
        )}
        <section className="work-section">
          <h3>Mô tả</h3>
          <p className="work-prose">
            {task.description_text ||
              documentText(task.description_document) ||
              "Chưa có mô tả."}
          </p>
          {task.labels?.length > 0 && (
            <div className="work-chips">
              {task.labels.map((l, i) => (
                <span className="work-chip" key={i}>
                  {l}
                </span>
              ))}
            </div>
          )}
        </section>
        <WorkChecklist
          items={detail.checklist}
          assignments={detail.assignments}
          names={context.names}
          canManage={caps.canManageChecklist}
          busy={locked}
          run={collab}
          completed={completed}
          error={error}
        />
        <section className="work-section">
          <h3>Kết quả</h3>
          {detail.currentSubmission ? (
            <>
              <p>
                Lần nộp {detail.currentSubmission.iteration} ·{" "}
                {name(detail.currentSubmission.submitted_by)} ·{" "}
                {workWhen(detail.currentSubmission.submitted_at)}
              </p>
              <p className="work-prose">
                {detail.currentSubmission.result_text}
              </p>
              <strong>
                {
                  {
                    pending_review: "Chờ đánh giá",
                    approved: "Đã duyệt",
                    changes_requested: "Cần chỉnh sửa",
                  }[detail.currentSubmission.status]
                }
              </strong>
              {detail.currentSubmission.review_note && (
                <p className="work-prose">
                  {detail.currentSubmission.review_note}
                </p>
              )}
            </>
          ) : (
            <p>Chưa nộp kết quả.</p>
          )}
        </section>
        <WorkAttachments
          taskId={task.id}
          files={detail.attachments}
          caps={caps}
          service={attachments}
          onChanged={refresh}
          uploads={uploads}
          locked={locked}
        />
        <WorkDiscussion
          taskId={task.id}
          service={service}
          canComment={caps.canComment}
          canHistory={caps.canViewHistory}
          names={context.names}
          requestNames={requestNames}
          revision={revision}
          run={collab}
          busy={locked}
          anchorId={anchorId}
          onAnchor={onAnchor}
          completed={completed}
          error={error}
        />
        <WorkActions
          detail={detail}
          service={service}
          run={(input, version) => run("lifecycle", input, version)}
          retry={retry}
          busy={busy || uploads.busy}
          pending={pending}
          error={error}
          names={context.names}
        />
      </div>
      <aside className="work-responsibility">{people}</aside>
      {metadata && (
        <dialog
          className="work-metadata-sheet"
          ref={dialog}
          onCancel={() => setMetadata(false)}
          aria-label="Trách nhiệm và SLA"
        >
          <button className="work-secondary" onClick={() => setMetadata(false)}>
            Đóng thông tin
          </button>
          {people}
        </dialog>
      )}
    </div>
  );
}
