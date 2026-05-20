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

export const resolveNotificationPath = (notification: AppNotification): string | undefined => {
  const metadata = notification.metadata || {};
  const sourceType = notification.sourceType || '';

  const dailyLogId = getMetaValue(metadata, ['dailyLogId', 'logId']);
  if (dailyLogId || sourceType.startsWith('dailylog')) {
    const projectId = getMetaValue(metadata, ['projectId', 'project_id']);
    const siteId = getMetaValue(metadata, ['constructionSiteId', 'construction_site_id']) || notification.constructionSiteId;
    if (!projectId && !siteId) return notification.link || '/da';
    return withQuery('/da', {
      projectId,
      siteId,
      tab: 'dailylog',
      dailyLogId,
    });
  }

  const workflowInstanceId = getMetaValue(metadata, ['instanceId', 'workflowInstanceId']);
  if (workflowInstanceId || sourceType.startsWith('workflow')) {
    return withQuery('/wf', { instanceId: workflowInstanceId });
  }

  const requestId = getMetaValue(metadata, ['requestId', 'request_instance_id', 'requestInstanceId']);
  if (requestId || sourceType.startsWith('rq') || sourceType === 'request') {
    return withQuery('/rq', { requestId });
  }

  return notification.link || undefined;
};

export const toHashRoute = (path: string): string => {
  if (path.startsWith('#')) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `#${path.startsWith('/') ? path : `/${path}`}`;
};
