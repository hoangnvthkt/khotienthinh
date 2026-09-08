import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeWorkInvalidation } from '../work/workRealtime';

afterEach(() => vi.useRealTimers());
describe('Work invalidation', () => {
  it('opens no channel when disabled', () => {
    const client = { channel: vi.fn(), removeChannel: vi.fn() };
    subscribeWorkInvalidation(client as any, vi.fn(), { enabled: false })();
    expect(client.channel).not.toHaveBeenCalled();
  });
  it('coalesces revision signals, refreshes after reconnect/focus and cleans up', () => {
    vi.useFakeTimers();
    const eventTarget = new EventTarget(); const onInvalidate = vi.fn();
    const changes = new Map<string, (payload: any) => void>(); let status: (state: string) => void = () => {};
    const channel = { on: vi.fn((_kind, filter, callback) => { changes.set(filter.table, callback); return channel; }), subscribe: vi.fn(callback => { status = callback; return channel; }) };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
    const taskId = '11111111-1111-4111-8111-111111111111';
    const actorId = '22222222-2222-4222-8222-222222222222';
    const stop = subscribeWorkInvalidation(client as any, onInvalidate, { enabled: true, taskId, actorId, eventTarget });
    status('SUBSCRIBED'); expect(onInvalidate).toHaveBeenCalledWith({ reason: 'refresh', taskId });
    const taskChange = changes.get('work_task_revisions')!;
    taskChange({ new: { task_id: taskId, title: 'Never trust payload content' } }); taskChange({ new: { task_id: taskId } });
    vi.advanceTimersByTime(250);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate).toHaveBeenLastCalledWith({ reason: 'revision', taskId });
    changes.get('work_workspace_user_revisions')!({ new: { user_id: actorId, revision: 2 } });
    expect(onInvalidate).toHaveBeenLastCalledWith({ reason: 'access_revision' });
    eventTarget.dispatchEvent(new Event('focus')); expect(onInvalidate).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(30_000); expect(onInvalidate).toHaveBeenCalledTimes(5);
    stop(); eventTarget.dispatchEvent(new Event('focus')); status('CLOSED'); vi.advanceTimersByTime(60_000);
    expect(onInvalidate).toHaveBeenCalledTimes(5); expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
