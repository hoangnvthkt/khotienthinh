import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Role } from '../types';
import { projectStaffService } from './projectStaffService';
import {
  DEFAULT_ALERT_RULES,
  getDefaultAlertRule,
  mergeAlertRules,
  type AlertRecipientConfig,
  type AlertRuleKey,
  type NotificationAlertRule,
} from './notificationAlertRules';

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
  createdAt: string;
  expiresAt?: string;
}

export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export interface NotificationListPage {
  items: AppNotification[];
  nextCursor?: NotificationCursor;
}

const UNREAD_DISPLAY_LIMIT = 99;
const UNREAD_QUERY_LIMIT = UNREAD_DISPLAY_LIMIT + 1;

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
});

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

const buildNotificationQuery = (limit: number, cursor?: NotificationCursor) => {
  let query = supabase
    .from('notifications')
    .select('*')
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
  system: { label: 'Hệ thống', icon: '⚙️', color: 'text-slate-600 bg-slate-50' },
} as const;

// ── Throttle: only allow alert checks once per 15min across all tabs ──
const ALERT_CHECK_KEY = 'vioo_last_alert_check';
const ALERT_CHECK_INTERVAL = 15 * 60 * 1000;

function shouldRunAlertCheck(): boolean {
  const last = localStorage.getItem(ALERT_CHECK_KEY);
  if (!last) return true;
  return Date.now() - parseInt(last) > ALERT_CHECK_INTERVAL;
}

function markAlertCheckDone(): void {
  localStorage.setItem(ALERT_CHECK_KEY, Date.now().toString());
}

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

interface AlertResolveContext {
  projectId?: string | null;
  constructionSiteId?: string | null;
  employeeUserId?: string | null;
}

interface AlertResolveCache {
  activeUsers?: Promise<any[]>;
  adminIds?: Promise<string[]>;
}

interface NotifyAlertInput extends Omit<NotifyProjectUsersInput, 'recipientIds' | 'category' | 'pushEnabled'> {
  alertKey: AlertRuleKey;
  category?: string;
  projectId?: string | null;
  employeeUserId?: string | null;
}

interface RunAlertChecksOptions {
  force?: boolean;
}

const listActiveUsers = async (cache?: AlertResolveCache): Promise<any[]> => {
  if (!cache) {
    const { data, error } = await supabase
      .from('users')
      .select('id, role, allowed_modules, admin_modules, is_active');
    if (error) {
      console.warn('Alert active user lookup failed:', error);
      return [];
    }
    return (data || []).filter(row => row.is_active !== false);
  }
  if (!cache.activeUsers) {
    cache.activeUsers = (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, role, allowed_modules, admin_modules, is_active');
        if (error) {
          console.warn('Alert active user lookup failed:', error);
          return [];
        }
        return (data || []).filter(row => row.is_active !== false);
    })();
  }
  return cache.activeUsers;
};

const listAdminUserIds = async (cache?: AlertResolveCache): Promise<string[]> => {
  if (!cache) {
    const users = await listActiveUsers();
    return users.filter(row => row.role === Role.ADMIN).map(row => row.id).filter(Boolean);
  }
  if (!cache.adminIds) {
    cache.adminIds = listActiveUsers(cache).then(users =>
      users.filter(row => row.role === Role.ADMIN).map(row => row.id).filter(Boolean)
    );
  }
  return cache.adminIds;
};

const uniqueIds = (ids: Array<string | null | undefined>) => [...new Set(ids.filter(Boolean) as string[])];

const includesAny = (values: unknown, targets: string[] = []) =>
  Array.isArray(values) && targets.some(target => values.includes(target));

const isCurrentUserAdmin = async (): Promise<boolean> => {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return false;

  const { data: profileByAuth } = await supabase
    .from('users')
    .select('id, role')
    .eq('auth_id', authData.user.id)
    .maybeSingle();
  if (profileByAuth?.role === Role.ADMIN) return true;

  if (!authData.user.email) return false;
  const { data: profileByEmail } = await supabase
    .from('users')
    .select('id, role')
    .eq('email', authData.user.email)
    .maybeSingle();
  return profileByEmail?.role === Role.ADMIN;
};

const loadAlertRules = async (): Promise<Map<AlertRuleKey, NotificationAlertRule>> => {
  const { data, error } = await supabase
    .from('notification_alert_rules')
    .select('*');
  if (error) {
    console.warn('Alert rules unavailable, using defaults:', error);
    return new Map(DEFAULT_ALERT_RULES.map(rule => [rule.alertKey, rule]));
  }
  return new Map(mergeAlertRules(data || []).map(rule => [rule.alertKey, rule]));
};

const resolveAlertRecipients = async (
  rule: NotificationAlertRule,
  context: AlertResolveContext = {},
  cache?: AlertResolveCache,
): Promise<{ recipientIds: string[]; broadcast: boolean; reason: string }> => {
  const config: AlertRecipientConfig = rule.recipientConfig || { mode: 'admin', fallbackToAdmin: true };
  let recipientIds: string[] = [];
  let reason: string = config.mode;

  if (config.mode === 'broadcast') {
    return { recipientIds: [], broadcast: true, reason: 'broadcast' };
  }

  if (config.mode === 'admin') {
    recipientIds = await listAdminUserIds(cache);
  } else if (config.mode === 'roles') {
    const roles = config.roles || [];
    const users = await listActiveUsers(cache);
    recipientIds = users.filter(row => roles.includes(row.role)).map(row => row.id);
  } else if (config.mode === 'module_admins') {
    const moduleKeys = config.moduleKeys || [];
    const users = await listActiveUsers(cache);
    recipientIds = users
      .filter(row =>
        (config.includeAdmins && row.role === Role.ADMIN) ||
        includesAny(row.admin_modules, moduleKeys)
      )
      .map(row => row.id);
  } else if (config.mode === 'users') {
    recipientIds = config.userIds || [];
  } else if (config.mode === 'employee_owner') {
    recipientIds = context.employeeUserId ? [context.employeeUserId] : [];
  } else if (config.mode === 'project_permission') {
    const permissionCodes = config.projectPermissionCodes || [];
    if (permissionCodes.length > 0 && (context.projectId || context.constructionSiteId)) {
      try {
        const staff = await projectStaffService.listProjectStaffWithPermissions(
          context.projectId || undefined,
          context.constructionSiteId || undefined,
          permissionCodes,
        );
        recipientIds = staff.map(row => row.userId).filter(Boolean);
      } catch (error) {
        console.warn('Alert project permission recipient lookup failed:', error);
      }
    }
  }

  if (config.includeAdmins && config.mode !== 'admin' && config.mode !== 'module_admins') {
    recipientIds.push(...await listAdminUserIds(cache));
  }

  recipientIds = uniqueIds(recipientIds);
  if (recipientIds.length === 0 && config.fallbackToAdmin !== false) {
    recipientIds = await listAdminUserIds(cache);
    reason = `${reason}:fallback_admin`;
  }

  return { recipientIds, broadcast: false, reason };
};

const getRule = (rules: Map<AlertRuleKey, NotificationAlertRule>, alertKey: AlertRuleKey) =>
  rules.get(alertKey) || getDefaultAlertRule(alertKey);

const getRuleNumber = (rule: NotificationAlertRule, key: string, fallback: number) => {
  const value = Number(rule.thresholds?.[key]);
  return Number.isFinite(value) ? value : fallback;
};

const getRuleSnapshot = (rule: NotificationAlertRule) => ({
  alertKey: rule.alertKey,
  isEnabled: rule.isEnabled,
  thresholds: rule.thresholds,
  cooldownMinutes: rule.cooldownMinutes,
  recipientConfig: rule.recipientConfig,
  channels: rule.channels,
});

const notifyAlertWithRule = async (
  rule: NotificationAlertRule,
  input: Omit<NotifyAlertInput, 'alertKey'>,
  cache?: AlertResolveCache,
): Promise<string[]> => {
  if (!rule.isEnabled || rule.channels?.inApp === false) return [];
  const resolved = await resolveAlertRecipients(rule, {
    projectId: input.projectId,
    constructionSiteId: input.constructionSiteId,
    employeeUserId: input.employeeUserId,
  }, cache);

  const metadata = {
    ...(input.metadata || {}),
    alertKey: rule.alertKey,
    recipientReason: resolved.reason,
    ruleSnapshot: getRuleSnapshot(rule),
    resolvedAt: new Date().toISOString(),
  };

  if (resolved.broadcast) {
    await createNotification({
      userId: undefined,
      type: input.type,
      category: input.category || rule.category,
      title: input.title,
      message: input.message,
      severity: input.severity,
      icon: input.icon,
      link: input.link,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      constructionSiteId: input.constructionSiteId || undefined,
      priority: input.priority,
      pushEnabled: false,
      actionUrl: input.actionUrl,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata,
      expiresAt: input.expiresAt,
    });
    return ['broadcast'];
  }

  if (resolved.recipientIds.length === 0) return [];
  return notifyProjectUsers({
    recipientIds: resolved.recipientIds,
    actorId: input.actorId,
    type: input.type,
    category: input.category || rule.category,
    title: input.title,
    message: input.message,
    severity: input.severity,
    icon: input.icon,
    link: input.link,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    constructionSiteId: input.constructionSiteId || undefined,
    priority: input.priority,
    pushEnabled: rule.channels?.webPush !== false,
    actionUrl: input.actionUrl,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata,
    expiresAt: input.expiresAt,
  });
};

export const notificationService = {
  /** List notifications with keyset pagination (recent first) */
  async listPage(userId?: string, options: {
    limit?: number;
    cursor?: NotificationCursor;
  } = {}): Promise<NotificationListPage> {
    const limit = Math.min(Math.max(options.limit || 50, 1), 120);

    if (!userId) {
      const { data, error } = await buildNotificationQuery(limit, options.cursor).is('user_id', null);
      if (error) throw error;
      const rows = data || [];
      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      return {
        items: pageRows.map(toCamel),
        nextCursor: rows.length > limit && last ? { createdAt: last.created_at, id: last.id } : undefined,
      };
    }

    const [userResult, globalResult] = await Promise.all([
      buildNotificationQuery(limit, options.cursor).eq('user_id', userId),
      buildNotificationQuery(limit, options.cursor).is('user_id', null),
    ]);
    if (userResult.error) throw userResult.error;
    if (globalResult.error) throw globalResult.error;

    const mergedRows = dedupeRowsById([...(userResult.data || []), ...(globalResult.data || [])])
      .sort(compareNotificationRows);
    const pageRows = mergedRows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map(toCamel),
      nextCursor: mergedRows.length > limit && last ? { createdAt: last.created_at, id: last.id } : undefined,
    };
  },

  /** List notifications (recent first) */
  async list(userId?: string, limit = 50): Promise<AppNotification[]> {
    const page = await this.listPage(userId, { limit });
    return page.items;
  },

  /** Capped unread count. Returns 100 when there are more than 99 unread notifications. */
  async countUnread(userId?: string): Promise<number> {
    const baseQuery = () => supabase
      .from('notifications')
      .select('id')
      .eq('is_read', false)
      .eq('is_dismissed', false)
      .neq('category', 'inventory')
      .limit(UNREAD_QUERY_LIMIT);

    if (!userId) {
      const { data, error } = await baseQuery().is('user_id', null);
      if (error) throw error;
      return Math.min((data || []).length, UNREAD_QUERY_LIMIT);
    }

    const [userResult, globalResult] = await Promise.all([
      baseQuery().eq('user_id', userId),
      baseQuery().is('user_id', null),
    ]);
    if (userResult.error) throw userResult.error;
    if (globalResult.error) throw globalResult.error;

    const unreadIds = new Set<string>();
    for (const row of [...(userResult.data || []), ...(globalResult.data || [])]) {
      unreadIds.add(row.id);
      if (unreadIds.size >= UNREAD_QUERY_LIMIT) return UNREAD_QUERY_LIMIT;
    }
    return unreadIds.size;
  },

  /** Mark as read */
  async markRead(id: string): Promise<void> {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  },

  /** Mark all as read */
  async markAllRead(userId?: string): Promise<void> {
    let query = supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
    if (userId) query = query.or(`user_id.eq.${userId},user_id.is.null`);
    await query;
  },

  /** Dismiss */
  async dismiss(id: string): Promise<void> {
    await supabase.from('notifications').update({ is_dismissed: true }).eq('id', id);
  },

  /** Dismiss all */
  async dismissAll(userId?: string): Promise<void> {
    let query = supabase.from('notifications').update({ is_dismissed: true }).eq('is_dismissed', false);
    if (userId) query = query.or(`user_id.eq.${userId},user_id.is.null`);
    await query;
  },

  /** Create a notification */
  create: createNotification,

  /** Create the same project notification for many users, excluding actor and duplicates in this call */
  notifyProjectUsers,

  /** Run all configurable alert checks. Admin-owned so settings are respected. */
  async runAlertChecks(options: RunAlertChecksOptions = {}): Promise<number> {
    if (!(await isCurrentUserAdmin())) return 0;

    if (!options.force) {
      if (!shouldRunAlertCheck()) return 0;
      markAlertCheckDone();
    }

    const rules = await loadAlertRules();
    const resolveCache: AlertResolveCache = {};
    const enabledRules = [...rules.values()].filter(rule => rule.isEnabled && rule.channels?.inApp !== false);
    if (enabledRules.length === 0) return 0;

    let alertCount = 0;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const maxCooldownMinutes = Math.max(1440, ...enabledRules.map(rule => Number(rule.cooldownMinutes || 0)));
    const since = new Date(Date.now() - maxCooldownMinutes * 60 * 1000).toISOString();
    const { data: recentAlerts } = await supabase
      .from('notifications')
      .select('source_type, source_id, created_at')
      .gte('created_at', since);
    const emittedKeys = new Set<string>();

    const isNew = (rule: NotificationAlertRule, sourceType: string, sourceId: string) => {
      const key = `${sourceType}:${sourceId}`;
      if (emittedKeys.has(key)) return false;
      const cooldownMinutes = Number(rule.cooldownMinutes || 0);
      if (cooldownMinutes <= 0) return true;
      const cutoff = Date.now() - cooldownMinutes * 60 * 1000;
      return !(recentAlerts || []).some((row: any) =>
        row.source_type === sourceType &&
        row.source_id === sourceId &&
        new Date(row.created_at).getTime() >= cutoff
      );
    };

    const notifyRule = async (
      alertKey: AlertRuleKey,
      input: Omit<NotifyAlertInput, 'alertKey'>,
    ) => {
      const rule = getRule(rules, alertKey);
      if (!rule.isEnabled || rule.channels?.inApp === false) return 0;
      const sourceType = input.sourceType || alertKey;
      const sourceId = input.sourceId || alertKey;
      if (!isNew(rule, sourceType, sourceId)) return 0;
      const notifiedIds = await notifyAlertWithRule(rule, input, resolveCache);
      if (notifiedIds.length > 0) emittedKeys.add(`${sourceType}:${sourceId}`);
      return notifiedIds.length;
    };

    const { data: sites } = await supabase
      .from('hrm_construction_sites')
      .select('id, name, "checkInTime"');
    const getSiteName = (id?: string | null) => sites?.find((s: any) => s.id === id)?.name || 'N/A';

    try {
      const budgetRule = getRule(rules, 'budget_overrun');
      const slowProgressRule = getRule(rules, 'slow_progress');
      if (budgetRule.isEnabled || slowProgressRule.isEnabled) {
        const { data: finances } = await supabase
          .from('project_finances')
          .select('project_id, "constructionSiteId", "contractValue", "actualMaterials", "actualLabor", "actualSubcontract", "actualMachinery", "actualOverhead", "progressPercent", status');

        for (const f of (finances || [])) {
          const projectId = f.project_id || null;
          const constructionSiteId = f.constructionSiteId || null;
          const totalExpense = (f.actualMaterials || 0) + (f.actualLabor || 0) +
            (f.actualSubcontract || 0) + (f.actualMachinery || 0) + (f.actualOverhead || 0);
          const contractValue = f.contractValue || 0;
          const warningPercent = getRuleNumber(budgetRule, 'warningPercent', 90);
          const criticalPercent = getRuleNumber(budgetRule, 'criticalPercent', 100);
          const pct = contractValue > 0 ? Math.round((totalExpense / contractValue) * 100) : 0;

          if (contractValue > 0 && pct >= warningPercent) {
            const isCritical = pct >= criticalPercent;
            alertCount += await notifyRule('budget_overrun', {
              projectId,
              constructionSiteId,
              type: isCritical ? 'error' : 'warning',
              category: 'budget',
              title: isCritical ? '🚨 Vượt ngân sách!' : '⚠️ Sắp vượt ngân sách',
              message: `${getSiteName(constructionSiteId)}: Chi phí đạt ${pct}% giá trị HĐ`,
              severity: isCritical ? 'critical' : 'warning',
              icon: '💰',
              link: '/da',
              sourceType: 'budget',
              sourceId: `budget_${constructionSiteId}`,
              metadata: { projectId, constructionSiteId, percent: pct, expense: totalExpense, contract: contractValue },
            });
          }

          if (f.status === 'active' && Number(f.progressPercent || 0) < getRuleNumber(slowProgressRule, 'minProgressPercent', 30)) {
            alertCount += await notifyRule('slow_progress', {
              projectId,
              constructionSiteId,
              type: 'info',
              category: 'progress',
              title: '📐 Tiến độ chậm',
              message: `${getSiteName(constructionSiteId)}: mới đạt ${f.progressPercent}% (đang thi công)`,
              severity: 'info',
              icon: '📐',
              link: '/da',
              sourceType: 'progress',
              sourceId: `progress_${constructionSiteId}`,
              metadata: { projectId, constructionSiteId, progress: f.progressPercent },
            });
          }
        }
      }
    } catch (err) {
      console.error('Budget/progress alert check error:', err);
    }

    try {
      const paymentRule = getRule(rules, 'overdue_payment');
      if (paymentRule.isEnabled) {
        const { data: payments } = await supabase
          .from('payment_schedules')
          .select('id, project_id, construction_site_id, description, status, due_date, amount');
        for (const p of (payments || [])) {
          const isUnpaid = p.status === 'pending' || p.status === 'overdue' || p.status === 'partial';
          if (!isUnpaid || !p.due_date || p.due_date >= today) continue;
          alertCount += await notifyRule('overdue_payment', {
            projectId: p.project_id,
            constructionSiteId: p.construction_site_id,
            type: 'error',
            category: 'payment',
            title: '🧾 Thanh toán quá hạn',
            message: `${p.description || 'Phiếu thanh toán'} — ${getSiteName(p.construction_site_id)}: quá hạn ${p.due_date}`,
            severity: 'critical',
            icon: '🧾',
            link: '/da',
            sourceType: 'payment',
            sourceId: `payment_${p.id}`,
            metadata: { paymentId: p.id, dueDate: p.due_date, amount: p.amount, projectId: p.project_id, constructionSiteId: p.construction_site_id },
          });
        }
      }
    } catch (err) {
      console.error('Overdue payment alert check error:', err);
    }

    try {
      const materialRule = getRule(rules, 'material_waste');
      if (materialRule.isEnabled) {
        const { data: boqItems } = await supabase
          .from('material_budget_items')
          .select('id, project_id, construction_site_id, item_name, waste_percent, waste_threshold');
        for (const b of (boqItems || [])) {
          const wp = Number(b.waste_percent || 0);
          const wt = Number(b.waste_threshold || 5);
          if (wp <= wt) continue;
          alertCount += await notifyRule('material_waste', {
            projectId: b.project_id,
            constructionSiteId: b.construction_site_id,
            type: 'warning',
            category: 'material',
            title: '📦 Hao hụt vượt định mức',
            message: `${b.item_name || 'Vật tư'} — ${getSiteName(b.construction_site_id)}: hao hụt ${wp.toFixed(1)}% (định mức ${wt}%)`,
            severity: 'warning',
            icon: '📦',
            link: '/da',
            sourceType: 'material',
            sourceId: `waste_${b.id}`,
            metadata: { itemId: b.id, wastePercent: wp, threshold: wt, projectId: b.project_id, constructionSiteId: b.construction_site_id },
          });
        }
      }
    } catch (err) {
      console.error('Material waste alert check error:', err);
    }

    try {
      const attendanceRule = getRule(rules, 'attendance_reminder');
      if (attendanceRule.isEnabled) {
        const currentTimeMin = now.getHours() * 60 + now.getMinutes();
        const reminderLeadMin = getRuleNumber(attendanceRule, 'minutesBefore', 5);
        const { data: offices } = await supabase
          .from('hrm_offices')
          .select('id, name, "checkInTime"');
        const locations = [
          ...(offices || []).map((o: any) => ({ id: o.id, name: o.name, checkInTime: o.checkInTime || '08:00', type: 'office' })),
          ...(sites || []).map((s: any) => ({ id: s.id, name: s.name, checkInTime: s.checkInTime || '07:30', type: 'site' })),
        ];

        for (const loc of locations) {
          const [h, m] = loc.checkInTime.split(':').map(Number);
          const checkInMin = h * 60 + m;
          const reminderMin = checkInMin - reminderLeadMin;
          if (currentTimeMin < reminderMin || currentTimeMin > checkInMin) continue;

          const locFilter = loc.type === 'office' ? 'office_id' : 'construction_site_id';
          const { data: employees } = await supabase
            .from('employees')
            .select('id, full_name, user_id')
            .eq('status', 'Đang làm việc')
            .eq(locFilter, loc.id);
          if (!employees?.length) continue;

          const empIds = employees.map((e: any) => e.id);
          const { data: checkedIn } = await supabase
            .from('hrm_attendance')
            .select('"employeeId"')
            .eq('date', today)
            .in('"employeeId"', empIds);
          const checkedInIds = new Set((checkedIn || []).map((a: any) => a.employeeId));

          const { data: onLeave } = await supabase
            .from('hrm_leave_requests')
            .select('"employeeId"')
            .eq('status', 'approved')
            .lte('"startDate"', today)
            .gte('"endDate"', today);
          const leaveIds = new Set((onLeave || []).map((l: any) => l.employeeId));

          for (const emp of employees) {
            if (checkedInIds.has(emp.id) || leaveIds.has(emp.id) || !emp.user_id) continue;
            alertCount += await notifyRule('attendance_reminder', {
              employeeUserId: emp.user_id,
              type: 'warning',
              category: 'attendance',
              title: '⏰ Nhắc nhở chấm công',
              message: `Còn ${checkInMin - currentTimeMin} phút nữa là đến giờ chấm công (${loc.checkInTime}) tại ${loc.name}. Hãy chấm công đúng giờ nhé!`,
              severity: 'warning',
              icon: '⏰',
              link: '/hrm/checkin',
              sourceType: 'attendance',
              sourceId: `attendance_${emp.id}_${today}`,
              metadata: { employeeId: emp.id, location: loc.name, checkInTime: loc.checkInTime },
            });
          }
        }
      }
    } catch (err) {
      console.error('Attendance reminder check error:', err);
    }

    try {
      const contractRule = getRule(rules, 'contract_expiry');
      if (contractRule.isEnabled) {
        const daysBeforeWarning = getRuleNumber(contractRule, 'daysBeforeWarning', 30);
        const criticalDays = getRuleNumber(contractRule, 'criticalDays', 7);
        const warningDate = new Date(Date.now() + daysBeforeWarning * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { data: contracts } = await supabase
          .from('hrm_labor_contracts')
          .select('id, "employeeId", "contractNumber", "endDate", type')
          .eq('status', 'active')
          .lte('"endDate"', warningDate)
          .gte('"endDate"', today);

        const empIds = (contracts || []).map((c: any) => c.employeeId);
        const { data: emps } = empIds.length
          ? await supabase.from('employees').select('id, full_name').in('id', empIds)
          : { data: [] as any[] };
        const empMap = new Map((emps || []).map((e: any) => [e.id, e.full_name]));

        for (const c of (contracts || [])) {
          const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          const empName = empMap.get(c.employeeId) || 'N/A';
          alertCount += await notifyRule('contract_expiry', {
            type: daysLeft <= criticalDays ? 'error' : 'warning',
            category: 'hrm',
            title: daysLeft <= criticalDays ? '🚨 Hợp đồng LĐ sắp hết hạn!' : '📝 Hợp đồng LĐ cần gia hạn',
            message: `${empName} — HĐ ${c.contractNumber || c.type}: còn ${daysLeft} ngày (hết hạn ${c.endDate})`,
            severity: daysLeft <= criticalDays ? 'critical' : 'warning',
            icon: '📝',
            link: '/hrm/contracts',
            sourceType: 'hrm',
            sourceId: `contract_expiry_${c.id}`,
            metadata: { contractId: c.id, employeeId: c.employeeId, daysLeft, endDate: c.endDate },
          });
        }
      }
    } catch (err) {
      console.error('Contract expiry check error:', err);
    }

    try {
      const overdueRequestRule = getRule(rules, 'overdue_request');
      if (overdueRequestRule.isEnabled) {
        const { data: overdueReqs } = await supabase
          .from('request_instances')
          .select('id, code, title, due_date, status')
          .in('status', ['pending', 'in_progress', 'draft'])
          .not('due_date', 'is', null)
          .lt('due_date', today);
        for (const req of (overdueReqs || [])) {
          const daysOverdue = Math.ceil((Date.now() - new Date(req.due_date).getTime()) / (24 * 60 * 60 * 1000));
          alertCount += await notifyRule('overdue_request', {
            type: daysOverdue > 7 ? 'error' : 'warning',
            category: 'system',
            title: '⚠️ Yêu cầu quá hạn',
            message: `${req.code || 'YC'} — ${req.title || 'Không tiêu đề'}: quá hạn ${daysOverdue} ngày`,
            severity: daysOverdue > 7 ? 'critical' : 'warning',
            icon: '⚠️',
            link: '/rq',
            sourceType: 'system',
            sourceId: `request_overdue_${req.id}`,
            metadata: { requestId: req.id, daysOverdue, dueDate: req.due_date },
          });
        }
      }
    } catch (err) {
      console.error('Overdue request alert error:', err);
    }

    try {
      const birthdayRule = getRule(rules, 'employee_birthday');
      if (birthdayRule.isEnabled) {
        const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const { data: allEmployees } = await supabase
          .from('employees')
          .select('id, full_name, date_of_birth')
          .eq('status', 'Đang làm việc')
          .not('date_of_birth', 'is', null);
        for (const emp of (allEmployees || [])) {
          if (!emp.date_of_birth || emp.date_of_birth.slice(5) !== monthDay) continue;
          alertCount += await notifyRule('employee_birthday', {
            type: 'info',
            category: 'hrm',
            title: '🎂 Sinh nhật nhân viên',
            message: `Hôm nay là sinh nhật ${emp.full_name}! Hãy gửi lời chúc mừng nhé 🎉`,
            severity: 'info',
            icon: '🎂',
            link: '/hrm/employees',
            sourceType: 'hrm',
            sourceId: `birthday_${emp.id}_${today}`,
            metadata: { employeeId: emp.id, birthday: emp.date_of_birth },
          });
        }
      }
    } catch (err) {
      console.error('Birthday alert error:', err);
    }

    try {
      const payrollRule = getRule(rules, 'missing_payroll');
      if (payrollRule.isEnabled && now.getDate() >= getRuleNumber(payrollRule, 'startDay', 25)) {
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const { data: activeEmps } = await supabase
          .from('employees')
          .select('id, full_name')
          .eq('status', 'Đang làm việc');
        const { data: payrolls } = await supabase
          .from('hrm_payrolls')
          .select('"employeeId"')
          .eq('month', currentMonth)
          .eq('year', currentYear);
        const paidEmpIds = new Set((payrolls || []).map((p: any) => p.employeeId));
        const missingPayroll = (activeEmps || []).filter((e: any) => !paidEmpIds.has(e.id));
        if (missingPayroll.length > 0) {
          const names = missingPayroll.slice(0, 3).map((e: any) => e.full_name).join(', ');
          const extra = missingPayroll.length > 3 ? ` và ${missingPayroll.length - 3} NV khác` : '';
          alertCount += await notifyRule('missing_payroll', {
            type: 'warning',
            category: 'hrm',
            title: '💰 Chưa tính lương tháng này',
            message: `${missingPayroll.length} nhân viên chưa có bảng lương T${currentMonth}/${currentYear}: ${names}${extra}`,
            severity: 'warning',
            icon: '💰',
            link: '/hrm/payroll',
            sourceType: 'hrm',
            sourceId: `payroll_missing_${currentYear}_${currentMonth}`,
            metadata: { month: currentMonth, year: currentYear, count: missingPayroll.length },
          });
        }
      }
    } catch (err) {
      console.error('Payroll alert error:', err);
    }

    try {
      const dailyLogRule = getRule(rules, 'stale_daily_log');
      if (dailyLogRule.isEnabled) {
        const daysPending = getRuleNumber(dailyLogRule, 'daysPending', 2);
        const staleBefore = new Date(Date.now() - daysPending * 24 * 60 * 60 * 1000).toISOString();
        const { data: staleLogs } = await supabase
          .from('daily_logs')
          .select('id, date, project_id, construction_site_id')
          .eq('status', 'submitted')
          .lt('submitted_at', staleBefore)
          .limit(20);
        for (const log of (staleLogs || [])) {
          alertCount += await notifyRule('stale_daily_log', {
            projectId: log.project_id,
            constructionSiteId: log.construction_site_id,
            type: 'warning',
            category: 'progress',
            title: '📝 Nhật ký chờ xác nhận > 2 ngày',
            message: `Nhật ký ${log.date} tại ${getSiteName(log.construction_site_id)} chưa được xác nhận`,
            severity: 'warning',
            icon: '📝',
            link: '/da',
            sourceType: 'progress',
            sourceId: `dailylog_stale_${log.id}`,
            metadata: { logId: log.id, date: log.date, projectId: log.project_id, constructionSiteId: log.construction_site_id },
          });
        }
      }
    } catch (err) {
      console.error('Stale dailylog check error:', err);
    }

    return alertCount;
  },

  /** Send one configured alert from a domain service such as Safety. */
  async notifyAlert(input: NotifyAlertInput): Promise<string[]> {
    const rules = await loadAlertRules();
    const rule = getRule(rules, input.alertKey);
    return notifyAlertWithRule(rule, input);
  },

  /** Subscribe to realtime notifications */
  subscribe(callback: (n: AppNotification) => void, userId?: string): RealtimeChannel {
    const channel = supabase.channel(`notifications:${userId || 'global'}`);
    const options = userId
      ? { event: 'INSERT' as const, schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }
      : { event: 'INSERT' as const, schema: 'public', table: 'notifications' };

    return channel
      .on('postgres_changes', options, (payload) => {
        const notification = toCamel(payload.new);
        if (notification.userId && notification.userId !== userId) return;
        if (notification.category === 'inventory') return;
        callback(notification);
      })
      .subscribe();
  },

  /** Unsubscribe */
  unsubscribe(channel?: RealtimeChannel) {
    if (channel) supabase.removeChannel(channel);
  },
};
