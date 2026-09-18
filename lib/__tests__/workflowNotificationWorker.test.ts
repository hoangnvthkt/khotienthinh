import { describe, expect, it } from 'vitest';
import { runWorkflowNotificationWorker } from '../../supabase/functions/process-workflow-notifications/worker';

type RpcResult = { data?: unknown; error?: unknown };

describe('Workflow notification worker', () => {
  it('clamps the claim limit and delivers every claimed item', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>): Promise<RpcResult> => {
        calls.push({ name, args });
        if (name === 'claim_workflow_notification_outbox') {
          return { data: { enabled: true, items: [{ id: 'one' }, { id: 'two' }] } };
        }
        return { data: { status: 'DELIVERED', delivered: 1 } };
      },
    };

    await expect(runWorkflowNotificationWorker(client, 500)).resolves.toMatchObject({
      enabled: true,
      claimed: 2,
      delivered: 2,
      failed: 0,
    });
    expect(calls[0]).toEqual({
      name: 'claim_workflow_notification_outbox',
      args: { p_limit: 50 },
    });
  });

  it('records one item failure and continues with later items', async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>): Promise<RpcResult> => {
        calls.push(`${name}:${String(args?.p_outbox_id || '')}`);
        if (name === 'claim_workflow_notification_outbox') {
          return { data: { enabled: true, items: [{ id: 'bad' }, { id: 'good' }] } };
        }
        if (name === 'deliver_workflow_notification' && args?.p_outbox_id === 'bad') {
          return { error: new Error('delivery failed') };
        }
        return { data: { status: 'DELIVERED', delivered: 1 } };
      },
    };

    await expect(runWorkflowNotificationWorker(client, 2)).resolves.toMatchObject({
      enabled: true,
      claimed: 2,
      delivered: 1,
      failed: 1,
    });
    expect(calls).toEqual([
      'claim_workflow_notification_outbox:',
      'deliver_workflow_notification:bad',
      'fail_workflow_notification_outbox:bad',
      'deliver_workflow_notification:good',
    ]);
  });

  it('does not deliver when the database gate is disabled', async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string): Promise<RpcResult> => {
        calls.push(name);
        return { data: { enabled: false, items: [] } };
      },
    };

    await expect(runWorkflowNotificationWorker(client, 0)).resolves.toEqual({
      enabled: false,
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(calls).toEqual(['claim_workflow_notification_outbox']);
  });
});
