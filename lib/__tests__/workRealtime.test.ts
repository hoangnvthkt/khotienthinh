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
    let change: (payload: any) => void = () => {}; let status: (state: string) => void = () => {};
    const channel = { on: vi.fn((_kind, _filter, callback) => { change = callback; return channel; }), subscribe: vi.fn(callback => { status = callback; return channel; }) };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
    const taskId = '11111111-1111-4111-8111-111111111111';
    const stop = subscribeWorkInvalidation(client as any, onInvalidate, { enabled: true, taskId, eventTarget });
    status('SUBSCRIBED'); expect(onInvalidate).toHaveBeenCalledWith({ reason: 'refresh', taskId });
    change({ new: { task_id: taskId, title: 'Never trust payload content' } }); change({ new: { task_id: taskId } });
    vi.advanceTimersByTime(250);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate).toHaveBeenLastCalledWith({ reason: 'revision', taskId });
    eventTarget.dispatchEvent(new Event('focus')); expect(onInvalidate).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000); expect(onInvalidate).toHaveBeenCalledTimes(4);
    stop(); eventTarget.dispatchEvent(new Event('focus')); status('CLOSED'); vi.advanceTimersByTime(60_000);
    expect(onInvalidate).toHaveBeenCalledTimes(4); expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
