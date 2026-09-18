import type { AssetAssignment } from '../types';
import { supabase } from './supabase';

const toDbPayload = (assignment: AssetAssignment) => ({
  id: assignment.id,
  asset_id: assignment.assetId,
  type: assignment.type,
  user_id: assignment.userId,
  user_name: assignment.userName,
  from_user_id: assignment.fromUserId || null,
  from_user_name: assignment.fromUserName || null,
  date: assignment.date,
  note: assignment.note || null,
  performed_by: assignment.performedBy,
  performed_by_name: assignment.performedByName,
  dept_name: assignment.deptName || null,
  site_name: assignment.siteName || null,
  qty: assignment.qty || null,
});

export const mapAssetAssignmentFromDb = (data: unknown): AssetAssignment => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new Error('Command cấp phát tài sản không trả về kết quả.');
  }
  const value = row as Record<string, unknown>;
  const assignment: AssetAssignment = {
    id: String(value.id || ''),
    assetId: String(value.asset_id || ''),
    type: String(value.type || '') as AssetAssignment['type'],
    userId: String(value.user_id || ''),
    userName: String(value.user_name || ''),
    date: String(value.date || ''),
    performedBy: String(value.performed_by || ''),
    performedByName: String(value.performed_by_name || ''),
  };

  if (!assignment.id || !assignment.assetId || !['assign', 'return', 'transfer'].includes(assignment.type)) {
    throw new Error('Kết quả command cấp phát tài sản không hợp lệ.');
  }
  if (value.from_user_id) assignment.fromUserId = String(value.from_user_id);
  if (value.from_user_name) assignment.fromUserName = String(value.from_user_name);
  if (value.note) assignment.note = String(value.note);
  if (value.dept_name) assignment.deptName = String(value.dept_name);
  if (value.site_name) assignment.siteName = String(value.site_name);
  if (value.qty != null) assignment.qty = Number(value.qty);
  return assignment;
};

export const assetAssignmentService = {
  async record(assignment: AssetAssignment): Promise<AssetAssignment> {
    const { data, error } = await supabase.rpc('record_asset_assignment', {
      p_assignment: toDbPayload(assignment),
    });
    if (error) throw error;
    return mapAssetAssignmentFromDb(data);
  },
};
