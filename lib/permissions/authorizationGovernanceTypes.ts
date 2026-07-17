import type {
  PermissionRiskLevel,
  PermissionScopeType,
} from './permissionTypes';

export type EffectivePermissionSourceType = 'ROLE' | 'DIRECT' | 'LEGACY';
export type AuthorizationChangeMode = 'ADD' | 'REPLACE_DIRECT';

export interface EffectivePermissionSource {
  permissionCode: string;
  sourceType: EffectivePermissionSourceType;
  sourceId: string;
  sourceCode: string;
  sourceLabel: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  riskLevel: PermissionRiskLevel;
  isBusinessApproval: boolean;
  metadata: Record<string, unknown>;
}

export interface BusinessRoleItem {
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  sortOrder?: number;
}

export interface BusinessRole {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  isSystem: boolean;
  version: number;
  items: BusinessRoleItem[];
}

export interface PrincipalRoleAssignment {
  id: string;
  principalType: 'user';
  principalId: string;
  roleTemplateId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  startsAt: string;
  expiresAt?: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  assignedBy?: string | null;
  assignedReason: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokedReason?: string | null;
}

export interface AuthorizationPrincipal {
  userId: string;
  name: string;
  email: string;
  accountStatus: 'ACTIVE' | 'DISABLED';
}

export interface AuthorizationAuditEvent {
  id: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  eventType: string;
  beforeGrants: unknown[] | Record<string, unknown>;
  afterGrants: unknown[] | Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuthorizationSodRule {
  ruleCode: string;
  name: string;
  description: string;
  ruleType: 'SELF_GRANT' | 'PERMISSION_PAIR' | 'SUBJECT_RELATION';
  effect: 'DENY' | 'WARN' | 'REQUIRE_OVERRIDE';
  operationCode?: string | null;
  subjectType?: string | null;
  overridable: boolean;
}

export interface SodFinding {
  ruleCode: string;
  effect: 'DENY' | 'WARN';
  message: string;
  permissionCodes: string[];
  scopeType: PermissionScopeType;
  scopeId: string;
}

export interface AuthorizationDecision {
  hardDenies: SodFinding[];
  warnings: SodFinding[];
}

export interface PreviewAuthorizationChangeInput {
  targetUserId: string;
  proposedPermissionCodes: string[];
  scopeType: PermissionScopeType;
  scopeId: string;
  changeMode: AuthorizationChangeMode;
}

export interface PreviewBusinessRoleAssignmentInput {
  targetUserId: string;
  roleTemplateId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}

export interface AssignBusinessRoleInput extends PreviewBusinessRoleAssignmentInput {
  startsAt?: string | null;
  expiresAt?: string | null;
  reason: string;
  warningAcceptances: SodWarningAcceptanceInput[];
}

export interface SaveBusinessRoleInput {
  roleTemplateId?: string | null;
  code: string;
  name: string;
  description?: string;
  items: BusinessRoleItem[];
  reason: string;
}

export interface SodWarningAcceptanceInput {
  ruleCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  reason: string;
  controlOwnerUserId: string;
  compensatingControls: string;
  expiresAt: string;
}

export interface BusinessRoleImpactPreview {
  affectedPrincipalCount: number;
  affectedScopeCount: number;
  addedPermissionKeys: string[];
  removedPermissionKeys: string[];
}

export interface AuthorizationOverrideInput {
  ruleCode: string;
  subjectType: string;
  subjectId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  reason: string;
  controlOwnerUserId: string;
  expiresAt: string;
  idempotencyKey: string;
}
