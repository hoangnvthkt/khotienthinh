import { supabase } from './supabase';

export interface WmsActionRecipient {
  userId: string;
  userName: string;
  /** Tied to one of the requested warehouses; preferred as default handler. */
  warehouseSpecific: boolean;
}

export const wmsRecipientService = {
  /** People the server lets perform a WMS action at any of the warehouses. */
  async list(permissionCode: string, warehouseIds: Array<string | null | undefined>): Promise<WmsActionRecipient[]> {
    const { data, error } = await supabase.rpc('list_wms_action_recipients', {
      p_permission_code: permissionCode,
      p_warehouse_ids: [...new Set(warehouseIds.filter((id): id is string => Boolean(id)))],
    });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      userId: row.user_id,
      userName: row.user_name || '',
      warehouseSpecific: Boolean(row.warehouse_specific),
    }));
  },
};
