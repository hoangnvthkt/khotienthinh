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
