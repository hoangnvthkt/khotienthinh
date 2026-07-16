import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  configured: true,
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  get isSupabaseConfigured() {
    return supabaseMocks.configured;
  },
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  xpService,
  type DailyXPEventType,
  type XPAwardResult,
} from '../xpService';

const profileRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  total_xp: 15,
  level: 1,
  streak_days: 2,
  last_active_date: '2026-07-16',
  badges: [{
    id: 'first_login',
    name: 'Lần đầu',
    icon: '🎉',
    description: 'Đăng nhập lần đầu',
    earnedAt: '2026-07-15T00:00:00.000Z',
  }],
  created_at: '2026-07-15T00:00:00.000Z',
  updated_at: '2026-07-16T00:00:00.000Z',
};

const profileQuery = (response: { data: any; error: any }) => {
  const api: any = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    maybeSingle: vi.fn(async () => response),
    single: vi.fn(async () => response),
    insert: vi.fn(() => api),
  };
  return api;
};

describe('xpService daily RPC boundary', () => {
  beforeEach(() => {
    supabaseMocks.configured = true;
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('reads a profile with maybeSingle and never creates data during a read', async () => {
    const query = profileQuery({ data: profileRow, error: null });
    supabaseMocks.from.mockReturnValue(query);

    await expect(xpService.getProfile(profileRow.user_id)).resolves.toEqual({
      id: profileRow.id,
      userId: profileRow.user_id,
      totalXp: 15,
      level: 1,
      streakDays: 2,
      lastActiveDate: '2026-07-16',
      badges: profileRow.badges,
      createdAt: profileRow.created_at,
      updatedAt: profileRow.updated_at,
    });

    expect(supabaseMocks.from).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.from).toHaveBeenCalledWith('user_xp');
    expect(query.eq).toHaveBeenCalledWith('user_id', profileRow.user_id);
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
    expect(query.single).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
  });

  it('returns null when the authenticated user has no XP profile', async () => {
    const query = profileQuery({ data: null, error: null });
    supabaseMocks.from.mockReturnValue(query);

    await expect(xpService.getProfile(profileRow.user_id)).resolves.toBeNull();
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
    expect(query.insert).not.toHaveBeenCalled();
    expect(supabaseMocks.from).toHaveBeenCalledTimes(1);
  });

  it('propagates profile query errors without attempting an insert', async () => {
    const queryError = { code: '42501', message: 'permission denied' };
    const query = profileQuery({ data: null, error: queryError });
    supabaseMocks.from.mockReturnValue(query);

    await expect(xpService.getProfile(profileRow.user_id)).rejects.toBe(queryError);
    expect(query.insert).not.toHaveBeenCalled();
    expect(supabaseMocks.from).toHaveBeenCalledTimes(1);
  });

  it('awards only through award_my_daily_xp without client authority fields', async () => {
    const rpcResult: XPAwardResult = {
      awarded: true,
      xpGained: 10,
      profile: {
        id: profileRow.id,
        userId: profileRow.user_id,
        totalXp: 15,
        level: 1,
        streakDays: 2,
        lastActiveDate: '2026-07-16',
        badges: profileRow.badges,
        createdAt: profileRow.created_at,
        updatedAt: profileRow.updated_at,
      },
      newBadges: [],
    };
    supabaseMocks.rpc.mockResolvedValue({ data: rpcResult, error: null });

    await expect(xpService.awardDailyXP(
      'daily_checkin',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    )).resolves.toEqual(rpcResult);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('award_my_daily_xp', {
      p_event_type: 'daily_checkin',
      p_source_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(supabaseMocks.rpc.mock.calls[0][1]).toEqual({
      p_event_type: 'daily_checkin',
      p_source_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('sends null as the daily login source and propagates RPC failures', async () => {
    const rpcError = { code: '42501', message: 'not authenticated' };
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: rpcError });

    await expect(xpService.awardDailyXP('daily_login')).rejects.toBe(rpcError);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('award_my_daily_xp', {
      p_event_type: 'daily_login',
      p_source_id: null,
    });
  });

  it('rejects a successful RPC response that omits the required award result', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(xpService.awardDailyXP('daily_login')).rejects.toThrow(/award result/i);
  });

  it('makes zero Supabase calls for awards in unconfigured mock mode', async () => {
    supabaseMocks.configured = false;

    await expect(xpService.awardDailyXP('daily_login')).rejects.toThrow(/not configured/i);

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('exports only the two server-authoritative daily award event types', () => {
    expectTypeOf<DailyXPEventType>().toEqualTypeOf<'daily_login' | 'daily_checkin'>();
    expectTypeOf<Parameters<typeof xpService.awardDailyXP>[0]>()
      .toEqualTypeOf<DailyXPEventType>();
    expect(xpService).not.toHaveProperty('awardXP');
  });
});
