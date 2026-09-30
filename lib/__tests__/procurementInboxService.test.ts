import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const { daysUntil, procurementInboxService, procurementSourceLink, urgencyOf } = await import('../procurementInboxService');

describe('procurement inbox urgency', () => {
  it('counts days against the server date and never invents a date', () => {
    expect(daysUntil('2026-09-28', '2026-09-30')).toBe(-2);
    expect(urgencyOf('2026-09-28', '2026-09-30')).toEqual({ label: 'Quá hạn 2 ngày', tone: 'overdue' });
    expect(urgencyOf('2026-09-30', '2026-09-30').label).toBe('Cần hôm nay');
    expect(urgencyOf('2026-10-02', '2026-09-30').tone).toBe('soon');
    expect(urgencyOf('2026-10-20', '2026-09-30').tone).toBe('normal');
    expect(urgencyOf(null, '2026-09-30')).toEqual({ label: 'Chưa có ngày cần', tone: 'none' });
  });
});

describe('procurement source links', () => {
  const base = { sourceId: 'r1', projectId: 'p1', constructionSiteId: 's1', periodType: null, periodStart: null };
  it('opens a site request on the project material tab', () => {
    expect(procurementSourceLink({ ...base, sourceType: 'material_request' }))
      .toBe('#/da?projectId=p1&siteId=s1&tab=material&materialTab=request&requestId=r1');
  });
  it('opens a material plan on its period', () => {
    expect(procurementSourceLink({ ...base, sourceType: 'material_plan', periodType: 'week', periodStart: '2026-10-05' }))
      .toBe('#/da?projectId=p1&siteId=s1&tab=work_plan&view=material&period=week&start=2026-10-05');
  });
  it('has no link without a project', () => {
    expect(procurementSourceLink({ ...base, projectId: null, sourceType: 'material_request' })).toBeNull();
  });
});

describe('procurement inbox errors', () => {
  it('maps a denied view to a code the page can show as a permission state', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PROCUREMENT_VIEW_DENIED', code: '42501' } });
    await expect(procurementInboxService.list({})).rejects.toMatchObject({ code: 'PROCUREMENT_VIEW_DENIED' });
  });
});
