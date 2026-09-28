import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { clampPageSize, takeCursorPage, type CursorPage } from './supabasePagination';
import {
  type NotificationDeliveryReason,
  type NotificationInboxTab,
} from './notificationReasons';

export interface AppNotification {
  id: string;
  userId?: string;
  type: 'info' | 'warning' | 'success' | 'error';
  category: string;
  title: string;
  message: string;
  icon?: string;
  link?: string;
  isRead: boolean;
  isDismissed: boolean;
  severity: 'info' | 'warning' | 'critical';
  sourceType?: string;
  sourceId?: string;
  constructionSiteId?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  pushEnabled?: boolean;
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  metadata: Record<string, any>;
  /** Why this person received it; set by the server. */
  deliveryReason?: NotificationDeliveryReason;
  /** instant, or held for the person's end-of-day digest, or muted by them. */
  deliveryMode?: 'instant' | 'digest' | 'muted';
  createdAt: string;
  expiresAt?: string;
}

export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export type NotificationListPage = CursorPage<AppNotification, NotificationCursor>;

export interface NotificationPreferences {
  watchingMode: 'instant' | 'digest' | 'muted';
  /** Business-area notices cannot be muted (owner decision 28/09/2026). */
  responsibleMode: 'instant' | 'digest';
  /** HH:MM, Vietnam time. */
  digestTime: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  watchingMode: 'instant',
  responsibleMode: 'instant',
  digestTime: '17:30',
};

const UNREAD_DISPLAY_LIMIT = 99;
const UNREAD_QUERY_LIMIT = UNREAD_DISPLAY_LIMIT + 1;
const NOTIFICATION_LIST_SELECT = 'id,user_id,type,category,title,message,icon,link,is_read,is_dismissed,severity,source_type,source_id,construction_site_id,priority,push_enabled,action_url,entity_type,entity_id,metadata,created_at,expires_at,delivery_reason,delivery_mode';

const toCamel = (row: any): AppNotification => ({
  id: row.id,
  userId: row.user_id,
  type: row.type,
  category: row.category,
  title: row.title,
  message: row.message,
  icon: row.icon,
  link: row.link,
  isRead: row.is_read,
  isDismissed: row.is_dismissed,
  severity: row.severity,
  sourceType: row.source_type,
  sourceId: row.source_id,
  constructionSiteId: row.construction_site_id,
  priority: row.priority,
  pushEnabled: row.push_enabled,
  actionUrl: row.action_url,
  entityType: row.entity_type,
  entityId: row.entity_id,
  metadata: row.metadata || {},
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  deliveryReason: row.delivery_reason || (row.user_id ? undefined : 'system'),
  deliveryMode: row.delivery_mode || 'instant',
});

type NotificationRealtimeListener = (notification: AppNotification) => void;

type NotificationRealtimeSubscription = {
  userId?: string;
  channel: RealtimeChannel | null;
  listeners: Set<NotificationRealtimeListener>;
  releaseTimer?: ReturnType<typeof setTimeout>;
  isRemoving: boolean;
};

const notificationRealtimeSubscriptions = new Map<string, NotificationRealtimeSubscription>();

const notificationRealtimeKey = (userId?: string) => userId || 'global';

const openNotificationRealtimeChannel = (
  key: string,
  subscription: NotificationRealtimeSubscription,
) => {
  const channel = supabase.channel(`notifications:${key}`);
  const options = subscription.userId
    ? { event: 'INSERT' as const, schema: 'public', table: 'notifications', filter: `user_id=eq.${subscription.userId}` }
    : { event: 'INSERT' as const, schema: 'public', table: 'notifications' };

  subscription.channel = channel;
  subscription.isRemoving = false;
  channel
    .on('postgres_changes', options, (payload) => {
      const notification = toCamel(payload.new);
      if (notification.userId && notification.userId !== subscription.userId) return;
      if (notification.category === 'inventory') return;
      subscription.listeners.forEach(listener => listener(notification));
    })
    .subscribe();
};

const scheduleNotificationRealtimeRelease = (
  key: string,
  subscription: NotificationRealtimeSubscription,
) => {
  if (subscription.releaseTimer || subscription.isRemoving) return;

  subscription.releaseTimer = setTimeout(() => {
    subscription.releaseTimer = undefined;
    if (subscription.listeners.size > 0 || notificationRealtimeSubscriptions.get(key) !== subscription) return;

    const channel = subscription.channel;
    if (!channel) {
      notificationRealtimeSubscriptions.delete(key);
      return;
    }

    subscription.isRemoving = true;
    void supabase.removeChannel(channel)
      .catch(error => console.warn('Notification realtime cleanup failed:', error))
      .finally(() => {
        if (notificationRealtimeSubscriptions.get(key) !== subscription) return;
        if (subscription.listeners.size === 0) {
          notificationRealtimeSubscriptions.delete(key);
          return;
        }
        openNotificationRealtimeChannel(key, subscription);
      });
  }, 0);
};

const subscribeToNotificationRealtime = (
  callback: NotificationRealtimeListener,
  userId?: string,
) => {
  const key = notificationRealtimeKey(userId);
  let subscription = notificationRealtimeSubscriptions.get(key);
  if (!subscription) {
    subscription = {
      userId,
      channel: null,
      listeners: new Set(),
      isRemoving: false,
    };
    notificationRealtimeSubscriptions.set(key, subscription);
    openNotificationRealtimeChannel(key, subscription);
  }

  if (subscription.releaseTimer) {
    clearTimeout(subscription.releaseTimer);
    subscription.releaseTimer = undefined;
  }

  const listener: NotificationRealtimeListener = notification => callback(notification);
  subscription.listeners.add(listener);

  let isSubscribed = true;
  return () => {
    if (!isSubscribed) return;
    isSubscribed = false;
    subscription.listeners.delete(listener);
    if (subscription.listeners.size === 0) {
      scheduleNotificationRealtimeRelease(key, subscription);
    }
  };
};

const compareNotificationRows = (a: any, b: any): number => {
  const byDate = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  if (byDate !== 0) return byDate;
  return String(b.id).localeCompare(String(a.id));
};

const dedupeRowsById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
};

// Broadcast rows are shared, so each user's read/dismiss state lives in
// notification_broadcast_receipts instead of the row itself.
const applyBroadcastReceipts = async <T extends { id: string; is_read?: boolean }>(rows: T[]): Promise<T[]> => {
  if (rows.length === 0) return rows;
  const { data, error } = await supabase
    .from('notification_broadcast_receipts')
    .select('notification_id,read_at,dismissed_at')
    .in('notification_id', rows.map(row => row.id))
    .limit(rows.length);
  if (error) throw error;
  const receipts = new Map((data || []).map(receipt => [receipt.notification_id, receipt]));
  return rows
    .filter(row => !receipts.get(row.id)?.dismissed_at)
    .map(row => (receipts.get(row.id)?.read_at ? { ...row, is_read: true } : row));
};

const markMyNotifications = async (action: 'read' | 'dismiss', ids: string[] | null): Promise<void> => {
  const { error } = await supabase.rpc('mark_my_notifications', {
    p_action: action,
    p_notification_ids: ids,
  });
  if (error) throw error;
};

const buildNotificationQuery = (limit: number, cursor?: NotificationCursor) => {
  let query = supabase
    .from('notifications')
    .select(NOTIFICATION_LIST_SELECT)
    .eq('is_dismissed', false)
    .neq('category', 'inventory')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (cursor?.createdAt && cursor.id) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  return query;
};

export const NOTIFICATION_CATEGORIES = {
  attendance: { label: 'Chấm công', icon: '⏰', color: 'text-teal-600 bg-teal-50' },
  budget: { label: 'Ngân sách', icon: '💰', color: 'text-orange-600 bg-orange-50' },
  payment: { label: 'Thanh toán', icon: '🧾', color: 'text-red-600 bg-red-50' },
  progress: { label: 'Tiến độ', icon: '📐', color: 'text-blue-600 bg-blue-50' },
  material: { label: 'Vật tư', icon: '📦', color: 'text-amber-600 bg-amber-50' },
  safety: { label: 'An toàn', icon: '🛡️', color: 'text-red-600 bg-red-50' },
  contract: { label: 'Hợp đồng', icon: '📝', color: 'text-violet-600 bg-violet-50' },
  hrm: { label: 'Nhân sự', icon: '👤', color: 'text-indigo-600 bg-indigo-50' },
  feedback: { label: 'Góp ý', icon: '💬', color: 'text-blue-600 bg-blue-50' },
  chat: { label: 'Tin nhắn', icon: '💬', color: 'text-emerald-600 bg-emerald-50' },
  workflow: { label: 'Quy trình', icon: '🔀', color: 'text-sky-600 bg-sky-50' },
  system: { label: 'Hệ thống', icon: '⚙️', color: 'text-slate-600 bg-slate-50' },
} as const;

const getDefaultPriority = (severity?: AppNotification['severity']): AppNotification['priority'] => {
  if (severity === 'critical') return 'urgent';
  if (severity === 'warning') return 'high';
  return 'normal';
};

// ── Helper: create notification (standalone function, no `this`) ──
async function createNotification(n: Omit<AppNotification, 'id' | 'isRead' | 'isDismissed' | 'createdAt'>): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: n.userId || null,
    type: n.type,
    category: n.category,
    title: n.title,
    message: n.message,
    icon: n.icon || null,
    link: n.link || null,
    severity: n.severity,
    source_type: n.sourceType || null,
    source_id: n.sourceId || null,
    construction_site_id: n.constructionSiteId || null,
    priority: n.priority || getDefaultPriority(n.severity),
    push_enabled: n.pushEnabled ?? true,
    action_url: n.actionUrl || n.link || null,
    entity_type: n.entityType || n.sourceType || null,
    entity_id: n.entityId || null,
    metadata: n.metadata || {},
    expires_at: n.expiresAt || null,
  });
  if (error) throw error;
}

interface NotifyProjectUsersInput {
  recipientIds: Array<string | null | undefined>;
  actorId?: string | null;
  type: AppNotification['type'];
  category: string;
  title: string;
  message: string;
  severity: AppNotification['severity'];
  icon?: string;
  link?: string;
  sourceType?: string;
  sourceId?: string;
  constructionSiteId?: string;
  priority?: AppNotification['priority'];
  pushEnabled?: boolean;
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, any>;
  expiresAt?: string;
}

async function notifyProjectUsers(input: NotifyProjectUsersInput): Promise<string[]> {
  const actorId = input.actorId || undefined;
  const recipientIds = [...new Set(input.recipientIds.filter(Boolean) as string[])]
    .filter(userId => userId !== actorId);

  for (const userId of recipientIds) {
    await createNotification({
      userId,
      type: input.type,
      category: input.category,
      title: input.title,
      message: input.message,
      severity: input.severity,
      icon: input.icon,
      link: input.link,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      constructionSiteId: input.constructionSiteId,
      priority: input.priority,
      pushEnabled: input.pushEnabled,
      actionUrl: input.actionUrl,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata || {},
      expiresAt: input.expiresAt,
    });
  }

  return recipientIds;
}

export const notificationService = {
  /** List notifications with keyset pagination (recent first) */
  async listPage(userId?: string, options: {
    limit?: number;
    cursor?: NotificationCursor;
    /** Only these delivery reasons; omit for every notification. */
    reasons?: NotificationDeliveryReason[] | null;
  } = {}): Promise<NotificationListPage> {
    const limit = clampPageSize(options.limit, 50, 120);
    const reasons = options.reasons?.length ? options.reasons : null;
    const includeGlobal = !reasons || reasons.includes('system');

    if (!userId) {
      const { data, error } = await buildNotificationQuery(limit, options.cursor).is('user_id', null);
      if (error) throw error;
      const page = takeCursorPage(await applyBroadcastReceipts(data || []), limit, row => ({ createdAt: row.created_at, id: row.id }));
      return {
        items: page.items.map(toCamel),
        nextCursor: page.nextCursor,
      };
    }

    const userQuery = buildNotificationQuery(limit, options.cursor).eq('user_id', userId);
    const [userResult, globalResult] = await Promise.all([
      reasons ? userQuery.in('delivery_reason', reasons) : userQuery,
      includeGlobal ? buildNotificationQuery(limit, options.cursor).is('user_id', null) : Promise.resolve({ data: [], error: null }),
    ]);
    if (userResult.error) throw userResult.error;
    if (globalResult.error) throw globalResult.error;

    const globalRows = await applyBroadcastReceipts(globalResult.data || []);
    const mergedRows = dedupeRowsById([...(userResult.data || []), ...globalRows])
      .sort(compareNotificationRows);
    const page = takeCursorPage(mergedRows, limit, row => ({ createdAt: row.created_at, id: row.id }));

    return {
      items: page.items.map(toCamel),
      nextCursor: page.nextCursor,
    };
  },

  /** Unread count per inbox tab, each capped at 100 (shown as 99+). */
  async countUnreadByTab(userId: string): Promise<Record<Exclude<NotificationInboxTab, 'all'>, number>> {
    const countUserTab = async (reasons: NotificationDeliveryReason[]) => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)
        .eq('is_dismissed', false)
        .neq('category', 'inventory')
        .in('delivery_reason', reasons)
        .limit(1);
      if (error) throw error;
      return Math.min(count || 0, UNREAD_QUERY_LIMIT);
    };
    const [mine, watching, responsible, userSystem, globalResult] = await Promise.all([
      countUserTab(['assigned', 'mentioned']),
      countUserTab(['watching']),
      countUserTab(['responsible']),
      countUserTab(['system']),
      supabase
        .from('notifications')
        .select('id,is_read')
        .is('user_id', null)
        .eq('is_read', false)
        .eq('is_dismissed', false)
        .neq('category', 'inventory')
        .limit(UNREAD_QUERY_LIMIT),
    ]);
    if (globalResult.error) throw globalResult.error;
    const globalUnread = (await applyBroadcastReceipts(globalResult.data || [])).filter(row => !row.is_read).length;
    return { mine, watching, responsible, system: Math.min(userSystem + globalUnread, UNREAD_QUERY_LIMIT) };
  },

  /** List notifications (recent first) */
  async list(userId?: string, limit = 50): Promise<AppNotification[]> {
    const page = await this.listPage(userId, { limit });
    return page.items;
  },

  /** Capped unread count for the bell (digest notices wait for the daily summary). Returns 100 above 99. */
  async countUnread(userId?: string): Promise<number> {
    const baseQuery = () => supabase
      .from('notifications')
      .select('id,is_read')
      .eq('is_read', false)
      .eq('is_dismissed', false)
      .eq('delivery_mode', 'instant')
      .neq('category', 'inventory')
      .limit(UNREAD_QUERY_LIMIT);

    if (!userId) {
      const { data, error } = await baseQuery().is('user_id', null);
      if (error) throw error;
      const unreadGlobal = (await applyBroadcastReceipts(data || [])).filter(row => !row.is_read);
      return Math.min(unreadGlobal.length, UNREAD_QUERY_LIMIT);
    }

    const [userResult, globalResult] = await Promise.all([
      baseQuery().eq('user_id', userId),
      baseQuery().is('user_id', null),
    ]);
    if (userResult.error) throw userResult.error;
    if (globalResult.error) throw globalResult.error;

    const unreadIds = new Set<string>();
    const unreadGlobal = (await applyBroadcastReceipts(globalResult.data || [])).filter(row => !row.is_read);
    for (const row of [...(userResult.data || []), ...unreadGlobal]) {
      unreadIds.add(row.id);
      if (unreadIds.size >= UNREAD_QUERY_LIMIT) return UNREAD_QUERY_LIMIT;
    }
    return unreadIds.size;
  },

  /** The signed-in person's delivery preferences (defaults when never saved). */
  async getMyPreferences(userId: string): Promise<NotificationPreferences> {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('watching_mode,responsible_mode,digest_time')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DEFAULT_NOTIFICATION_PREFERENCES;
    return {
      watchingMode: data.watching_mode,
      responsibleMode: data.responsible_mode,
      digestTime: String(data.digest_time || DEFAULT_NOTIFICATION_PREFERENCES.digestTime).slice(0, 5),
    };
  },

  async saveMyPreferences(preferences: NotificationPreferences): Promise<void> {
    const { error } = await supabase.rpc('set_my_notification_preferences', {
      p_watching_mode: preferences.watchingMode,
      p_responsible_mode: preferences.responsibleMode,
      p_digest_time: preferences.digestTime,
    });
    if (error) throw error;
  },

  /** Mark as read */
  async markRead(id: string): Promise<void> {
    await markMyNotifications('read', [id]);
  },

  /** Mark all as read for the signed-in user only */
  async markAllRead(_userId?: string): Promise<void> {
    await markMyNotifications('read', null);
  },

  /** Dismiss */
  async dismiss(id: string): Promise<void> {
    await markMyNotifications('dismiss', [id]);
  },

  /** Dismiss all for the signed-in user only */
  async dismissAll(_userId?: string): Promise<void> {
    await markMyNotifications('dismiss', null);
  },

  /** Create a notification */
  create: createNotification,

  /** Create the same project notification for many users, excluding actor and duplicates in this call */
  notifyProjectUsers,

  /** Admin "run now": the server evaluates every alert rule immediately. Returns notifications created. */
  async runScheduledAlertsNow(): Promise<number> {
    const { data, error } = await supabase.rpc('run_scheduled_alerts_now');
    if (error) throw error;
    return Object.values((data || {}) as Record<string, number>).reduce((sum, value) => sum + (Number(value) || 0), 0);
  },

  /** Subscribe to realtime notifications without duplicating a topic across responsive views. */
  subscribe(callback: NotificationRealtimeListener, userId?: string): () => void {
    return subscribeToNotificationRealtime(callback, userId);
  },

  /** Unsubscribe */
  unsubscribe(stop?: () => void) {
    stop?.();
  },
};
