import { describe, expect, it, vi } from 'vitest';
import { runWorkNotificationWorker, pushOutcome, isAllowedPushEndpoint } from '../../supabase/functions/process-work-notifications/worker';
import { resolveNotificationPath } from '../notificationRoutes';

describe('Work notification worker', () => {
  it('does not claim or send while the pilot gate is disabled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { enabled: false }, error: null });
    const send = vi.fn();
    expect(await runWorkNotificationWorker({ rpc }, send, 20)).toMatchObject({ enabled: false });
    expect(rpc).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
  });
  it('records each device outcome with its lease and keeps processing other devices', async () => {
    const jobs = [0, 1, 2].map(i => ({ id: `job${i}`, leaseToken: `lease${i}`, subscription: { endpoint: `https://fcm.googleapis.com/device${i}`, keys: {} }, payload: { tag: 'same-notification' } }));
    const rpc = vi.fn().mockImplementation(async (name: string) => ({ data: name === 'process_work_notifications' ? { enabled: true } : name === 'claim_work_push' ? jobs : true, error: null }));
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({ statusCode: 410 }).mockRejectedValueOnce({ statusCode: 503 });
    const result = await runWorkNotificationWorker({ rpc }, send, 20);
    expect(result).toMatchObject({ sent: 1, retry: 1, gone: 1 });
    for (const [i, outcome] of ['sent', 'gone', 'retry'].entries()) expect(rpc).toHaveBeenCalledWith('finish_work_push', { p_job_id: `job${i}`, p_lease_token: `lease${i}`, p_outcome: outcome });
  });
  it('does not report a delivery as settled when the completion write fails', async () => {
    const rpc = vi.fn().mockImplementation(async (name: string) => name === 'finish_work_push' ? { error: { message: 'db unavailable' } } : { data: name === 'process_work_notifications' ? { enabled: true } : [{ id: 'j', leaseToken: 'l', subscription: { endpoint: 'https://fcm.googleapis.com/x' }, payload: {} }] });
    await expect(runWorkNotificationWorker({ rpc }, vi.fn(), 1)).rejects.toThrow('WORK_PUSH_ACK_FAILED');
  });
  it('restricts transport destinations and classifies retries', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/a')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/a')).toBe(true);
    expect(isAllowedPushEndpoint('http://127.0.0.1/a')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.test/a')).toBe(false);
    expect(pushOutcome({ statusCode: 429 })).toBe('retry');
    expect(pushOutcome({ statusCode: 403 })).toBe('failed');
  });
  it('resolves Work before unrelated metadata and safely builds the comment URL', () => {
    expect(resolveNotificationPath({ sourceType: 'work_task', metadata: { taskCode: 'VW-2026-000001', commentId: 'a/b', dailyLogId: 'unrelated' } } as any)).toBe('/work/tasks/VW-2026-000001?comment=a%2Fb');
  });
});
