import { describe, expect, it } from "vitest";
import type { WorkspaceSummary } from "../work/workWorkspaceTypes";
import { ROUTE_TO_MODULE } from "../../constants/routes";
import { getPermissionModuleByCode } from "../permissions/permissionRegistry";
import {
  mergeWorkspacePage,
  workspaceCover,
  workspaceRoute,
} from "../../pages/work/workspacePresentation";

const workspace = (id: string, pinned = false): WorkspaceSummary => ({
  id,
  name: id,
  kind: "department",
  status: "active",
  sourceName: "Phòng ban",
  iconKey: "building",
  colorKey: "blue",
  coverKey: "blueprint",
  pinned,
  memberCount: 2,
  visibleOpenTaskCount: 3,
  myActionCount: 1,
  capabilities: {
    canView: true,
    canCreateTask: true,
    canManageMembers: false,
    canConfigure: false,
    canArchive: false,
  },
  lockVersion: 1,
});

describe("Work Workspace dashboard contracts", () => {
  it("builds encoded member-only Workspace routes", () => {
    expect(workspaceRoute("space/a")).toBe("/work/spaces/space%2Fa");
    expect(ROUTE_TO_MODULE["/work/spaces/:workspaceId"]).toBe("work.module");
    expect(getPermissionModuleByCode("work.module")?.routes).toContain(
      "/work/spaces/:workspaceId",
    );
  });

  it("deduplicates load-more pages while accepting refreshed summaries", () => {
    const first = workspace("space-a");
    const refreshed = { ...first, name: "Tên mới", myActionCount: 4 };
    expect(mergeWorkspacePage([first, workspace("space-b")], [refreshed]))
      .toEqual([refreshed, workspace("space-b")]);
  });

  it("assigns a distinct local cover to each Workspace kind", () => {
    expect(new Set([
      workspaceCover("department"),
      workspaceCover("project"),
      workspaceCover("collaboration"),
    ]).size).toBe(3);
    expect(workspaceCover("department")).toMatch(/^\/assets\/workspaces\//);
  });
});
