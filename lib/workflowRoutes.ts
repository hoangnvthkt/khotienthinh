export interface WorkflowRouteOptions {
  nodeId?: string;
  commentId?: string;
  eventKey?: string;
}

export const buildWorkflowRoute = (instanceId: string, options: WorkflowRouteOptions = {}): string => {
  const normalizedId = String(instanceId || '').trim();
  if (!normalizedId) throw new Error('Workflow instance id is required');

  const query = new URLSearchParams();
  if (options.nodeId) query.set('node', options.nodeId);
  if (options.commentId) query.set('comment', options.commentId);
  if (options.eventKey) query.set('event', options.eventKey);
  const queryString = query.toString();
  return `/wf/${encodeURIComponent(normalizedId)}${queryString ? `?${queryString}` : ''}`;
};

export const isWorkflowInstanceId = (value: string | null | undefined): value is string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
