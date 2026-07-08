import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import { siteSmallToolService } from '../siteSmallToolService';

const recordRow = (patch: Record<string, any> = {}) => ({
  id: 'tool-1',
  code: 'CCDC-001',
  project_id: 'project-1',
  construction_site_id: 'site-1',
  source_type: 'site_direct_purchase',
  source_id: 'direct-1',
  source_line_id: 'line-1',
  source_code: 'MNN-001',
  supplier_id: null,
  supplier_name_snapshot: 'Tạp hoá cô Lan',
  item_name_snapshot: 'Tô vít',
  category: 'Dụng cụ cầm tay',
  unit_snapshot: 'cái',
  quantity: 3,
  unit_cost: 300000,
  total_amount: 900000,
  purchase_date: '2026-07-08',
  holder_type: 'site',
  holder_id: 'site-1',
  holder_name_snapshot: 'Công trường A',
  location_note: 'Tủ dụng cụ BCH',
  status: 'stored',
  attachments: [{ id: 'att-1', name: 'Ảnh hóa đơn', url: 'https://example.com/invoice.jpg' }],
  qr_token: 'qr-tool-1',
  created_by: 'user-1',
  created_at: '2026-07-08T00:00:00.000Z',
  updated_at: '2026-07-08T00:00:00.000Z',
  note: 'Mua nóng',
  ...patch,
});

const query = (response: { data?: any; error?: any } = { data: [], error: null }) => {
  const api: any = {
    select: vi.fn(() => api),
    order: vi.fn(() => api),
    eq: vi.fn(() => api),
    ilike: vi.fn(() => api),
    update: vi.fn(() => api),
    single: vi.fn(() => Promise.resolve(response)),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return api;
};

describe('siteSmallToolService', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('lists small-tool records and maps snake case rows', async () => {
    const listQuery = query({ data: [recordRow()], error: null });
    supabaseMocks.from.mockReturnValueOnce(listQuery);

    const records = await siteSmallToolService.list({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      status: 'stored',
      search: 'tô vít',
    });

    expect(supabaseMocks.from).toHaveBeenCalledWith('site_small_tool_records');
    expect(listQuery.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(listQuery.eq).toHaveBeenCalledWith('construction_site_id', 'site-1');
    expect(listQuery.eq).toHaveBeenCalledWith('status', 'stored');
    expect(listQuery.ilike).toHaveBeenCalledWith('item_name_snapshot', '%tô vít%');
    expect(records[0]).toMatchObject({
      id: 'tool-1',
      sourceLineId: 'line-1',
      itemNameSnapshot: 'Tô vít',
      holderNameSnapshot: 'Công trường A',
      status: 'stored',
      totalAmount: 900000,
    });
  });

  it('syncs small tools from a direct purchase through an idempotent RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: [recordRow()], error: null });

    const records = await siteSmallToolService.syncFromSiteDirectPurchase('direct-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('sync_site_small_tools_from_site_direct_purchase', {
      p_direct_purchase_id: 'direct-1',
    });
    expect(records).toHaveLength(1);
    expect(records[0].sourceId).toBe('direct-1');
  });

  it('updates custody snapshots without changing accounting amounts', async () => {
    const updateQuery = query({ data: recordRow({ holder_type: 'manual', holder_id: null, holder_name_snapshot: 'Anh Nam đội điện', location_note: 'Container đội điện' }), error: null });
    supabaseMocks.from.mockReturnValueOnce(updateQuery);

    const record = await siteSmallToolService.updateCustody('tool-1', {
      holderType: 'manual',
      holderId: null,
      holderNameSnapshot: 'Anh Nam đội điện',
      locationNote: 'Container đội điện',
    });

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      holder_type: 'manual',
      holder_id: null,
      holder_name_snapshot: 'Anh Nam đội điện',
      location_note: 'Container đội điện',
    }));
    expect(record.holderNameSnapshot).toBe('Anh Nam đội điện');
    expect(record.totalAmount).toBe(900000);
  });

  it('updates small-tool status with a trace note', async () => {
    const updateQuery = query({ data: recordRow({ status: 'lost', note: 'Mất khi chuyển kho tạm' }), error: null });
    supabaseMocks.from.mockReturnValueOnce(updateQuery);

    const record = await siteSmallToolService.updateStatus('tool-1', 'lost', 'Mất khi chuyển kho tạm');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'lost',
      note: 'Mất khi chuyển kho tạm',
    }));
    expect(record.status).toBe('lost');
  });
});
