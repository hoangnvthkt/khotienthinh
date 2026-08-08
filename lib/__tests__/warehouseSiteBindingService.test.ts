import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({
  supabase: { rpc },
}));

import { warehouseSiteBindingService } from '../warehouseSiteBindingService';

describe('warehouseSiteBindingService', () => {
  beforeEach(() => rpc.mockReset());

  it('activates the database-enforced warehouse lock for one construction site', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: 'site-xin',
        name: 'Công trường Xin Hai Vina',
        warehouse_binding_enforced: true,
      },
      error: null,
    });

    const site = await warehouseSiteBindingService.setEnforcement('site-xin', true);

    expect(rpc).toHaveBeenCalledWith('set_construction_site_warehouse_enforcement', {
      p_construction_site_id: 'site-xin',
      p_enforced: true,
    });
    expect(site.warehouseBindingEnforced).toBe(true);
  });

  it('assigns a warehouse and switches the site default atomically', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: 'warehouse-xin',
        name: 'Kho Xin Hai Vina',
        address: '',
        type: 'SITE',
        construction_site_id: 'site-xin',
        is_default_for_site: true,
      },
      error: null,
    });

    const warehouse = await warehouseSiteBindingService.setWarehouseBinding({
      warehouseId: 'warehouse-xin',
      constructionSiteId: 'site-xin',
      isDefaultForSite: true,
      name: 'Kho Xin Hai Vina',
      address: 'Nhà máy Xin Hai',
      type: 'SITE',
    });

    expect(rpc).toHaveBeenCalledWith('set_warehouse_construction_site_binding', {
      p_warehouse_id: 'warehouse-xin',
      p_construction_site_id: 'site-xin',
      p_is_default_for_site: true,
      p_name: 'Kho Xin Hai Vina',
      p_address: 'Nhà máy Xin Hai',
      p_type: 'SITE',
    });
    expect(warehouse).toEqual(expect.objectContaining({
      constructionSiteId: 'site-xin',
      isDefaultForSite: true,
    }));
  });

  it('creates and binds a warehouse in one database transaction', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: 'warehouse-new',
        name: 'Kho mới',
        address: 'Công trường mới',
        type: 'SITE',
        construction_site_id: 'site-new',
        is_default_for_site: true,
      },
      error: null,
    });

    const warehouse = await warehouseSiteBindingService.createWarehouse({
      warehouseId: 'warehouse-new',
      name: 'Kho mới',
      address: 'Công trường mới',
      type: 'SITE',
      constructionSiteId: 'site-new',
      isDefaultForSite: true,
    });

    expect(rpc).toHaveBeenCalledWith('create_warehouse_with_site_binding', {
      p_warehouse_id: 'warehouse-new',
      p_name: 'Kho mới',
      p_address: 'Công trường mới',
      p_type: 'SITE',
      p_construction_site_id: 'site-new',
      p_is_default_for_site: true,
    });
    expect(warehouse).toEqual(expect.objectContaining({
      id: 'warehouse-new',
      constructionSiteId: 'site-new',
      isDefaultForSite: true,
    }));
  });
});
