export interface WorkPushJob {
  id: string;
  leaseToken: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: Record<string, unknown>;
}
interface WorkerClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
}
export type PushOutcome = 'sent' | 'retry' | 'gone' | 'failed';
export const isAllowedPushEndpoint = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (
      url.hostname === 'fcm.googleapis.com' || url.hostname === 'web.push.apple.com'
      || url.hostname.endsWith('.push.services.mozilla.com') || url.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
};
export const pushOutcome = (error: unknown): PushOutcome => {
  const status = Number((error as { statusCode?: unknown } | null)?.statusCode);
  if (status === 404 || status === 410) return 'gone';
  if (!status || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'failed';
};
export async function runWorkNotificationWorker(client: WorkerClient, send: (job: WorkPushJob) => Promise<unknown>, limit = 20) {
  const bounded = Math.min(20, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 20));
  const processed = await client.rpc('process_work_notifications', { p_limit: bounded });
  if (processed.error) throw new Error('WORK_OUTBOX_PROCESS_FAILED');
  if (!(processed.data as { enabled?: boolean } | null)?.enabled) return { enabled: false };
  const claimed = await client.rpc('claim_work_push', { p_limit: bounded });
  if (claimed.error || !Array.isArray(claimed.data)) throw new Error('WORK_PUSH_CLAIM_FAILED');
  const jobs = claimed.data as WorkPushJob[];
  const counts = { sent: 0, retry: 0, gone: 0, failed: 0 };
  // Four concurrent sends, each with a five-second transport timeout, stay below
  // the two-minute DB lease. Stable notification tags collapse ambiguous retries.
  for (let offset = 0; offset < jobs.length; offset += 4) {
    const outcomes = await Promise.allSettled(jobs.slice(offset, offset + 4).map(async job => {
      let outcome: PushOutcome = 'failed';
      if (isAllowedPushEndpoint(job.subscription.endpoint)) {
        try { await send(job); outcome = 'sent'; } catch (error) { outcome = pushOutcome(error); }
      }
      const settled = await client.rpc('finish_work_push', { p_job_id: job.id, p_lease_token: job.leaseToken, p_outcome: outcome });
      if (settled.error) throw new Error('WORK_PUSH_ACK_FAILED');
      if (settled.data !== true) throw new Error('WORK_PUSH_LEASE_LOST');
      counts[outcome]++;
    }));
    const failure = outcomes.find(outcome => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  return { enabled: true, outbox: processed.data, claimed: jobs.length, ...counts };
}
