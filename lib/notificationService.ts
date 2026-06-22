import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

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

  /** Run all alert checks — throttled, single-tab safe */
  async runAlertChecks(): Promise<number> {
    // Throttle: skip if another tab ran checks recently
    if (!shouldRunAlertCheck()) return 0;
    markAlertCheckDone();

    let alertCount = 0;

    // Fetch only needed columns
    const { data: finances } = await supabase
      .from('project_finances')
      .select('"constructionSiteId", "contractValue", "actualMaterials", "actualLabor", "actualSubcontract", "actualMachinery", "actualOverhead", "revenueReceived", "progressPercent", status');
    const { data: sites } = await supabase
      .from('hrm_construction_sites').select('id, name');
    const { data: payments } = await supabase
      .from('payment_schedules').select('id, construction_site_id, description, status, due_date, amount');
    const { data: boqItems } = await supabase
      .from('material_budget_items').select('id, construction_site_id, item_name, waste_percent, waste_threshold');
    // Include accepted value for better profit calc
    const { data: acceptances } = await supabase
      .from('acceptance_records').select('construction_site_id, approved_value, status');

    const getSiteName = (id: string) => sites?.find((s: any) => s.id === id)?.name || 'N/A';

    // Dedup: check recent 24h alerts
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await supabase
      .from('notifications')
      .select('source_type, source_id')
      .gte('created_at', since);
    const recentKeys = new Set((recentAlerts || []).map((a: any) => `${a.source_type}:${a.source_id}`));
    const isNew = (type: string, id: string) => !recentKeys.has(`${type}:${id}`);

    // 1. Budget overrun alerts
    for (const f of (finances || [])) {
      const totalExpense = (f.actualMaterials || 0) + (f.actualLabor || 0) +
        (f.actualSubcontract || 0) + (f.actualMachinery || 0) + (f.actualOverhead || 0);
      const contractValue = f.contractValue || 0;
      if (contractValue > 0 && totalExpense > contractValue * 0.9) {
        const pct = Math.round((totalExpense / contractValue) * 100);
        const alertId = `budget_${f.constructionSiteId}`;
        if (isNew('budget', alertId)) {
          const isCritical = totalExpense > contractValue;
          await createNotification({
            type: isCritical ? 'error' : 'warning',
            category: 'budget',
            title: isCritical ? '🚨 Vượt ngân sách!' : '⚠️ Sắp vượt ngân sách',
            message: `${getSiteName(f.constructionSiteId)}: Chi phí đạt ${pct}% giá trị HĐ`,
            severity: isCritical ? 'critical' : 'warning',
            icon: '💰',
            link: '/da',
            sourceType: 'budget',
            sourceId: alertId,
            constructionSiteId: f.constructionSiteId,
            metadata: { percent: pct, expense: totalExpense, contract: contractValue },
          });
          alertCount++;
        }
      }
    }

    // 2. Overdue payment alerts — check both 'pending' and any unpaid with past due_date
    const today = new Date().toISOString().split('T')[0];
    for (const p of (payments || [])) {
      const isUnpaid = p.status === 'pending' || p.status === 'overdue' || p.status === 'partial';
      if (isUnpaid && p.due_date && p.due_date < today) {
        const alertId = `payment_${p.id}`;
        if (isNew('payment', alertId)) {
          await createNotification({
            type: 'error',
            category: 'payment',
            title: '🧾 Thanh toán quá hạn',
            message: `${p.description || 'Phiếu thanh toán'} — ${getSiteName(p.construction_site_id)}: quá hạn ${p.due_date}`,
            severity: 'critical',
            icon: '🧾',
            link: '/da',
            sourceType: 'payment',
            sourceId: alertId,
            constructionSiteId: p.construction_site_id,
            metadata: { paymentId: p.id, dueDate: p.due_date, amount: p.amount },
          });
          alertCount++;
        }
      }
    }

    // 3. Material waste over threshold
    for (const b of (boqItems || [])) {
      const wp = b.waste_percent || 0;
      const wt = b.waste_threshold || 5;
      if (wp > wt) {
        const alertId = `waste_${b.id}`;
        if (isNew('material', alertId)) {
          await createNotification({
            type: 'warning',
            category: 'material',
            title: '📦 Hao hụt vượt định mức',
            message: `${b.item_name || 'Vật tư'} — ${getSiteName(b.construction_site_id)}: hao hụt ${wp.toFixed(1)}% (định mức ${wt}%)`,
            severity: 'warning',
            icon: '📦',
            link: '/da',
            sourceType: 'material',
            sourceId: alertId,
            constructionSiteId: b.construction_site_id,
            metadata: { itemId: b.id, wastePercent: wp, threshold: wt },
          });
          alertCount++;
        }
      }
    }

    // 4. Slow progress alerts
    for (const f of (finances || [])) {
      if (f.status === 'active' && f.progressPercent < 30) {
        const alertId = `progress_${f.constructionSiteId}`;
        if (isNew('progress', alertId)) {
          await createNotification({
            type: 'info',
            category: 'progress',
            title: '📐 Tiến độ chậm',
            message: `${getSiteName(f.constructionSiteId)}: mới đạt ${f.progressPercent}% (đang thi công)`,
            severity: 'info',
            icon: '📐',
            link: '/da',
            sourceType: 'progress',
            sourceId: alertId,
            constructionSiteId: f.constructionSiteId,
            metadata: { progress: f.progressPercent },
          });
          alertCount++;
        }
      }
    }

    // 5. ⏰ Attendance reminder — 5 min before check-in time
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      const currentTimeMin = currentHour * 60 + currentMin; // total minutes since midnight

      // Get offices with check-in times
      const { data: offices } = await supabase
        .from('hrm_offices')
        .select('id, name, "checkInTime"');
      const { data: constSites } = await supabase
        .from('hrm_construction_sites')
        .select('id, name, "checkInTime"');

      // Combine all locations with their check-in times
      const locations = [
        ...(offices || []).map((o: any) => ({ id: o.id, name: o.name, checkInTime: o.checkInTime || '08:00', type: 'office' })),
        ...(constSites || []).map((s: any) => ({ id: s.id, name: s.name, checkInTime: s.checkInTime || '07:30', type: 'site' })),
      ];

      for (const loc of locations) {
        // Parse check-in time "HH:MM"
        const [h, m] = loc.checkInTime.split(':').map(Number);
        const checkInMin = h * 60 + m;
        const reminderMin = checkInMin - 5; // 5 minutes before

        // Only trigger if we're within the reminder window (reminderMin to checkInMin)
        if (currentTimeMin >= reminderMin && currentTimeMin <= checkInMin) {
          // Find employees assigned to this location who haven't checked in today
          const locFilter = loc.type === 'office' ? 'office_id' : 'construction_site_id';
          const { data: employees } = await supabase
            .from('employees')
            .select('id, full_name, user_id')
            .eq('status', 'Đang làm việc')
            .eq(locFilter, loc.id);

          if (!employees || employees.length === 0) continue;

          // Check who has already checked in today
          const empIds = employees.map((e: any) => e.id);
          const { data: checkedIn } = await supabase
            .from('hrm_attendance')
            .select('"employeeId"')
            .eq('date', today)
            .in('"employeeId"', empIds);
          const checkedInIds = new Set((checkedIn || []).map((a: any) => a.employeeId));

          // Check who has leave today
          const { data: onLeave } = await supabase
            .from('hrm_leave_requests')
            .select('"employeeId"')
            .eq('status', 'approved')
            .lte('"startDate"', today)
            .gte('"endDate"', today);
          const leaveIds = new Set((onLeave || []).map((l: any) => l.employeeId));

          // Send reminder to employees who haven't checked in and aren't on leave
          for (const emp of employees) {
            if (checkedInIds.has(emp.id) || leaveIds.has(emp.id)) continue;
            const alertId = `attendance_${emp.id}_${today}`;
            if (!isNew('attendance', alertId)) continue;
            if (!emp.user_id) continue;

            await createNotification({
              userId: emp.user_id,
              type: 'warning',
              category: 'attendance',
              title: '⏰ Nhắc nhở chấm công',
              message: `Còn ${checkInMin - currentTimeMin} phút nữa là đến giờ chấm công (${loc.checkInTime}) tại ${loc.name}. Hãy chấm công đúng giờ nhé!`,
              severity: 'warning',
              icon: '⏰',
              link: '/hrm/attendance',
              sourceType: 'attendance',
              sourceId: alertId,
              metadata: { employeeId: emp.id, location: loc.name, checkInTime: loc.checkInTime },
            });
            alertCount++;
          }
        }
      }
    } catch (err) {
      console.error('Attendance reminder check error:', err);
    }

    // 6. 📝 Labor contract expiring within 30 days
    try {
      const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data: contracts } = await supabase
        .from('hrm_labor_contracts')
        .select('id, "employeeId", "contractNumber", "endDate", type')
        .eq('status', 'active')
        .lte('"endDate"', in30Days)
        .gte('"endDate"', today);

      if (contracts && contracts.length > 0) {
        const empIds = contracts.map((c: any) => c.employeeId);
        const { data: emps } = await supabase.from('employees').select('id, full_name').in('id', empIds);
        const empMap = new Map((emps || []).map((e: any) => [e.id, e.full_name]));

        for (const c of contracts) {
          const alertId = `contract_expiry_${c.id}`;
          if (!isNew('hrm', alertId)) continue;
          const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          const empName = empMap.get(c.employeeId) || 'N/A';
          await createNotification({
            type: daysLeft <= 7 ? 'error' : 'warning',
            category: 'hrm',
            title: daysLeft <= 7 ? '🚨 Hợp đồng LĐ sắp hết hạn!' : '📝 Hợp đồng LĐ cần gia hạn',
            message: `${empName} — HĐ ${c.contractNumber || c.type}: còn ${daysLeft} ngày (hết hạn ${c.endDate})`,
            severity: daysLeft <= 7 ? 'critical' : 'warning',
            icon: '📝',
            link: '/hrm/labor-contracts',
            sourceType: 'hrm',
            sourceId: alertId,
            metadata: { contractId: c.id, employeeId: c.employeeId, daysLeft, endDate: c.endDate },
          });
          alertCount++;
        }
      }
    } catch (err) {
      console.error('Contract expiry check error:', err);
    }

    // 7. ⚠️ Overdue requests — request_instances past due_date
    try {
      const { data: overdueReqs } = await supabase
        .from('request_instances')
        .select('id, code, title, due_date, status')
        .in('status', ['pending', 'in_progress', 'draft'])
        .not('due_date', 'is', null)
        .lt('due_date', today);

      for (const req of (overdueReqs || [])) {
        const alertId = `request_overdue_${req.id}`;
        if (!isNew('system', alertId)) continue;
        const daysOverdue = Math.ceil((Date.now() - new Date(req.due_date).getTime()) / (24 * 60 * 60 * 1000));
        await createNotification({
          type: daysOverdue > 7 ? 'error' : 'warning',
          category: 'system',
          title: '⚠️ Yêu cầu quá hạn',
          message: `${req.code || 'YC'} — ${req.title || 'Không tiêu đề'}: quá hạn ${daysOverdue} ngày`,
          severity: daysOverdue > 7 ? 'critical' : 'warning',
          icon: '⚠️',
          link: '/rq',
          sourceType: 'system',
          sourceId: alertId,
          metadata: { requestId: req.id, daysOverdue, dueDate: req.due_date },
        });
        alertCount++;
      }
    } catch (err) {
      console.error('Overdue request alert error:', err);
    }

    // 9. 🎂 Employee birthday today
    try {
      const now = new Date();
      const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const { data: allEmployees } = await supabase
        .from('employees')
        .select('id, full_name, date_of_birth')
        .eq('status', 'Đang làm việc')
        .not('date_of_birth', 'is', null);

      for (const emp of (allEmployees || [])) {
        if (!emp.date_of_birth) continue;
        const dob = emp.date_of_birth.slice(5); // MM-DD
        if (dob === monthDay) {
          const alertId = `birthday_${emp.id}_${today}`;
          if (!isNew('hrm', alertId)) continue;
          await createNotification({
            type: 'info',
            category: 'hrm',
            title: '🎂 Sinh nhật nhân viên',
            message: `Hôm nay là sinh nhật ${emp.full_name}! Hãy gửi lời chúc mừng nhé 🎉`,
            severity: 'info',
            icon: '🎂',
            link: '/hrm/employees',
            sourceType: 'hrm',
            sourceId: alertId,
            metadata: { employeeId: emp.id, birthday: emp.date_of_birth },
          });
          alertCount++;
        }
      }
    } catch (err) {
      console.error('Birthday alert error:', err);
    }

    // 10. 💰 Missing payroll for current month
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      // Only check after the 25th of the month (payroll should be ready)
      if (now.getDate() >= 25) {
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
          const alertId = `payroll_missing_${currentYear}_${currentMonth}`;
          if (isNew('hrm', alertId)) {
            const names = missingPayroll.slice(0, 3).map((e: any) => e.full_name).join(', ');
            const extra = missingPayroll.length > 3 ? ` và ${missingPayroll.length - 3} NV khác` : '';
            await createNotification({
              type: 'warning',
              category: 'hrm',
              title: '💰 Chưa tính lương tháng này',
              message: `${missingPayroll.length} nhân viên chưa có bảng lương T${currentMonth}/${currentYear}: ${names}${extra}`,
              severity: 'warning',
              icon: '💰',
              link: '/hrm/payroll',
              sourceType: 'hrm',
              sourceId: alertId,
              metadata: { month: currentMonth, year: currentYear, count: missingPayroll.length },
            });
            alertCount++;
          }
        }
      }
    } catch (err) {
      console.error('Payroll alert error:', err);
    }
    // 11. 📝 DailyLog submitted > 2 days without verification
    try {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleLogs } = await supabase
        .from('daily_logs')
        .select('id, date, construction_site_id')
        .eq('status', 'submitted')
        .lt('submitted_at', twoDaysAgo)
        .limit(20);

      for (const log of (staleLogs || [])) {
        const alertId = `dailylog_stale_${log.id}`;
        if (!isNew('progress', alertId)) continue;
        await createNotification({
          type: 'warning',
          category: 'progress',
          title: '📝 Nhật ký chờ xác nhận > 2 ngày',
          message: `Nhật ký ${log.date} tại ${getSiteName(log.construction_site_id)} chưa được xác nhận`,
          severity: 'warning',
          icon: '📝',
          link: '/da',
          sourceType: 'progress',
          sourceId: alertId,
          constructionSiteId: log.construction_site_id,
          metadata: { logId: log.id, date: log.date },
        });
        alertCount++;
      }
    } catch (err) {
      console.error('Stale dailylog check error:', err);
    }

    return alertCount;
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
