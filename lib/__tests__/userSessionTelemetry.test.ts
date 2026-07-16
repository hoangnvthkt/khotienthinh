import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../../types';
import {
  createUserActivityService,
  type UserActivityService,
} from '../userActivityService';
import {
  UserSessionTelemetryLifecycle,
  performLocalTelemetryLogout,
  shouldEndTelemetrySessionOnServer,
} from '../userSessionTelemetryLifecycle';
import {
  createUserSessionTelemetryRuntime,
  type UserSessionTelemetryEnvironment,
  type UserSessionTelemetryService,
} from '../../hooks/useUserSessionTelemetry';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const AUTH_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const NEW_SESSION_ID = '44444444-4444-4444-8444-444444444444';

const user: User = {
  id: USER_ID,
  authId: AUTH_ID,
  name: 'Telemetry User',
  email: 'telemetry@example.com',
  role: Role.EMPLOYEE,
  isActive: true,
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  access_token: 'valid-access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: AUTH_ID,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-07-15T00:00:00.000Z',
    email: user.email,
  } as SupabaseUser,
  ...overrides,
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

interface QueryOperation {
  table: string;
  kind: 'select' | 'insert' | 'update';
  payload?: unknown;
  columns?: string;
  filters: Array<[string, unknown]>;
}

type QueryResult = { data: any; error: any };

class FakeQuery implements PromiseLike<QueryResult> {
  private kind: QueryOperation['kind'] | null = null;
  private payload: unknown;
  private columns: string | undefined;
  private readonly filters: Array<[string, unknown]> = [];

  constructor(
    private readonly owner: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  select(columns: string) {
    if (!this.kind) this.kind = 'select';
    this.columns = columns;
    return this;
  }

  insert(payload: unknown) {
    this.kind = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.kind = 'update';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push([`${column}:gte`, value]);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push([`${column}:lte`, value]);
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  single() {
    return this.execute();
  }

  maybeSingle() {
    return this.execute();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute() {
    if (!this.kind) throw new Error(`Query kind was not selected for ${this.table}`);
    return this.owner.execute({
      table: this.table,
      kind: this.kind,
      payload: this.payload,
      columns: this.columns,
      filters: [...this.filters],
    });
  }
}

class FakeSupabaseClient {
  readonly operations: QueryOperation[] = [];

  constructor(
    private readonly handler: (operation: QueryOperation) => QueryResult | Promise<QueryResult>,
  ) {}

  from(table: string) {
    return new FakeQuery(this, table);
  }

  rpc = vi.fn(async () => ({ data: 0, error: null }));
  functions = { invoke: vi.fn(async () => ({ data: null, error: null })) };

  async execute(operation: QueryOperation): Promise<QueryResult> {
    this.operations.push(operation);
    return this.handler(operation);
  }
}

const makeService = (
  client: FakeSupabaseClient,
  storage = new MemoryStorage(),
): { service: UserActivityService; storage: MemoryStorage } => ({
  service: createUserActivityService({
    supabaseClient: client,
    getStorage: () => storage,
    getDeviceMetadata: () => ({
      userAgent: 'vitest',
      deviceType: 'desktop',
      platform: 'test',
      url: '/test',
    }),
  }),
  storage,
});

describe('user activity service UUID and storage boundary', () => {
  it('makes zero Supabase calls for an invalid app, auth, explicit session, or stored session UUID', async () => {
    const client = new FakeSupabaseClient(() => ({ data: null, error: null }));
    const { service, storage } = makeService(client);

    await expect(service.ensureSession({ ...user, id: 'u1' })).resolves.toBeNull();
    await expect(service.ensureSession({ ...user, authId: 'u1' })).resolves.toBeNull();
    await expect(service.heartbeat(USER_ID, 'u1')).resolves.toBeUndefined();
    await expect(service.recordEvent('u1', USER_ID, 'heartbeat')).resolves.toBeUndefined();

    storage.setItem(`vioo_user_session_id:${USER_ID}`, 'u1');
    await expect(service.ensureSession(user)).resolves.toBeNull();

    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);
    await expect(service.endSession(USER_ID, 'login' as 'logout')).resolves.toBeUndefined();

    expect(client.operations).toHaveLength(0);
    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBe(SESSION_ID);
  });

  it('does not turn a shared invalid stored UUID result into a replacement session', async () => {
    const client = new FakeSupabaseClient((operation) => (
      operation.table === 'user_sessions' && operation.kind === 'insert'
        ? { data: { id: NEW_SESSION_ID }, error: null }
        : { data: null, error: null }
    ));
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, 'u1');

    await expect(Promise.all([
      service.ensureSession(user),
      service.ensureSession(user),
    ])).resolves.toEqual([null, null]);

    expect(client.operations).toHaveLength(0);
    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBeNull();
  });

  it('removes only app-owned telemetry keys and never a Supabase auth token', () => {
    const client = new FakeSupabaseClient(() => ({ data: null, error: null }));
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);
    storage.setItem('vioo_user_session_id:u1', 'legacy-mock-value');
    storage.setItem('vioo_unrelated_preference', 'keep');
    storage.setItem('sb-project-auth-token', 'keep-secret');

    service.clearAllStoredSessionIds();

    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBeNull();
    expect(storage.getItem('vioo_user_session_id:u1')).toBeNull();
    expect(storage.getItem('vioo_unrelated_preference')).toBe('keep');
    expect(storage.getItem('sb-project-auth-token')).toBe('keep-secret');
  });

  it('rejects an invalid admin UUID filter before constructing a Supabase query', async () => {
    const client = new FakeSupabaseClient(() => ({ data: [], error: null }));
    const { service } = makeService(client);

    await expect(service.listSessions({ userId: 'u1' })).rejects.toThrow(/UUID/i);
    await expect(service.listDeliveries({ userId: 'u1' })).rejects.toThrow(/UUID/i);
    expect(client.operations).toHaveLength(0);
  });
});

describe('ensureSession', () => {
  it('deduplicates concurrent starts to one user_sessions insert', async () => {
    let releaseInsert!: (result: QueryResult) => void;
    const pendingInsert = new Promise<QueryResult>((resolve) => {
      releaseInsert = resolve;
    });
    const client = new FakeSupabaseClient((operation) => {
      if (operation.table === 'user_sessions' && operation.kind === 'insert') return pendingInsert;
      return { data: null, error: null };
    });
    const { service } = makeService(client);

    const first = service.ensureSession(user);
    const second = service.ensureSession(user);
    await Promise.resolve();

    expect(client.operations.filter(operation => (
      operation.table === 'user_sessions' && operation.kind === 'insert'
    ))).toHaveLength(1);

    releaseInsert({ data: { id: NEW_SESSION_ID }, error: null });
    await expect(Promise.all([first, second])).resolves.toEqual([NEW_SESSION_ID, NEW_SESSION_ID]);
  });

  it('resumes only the exact active stored session for both app user and auth user', async () => {
    const client = new FakeSupabaseClient(() => ({ data: { id: SESSION_ID }, error: null }));
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);

    await expect(service.ensureSession(user)).resolves.toBe(SESSION_ID);

    expect(client.operations).toEqual([expect.objectContaining({
      table: 'user_sessions',
      kind: 'select',
      filters: expect.arrayContaining([
        ['id', SESSION_ID],
        ['user_id', USER_ID],
        ['auth_id', AUTH_ID],
        ['status', 'active'],
      ]),
    })]);
  });

  it('clears a definitively stale valid key and creates one replacement session', async () => {
    const client = new FakeSupabaseClient((operation) => {
      if (operation.kind === 'select') return { data: null, error: null };
      if (operation.table === 'user_sessions') return { data: { id: NEW_SESSION_ID }, error: null };
      return { data: null, error: null };
    });
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);

    await expect(service.ensureSession(user)).resolves.toBe(NEW_SESSION_ID);

    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBe(NEW_SESSION_ID);
    expect(client.operations.filter(operation => (
      operation.table === 'user_sessions' && operation.kind === 'insert'
    ))).toHaveLength(1);
  });

  it('preserves the key and never inserts when resume lookup fails with unknown state', async () => {
    const permissionError = { code: '42501', message: 'permission denied for table user_sessions' };
    const client = new FakeSupabaseClient(() => ({ data: null, error: permissionError }));
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);

    await expect(service.ensureSession(user)).rejects.toEqual(permissionError);

    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBe(SESSION_ID);
    expect(client.operations.filter(operation => operation.kind === 'insert')).toHaveLength(0);
  });

  it('starts one valid generation after a StrictMode-like remount joins an abandoned start', async () => {
    let resolveFirstInsert!: (result: QueryResult) => void;
    const firstInsert = new Promise<QueryResult>((resolve) => {
      resolveFirstInsert = resolve;
    });
    let sessionInsertCount = 0;
    const client = new FakeSupabaseClient((operation) => {
      if (operation.table === 'user_sessions' && operation.kind === 'insert') {
        sessionInsertCount += 1;
        return sessionInsertCount === 1
          ? firstInsert
          : { data: { id: NEW_SESSION_ID }, error: null };
      }
      if (operation.table === 'user_sessions' && operation.kind === 'select') {
        return { data: { login_at: '2026-07-15T00:00:00.000Z' }, error: null };
      }
      return { data: null, error: null };
    });
    const { service, storage } = makeService(client);
    const firstEnvironment = createEnvironment();
    const nextEnvironment = createEnvironment();
    const firstRuntime = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user,
    }, service, firstEnvironment.environment)!;
    const nextRuntime = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user,
    }, service, nextEnvironment.environment)!;

    const abandonedStart = firstRuntime.start();
    await Promise.resolve();
    firstRuntime.stop('unmount');
    const validStart = nextRuntime.start();
    await Promise.resolve();
    expect(sessionInsertCount).toBe(1);

    resolveFirstInsert({ data: { id: SESSION_ID }, error: null });
    await Promise.all([abandonedStart, validStart]);

    expect(sessionInsertCount).toBe(2);
    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBe(NEW_SESSION_ID);
    expect(client.operations.filter(operation => (
      operation.table === 'user_session_events'
      && operation.kind === 'insert'
      && (operation.payload as { event_type?: string }).event_type === 'login'
    ))).toHaveLength(1);
    nextRuntime.stop('unmount');
  });
});

describe('endSession', () => {
  it('clears its stored key in finally when a permission or network error occurs', async () => {
    const networkError = { message: 'network unavailable' };
    const client = new FakeSupabaseClient((operation) => {
      if (operation.kind === 'select') {
        return { data: { login_at: '2026-07-15T00:00:00.000Z' }, error: null };
      }
      return { data: null, error: networkError };
    });
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);

    await expect(service.endSession(USER_ID)).rejects.toEqual(networkError);

    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBeNull();
  });

  it('launches no UPDATE or event when logout abandons a pending session SELECT', async () => {
    let resolveSelect!: (result: QueryResult) => void;
    const pendingSelect = new Promise<QueryResult>((resolve) => {
      resolveSelect = resolve;
    });
    const client = new FakeSupabaseClient((operation) => (
      operation.kind === 'select'
        ? pendingSelect
        : { data: null, error: null }
    ));
    const { service, storage } = makeService(client);
    storage.setItem(`vioo_user_session_id:${USER_ID}`, SESSION_ID);
    let operationAllowed = true;
    let ending!: Promise<void>;
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: () => undefined,
      end: () => {
        ending = service.endSession(USER_ID, 'logout', () => operationAllowed);
        return ending;
      },
      abandonEnd: () => {
        operationAllowed = false;
        service.clearStoredSessionId(USER_ID);
      },
    });
    const signOut = vi.fn(async () => undefined);

    await performLocalTelemetryLogout({
      lifecycle,
      userId: USER_ID,
      shouldEndServerSession: true,
      telemetryEndTimeoutMs: 0,
      signOut,
      clearAppOwnedStorage: vi.fn(),
    });
    resolveSelect({ data: { login_at: '2026-07-15T00:00:00.000Z' }, error: null });
    await ending;

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(client.operations).toHaveLength(1);
    expect(client.operations[0]).toMatchObject({ table: 'user_sessions', kind: 'select' });
    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBeNull();
  });

  it('does not persist a late start INSERT result or launch its login event after auth loss', async () => {
    let resolveInsert!: (result: QueryResult) => void;
    const pendingInsert = new Promise<QueryResult>((resolve) => {
      resolveInsert = resolve;
    });
    const client = new FakeSupabaseClient((operation) => (
      operation.table === 'user_sessions' && operation.kind === 'insert'
        ? pendingInsert
        : { data: null, error: null }
    ));
    const { service, storage } = makeService(client);
    let operationAllowed = true;

    const starting = service.startSession(user, () => operationAllowed);
    await Promise.resolve();
    operationAllowed = false;
    resolveInsert({ data: { id: SESSION_ID }, error: null });

    await expect(starting).resolves.toBeNull();
    expect(client.operations).toHaveLength(1);
    expect(client.operations[0]).toMatchObject({ table: 'user_sessions', kind: 'insert' });
    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBeNull();
  });
});

const createEnvironment = () => {
  let intervalHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;
  let focusHandler: (() => void) | null = null;
  const environment: UserSessionTelemetryEnvironment = {
    setInterval: (handler) => {
      intervalHandler = handler;
      return 1;
    },
    clearInterval: () => {
      intervalHandler = null;
    },
    addVisibilityListener: (handler) => {
      visibilityHandler = handler;
      return () => {
        visibilityHandler = null;
      };
    },
    addFocusListener: (handler) => {
      focusHandler = handler;
      return () => {
        focusHandler = null;
      };
    },
    isVisible: () => true,
  };
  return {
    environment,
    tick: () => intervalHandler?.(),
    focus: () => focusHandler?.(),
    visible: () => visibilityHandler?.(),
  };
};

describe('telemetry runtime identity and lifecycle', () => {
  it('does not touch the service when auth identity mismatches or contains a mock ID', async () => {
    const service: UserSessionTelemetryService = {
      ensureSession: vi.fn(async () => SESSION_ID),
      heartbeat: vi.fn(async () => undefined),
      endSession: vi.fn(async () => undefined),
      clearStoredSessionId: vi.fn(),
    };
    const { environment } = createEnvironment();

    const mismatch = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession({ user: { ...makeSession().user, id: NEW_SESSION_ID } }),
      user,
    }, service, environment);
    const mock = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user: { ...user, id: 'u1' },
    }, service, environment);

    expect(mismatch).toBeNull();
    expect(mock).toBeNull();
    expect(service.ensureSession).not.toHaveBeenCalled();
  });

  it('owns ensure, initial heartbeat, interval cadence, visibility/focus and explicit end', async () => {
    const service: UserSessionTelemetryService = {
      ensureSession: vi.fn(async () => SESSION_ID),
      heartbeat: vi.fn(async () => undefined),
      endSession: vi.fn(async () => undefined),
      clearStoredSessionId: vi.fn(),
    };
    const { environment, tick, focus, visible } = createEnvironment();
    const runtime = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user,
    }, service, environment);
    expect(runtime).not.toBeNull();

    await runtime!.start();
    expect(service.ensureSession).toHaveBeenCalledWith(user, expect.any(Function));
    expect(service.heartbeat).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      SESSION_ID,
      true,
      expect.any(Function),
    );

    for (let count = 0; count < 5; count += 1) tick();
    focus();
    visible();
    await Promise.resolve();
    expect(service.heartbeat).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      false,
      expect.any(Function),
    );
    expect(service.heartbeat).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      true,
      expect.any(Function),
    );

    runtime!.stop('local_logout');
    const ensureGuard = vi.mocked(service.ensureSession).mock.calls[0][1]!;
    const heartbeatGuard = vi.mocked(service.heartbeat).mock.calls[0][3]!;
    expect(ensureGuard()).toBe(true);
    expect(heartbeatGuard()).toBe(false);
    await runtime!.end();
    expect(service.endSession).toHaveBeenCalledWith(
      USER_ID,
      'logout',
      expect.any(Function),
    );
  });

  it('stops and clears without ending the server row on remote signout', () => {
    const events: string[] = [];
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: reason => events.push(`stop:${reason}`),
      end: async () => {
        events.push('end');
      },
      abandonEnd: () => events.push('abandon'),
    });

    lifecycle.handleRemoteAuthLoss(() => events.push('clear'));

    expect(events).toEqual(['stop:remote_auth_loss', 'clear']);
  });

  it('lets remote auth loss override local logout while React unmount preserves it', async () => {
    const service: UserSessionTelemetryService = {
      ensureSession: vi.fn(async () => SESSION_ID),
      heartbeat: vi.fn(async () => undefined),
      endSession: vi.fn(async () => undefined),
      clearStoredSessionId: vi.fn(),
    };
    const { environment } = createEnvironment();
    const runtime = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user,
    }, service, environment)!;
    await runtime.start();
    const operationGuard = vi.mocked(service.ensureSession).mock.calls[0][1]!;

    runtime.stop('local_logout');
    runtime.stop('unmount');
    expect(operationGuard()).toBe(true);

    runtime.stop('remote_auth_loss');
    expect(operationGuard()).toBe(false);
    await runtime.end();

    expect(service.endSession).not.toHaveBeenCalled();
    expect(service.clearStoredSessionId).toHaveBeenCalledWith(USER_ID);
  });

  it('orders local logout as stop, best-effort end, auth signout, then app-key cleanup', async () => {
    const events: string[] = [];
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: reason => events.push(`stop:${reason}`),
      end: async () => {
        events.push('end');
        throw new Error('telemetry close failed');
      },
      abandonEnd: () => events.push('abandon'),
    });

    await performLocalTelemetryLogout({
      lifecycle,
      userId: USER_ID,
      shouldEndServerSession: true,
      signOut: async () => {
        events.push('signOut');
      },
      clearAppOwnedStorage: () => events.push('clear'),
    });

    expect(events).toEqual([
      'stop:local_logout',
      'end',
      'signOut',
      'clear',
    ]);
  });

  it('bounds a stuck telemetry close and still signs out and clears app-owned keys', async () => {
    const events: string[] = [];
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: reason => events.push(`stop:${reason}`),
      end: () => new Promise<void>(() => undefined),
      abandonEnd: () => events.push('abandon'),
    });

    await performLocalTelemetryLogout({
      lifecycle,
      userId: USER_ID,
      shouldEndServerSession: true,
      telemetryEndTimeoutMs: 0,
      signOut: async () => {
        events.push('signOut');
      },
      clearAppOwnedStorage: () => events.push('clear'),
    });

    expect(events).toEqual(['stop:local_logout', 'abandon', 'signOut', 'clear']);
  });

  it('releases and idempotently abandons a pending local end after timeout', async () => {
    let resolveEnd!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });
    const abandonEnd = vi.fn();
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: vi.fn(),
      end: () => completion,
      abandonEnd,
    });

    const pendingEnd = lifecycle.stopAndEnd(USER_ID);
    pendingEnd.abandon();
    pendingEnd.abandon();
    lifecycle.handleRemoteAuthLoss(vi.fn());

    expect(abandonEnd).toHaveBeenCalledTimes(1);
    resolveEnd();
    await pendingEnd.completion;
  });

  it('abandons an old pending local end before registering a replacement runtime', async () => {
    let resolveEnd!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });
    const abandonEnd = vi.fn();
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: vi.fn(),
      end: () => completion,
      abandonEnd,
    });
    const pendingEnd = lifecycle.stopAndEnd(USER_ID);

    lifecycle.register({
      userId: USER_ID,
      stop: vi.fn(),
      end: async () => undefined,
      abandonEnd: vi.fn(),
    });
    resolveEnd();
    await pendingEnd.completion;

    expect(abandonEnd).toHaveBeenCalledTimes(1);
  });

  it('reuses the same pending local end for a repeated logout of the same user', async () => {
    let resolveEnd!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });
    const end = vi.fn(() => completion);
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: vi.fn(),
      end,
      abandonEnd: vi.fn(),
    });

    const firstPendingEnd = lifecycle.stopAndEnd(USER_ID);
    const repeatedPendingEnd = lifecycle.stopAndEnd(USER_ID);

    expect(repeatedPendingEnd).toBe(firstPendingEnd);
    expect(end).toHaveBeenCalledTimes(1);
    resolveEnd();
    await firstPendingEnd.completion;
  });

  it('abandons a pending local end when remote auth loss wins before it settles', async () => {
    let resolveInsert!: (result: QueryResult) => void;
    const pendingInsert = new Promise<QueryResult>((resolve) => {
      resolveInsert = resolve;
    });
    const client = new FakeSupabaseClient((operation) => {
      if (operation.table === 'user_sessions' && operation.kind === 'insert') {
        return pendingInsert;
      }
      if (operation.table === 'user_sessions' && operation.kind === 'select') {
        return { data: { login_at: '2026-07-15T00:00:00.000Z' }, error: null };
      }
      return { data: null, error: null };
    });
    const { service, storage } = makeService(client);
    const setItem = vi.spyOn(storage, 'setItem');
    const { environment } = createEnvironment();
    const runtime = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user,
    }, service, environment)!;
    const starting = runtime.start();
    await Promise.resolve();

    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: reason => runtime.stop(reason),
      end: () => runtime.end(),
      abandonEnd: () => runtime.abandonEnd(),
    });
    const signOut = vi.fn(async () => undefined);
    const logout = performLocalTelemetryLogout({
      lifecycle,
      userId: USER_ID,
      shouldEndServerSession: true,
      telemetryEndTimeoutMs: 1_000,
      signOut,
      clearAppOwnedStorage: () => service.clearAllStoredSessionIds(),
    });

    lifecycle.handleRemoteAuthLoss(() => service.clearAllStoredSessionIds());
    resolveInsert({ data: { id: SESSION_ID }, error: null });
    await Promise.all([starting, logout]);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(client.operations).toEqual([
      expect.objectContaining({ table: 'user_sessions', kind: 'insert' }),
    ]);
    expect(setItem).not.toHaveBeenCalledWith(
      `vioo_user_session_id:${USER_ID}`,
      SESSION_ID,
    );
    expect(storage.getItem(`vioo_user_session_id:${USER_ID}`)).toBeNull();
  });

  it('abandons a late ensure result after logout timeout without a post-signout DB end call', async () => {
    let resolveEnsure!: (sessionId: string) => void;
    const ensurePending = new Promise<string>((resolve) => {
      resolveEnsure = resolve;
    });
    const service: UserSessionTelemetryService = {
      ensureSession: vi.fn(() => ensurePending),
      heartbeat: vi.fn(async () => undefined),
      endSession: vi.fn(async () => undefined),
      clearStoredSessionId: vi.fn(),
    };
    const { environment } = createEnvironment();
    const runtime = createUserSessionTelemetryRuntime({
      status: 'authenticated',
      session: makeSession(),
      user,
    }, service, environment)!;
    const start = runtime.start();
    const lifecycle = new UserSessionTelemetryLifecycle();
    lifecycle.register({
      userId: USER_ID,
      stop: reason => runtime.stop(reason),
      end: () => runtime.end(),
      abandonEnd: () => runtime.abandonEnd(),
    });

    const signOut = vi.fn(async () => undefined);
    await performLocalTelemetryLogout({
      lifecycle,
      userId: USER_ID,
      shouldEndServerSession: true,
      telemetryEndTimeoutMs: 0,
      signOut,
      clearAppOwnedStorage: vi.fn(),
    });
    expect(signOut).toHaveBeenCalledTimes(1);

    resolveEnsure(SESSION_ID);
    await start;
    await Promise.resolve();

    expect(service.endSession).not.toHaveBeenCalled();
    expect(service.heartbeat).not.toHaveBeenCalled();
    expect(service.clearStoredSessionId).toHaveBeenCalledWith(USER_ID);
  });

  it('allows server close only for an unexpired exact authenticated UUID identity', () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const validSession = makeSession({ expires_at: Math.floor(now / 1000) + 60 });

    expect(shouldEndTelemetrySessionOnServer('authenticated', user, validSession, now)).toBe(true);
    expect(shouldEndTelemetrySessionOnServer('authenticated', { ...user, authId: NEW_SESSION_ID }, validSession, now)).toBe(false);
    expect(shouldEndTelemetrySessionOnServer('authenticated', user, { ...validSession, expires_at: Math.floor(now / 1000) - 1 }, now)).toBe(false);
    expect(shouldEndTelemetrySessionOnServer('anonymous', user, validSession, now)).toBe(false);
  });
});

describe('telemetry architecture guard', () => {
  it('keeps telemetry out of AppContext and inside the authenticated application boundary', () => {
    const appContextSource = readFileSync(join(process.cwd(), 'context', 'AppContext.tsx'), 'utf8');
    const appSource = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
    const authSource = readFileSync(join(process.cwd(), 'context', 'AuthContext.tsx'), 'utf8');
    const protectedStart = appSource.indexOf('export const AuthenticatedApplication');
    const protectedEnd = appSource.indexOf('const ApplicationRouter', protectedStart);
    const protectedSource = appSource.slice(protectedStart, protectedEnd);

    expect(appContextSource).not.toMatch(/userActivityService|telemetry heartbeat|\.heartbeat\(/);
    expect(protectedSource).toContain('<UserSessionTelemetryHost />');
    expect(protectedSource.indexOf('<UserSessionTelemetryHost />')).toBeGreaterThan(
      protectedSource.indexOf('<AuthenticatedBoundary>'),
    );
    expect(authSource).toContain('performLocalTelemetryLogout');
    expect(authSource).toContain('handleRemoteAuthLoss');
    expect(authSource).not.toMatch(/localStorage\.clear\(|removeItem\([^)]*sb-/);
  });
});
