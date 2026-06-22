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

const hasWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const getSessionKey = (userId: string) => `${SESSION_KEY_PREFIX}${userId}`;

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
    isActive: row.web_push_subscriptions.is_active,
    lastUsedAt: row.web_push_subscriptions.last_used_at,
    endpoint: row.web_push_subscriptions.endpoint,
  } : null,
});

export const userActivityService = {
  getStoredSessionId(userId: string): string | null {
    if (!hasWindow()) return null;
    return localStorage.getItem(getSessionKey(userId));
  },

  async startSession(user: User): Promise<string | null> {
    if (!user?.id) return null;
    const device = getDeviceMetadata();
    const { data, error } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        auth_id: user.authId || null,
        user_agent: device.userAgent,
        device_type: device.deviceType,
        platform: device.platform,
        metadata: { url: device.url },
      })
      .select('id')
      .single();
    if (error) throw error;

    const sessionId = data?.id || null;
    if (sessionId && hasWindow()) localStorage.setItem(getSessionKey(user.id), sessionId);

    if (sessionId) {
      await this.recordEvent(sessionId, user.id, 'login', { platform: device.platform, deviceType: device.deviceType });
    }
    return sessionId;
  },

  async heartbeat(userId: string, sessionId?: string | null, recordEvent = false): Promise<void> {
    const activeSessionId = sessionId || this.getStoredSessionId(userId);
    if (!userId || !activeSessionId) return;

    const now = nowIso();
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('login_at')
      .eq('id', activeSessionId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session?.login_at) return;

    const { error } = await supabase
      .from('user_sessions')
      .update({
        last_seen_at: now,
        duration_seconds: Math.max(0, Math.floor((Date.now() - new Date(session.login_at).getTime()) / 1000)),
        updated_at: now,
      })
      .eq('id', activeSessionId)
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;

    if (recordEvent) {
      await this.recordEvent(activeSessionId, userId, 'heartbeat', { at: now });
    }
  },

  async endSession(userId: string, eventType: 'logout' | 'timeout' = 'logout'): Promise<void> {
    const sessionId = this.getStoredSessionId(userId);
    if (!userId || !sessionId) return;
    const endedAt = nowIso();

    const { data: session } = await supabase
      .from('user_sessions')
      .select('login_at')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    const durationSeconds = session?.login_at
      ? Math.max(0, Math.floor((Date.now() - new Date(session.login_at).getTime()) / 1000))
      : 0;

    const { error } = await supabase
      .from('user_sessions')
      .update({
        logout_at: endedAt,
        last_seen_at: endedAt,
        duration_seconds: durationSeconds,
        status: eventType,
        updated_at: endedAt,
      })
      .eq('id', sessionId)
      .eq('user_id', userId);
    if (error) throw error;

    await this.recordEvent(sessionId, userId, eventType, { at: endedAt });
    if (hasWindow()) localStorage.removeItem(getSessionKey(userId));
  },

  async recordEvent(sessionId: string | null, userId: string, eventType: UserSessionEventType, metadata: Record<string, any> = {}) {
    const { error } = await supabase.from('user_session_events').insert({
      session_id: sessionId,
      user_id: userId,
      event_type: eventType,
      metadata,
    });
    if (error) throw error;
  },

  async timeoutStaleSessions(timeoutMinutes = 5): Promise<number> {
    const { data, error } = await supabase.rpc('timeout_stale_user_sessions', { p_timeout_minutes: timeoutMinutes });
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
    let query = supabase
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
    let query = supabase
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
    let query = supabase
      .from('notification_deliveries')
      .select('*, users:user_id(id,name,email,avatar,role), notifications:notification_id(id,title,message,priority,created_at), web_push_subscriptions:subscription_id(id,platform,device_type,is_active,last_used_at,endpoint)')
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
    const { data, error } = await supabase.functions.invoke('send-web-push', {
      body: { notificationId, subscriptionId: subscriptionId || undefined },
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
