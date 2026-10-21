import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc, from: vi.fn() }, isSupabaseConfigured: true }));

import { materialRequestService } from '../materialRequestService';

describe('Danh mục vật tư của dự án tải theo trang (máy chủ trả tối đa 1.000 dòng / lần)', () => {
  it('đủ 1.624 mã — không mất các mã từ chữ T trở đi (Thép, Xi măng)', async () => {
    const all = Array.from({ length: 1624 }, (_, i) => ({ id: `it-${i}`, name: i === 1623 ? 'Xi măng PCB40' : `Vật tư ${i}`, unit: 'Cái', status: 'active' }));
    const ranges: Array<[number, number]> = [];
    mocks.rpc.mockImplementation(() => ({
      range: async (from: number, to: number) => { ranges.push([from, to]); return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null }; },
    }));
    const items = await materialRequestService.getProjectCatalog('p-da29', 's-1');
    expect(items).toHaveLength(1624);
    expect(items.at(-1)?.name).toBe('Xi măng PCB40');
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(mocks.rpc).toHaveBeenCalledWith('list_project_material_request_catalog_v1', { p_project_id: 'p-da29', p_construction_site_id: 's-1' });
  });
});
