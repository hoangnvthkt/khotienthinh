import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  nextResult: { data: null as any[] | null, error: null as any },
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: supabaseMocks.from, rpc: vi.fn() },
}));

import { projectWeeklyProgressService } from '../projectWeeklyProgressService';

const makeQuery = () => {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    lt: vi.fn(() => query),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => supabaseMocks.nextResult),
  };
  return query;
};

describe('projectWeeklyProgressService strict reads', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.from.mockImplementation(() => makeQuery());
  });

  it('propagates a daily period row read failure instead of returning an empty ready draft', async () => {
    const readStrict = (projectWeeklyProgressService as any).listDailyByWeekStrict;
    expect(readStrict).toBeTypeOf('function');
    if (typeof readStrict !== 'function') return;
    supabaseMocks.nextResult = { data: null, error: new Error('daily read failed') };

    await expect(readStrict('project-1_site-1', '2026-08-03'))
      .rejects.toThrow('daily read failed');
  });

  it('propagates a weekly draft read failure instead of returning empty rows', async () => {
    const readStrict = (projectWeeklyProgressService as any).listLatestAtOrBeforeStrict;
    expect(readStrict).toBeTypeOf('function');
    if (typeof readStrict !== 'function') return;
    supabaseMocks.nextResult = { data: null, error: new Error('weekly read failed') };

    await expect(readStrict('project-1_site-1', '2026-08-03'))
      .rejects.toThrow('weekly read failed');
  });
});
