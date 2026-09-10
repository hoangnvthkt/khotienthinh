import { prepareWorkImage } from "../../lib/work/workImageInput";
import React, { useEffect, useRef, useState } from "react";
import type {
  WorkCloneForm,
  WorkCreationContext,
  WorkTaskService,
} from "../../lib/work/workTaskService";
import type {
  CreateWorkTaskInput,
  WorkRecipientPreview,
  WorkScope,
  WorkTaskCommandResult,
  WorkTaskCursor,
} from "../../lib/work/workTypes";
import type {
  createWorkAttachmentService,
  WorkUploadReservation,
} from "../../lib/work/workAttachmentService";
import {
  deadlineShortcut,
  documentText,
  emptyWorkDraft,
  knownWorkRejection,
  localDeadline,
  scopeFromKey,
  scopeKey,
  WorkCreateAttempt,
  workDocument,
  workError,
  validateWorkSchedule,
} from "../../lib/work/workForm";
import { WorkPicker } from "./WorkPicker";
type AttachmentService = ReturnType<typeof createWorkAttachmentService>;
interface Props {
  service: WorkTaskService;
  attachments: AttachmentService;
  initialScope: WorkScope;
  lockScope?: boolean;
  scopeLabels?: Record<string, string>;
  clone?: WorkCloneForm;
  parentTask?: {
    id: string;
    title: string;
    privacy: CreateWorkTaskInput["privacy"];
    taskGroupId?: string;
    plannedStartAt?: string;
    deadlineAt?: string;
    recipientUserIds?: string[];
  };
  onClose: () => void;
  onCreated: (result: WorkTaskCommandResult) => void;
}
interface PendingFile {
  key: string;
  file: File;
  prepared?: File;
  keepOriginal: boolean;
  reservation?: WorkUploadReservation;
  uploaded?: boolean;
  ready?: boolean;
  error?: string;
  restartable?: boolean;
}
export function WorkCreateDrawer({
  service,
  attachments,
  initialScope,
  lockScope = false,
  scopeLabels,
  clone,
  parentTask,
  onClose,
  onCreated,
}: Props) {
  const [draft, setDraft] = useState<CreateWorkTaskInput>(() => {
    if (clone) return structuredClone(clone.draft);
    const value = emptyWorkDraft(initialScope);
    return parentTask ? {
      ...value,
      parentTaskId: parentTask.id,
      privacy: parentTask.privacy,
      taskGroupId: parentTask.taskGroupId,
      plannedStartAt: parentTask.plannedStartAt,
      deadlineAt: parentTask.deadlineAt,
      recipientSources: (parentTask.recipientUserIds || []).map((id) => ({ type: "user" as const, id })),
    } : value;
  });
  const [context, setContext] = useState<WorkCreationContext | null>(null),
    [contextError, setContextError] = useState<unknown>(null),
    [contextRetry, setContextRetry] = useState(0);
  const [preview, setPreview] = useState<{
      key: string;
      value: WorkRecipientPreview;
    } | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [previewError, setPreviewError] = useState<unknown>(null),
    [previewRetry, setPreviewRetry] = useState(0);
  const [expanded, setExpanded] = useState(false),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState<WorkCreateAttempt | null>(null),
    [created, setCreated] = useState<WorkTaskCommandResult | null>(null),
    [files, setFiles] = useState<PendingFile[]>([]),
    [deadlineConfirmed, setDeadlineConfirmed] = useState(
      !clone?.requiresDeadlineConfirmation,
    );
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]),
    [groupCursor, setGroupCursor] = useState<WorkTaskCursor | null>(null),
    [groupError, setGroupError] = useState<unknown>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    live = useRef(true),
    lock = useRef(false),
    scopeEpoch = useRef(0),
    previewEpoch = useRef(0);
  const scopeId = scopeKey(draft.scope),
    previewKey = JSON.stringify([draft.scope, draft.recipientSources]);
  const currentPreview = useRef(previewKey);
  currentPreview.current = previewKey;
  useEffect(() => {
    live.current = true;
    dialog.current?.showModal();
    return () => {
      live.current = false;
      scopeEpoch.current++;
      previewEpoch.current++;
    };
  }, []);
  useEffect(() => {
    const n = ++scopeEpoch.current;
    setContext(null);
    setContextError(null);
    setGroups([]);
    setGroupCursor(null);
    setGroupError(null);
    service
      .context(draft.scope, draft.priority)
      .then((data) => {
        if (live.current && n === scopeEpoch.current) setContext(data);
      })
      .catch((e) => {
        if (live.current && n === scopeEpoch.current) setContextError(e);
      });
    if (draft.scope.type !== "direct")
      service
        .groups(draft.scope)
        .then((data) => {
          if (live.current && n === scopeEpoch.current) {
            setGroups(data.items);
            setGroupCursor(data.nextCursor);
          }
        })
        .catch((e) => {
          if (live.current && n === scopeEpoch.current) setGroupError(e);
        });
    return () => {
      scopeEpoch.current++;
    };
  }, [service, scopeId, draft.priority, contextRetry]);
  useEffect(() => {
    const n = ++previewEpoch.current;
    setPreview(null);
    setPreviewError(null);
    setPreviewBusy(draft.recipientSources.length > 0);
    if (!draft.recipientSources.length) return;
    const timer = setTimeout(() => {
      service
        .preview(draft.recipientSources, draft.scope)
        .then((value) => {
          if (
            live.current &&
            n === previewEpoch.current &&
            currentPreview.current === previewKey
          )
            setPreview({ key: previewKey, value });
        })
        .catch((e) => {
          if (live.current && n === previewEpoch.current) setPreviewError(e);
        })
        .finally(() => {
          if (live.current && n === previewEpoch.current) setPreviewBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      previewEpoch.current++;
    };
  }, [service, previewKey, previewRetry]);
  useEffect(() => {
    if (!attempt || created) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [attempt, created]);
  const current = preview?.key === previewKey ? preview.value : null;
  const patch = (change: Partial<CreateWorkTaskInput>) => {
    setDraft((d) => ({ ...d, ...change }));
    setError(null);
  };
  const changeScope = (ids: string[]) => {
    if (!ids.length) return;
    setDraft((d) => ({
      ...d,
      scope: scopeFromKey(ids[0]),
      taskGroupId: undefined,
      recipientSources: [],
      watcherUserIds: [],
      reviewerUserId: undefined,
      reviewPolicy: undefined,
      checklist: d.checklist.map((c) => ({ title: c.title })),
    }));
  };
  function close() {
    if (lock.current) return;
    if (
      attempt &&
      !created &&
      !window.confirm(
        "Yêu cầu tạo có thể đã được ghi nhận. Nên thử lại để kiểm tra kết quả trước khi đóng. Vẫn đóng?",
      )
    )
      return;
    if (
      (draft.title || files.length) &&
      !created &&
      !attempt &&
      !window.confirm("Đóng và bỏ nội dung đang soạn?")
    )
      return;
    if (
      created &&
      files.some((f) => !f.ready) &&
      !window.confirm(
        "Công việc đã được tạo nhưng còn tệp chưa tải xong. Đóng cửa sổ này?",
      )
    )
      return;
    onClose();
  }
  async function loadMoreGroups() {
    const n = scopeEpoch.current;
    try {
      const page = await service.groups(draft.scope, groupCursor);
      if (live.current && n === scopeEpoch.current) {
        setGroups((g) => [...g, ...page.items]);
        setGroupCursor(page.nextCursor);
        setGroupError(null);
      }
    } catch (e) {
      if (live.current && n === scopeEpoch.current) setGroupError(e);
    }
  }
  async function uploadFiles(result: WorkTaskCommandResult) {
    const updated = [...files];
    for (let i = 0; i < updated.length; i++) {
      const item = { ...updated[i] };
      if (item.ready) continue;
      item.error = undefined;
      try {
        item.prepared ||= await prepareWorkImage(item.file, item.keepOriginal);
        if (!item.reservation)
          item.reservation = await attachments.begin(
            result.taskId,
            item.prepared,
            "input",
            item.keepOriginal,
            item.key,
          );
        if (!item.uploaded) {
          try {
            await attachments.upload(item.reservation, item.prepared);
          } catch (e) {
            const code = String(
              (e as { statusCode?: string })?.statusCode || "",
            );
            if (code !== "409") throw e;
          }
          item.uploaded = true;
        }
        await attachments.finalize(item.reservation.id);
        item.ready = true;
      } catch (e) {
        item.error = workError(e);
        item.restartable =
          e instanceof Error &&
          ["WORK_ATTACHMENT_EXPIRED", "WORK_INVALID_FILE"].includes(e.message);
      }
      updated[i] = item;
      if (live.current) setFiles([...updated]);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let request = attempt;
    try {
      let result = created;
      if (!result) {
        if (!request) {
          if (
            !current ||
            !current.validCount ||
            previewBusy ||
            !context?.calendarReady ||
            !deadlineConfirmed
          )
            return;
          validateWorkSchedule(draft.plannedStartAt, draft.deadlineAt);
          request = new WorkCreateAttempt(
            {
              ...draft,
              title: draft.title.trim(),
              labels: draft.labels.map((x) => x.trim()).filter(Boolean),
            },
            current.fingerprint,
          );
          setAttempt(request);
        }
        result = await service.create(
          request.input,
          request.key,
          request.fingerprint,
        );
        if (!live.current) return;
        setCreated(result);
        onCreated(result);
      }
      await uploadFiles(result);
    } catch (e) {
      if (live.current) {
        setError(e);
        if (!created && knownWorkRejection(e)) {
          setAttempt(null);
          setPreview(null);
          setPreviewRetry((x) => x + 1);
        }
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  const locked = busy || !!attempt || !!created;
  const excluded: Record<string, string> = {
    NO_APP_ACCOUNT: "Chưa có tài khoản",
    INACTIVE_USER: "Tài khoản ngừng hoạt động",
    ACCOUNT_NOT_ACTIVE: "Tài khoản chưa hoạt động",
    NO_MODULE_ACCESS: "Chưa có quyền Vioo Work",
    NOT_WORKSPACE_MEMBER: "Chưa tham gia không gian này",
    GROUP_NOT_FOUND: "Nhóm không còn tồn tại",
    GROUP_INACTIVE: "Nhóm ngừng hoạt động",
    NO_ACTIVE_MEMBERS: "Nhóm chưa có thành viên hoạt động",
  };
  return (
    <dialog
      ref={dialog}
      className={`work-drawer ${expanded ? "work-drawer-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="work-create-title"
    >
      <form onSubmit={submit}>
        <header>
          <div>
            <p className="work-eyebrow">VIOO WORK</p>
            <h2 id="work-create-title">
              {created
                ? "Đã tạo công việc"
                : clone
                  ? "Nhân bản công việc"
                  : parentTask
                    ? "Tạo công việc con"
                    : "Tạo công việc"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Đóng cửa sổ tạo công việc"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="work-drawer-body">
          {created && (
            <div role="status" className="work-success">
              <strong>{created.taskCode}</strong> đã được tạo.{" "}
              {files.some((f) => !f.ready)
                ? "Kiểm tra các tệp bên dưới."
                : "Bạn có thể đóng cửa sổ và mở công việc."}
            </div>
          )}
          {contextError && (
            <p role="alert" className="work-error">
              {workError(contextError)}{" "}
              <button
                type="button"
                onClick={() => setContextRetry((x) => x + 1)}
              >
                Thử lại cấu hình
              </button>
            </p>
          )}
          {context && !context.calendarReady && (
            <p role="alert" className="work-notice">
              Chưa có lịch làm việc phù hợp. Người quản lý cần hoàn tất cấu hình
              trước khi tạo việc.
            </p>
          )}
          {parentTask && <p className="work-parent-context">Công việc cha <strong>{parentTask.title}</strong>. Công việc con có quy trình và trạng thái độc lập.</p>}
          <fieldset disabled={locked}>
            <label className="work-label">
              Tên công việc *
              <input
                className="work-input"
                autoFocus
                required
                minLength={2}
                maxLength={300}
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Cần hoàn thành việc gì?"
              />
            </label>
            {lockScope ? (
              <label className="work-label">
                Phạm vi
                <output className="work-input work-scope-locked">
                  {scopeLabels?.[scopeId] || clone?.labels?.[scopeId] || "Workspace hiện tại"}
                </output>
              </label>
            ) : (
              <WorkPicker
                service={service}
                kind="scope"
                scope={null}
                label="Phạm vi"
                clearable={false}
                value={[scopeId]}
                onChange={changeScope}
                multiple={false}
                labels={{ direct: "Trực tiếp", ...scopeLabels, ...clone?.labels }}
              />
            )}
            {context?.canAssignUser && (
              <WorkPicker
                key={`${scopeId}:user`}
                service={service}
                kind="user"
                scope={draft.scope}
                label="Người nhận"
                value={draft.recipientSources
                  .filter((x) => x.type === "user")
                  .map((x) => x.id)}
                onChange={(ids) =>
                  patch({
                    recipientSources: [
                      ...draft.recipientSources.filter(
                        (x) => x.type !== "user",
                      ),
                      ...ids.map((id) => ({ type: "user" as const, id })),
                    ],
                  })
                }
                labels={clone?.labels}
              />
            )}
            {context?.canAssignGroup && (
              <WorkPicker
                key={`${scopeId}:group`}
                service={service}
                kind="work_group"
                scope={draft.scope}
                label="Nhóm làm việc"
                value={draft.recipientSources
                  .filter((x) => x.type === "work_group")
                  .map((x) => x.id)}
                onChange={(ids) =>
                  patch({
                    recipientSources: [
                      ...draft.recipientSources.filter(
                        (x) => x.type !== "work_group",
                      ),
                      ...ids.map((id) => ({ type: "work_group" as const, id })),
                    ],
                  })
                }
                labels={clone?.labels}
              />
            )}
            {context && !context.canAssignUser && !context.canAssignGroup && (
              <p className="work-notice">
                Bạn chưa có quyền chọn người hoặc nhóm nhận việc trong phạm vi
                này.
              </p>
            )}
            <div className="work-preview" aria-live="polite">
              {previewBusy ? (
                "Đang kiểm tra người nhận…"
              ) : current ? (
                <>
                  <strong>{current.validCount} người nhận hợp lệ</strong>
                  <p>{current.validRecipients.map((x) => x.name).join(", ")}</p>
                  {current.invalidCount > 0 && (
                    <details>
                      <summary>
                        {current.invalidCount} trường hợp bị loại
                      </summary>
                      <ul>
                        {current.invalidRecipients.map((x, i) => (
                          <li key={i}>
                            {excluded[x.reason] || "Không đủ điều kiện"}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <small>Mọi người cùng phối hợp trên một công việc.</small>
                </>
              ) : (
                <p>Chọn người hoặc nhóm để kiểm tra trước khi tạo.</p>
              )}
              {previewError && (
                <p role="alert">
                  {workError(previewError)}{" "}
                  <button
                    type="button"
                    onClick={() => setPreviewRetry((x) => x + 1)}
                  >
                    Kiểm tra lại
                  </button>
                </p>
              )}
            </div>
            {draft.scope.type !== "direct" && (
              <label className="work-label">
                Nhóm công việc
                <select
                  className="work-input"
                  value={draft.taskGroupId || ""}
                  onChange={(e) =>
                    patch({ taskGroupId: e.target.value || undefined })
                  }
                >
                  <option value="">Không chọn nhóm</option>
                  {draft.taskGroupId &&
                    !groups.some((g) => g.id === draft.taskGroupId) && (
                      <option value={draft.taskGroupId}>
                        {clone?.labels[draft.taskGroupId] || "Nhóm đã chọn"}
                      </option>
                    )}
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                {groupCursor && (
                  <button type="button" onClick={() => void loadMoreGroups()}>
                    Tải thêm nhóm
                  </button>
                )}
                {groupError && (
                  <span role="alert">{workError(groupError)}</span>
                )}
              </label>
            )}
            <div className="work-form-grid">
              <label className="work-label">
                Ngày bắt đầu
                <input
                  className="work-input"
                  type="datetime-local"
                  value={localDeadline(draft.plannedStartAt)}
                  onChange={(e) => patch({ plannedStartAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                />
                <small>Giờ trên thiết bị của bạn.</small>
              </label>
              <label className="work-label">
                Ngày kết thúc
                <input
                  className="work-input"
                  type="datetime-local"
                  value={localDeadline(draft.deadlineAt)}
                  onChange={(e) => {
                    patch({
                      deadlineAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : undefined,
                    });
                    setDeadlineConfirmed(true);
                  }}
                />
                <span className="work-shortcuts">
                  {["Hôm nay", "Ngày mai"].map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        patch({
                          deadlineAt: new Date(
                            deadlineShortcut(i),
                          ).toISOString(),
                        });
                        setDeadlineConfirmed(true);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </span>
                <small>Giờ trên thiết bị của bạn.</small>
              </label>
              <label className="work-label">
                Mức độ
                <select
                  className="work-input"
                  value={draft.priority}
                  onChange={(e) =>
                    patch({
                      priority: e.target
                        .value as CreateWorkTaskInput["priority"],
                    })
                  }
                >
                  <option value="normal">Bình thường</option>
                  <option value="important">Quan trọng</option>
                  <option value="urgent">Khẩn cấp</option>
                </select>
              </label>
            </div>
            {!deadlineConfirmed && (
              <label className="work-notice">
                <input
                  type="checkbox"
                  checked={deadlineConfirmed}
                  onChange={(e) => setDeadlineConfirmed(e.target.checked)}
                />{" "}
                Deadline cũ đã hết hạn. Xác nhận tạo không có deadline mới hoặc
                chọn ngày khác.
              </label>
            )}
            <label className="work-label">
              Mô tả
              <textarea
                className="work-input"
                rows={4}
                maxLength={30000}
                value={documentText(draft.description)}
                onChange={(e) =>
                  patch({ description: workDocument(e.target.value) })
                }
              />
            </label>
            <label className="work-label">
              Nhãn
              <input
                className="work-input"
                placeholder="Cách nhau bằng dấu phẩy"
                value={draft.labels.join(", ")}
                onChange={(e) =>
                  patch({
                    labels: e.target.value.split(",").map((x) => x.trim()),
                  })
                }
                onBlur={() =>
                  patch({ labels: draft.labels.filter(Boolean).slice(0, 20) })
                }
              />
            </label>
            <label className="work-label">
              Quyền xem
              <select
                className="work-input"
                value={draft.privacy}
                disabled={!!parentTask}
                onChange={(e) =>
                  patch({
                    privacy: e.target.value as CreateWorkTaskInput["privacy"],
                  })
                }
              >
                <option value="standard">Tiêu chuẩn theo phạm vi</option>
                <option value="restricted">Hạn chế</option>
              </select>
            </label>
            <WorkPicker
              service={service}
              kind="watcher"
              scope={draft.scope}
              label="Người theo dõi"
              value={draft.watcherUserIds}
              onChange={(ids) => patch({ watcherUserIds: ids })}
              labels={clone?.labels}
            />
            <label className="work-label">
              Đánh giá kết quả
              <select
                className="work-input"
                value={draft.reviewPolicy || ""}
                onChange={(e) =>
                  patch({
                    reviewPolicy:
                      (e.target.value as CreateWorkTaskInput["reviewPolicy"]) ||
                      undefined,
                    reviewerUserId: undefined,
                  })
                }
              >
                <option value="">Theo chính sách mặc định</option>
                <option value="creator_review">Người tạo đánh giá</option>
                {context?.canChooseReviewer && (
                  <option value="reviewer_review">Chọn người đánh giá</option>
                )}
                {current?.validCount === 1 &&
                  current.validRecipients[0].userId === context?.actorId &&
                  draft.scope.type === "direct" && (
                    <option value="auto_complete">
                      Tự hoàn thành việc của tôi
                    </option>
                  )}
              </select>
            </label>
            {draft.reviewPolicy === "reviewer_review" && (
              <WorkPicker
                service={service}
                kind="reviewer"
                scope={draft.scope}
                label="Người đánh giá"
                value={draft.reviewerUserId ? [draft.reviewerUserId] : []}
                onChange={(ids) => patch({ reviewerUserId: ids[0] })}
                multiple={false}
                labels={clone?.labels}
              />
            )}
            <button
              className="work-secondary"
              type="button"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Thu gọn trình soạn" : "Mở trình soạn đầy đủ"}
            </button>
            {expanded && (
              <section>
                <h3>Checklist</h3>
                {draft.checklist.map((item, i) => (
                  <div className="work-checklist-row" key={i}>
                    <input
                      className="work-input"
                      aria-label={`Mục checklist ${i + 1}`}
                      required
                      maxLength={500}
                      value={item.title}
                      onChange={(e) =>
                        patch({
                          checklist: draft.checklist.map((c, j) =>
                            j === i ? { ...c, title: e.target.value } : c,
                          ),
                        })
                      }
                    />
                    <select
                      className="work-input"
                      aria-label={`Người phụ trách mục ${i + 1}`}
                      value={item.assigneeUserId || ""}
                      onChange={(e) =>
                        patch({
                          checklist: draft.checklist.map((c, j) =>
                            j === i
                              ? {
                                  ...c,
                                  assigneeUserId: e.target.value || undefined,
                                }
                              : c,
                          ),
                        })
                      }
                    >
                      <option value="">Cùng thực hiện</option>
                      {current?.validRecipients.map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Xóa mục checklist ${i + 1}`}
                      onClick={() =>
                        patch({
                          checklist: draft.checklist.filter((_, j) => j !== i),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="work-secondary"
                  disabled={draft.checklist.length >= 200}
                  onClick={() =>
                    patch({ checklist: [...draft.checklist, { title: "" }] })
                  }
                >
                  Thêm mục
                </button>
              </section>
            )}
          </fieldset>
          <section>
            <h3>Đính kèm đầu vào</h3>
            <p className="work-hint">
              JPEG, PNG, WebP tĩnh (5 MiB, 4 megapixel); PDF, TXT (25 MiB). Tệp
              được tải sau khi tạo công việc.
            </p>
            {
              <input
                type="file"
                aria-label="Chọn tệp đính kèm"
                multiple
                disabled={busy || (!!attempt && !created)}
                accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
                onChange={(e) => {
                  const selected = Array.from(e.currentTarget.files || []).map(
                    (file) => ({
                      key: crypto.randomUUID(),
                      file,
                      keepOriginal: false,
                    }),
                  );
                  setFiles((old) => [...old, ...selected]);
                  e.target.value = "";
                }}
              />
            }
            <ul className="work-files">
              {files.map((item, i) => (
                <li key={item.key}>
                  <strong>{item.file.name}</strong>{" "}
                  <small>{Math.ceil(item.file.size / 1024)} KB</small>
                  {!item.reservation && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          disabled={busy || (!!attempt && !created)}
                          checked={item.keepOriginal}
                          onChange={(e) =>
                            setFiles((old) =>
                              old.map((f, j) =>
                                j === i
                                  ? { ...f, keepOriginal: e.target.checked }
                                  : f,
                              ),
                            )
                          }
                        />{" "}
                        Giữ bản gốc
                      </label>
                      <button
                        type="button"
                        disabled={busy || (!!attempt && !created)}
                        aria-label={`Bỏ tệp ${item.file.name}`}
                        onClick={() =>
                          setFiles((old) => old.filter((_, j) => j !== i))
                        }
                      >
                        ×
                      </button>
                    </>
                  )}
                  {item.ready && <span>Đã tải</span>}
                  {item.error && (
                    <span role="alert" className="work-error">
                      {item.error}
                      {created && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setFiles((old) => old.filter((_, j) => j !== i))
                            }
                          >
                            Bỏ tệp này
                          </button>
                          {item.restartable && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setFiles((old) =>
                                  old.map((f, j) =>
                                    j === i
                                      ? {
                                          key: crypto.randomUUID(),
                                          file: f.file,
                                          keepOriginal: f.keepOriginal,
                                        }
                                      : f,
                                  ),
                                )
                              }
                            >
                              Chuẩn bị tải lại từ đầu
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {error && (
            <p className="work-error" role="alert">
              {workError(error)}
              {attempt &&
                !created &&
                " Chưa xác định kết quả tạo. Bấm thử lại để kiểm tra cùng yêu cầu."}
            </p>
          )}
        </div>
        <footer>
          <button
            type="button"
            className="work-secondary"
            disabled={busy}
            onClick={close}
          >
            {created ? "Đóng" : "Hủy"}
          </button>
          <button
            className="work-primary"
            type="submit"
            disabled={
              busy ||
              (!created &&
                !attempt &&
                (!draft.title.trim() ||
                  !current?.validCount ||
                  previewBusy ||
                  !context?.calendarReady ||
                  !deadlineConfirmed)) ||
              (!!created && files.every((f) => f.ready))
            }
          >
            {busy
              ? "Đang xử lý…"
              : created
                ? "Thử tải lại tệp"
                : attempt
                  ? "Thử lại yêu cầu"
                  : "Tạo công việc"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
