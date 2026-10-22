import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { xpService } from '../xpService';

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

  it('no longer awards XP from the client (award_my_daily_xp is not deployed)', () => {
    expect(xpService).not.toHaveProperty('awardXP');
    expect(xpService).not.toHaveProperty('awardDailyXP');
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });
});
