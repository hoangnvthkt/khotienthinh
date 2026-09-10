import {
  canPerform,
  getUserAuthorizationSnapshot,
} from "../permissions/permissionService";
export const canConfigureWork = (
  user: Parameters<typeof getUserAuthorizationSnapshot>[0],
) =>
  !!getUserAuthorizationSnapshot(user)?.sources.some(
    (source) =>
      source.permissionCode === "work.task.configure" &&
      canPerform(user, "work.task.configure", {
        scopeType: source.scopeType,
        scopeId: source.scopeId,
      }),
  );

export const canConfigureWorkspace = (
  user: Parameters<typeof getUserAuthorizationSnapshot>[0],
  workspaceId: string,
) =>
  !!getUserAuthorizationSnapshot(user)?.sources.some(
    (source) =>
      source.permissionCode === "work.task.configure" &&
      source.scopeType === "work_workspace" &&
      source.scopeId === workspaceId &&
      (!source.startsAt || new Date(source.startsAt).getTime() <= Date.now()) &&
      (!source.expiresAt || new Date(source.expiresAt).getTime() > Date.now()) &&
      canPerform(user, "work.task.configure", {
        scopeType: "work_workspace",
        scopeId: workspaceId,
      }),
  );
