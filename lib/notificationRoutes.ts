import type { AppNotification } from './notificationService';

const getMetaValue = (metadata: Record<string, any> | undefined, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = metadata?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return undefined;
};

const withQuery = (path: string, params: Record<string, string | undefined>): string => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
};

/**
 * Build a /da deep-link using projectId + siteId from metadata / notification fields.
 * Returns undefined when neither key is present.
 */
const buildProjectPath = (
  notification: AppNotification,
  tab?: string,
  extra?: Record<string, string | undefined>,
): string | undefined => {
  const metadata = notification.metadata || {};
  const projectId = getMetaValue(metadata, ['projectId', 'project_id']);
  const siteId =
    getMetaValue(metadata, ['constructionSiteId', 'construction_site_id']) ||
    notification.constructionSiteId;
  if (!projectId && !siteId) return undefined;
  return withQuery('/da', { projectId, siteId, tab, ...extra });
};

export const resolveNotificationPath = (notification: AppNotification): string | undefined => {
  const metadata = notification.metadata || {};
  const sourceType = notification.sourceType || '';

  // ── Daily Log ─────────────────────────────────────────
  const dailyLogId = getMetaValue(metadata, ['dailyLogId', 'logId']);
  if (dailyLogId || sourceType.startsWith('dailylog')) {
    return buildProjectPath(notification, 'dailylog', { dailyLogId }) || notification.link || '/da';
  }

  // ── Workflow ──────────────────────────────────────────
  const workflowInstanceId = getMetaValue(metadata, ['instanceId', 'workflowInstanceId']);
  if (workflowInstanceId || sourceType.startsWith('workflow')) {
    return withQuery('/wf', { instanceId: workflowInstanceId });
  }

  // ── Request instances (Yêu cầu / RQ module) ──────────
  if (sourceType.startsWith('rq') || sourceType === 'request') {
    const requestId = getMetaValue(metadata, ['requestId', 'request_instance_id', 'requestInstanceId']);
    return withQuery('/rq', { requestId });
  }

  // ── Material Request (Phiếu vật tư dự án) ────────────
  if (sourceType === 'material_request' || sourceType === 'material') {
    // Try deep-link to project material tab first
    const projectPath = buildProjectPath(notification, 'material', { materialTab: 'request' });
    if (projectPath) return projectPath;
    // Fallback to WMS operations page
    return '/operations';
  }

  // ── Purchase Order ────────────────────────────────────
  if (sourceType === 'purchase_order') {
    const projectPath = buildProjectPath(notification, 'material', { materialTab: 'supply-chain' });
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Task-related (assignment, gate, completion) ───────
  if (sourceType.startsWith('task_') || sourceType === 'gate_pending') {
    const projectPath = buildProjectPath(notification, 'gantt');
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── BOQ / Reconciliation ──────────────────────────────
  if (sourceType.startsWith('boq_')) {
    const projectPath = buildProjectPath(notification, 'material', { materialTab: 'boq' });
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Quantity Acceptance ────────────────────────────────
  if (sourceType === 'quantity_acceptance') {
    const projectPath = buildProjectPath(notification, 'acceptance');
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Quality Checklist ─────────────────────────────────
  if (sourceType === 'quality_checklist') {
    const projectPath = buildProjectPath(notification, 'quality');
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Feedback Hub ─────────────────────────────────────
  if (sourceType === 'feedback') {
    const feedbackId = getMetaValue(metadata, ['feedbackId', 'feedback_id']) || notification.sourceId;
    return withQuery('/feedback', { feedbackId });
  }

  // ── Payment Certificate ───────────────────────────────
  if (sourceType === 'payment_certificate') {
    const projectPath = buildProjectPath(notification, 'payment');
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Contract Variation ────────────────────────────────
  if (sourceType === 'contract_variation') {
    const projectPath = buildProjectPath(notification, 'contract');
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Budget / Progress / Payment alerts ────────────────
  if (sourceType === 'budget' || sourceType === 'progress' || sourceType === 'payment') {
    const projectPath = buildProjectPath(notification);
    if (projectPath) return projectPath;
    return notification.link || '/da';
  }

  // ── Inventory ─────────────────────────────────────────
  if (sourceType === 'inventory') {
    return notification.link || '/inventory';
  }

  // ── Attendance ────────────────────────────────────────
  if (sourceType === 'attendance') {
    return notification.link || '/hrm/attendance';
  }

  // ── HRM (contracts, payroll, birthday) ────────────────
  if (sourceType === 'hrm') {
    return notification.link || '/hrm/employees';
  }

  // ── Fallback: use notification.link, then undefined ───
  return notification.link || undefined;
};

export const toHashRoute = (path: string): string => {
  if (path.startsWith('#')) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `#${path.startsWith('/') ? path : `/${path}`}`;
};
