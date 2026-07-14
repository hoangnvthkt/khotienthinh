import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeChannel = {
  topic: string;
  subscribed: boolean;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  emit: (payload: { new: Record<string, unknown> }) => void;
};

const realtimeMocks = vi.hoisted(() => {
  const channels = new Map<string, FakeChannel>();
  const channel = vi.fn((topic: string) => {
    const existing = channels.get(topic);
    if (existing) return existing;

    let handler: ((payload: { new: Record<string, unknown> }) => void) | undefined;
    const created: FakeChannel = {
      topic,
      subscribed: false,
      on: vi.fn((type: string, _options: unknown, callback: (payload: { new: Record<string, unknown> }) => void) => {
        if (type === 'postgres_changes' && created.subscribed) {
          throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${topic}`);
        }
        handler = callback;
        return created;
      }),
      subscribe: vi.fn(() => {
        created.subscribed = true;
        return created;
      }),
      emit: (payload) => handler?.(payload),
    };
    channels.set(topic, created);
    return created;
  });
  const removeChannel = vi.fn(async (channelToRemove: FakeChannel) => {
    channels.delete(channelToRemove.topic);
    channelToRemove.subscribed = false;
    return 'ok';
  });

  return { channel, channels, removeChannel };
});

vi.mock('../supabase', () => ({
  supabase: {
    channel: realtimeMocks.channel,
    removeChannel: realtimeMocks.removeChannel,
  },
}));

import { notificationService } from '../notificationService';

describe('notificationService realtime subscriptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    realtimeMocks.channel.mockClear();
    realtimeMocks.removeChannel.mockClear();
    realtimeMocks.channels.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares the user channel during a desktop-to-mobile notification handoff', async () => {
    const desktopListener = vi.fn();
    const mobileListener = vi.fn();

    const stopDesktop = notificationService.subscribe(desktopListener, 'user-1') as unknown as () => void;
    const stopMobile = notificationService.subscribe(mobileListener, 'user-1') as unknown as () => void;

    const channel = realtimeMocks.channels.get('notifications:user-1');
    expect(realtimeMocks.channel).toHaveBeenCalledTimes(1);
    expect(channel?.on).toHaveBeenCalledTimes(1);
    expect(channel?.subscribe).toHaveBeenCalledTimes(1);

    channel?.emit({
      new: {
        id: 'notification-1',
        user_id: 'user-1',
        type: 'info',
        category: 'system',
        title: 'Thông báo kiểm thử',
        message: 'Đã chuyển breakpoint',
        is_read: false,
        is_dismissed: false,
        severity: 'info',
        metadata: {},
        created_at: '2026-07-14T00:00:00.000Z',
      },
    });

    expect(desktopListener).toHaveBeenCalledTimes(1);
    expect(mobileListener).toHaveBeenCalledTimes(1);

    stopDesktop();
    stopMobile();
    await vi.runAllTimersAsync();
    expect(realtimeMocks.removeChannel).toHaveBeenCalledWith(channel);
  });
});
