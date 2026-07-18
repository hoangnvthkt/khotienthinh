import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { Role, type User, type UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import {
  AuthoritativeAuthEpoch,
  AuthAttemptCoordinator,
  authReducer,
  authenticateMockUser,
  createInitialAuthState,
  parseStoredMockUser,
  resolveCandidateSession,
  serializeMockUser,
  selectApplicationShell,
  shouldRefreshCurrentProfile,
  shouldRevalidateInBackground,
  signOutAndConfirmLocalSessionCleared,
  type AuthProfileGateway,
} from '../../context/authState';
import { AuthGateView } from '../../context/AuthContext';
import { clearAppOwnedAuthStorage } from '../authStorage';

const AUTH_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

class MemoryAuthStorage implements Pick<Storage, 'length' | 'key' | 'removeItem'> {
  private readonly values = new Map<string, string>();

  constructor(entries: Array<[string, string]>) {
    entries.forEach(([key, value]) => this.values.set(key, value));
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

const makeSession = (accessToken = 'access-token'): Session => ({
  access_token: accessToken,
  refresh_token: `refresh-${accessToken}`,
  expires_in: 3600,
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: AUTH_ID,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-07-15T00:00:00.000Z',
    email: 'member@example.com',
  } as SupabaseUser,
});

const profileRow = {
  id: PROFILE_ID,
  auth_id: AUTH_ID,
  name: 'Verified Member',
  email: 'member@example.com',
  role: Role.EMPLOYEE,
  is_active: true,
  assigned_warehouse_id: null,
};

const permissionGrant: UserPermissionGrant = {
  id: 'grant-1',
  userId: PROFILE_ID,
  permissionCode: 'inventory.items.view',
  scopeType: 'global',
  scopeId: '*',
  isActive: true,
};

const effectivePermission: EffectivePermissionSource = {
  permissionCode: 'inventory.items.view',
  sourceType: 'DIRECT',
  sourceId: 'grant-1',
  sourceCode: 'DIRECT',
  sourceLabel: 'Direct grant',
  scopeType: 'global',
  scopeId: '*',
  riskLevel: 'normal',
  isBusinessApproval: false,
  metadata: {},
};

const makeGateway = (overrides: Partial<AuthProfileGateway> = {}): AuthProfileGateway => ({
  verifySession: vi.fn(async () => ({ id: AUTH_ID })),
  loadActiveProfileByAuthId: vi.fn(async () => profileRow),
  loadPermissionGrants: vi.fn(async () => [permissionGrant]),
  loadEffectivePermissionSources: vi.fn(async () => [effectivePermission]),
  loadSignatureUrl: vi.fn(async () => 'https://example.com/signature.png'),
  ...overrides,
});

describe('fail-closed auth state', () => {
  it('moves a missing session to anonymous without retaining a user', () => {
    const state = authReducer(createInitialAuthState(), { type: 'NO_SESSION' });

    expect(state).toEqual({
      status: 'anonymous',
      session: null,
      user: null,
      error: null,
    });
  });

  it('accepts only a verified session with one active UUID profile mapped by exact auth_id', async () => {
    const gateway = makeGateway();
    const session = makeSession();

    const user = await resolveCandidateSession(session, gateway);

    expect(gateway.verifySession).toHaveBeenCalledWith(session);
    expect(gateway.loadActiveProfileByAuthId).toHaveBeenCalledWith(AUTH_ID);
    expect(gateway.loadActiveProfileByAuthId).toHaveBeenCalledTimes(1);
    expect(user).toMatchObject({
      id: PROFILE_ID,
      authId: AUTH_ID,
      name: 'Verified Member',
      role: Role.EMPLOYEE,
      isActive: true,
      signatureUrl: 'https://example.com/signature.png',
      permissionGrants: [permissionGrant],
      effectivePermissions: [effectivePermission],
    });
  });

  it('fails closed when effective permission sources cannot be loaded', async () => {
    const sourceError = new Error('source resolver unavailable');
    const gateway = makeGateway({
      loadEffectivePermissionSources: vi.fn(async () => { throw sourceError; }),
    });

    await expect(resolveCandidateSession(makeSession(), gateway)).rejects.toMatchObject({
      failure: { code: 'profile_load_failed', cause: sourceError },
    });
  });

  it.each([
    ['missing profile', null, 'profile_missing'],
    ['inactive profile', { ...profileRow, is_active: false }, 'profile_inactive'],
    ['auth-id mismatch', { ...profileRow, auth_id: '33333333-3333-4333-8333-333333333333' }, 'profile_mismatch'],
    ['invalid profile UUID', { ...profileRow, id: 'u1' }, 'invalid_profile_id'],
  ])('rejects a %s', async (_label, row, expectedCode) => {
    const gateway = makeGateway({
      loadActiveProfileByAuthId: vi.fn(async () => row),
    });

    await expect(resolveCandidateSession(makeSession(), gateway)).rejects.toMatchObject({
      failure: { code: expectedCode },
    });
  });

  it('re-verifies a refreshed token before replacing the authenticated session', async () => {
    const firstSession = makeSession('first-token');
    const refreshedSession = makeSession('refreshed-token');
    const authenticatedUser = await resolveCandidateSession(firstSession, makeGateway());
    const firstState = authReducer(createInitialAuthState(), {
      type: 'AUTHENTICATED',
      session: firstSession,
      user: authenticatedUser,
    });
    expect(shouldRevalidateInBackground(firstState, refreshedSession)).toBe(true);
    const refreshedUser = await resolveCandidateSession(refreshedSession, makeGateway());
    const refreshedState = authReducer(firstState, {
      type: 'AUTHENTICATED',
      session: refreshedSession,
      user: refreshedUser,
    });

    expect(firstState.status).toBe('authenticated');
    expect(refreshedState.status).toBe('authenticated');
    expect(refreshedState.session?.access_token).toBe('refreshed-token');
  });

  it('invalidates stale profile verification when another tab signs out', () => {
    const attempts = new AuthAttemptCoordinator();
    const staleVerification = attempts.begin();
    const signOutAttempt = attempts.begin();
    const signedOutState = authReducer(
      {
        status: 'authenticated',
        session: makeSession(),
        user: { ...profileRow, authId: AUTH_ID } as unknown as User,
        error: null,
      },
      { type: 'NO_SESSION' },
    );

    expect(attempts.isCurrent(staleVerification)).toBe(false);
    expect(attempts.isCurrent(signOutAttempt)).toBe(true);
    expect(signedOutState.status).toBe('anonymous');
    expect(signedOutState.user).toBeNull();
  });

  it('gives synchronous auth events priority over stale refresh work', () => {
    const epochs = new AuthoritativeAuthEpoch();
    const oldTokenWork = epochs.acceptAuthoritativeSession('old-token');
    const refreshedTokenWork = epochs.observeAuthEvent('refreshed-token');

    expect(refreshedTokenWork).not.toBeNull();
    expect(epochs.canResolve(oldTokenWork)).toBe(false);
    expect(epochs.captureCandidate('old-token')).toBeNull();
    expect(epochs.canResolve(refreshedTokenWork!)).toBe(true);

    epochs.observeAuthEvent(null);
    expect(epochs.captureCandidate('refreshed-token')).toBeNull();
  });

  it('keeps a failed logout tombstone from being resurrected by automatic events, while a reload can recover the persisted session', () => {
    const currentPage = new AuthoritativeAuthEpoch();
    currentPage.acceptAuthoritativeSession('access-token');
    currentPage.beginLogoutIntent();

    expect(currentPage.observeAuthEvent('refreshed-after-failure')).toBeNull();
    expect(currentPage.captureCandidate('access-token')).toBeNull();

    const reloadedPage = new AuthoritativeAuthEpoch();
    const reloadWork = reloadedPage.acceptAuthoritativeSession('access-token');
    expect(reloadedPage.canResolve(reloadWork)).toBe(true);
  });

  it('does not report signout success until Supabase confirms its local session is gone', async () => {
    const networkError = new Error('logout network failure');
    const getSession = vi.fn(async () => ({ data: { session: makeSession() }, error: null }));

    await expect(signOutAndConfirmLocalSessionCleared({
      signOut: vi.fn(async () => ({ error: networkError })),
      getSession,
    })).rejects.toBe(networkError);
    expect(getSession).toHaveBeenCalledTimes(1);

    await expect(signOutAndConfirmLocalSessionCleared({
      signOut: vi.fn(async () => ({ error: networkError })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    })).resolves.toBeUndefined();

    const throwingSignOut = vi.fn(async (): Promise<{ error: null }> => {
      throw networkError;
    });
    await expect(signOutAndConfirmLocalSessionCleared({
      signOut: throwingSignOut,
      getSession: vi.fn(async () => ({ data: { session: makeSession() }, error: null })),
    })).rejects.toBe(networkError);
    await expect(signOutAndConfirmLocalSessionCleared({
      signOut: throwingSignOut,
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    })).resolves.toBeUndefined();

    await expect(signOutAndConfirmLocalSessionCleared({
      signOut: vi.fn(async () => ({ error: null })),
      getSession,
    })).rejects.toThrow(/local session/i);

    await expect(signOutAndConfirmLocalSessionCleared({
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    })).resolves.toBeUndefined();
  });

  it('recognizes only UPDATE or DELETE events for the exact current profile', () => {
    expect(shouldRefreshCurrentProfile({
      eventType: 'UPDATE',
      new: { id: PROFILE_ID },
      old: {},
    }, PROFILE_ID)).toBe(true);
    expect(shouldRefreshCurrentProfile({
      eventType: 'DELETE',
      new: {},
      old: { id: PROFILE_ID },
    }, PROFILE_ID)).toBe(true);
    expect(shouldRefreshCurrentProfile({
      eventType: 'UPDATE',
      new: { id: '33333333-3333-4333-8333-333333333333' },
      old: {},
    }, PROFILE_ID)).toBe(false);
    expect(shouldRefreshCurrentProfile({
      eventType: 'INSERT',
      new: { id: PROFILE_ID },
      old: {},
    }, PROFILE_ID)).toBe(false);
  });

  it('permits mock credentials only when Supabase is unconfigured and only by email', () => {
    const mockUsers: User[] = [{
      id: 'u1',
      name: 'Mock Admin',
      email: 'admin@vioo.vn',
      username: 'admin',
      password: '123',
      role: Role.ADMIN,
    }];

    expect(authenticateMockUser(false, 'admin@vioo.vn', '123', mockUsers)?.id).toBe('u1');
    expect(authenticateMockUser(false, 'admin', '123', mockUsers)).toBeNull();
    expect(authenticateMockUser(true, 'admin@vioo.vn', '123', mockUsers)).toBeNull();
  });

  it('retains mock profile edits across refresh and accepts the legacy stored ID format', () => {
    const mockUsers: User[] = [{
      id: 'u1',
      name: 'Mock Admin',
      email: 'admin@vioo.vn',
      password: '123',
      role: Role.ADMIN,
    }];
    const edited = { ...mockUsers[0], name: 'Updated Mock Admin', phone: '0909000000' };

    expect(parseStoredMockUser(JSON.stringify(edited), mockUsers)).toMatchObject({
      id: 'u1',
      name: 'Updated Mock Admin',
      phone: '0909000000',
      password: '123',
    });
    expect(parseStoredMockUser('u1', mockUsers)?.id).toBe('u1');
    expect(parseStoredMockUser(JSON.stringify({ ...edited, id: 'unknown' }), mockUsers)).toBeNull();
    expect(parseStoredMockUser(JSON.stringify({ ...edited, isActive: false }), mockUsers)).toBeNull();
  });

  it('never persists mock credentials or large avatar data', () => {
    const mockUser: User = {
      id: 'u1',
      name: 'Mock Admin',
      email: 'admin@vioo.vn',
      password: '123',
      avatar: 'data:image/png;base64,private-avatar',
      role: Role.ADMIN,
    };

    expect(JSON.parse(serializeMockUser(mockUser))).toEqual({
      id: 'u1',
      name: 'Mock Admin',
      email: 'admin@vioo.vn',
      role: Role.ADMIN,
    });
  });

  it('selects login as the only public shell without consuming protected route paths', () => {
    expect(selectApplicationShell('/login')).toBe('public_login');
    expect(selectApplicationShell('/')).toBe('authenticated');
    expect(selectApplicationShell('/reports')).toBe('authenticated');
    expect(selectApplicationShell('/unknown')).toBe('authenticated');
  });
});

describe('authenticated provider architecture', () => {
  it('clears only app-owned auth state and preserves Supabase/device preferences', () => {
    const storage = new MemoryAuthStorage([
      ['vioo_user', '{"id":"legacy-profile"}'],
      ['vioo_explicit_logout_at', '123'],
      ['vioo_mock_user', '{"id":"u1"}'],
      ['vioo:user-permission-clipboard', '{"role":"ADMIN"}'],
      ['vioo_user_session_id:11111111-1111-4111-8111-111111111111', 'session-1'],
      ['vioo_user_session_id:u1', 'legacy-session'],
      ['sb-project-auth-token', 'supabase-owned'],
      ['vioo_theme', 'dark'],
      ['sidebar_collapsed', 'true'],
      ['pwa_was_installed', 'true'],
      ['chibibot_chat_user-1', '[{"text":"keep-device-history"}]'],
    ]);

    clearAppOwnedAuthStorage(storage);

    for (const key of [
      'vioo_user',
      'vioo_explicit_logout_at',
      'vioo_mock_user',
      'vioo:user-permission-clipboard',
      'vioo_user_session_id:11111111-1111-4111-8111-111111111111',
      'vioo_user_session_id:u1',
    ]) {
      expect(storage.getItem(key), `${key} must be removed`).toBeNull();
    }
    expect(storage.getItem('sb-project-auth-token')).toBe('supabase-owned');
    expect(storage.getItem('vioo_theme')).toBe('dark');
    expect(storage.getItem('sidebar_collapsed')).toBe('true');
    expect(storage.getItem('pwa_was_installed')).toBe('true');
    expect(storage.getItem('chibibot_chat_user-1')).toContain('keep-device-history');
  });

  it('uses the centralized auth-storage cleanup for local and remote auth loss', () => {
    const authSource = readFileSync(join(process.cwd(), 'context', 'AuthContext.tsx'), 'utf8');

    expect(authSource).toContain("import { clearAppOwnedAuthStorage } from '../lib/authStorage';");
    expect(authSource.match(/clearAppOwnedAuthStorage\(/g)).toHaveLength(2);
    expect(authSource).not.toMatch(/localStorage\.clear\(|removeItem\([^)]*sb-/);
  });

  it('does not render domain children before authenticated status', () => {
    let domainMounts = 0;
    const DomainProbe = () => {
      domainMounts += 1;
      return <span>domain-mounted</span>;
    };

    for (const status of ['initializing', 'loading_profile', 'anonymous', 'error', 'signing_out'] as const) {
      const html = renderToStaticMarkup(
        <AuthGateView
          status={status}
          loadingFallback={<span>loading</span>}
          anonymousFallback={<span>login</span>}
          errorFallback={<span>recovery</span>}
        >
          <DomainProbe />
        </AuthGateView>,
      );
      expect(html).not.toContain('domain-mounted');
    }

    const authenticatedHtml = renderToStaticMarkup(
      <AuthGateView status="authenticated">
        <DomainProbe />
      </AuthGateView>,
    );
    expect(authenticatedHtml).toContain('domain-mounted');
    expect(domainMounts).toBe(1);
  });

  it('places every domain provider and side-effect host inside one authenticated boundary', () => {
    const appSource = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
    const start = appSource.indexOf('export const AuthenticatedApplication');
    const end = appSource.indexOf('const ApplicationRouter', start);
    const protectedApplication = appSource.slice(start, end);
    const boundaryStart = protectedApplication.indexOf('<AuthenticatedBoundary>');
    const boundaryEnd = protectedApplication.indexOf('</AuthenticatedBoundary>');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(boundaryEnd).toBeGreaterThan(boundaryStart);
    for (const child of [
      '<AppProvider>',
      '<WorkflowProvider>',
      '<RequestProvider>',
      '<ChatProvider>',
      '<AppDataWarmup />',
      '<ReleaseNoticeHost />',
    ]) {
      const childPosition = protectedApplication.indexOf(child);
      expect(childPosition, `${child} must be inside the authenticated boundary`).toBeGreaterThan(boundaryStart);
      expect(childPosition, `${child} must be inside the authenticated boundary`).toBeLessThan(boundaryEnd);
    }

    const routerSource = appSource.slice(end, appSource.indexOf('const App:', end));
    expect(routerSource).toContain('selectApplicationShell(pathname)');
    expect(routerSource).toContain("shell === 'public_login'");
    expect(routerSource).not.toContain('<Routes>');
    expect(routerSource).not.toContain('<AppProvider>');
  });

  it('removes duplicate auth ownership and every configured-cloud fallback path', () => {
    const authSource = readFileSync(join(process.cwd(), 'context', 'AuthContext.tsx'), 'utf8');
    const appContextSource = readFileSync(join(process.cwd(), 'context', 'AppContext.tsx'), 'utf8');
    const loginSource = readFileSync(join(process.cwd(), 'pages', 'Login.tsx'), 'utf8');

    expect(authSource).toContain(".eq('auth_id', verifiedUser.id)");
    expect(authSource).toContain(".eq('is_active', true)");
    expect(authSource).toContain('supabase.auth.getUser(session.access_token)');
    expect(authSource).not.toMatch(/lookup_login_email|\.eq\(['"]email['"]|vioo_user/);
    expect(appContextSource).not.toMatch(/onAuthStateChange|lookup_login_email|vioo_user|MOCK_USERS\[0\]/);
    expect(appContextSource).not.toMatch(/\bsetUser\b|\bswitchUser\b|\blogin\s*:/);
    expect(appContextSource).toContain('readonly user: User;');
    expect(authSource).not.toContain('onAuthStateChange(async');
    expect(loginSource).toContain('useAuth()');
    expect(loginSource).toContain('type="email"');
    expect(loginSource).not.toMatch(/xpService\.awardXP|usernameMode|Tên đăng nhập/);
  });

  it('watches the exact current profile independently and navigates only after resolved logout', () => {
    const authSource = readFileSync(join(process.cwd(), 'context', 'AuthContext.tsx'), 'utf8');
    const sidebarSource = readFileSync(join(process.cwd(), 'components', 'Sidebar.tsx'), 'utf8');
    const layoutSource = readFileSync(join(process.cwd(), 'components', 'Layout.tsx'), 'utf8');
    const settingsSource = readFileSync(join(process.cwd(), 'pages', 'settings', 'SettingsAccount.tsx'), 'utf8');

    expect(authSource).toContain("table: 'users'");
    expect(authSource).toContain('filter: `id=eq.${profileId}`');
    expect(authSource).toContain("event: 'UPDATE'");
    expect(authSource).toContain("event: 'DELETE'");
    expect(authSource).not.toContain("event: '*',\n        schema: 'public',\n        table: 'users'");
    expect(authSource).toContain('shouldRefreshCurrentProfile');
    expect(authSource).toContain('refreshProfile');
    expect(authSource).not.toContain('stateRef.current = state;');
    expect(sidebarSource).not.toMatch(/finally\s*\{[^}]*navigate\(['"]\/login/);
    expect(layoutSource).not.toMatch(/finally\s*\{[^}]*navigate\(['"]\/login/);
    expect(settingsSource).not.toMatch(/\.finally\([^)]*(?:href|location)/);
  });
});
