import { describe, expect, it } from 'vitest';
import type { HrmConstructionSite, Warehouse } from '../../types';
import {
  buildSupplierDeliveryWarehousePolicy,
  getWarehouseBindingLabel,
  mapConstructionSiteWarehouseBindingFromDb,
  mapWarehouseSiteBindingFromDb,
  suggestConstructionSiteForWarehouse,
  toWarehouseSiteBindingDb,
} from '../warehouseSiteBinding';

const warehouses: Warehouse[] = [
  { id: 'rico', name: 'Kho RICO', address: '', type: 'SITE', constructionSiteId: 'site-rico', isDefaultForSite: true },
  { id: 'xin', name: 'Kho Xin Hai Vina', address: '', type: 'SITE', constructionSiteId: 'site-xin', isDefaultForSite: true },
  { id: 'xin-2', name: 'Kho phụ Xin Hai', address: '', type: 'SITE', constructionSiteId: 'site-xin' },
  { id: 'office', name: 'Kho Văn phòng', address: '', type: 'OFFICE' },
  { id: 'archived', name: 'Kho cũ Xin Hai', address: '', type: 'SITE', constructionSiteId: 'site-xin', isArchived: true },
];

const sites: HrmConstructionSite[] = [
  { id: 'site-rico', name: 'Công trường RICO', warehouseBindingEnforced: false },
  { id: 'site-xin', name: 'Công trường Xin Hai Vina', warehouseBindingEnforced: true },
];

describe('warehouse/construction-site binding policy', () => {
  it('auto-selects the site default and excludes warehouses from other sites after enforcement', () => {
    const policy = buildSupplierDeliveryWarehousePolicy({
      warehouses,
      constructionSiteId: 'site-xin',
      warehouseBindingEnforced: true,
      currentWarehouseId: null,
    });

    expect(policy.options.map(warehouse => warehouse.id)).toEqual(['xin', 'xin-2']);
    expect(policy.selectedWarehouseId).toBe('xin');
    expect(policy.blocked).toBe(false);
    expect(policy.readOnly).toBe(false);
    expect(policy.historicalException).toBe(false);
  });

  it('locks a single valid warehouse and blocks a site with no valid warehouse', () => {
    const oneWarehouse = buildSupplierDeliveryWarehousePolicy({
      warehouses: warehouses.filter(warehouse => warehouse.id !== 'xin-2'),
      constructionSiteId: 'site-xin',
      warehouseBindingEnforced: true,
      currentWarehouseId: null,
    });
    const noWarehouse = buildSupplierDeliveryWarehousePolicy({
      warehouses,
      constructionSiteId: 'site-missing',
      warehouseBindingEnforced: true,
      currentWarehouseId: null,
    });

    expect(oneWarehouse.selectedWarehouseId).toBe('xin');
    expect(oneWarehouse.readOnly).toBe(true);
    expect(noWarehouse.options).toEqual([]);
    expect(noWarehouse.blocked).toBe(true);
  });

  it('preserves an existing cross-site warehouse as a visible historical exception', () => {
    const policy = buildSupplierDeliveryWarehousePolicy({
      warehouses,
      constructionSiteId: 'site-xin',
      warehouseBindingEnforced: true,
      currentWarehouseId: 'rico',
    });

    expect(policy.selectedWarehouseId).toBe('rico');
    expect(policy.historicalException).toBe(true);
    expect(policy.options.map(warehouse => warehouse.id)).toEqual(['xin', 'xin-2']);
  });

  it('keeps the pre-enforcement warehouse flow available during rollout', () => {
    const policy = buildSupplierDeliveryWarehousePolicy({
      warehouses,
      constructionSiteId: 'site-rico',
      warehouseBindingEnforced: false,
      currentWarehouseId: 'office',
    });

    expect(policy.options.map(warehouse => warehouse.id)).toEqual(['rico', 'xin', 'xin-2', 'office']);
    expect(policy.selectedWarehouseId).toBe('office');
    expect(policy.blocked).toBe(false);
  });

  it('shows binding state and name-based suggestions without applying them', () => {
    expect(getWarehouseBindingLabel(warehouses[3], sites)).toBe('Chưa liên kết');
    expect(getWarehouseBindingLabel(warehouses[0], sites)).toBe('Đã liên kết');
    expect(getWarehouseBindingLabel(warehouses[1], sites)).toBe('Đã khóa');
    expect(suggestConstructionSiteForWarehouse({ ...warehouses[1], constructionSiteId: undefined }, sites)?.id).toBe('site-xin');
    expect(suggestConstructionSiteForWarehouse(warehouses[3], sites)).toBeNull();
  });

  it('maps warehouse and construction-site binding fields across the Supabase boundary', () => {
    expect(mapWarehouseSiteBindingFromDb({
      id: 'xin',
      name: 'Kho Xin Hai Vina',
      address: '',
      type: 'SITE',
      construction_site_id: 'site-xin',
      is_default_for_site: true,
      is_archived: false,
    })).toEqual(expect.objectContaining({
      constructionSiteId: 'site-xin',
      isDefaultForSite: true,
      isArchived: false,
    }));
    expect(toWarehouseSiteBindingDb(warehouses[1])).toEqual({
      construction_site_id: 'site-xin',
      is_default_for_site: true,
    });
    expect(mapConstructionSiteWarehouseBindingFromDb({
      id: 'site-xin',
      name: 'Công trường Xin Hai Vina',
      warehouse_binding_enforced: true,
    }).warehouseBindingEnforced).toBe(true);
  });
});
