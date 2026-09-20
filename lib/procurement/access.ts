import { supabase } from '../supabase';

export interface ProcurementAccess {
  canRead: boolean;
  canViewPrice: boolean;
  canAllocate: boolean;
}

export const procurementAccessService = {
  async get(projectId: string, constructionSiteId?: string | null): Promise<ProcurementAccess> {
    const { data, error } = await supabase.rpc('get_procurement_access_v1', {
      p_project_id: projectId,
      p_construction_site_id: constructionSiteId || null,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('PROCUREMENT_ACCESS_RESPONSE_INVALID');
    const value = data as Record<string, unknown>;
    return {
      canRead: value.canRead === true,
      canViewPrice: value.canViewPrice === true,
      canAllocate: value.canAllocate === true,
    };
  },
};
