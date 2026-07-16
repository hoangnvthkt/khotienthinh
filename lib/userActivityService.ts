import { supabase } from './supabase';
import { webPushService } from './webPushService';
import type { User } from '../types';

export type UserSessionStatus = 'active' | 'logout' | 'timeout';
export type UserSessionEventType = 'login' | 'logout' | 'heartbeat' | 'timeout';

export interface UserSession {
  id: string;
  userId: string;
  authId?: string | null;
  loginAt: string;
  logoutAt?: string | null;
  lastSeenAt: string;
  durationSeconds: number;
  status: UserSessionStatus;
  userAgent?: string | null;
  deviceType?: string | null;
  platform?: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string;
    email?: string | null;
    avatar?: string | null;
    role?: string | null;
  } | null;
}

export interface UserSessionEvent {
  id: string;
  sessionId?: string | null;
  userId: string;
  eventType: UserSessionEventType;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface PushSubscriptionAdminRow {
  id: string;
  userId: string;
  endpoint: string;
  userAgent?: string | null;
  platform?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  isStandalonePWA?: boolean | null;
  manifestId?: string | null;
  vapidPublicKeyHash?: string | null;
  notificationPermission?: string | null;
  isActive?: boolean | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string | null;
  lastUsedAt?: string | null;
  user?: UserSession['user'];
}

export interface NotificationDelivery {
  id: string;
  notificationId?: string | null;
  subscriptionId?: string | null;
  userId?: string | null;
  channel: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  provider?: string | null;
  errorMessage?: string | null;
  providerStatusCode?: number | null;
  sentAt?: string | null;
  createdAt: string;
  user?: UserSession['user'];
  notification?: {
    id: string;
    title?: string | null;
    message?: string | null;
    priority?: string | null;
    createdAt?: string | null;
  } | null;
  subscription?: {
    id: string;
    platform?: string | null;
    deviceType?: string | null;
    browser?: string | null;
    isStandalonePWA?: boolean | null;
    isActive?: boolean | null;
    lastUsedAt?: string | null;
    endpoint?: string | null;
  } | null;
}

export interface UserActivitySummary {
  onlineUsers: number;
  activeSessions: number;
  todayLogins: number;
  todayLogouts: number;
  totalOnlineSecondsToday: number;
  pushActiveDevices: number;
  pushFailedToday: number;
  pushSentToday: number;
}

const SESSION_KEY_PREFIX = 'vioo_user_session_id:';
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_EVENT_TYPES = new Set<UserSessionEventType>(['login', 'logout', 'heartbeat', 'timeout']);

const hasWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const getSessionKey = (userId: string) => `${SESSION_KEY_PREFIX}${userId}`;

const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

const nowIso = () => new Date().toISOString();

const todayStartIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const getDeviceMetadata = () => ({
  userAgent: hasWindow() ? navigator.userAgent : null,
  deviceType: webPushService.getDeviceType(),
  platform: webPushService.getPlatform(),
  url: hasWindow() ? `${window.location.pathname}${window.location.hash}` : null,
});

const mapUser = (row: any): UserSession['user'] => row ? ({
  id: row.id,
  name: row.name,
  email: row.email,
  avatar: row.avatar,
  role: row.role,
}) : null;

const mapSession = (row: any): UserSession => ({
  id: row.id,
  userId: row.user_id,
  authId: row.auth_id,
  loginAt: row.login_at,
  logoutAt: row.logout_at,
  lastSeenAt: row.last_seen_at,
  durationSeconds: row.duration_seconds || 0,
  status: row.status,
  userAgent: row.user_agent,
  deviceType: row.device_type,
  platform: row.platform,
  metadata: row.metadata || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  user: mapUser(row.users),
});

const mapSubscription = (row: any): PushSubscriptionAdminRow => ({
  id: row.id,
  userId: row.user_id,
  endpoint: row.endpoint,
  userAgent: row.user_agent,
  platform: row.platform,
  deviceType: row.device_type,
  browser: row.browser,
  isStandalonePWA: row.is_standalone_pwa,
  manifestId: row.manifest_id,
  vapidPublicKeyHash: row.vapid_public_key_hash,
  notificationPermission: row.notification_permission,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastSeenAt: row.last_seen_at,
  lastUsedAt: row.last_used_at,
  user: mapUser(row.users),
});

const mapDelivery = (row: any): NotificationDelivery => ({
  id: row.id,
  notificationId: row.notification_id,
  subscriptionId: row.subscription_id,
  userId: row.user_id,
  channel: row.channel,
  status: row.status,
  provider: row.provider,
  errorMessage: row.error_message,
  providerStatusCode: row.provider_status_code,
  sentAt: row.sent_at,
  createdAt: row.created_at,
  user: mapUser(row.users),
  notification: row.notifications ? {
    id: row.notifications.id,
    title: row.notifications.title,
    message: row.notifications.message,
    priority: row.notifications.priority,
    createdAt: row.notifications.created_at,
  } : null,
  subscription: row.web_push_subscriptions ? {
    id: row.web_push_subscriptions.id,
    platform: row.web_push_subscriptions.platform,
    deviceType: row.web_push_subscriptions.device_type,
    browser: row.web_push_subscriptions.browser,
    isStandalonePWA: row.web_push_subscriptions.is_standalone_pwa,
    isActive: row.web_push_subscriptions.is_active,
    lastUsedAt: row.web_push_subscriptions.last_used_at,
    endpoint: row.web_push_subscriptions.endpoint,
  } : null,
});

interface DeviceMetadata {
  userAgent: string | null;
  deviceType: string | null;
  platform: string | null;
  url: string | null;
}

export interface UserActivityServiceDependencies {
  supabaseClient?: any;
  getStorage?: () => Storage | null;
  getDeviceMetadata?: () => DeviceMetadata;
}

export type UserActivityOperationGuard = () => boolean;

export interface UserActivityService {
  getStoredSessionId(userId: string): string | null;
  clearStoredSessionId(userId: string): void;
  clearAllStoredSessionIds(): void;
  startSession(user: User, operationGuard?: UserActivityOperationGuard): Promise<string | null>;
  ensureSession(user: User, operationGuard?: UserActivityOperationGuard): Promise<string | null>;
  heartbeat(
    userId: string,
    sessionId?: string | null,
    recordEvent?: boolean,
    operationGuard?: UserActivityOperationGuard,
  ): Promise<void>;
  endSession(
    userId: string,
    eventType?: 'logout' | 'timeout',
    operationGuard?: UserActivityOperationGuard,
  ): Promise<void>;
  recordEvent(
    sessionId: string | null,
    userId: string,
    eventType: UserSessionEventType,
    metadata?: Record<string, any>,
    operationGuard?: UserActivityOperationGuard,
  ): Promise<void>;
  timeoutStaleSessions(timeoutMinutes?: number): Promise<number>;
  listSessions(options?: {
    status?: UserSessionStatus | 'all';
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<UserSession[]>;
  listPushSubscriptions(options?: { activeOnly?: boolean; limit?: number }): Promise<PushSubscriptionAdminRow[]>;
  listDeliveries(options?: {
    status?: NotificationDelivery['status'] | 'all';
    channel?: string;
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<NotificationDelivery[]>;
  retryWebPush(notificationId: string, subscriptionId?: string | null): Promise<any>;
  sendTestPushToSubscription(subscriptionId: string): Promise<any>;
  buildSummary(
    sessions: UserSession[],
    subscriptions: PushSubscriptionAdminRow[],
    deliveries: NotificationDelivery[],
  ): UserActivitySummary;
}

type StoredSessionRead =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; sessionId: string };

interface InFlightSessionStart {
  completion: Promise<string | null>;
  operationGuard?: UserActivityOperationGuard;
}

const getDefaultStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const createUserActivityService = (
  dependencies: UserActivityServiceDependencies = {},
): UserActivityService => {
  const client = dependencies.supabaseClient ?? supabase;
  const resolveStorage = dependencies.getStorage ?? getDefaultStorage;
  const resolveDeviceMetadata = dependencies.getDeviceMetadata ?? getDeviceMetadata;
  const inFlightStarts = new Map<string, InFlightSessionStart>();

  const storage = (): Storage | null => {
    try {
      return resolveStorage();
    } catch {
      return null;
    }
  };

  const removeSessionKey = (userId: string) => {
    try {
      storage()?.removeItem(getSessionKey(userId));
    } catch {
      // Telemetry storage is best effort and must never block auth cleanup.
    }
  };

  const readStoredSession = (userId: string): StoredSessionRead => {
    if (!isUuid(userId)) return { kind: 'invalid' };
    let storedSessionId: string | null = null;
    try {
      storedSessionId = storage()?.getItem(getSessionKey(userId)) ?? null;
    } catch {
      return { kind: 'missing' };
    }
    if (!storedSessionId) return { kind: 'missing' };
    if (!isUuid(storedSessionId)) {
      removeSessionKey(userId);
      return { kind: 'invalid' };
    }
    return { kind: 'valid', sessionId: storedSessionId };
  };

  const requireOptionalUuid = (value: string | null | undefined, label: string) => {
    if (value != null && !isUuid(value)) {
      throw new TypeError(`${label} must be a valid UUID`);
    }
  };

  const isOperationAllowed = (operationGuard?: UserActivityOperationGuard): boolean => {
    if (!operationGuard) return true;
    try {
      return operationGuard();
    } catch {
      return false;
    }
  };

  const service: UserActivityService = {
  getStoredSessionId(userId: string): string | null {
    const stored = readStoredSession(userId);
    return stored.kind === 'valid' ? stored.sessionId : null;
  },

  clearStoredSessionId(userId: string): void {
    if (!isUuid(userId)) return;
    removeSessionKey(userId);
  },

  clearAllStoredSessionIds(): void {
    const target = storage();
    if (!target) return;
    const ownedKeys: string[] = [];
    try {
      for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (key?.startsWith(SESSION_KEY_PREFIX)) ownedKeys.push(key);
      }
      for (const key of ownedKeys) target.removeItem(key);
    } catch {
      // Never broaden cleanup to localStorage.clear() or Supabase-owned sb-* keys.
    }
  },

  async startSession(
    user: User,
    operationGuard?: UserActivityOperationGuard,
  ): Promise<string | null> {
    if (
      !isUuid(user?.id)
      || !isUuid(user?.authId)
      || !isOperationAllowed(operationGuard)
    ) return null;
    const device = resolveDeviceMetadata();
    const { data, error } = await client
      .from('user_sessions')
      .insert({
        user_id: user.id,
        auth_id: user.authId,
        user_agent: device.userAgent,
        device_type: device.deviceType,
        platform: device.platform,
        metadata: { url: device.url },
      })
      .select('id')
      .single();
    if (!isOperationAllowed(operationGuard)) return null;
    if (error) throw error;

    const sessionId = isUuid(data?.id) ? data.id : null;
    if (!sessionId || !isOperationAllowed(operationGuard)) return null;
    try {
      storage()?.setItem(getSessionKey(user.id), sessionId);
    } catch {
      // The server session remains valid even if local persistence is unavailable.
    }
    if (!isOperationAllowed(operationGuard)) {
      service.clearStoredSessionId(user.id);
      return null;
    }

    await service.recordEvent(sessionId, user.id, 'login', {
      platform: device.platform,
      deviceType: device.deviceType,
    }, operationGuard);
    if (!isOperationAllowed(operationGuard)) {
      service.clearStoredSessionId(user.id);
      return null;
    }
    return sessionId;
  },

  async ensureSession(
    user: User,
    operationGuard?: UserActivityOperationGuard,
  ): Promise<string | null> {
    if (
      !isUuid(user?.id)
      || !isUuid(user?.authId)
      || !isOperationAllowed(operationGuard)
    ) return null;
    const inFlightKey = `${user.id}:${user.authId}`;
    const ensureGeneration = async (retryAfterSharedNull: boolean): Promise<string | null> => {
      const existing = inFlightStarts.get(inFlightKey);
      if (existing) {
        const sessionId = await existing.completion;
        if (!isOperationAllowed(operationGuard)) return null;
        const existingGenerationWasAbandoned = !isOperationAllowed(existing.operationGuard);
        if (
          sessionId
          || !retryAfterSharedNull
          || !existingGenerationWasAbandoned
        ) return sessionId;

        // A remounted runtime can join a generation whose own guard was already
        // cancelled. Once that tracked generation settles and removes itself,
        // give the current valid guard exactly one chance to create/resume.
        return ensureGeneration(false);
      }

      const operation = (async () => {
        if (!isOperationAllowed(operationGuard)) return null;
        const stored = readStoredSession(user.id);
        if (stored.kind === 'invalid') return null;
        if (stored.kind === 'missing') return service.startSession(user, operationGuard);

        const { data, error } = await client
          .from('user_sessions')
          .select('id')
          .eq('id', stored.sessionId)
          .eq('user_id', user.id)
          .eq('auth_id', user.authId)
          .eq('status', 'active')
          .maybeSingle();
        if (!isOperationAllowed(operationGuard)) return null;

        // An error is an unknown server state. Preserve the key and never insert a
        // replacement, otherwise a transient 42501/network error can duplicate rows.
        if (error) throw error;
        if (data?.id === stored.sessionId) return stored.sessionId;

        // A successful empty result definitively proves the stored UUID is stale.
        if (!isOperationAllowed(operationGuard)) return null;
        service.clearStoredSessionId(user.id);
        return service.startSession(user, operationGuard);
      })();

      let trackedEntry!: InFlightSessionStart;
      const tracked = operation.finally(() => {
        if (inFlightStarts.get(inFlightKey) === trackedEntry) inFlightStarts.delete(inFlightKey);
      });
      trackedEntry = { completion: tracked, operationGuard };
      inFlightStarts.set(inFlightKey, trackedEntry);
      return tracked;
    };

    return ensureGeneration(true);
  },

  async heartbeat(
    userId: string,
    sessionId?: string | null,
    recordEvent = false,
    operationGuard?: UserActivityOperationGuard,
  ): Promise<void> {
    if (!isUuid(userId) || !isOperationAllowed(operationGuard)) return;
    if (sessionId != null && !isUuid(sessionId)) return;
    const activeSessionId = sessionId ?? service.getStoredSessionId(userId);
    if (!isUuid(activeSessionId)) return;

    const now = nowIso();
    const { data: session, error: sessionError } = await client
      .from('user_sessions')
      .select('login_at')
      .eq('id', activeSessionId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!isOperationAllowed(operationGuard)) return;
    if (sessionError) throw sessionError;
    if (!session?.login_at) return;

    const { error } = await client
      .from('user_sessions')
      .update({
        last_seen_at: now,
        duration_seconds: Math.max(0, Math.floor((Date.now() - new Date(session.login_at).getTime()) / 1000)),
        updated_at: now,
      })
      .eq('id', activeSessionId)
      .eq('user_id', userId)
      .eq('status', 'active');
    if (!isOperationAllowed(operationGuard)) return;
    if (error) throw error;

    if (recordEvent) {
      await service.recordEvent(
        activeSessionId,
        userId,
        'heartbeat',
        { at: now },
        operationGuard,
      );
    }
  },

  async endSession(
    userId: string,
    eventType: 'logout' | 'timeout' = 'logout',
    operationGuard?: UserActivityOperationGuard,
  ): Promise<void> {
    if (
      !isUuid(userId)
      || (eventType !== 'logout' && eventType !== 'timeout')
    ) return;
    if (!isOperationAllowed(operationGuard)) {
      service.clearStoredSessionId(userId);
      return;
    }
    const stored = readStoredSession(userId);
    if (stored.kind !== 'valid') return;
    const sessionId = stored.sessionId;

    try {
      const endedAt = nowIso();
      const { data: session, error: sessionError } = await client
        .from('user_sessions')
        .select('login_at')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      if (!isOperationAllowed(operationGuard)) return;
      if (sessionError) throw sessionError;
      if (!session?.login_at) return;

      const durationSeconds = Math.max(
        0,
        Math.floor((Date.now() - new Date(session.login_at).getTime()) / 1000),
      );
      const { error } = await client
        .from('user_sessions')
        .update({
          logout_at: endedAt,
          last_seen_at: endedAt,
          duration_seconds: durationSeconds,
          status: eventType,
          updated_at: endedAt,
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('status', 'active');
      if (!isOperationAllowed(operationGuard)) return;
      if (error) throw error;

      await service.recordEvent(
        sessionId,
        userId,
        eventType,
        { at: endedAt },
        operationGuard,
      );
    } finally {
      service.clearStoredSessionId(userId);
    }
  },

  async recordEvent(
    sessionId: string | null,
    userId: string,
    eventType: UserSessionEventType,
    metadata: Record<string, any> = {},
    operationGuard?: UserActivityOperationGuard,
  ): Promise<void> {
    if (
      !isUuid(sessionId)
      || !isUuid(userId)
      || !SESSION_EVENT_TYPES.has(eventType)
      || !isOperationAllowed(operationGuard)
    ) return;
    const { error } = await client.from('user_session_events').insert({
      session_id: sessionId,
      user_id: userId,
      event_type: eventType,
      metadata,
    });
    if (!isOperationAllowed(operationGuard)) return;
    if (error) throw error;
  },

  async timeoutStaleSessions(timeoutMinutes = 5): Promise<number> {
    const { data, error } = await client.rpc('timeout_stale_user_sessions', { p_timeout_minutes: timeoutMinutes });
    if (error) throw error;
    return Number(data || 0);
  },

  async listSessions(options: {
    status?: UserSessionStatus | 'all';
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {}): Promise<UserSession[]> {
    requireOptionalUuid(options.userId, 'userId');
    let query = client
      .from('user_sessions')
      .select('*, users:user_id(id,name,email,avatar,role)')
      .order('last_seen_at', { ascending: false })
      .limit(options.limit || 200);

    if (options.status && options.status !== 'all') query = query.eq('status', options.status);
    if (options.userId) query = query.eq('user_id', options.userId);
    if (options.from) query = query.gte('login_at', options.from);
    if (options.to) query = query.lte('login_at', options.to);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapSession);
  },

  async listPushSubscriptions(options: { activeOnly?: boolean; limit?: number } = {}): Promise<PushSubscriptionAdminRow[]> {
    let query = client
      .from('web_push_subscriptions')
      .select('*, users:user_id(id,name,email,avatar,role)')
      .order('updated_at', { ascending: false })
      .limit(options.limit || 200);
    if (options.activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapSubscription);
  },

  async listDeliveries(options: {
    status?: NotificationDelivery['status'] | 'all';
    channel?: string;
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {}): Promise<NotificationDelivery[]> {
    requireOptionalUuid(options.userId, 'userId');
    let query = client
      .from('notification_deliveries')
      .select('*, users:user_id(id,name,email,avatar,role), notifications:notification_id(id,title,message,priority,created_at), web_push_subscriptions:subscription_id(id,platform,device_type,browser,is_standalone_pwa,is_active,last_used_at,endpoint)')
      .order('created_at', { ascending: false })
      .limit(options.limit || 200);

    if (options.status && options.status !== 'all') query = query.eq('status', options.status);
    if (options.channel) query = query.eq('channel', options.channel);
    if (options.userId) query = query.eq('user_id', options.userId);
    if (options.from) query = query.gte('created_at', options.from);
    if (options.to) query = query.lte('created_at', options.to);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapDelivery);
  },

  async retryWebPush(notificationId: string, subscriptionId?: string | null) {
    requireOptionalUuid(notificationId, 'notificationId');
    requireOptionalUuid(subscriptionId, 'subscriptionId');
    const { data, error } = await client.functions.invoke('send-web-push', {
      body: { notificationId, subscriptionId: subscriptionId || undefined },
    });
    if (error) throw error;
    return data;
  },

  async sendTestPushToSubscription(subscriptionId: string) {
    requireOptionalUuid(subscriptionId, 'subscriptionId');
    const { data, error } = await client.functions.invoke('send-web-push', {
      body: { subscriptionId, test: true },
    });
    if (error) throw error;
    return data;
  },

  buildSummary(sessions: UserSession[], subscriptions: PushSubscriptionAdminRow[], deliveries: NotificationDelivery[]): UserActivitySummary {
    const start = todayStartIso();
    const onlineSince = Date.now() - ONLINE_WINDOW_MS;
    return {
      onlineUsers: new Set(
        sessions
          .filter(session => session.status === 'active' && new Date(session.lastSeenAt).getTime() >= onlineSince)
          .map(session => session.userId)
      ).size,
      activeSessions: sessions.filter(session => session.status === 'active').length,
      todayLogins: sessions.filter(session => session.loginAt >= start).length,
      todayLogouts: sessions.filter(session => session.logoutAt && session.logoutAt >= start).length,
      totalOnlineSecondsToday: sessions
        .filter(session => session.loginAt >= start)
        .reduce((sum, session) => sum + session.durationSeconds, 0),
      pushActiveDevices: subscriptions.filter(sub => sub.isActive).length,
      pushFailedToday: deliveries.filter(delivery => delivery.status === 'failed' && delivery.createdAt >= start).length,
      pushSentToday: deliveries.filter(delivery => delivery.status === 'sent' && delivery.createdAt >= start).length,
    };
  },
  };

  return service;
};

export const userActivityService = createUserActivityService();
