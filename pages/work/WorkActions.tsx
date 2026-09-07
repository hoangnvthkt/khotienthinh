import React, { useEffect, useRef, useState } from "react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type {
  WorkTaskDetail,
  WorkLifecycleCommand,
} from "../../lib/work/workTypes";
import { workDocument, workError } from "../../lib/work/workForm";
import { WorkPersonPicker } from "./WorkPersonPicker";
export const actionDefinitions = [
  ["acknowledge", "canAcknowledge", "Nhận việc"],
  ["request_clarification", "canRequestClarification", "Đề nghị làm rõ"],
  ["start", "canStart", "Bắt đầu"],
  ["unblock", "canUnblock", "Tiếp tục thực hiện"],
  ["submit", "canSubmit", "Nộp kết quả"],
  ["block", "canBlock", "Báo bị chặn"],
  ["approve", "canReview", "Duyệt kết quả"],
  ["request_changes", "canReview", "Yêu cầu chỉnh sửa"],
  ["transfer", "canTransfer", "Chuyển việc"],
  ["add_assignees", "canAddAssignees", "Thêm đồng thực hiện"],
  ["cancel", "canCancel", "Hủy công việc"],
] as const;
type Action = (typeof actionDefinitions)[number][0];
export function WorkActions({
  detail,
  service,
  run,
  retry,
  busy,
  pending,
  error,
  names,
}: {
  detail: WorkTaskDetail;
  service: WorkTaskService;
  run: (input: WorkLifecycleCommand, version: number) => Promise<boolean>;
  retry: () => Promise<boolean>;
  busy: boolean;
  pending: boolean;
  error: unknown;
  names: Record<string, string>;
}) {
  const [action, setAction] = useState<{ id: Action; version: number } | null>(
      null,
    ),
    [reason, setReason] = useState(""),
    [ids, setIds] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action) dialog.current?.showModal();
  }, [action?.id]);
  const definition = actionDefinitions.find((x) => x[0] === action?.id),
    allowed = definition && detail.capabilities[definition[1]];
  const needsReason =
    action &&
    [
      "request_clarification",
      "block",
      "cancel",
      "transfer",
      "request_changes",
      "submit",
    ].includes(action.id);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!action) return;
    if (pending) {
      if (await retry()) setAction(null);
      return;
    }
    let input: WorkLifecycleCommand;
    if (action.id === "approve" || action.id === "request_changes")
      input = {
        command: "review",
        payload: {
          decision: action.id === "approve" ? "approve" : "request_changes",
          reason: reason.trim(),
        },
      };
    else if (action.id === "submit")
      input = {
        command: "submit",
        payload: { result: workDocument(reason.trim()) },
      };
    else if (action.id === "transfer")
      input = {
        command: "transfer",
        payload: { userId: ids[0], reason: reason.trim() },
      };
    else if (action.id === "add_assignees")
      input = { command: "add_assignees", payload: { userIds: ids } };
    else if (["block", "cancel", "request_clarification"].includes(action.id))
      input = {
        command: action.id,
        payload: { reason: reason.trim() },
      } as WorkLifecycleCommand;
    else input = { command: action.id, payload: {} } as WorkLifecycleCommand;
    if (await run(input, action.version)) setAction(null);
  }
  return (
    <>
      <div className="work-action-bar" aria-label="Thao tác công việc">
        {actionDefinitions
          .filter((x) => detail.capabilities[x[1]])
          .map(([id, , label], i) => (
            <button
              key={id}
              className={
                id === "cancel"
                  ? "work-danger"
                  : i === 0
                    ? "work-primary"
                    : "work-secondary"
              }
              disabled={busy || pending}
              onClick={() => {
                setReason("");
                setIds([]);
                setAction({ id, version: detail.task.lock_version });
              }}
            >
              {label}
            </button>
          ))}
      </div>
      {action && (
        <dialog
          className="work-action-dialog"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) setAction(null);
          }}
          aria-labelledby="work-action-title"
        >
          <form onSubmit={submit}>
            <h2 id="work-action-title">{definition?.[2]}</h2>
            <p>
              {detail.task.task_code} · {detail.task.title}
            </p>
            {action.id === "transfer" && (
              <p>
                Trách nhiệm của bạn sẽ chuyển cho người mới và chờ họ xác nhận.
                Deadline chung giữ nguyên.
              </p>
            )}
            {action.id === "cancel" && (
              <p>
                Công việc sẽ kết thúc với trạng thái đã hủy. Lịch sử được giữ
                lại.
              </p>
            )}
            {action.id === "submit" && (
              <p>
                Tải tệp kết quả hoặc bằng chứng trong mục Đính kèm trước khi
                nộp.
              </p>
            )}
            <fieldset disabled={busy || pending}>
              {["transfer", "add_assignees"].includes(action.id) && (
                <WorkPersonPicker
                  taskId={detail.task.id}
                  action={action.id as "transfer" | "add_assignees"}
                  service={service}
                  value={ids}
                  onChange={setIds}
                  multiple={action.id === "add_assignees"}
                  names={names}
                />
              )}
              <label className="work-label">
                {action.id === "submit"
                  ? "Nội dung kết quả"
                  : needsReason
                    ? "Lý do bắt buộc"
                    : "Ghi chú (tùy chọn)"}
                {(needsReason || action.id === "approve") && (
                  <textarea
                    autoFocus
                    className="work-input"
                    aria-label={
                      action.id === "submit" ? "Nội dung kết quả" : "Lý do"
                    }
                    required={!!needsReason}
                    maxLength={action.id === "submit" ? 30000 : 4000}
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </label>
            </fieldset>
            {error && (
              <p className="work-error" role="alert">
                {workError(error)}
              </p>
            )}
            {action.version !== detail.task.lock_version && !pending && (
              <p className="work-notice">
                Dữ liệu đã thay đổi. Kiểm tra bản mới trước khi xác nhận.{" "}
                <button
                  type="button"
                  onClick={() =>
                    setAction((a) =>
                      a ? { ...a, version: detail.task.lock_version } : null,
                    )
                  }
                >
                  Đã kiểm tra bản mới
                </button>
              </p>
            )}
            <footer>
              <button
                type="button"
                className="work-secondary"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Đóng
              </button>
              <button
                className="work-primary"
                disabled={
                  busy ||
                  (!pending &&
                    (!allowed ||
                      action.version !== detail.task.lock_version ||
                      (!!needsReason && !reason.trim()) ||
                      (["transfer", "add_assignees"].includes(action.id) &&
                        !ids.length)))
                }
              >
                {busy
                  ? "Đang xử lý…"
                  : pending
                    ? "Thử lại đúng yêu cầu"
                    : "Xác nhận"}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}
