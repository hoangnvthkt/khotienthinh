import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigAttempt,
  configurationScope,
  createWorkConfigurationService,
} from "../work/workConfigurationService";
import { workScopeKindLabel } from "../work/workPresentation";
import { canConfigureWorkspace } from "../work/workConfigurationAccess";

describe("Workspace configuration contracts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses only explicit Workspace configuration keys", () => {
    expect(configurationScope("workspace:space-a")).toEqual({
      type: "workspace",
      workspaceId: "space-a",
    });
    expect(() => configurationScope("unknown:space-a")).toThrow(
      "WORK_INVALID_SCOPE",
    );
    expect(() => configurationScope("workspace:")).toThrow(
      "WORK_INVALID_SCOPE",
    );
  });

  it("restores a pending Workspace save without changing its scope", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const first = new ConfigAttempt("workspace-config:actor-a");
    first.begin({
      kind: "group",
      scope: { type: "workspace", workspaceId: "space-a" },
      id: null,
      version: null,
      data: { name: "Kế hoạch tuần" },
      reason: "Tạo nhóm việc pilot",
    });

    const restored = new ConfigAttempt("workspace-config:actor-a");
    expect(restored.pending?.scope).toEqual({
      type: "workspace",
      workspaceId: "space-a",
    });

    const rpc = vi.fn().mockResolvedValue({
      data: { id: "group-a", record: { id: "group-a" } },
      error: null,
    });
    await restored.run(createWorkConfigurationService({ rpc } as never));
    expect(rpc).toHaveBeenCalledWith(
      "save_work_configuration",
      expect.objectContaining({
        p_scope: { type: "workspace", workspaceId: "space-a" },
      }),
    );
  });

  it("names Workspace scope distinctly in configuration and task UI", () => {
    expect(workScopeKindLabel({ type: "workspace", workspaceId: "space-a" }))
      .toBe("Không gian làm việc");
  });

  it("uses the exact canonical Workspace grant for the settings affordance", () => {
    const user = {
      authorizationSnapshot: {
        generatedAt: "2026-09-08T00:00:00.000Z",
        flags: {},
        roomActions: [],
        sources: [{
          permissionCode: "work.task.configure",
          sourceType: "WORKSPACE_MEMBER",
          sourceId: "member-a",
          scopeType: "work_workspace",
          scopeId: "space-a",
          isBusinessApproval: false,
          metadata: { role: "admin" },
        }],
      },
    };
    expect(canConfigureWorkspace(user as never, "space-a")).toBe(true);
    expect(canConfigureWorkspace(user as never, "space-b")).toBe(false);
    const globalOnly = structuredClone(user);
    globalOnly.authorizationSnapshot.sources[0].sourceType = "DIRECT";
    globalOnly.authorizationSnapshot.sources[0].scopeType = "global";
    globalOnly.authorizationSnapshot.sources[0].scopeId = "*";
    expect(canConfigureWorkspace(globalOnly as never, "space-a")).toBe(false);
  });
});
