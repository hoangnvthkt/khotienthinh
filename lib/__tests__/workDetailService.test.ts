import { describe, it, expect, vi } from "vitest";
import { createWorkTaskService } from "../work/workTaskService";
import { WorkMutationSession } from "../work/workMutation";

describe("Work detail command boundary", () => {
  it("keeps exact task/version/key after ambiguous failure and resolves only once", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error("network"), data: null })
      .mockResolvedValue({
        error: null,
        data: { taskId: "a", lockVersion: 8 },
      });
    const service = createWorkTaskService({ rpc } as any),
      session = new WorkMutationSession();
    const input = {
      command: "block" as const,
      payload: { reason: "Await materials" },
    };
    session.begin("a", "lifecycle", input, 7);
    input.payload.reason = "Edited elsewhere";
    await expect(session.run(service)).rejects.toThrow("network");
    expect(() =>
      session.begin("b", "lifecycle", { command: "start", payload: {} }, 1),
    ).toThrow();
    await session.run(service);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_task_id: "a",
      p_expected_lock_version: 7,
      p_payload: { reason: "Await materials" },
    });
    expect(session.pending).toBeNull();
  });
  it("releases a rejected version conflict, while access loss keeps uncertain command", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        error: new Error("WORK_VERSION_CONFLICT"),
        data: null,
      });
    const session = new WorkMutationSession(),
      service = createWorkTaskService({ rpc } as any);
    session.begin("a", "lifecycle", { command: "start", payload: {} }, 1);
    await expect(session.run(service)).rejects.toThrow("WORK_VERSION_CONFLICT");
    expect(session.pending).toBeNull();
    session.begin("a", "lifecycle", { command: "start", payload: {} }, 2);
    rpc.mockResolvedValue({
      error: new Error("WORK_TASK_NOT_FOUND"),
      data: null,
    });
    await expect(session.run(service)).rejects.toThrow("WORK_TASK_NOT_FOUND");
    expect(session.pending?.taskId).toBe("a");
  });
  it("sends entity versions and bounded comment/history/mention cursors through RPCs", async () => {
    const rpc = vi
        .fn()
        .mockResolvedValue({
          data: { items: [], nextCursor: null },
          error: null,
        }),
      service = createWorkTaskService({ rpc } as any);
    await service.collaborate({
      taskId: "a",
      command: "comment_edit",
      payload: {
        commentId: "c",
        expectedLockVersion: 3,
        content: { version: 1, type: "doc", content: [] },
        mentionedUserIds: [],
      },
      idempotencyKey: "key",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "command_work_task_collaboration",
      expect.objectContaining({
        p_payload: expect.objectContaining({ expectedLockVersion: 3 }),
        p_idempotency_key: "key",
      }),
    );
    await service.comments("a", { sortAt: "now", id: "c" });
    expect(rpc).toHaveBeenLastCalledWith("list_work_task_comments", {
      p_task_id: "a",
      p_cursor: { sortAt: "now", id: "c" },
      p_limit: 30,
    });
    await service.history("a", { category: "sla" }, null);
    expect(rpc).toHaveBeenLastCalledWith("list_work_task_history", {
      p_task_id: "a",
      p_filters: { category: "sla" },
      p_cursor: null,
      p_limit: 30,
    });
  });
});
