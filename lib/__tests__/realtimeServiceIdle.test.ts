import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const channels: any[] = [];
  const makeChannel = () => {
    const channel: any = {
      on: vi.fn(() => channel),
      subscribe: vi.fn((cb: (status: string) => void) => { channel.statusCb = cb; return channel; }),
    };
    channels.push(channel);
    return channel;
  };
  return {
    channels,
    channel: vi.fn(() => makeChannel()),
    removeChannel: vi.fn(),
  };
});

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { channel: mocks.channel, removeChannel: mocks.removeChannel },
}));

// Môi trường test là node: dựng document tối thiểu (visibilityState + sự kiện visibilitychange).
const fakeDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
(globalThis as any).document = fakeDocument;

import { realtimeService, REALTIME_IDLE_SUSPEND_MS } from '../realtimeService';

const setVisibility = (state: 'visible' | 'hidden') => {
  fakeDocument.visibilityState = state;
  fakeDocument.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  mocks.channels.length = 0;
  mocks.channel.mockClear();
  mocks.removeChannel.mockClear();
  fakeDocument.visibilityState = 'visible';
});

afterEach(() => {
  realtimeService.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('realtimeService: tab ẩn quá lâu thì tạm ngắt, hiện lại thì nối lại', () => {
  it('ngắt kênh sau 5 phút ẩn, nối lại đúng bảng cũ và báo onResume khi tab hiện', () => {
    const onResume = vi.fn();
    const statuses: string[] = [];
    realtimeService.onStatusChange(status => statuses.push(status));
    realtimeService.onResume(onResume);

    realtimeService.connect(['requests', 'warehouses']);
    mocks.channels[0].statusCb('SUBSCRIBED');
    expect(realtimeService.status).toBe('connected');
    expect(mocks.channels[0].on).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    vi.advanceTimersByTime(REALTIME_IDLE_SUSPEND_MS - 1);
    expect(realtimeService.isSuspended).toBe(false);
    expect(mocks.removeChannel).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(realtimeService.isSuspended).toBe(true);
    expect(realtimeService.status).toBe('disconnected');
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channels[0]);
    expect(onResume).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(realtimeService.isSuspended).toBe(false);
    expect(mocks.channel).toHaveBeenCalledTimes(2);
    const tables = mocks.channels[1].on.mock.calls.map((call: any[]) => call[1].table).sort();
    expect(tables).toEqual(['requests', 'warehouses']);
    expect(onResume).toHaveBeenCalledTimes(1);
    mocks.channels[1].statusCb('SUBSCRIBED');
    expect(realtimeService.status).toBe('connected');
    // connect() luôn disconnect() trước nên có 'disconnected' lặp; chỉ so chuỗi chuyển trạng thái.
    const transitions = statuses.filter((status, index) => status !== statuses[index - 1]);
    expect(transitions).toEqual(['disconnected', 'connecting', 'connected', 'disconnected', 'connecting', 'connected']);
  });

  it('tab hiện lại trước 5 phút thì không ngắt gì', () => {
    const onResume = vi.fn();
    realtimeService.onResume(onResume);
    realtimeService.connect(['warehouses']);
    mocks.channels[0].statusCb('SUBSCRIBED');

    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    setVisibility('visible');
    vi.advanceTimersByTime(REALTIME_IDLE_SUSPEND_MS);

    expect(mocks.removeChannel).not.toHaveBeenCalled();
    expect(realtimeService.status).toBe('connected');
    expect(onResume).not.toHaveBeenCalled();
  });

  it('đổi bảng khi đang tạm ngắt thì connect mới thắng, không báo onResume', () => {
    const onResume = vi.fn();
    realtimeService.onResume(onResume);
    realtimeService.connect(['warehouses']);
    mocks.channels[0].statusCb('SUBSCRIBED');
    setVisibility('hidden');
    vi.advanceTimersByTime(REALTIME_IDLE_SUSPEND_MS);
    expect(realtimeService.isSuspended).toBe(true);

    realtimeService.connect(['warehouses', 'requests']);
    expect(realtimeService.isSuspended).toBe(false);
    setVisibility('visible');
    expect(onResume).not.toHaveBeenCalled();
    expect(mocks.channel).toHaveBeenCalledTimes(2);
  });
});
