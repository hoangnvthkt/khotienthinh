import { UserPermissionGrant } from '../../types';
import { isSupabaseConfigured, supabase } from '../supabase';
import { isDirectPermissionGrantAllowed } from './permissionService';
import { getSupabaseOrderColumns } from '../supabaseProjections';
import { fetchAllSupabaseRows } from '../supabaseCompleteRead';
import { mapAuthorizationRpcError } from './authorizationUpdateValidation';

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

export interface AuthorizationProfilePatch {
  name?: string;
  phone?: string | null;
  avatar?: string | null;
  managerId?: string | null;
  assignedWarehouseId?: string | null;
}

export interface UpdateUserAuthorizationV2Input {
  userId: string;
  profile: AuthorizationProfilePatch;
  grants: readonly UserPermissionGrant[];
  reason: string;
  expectedUpdatedAt: string;
}

export interface UserAuthorizationUpdateReceipt {
  userId: string;
  updatedAt: string;
  activeGrantCount: number;
  auditEventId: string;
}

const toGrantPayload = (grants: readonly UserPermissionGrant[]) => grants
  .filter(grant => grant.isActive !== false)
  .map(grant => ({
    permission_code: grant.permissionCode,
    scope_type: grant.scopeType || 'global',
    scope_id: grant.scopeId || '*',
    is_active: grant.isActive ?? true,
    expires_at: grant.expiresAt || null,
  }));

const assertDirectGrantsAllowed = (grants: readonly UserPermissionGrant[]) => {
  const blockedGrant = grants.find(grant =>
    grant.isActive !== false && !isDirectPermissionGrantAllowed(grant.permissionCode)
  );
  if (blockedGrant) {
    throw new Error(`${blockedGrant.permissionCode} chỉ được cấp qua template HR hoặc HR Manage.`);
  }
};

export const listUserPermissionGrants = async (userId: string): Promise<UserPermissionGrant[]> => {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await fetchAllSupabaseRows(supabase
    .from('user_permission_grants')
    .select('id,user_id,permission_code,scope_type,scope_id,is_active,granted_by,granted_at,expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('permission_code', { ascending: true }), { label: "lib/permissions/permissionAdminService.ts:19", maxRows: 20_000, orderBy: getSupabaseOrderColumns('user_permission_grants') });
  if (error) throw error;
  return (data || []).map(mapPermissionGrantFromDb);
};

export const replaceUserPermissionGrants = async (
  userId: string,
  grants: readonly UserPermissionGrant[],
): Promise<void> => {
  if (!isSupabaseConfigured || !userId) return;
  assertDirectGrantsAllowed(grants);
  const payload = toGrantPayload(grants);

  const { error } = await supabase.rpc('replace_user_permission_grants', {
    p_user_id: userId,
    p_grants: payload,
  });
  if (error) throw error;
};

export const updateUserAuthorizationV2 = async (
  input: UpdateUserAuthorizationV2Input,
): Promise<UserAuthorizationUpdateReceipt> => {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Lý do thay đổi phân quyền là bắt buộc.');
  if (reason.length < 10) throw new Error('Lý do thay đổi phải có ít nhất 10 ký tự.');
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
  if (!input.userId || !input.expectedUpdatedAt) {
    throw new Error('Thiếu người dùng hoặc phiên bản dữ liệu cần cập nhật.');
  }

  assertDirectGrantsAllowed(input.grants);
  const profile: Record<string, string | null> = {};
  if ('name' in input.profile) profile.name = input.profile.name ?? '';
  if ('phone' in input.profile) profile.phone = input.profile.phone ?? null;
  if ('avatar' in input.profile) profile.avatar = input.profile.avatar ?? null;
  if ('managerId' in input.profile) profile.manager_id = input.profile.managerId ?? null;
  if ('assignedWarehouseId' in input.profile) {
    profile.assigned_warehouse_id = input.profile.assignedWarehouseId ?? null;
  }

  const { data, error } = await supabase.rpc('update_user_authorization_v2', {
    p_user_id: input.userId,
    p_profile: profile,
    p_grants: toGrantPayload(input.grants),
    p_reason: reason,
    p_expected_updated_at: input.expectedUpdatedAt,
  });

  if (error) throw mapAuthorizationRpcError(error);
  if (!data) throw new Error('Lệnh cập nhật phân quyền không trả về kết quả.');
  return data as unknown as UserAuthorizationUpdateReceipt;
};
