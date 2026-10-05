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

describe('procurement orders', () => {
  it('maps approval errors to plain Vietnamese', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PROCUREMENT_PO_APPROVER_INVALID', code: '22023' } });
    await expect(procurementInboxService.transitionOrder({ purchaseOrderId: 'po-1', expectedRowVersion: 1, action: 'submit', approverUserId: 'me' }))
      .rejects.toThrow('không phải người lập');
  });
  it('sends the order payload unchanged to the save RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { purchaseOrderId: 'po-1', poNumber: 'PO-1', rowVersion: 1, totalAmount: 10, lines: 1 }, error: null });
    const input = { vendorId: 'v1', vatRate: 8, items: [{ itemId: 'i1', unitPrice: 5, allocations: [{ sourceType: 'material_request' as const, sourceId: 'r1', lineId: 'l1', qty: 2 }] }] };
    await procurementInboxService.saveOrder(input);
    expect(rpc).toHaveBeenLastCalledWith('save_procurement_hub_po_v1', { p_input: input });
  });
});

describe('procurement inbox errors', () => {
  it('maps a denied view to a code the page can show as a permission state', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PROCUREMENT_VIEW_DENIED', code: '42501' } });
    await expect(procurementInboxService.list({})).rejects.toMatchObject({ code: 'PROCUREMENT_VIEW_DENIED' });
  });
});

describe('external module intake', () => {
  it('links requests and workflows without a project', () => {
    const source = { sourceId: 'source-id', projectId: null, constructionSiteId: null, periodType: null, periodStart: null };
    expect(procurementSourceLink({ ...source, sourceType: 'request' })).toBe('#/rq/source-id');
    expect(procurementSourceLink({ ...source, sourceType: 'workflow' })).toBe('#/wf/source-id');
  });
  it('never treats external snapshots or withdrawn demand as orderable', async () => {
    const { canOrderProcurementSource } = await import('../procurementInboxService');
    expect(canOrderProcurementSource({ sourceType: 'request', orderable: true })).toBe(false);
    expect(canOrderProcurementSource({ sourceType: 'workflow' })).toBe(false);
    expect(canOrderProcurementSource({ sourceType: 'material_request', intakeState: 'withdrawn' })).toBe(false);
    expect(canOrderProcurementSource({ sourceType: 'material_plan' })).toBe(true);
  });
  it('explains why external data cannot silently become a purchase order', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PROCUREMENT_SOURCE_REVIEW_REQUIRED' } });
    await expect(procurementInboxService.saveOrder({ vendorId: 'vendor', vatRate: 0, items: [] })).rejects.toThrow('quy cách và nơi nhận');
  });
});
