import { describe, it, expect, vi } from "vitest";
import { createWorkTaskService } from "../work/workTaskService";
import {
  WorkCreateAttempt,
  emptyWorkDraft,
  scopeFromKey,
  scopeKey,
  workDocument,
  documentText,
  knownWorkRejection,
} from "../work/workForm";
describe("Work task service and creation attempt", () => {
  it("sends cursor/filter state to bounded RPCs instead of reading tables", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: { items: [], nextCursor: null },
        error: null,
      });
    const service = createWorkTaskService({ rpc } as any);
    await service.list(
      "following",
      { priority: ["urgent"] },
      { sortAt: "2026-09-07T01:00:00Z", id: "task" },
    );
    expect(rpc).toHaveBeenCalledWith("list_work_tasks", {
      p_view: "following",
      p_filters: { priority: ["urgent"] },
      p_cursor: { sortAt: "2026-09-07T01:00:00Z", id: "task" },
      p_limit: 30,
    });
    await service.options("user", { type: "direct" }, "An", { id: "previous" });
    expect(rpc).toHaveBeenLastCalledWith("list_work_creation_options", {
      p_kind: "user",
      p_scope: { type: "direct" },
      p_search: "An",
      p_cursor: { id: "previous" },
      p_limit: 30,
    });
  });
  it("preserves exact data and idempotency key across ambiguous retries", async () => {
    const draft = emptyWorkDraft({ type: "direct" });
    draft.title = "Original task";
    const attempt = new WorkCreateAttempt(draft, "preview");
    draft.title = "Changed elsewhere";
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("network") })
      .mockResolvedValueOnce({ data: { taskId: "one" }, error: null });
    const service = createWorkTaskService({ rpc } as any);
    await expect(
      service.create(attempt.input, attempt.key, attempt.fingerprint),
    ).rejects.toThrow("network");
    await service.create(attempt.input, attempt.key, attempt.fingerprint);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(attempt.input.title).toBe("Original task");
    expect(knownWorkRejection(new Error("network"))).toBe(false);
    expect(knownWorkRejection(new Error("WORK_ACCESS_DENIED"))).toBe(false);
    expect(knownWorkRejection(new Error("WORK_RECIPIENT_PREVIEW_STALE"))).toBe(
      true,
    );
  });
  it("clone is a read-only draft request and does not allocate task IDs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { draft: {} }, error: null });
    await createWorkTaskService({ rpc } as any).clone("source");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_work_clone_form", {
      p_task_id: "source",
    });
  });
  it("preserves text safely and project IDs as arbitrary text", () => {
    const text = "<script>alert(1)</script>\nNội dung";
    expect(documentText(workDocument(text))).toBe(text);
    expect(scopeFromKey("project:legacy/project-12")).toEqual({
      type: "project",
      projectId: "legacy/project-12",
    });
    expect(scopeKey({ type: "department", departmentId: "d" })).toBe(
      "department:d",
    );
  });
});
