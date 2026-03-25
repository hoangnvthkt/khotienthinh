import { supabase } from './supabase';

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
  metadata: Record<string, any>;
  createdAt: string;
  expiresAt?: string;
}

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
  metadata: row.metadata || {},
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

export const NOTIFICATION_CATEGORIES = {
  budget: { label: 'Ngân sách', icon: '💰', color: 'text-orange-600 bg-orange-50' },
  payment: { label: 'Thanh toán', icon: '🧾', color: 'text-red-600 bg-red-50' },
  progress: { label: 'Tiến độ', icon: '📐', color: 'text-blue-600 bg-blue-50' },
  material: { label: 'Vật tư', icon: '📦', color: 'text-amber-600 bg-amber-50' },
  inventory: { label: 'Tồn kho', icon: '📋', color: 'text-cyan-600 bg-cyan-50' },
  contract: { label: 'Hợp đồng', icon: '📝', color: 'text-violet-600 bg-violet-50' },
  system: { label: 'Hệ thống', icon: '⚙️', color: 'text-slate-600 bg-slate-50' },
} as const;

// ── Throttle: only allow alert checks once per 15min across all tabs ──
const ALERT_CHECK_KEY = 'vioo_last_alert_check';
const ALERT_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

function shouldRunAlertCheck(): boolean {
  const last = localStorage.getItem(ALERT_CHECK_KEY);
  if (!last) return true;
  return Date.now() - parseInt(last) > ALERT_CHECK_INTERVAL;
}

function markAlertCheckDone(): void {
  localStorage.setItem(ALERT_CHECK_KEY, Date.now().toString());
}

// ── Helper: create notification (standalone function, no `this`) ──
async function createNotification(n: Omit<AppNotification, 'id' | 'isRead' | 'isDismissed' | 'createdAt'>): Promise<void> {
  await supabase.from('notifications').insert({
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
    metadata: n.metadata || {},
    expires_at: n.expiresAt || null,
  });
}

export const notificationService = {
  /** List notifications (recent first) */
  async list(userId?: string, limit = 50): Promise<AppNotification[]> {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (userId) query = query.or(`user_id.eq.${userId},user_id.is.null`);
    const { data } = await query;
    return (data || []).map(toCamel);
  },

  /** Count unread */
  async countUnread(userId?: string): Promise<number> {
    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
      .eq('is_dismissed', false);
    if (userId) query = query.or(`user_id.eq.${userId},user_id.is.null`);
    const { count } = await query;
    return count || 0;
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
      .from('payment_schedules').select('id, construction_site_id, title, status, due_date, amount');
    const { data: boqItems } = await supabase
      .from('material_budget_items').select('id, construction_site_id, name, waste_percent, waste_threshold');
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
            message: `${p.title || 'Phiếu thanh toán'} — ${getSiteName(p.construction_site_id)}: quá hạn ${p.due_date}`,
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
            message: `${b.name || 'Vật tư'} — ${getSiteName(b.construction_site_id)}: hao hụt ${wp.toFixed(1)}% (định mức ${wt}%)`,
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

    return alertCount;
  },

  /** Subscribe to realtime notifications */
  subscribe(callback: (n: AppNotification) => void) {
    return supabase
      .channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        callback(toCamel(payload.new));
      })
      .subscribe();
  },

  /** Unsubscribe */
  unsubscribe() {
    supabase.removeChannel(supabase.channel('notifications'));
  },
};
