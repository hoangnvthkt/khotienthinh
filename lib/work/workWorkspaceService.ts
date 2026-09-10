import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MembershipChange,
  MembershipPreview,
  WorkspaceCursor,
  WorkspaceKind,
  WorkspaceMember,
  WorkspacePage,
  WorkspaceSummary,
} from './workWorkspaceTypes';

/** The client-side page sizes mirror the server's bounded Workspace readers. */
export const WORKSPACE_PAGE_LIMIT = 24;
export const WORKSPACE_MEMBER_PAGE_LIMIT = 30;
export const WORKSPACE_SOURCE_PAGE_LIMIT = 50;
export const WORKSPACE_MEMBERSHIP_BATCH_LIMIT = 100;
export const WORKSPACE_SEARCH_LIMIT = 100;

export type WorkspaceSort = 'updated' | 'recent';
export type WorkspaceCommand = 'update_profile' | 'archive' | 'restore';

export interface CreateWorkWorkspaceInput {
  kind: WorkspaceKind;
  name: string;
  departmentId?: string;
  projectId?: string;
  iconKey: string;
  colorKey: string;
  coverKey: string;
}

/** A source that can be linked when creating a Workspace. */
export interface WorkWorkspaceSource {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** Omitted when the actor cannot see the existing linked Workspace. */
  existingWorkspaceId?: string | null;
}

export interface WorkspacePreferenceResult {
  workspaceId: string;
  pinned: boolean;
  lastOpenedAt: string | null;
}

export type WorkWorkspaceErrorCode = string;

/**
 * Normalized error returned by a Work Workspace RPC.
 *
 * Supabase exposes a Postgres error code and keeps business error codes in the
 * message/details for `raise exception` responses. Keeping both the normalized
 * code and original error lets callers render a recoverable conflict while
 * retaining diagnostics for logging.
 */
export class WorkWorkspaceRpcError extends Error {
  readonly code: WorkWorkspaceErrorCode;
  readonly details?: string;
  readonly hint?: string;
  readonly cause: unknown;

  constructor(
    code: WorkWorkspaceErrorCode,
    message: string,
    cause?: unknown,
    details?: string,
    hint?: string,
  ) {
    super(message);
    this.name = 'WorkWorkspaceRpcError';
    this.code = code;
    this.cause = cause;
    this.details = details;
    this.hint = hint;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const businessCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/(?:^|[^A-Z0-9_])(WORK_[A-Z0-9_]+)(?:$|[^A-Z0-9_])/);
  return match?.[1];
};

/** Convert PostgREST/PLPGSQL failures into stable, inspectable UI errors. */
export const mapWorkWorkspaceError = (error: unknown): WorkWorkspaceRpcError => {
  if (error instanceof WorkWorkspaceRpcError) return error;

  const value = isRecord(error) ? error : {};
  const rawCode = typeof value.code === 'string' ? value.code : undefined;
  const details = typeof value.details === 'string' ? value.details : undefined;
  const hint = typeof value.hint === 'string' ? value.hint : undefined;
  const rawMessage = typeof value.message === 'string'
    ? value.message
    : details || 'Work Workspace RPC failed.';
  const code = businessCode(rawCode)
    || businessCode(rawMessage)
    || businessCode(details)
    || 'WORK_WORKSPACE_RPC_FAILED';

  return new WorkWorkspaceRpcError(code, rawMessage, error, details, hint);
};

const assertNonEmpty = (value: string, field: string): void => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkWorkspaceRpcError(
      'WORK_WORKSPACE_INVALID_INPUT',
      `${field} must be a non-empty string.`,
    );
  }
};

const assertSearch = (search: string): void => {
  if (typeof search !== 'string' || search.length > WORKSPACE_SEARCH_LIMIT) {
    throw new WorkWorkspaceRpcError(
      'WORK_WORKSPACE_SEARCH_TOO_LONG',
      `Workspace search must be at most ${WORKSPACE_SEARCH_LIMIT} characters.`,
    );
  }
};

const assertBatch = (changes: readonly MembershipChange[]): void => {
  if (!Array.isArray(changes) || changes.length > WORKSPACE_MEMBERSHIP_BATCH_LIMIT) {
    throw new WorkWorkspaceRpcError(
      'WORK_MEMBERSHIP_BATCH_TOO_LARGE',
      `Workspace membership changes are limited to ${WORKSPACE_MEMBERSHIP_BATCH_LIMIT} users per command.`,
    );
  }
};

const assertKey = (key: string): void => assertNonEmpty(key, 'key');

export function createWorkWorkspaceService(
  client: Pick<SupabaseClient, 'rpc'>,
) {
  const call = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) throw mapWorkWorkspaceError(error);
      if (data === null || data === undefined) {
        throw new WorkWorkspaceRpcError(
          'WORK_WORKSPACE_EMPTY_RESPONSE',
          `${name} did not return a response.`,
        );
      }
      return data as T;
    } catch (error) {
      throw mapWorkWorkspaceError(error);
    }
  };

  const create = async (
    input: CreateWorkWorkspaceInput,
    key: string,
  ): Promise<WorkspaceSummary> => {
    assertKey(key);
    return call<WorkspaceSummary>('create_work_workspace', {
      p_input: input,
      p_key: key,
    });
  };

  const list = async (
    search = '',
    kind: WorkspaceKind | null = null,
    cursor: WorkspaceCursor | null = null,
    pinnedOnly: boolean | null = null,
    sort: WorkspaceSort = 'updated',
  ): Promise<WorkspacePage<WorkspaceSummary>> => {
    assertSearch(search);
    return call<WorkspacePage<WorkspaceSummary>>('list_my_work_workspaces', {
      p_search: search,
      p_kind: kind,
      p_cursor: cursor,
      p_pinned_only: pinnedOnly,
      p_sort: sort,
      p_limit: WORKSPACE_PAGE_LIMIT,
    });
  };

  const get = async (workspaceId: string): Promise<WorkspaceSummary> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    return call<WorkspaceSummary>('get_work_workspace', {
      p_workspace_id: workspaceId,
    });
  };

  const members = async (
    workspaceId: string,
    search = '',
    cursor: WorkspaceCursor | null = null,
  ): Promise<WorkspacePage<WorkspaceMember>> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    assertSearch(search);
    return call<WorkspacePage<WorkspaceMember>>('list_work_workspace_members', {
      p_workspace_id: workspaceId,
      p_search: search,
      p_cursor: cursor,
      p_limit: WORKSPACE_MEMBER_PAGE_LIMIT,
    });
  };

  const previewMembers = async (
    workspaceId: string,
    changes: MembershipChange[],
  ): Promise<MembershipPreview> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    assertBatch(changes);
    return call<MembershipPreview>('preview_work_workspace_members', {
      p_workspace_id: workspaceId,
      p_changes: changes,
    });
  };

  const applyMembers = async (
    workspaceId: string,
    preview: MembershipPreview,
    expectedVersion: number,
    reason: string,
    key: string,
  ): Promise<{ lockVersion: number }> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    assertBatch(preview.changes);
    assertNonEmpty(preview.fingerprint, 'preview.fingerprint');
    assertNonEmpty(reason, 'reason');
    assertKey(key);
    return call<{ lockVersion: number }>('apply_work_workspace_members', {
      p_workspace_id: workspaceId,
      p_preview: preview,
      p_expected_version: expectedVersion,
      p_reason: reason,
      p_key: key,
    });
  };

  const command = async (
    workspaceId: string,
    commandName: WorkspaceCommand,
    payload: Record<string, unknown>,
    expectedVersion: number,
    reason: string,
    key: string,
  ): Promise<WorkspaceSummary> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    if (!['update_profile', 'archive', 'restore'].includes(commandName)) {
      throw new WorkWorkspaceRpcError(
        'WORK_WORKSPACE_COMMAND_INVALID',
        `Unsupported Workspace command: ${String(commandName)}.`,
      );
    }
    assertNonEmpty(reason, 'reason');
    assertKey(key);
    return call<WorkspaceSummary>('command_work_workspace', {
      p_workspace_id: workspaceId,
      p_command: commandName,
      p_payload: payload,
      p_expected_version: expectedVersion,
      p_reason: reason,
      p_key: key,
    });
  };

  const sources = async (
    kind: WorkspaceKind,
    search = '',
    cursor: WorkspaceCursor | null = null,
  ): Promise<WorkspacePage<WorkWorkspaceSource>> => {
    assertSearch(search);
    return call<WorkspacePage<WorkWorkspaceSource>>('list_work_workspace_sources', {
      p_kind: kind,
      p_search: search,
      p_cursor: cursor,
      p_limit: WORKSPACE_SOURCE_PAGE_LIMIT,
    });
  };

  const recover = async (
    workspaceId: string,
    userId: string,
    reason: string,
    key: string,
  ): Promise<{ lockVersion: number }> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    assertNonEmpty(userId, 'userId');
    assertNonEmpty(reason, 'reason');
    assertKey(key);
    return call<{ lockVersion: number }>('recover_work_workspace_admin', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
      p_reason: reason,
      p_key: key,
    });
  };

  const setPreference = async (
    workspaceId: string,
    pinned: boolean | null,
    opened = false,
  ): Promise<WorkspacePreferenceResult> => {
    assertNonEmpty(workspaceId, 'workspaceId');
    return call<WorkspacePreferenceResult>('set_work_workspace_preference', {
      p_workspace_id: workspaceId,
      p_pinned: pinned,
      p_opened: opened,
    });
  };

  return {
    create,
    list,
    get,
    members,
    previewMembers,
    applyMembers,
    command,
    sources,
    listSources: sources,
    recover,
    recoverAdmin: recover,
    setPreference,
    preference: setPreference,
  };
}

export type WorkWorkspaceService = ReturnType<typeof createWorkWorkspaceService>;
