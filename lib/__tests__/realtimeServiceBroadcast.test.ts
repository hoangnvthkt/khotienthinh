import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const channels: any[] = [];
  const makeChannel = (name: string, options?: any) => {
    const channel: any = {
      name,
      options,
      handlers: [] as Array<{ kind: string; filter: any; cb: (payload: any) => void }>,
      on: vi.fn((kind: string, filter: any, cb: (payload: any) => void) => { channel.handlers.push({ kind, filter, cb }); return channel; }),
      subscribe: vi.fn((cb?: (status: string) => void) => { channel.statusCb = cb; return channel; }),
    };
    channels.push(channel);
    return channel;
  };
  return {
    channels,
    channel: vi.fn((name: string, options?: any) => makeChannel(name, options)),
    removeChannel: vi.fn(),
    rpc: vi.fn(),
    setAuth: vi.fn(async () => undefined),
  };
});

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { channel: mocks.channel, removeChannel: mocks.removeChannel, rpc: mocks.rpc, realtime: { setAuth: mocks.setAuth } },
}));

(globalThis as any).document = Object.assign(new EventTarget(), { visibilityState: 'visible' });

import { realtimeService } from '../realtimeService';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const byName = (name: string) => mocks.channels.find(channel => channel.name === name);
const tablesOf = (channel: any) => channel.handlers.filter((h: any) => h.kind === 'postgres_changes').map((h: any) => h.filter.table).sort();

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.channels.length = 0;
  mocks.channel.mockClear();
  mocks.rpc.mockReset();
  mocks.setAuth.mockClear();
});

afterEach(() => {
  realtimeService.reset();
  vi.restoreAllMocks();
});

describe('realtimeService: Broadcast theo kênh cho bảng Kho ghi nhiều', () => {
  it('bảng Broadcast vào kênh private theo RPC, bảng khác vẫn postgres_changes', async () => {
    mocks.rpc.mockResolvedValue({ data: ['wms:act:all', 'wms:items', 'wms:tx:anywh', 'wms:tx:own:u1'], error: null });
    const onTx = vi.fn();
    realtimeService.on('transactions', onTx);

    realtimeService.connect(['transactions', 'warehouses', 'app_settings']);
    await flush();

    expect(tablesOf(byName('realtime-all'))).toEqual(['app_settings', 'warehouses']);
    expect(mocks.rpc).toHaveBeenCalledWith('wms_realtime_topics_v1');
    expect(mocks.setAuth).toHaveBeenCalled();
    // chỉ kênh của bảng đã yêu cầu (transactions), không vào wms:items / wms:act:*
    const topics = mocks.channels.filter(channel => channel.name.startsWith('wms:')).map(channel => channel.name).sort();
    expect(topics).toEqual(['wms:tx:anywh', 'wms:tx:own:u1']);
    expect(byName('wms:tx:anywh').options).toEqual({ config: { private: true } });

    const broadcast = byName('wms:tx:anywh').handlers.find((h: any) => h.kind === 'broadcast');
    broadcast.cb({ payload: { table: 'transactions', eventType: 'UPDATE', new: { id: 't1', status: 'APPROVED' }, old: { id: 't1' } } });
    expect(onTx).toHaveBeenCalledTimes(1);
    expect(onTx.mock.calls[0][0]).toMatchObject({ table: 'transactions', eventType: 'UPDATE', newRecord: { id: 't1' }, oldRecord: { id: 't1' } });

    // payload lạ bị bỏ qua
    broadcast.cb({ payload: { table: 'users', eventType: 'UPDATE', new: {} } });
    broadcast.cb({ payload: { table: 'transactions', eventType: 'PING' } });
    expect(onTx).toHaveBeenCalledTimes(1);
  });

  it('RPC lỗi → quay về postgres_changes cho đúng các bảng đó', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    realtimeService.connect(['transactions', 'items', 'warehouses']);
    await flush();

    expect(tablesOf(byName('realtime-all'))).toEqual(['warehouses']);
    expect(tablesOf(byName('realtime-wms-fallback'))).toEqual(['items', 'transactions']);
    expect(mocks.channels.some(channel => channel.name.startsWith('wms:'))).toBe(false);
  });

  it('kênh báo CHANNEL_ERROR → quay về postgres_changes một lần', async () => {
    mocks.rpc.mockResolvedValue({ data: ['wms:tx:anywh', 'wms:tx:nowh'], error: null });
    realtimeService.connect(['transactions']);
    await flush();

    byName('wms:tx:anywh').statusCb('CHANNEL_ERROR');
    byName('wms:tx:nowh').statusCb('CHANNEL_ERROR');
    const fallbacks = mocks.channels.filter(channel => channel.name === 'realtime-wms-fallback');
    expect(fallbacks).toHaveLength(1);
    expect(tablesOf(fallbacks[0])).toEqual(['transactions']);
  });

  it('không có kênh nào được phép → không nghe gì (đúng như RLS)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    realtimeService.connect(['transactions', 'warehouses']);
    await flush();
    expect(mocks.channels.map(channel => channel.name)).toEqual(['realtime-all']);
    expect(mocks.setAuth).not.toHaveBeenCalled();
  });
});
