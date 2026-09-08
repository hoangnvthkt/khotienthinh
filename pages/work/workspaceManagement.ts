import type { CreateWorkWorkspaceInput } from "../../lib/work/workWorkspaceService";
import type {
  MembershipChange,
  MembershipPreview,
  WorkspaceKind,
  WorkspaceMemberOrigin,
} from "../../lib/work/workWorkspaceTypes";

export type WorkspaceTab = "tasks" | "members" | "settings";

export function workspaceTabRoute(workspaceId: string, tab: WorkspaceTab): string {
  const base = `/work/spaces/${encodeURIComponent(workspaceId)}`;
  return tab === "tasks" ? base : `${base}/${tab}`;
}

export function buildMembershipChanges(
  userIds: readonly string[],
  origin: WorkspaceMemberOrigin,
  sourceReference: string | null = null,
): MembershipChange[] {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length > 100) throw new Error("WORK_MEMBERSHIP_BATCH_TOO_LARGE");
  if (origin !== "manual" && !sourceReference) throw new Error("WORK_SOURCE_REFERENCE_REQUIRED");
  return unique.map((userId) => ({
    operation: "add",
    userId,
    role: "member",
    origin,
    ...(origin !== "manual" && sourceReference ? { sourceReference } : {}),
  }));
}

export function createWorkspaceDraft(
  kind: WorkspaceKind,
  name: string,
  sourceId: string | null,
  colorKey: string,
  iconKey: string,
  coverKey: string,
): CreateWorkWorkspaceInput {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("WORK_WORKSPACE_NAME_REQUIRED");
  const common = { kind, name: trimmedName, iconKey, colorKey, coverKey };
  if (kind === "collaboration") return common;
  if (!sourceId) throw new Error("WORK_WORKSPACE_SOURCE_REQUIRED");
  return kind === "department"
    ? { ...common, departmentId: sourceId }
    : { ...common, projectId: sourceId };
}

export interface MembershipApplyRequest {
  workspaceId: string;
  preview: MembershipPreview;
  expectedVersion: number;
  reason: string;
  key: string;
}

/** Keeps the exact preview and idempotency key while an apply result is unknown. */
export class MembershipApplyAttempt {
  pending: MembershipApplyRequest | null = null;
  running = false;

  begin(input: Omit<MembershipApplyRequest, "key">): MembershipApplyRequest {
    if (this.pending) return this.pending;
    this.pending = { ...structuredClone(input), key: crypto.randomUUID() };
    return this.pending;
  }

  resolved(): void {
    this.pending = null;
  }
}

export class WorkspaceCreateAttempt {
  pending: { input: CreateWorkWorkspaceInput; key: string } | null = null;
  begin(input: CreateWorkWorkspaceInput) {
    if (!this.pending) this.pending = { input: structuredClone(input), key: crypto.randomUUID() };
    return this.pending;
  }
  resolved() { this.pending = null; }
}

export function resolvedWorkspaceRejection(error: unknown): boolean {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const raw = `${String(value?.code || "")} ${String(value?.message || "")}`;
  const code = raw.match(/(?:^|[^A-Z0-9_])(WORK_[A-Z0-9_]+)/)?.[1];
  return !!code && code !== "WORK_IDEMPOTENCY_CONFLICT";
}
