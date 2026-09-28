import { supabase } from './supabase';
import type { UserPermissionGrant } from '../types';
import type { PermissionAdminCatalog, PermissionCatalogAction } from './permissions/permissionTypes';

// Person templates outside projects: a bundle of permissions copied into one
// person's own grants, then adjusted before saving (server:
// user_permission_templates; saving goes through update_user_authorization_v2).

export type TemplateScopeType = 'global' | 'own' | 'assigned';

export interface UserPermissionTemplateItem {
  permissionCode: string;
  scopeType: TemplateScopeType;
  /** Set for permissions that need an end date: days from the fill date. */
  expiresInDays?: number;
}

export interface UserPermissionTemplate {
  code: string;
  name: string;
  description: string | null;
  items: UserPermissionTemplateItem[];
  suggestedPositionIds: string[];
  sortOrder: number;
  isActive: boolean;
  updatedAt?: string;
}

export type UserPermissionTemplateMode = 'merge' | 'replace';

const toTemplate = (row: any): UserPermissionTemplate => ({
  code: row.code,
  name: row.name,
  description: row.description,
  items: row.items || [],
  suggestedPositionIds: row.suggested_position_ids || [],
  sortOrder: row.sort_order ?? 100,
  isActive: row.is_active !== false,
  updatedAt: row.updated_at,
});

export const userPermissionTemplateService = {
  async list(): Promise<UserPermissionTemplate[]> {
    const { data, error } = await supabase
      .from('user_permission_templates')
      .select('code,name,description,items,suggested_position_ids,sort_order,is_active,updated_at')
      .order('sort_order')
      .limit(200);
    if (error) throw error;
    return (data || []).map(toTemplate);
  },

  async save(template: Omit<UserPermissionTemplate, 'sortOrder' | 'updatedAt'>): Promise<UserPermissionTemplate> {
    const { data, error } = await supabase.rpc('save_user_permission_template', {
      p_code: template.code,
      p_name: template.name,
      p_description: template.description,
      p_items: template.items,
      p_suggested_position_ids: template.suggestedPositionIds,
      p_is_active: template.isActive,
    });
    if (error) throw error;
    return toTemplate(data);
  },

  /** Position of the employee linked to a user account, or null. */
  async getUserPositionId(userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('employees')
      .select('position_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as any)?.position_id || null;
  },
};

/** Templates suggested for a position, best first; the rest follow. */
export const orderUserTemplatesForPosition = (
  templates: readonly UserPermissionTemplate[],
  positionId: string | null | undefined,
): Array<UserPermissionTemplate & { suggested: boolean }> => templates
  .filter(template => template.isActive)
  .map(template => ({ ...template, suggested: Boolean(positionId && template.suggestedPositionIds.includes(positionId)) }))
  .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.sortOrder - b.sortOrder);

const catalogActions = (catalog: PermissionAdminCatalog): Map<string, PermissionCatalogAction> =>
  new Map(catalog.applications.flatMap(application =>
    application.modules.flatMap(module => module.actions)).map(action => [action.permissionCode, action]));

const keyOf = (code: string, scopeType?: string, scopeId?: string) => `${code}::${scopeType || 'global'}::${scopeId || '*'}`;

/**
 * Direct grants after filling a template in. merge keeps what the person has
 * and adds the missing items; replace swaps the person's catalog grants for
 * the template (grants outside the catalog and project grants are kept).
 * Items the person already gets from a role, or that can no longer be granted
 * directly, are skipped.
 */
export const buildGrantsFromTemplate = ({
  current,
  template,
  mode,
  catalog,
  userId,
  inheritedCodes = [],
  now = new Date(),
}: {
  current: readonly UserPermissionGrant[];
  template: UserPermissionTemplate;
  mode: UserPermissionTemplateMode;
  catalog: PermissionAdminCatalog;
  userId: string;
  inheritedCodes?: readonly string[];
  now?: Date;
}): { grants: UserPermissionGrant[]; added: number; removed: number; skipped: number } => {
  const actions = catalogActions(catalog);
  const active = current.filter(grant => grant.isActive !== false);
  const kept = mode === 'merge'
    ? active
    : active.filter(grant => !actions.has(grant.permissionCode) || grant.permissionCode.startsWith('project.'));
  const keys = new Set(kept.map(grant => keyOf(grant.permissionCode, grant.scopeType, grant.scopeId)));
  const inherited = new Set(inheritedCodes);
  const added: UserPermissionGrant[] = [];
  let skipped = 0;
  for (const item of template.items) {
    const action = actions.get(item.permissionCode);
    if (!action || !action.directGrantAllowed || !action.scopeTypes.includes(item.scopeType) || inherited.has(item.permissionCode)) {
      skipped += 1;
      continue;
    }
    const key = keyOf(item.permissionCode, item.scopeType);
    if (keys.has(key)) continue;
    keys.add(key);
    const days = action.directGrantRequiresExpiry ? item.expiresInDays || 365 : undefined;
    added.push({
      id: `template-${template.code}-${item.permissionCode}-${item.scopeType}`,
      userId,
      permissionCode: item.permissionCode,
      scopeType: item.scopeType,
      scopeId: '*',
      expiresAt: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : undefined,
      isActive: true,
    } as UserPermissionGrant);
  }
  const before = new Set(active.map(grant => keyOf(grant.permissionCode, grant.scopeType, grant.scopeId)));
  const grants = [...kept, ...added];
  const after = new Set(grants.map(grant => keyOf(grant.permissionCode, grant.scopeType, grant.scopeId)));
  return {
    grants,
    added: [...after].filter(key => !before.has(key)).length,
    removed: [...before].filter(key => !after.has(key)).length,
    skipped,
  };
};
