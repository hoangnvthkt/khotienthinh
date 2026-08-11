import type { HrmConstructionSite } from '../types';
import { supabase } from './supabase';
import {
  mapConstructionSiteWarehouseBindingFromDb,
  mapWarehouseSiteBindingFromDb,
} from './warehouseSiteBinding';

export const warehouseSiteBindingService = {
  async createWarehouse(input: {
    warehouseId: string;
    name: string;
    address: string;
    type: string;
    constructionSiteId?: string | null;
    isDefaultForSite: boolean;
  }) {
    const { data, error } = await supabase.rpc('create_warehouse_with_site_binding', {
      p_warehouse_id: input.warehouseId,
      p_name: input.name,
      p_address: input.address,
      p_type: input.type,
      p_construction_site_id: input.constructionSiteId || null,
      p_is_default_for_site: input.isDefaultForSite,
    });
    if (error) throw error;
    return mapWarehouseSiteBindingFromDb(Array.isArray(data) ? data[0] : data);
  },
  async setWarehouseBinding(input: {
    warehouseId: string;
    constructionSiteId?: string | null;
    isDefaultForSite: boolean;
    name?: string | null;
    address?: string | null;
    type?: string | null;
  }) {
    const { data, error } = await supabase.rpc('set_warehouse_construction_site_binding', {
      p_warehouse_id: input.warehouseId,
      p_construction_site_id: input.constructionSiteId || null,
      p_is_default_for_site: input.isDefaultForSite,
      p_name: input.name || null,
      p_address: input.address ?? null,
      p_type: input.type || null,
    });
    if (error) throw error;
    return mapWarehouseSiteBindingFromDb(Array.isArray(data) ? data[0] : data);
  },
  async setEnforcement(constructionSiteId: string, enforced: boolean): Promise<HrmConstructionSite> {
    const { data, error } = await supabase.rpc('set_construction_site_warehouse_enforcement', {
      p_construction_site_id: constructionSiteId,
      p_enforced: enforced,
    });
    if (error) throw error;
    return mapConstructionSiteWarehouseBindingFromDb(Array.isArray(data) ? data[0] : data);
  },
};
