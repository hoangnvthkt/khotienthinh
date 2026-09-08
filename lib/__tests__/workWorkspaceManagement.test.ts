import { describe, expect, it } from "vitest";
import type { MembershipPreview, WorkspaceMember } from "../work/workWorkspaceTypes";
import {
  buildMembershipChanges,
  createWorkspaceDraft,
  MembershipApplyAttempt,
  resolvedWorkspaceRejection,
  WorkspaceCreateAttempt,
  workspaceTabRoute,
} from "../../pages/work/workspaceManagement";

const member = (userId: string, role: "admin" | "member" = "member"): WorkspaceMember => ({
  userId,
  name: userId,
  avatarUrl: null,
  role,
  origin: "manual",
  expiresAt: null,
  lockVersion: 1,
});

describe("Workspace management UI contracts", () => {
  it("keeps every Workspace tab and task return link encoded", () => {
    expect(workspaceTabRoute("space/a", "tasks")).toBe("/work/spaces/space%2Fa");
    expect(workspaceTabRoute("space/a", "members")).toBe("/work/spaces/space%2Fa/members");
    expect(workspaceTabRoute("space/a", "settings")).toBe("/work/spaces/space%2Fa/settings");
  });

  it("builds one bounded, deduplicated membership batch", () => {
    expect(buildMembershipChanges(["user-2", "user-1", "user-2"], "organization", "department-1"))
      .toEqual([
        { operation: "add", userId: "user-2", role: "member", origin: "organization", sourceReference: "department-1" },
        { operation: "add", userId: "user-1", role: "member", origin: "organization", sourceReference: "department-1" },
      ]);
    expect(() => buildMembershipChanges(Array.from({ length: 101 }, (_, i) => `u-${i}`), "manual"))
      .toThrow("WORK_MEMBERSHIP_BATCH_TOO_LARGE");
    expect(() => buildMembershipChanges(["user-1"], "project"))
      .toThrow("WORK_SOURCE_REFERENCE_REQUIRED");
  });

  it("requires linked source ids and keeps collaboration independent", () => {
    expect(createWorkspaceDraft("collaboration", "  Tổ nghiệm thu  ", null, "blue", "users", "team"))
      .toEqual({ kind: "collaboration", name: "Tổ nghiệm thu", iconKey: "users", colorKey: "blue", coverKey: "team" });
    expect(createWorkspaceDraft("department", "Phòng dự án", "department-1", "teal", "building", "office"))
      .toMatchObject({ departmentId: "department-1" });
    expect(() => createWorkspaceDraft("project", "Dự án", null, "amber", "briefcase", "site"))
      .toThrow("WORK_WORKSPACE_SOURCE_REQUIRED");
  });

  it("keeps blockers attached to the preview that will be applied", () => {
    const preview: MembershipPreview = {
      fingerprint: "fp-1",
      changes: [{ operation: "remove", userId: "user-1" }],
      blockers: [{ userId: "user-1", code: "OPEN_ASSIGNMENTS", openAssignmentCount: 2, openReviewCount: 1 }],
    };
    expect(preview.blockers[0]).toMatchObject({ openAssignmentCount: 2, openReviewCount: 1 });
    expect([member("admin", "admin"), member("user-1")]).toHaveLength(2);
  });

  it("reuses the exact membership preview and key until resolved", () => {
    const attempt = new MembershipApplyAttempt();
    const preview: MembershipPreview = { fingerprint: "fp-1", changes: [], blockers: [] };
    const first = attempt.begin({ workspaceId: "space-1", preview, expectedVersion: 3, reason: "Duyệt" });
    const retry = attempt.begin({ workspaceId: "changed", preview, expectedVersion: 9, reason: "Khác" });
    expect(retry).toEqual(first);
    expect(retry.key).toBeTruthy();
    attempt.resolved();
    expect(attempt.pending).toBeNull();
  });

  it("distinguishes a server rejection from a lost response", () => {
    expect(resolvedWorkspaceRejection({ code: "P0001", message: "WORK_MEMBERSHIP_PREVIEW_STALE" })).toBe(true);
    expect(resolvedWorkspaceRejection(new Error("NETWORK_RESPONSE_LOST"))).toBe(false);
    expect(resolvedWorkspaceRejection(new Error("WORK_IDEMPOTENCY_CONFLICT"))).toBe(false);
  });

  it("freezes Workspace creation input while the result is unknown", () => {
    const attempt = new WorkspaceCreateAttempt();
    const original = createWorkspaceDraft("collaboration", "Nhóm A", null, "blue", "users", "team");
    const first = attempt.begin(original);
    const retry = attempt.begin({ ...original, name: "Tên đã đổi" });
    expect(retry).toEqual(first);
    expect(retry.input.name).toBe("Nhóm A");
  });
});
