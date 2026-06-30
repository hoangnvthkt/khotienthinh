import { Role } from '../types';
import { supabase } from './supabase';
import type { ProjectPermissionCode } from './projectStaffService';

export type AlertRuleKey =
  | 'budget_overrun'
  | 'overdue_payment'
  | 'material_waste'
  | 'slow_progress'
  | 'attendance_reminder'
  | 'contract_expiry'
  | 'overdue_request'
  | 'employee_birthday'
  | 'missing_payroll'
  | 'stale_daily_log'
  | 'safety_critical';

export type AlertRecipientMode =
  | 'admin'
  | 'roles'
  | 'module_admins'
  | 'users'
  | 'project_permission'
  | 'employee_owner'
  | 'broadcast';

export interface AlertRecipientConfig {
  mode: AlertRecipientMode;
  roles?: Role[];
  moduleKeys?: string[];
  userIds?: string[];
  projectPermissionCodes?: ProjectPermissionCode[];
  includeAdmins?: boolean;
  fallbackToAdmin?: boolean;
}

export interface AlertRuleChannels {
  inApp: boolean;
  webPush: boolean;
}

export interface NotificationAlertRule {
  id?: string;
  alertKey: AlertRuleKey;
  label: string;
  description?: string;
  category: string;
  isEnabled: boolean;
  thresholds: Record<string, number>;
  cooldownMinutes: number;
  recipientConfig: AlertRecipientConfig;
  channels: AlertRuleChannels;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AlertHistoryItem {
  id: string;
  userId?: string | null;
  title: string;
  message: string;
  category: string;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata: Record<string, any>;
  createdAt: string;
}

export const DEFAULT_ALERT_RULES: NotificationAlertRule[] = [
  {
    alertKey: 'budget_overrun',
    label: 'Ngân sách vượt/sắp vượt',
    description: 'Cảnh báo khi chi phí dự án đạt ngưỡng hoặc vượt giá trị hợp đồng.',
    category: 'budget',
    isEnabled: true,
    thresholds: { warningPercent: 90, criticalPercent: 100 },
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'project_permission', projectPermissionCodes: ['confirm', 'approve'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'overdue_payment',
    label: 'Thanh toán quá hạn',
    description: 'Cảnh báo lịch thanh toán đã quá hạn.',
    category: 'payment',
    isEnabled: true,
    thresholds: {},
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'project_permission', projectPermissionCodes: ['confirm', 'approve'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'material_waste',
    label: 'Hao hụt vật tư vượt định mức',
    description: 'Cảnh báo vật tư có tỷ lệ hao hụt vượt ngưỡng cấu hình.',
    category: 'material',
    isEnabled: true,
    thresholds: {},
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'project_permission', projectPermissionCodes: ['confirm', 'approve'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'slow_progress',
    label: 'Tiến độ chậm',
    description: 'Cảnh báo công trình đang thi công nhưng tiến độ thấp hơn ngưỡng.',
    category: 'progress',
    isEnabled: true,
    thresholds: { minProgressPercent: 30 },
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'project_permission', projectPermissionCodes: ['edit', 'confirm', 'approve'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'attendance_reminder',
    label: 'Nhắc chấm công',
    description: 'Nhắc cá nhân chưa chấm công trước giờ vào làm.',
    category: 'attendance',
    isEnabled: true,
    thresholds: { minutesBefore: 5 },
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'employee_owner', fallbackToAdmin: false },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'contract_expiry',
    label: 'Hợp đồng lao động sắp hết hạn',
    description: 'Cảnh báo HRM khi hợp đồng lao động sắp hết hạn.',
    category: 'hrm',
    isEnabled: true,
    thresholds: { daysBeforeWarning: 30, criticalDays: 7 },
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'module_admins', moduleKeys: ['HRM'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'overdue_request',
    label: 'Yêu cầu quá hạn',
    description: 'Cảnh báo phiếu yêu cầu quá hạn xử lý.',
    category: 'system',
    isEnabled: true,
    thresholds: {},
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'module_admins', moduleKeys: ['RQ'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'employee_birthday',
    label: 'Sinh nhật nhân viên',
    description: 'Thông báo sinh nhật nhân viên trong ngày cho nhóm HRM/Admin.',
    category: 'hrm',
    isEnabled: true,
    thresholds: {},
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'module_admins', moduleKeys: ['HRM'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: false },
  },
  {
    alertKey: 'missing_payroll',
    label: 'Chưa tính lương tháng này',
    description: 'Cảnh báo HRM khi sau ngày 25 vẫn còn nhân viên chưa có bảng lương.',
    category: 'hrm',
    isEnabled: true,
    thresholds: { startDay: 25 },
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'module_admins', moduleKeys: ['HRM'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'stale_daily_log',
    label: 'Nhật ký chờ xác nhận quá lâu',
    description: 'Cảnh báo nhật ký đã gửi nhưng quá hạn xác nhận.',
    category: 'progress',
    isEnabled: true,
    thresholds: { daysPending: 2 },
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'project_permission', projectPermissionCodes: ['verify'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
  {
    alertKey: 'safety_critical',
    label: 'Sự cố an toàn nghiêm trọng',
    description: 'Cảnh báo sự cố an toàn critical cho nhóm phụ trách dự án/Admin.',
    category: 'safety',
    isEnabled: true,
    thresholds: {},
    cooldownMinutes: 1440,
    recipientConfig: { mode: 'project_permission', projectPermissionCodes: ['confirm', 'approve'], includeAdmins: true, fallbackToAdmin: true },
    channels: { inApp: true, webPush: true },
  },
];

const DEFAULT_RULE_BY_KEY = new Map(DEFAULT_ALERT_RULES.map(rule => [rule.alertKey, rule]));

const normalizeChannels = (value: any, fallback: AlertRuleChannels): AlertRuleChannels => ({
  inApp: value?.inApp ?? value?.in_app ?? fallback.inApp,
  webPush: value?.webPush ?? value?.web_push ?? fallback.webPush,
});

const normalizeRecipientConfig = (value: any, fallback: AlertRecipientConfig): AlertRecipientConfig => ({
  ...fallback,
  ...(value || {}),
  roles: Array.isArray(value?.roles) ? value.roles : fallback.roles,
  moduleKeys: Array.isArray(value?.moduleKeys) ? value.moduleKeys : Array.isArray(value?.module_keys) ? value.module_keys : fallback.moduleKeys,
  userIds: Array.isArray(value?.userIds) ? value.userIds : Array.isArray(value?.user_ids) ? value.user_ids : fallback.userIds,
  projectPermissionCodes: Array.isArray(value?.projectPermissionCodes)
    ? value.projectPermissionCodes
    : Array.isArray(value?.project_permission_codes)
      ? value.project_permission_codes
      : fallback.projectPermissionCodes,
});

export const normalizeAlertRule = (row: any): NotificationAlertRule => {
  const alertKey = (row.alert_key || row.alertKey) as AlertRuleKey;
  const fallback = DEFAULT_RULE_BY_KEY.get(alertKey) || DEFAULT_ALERT_RULES[0];

  return {
    id: row.id,
    alertKey,
    label: row.label || fallback.label,
    description: row.description || fallback.description,
    category: row.category || fallback.category,
    isEnabled: row.is_enabled ?? row.isEnabled ?? fallback.isEnabled,
    thresholds: { ...fallback.thresholds, ...(row.thresholds || {}) },
    cooldownMinutes: Number(row.cooldown_minutes ?? row.cooldownMinutes ?? fallback.cooldownMinutes),
    recipientConfig: normalizeRecipientConfig(row.recipient_config || row.recipientConfig, fallback.recipientConfig),
    channels: normalizeChannels(row.channels, fallback.channels),
    updatedBy: row.updated_by ?? row.updatedBy,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
};

export const mergeAlertRules = (rows: any[] = []): NotificationAlertRule[] => {
  const byKey = new Map(DEFAULT_ALERT_RULES.map(rule => [rule.alertKey, rule]));
  for (const row of rows) {
    const normalized = normalizeAlertRule(row);
    byKey.set(normalized.alertKey, normalized);
  }
  return DEFAULT_ALERT_RULES.map(rule => byKey.get(rule.alertKey) || rule);
};

export const getDefaultAlertRule = (alertKey: AlertRuleKey): NotificationAlertRule =>
  DEFAULT_RULE_BY_KEY.get(alertKey) || DEFAULT_ALERT_RULES[0];

export const notificationAlertRuleService = {
  async list(): Promise<NotificationAlertRule[]> {
    const { data, error } = await supabase
      .from('notification_alert_rules')
      .select('*')
      .order('category', { ascending: true })
      .order('label', { ascending: true });
    if (error) {
      console.warn('notification alert rules load failed:', error);
      return DEFAULT_ALERT_RULES;
    }
    return mergeAlertRules(data || []);
  },

  async update(rule: NotificationAlertRule, updatedBy?: string): Promise<void> {
    const { error } = await supabase
      .from('notification_alert_rules')
      .upsert({
        alert_key: rule.alertKey,
        label: rule.label,
        description: rule.description || null,
        category: rule.category,
        is_enabled: rule.isEnabled,
        thresholds: rule.thresholds || {},
        cooldown_minutes: Math.max(0, Number(rule.cooldownMinutes || 0)),
        recipient_config: rule.recipientConfig || { mode: 'admin', fallbackToAdmin: true },
        channels: rule.channels || { inApp: true, webPush: true },
        updated_by: updatedBy || null,
      }, { onConflict: 'alert_key' });
    if (error) throw error;
  },

  async listHistory(limit = 50): Promise<AlertHistoryItem[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, title, message, category, source_type, source_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;

    return (data || [])
      .filter((row: any) => !row.user_id || row.metadata?.alertKey)
      .slice(0, limit)
      .map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        message: row.message,
        category: row.category,
        sourceType: row.source_type,
        sourceId: row.source_id,
        metadata: row.metadata || {},
        createdAt: row.created_at,
      }));
  },
};
