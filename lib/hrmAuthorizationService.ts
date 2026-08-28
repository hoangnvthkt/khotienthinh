import type { EffectivePermissionSource, HrmBusinessRoleCode } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

export type HrmBusinessRoleTarget = HrmBusinessRoleCode | 'NONE';

export interface HrmAuthorizationHistoryEntry {
  id: string;
  eventType: string;
  actorUserId?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface HrmAuthorizationSummary {
  targetUserId: string;
  systemRole: string;
  employeeId?: string;
  employeeCode?: string;
  isDirectManager: boolean;
  directReportCount: number;
  hrRole: HrmBusinessRoleCode | null;
  assignmentId?: string;
  startsAt?: string;
  expiresAt?: string;
  fingerprint: string;
  effectivePermissions: EffectivePermissionSource[];
  history: HrmAuthorizationHistoryEntry[];
}

export interface HrmBusinessRolePreview {
  targetRoleCode: HrmBusinessRoleTarget;
  fingerprint: string;
  added: string[];
  removed: string[];
  warnings: Array<Record<string, unknown>>;
  hardDenies: Array<Record<string, unknown>>;
  opensC3: boolean;
  opensC4: boolean;
  allowsC4Mutation: boolean;
  allowsSensitiveExport: boolean;
}

export interface HrmAuthorizationRpcGateway {
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

const defaultGateway: HrmAuthorizationRpcGateway = {
  rpc: async (functionName, params) => {
    if (!isSupabaseConfigured) {
      return { data: null, error: { message: 'Supabase chưa được cấu hình.' } };
    }
    const result = await supabase.rpc(functionName, params);
    return { data: result.data, error: result.error };
  },
};

const rpcData = async <T>(
  gateway: HrmAuthorizationRpcGateway,
  functionName: string,
  params: Record<string, unknown>,
): Promise<T> => {
  const { data, error } = await gateway.rpc(functionName, params);
  if (error) throw new Error(error.message || `Không thể gọi ${functionName}.`);
  return data as T;
};

export const getUserHrmAuthorization = (
  targetUserId: string,
  gateway: HrmAuthorizationRpcGateway = defaultGateway,
): Promise<HrmAuthorizationSummary> => rpcData(gateway, 'get_user_hr_authorization', {
  p_target_user_id: targetUserId,
});

export const previewUserHrmBusinessRole = (
  targetUserId: string,
  targetRoleCode: HrmBusinessRoleTarget,
  expiresAt: string | null,
  gateway: HrmAuthorizationRpcGateway = defaultGateway,
): Promise<HrmBusinessRolePreview> => rpcData(gateway, 'preview_user_hr_business_role', {
  p_target_user_id: targetUserId,
  p_target_role_code: targetRoleCode,
  p_expires_at: expiresAt,
});

export interface SetUserHrmBusinessRoleInput {
  targetUserId: string;
  targetRoleCode: HrmBusinessRoleTarget;
  expiresAt: string | null;
  reason: string;
  warningAcceptances: Array<Record<string, unknown>>;
  expectedFingerprint: string;
}

export const setUserHrmBusinessRole = async (
  input: SetUserHrmBusinessRoleInput,
  gateway: HrmAuthorizationRpcGateway = defaultGateway,
): Promise<HrmAuthorizationSummary> => {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new Error('Lý do phải có ít nhất 10 ký tự.');

  return rpcData(gateway, 'set_user_hr_business_role', {
    p_target_user_id: input.targetUserId,
    p_target_role_code: input.targetRoleCode,
    p_expires_at: input.expiresAt,
    p_reason: reason,
    p_warning_acceptances: input.warningAcceptances,
    p_expected_fingerprint: input.expectedFingerprint,
  });
};
