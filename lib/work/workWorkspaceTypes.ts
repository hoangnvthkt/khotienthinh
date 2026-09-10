/** Contracts for the Work Workspace foundation.
 *
 * Workspace scopes intentionally live beside (rather than replace) WorkScope.
 * R1A callers can continue to use WorkScope until the task access bridge is
 * implemented; the parser below gives new callers one strict boundary for both
 * new workspace scopes and those legacy department/project payloads.
 */

export type WorkspaceKind = 'department' | 'project' | 'collaboration';
export type WorkspaceRole = 'admin' | 'member';
export type WorkspaceStatus = 'active' | 'archived';
export type WorkspaceMemberOrigin = 'manual' | 'organization' | 'project';

/** A task that is not owned by a Workspace. */
export interface WorkspaceDirectScope {
  type: 'direct';
  workspaceId?: never;
  departmentId?: never;
  projectId?: never;
}

/** The scope sent by a new client for a Workspace task. */
export type WorkspaceTaskScope = {
  type: 'workspace';
  workspaceId: string;
  departmentId?: never;
  projectId?: never;
};

/** The department/project scope shape sent by an R1A (legacy) client. */
export type WorkspaceLegacyScope =
  | {
      type: 'department';
      departmentId: string;
      workspaceId?: never;
      projectId?: never;
    }
  | {
      type: 'project';
      projectId: string;
      workspaceId?: never;
      departmentId?: never;
    };

/** All scope payloads accepted at the Workspace boundary. */
export type WorkspaceScopeInput =
  | WorkspaceDirectScope
  | WorkspaceTaskScope
  | WorkspaceLegacyScope;

/** The parser returns the same discriminated shape after strict validation. */
export type WorkspaceScope = WorkspaceScopeInput;

/** Aliases make the Work-prefixed form convenient for existing Work modules. */
export type WorkWorkspaceScopeInput = WorkspaceScopeInput;
export type WorkWorkspaceScope = WorkspaceScope;

export type WorkspaceCursor = { sortAt: string; id: string };

export interface WorkspaceCapabilities {
  canView: boolean;
  canCreateTask: boolean;
  canManageMembers: boolean;
  canConfigure: boolean;
  canArchive: boolean;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  sourceName: string | null;
  iconKey: string;
  colorKey: string;
  coverKey: string;
  pinned: boolean;
  memberCount: number;
  visibleOpenTaskCount: number;
  myActionCount: number;
  capabilities: WorkspaceCapabilities;
  lockVersion: number;
}

export interface WorkspacePage<T> {
  items: T[];
  nextCursor: WorkspaceCursor | null;
}

export interface WorkspaceMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  origin: WorkspaceMemberOrigin;
  expiresAt: string | null;
  lockVersion: number;
}

export interface MembershipChange {
  operation: 'add' | 'remove' | 'set_role';
  userId: string;
  role?: WorkspaceRole;
  expiresAt?: string | null;
  /** Provenance is verified against the current linked source by the server. */
  origin?: WorkspaceMemberOrigin;
  sourceReference?: string;
}

export interface WorkspaceMembershipBlocker {
  userId: string;
  code: string;
  openAssignmentCount: number;
  openReviewCount: number;
}

export interface MembershipPreview {
  fingerprint: string;
  changes: MembershipChange[];
  blockers: WorkspaceMembershipBlocker[];
}

export type WorkspaceScopeValidationCode =
  | 'WORK_SCOPE_INVALID'
  | 'WORK_SCOPE_INVALID_TYPE'
  | 'WORK_SCOPE_UNKNOWN_FIELD'
  | 'WORK_SCOPE_MISSING_FIELD'
  | 'WORK_SCOPE_INVALID_FIELD';

/** Error raised when a scope payload is not an exact accepted scope shape. */
export class WorkspaceScopeValidationError extends Error {
  constructor(
    public readonly code: WorkspaceScopeValidationCode,
    detail?: string,
  ) {
    const prefix = code === 'WORK_SCOPE_INVALID' ? code : `WORK_SCOPE_INVALID (${code})`;
    super(detail ? `${prefix}: ${detail}` : prefix);
    this.name = 'WorkspaceScopeValidationError';
  }
}

type ScopeRecord = Record<string, unknown>;

const invalidScope = (
  code: Exclude<WorkspaceScopeValidationCode, 'WORK_SCOPE_INVALID'>,
  detail: string,
): never => {
  throw new WorkspaceScopeValidationError(code, detail);
};

const asScopeRecord = (value: unknown): ScopeRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceScopeValidationError('WORK_SCOPE_INVALID', 'scope must be an object');
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WorkspaceScopeValidationError('WORK_SCOPE_INVALID', 'scope must be a plain object');
  }

  return value as ScopeRecord;
};

const hasOwn = (record: ScopeRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const assertExactKeys = (record: ScopeRecord, allowed: readonly string[]): void => {
  const allowedKeys = new Set(allowed);
  const unknownKeys = Reflect.ownKeys(record).filter(
    (key) => typeof key !== 'string' || !allowedKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    invalidScope('WORK_SCOPE_UNKNOWN_FIELD', unknownKeys.map(String).join(', '));
  }
};

const requiredScopeType = (record: ScopeRecord): string => {
  if (!hasOwn(record, 'type')) {
    invalidScope('WORK_SCOPE_MISSING_FIELD', 'type');
  }
  if (typeof record.type !== 'string') {
    invalidScope('WORK_SCOPE_INVALID_TYPE', 'type must be a string');
  }
  return record.type as string;
};

const requiredScopeId = (record: ScopeRecord, field: string): string => {
  if (!hasOwn(record, field)) {
    invalidScope('WORK_SCOPE_MISSING_FIELD', field);
  }
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidScope('WORK_SCOPE_INVALID_FIELD', `${field} must be a non-empty string`);
  }
  return value as string;
};

/** Parse and strictly validate a direct, Workspace, or legacy scope payload. */
export const parseWorkspaceScope = (value: unknown): WorkspaceScope => {
  const record = asScopeRecord(value);
  const type = requiredScopeType(record);

  switch (type) {
    case 'direct':
      assertExactKeys(record, ['type']);
      return { type: 'direct' };
    case 'workspace': {
      assertExactKeys(record, ['type', 'workspaceId']);
      return { type: 'workspace', workspaceId: requiredScopeId(record, 'workspaceId') };
    }
    case 'department': {
      assertExactKeys(record, ['type', 'departmentId']);
      return { type: 'department', departmentId: requiredScopeId(record, 'departmentId') };
    }
    case 'project': {
      assertExactKeys(record, ['type', 'projectId']);
      return { type: 'project', projectId: requiredScopeId(record, 'projectId') };
    }
    default:
      invalidScope('WORK_SCOPE_INVALID_TYPE', `unsupported type ${JSON.stringify(type)}`);
  }
};

/** Throwing validator for call sites that want the parsed canonical value. */
export const validateWorkspaceScope = (value: unknown): WorkspaceScope =>
  parseWorkspaceScope(value);

/** Type guard for branches that only need to check a payload. */
export const isWorkspaceScope = (value: unknown): value is WorkspaceScope => {
  try {
    parseWorkspaceScope(value);
    return true;
  } catch {
    return false;
  }
};

export const parseWorkWorkspaceScope = parseWorkspaceScope;
export const validateWorkWorkspaceScope = validateWorkspaceScope;
export const isWorkWorkspaceScope = isWorkspaceScope;
