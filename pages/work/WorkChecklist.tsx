import { workError } from "../../lib/work/workForm";
import React, { useEffect, useState } from "react";
import type {
  WorkChecklistItem,
  WorkCollaborationCommand,
  WorkTaskAssignment,
} from "../../lib/work/workTypes";
export function WorkChecklist({
  items,
  assignments,
  names,
  canManage,
  busy,
  run,
  completed,
  error,
}: {
  completed: { command: string; seq: number };
  error: unknown;
  items: WorkChecklistItem[];
  assignments: WorkTaskAssignment[];
  names: Record<string, string>;
  canManage: boolean;
  busy: boolean;
  run: (input: WorkCollaborationCommand) => Promise<boolean>;
}) {
  const [form, setForm] = useState<{
    id?: string;
    version?: number;
    title: string;
    assignee: string;
    order: number;
  } | null>(null);
  useEffect(() => {
    if (completed.command.startsWith("checklist_")) setForm(null);
  }, [completed.seq]);
  return (
    <section className="work-section">
      <div className="work-section-title">
        <h3>
          Checklist{" "}
          <small>
            {items.filter((x) => x.completed_at).length}/{items.length}
          </small>
        </h3>
        {canManage && (
          <button
            className="work-secondary"
            disabled={busy || items.length >= 200}
            onClick={() =>
              setForm({ title: "", assignee: "", order: items.length })
            }
          >
            Thêm mục
          </button>
        )}
      </div>
      <ul className="work-detail-checklist">
        {items.map((item) => (
          <li key={item.id}>
            <input
              type="checkbox"
              aria-label={`Hoàn tất ${item.title}`}
              disabled={!canManage || busy}
              checked={!!item.completed_at}
              onChange={(e) =>
                void run({
                  command: "checklist_set_completed",
                  payload: {
                    itemId: item.id,
                    expectedLockVersion: item.lock_version,
                    completed: e.target.checked,
                  },
                })
              }
            />
            <div>
              <span className={item.completed_at ? "work-done" : ""}>
                {item.title}
              </span>
              {item.assignee_user_id && (
                <small>
                  {names[item.assignee_user_id] || "Người phụ trách"}
                </small>
              )}
            </div>
            {canManage && (
              <>
                <button
                  disabled={busy}
                  aria-label={`Sửa ${item.title}`}
                  onClick={() =>
                    setForm({
                      id: item.id,
                      version: item.lock_version,
                      title: item.title,
                      assignee: item.assignee_user_id || "",
                      order: item.sort_order,
                    })
                  }
                >
                  Sửa
                </button>
                <button
                  disabled={busy}
                  aria-label={`Xóa ${item.title}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Xóa mục “${item.title}”? Lịch sử vẫn được giữ.`,
                      )
                    )
                      void run({
                        command: "checklist_delete",
                        payload: {
                          itemId: item.id,
                          expectedLockVersion: item.lock_version,
                        },
                      });
                  }}
                >
                  ×
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {!items.length && <p>Chưa có checklist.</p>}
      {form && canManage && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = {
              title: form.title.trim(),
              assigneeUserId: form.assignee || null,
              sortOrder: form.order,
            };
            if (
              await run(
                form.id
                  ? {
                      command: "checklist_update",
                      payload: {
                        ...payload,
                        itemId: form.id,
                        expectedLockVersion: form.version!,
                      },
                    }
                  : { command: "checklist_create", payload },
              )
            )
              setForm(null);
          }}
        >
          {error && (
            <p className="work-error" role="alert">
              {workError(error)}
            </p>
          )}
          {form.id &&
            items.find((i) => i.id === form.id)?.lock_version !==
              form.version && (
              <p className="work-notice">
                Mục đã thay đổi.{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const latest = items.find((i) => i.id === form.id);
                    setForm(
                      latest
                        ? {
                            id: latest.id,
                            version: latest.lock_version,
                            title: latest.title,
                            assignee: latest.assignee_user_id || "",
                            order: latest.sort_order,
                          }
                        : null,
                    );
                  }}
                >
                  Nạp lại mục mới
                </button>
              </p>
            )}
          <fieldset disabled={busy}>
            <label className="work-label">
              Nội dung checklist
              <input
                className="work-input"
                aria-label="Nội dung checklist"
                autoFocus
                required
                maxLength={300}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="work-label">
              Người phụ trách
              <select
                className="work-input"
                value={form.assignee}
                onChange={(e) => setForm({ ...form, assignee: e.target.value })}
              >
                <option value="">Cùng thực hiện</option>
                {assignments
                  .filter((a) => !a.ended_at)
                  .map((a) => (
                    <option key={a.id} value={a.user_id}>
                      {names[a.user_id] || "Người nhận việc"}
                    </option>
                  ))}
              </select>
            </label>
            <label className="work-label">
              Thứ tự
              <input
                className="work-input"
                type="number"
                min={0}
                max={999999999}
                value={form.order}
                onChange={(e) =>
                  setForm({ ...form, order: Number(e.target.value) })
                }
              />
            </label>
            <button className="work-primary" disabled={!form.title.trim()}>
              Lưu checklist
            </button>
            <button
              type="button"
              className="work-secondary"
              onClick={() => setForm(null)}
            >
              Đóng
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
