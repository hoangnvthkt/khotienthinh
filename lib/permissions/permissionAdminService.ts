import { UserPermissionGrant } from '../../types';
import { isSupabaseConfigured, supabase } from '../supabase';

const mapPermissionGrantFromDb = (row: any): UserPermissionGrant => ({
  id: row.id,
  userId: row.user_id ?? row.userId,
  permissionCode: row.permission_code ?? row.permissionCode,
  scopeType: row.scope_type ?? row.scopeType ?? 'global',
  scopeId: row.scope_id ?? row.scopeId ?? '*',
  isActive: row.is_active ?? row.isActive ?? true,
  grantedBy: row.granted_by ?? row.grantedBy,
  grantedAt: row.granted_at ?? row.grantedAt,
  expiresAt: row.expires_at ?? row.expiresAt,
});

export const listUserPermissionGrants = async (userId: string): Promise<UserPermissionGrant[]> => {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('user_permission_grants')
    .select('id,user_id,permission_code,scope_type,scope_id,is_active,granted_by,granted_at,expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('permission_code', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapPermissionGrantFromDb);
};

export const replaceUserPermissionGrants = async (
  userId: string,
  grants: readonly UserPermissionGrant[],
): Promise<void> => {
  if (!isSupabaseConfigured || !userId) return;
  const payload = grants
    .filter(grant => grant.isActive !== false)
    .map(grant => ({
      permission_code: grant.permissionCode,
      scope_type: grant.scopeType || 'global',
      scope_id: grant.scopeId || '*',
      is_active: grant.isActive ?? true,
      expires_at: grant.expiresAt || null,
    }));

  const { error } = await supabase.rpc('replace_user_permission_grants', {
    p_user_id: userId,
    p_grants: payload,
  });
  if (error) throw error;
};
