import { supabase } from './supabase';

export type SensitiveViewDomain = 'finance' | 'contract';

export interface SensitiveViewAccessRow {
  userId: string;
  userName: string;
  userEmail: string;
  userAvatar: string | null;
  isSystemAdmin: boolean;
  inProject: boolean;
  financeProject: boolean;
  contractProject: boolean;
  financeAll: boolean;
  contractAll: boolean;
  /** Payment or quantity-acceptance Room member: sees both domains of this project. */
  financeRoom: boolean;
  /** Company contract manager: sees every contract. */
  contractManager: boolean;
}

export interface MySensitiveAccess {
  finance: boolean;
  contract: boolean;
}

export interface SensitiveDomainScope {
  all: boolean;
  projectIds: string[];
  siteIds: string[];
}

export type MySensitiveScope = Record<SensitiveViewDomain, SensitiveDomainScope>;

const mapScope = (value: any): SensitiveDomainScope => ({
  all: Boolean(value?.all),
  projectIds: Array.isArray(value?.projectIds) ? value.projectIds : [],
  siteIds: Array.isArray(value?.siteIds) ? value.siteIds : [],
});

export const canViewSensitive = (
  scope: MySensitiveScope,
  domain: SensitiveViewDomain,
  projectId?: string | null,
  constructionSiteId?: string | null,
): boolean => {
  const domainScope = scope[domain];
  return domainScope.all
    || (!!projectId && domainScope.projectIds.includes(projectId))
    || (!!constructionSiteId && domainScope.siteIds.includes(constructionSiteId));
};

const mapRow = (row: any): SensitiveViewAccessRow => ({
  userId: row.user_id,
  userName: row.user_name || '',
  userEmail: row.user_email || '',
  userAvatar: row.user_avatar || null,
  isSystemAdmin: Boolean(row.is_system_admin),
  inProject: Boolean(row.in_project),
  financeProject: Boolean(row.finance_project),
  contractProject: Boolean(row.contract_project),
  financeAll: Boolean(row.finance_all),
  contractAll: Boolean(row.contract_all),
  financeRoom: Boolean(row.finance_room),
  contractManager: Boolean(row.contract_manager),
});

export const projectSensitiveAccessService = {
  /** Admin only. `projectId` null lists the all-projects switches. */
  async list(projectId: string | null): Promise<SensitiveViewAccessRow[]> {
    const { data, error } = await supabase.rpc('list_project_sensitive_view_access', {
      p_project_id: projectId,
    });
    if (error) throw error;
    return (data || []).map(mapRow);
  },

  /** Admin only. `projectId` null switches every project for the user. */
  async setGrant(input: {
    userId: string;
    projectId: string | null;
    domain: SensitiveViewDomain;
    enabled: boolean;
    reason: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('set_project_sensitive_view_grant', {
      p_user_id: input.userId,
      p_project_id: input.projectId,
      p_domain: input.domain,
      p_enabled: input.enabled,
      p_reason: input.reason,
    });
    if (error) throw error;
  },

  async getMyAccess(projectId: string, constructionSiteId?: string | null): Promise<MySensitiveAccess> {
    const { data, error } = await supabase.rpc('get_my_project_sensitive_access', {
      p_project_id: projectId,
      p_construction_site_id: constructionSiteId || null,
    });
    if (error) throw error;
    return { finance: Boolean(data?.finance), contract: Boolean(data?.contract) };
  },

  /** Every project the signed-in user may view, for lists and exports. */
  async getMyScope(): Promise<MySensitiveScope> {
    const { data, error } = await supabase.rpc('get_my_sensitive_view_scope');
    if (error) throw error;
    return { finance: mapScope(data?.finance), contract: mapScope(data?.contract) };
  },
};
