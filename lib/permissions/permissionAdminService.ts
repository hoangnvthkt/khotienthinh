import { UserPermissionGrant } from '../../types';
import { isSupabaseConfigured, supabase } from '../supabase';
import type {
  SodWarningAcceptanceInput,
  UnifiedPermissionApplyResult,
  UnifiedPermissionPreview,
} from './authorizationGovernanceTypes';
import type { LegacyPermissionState } from './permissionTypes';

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

export interface ReplaceDirectGrantsOptions {
  reason: string;
  warningAcceptances: SodWarningAcceptanceInput[];
}

export const buildDirectGrantReplacementPayload = (
  grants: readonly UserPermissionGrant[],
) => grants.filter(grant => grant.isActive !== false).map(grant => ({
  permission_code: grant.permissionCode,
  scope_type: grant.scopeType || 'global',
  scope_id: grant.scopeId || '*',
  is_active: true,
  expires_at: grant.expiresAt || null,
}));

export const replaceUserPermissionGrants = async (
  userId: string,
  grants: readonly UserPermissionGrant[],
  options: ReplaceDirectGrantsOptions,
): Promise<void> => {
  if (!isSupabaseConfigured || !userId) return;
  const payload = buildDirectGrantReplacementPayload(grants);

  const { error } = await supabase.rpc('replace_user_permission_grants_v2', {
    p_user_id: userId,
    p_grants: payload,
    p_reason: options.reason.trim(),
    p_warning_acceptances: options.warningAcceptances,
  });
  if (error) throw error;
};

export const previewUserPermissionChange = async (
  userId: string,
  legacyState: LegacyPermissionState | null,
  grants: readonly UserPermissionGrant[],
): Promise<UnifiedPermissionPreview> => {
  if (!isSupabaseConfigured || !userId) {
    throw new Error('Unified permission preview requires Supabase.');
  }
  const { data, error } = await supabase.rpc('preview_user_permission_change', {
    p_user_id: userId,
    p_legacy_state: legacyState,
    p_grants: buildDirectGrantReplacementPayload(grants),
  });
  if (error) throw error;
  return data as UnifiedPermissionPreview;
};

export const applyUserPermissionChange = async (
  userId: string,
  fingerprint: string,
  legacyState: LegacyPermissionState | null,
  grants: readonly UserPermissionGrant[],
  options: ReplaceDirectGrantsOptions,
): Promise<UnifiedPermissionApplyResult> => {
  if (!isSupabaseConfigured || !userId) {
    throw new Error('Unified permission save requires Supabase.');
  }
  const { data, error } = await supabase.rpc('apply_user_permission_change', {
    p_user_id: userId,
    p_expected_fingerprint: fingerprint,
    p_legacy_state: legacyState,
    p_grants: buildDirectGrantReplacementPayload(grants),
    p_reason: options.reason.trim(),
    p_warning_acceptances: options.warningAcceptances,
  });
  if (error) throw error;
  return data as UnifiedPermissionApplyResult;
};
