import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryState = vi.hoisted(() => ({ limits: [] as number[], ors: [] as string[] }));

vi.mock('../supabase', () => ({
  supabase: {
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: (value: number) => {
          queryState.limits.push(value);
          return query;
        },
        or: (value: string) => {
          queryState.ors.push(value);
          return query;
        },
        then: (resolveQuery: (value: unknown) => void) => resolveQuery({
          data: [
            { id: 'b3', created_at: '2026-09-03T03:00:00.000Z' },
            { id: 'b2', created_at: '2026-09-03T02:00:00.000Z' },
            { id: 'b1', created_at: '2026-09-03T01:00:00.000Z' },
          ],
          error: null,
        }),
      };
      return query;
    },
    storage: { from: () => ({}) },
  },
}));

vi.mock('../hrmSensitiveProjectionService', () => ({
  hrmSensitiveProjectionService: { lookupEmployees: vi.fn(), listEmployees: vi.fn() },
}));

describe('operations query pagination', () => {
  beforeEach(() => {
    queryState.limits.length = 0;
    queryState.ors.length = 0;
  });

  it('uses limit plus one and a composite cursor for personal vehicle bookings', async () => {
    const { fetchMyBookingsPage } = await import('../vehicleBookingService');
    const page = await fetchMyBookingsPage('user-1', {
      limit: 2,
      cursor: { createdAt: '2026-09-03T04:00:00.000Z', id: 'b4' },
    });

    expect(queryState.limits).toContain(3);
    expect(queryState.ors[0]).toContain('created_at.lt.2026-09-03T04:00:00.000Z');
    expect(page.items.map(row => row.id)).toEqual(['b3', 'b2']);
    expect(page.nextCursor).toEqual({ createdAt: '2026-09-03T02:00:00.000Z', id: 'b2' });
  });

  it('keeps dispatcher availability reads inside an explicit time window and row cap', () => {
    const source = readFileSync(resolve(process.cwd(), 'pages/booking/DispatcherWorkbenchPage.tsx'), 'utf8');
    expect(source).toContain(".lt('reserved_start_at', rangeEnd)");
    expect(source).toContain(".gt('reserved_end_at', rangeStart)");
    expect(source.match(/\.limit\(1000\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
