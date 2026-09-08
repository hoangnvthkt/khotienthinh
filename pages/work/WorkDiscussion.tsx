import React, { useEffect, useRef, useState } from "react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type {
  WorkCollaborationCommand,
  WorkTaskComment,
  WorkTaskHistoryFilters,
  WorkTaskEvent,
  WorkCommentAnchor,
  WorkTextDocument,
} from "../../lib/work/workTypes";
import { documentText, mentionedUserIds, workDocument, workError } from "../../lib/work/workForm";
import { useWorkFeed } from "../../hooks/work/useWorkFeed";
import { WorkMentionComposer } from "./WorkMentionComposer";
const date = (s: string) => new Date(s).toLocaleString("vi-VN");
const eventLabels: Record<string, string> = {
  "task.created": "Tạo công việc",
  "task.started": "Bắt đầu thực hiện",
  "task.blocked": "Báo bị chặn",
  "task.unblocked": "Tiếp tục thực hiện",
  "task.completed": "Hoàn thành công việc",
  "task.cancelled": "Hủy công việc",
  "task.review_submitted": "Nộp kết quả",
  "task.changes_requested": "Yêu cầu chỉnh sửa",
  "assignment.acknowledged": "Nhận việc",
  "assignment.clarification_requested": "Đề nghị làm rõ",
  "assignment.transferred": "Chuyển việc",
  "assignment.co_assignees_added": "Thêm đồng thực hiện",
  "comment.created": "Thêm bình luận",
  "comment.edited": "Sửa bình luận",
  "comment.mentioned": "Nhắc tên",
  "checklist.created": "Thêm checklist",
  "checklist.updated": "Sửa checklist",
  "checklist.completed": "Hoàn tất checklist",
  "checklist.reopened": "Mở lại mục checklist",
  "checklist.deleted": "Xóa checklist",
  "attachment.ready": "Thêm đính kèm",
  "attachment.deleted": "Xóa đính kèm",
};
export function WorkDiscussion({
  taskId,
  service,
  canComment,
  canHistory,
  revision,
  names,
  requestNames,
  run,
  busy,
  anchorId,
  onAnchor,
  completed,
  error,
}: {
  completed: { command: string; seq: number };
  error: unknown;
  taskId: string;
  service: WorkTaskService;
  canComment: boolean;
  canHistory: boolean;
  revision: number;
  names: Record<string, string>;
  requestNames: (ids: string[]) => void;
  run: (c: WorkCollaborationCommand) => Promise<boolean>;
  busy: boolean;
  anchorId: string | null;
  onAnchor: (id: string) => void;
}) {
  const [editorError, setEditorError] = useState<unknown>(null),
    [editorLoading, setEditorLoading] = useState(false);
  const editorRequest = useRef(0);
  useEffect(
    () => () => {
      editorRequest.current++;
    },
    [],
  );
  const [open, setOpen] = useState(!!anchorId),
    [historyOpen, setHistoryOpen] = useState(false),
    [category, setCategory] = useState<WorkTaskHistoryFilters["category"] | "">(
      "",
    ),
    [actor, setActor] = useState("");
  const [draft, setDraft] = useState<WorkTextDocument>(() => workDocument("")),
    [editing, setEditing] = useState<WorkTaskComment | null>(null),
    [reply, setReply] = useState<WorkTaskComment | null>(null),
    [legacyDraft, setLegacyDraft] = useState(false);
  useEffect(() => {
    if (completed.command.startsWith("comment_")) {
      setDraft(workDocument(""));
      setEditing(null);
      setReply(null);
      setLegacyDraft(false);
    }
  }, [completed.seq]);
  const [anchor, setAnchor] = useState<WorkCommentAnchor | null>(null),
    [anchorError, setAnchorError] = useState<unknown>(null);
  const comments = useWorkFeed(
    `${taskId}:comments`,
    (c) => service.comments(taskId, c),
    open,
    revision,
  );
  const history = useWorkFeed<WorkTaskEvent>(
    JSON.stringify([taskId, category, actor]),
    (c) =>
      service.history(
        taskId,
        {
          ...(category ? { category } : {}),
          ...(actor ? { actorUserId: actor } : {}),
        },
        c,
      ),
    historyOpen && canHistory,
    revision,
  );
  useEffect(() => {
    if (!anchorId) {
      setAnchor(null);
      return;
    }
    let live = true;
    setOpen(true);
    setAnchor(null);
    setAnchorError(null);
    service
      .commentAnchor(taskId, anchorId)
      .then((a) => {
        if (live) setAnchor(a);
      })
      .catch((e) => {
        if (live) setAnchorError(e);
      });
    return () => {
      live = false;
    };
  }, [taskId, anchorId, service, revision]);
  const display = comments.items.filter(
    (c) => c.id !== anchor?.comment.id && c.id !== anchor?.parent?.id,
  );
  const ids = [
    ...comments.items.flatMap((c) => [c.author_user_id, ...c.mentionedUserIds]),
    ...history.items.flatMap((e) => (e.actor_user_id ? [e.actor_user_id] : [])),
    ...(anchor
      ? [
          anchor.comment.author_user_id,
          ...anchor.comment.mentionedUserIds,
          ...(anchor.parent ? [anchor.parent.author_user_id] : []),
        ]
      : []),
  ];
  useEffect(() => requestNames(ids), [JSON.stringify(ids)]);
  useEffect(() => {
    if (anchor)
      document
        .getElementById(`work-comment-${anchor.comment.id}`)
        ?.scrollIntoView({ block: "center" });
  }, [anchor?.comment.id]);
  const name = (id: string) => names[id] || "Người tham gia";
  function edit(c: WorkTaskComment) {
    setEditing(c);
    setReply(null);
    const legacy = !mentionedUserIds(c.content_document).length && c.mentionedUserIds.length > 0;
    setLegacyDraft(legacy);
    if (!legacy)
      setDraft(c.content_document);
    else
      setDraft({ version: 1, type: "doc", content: [{ type: "paragraph", content: c.mentionedUserIds.flatMap((id, index) => [...(index ? [{ type: "text" as const, text: " " }] : []), { type: "mention" as const, userId: id, label: name(id) }]) }, ...workDocument(c.content_text).content] });
  }
  const renderComment = (c: WorkTaskComment, highlight = false) => (
    <article
      key={c.id}
      id={`work-comment-${c.id}`}
      className={`work-comment ${highlight ? "work-comment-highlight" : ""}`}
      tabIndex={-1}
    >
      <header>
        <strong>{name(c.author_user_id)}</strong>
        <time>
          {date(c.created_at)}
          {c.edited_at ? " · đã sửa" : ""}
        </time>
      </header>
      {c.parent_comment_id && (
        <button
          type="button"
          className="work-text-button"
          onClick={() => onAnchor(c.parent_comment_id!)}
        >
          Xem bình luận được trả lời
        </button>
      )}
      <p className="work-prose">{documentText(c.content_document) || c.content_text}</p>
      <div className="work-actions">
        {canComment && (
          <button
            type="button"
            onClick={() => {
              if (busy || editorLoading) return;
              setReply(c);
              setEditing(null);
              setLegacyDraft(false);
              setDraft(workDocument(""));
            }}
          >
            Trả lời
          </button>
        )}
        {c.can_edit && canComment && (
          <button type="button" disabled={busy||editorLoading} onClick={() => edit(c)}>
            Sửa bình luận
          </button>
        )}
      </div>
    </article>
  );
  return (
    <>
      <section className="work-section" id="work-task-discussion">
        <button
          className="work-section-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Thảo luận <span>{open ? "−" : "+"}</span>
        </button>
        {open && (
          <div className="work-collapsible-body">
            {anchorError && (
              <p role="alert" className="work-error">
                {workError(anchorError)}
              </p>
            )}
            {anchor && (
              <div className="work-comment-anchor">
                {anchor.parent && renderComment(anchor.parent)}
                {renderComment(anchor.comment, true)}
              </div>
            )}
            {comments.error && (
              <p role="alert">
                {workError(comments.error)}{" "}
                <button onClick={() => void comments.reload()}>
                  Thử tải bình luận
                </button>
              </p>
            )}
            {comments.loading && !comments.items.length && <p role="status">Đang tải bình luận…</p>}
            {display.map((c) => renderComment(c))}
            {!comments.loading &&
              !comments.error &&
              !display.length &&
              !anchor && <p>Chưa có thảo luận.</p>}
            {comments.cursor && (
              <button
                className="work-secondary"
                disabled={comments.loading}
                onClick={() => void comments.more()}
              >
                Bình luận cũ hơn
              </button>
            )}
            {canComment && (
              <form
                className="work-comment-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const input: WorkCollaborationCommand = editing
                    ? {
                        command: "comment_edit",
                        payload: {
                          commentId: editing.id,
                          expectedLockVersion: editing.lock_version,
                          content: draft,
                        },
                      }
                    : {
                        command: "comment_create",
                        payload: {
                          content: draft,
                          ...(reply ? { parentCommentId: reply.id } : {}),
                        },
                      };
                  if (await run(input)) {
                    setDraft(workDocument(""));
                    setEditing(null);
                    setReply(null);
                    setLegacyDraft(false);
                  }
                }}
              >
                {error && (
                  <p className="work-error" role="alert">
                    {workError(error)}
                  </p>
                )}
                {editing &&
                  (() => {
                    const latest = [
                      ...comments.items,
                      ...(anchor
                        ? [
                            anchor.comment,
                            ...(anchor.parent ? [anchor.parent] : []),
                          ]
                        : []),
                    ].find((c) => c.id === editing.id);
                    const conflicted =
                      (error as { message?: string } | null)?.message ===
                      "WORK_VERSION_CONFLICT";
                    return conflicted ||
                      (latest &&
                        latest.lock_version !== editing.lock_version) ? (
                      <p className="work-notice">
                        Bình luận đã thay đổi.{" "}
                        <button
                          type="button"
                          disabled={busy || editorLoading}
                          onClick={async () => {
                            const request = ++editorRequest.current;
                            setEditorLoading(true);
                            setEditorError(null);
                            try {
                              const result = await service.commentAnchor(
                                taskId,
                                editing.id,
                              );
                              if (request === editorRequest.current)
                                edit(result.comment);
                            } catch (e) {
                              if (request === editorRequest.current)
                                setEditorError(e);
                            } finally {
                              if (request === editorRequest.current)
                                setEditorLoading(false);
                            }
                          }}
                        >
                          Nạp lại bình luận mới
                        </button>
                      </p>
                    ) : null;
                  })()}
                {editorError && (
                  <p role="alert" className="work-error">
                    {workError(editorError)}
                  </p>
                )}
                <fieldset disabled={busy || editorLoading}>
                  {(editing || reply) && (
                    <p>
                      {editing ? "Đang sửa bình luận" : "Đang trả lời"} ·{" "}
                      {name((editing || reply)!.author_user_id)}{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setReply(null);
                          setLegacyDraft(false);
                          setDraft(workDocument(""));
                        }}
                      >
                        Bỏ chọn
                      </button>
                    </p>
                  )}
                  {legacyDraft && (
                    <p className="work-notice">
                      Bình luận cũ đã được chuyển nhắc tên vào nội dung. Hãy kiểm tra lại trước khi lưu.
                    </p>
                  )}
                  <WorkMentionComposer taskId={taskId} service={service} value={draft} onChange={setDraft} disabled={busy || editorLoading} label={editing ? "Sửa nội dung" : "Viết bình luận"} />
                  <p className="work-hint">
                    Nhắc tên chỉ thông báo cho người đã có quyền xem, không thêm
                    người nhận việc.
                  </p>
                  <button
                    className="work-primary"
                    disabled={!documentText(draft).trim() || mentionedUserIds(draft).length > 50}
                  >
                    {editing ? "Lưu bình luận" : "Gửi bình luận"}
                  </button>
                </fieldset>
              </form>
            )}
          </div>
        )}
      </section>
      {canHistory && (
        <section className="work-section" id="work-task-history">
          <button
            className="work-section-toggle"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            Lịch sử hoạt động <span>{historyOpen ? "−" : "+"}</span>
          </button>
          {historyOpen && (
            <div className="work-collapsible-body">
              <div className="work-history-filters">
                <select
                  aria-label="Lọc lịch sử"
                  className="work-input"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as typeof category)
                  }
                >
                  <option value="">Tất cả hoạt động</option>
                  {Object.entries({
                    status: "Trạng thái",
                    assignees: "Người nhận",
                    files: "Tệp",
                    comments: "Bình luận",
                    sla: "SLA",
                    permissions: "Quyền",
                    checklist: "Checklist",
                  }).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Người thực hiện lịch sử"
                  className="work-input"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                >
                  <option value="">Mọi người thực hiện</option>
                  {Object.entries(names).map(([id, n]) => (
                    <option key={id} value={id}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {history.error && (
                <p role="alert">
                  {workError(history.error)}{" "}
                  <button onClick={() => void history.reload()}>
                    Thử tải lịch sử
                  </button>
                </p>
              )}
              {history.loading && !history.items.length && <p role="status">Đang tải lịch sử…</p>}
              {!history.loading && !history.error && !history.items.length && (
                <p>Chưa có hoạt động phù hợp.</p>
              )}
              <ol className="work-history">
                {history.items.map((e) => (
                  <li key={e.id}>
                    <strong>
                      {eventLabels[e.event_type] || "Cập nhật công việc"}
                    </strong>
                    <p>
                      {e.actor_user_id ? name(e.actor_user_id) : "Hệ thống"} ·{" "}
                      {date(e.created_at)} ·{" "}
                      {
                        {
                          human: "Thao tác người dùng",
                          system: "Hệ thống",
                          automation: "Tự động",
                          ai_chatbot: "Trợ lý",
                        }[e.source]
                      }
                    </p>
                    {typeof e.payload.reason === "string" && (
                      <p className="work-prose">{e.payload.reason}</p>
                    )}
                    <details>
                      <summary>Chi tiết ghi nhận</summary>
                      <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                      {e.correlation_id && (
                        <small>Mã đối chiếu: {e.correlation_id}</small>
                      )}
                    </details>
                  </li>
                ))}
              </ol>
              {history.cursor && (
                <button
                  className="work-secondary"
                  disabled={history.loading}
                  onClick={() => void history.more()}
                >
                  Hoạt động cũ hơn
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
