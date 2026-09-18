export type WorkflowNotificationRpcResult = {
  data?: unknown;
  error?: unknown;
};

export interface WorkflowNotificationRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<WorkflowNotificationRpcResult>;
}

export interface WorkflowNotificationWorkerResult {
  enabled: boolean;
  claimed: number;
  delivered: number;
  failed: number;
}

type ClaimedWorkflowNotification = { id: string };
type ClaimResult = { enabled?: boolean; items?: ClaimedWorkflowNotification[] };

const boundedLimit = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.min(50, Math.max(1, Math.trunc(numeric)));
};

const safeErrorMessage = (cause: unknown): string => {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) || 'WORKFLOW_NOTIFICATION_DELIVERY_FAILED';
};

export const runWorkflowNotificationWorker = async (
  client: WorkflowNotificationRpcClient,
  limit: unknown = 50,
): Promise<WorkflowNotificationWorkerResult> => {
  const claim = await client.rpc('claim_workflow_notification_outbox', { p_limit: boundedLimit(limit) });
  if (claim.error) throw new Error('WORKFLOW_NOTIFICATION_CLAIM_FAILED');

  const result = (claim.data || {}) as ClaimResult;
  if (!result.enabled) return { enabled: false, claimed: 0, delivered: 0, failed: 0 };
  const items = Array.isArray(result.items)
    ? result.items.filter(item => item && typeof item.id === 'string' && item.id)
    : [];

  let delivered = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const delivery = await client.rpc('deliver_workflow_notification', { p_outbox_id: item.id });
      if (delivery.error) throw delivery.error;
      delivered += 1;
    } catch (cause) {
      failed += 1;
      const failure = await client.rpc('fail_workflow_notification_outbox', {
        p_outbox_id: item.id,
        p_error_message: safeErrorMessage(cause),
      });
      if (failure.error) throw new Error('WORKFLOW_NOTIFICATION_FAILURE_RECORD_FAILED');
    }
  }
  return { enabled: true, claimed: items.length, delivered, failed };
};
