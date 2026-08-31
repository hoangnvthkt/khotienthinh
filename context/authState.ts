import type { Session } from '@supabase/supabase-js';
import { Role, type EffectivePermissionSource, type User, type UserPermissionGrant } from '../types';

export type AuthStatus =
  | 'initializing'
  | 'loading_profile'
  | 'authenticated'
  | 'anonymous'
  | 'error'
  | 'signing_out';

export interface AuthFailure {
  code:
    | 'session_verification_failed'
    | 'session_user_mismatch'
    | 'profile_missing'
    | 'profile_inactive'
    | 'profile_mismatch'
    | 'invalid_profile_id'
    | 'profile_load_failed'
    | 'sign_out_failed';
  message: string;
  cause?: unknown;
}

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: AuthFailure | null;
}

export type AuthAction =
  | { type: 'NO_SESSION' }
  | { type: 'VERIFYING_SESSION'; session: Session }
  | { type: 'AUTHENTICATED'; session: Session | null; user: User }
  | { type: 'FAILED'; error: AuthFailure }
  | { type: 'SIGNING_OUT' };

export interface AuthProfileGateway {
  verifySession(session: Session): Promise<{ id: string }>;
  loadActiveProfileByAuthId(authId: string): Promise<unknown | null>;
  loadEffectivePermissionSources(userId: string): Promise<unknown[]>;
  loadSignatureUrl(userId: string): Promise<string | undefined>;
}

export const createInitialAuthState = (): AuthState => ({
  status: 'initializing',
  session: null,
  user: null,
  error: null,
});

export const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'NO_SESSION':
      return { status: 'anonymous', session: null, user: null, error: null };
    case 'VERIFYING_SESSION':
      return { status: 'loading_profile', session: action.session, user: null, error: null };
    case 'AUTHENTICATED':
      return { status: 'authenticated', session: action.session, user: action.user, error: null };
    case 'FAILED':
      return { status: 'error', session: null, user: null, error: action.error };
    case 'SIGNING_OUT':
      return { ...state, status: 'signing_out', error: null };
    default:
      return state;
  }
};

export class AuthAttemptCoordinator {
  private currentAttempt = 0;

  begin(): number {
    this.currentAttempt += 1;
    return this.currentAttempt;
  }

  isCurrent(attempt: number): boolean {
    return attempt === this.currentAttempt;
  }
}

export class KeyedSingleFlightCoordinator<K, T> {
  private activeKey: K | undefined;
  private activeRequest: Promise<T> | null = null;

  run(key: K, operation: () => Promise<T>): Promise<T> {
    if (this.activeRequest && Object.is(this.activeKey, key)) {
      return this.activeRequest;
    }

    let request: Promise<T>;
    try {
      request = operation();
    } catch (error) {
      return Promise.reject(error);
    }
    this.activeKey = key;
    this.activeRequest = request;

    const clearRequest = () => {
      if (this.activeRequest === request) {
        this.activeKey = undefined;
        this.activeRequest = null;
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }
}

export interface AuthEpochSnapshot {
  epoch: number;
  accessToken: string;
}

export class AuthoritativeAuthEpoch {
  private epoch = 0;
  private latestAuthEventToken: string | null | undefined;
  private logoutIntent = false;

  get version(): number {
    return this.epoch;
  }

  isVersion(version: number): boolean {
    return version === this.epoch;
  }

  acceptAuthoritativeSession(accessToken: string): AuthEpochSnapshot {
    this.epoch += 1;
    this.logoutIntent = false;
    this.latestAuthEventToken = accessToken;
    return { epoch: this.epoch, accessToken };
  }

  acceptAuthoritativeNoSession(): void {
    this.epoch += 1;
    this.logoutIntent = false;
    this.latestAuthEventToken = null;
  }

  observeAuthEvent(accessToken: string | null): AuthEpochSnapshot | null {
    this.epoch += 1;
    if (this.logoutIntent && accessToken !== null) {
      // A refresh/sign-in event emitted after a failed logout must not resurrect
      // the protected tree until an explicit retry or a new login is verified.
      return null;
    }
    this.logoutIntent = false;
    this.latestAuthEventToken = accessToken;
    return accessToken === null
      ? null
      : { epoch: this.epoch, accessToken };
  }

  beginLogoutIntent(): void {
    this.epoch += 1;
    this.logoutIntent = true;
  }

  captureCandidate(accessToken: string): AuthEpochSnapshot | null {
    if (
      this.logoutIntent
      || this.latestAuthEventToken === null
      || (
        this.latestAuthEventToken !== undefined
        && this.latestAuthEventToken !== accessToken
      )
    ) {
      return null;
    }
    return { epoch: this.epoch, accessToken };
  }

  canResolve(snapshot: AuthEpochSnapshot): boolean {
    return (
      !this.logoutIntent
      && snapshot.epoch === this.epoch
      && this.latestAuthEventToken !== null
      && (
        this.latestAuthEventToken === undefined
        || this.latestAuthEventToken === snapshot.accessToken
      )
    );
  }
}

interface SupportedSignOutGateway {
  signOut(): Promise<{ error: unknown | null }>;
  getSession(): Promise<{
    data: { session: Session | null };
    error: unknown | null;
  }>;
}

export const signOutAndConfirmLocalSessionCleared = async (
  gateway: SupportedSignOutGateway,
): Promise<void> => {
  let signOutError: unknown | null = null;
  try {
    ({ error: signOutError } = await gateway.signOut());
  } catch (cause) {
    signOutError = cause;
  }

  const { data, error: sessionError } = await gateway.getSession();
  if (sessionError) throw sessionError;
  if (data.session) {
    if (signOutError) throw signOutError;
    throw new Error('Supabase local session is still present after signout');
  }
};

export const shouldRefreshCurrentProfile = (
  payload: { eventType?: string; new?: { id?: unknown }; old?: { id?: unknown } },
  profileId: string,
): boolean => {
  if (payload.eventType === 'UPDATE') return payload.new?.id === profileId;
  if (payload.eventType === 'DELETE') return payload.old?.id === profileId;
  return false;
};

export const authenticateMockUser = (
  configured: boolean,
  email: string,
  password: string,
  users: User[],
): User | null => {
  if (configured) return null;
  const normalizedEmail = email.trim().toLowerCase();
  const match = users.find(candidate => (
    candidate.email.trim().toLowerCase() === normalizedEmail
    && candidate.password === password
    && candidate.isActive !== false
  ));
  return match ? { ...match } : null;
};

export const parseStoredMockUser = (storedValue: string, users: User[]): User | null => {
  let storedUser: User | null = null;
  try {
    const parsed = JSON.parse(storedValue) as User | string;
    if (typeof parsed === 'string') {
      const legacyMatch = users.find(candidate => candidate.id === parsed);
      storedUser = legacyMatch ? { ...legacyMatch } : null;
    } else {
      storedUser = parsed;
    }
  } catch {
    const legacyMatch = users.find(candidate => candidate.id === storedValue);
    storedUser = legacyMatch ? { ...legacyMatch } : null;
  }
  if (!storedUser) return null;

  const baseUser = users.find(candidate => (
    candidate.id === storedUser?.id && candidate.isActive !== false
  ));
  if (!baseUser) return null;
  const mergedUser = { ...baseUser, ...storedUser, password: baseUser.password };
  return mergedUser.isActive === false ? null : mergedUser;
};

export const serializeMockUser = (user: User): string => {
  const { password: _password, avatar: _avatar, ...safeUser } = user;
  return JSON.stringify(safeUser);
};

export type ApplicationShell = 'public_login' | 'authenticated';

export const selectApplicationShell = (pathname: string): ApplicationShell => (
  pathname === '/login' ? 'public_login' : 'authenticated'
);

export const shouldRevalidateInBackground = (state: AuthState, session: Session): boolean => (
  state.status === 'authenticated'
  && state.user?.authId === session.user.id
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

const normalizeDbRole = (role: unknown): Role => {
  if (role === 'KEEPER') return Role.WAREHOUSE_KEEPER;
  return role as Role;
};

export const mapUserPermissionGrantRow = (row: any): UserPermissionGrant => ({
  id: row.id,
  userId: row.user_id ?? row.userId,
  permissionCode: row.permission_code ?? row.permissionCode,
  scopeType: row.scope_type ?? row.scopeType ?? 'global',
  scopeId: row.scope_id ?? row.scopeId ?? '*',
  isActive: row.is_active ?? row.isActive ?? true,
  grantedBy: row.granted_by ?? row.grantedBy,
  grantedAt: row.granted_at ?? row.grantedAt,
  expiresAt: row.expires_at ?? row.expiresAt,
});

export const mapEffectivePermissionSourceRow = (row: any): EffectivePermissionSource => ({
  permissionCode: row.permission_code ?? row.permissionCode,
  sourceType: row.source_type ?? row.sourceType,
  sourceId: row.source_id ?? row.sourceId ?? undefined,
  sourceCode: row.source_code ?? row.sourceCode ?? undefined,
  sourceLabel: row.source_label ?? row.sourceLabel ?? undefined,
  scopeType: row.scope_type ?? row.scopeType ?? 'global',
  scopeId: row.scope_id ?? row.scopeId ?? '*',
  startsAt: row.starts_at ?? row.startsAt ?? undefined,
  expiresAt: row.expires_at ?? row.expiresAt ?? undefined,
  riskLevel: row.risk_level ?? row.riskLevel ?? undefined,
  isBusinessApproval: row.is_business_approval ?? row.isBusinessApproval ?? false,
  metadata: row.metadata ?? {},
});

const effectiveSourceToGrant = (
  userId: string,
  source: EffectivePermissionSource,
): UserPermissionGrant => ({
  id: source.sourceId,
  userId,
  permissionCode: source.permissionCode,
  scopeType: source.scopeType,
  scopeId: source.scopeId,
  isActive: true,
  grantedBy: undefined,
  grantedAt: source.startsAt,
  expiresAt: source.expiresAt,
});

export const mapUserProfileRow = (row: any): User => ({
  id: row.id,
  authId: row.auth_id ?? row.authId,
  name: row.name,
  email: row.email,
  username: row.username ?? undefined,
  phone: row.phone ?? undefined,
  role: normalizeDbRole(row.role),
  avatar: row.avatar ?? undefined,
  assignedWarehouseId: row.assigned_warehouse_id ?? row.assignedWarehouseId ?? undefined,
  allowedModules: row.allowed_modules ?? row.allowedModules ?? undefined,
  adminModules: row.admin_modules ?? row.adminModules ?? undefined,
  allowedSubModules: row.allowed_sub_modules ?? row.allowedSubModules ?? undefined,
  adminSubModules: row.admin_sub_modules ?? row.adminSubModules ?? undefined,
  managerId: row.manager_id ?? row.managerId ?? undefined,
  isActive: row.is_active ?? row.isActive,
  accountStatus: row.account_status ?? row.accountStatus ?? (row.is_active === false ? 'DISABLED' : 'ACTIVE'),
  accountOperationStatus: row.account_operation_status ?? row.accountOperationStatus ?? 'IDLE',
  accountOperationAction: row.account_operation_action ?? row.accountOperationAction ?? undefined,
  disabledAt: row.disabled_at ?? row.disabledAt ?? undefined,
  disabledBy: row.disabled_by ?? row.disabledBy ?? undefined,
  disabledReason: row.disabled_reason ?? row.disabledReason ?? undefined,
  reactivatedAt: row.reactivated_at ?? row.reactivatedAt ?? undefined,
  reactivatedBy: row.reactivated_by ?? row.reactivatedBy ?? undefined,
  reactivationReason: row.reactivation_reason ?? row.reactivationReason ?? undefined,
});

export class AuthResolutionError extends Error {
  constructor(public readonly failure: AuthFailure) {
    super(failure.message);
    this.name = 'AuthResolutionError';
  }
}

const fail = (failure: AuthFailure): never => {
  throw new AuthResolutionError(failure);
};

export const resolveCandidateSession = async (
  session: Session,
  gateway: AuthProfileGateway,
): Promise<User> => {
  let verifiedUser: { id: string };
  try {
    verifiedUser = await gateway.verifySession(session);
  } catch (cause) {
    return fail({
      code: 'session_verification_failed',
      message: 'Không thể xác minh phiên đăng nhập. Vui lòng đăng nhập lại.',
      cause,
    });
  }

  if (!isUuid(verifiedUser.id)) {
    return fail({
      code: 'session_verification_failed',
      message: 'Supabase trả về định danh xác thực không hợp lệ.',
    });
  }
  if (session.user.id !== verifiedUser.id) {
    return fail({
      code: 'session_user_mismatch',
      message: 'Phiên đăng nhập không khớp người dùng đã được xác minh.',
    });
  }

  let row: any;
  try {
    row = await gateway.loadActiveProfileByAuthId(verifiedUser.id);
  } catch (cause) {
    return fail({
      code: 'profile_load_failed',
      message: 'Không thể tải hồ sơ người dùng.',
      cause,
    });
  }
  if (!row) {
    return fail({
      code: 'profile_missing',
      message: 'Tài khoản xác thực chưa được liên kết với hồ sơ đang hoạt động.',
    });
  }

  const mappedUser = mapUserProfileRow(row);
  if (mappedUser.isActive !== true) {
    return fail({
      code: 'profile_inactive',
      message: 'Hồ sơ người dùng đã bị vô hiệu hóa.',
    });
  }
  if (!isUuid(mappedUser.id)) {
    return fail({
      code: 'invalid_profile_id',
      message: 'Hồ sơ người dùng có định danh không hợp lệ.',
    });
  }
  if (mappedUser.authId !== verifiedUser.id) {
    return fail({
      code: 'profile_mismatch',
      message: 'Hồ sơ người dùng không khớp phiên xác thực.',
    });
  }

  try {
    const [permissionSourceRows, signatureUrl] = await Promise.all([
      gateway.loadEffectivePermissionSources(mappedUser.id),
      gateway.loadSignatureUrl(mappedUser.id),
    ]);
    const effectivePermissionSources = permissionSourceRows.map(mapEffectivePermissionSourceRow);
    return {
      ...mappedUser,
      effectivePermissionSources,
      permissionGrants: effectivePermissionSources.map(source => effectiveSourceToGrant(mappedUser.id, source)),
      signatureUrl,
    };
  } catch (cause) {
    return fail({
      code: 'profile_load_failed',
      message: 'Không thể hoàn tất tải hồ sơ người dùng.',
      cause,
    });
  }
};
