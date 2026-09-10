import { describe, expect, it, vi } from "vitest";
import { createWorkTaskService } from "../work/workTaskService";
import {
  scopeFromKey,
  scopeKey,
  scopeToKey,
} from "../work/workForm";

describe("Workspace task access contracts", () => {
  it("round-trips workspace scope keys and preserves legacy keys", () => {
    expect(scopeFromKey("workspace:workspace-1")).toEqual({
      type: "workspace",
      workspaceId: "workspace-1",
    });
    expect(scopeToKey({ type: "workspace", workspaceId: "workspace-1" })).toBe(
      "workspace:workspace-1",
    );
    expect(scopeKey({ type: "direct" })).toBe("direct");
    expect(scopeFromKey("department:department-1")).toEqual({
      type: "department",
      departmentId: "department-1",
    });
    expect(scopeFromKey("project:legacy/project-1")).toEqual({
      type: "project",
      projectId: "legacy/project-1",
    });
  });

  it("rejects unknown, empty, or mixed scope keys instead of guessing", () => {
    for (const key of [
      "workspace:",
      "workspace:workspace-1:department-1",
      "department:",
      "department:department-1:extra",
      "unknown:scope-1",
      "projectless",
    ]) {
      expect(() => scopeFromKey(key)).toThrow("WORK_SCOPE_INVALID");
    }

    expect(() =>
      scopeToKey({
        type: "workspace",
        workspaceId: "workspace-1",
        departmentId: "department-1",
      } as never),
    ).toThrow("WORK_SCOPE_INVALID");
  });

  it("keeps workspace filters physical-scope free and supports assignee filtering", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [], nextCursor: null }, error: null });
    const service = createWorkTaskService({ rpc } as any);
    await service.workspaceTasks("workspace-1", {
      scope: { type: "workspace", workspaceId: "workspace-1" },
      assigneeUserId: "user-1",
    });
    expect(rpc).toHaveBeenCalledWith("list_work_workspace_tasks", expect.objectContaining({
      p_filters: { assigneeUserId: "user-1" },
    }));
  });

  it("lists workspace tasks through its dedicated guarded RPC", async () => {
    const page = { items: [], nextCursor: null };
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    const service = createWorkTaskService({ rpc } as any);
    const cursor = { sortAt: "2026-09-07T10:00:00Z", id: "task-1" };

    await expect(
      service.workspaceTasks("workspace-1", { priority: ["urgent"] }, cursor),
    ).resolves.toBe(page);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_work_workspace_tasks", {
      p_workspace_id: "workspace-1",
      p_filters: { priority: ["urgent"] },
      p_cursor: cursor,
      p_limit: 30,
    });
  });

  it("does not fall back to the legacy list when workspace access is denied", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: new Error("WORK_WORKSPACE_MEMBER_REQUIRED"),
      });
    const service = createWorkTaskService({ rpc } as any);

    await expect(service.workspaceTasks("workspace-1")).rejects.toThrow(
      "WORK_WORKSPACE_MEMBER_REQUIRED",
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_work_workspace_tasks", {
      p_workspace_id: "workspace-1",
      p_filters: {},
      p_cursor: null,
      p_limit: 30,
    });
  });

  it("does not let workspace task filters choose a linked physical scope", async () => {
    const rpc = vi.fn();
    const service = createWorkTaskService({ rpc } as any);

    await expect(
      service.workspaceTasks("workspace-1", {
        scope: { type: "department", departmentId: "department-1" },
      }),
    ).rejects.toThrow("WORK_SCOPE_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates workspace scopes before create and recipient preview RPCs", async () => {
    const rpc = vi.fn();
    const service = createWorkTaskService({ rpc } as any);
    const mixed = {
      type: "workspace",
      workspaceId: "workspace-1",
      projectId: "project-1",
    };

    await expect(service.preview([], mixed as never)).rejects.toThrow(
      "WORK_SCOPE_INVALID",
    );
    await expect(
      service.create({ scope: mixed } as never, "key-1", "fingerprint-1"),
    ).rejects.toThrow("WORK_SCOPE_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });
});
