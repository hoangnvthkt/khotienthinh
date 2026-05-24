import { MaterialCodeRequest } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

const mapMaterialCodeRequestFromDb = (row: any): MaterialCodeRequest => ({
  id: row.id,
  code: row.code,
  requestedByUserId: row.requested_by_user_id,
  requestedByName: row.requested_by_name,
  proposedName: row.proposed_name,
  proposedUnit: row.proposed_unit,
  proposedCategory: row.proposed_category,
  proposedSpecification: row.proposed_specification,
  proposedSupplierId: row.proposed_supplier_id,
  reason: row.reason,
  status: row.status,
  approvedSku: row.approved_sku,
  approvedItemId: row.approved_item_id,
  approvedByUserId: row.approved_by_user_id,
  approvedByName: row.approved_by_name,
  approvedAt: row.approved_at,
  rejectionReason: row.rejection_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const materialCodeRequestService = {
  async list(): Promise<MaterialCodeRequest[]> {
    if (!isSupabaseConfigured) return [];

    const { data, error } = await supabase
      .from('material_code_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapMaterialCodeRequestFromDb);
  },

  async create(input: Omit<MaterialCodeRequest, 'status' | 'createdAt' | 'updatedAt'>): Promise<MaterialCodeRequest> {
    const now = new Date().toISOString();
    if (!isSupabaseConfigured) {
      return { ...input, status: 'pending', createdAt: now };
    }

    const payload = {
      id: input.id,
      code: input.code,
      requested_by_user_id: input.requestedByUserId,
      requested_by_name: input.requestedByName || null,
      proposed_name: input.proposedName,
      proposed_unit: input.proposedUnit,
      proposed_category: input.proposedCategory || null,
      proposed_specification: input.proposedSpecification || null,
      proposed_supplier_id: input.proposedSupplierId || null,
      reason: input.reason,
      status: 'pending',
      approved_sku: null,
      approved_item_id: null,
      approved_by_user_id: null,
      approved_by_name: null,
      approved_at: null,
      rejection_reason: null,
      created_at: now,
    };

    const { data, error } = await supabase
      .from('material_code_requests')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;
    return mapMaterialCodeRequestFromDb(data);
  },

  async approve(
    id: string,
    input: {
      approvedSku: string;
      approvedItemId: string;
      approvedByUserId: string;
      approvedByName?: string | null;
    }
  ): Promise<MaterialCodeRequest> {
    const now = new Date().toISOString();
    if (!isSupabaseConfigured) {
      return {
        id,
        code: '',
        requestedByUserId: '',
        proposedName: '',
        proposedUnit: '',
        reason: '',
        status: 'approved',
        approvedSku: input.approvedSku,
        approvedItemId: input.approvedItemId,
        approvedByUserId: input.approvedByUserId,
        approvedByName: input.approvedByName,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    }

    const { data, error } = await supabase
      .from('material_code_requests')
      .update({
        status: 'approved',
        approved_sku: input.approvedSku,
        approved_item_id: input.approvedItemId,
        approved_by_user_id: input.approvedByUserId,
        approved_by_name: input.approvedByName || null,
        approved_at: now,
        rejection_reason: null,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .single();

    if (error) throw error;
    return mapMaterialCodeRequestFromDb(data);
  },

  async reject(
    id: string,
    input: {
      reason: string;
      rejectedByUserId: string;
      rejectedByName?: string | null;
    }
  ): Promise<MaterialCodeRequest> {
    const now = new Date().toISOString();
    if (!isSupabaseConfigured) {
      return {
        id,
        code: '',
        requestedByUserId: '',
        proposedName: '',
        proposedUnit: '',
        reason: '',
        status: 'rejected',
        approvedByUserId: input.rejectedByUserId,
        approvedByName: input.rejectedByName,
        rejectionReason: input.reason,
        createdAt: now,
        updatedAt: now,
      };
    }

    const { data, error } = await supabase
      .from('material_code_requests')
      .update({
        status: 'rejected',
        approved_by_user_id: input.rejectedByUserId,
        approved_by_name: input.rejectedByName || null,
        rejection_reason: input.reason,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .single();

    if (error) throw error;
    return mapMaterialCodeRequestFromDb(data);
  },
};
