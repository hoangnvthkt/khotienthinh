import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
  },
}));

import { cashFundService } from '../cashFundService';

const query = (response: { data?: any; error?: any } = { data: [], error: null }) => {
  const api: any = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    order: vi.fn(() => Promise.resolve(response)),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return api;
};

describe('cashFundService', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
  });

  it('lists active cash funds and maps snake_case totals', async () => {
    const cashFundQuery = query({
      data: [{
        id: 'fund-1',
        name: 'Quỹ công trường A',
        currency: 'VND',
        opening_balance: 25_000_000,
        description: 'Quỹ tháng 7',
        is_active: true,
        created_at: '2026-07-01T00:00:00.000Z',
      }],
      error: null,
    });
    supabaseMocks.from.mockReturnValueOnce(cashFundQuery);

    const funds = await cashFundService.listActive();

    expect(supabaseMocks.from).toHaveBeenCalledWith('cash_funds');
    expect(cashFundQuery.eq).toHaveBeenCalledWith('is_active', true);
    expect(funds[0]).toMatchObject({
      id: 'fund-1',
      name: 'Quỹ công trường A',
      currency: 'VND',
      openingBalance: 25_000_000,
      isActive: true,
    });
  });

  it('returns an empty list when cash funds are not available in the environment', async () => {
    const cashFundQuery = query({ data: null, error: { code: '42P01' } });
    supabaseMocks.from.mockReturnValueOnce(cashFundQuery);

    await expect(cashFundService.listActive()).resolves.toEqual([]);
  });
});
