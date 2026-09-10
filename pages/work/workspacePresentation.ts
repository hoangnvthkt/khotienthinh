import type {
  WorkspaceKind,
  WorkspaceSummary,
} from "../../lib/work/workWorkspaceTypes";

export const workspaceRoute = (workspaceId: string) =>
  `/work/spaces/${encodeURIComponent(workspaceId)}`;

export const workspaceCover = (kind: WorkspaceKind) =>
  `/assets/workspaces/${kind}-cover.jpg`;

export const workspaceKindLabel: Record<WorkspaceKind, string> = {
  department: "Phòng ban",
  project: "Dự án",
  collaboration: "Cộng tác",
};

export const mergeWorkspacePage = (
  current: WorkspaceSummary[],
  incoming: WorkspaceSummary[],
) => {
  const next = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => next.set(item.id, item));
  return [...next.values()];
};
