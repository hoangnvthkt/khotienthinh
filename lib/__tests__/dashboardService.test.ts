import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { fetchDashboard, fetchDashboardAccess, parseDashboard } from '../dashboard/dashboardService';

const SERVER = {
  generatedAt: '2026-10-09T15:20:00+07:00', today: '2026-10-09', access: ['portfolio', 'debt', 'nope'],
  projects: [
    { id: 'p1', code: 'SMB', name: 'Nhà máy', status: 'active', createdAt: '2026-01-05T00:00:00Z', director: null, site: null,
      start: '2026-01-05', end: null, plannedProgress: 120, actualProgress: '68', updatedAt: null,
      finance: { contractValue: '48600000000', variation: 0, budget: null, output: null, accepted: 1, received: 2, cost: 3,
        costByCategory: { materials: '3' }, ar: { requested: 1, flow: { paid: 1 } }, ap: { paid: 5, subcontract: { total: 4, paid: 2 } } },
      materials: null, gaps: ['coords', 'baseline', 'unknown_gap'] },
    { id: 'p2', code: 'DA29', name: 'Nhà xưởng', status: 'active', finance: null, gaps: null },
  ],
  months: [{ month: '2026-09', projectId: 'p1', revenue: '10', cost: 2 }],
  materialItems: [], needs: [{ id: 'r1:1', requestId: 'r1', code: 'MR-1', kind: 'buy', qty: '18.5', neededDate: null, projectId: 'p1' }],
};

describe('dashboard service', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('reads the server payload defensively: unknown boards and gaps dropped, numbers parsed, null stays null', () => {
    const data = parseDashboard(SERVER);
    expect(data.access).toEqual(['portfolio', 'debt']);
    const [p1, p2] = data.projects;
    expect(p1.plannedProgress).toBe(100);
    expect(p1.actualProgress).toBe(68);
    expect(p1.end).toBeNull();
    expect(p1.gaps).toEqual(['coords', 'baseline']);
    expect(p1.finance?.contractValue).toBe(48_600_000_000);
    expect(p1.finance?.budget).toBeNull();
    expect(p1.finance?.costByCategory.materials).toBe(3);
    expect(p1.finance?.ar.flow).toEqual({ paid: 1, outstanding: 0, retention: 0, recovered: 0 });
    expect(p1.finance?.ap.supplier).toEqual({ total: 0, paid: 0 });
    expect(p1.finance?.records).toEqual({ arRounds: 0, apDocs: 0, receipts: 0, payments: 0 });
    // Không được xem tiền: null, không thành 0.
    expect(p2.finance).toBeNull();
    expect(p2.gaps).toEqual([]);
    expect(data.months[0]).toMatchObject({ revenue: 10, cashIn: 0 });
    expect(data.needs[0]).toMatchObject({ requestId: 'r1', qty: 18.5, kind: 'buy' });
  });

  it('is not realtime: one server call until the user asks for an update', async () => {
    mocks.rpc.mockResolvedValue({ data: SERVER, error: null });
    await fetchDashboard('u-cache');
    await fetchDashboard('u-cache');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    // Đã có số liệu → biết bảng mà không gọi thêm.
    expect(await fetchDashboardAccess('u-cache')).toEqual(['portfolio', 'debt']);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await fetchDashboard('u-cache', true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('checks access with the light call and explains failures in plain words', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { access: ['materials'] }, error: null });
    expect(await fetchDashboardAccess('u-access')).toEqual(['materials']);
    expect(mocks.rpc).toHaveBeenCalledWith('get_center_dashboard_v1', { p_access_only: true });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(fetchDashboard('u-fail')).rejects.toThrow('Chưa tải được số liệu. Kiểm tra mạng rồi bấm Cập nhật.');
    warn.mockRestore();
  });
});
