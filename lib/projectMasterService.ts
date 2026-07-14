import { Project, ProjectDeleteImpact, ProjectDeleteImpactItem } from '../types';
import { logApiError } from './apiError';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

const TABLE = 'projects';

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const normalizeCode = (name: string) => {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 18);
  const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `PRJ-${base || crypto.randomUUID().slice(0, 8).toUpperCase()}-${suffix}`;
};

const mapProject = (row: any): Project => fromDb(row) as Project;

type ProjectListOptions = {
  includeHidden?: boolean;
};

export type ProjectListSortKey = 'updatedAt' | 'code' | 'name' | 'startDate';

export type ProjectListPageOptions = ProjectListOptions & {
  page?: number;
  pageSize?: number;
  query?: string;
  status?: Project['status'] | 'all';
  groupId?: string;
  typeId?: string;
  sectorId?: string;
  workflowId?: string;
  siteLink?: 'all' | 'linked' | 'unlinked';
  startFrom?: string;
  startTo?: string;
  endFrom?: string;
  endTo?: string;
  hidden?: 'active' | 'hidden' | 'all';
  sort?: ProjectListSortKey;
  ascending?: boolean;
  includeTotal?: boolean;
};

export type ProjectListPage = {
  rows: Project[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
};

type HideProjectInput = {
  reason: string;
  hiddenBy?: string;
  force?: boolean;
  constructionSiteId?: string | null;
};

type ImpactSpec = {
  key: string;
  label: string;
  table: string;
  amountColumns?: string[];
  statusIn?: string[];
};

const PROJECT_IMPACT_SPECS: ImpactSpec[] = [
  { key: 'project_transactions', label: 'Giao dịch dự án', table: 'project_transactions', amountColumns: ['amount'] },
  { key: 'project_cost_actuals', label: 'Chi phí thực tế', table: 'project_cost_actuals', amountColumns: ['amount'] },
  { key: 'payment_certificates', label: 'Chứng từ thanh toán', table: 'payment_certificates', amountColumns: ['current_payable_amount', 'current_completed_value', 'total_completed_value'] },
  { key: 'quantity_acceptances', label: 'Nghiệm thu khối lượng', table: 'quantity_acceptances', amountColumns: ['total_accepted_amount'] },
  { key: 'advance_payments', label: 'Tạm ứng', table: 'advance_payments', amountColumns: ['amount'] },
  { key: 'purchase_orders', label: 'PO đã nhận hàng', table: 'purchase_orders', amountColumns: ['total_amount'], statusIn: ['partial', 'delivered'] },
  { key: 'daily_logs', label: 'Nhật ký công trường', table: 'daily_logs' },
  { key: 'daily_log_labor', label: 'Chi phí nhân công nhật ký', table: 'daily_log_labor', amountColumns: ['total_cost'] },
  { key: 'daily_log_machines', label: 'Chi phí máy thi công nhật ký', table: 'daily_log_machines', amountColumns: ['total_cost'] },
  { key: 'daily_log_materials', label: 'Vật tư trong nhật ký', table: 'daily_log_materials' },
];

const isMissingSchemaError = (error: any): boolean => {
  const raw = [error?.message, error?.details, error?.hint, error?.code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return raw.includes('does not exist') || raw.includes('schema cache') || raw.includes('pgrst205') || raw.includes('42p01') || raw.includes('42703');
};

const buildImpactSelect = (spec: ImpactSpec): string =>
  ['id', ...(spec.statusIn?.length ? ['status'] : []), ...(spec.amountColumns || [])].join(',');

const getRowAmount = (row: Record<string, any>, amountColumns?: string[]): number => {
  for (const column of amountColumns || []) {
    const value = Number(row[column] || 0);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return 0;
};

const normalizePage = (value?: number): number =>
  Math.max(1, Math.floor(Number(value) || 1));

const normalizePageSize = (value?: number): number =>
  Math.max(1, Math.min(100, Math.floor(Number(value) || 10)));

const escapeIlikeValue = (value: string): string =>
  value.replace(/[%_]/g, match => `\\${match}`);

const projectSortColumnByKey: Record<ProjectListSortKey, string> = {
  updatedAt: 'updated_at',
  code: 'code',
  name: 'name',
  startDate: 'start_date',
};

const applyProjectListFilters = (baseQuery: any, options: ProjectListPageOptions) => {
  let query = baseQuery;
  const hidden = options.hidden || (options.includeHidden ? 'all' : 'active');

  if (hidden === 'active') query = query.eq('is_hidden', false);
  if (hidden === 'hidden') query = query.eq('is_hidden', true);
  if (options.status && options.status !== 'all') query = query.eq('status', options.status);
  if (options.groupId && options.groupId !== 'all') query = query.eq('project_group_id', options.groupId);
  if (options.typeId && options.typeId !== 'all') query = query.eq('project_type_id', options.typeId);
  if (options.sectorId && options.sectorId !== 'all') query = query.eq('project_sector_id', options.sectorId);
  if (options.workflowId && options.workflowId !== 'all') query = query.eq('workflow_template_id', options.workflowId);
  if (options.siteLink === 'linked') query = query.not('construction_site_id', 'is', null);
  if (options.siteLink === 'unlinked') query = query.is('construction_site_id', null);
  if (options.startFrom) query = query.gte('start_date', options.startFrom);
  if (options.startTo) query = query.lte('start_date', options.startTo);
  if (options.endFrom) query = query.gte('end_date', options.endFrom);
  if (options.endTo) query = query.lte('end_date', options.endTo);

  const keyword = options.query?.trim();
  if (keyword) {
    const term = `%${escapeIlikeValue(keyword)}%`;
    query = query.or([
      `code.ilike.${term}`,
      `name.ilike.${term}`,
      `client_name.ilike.${term}`,
      `description.ilike.${term}`,
    ].join(','));
  }

  return query;
};

const applyProjectListOrder = (baseQuery: any, options: ProjectListPageOptions) => {
  const sort = options.sort && projectSortColumnByKey[options.sort] ? options.sort : 'updatedAt';
  const ascending = Boolean(options.ascending);
  let query = baseQuery
    .order('is_pinned', { ascending: false })
    .order('pinned_at', { ascending: false, nullsFirst: false });

  if (sort === 'updatedAt') {
    return query.order('updated_at', { ascending });
  }

  return query
    .order(projectSortColumnByKey[sort], { ascending, nullsFirst: false })
    .order('updated_at', { ascending: false });
};

const runScopedImpactQuery = async (
  spec: ImpactSpec,
  projectId: string,
  constructionSiteId?: string | null,
  scopeMode: 'project-or-site' | 'project' | 'site-snake' | 'site-camel' = 'project-or-site',
) => {
  let query: any = supabase.from(spec.table).select(buildImpactSelect(spec));

  if (spec.statusIn?.length) query = query.in('status', spec.statusIn);

  if (scopeMode === 'project-or-site' && constructionSiteId) {
    query = query.or(`project_id.eq.${projectId},construction_site_id.eq.${constructionSiteId}`);
  } else if (scopeMode === 'site-snake' && constructionSiteId) {
    query = query.eq('construction_site_id', constructionSiteId);
  } else if (scopeMode === 'site-camel' && constructionSiteId) {
    query = query.eq('constructionSiteId', constructionSiteId);
  } else {
    query = query.eq('project_id', projectId);
  }

  return query;
};

const fetchImpactItem = async (
  spec: ImpactSpec,
  projectId: string,
  constructionSiteId?: string | null,
): Promise<{ item?: ProjectDeleteImpactItem; warning?: string }> => {
  if (!isSupabaseConfigured) return {};
  const scopeModes: Array<'project-or-site' | 'project' | 'site-snake' | 'site-camel'> = constructionSiteId
    ? ['project-or-site', 'project', 'site-snake', 'site-camel']
    : ['project'];

  let lastError: any = null;
  for (const scopeMode of scopeModes) {
    const { data, error } = await runScopedImpactQuery(spec, projectId, constructionSiteId, scopeMode);
    if (!error) {
      const rows = data || [];
      const count = rows.length;
      const totalAmount = rows.reduce((sum, row) => sum + getRowAmount(row as Record<string, any>, spec.amountColumns), 0);
      if (count === 0) return {};
      return {
        item: {
          key: spec.key,
          label: spec.label,
          count,
          totalAmount,
        },
      };
    }
    lastError = error;
    if (!isMissingSchemaError(error)) break;
  }

  logApiError(`projectMasterService.impact.${spec.table}`, lastError);
  return {
    warning: `${spec.label}: chưa kiểm tra được do schema hiện tại chưa đồng bộ.`,
  };
};

export const projectMasterService = {
  async listPage(options: ProjectListPageOptions = {}): Promise<ProjectListPage> {
    if (!isSupabaseConfigured) {
      return {
        rows: [],
        page: normalizePage(options.page),
        pageSize: normalizePageSize(options.pageSize),
        total: 0,
        hasNextPage: false,
      };
    }

    const page = normalizePage(options.page);
    const pageSize = normalizePageSize(options.pageSize);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const readTo = options.includeTotal ? to : from + pageSize;
    const buildQuery = (includePinnedOrder: boolean) => {
      let query = options.includeTotal
        ? supabase.from(TABLE).select('*', { count: 'exact' })
        : supabase.from(TABLE).select('*');
      query = applyProjectListFilters(query, options);
      return includePinnedOrder
        ? applyProjectListOrder(query, options).range(from, readTo)
        : query.order('updated_at', { ascending: Boolean(options.ascending) }).range(from, readTo);
    };

    const { data, error, count } = await buildQuery(true);
    let rowsData = data || [];
    let totalCount = count || 0;
    if (error && !isMissingSchemaError(error)) throw error;
    if (error) {
      const fallback = await buildQuery(false);
      if (fallback.error) throw fallback.error;
      rowsData = fallback.data || [];
      totalCount = fallback.count || 0;
    }
    const hasExtraRow = !options.includeTotal && rowsData.length > pageSize;
    const pageRows = hasExtraRow ? rowsData.slice(0, pageSize) : rowsData;
    const total = options.includeTotal
      ? Number(totalCount || 0)
      : from + pageRows.length + (hasExtraRow ? 1 : 0);
    const hasNextPage = options.includeTotal
      ? from + pageRows.length < total
      : hasExtraRow;

    return {
      rows: pageRows.map(mapProject),
      page,
      pageSize,
      total,
      hasNextPage,
    };
  },

  async list(options: ProjectListOptions = {}): Promise<Project[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (error && !isMissingSchemaError(error)) throw error;
    let rowsData = data || [];
    if (error) {
      const fallback = await supabase.from(TABLE).select('*').order('updated_at', { ascending: false });
      if (fallback.error) throw fallback.error;
      rowsData = fallback.data || [];
    }
    const rows = rowsData.map(mapProject);
    return options.includeHidden ? rows : rows.filter(project => !project.isHidden);
  },

  async getById(id: string): Promise<Project | null> {
    if (!isSupabaseConfigured || !id) return null;
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProject(data) : null;
  },

  async create(input: {
    name: string;
    code?: string;
    description?: string;
    clientName?: string;
    projectType?: Project['projectType'];
    projectGroupId?: string | null;
    projectTypeId?: string | null;
    projectSectorId?: string | null;
    workflowTemplateId?: string | null;
    status?: Project['status'];
    constructionSiteId?: string | null;
    managerId?: string;
    startDate?: string;
    endDate?: string;
    progressCalculationMode?: Project['progressCalculationMode'];
    manualProgressPercent?: number;
    createdBy?: string;
  }): Promise<Project> {
    if (!isSupabaseConfigured) {
      return {
        id: crypto.randomUUID(),
        code: input.code || normalizeCode(input.name),
        name: input.name,
        description: input.description,
        clientName: input.clientName,
        projectType: input.projectType || 'construction',
        projectGroupId: input.projectGroupId || null,
        projectTypeId: input.projectTypeId || null,
        projectSectorId: input.projectSectorId || null,
        workflowTemplateId: input.workflowTemplateId || null,
        status: input.status || 'planning',
        constructionSiteId: input.constructionSiteId || null,
        managerId: input.managerId,
        startDate: input.startDate,
        endDate: input.endDate,
        progressCalculationMode: input.progressCalculationMode || 'gantt_weighted',
        manualProgressPercent: input.manualProgressPercent || 0,
        createdBy: input.createdBy,
        source: 'manual',
        isPinned: false,
        isHidden: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const payload = cleanUndefined(toDb({
      code: input.code || normalizeCode(input.name),
      name: input.name,
      description: input.description || null,
      clientName: input.clientName || null,
      projectType: input.projectType || 'construction',
      projectGroupId: input.projectGroupId || null,
      projectTypeId: input.projectTypeId || null,
      projectSectorId: input.projectSectorId || null,
      workflowTemplateId: input.workflowTemplateId || null,
      status: input.status || 'planning',
      constructionSiteId: input.constructionSiteId || null,
      managerId: input.managerId || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      progressCalculationMode: input.progressCalculationMode || 'gantt_weighted',
      manualProgressPercent: input.manualProgressPercent || 0,
      createdBy: input.createdBy || null,
      source: 'manual',
    }));

    const { data, error } = await supabase.rpc('create_project', {
      p_project: payload,
    });
    if (error) throw error;
    return mapProject(data);
  },

  async update(project: Project): Promise<Project> {
    if (!isSupabaseConfigured) return { ...project, updatedAt: new Date().toISOString() };
    const payload = cleanUndefined(toDb({
      code: project.code,
      name: project.name,
      description: project.description || null,
      clientName: project.clientName || null,
      projectType: project.projectType || 'construction',
      projectGroupId: project.projectGroupId || null,
      projectTypeId: project.projectTypeId || null,
      projectSectorId: project.projectSectorId || null,
      workflowTemplateId: project.workflowTemplateId || null,
      status: project.status || 'planning',
      constructionSiteId: project.constructionSiteId || null,
      managerId: project.managerId || null,
      startDate: project.startDate || null,
      endDate: project.endDate || null,
      progressCalculationMode: project.progressCalculationMode || 'gantt_weighted',
      manualProgressPercent: project.manualProgressPercent || 0,
      ...(project.isPinned !== undefined ? { isPinned: project.isPinned } : {}),
      ...(project.pinnedAt !== undefined ? { pinnedAt: project.pinnedAt || null } : {}),
      ...(project.pinnedBy !== undefined ? { pinnedBy: project.pinnedBy || null } : {}),
      ...(project.isHidden !== undefined ? { isHidden: project.isHidden } : {}),
      ...(project.hiddenAt !== undefined ? { hiddenAt: project.hiddenAt || null } : {}),
      ...(project.hiddenBy !== undefined ? { hiddenBy: project.hiddenBy || null } : {}),
      ...(project.hiddenReason !== undefined ? { hiddenReason: project.hiddenReason || null } : {}),
    }));

    const { data, error } = await supabase.rpc('update_project', {
      p_project_id: project.id,
      p_project: payload,
    });
    if (error) throw error;
    return mapProject(data);
  },

  async setPinned(projectId: string, pinned: boolean, pinnedBy?: string): Promise<Project> {
    if (!isSupabaseConfigured) {
      return {
        id: projectId,
        code: projectId,
        name: projectId,
        projectType: 'construction',
        status: 'planning',
        isPinned: pinned,
        pinnedAt: pinned ? new Date().toISOString() : undefined,
        pinnedBy: pinned ? pinnedBy : undefined,
        source: 'manual',
      };
    }

    const { data, error } = await supabase.rpc('update_project', {
      p_project_id: projectId,
      p_project: {
        is_pinned: pinned,
        pinned_at: pinned ? new Date().toISOString() : null,
        pinned_by: pinned ? pinnedBy || null : null,
      },
    });
    if (error) throw error;
    return mapProject(data);
  },

  async getDeleteImpact(projectId: string, constructionSiteId?: string | null): Promise<ProjectDeleteImpact> {
    const empty: ProjectDeleteImpact = {
      projectId,
      constructionSiteId,
      items: [],
      totalRows: 0,
      totalAmount: 0,
      hasImpact: false,
      warnings: [],
    };
    if (!isSupabaseConfigured) return empty;

    const results = await Promise.all(PROJECT_IMPACT_SPECS.map(spec => fetchImpactItem(spec, projectId, constructionSiteId)));
    const items = results.map(result => result.item).filter(Boolean) as ProjectDeleteImpactItem[];
    const warnings = results.map(result => result.warning).filter(Boolean) as string[];
    const totalRows = items.reduce((sum, item) => sum + item.count, 0);
    const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);

    return {
      projectId,
      constructionSiteId,
      items,
      totalRows,
      totalAmount,
      hasImpact: totalRows > 0,
      warnings,
    };
  },

  async hide(projectId: string, input: HideProjectInput): Promise<Project> {
    if (!isSupabaseConfigured) {
      return {
        id: projectId,
        code: projectId,
        name: projectId,
        projectType: 'construction',
        status: 'cancelled',
        isHidden: true,
        hiddenAt: new Date().toISOString(),
        hiddenBy: input.hiddenBy,
        hiddenReason: input.reason,
        source: 'manual',
      };
    }

    if (!input.force) {
      const impact = await this.getDeleteImpact(projectId, input.constructionSiteId);
      if (impact.hasImpact) {
        throw new Error('Dự án đã có phát sinh chi phí nên chỉ Admin mới có thể force ẩn sau khi xác nhận.');
      }
    }

    const { data, error } = await supabase.rpc('hide_project', {
      p_project_id: projectId,
      p_reason: input.reason.trim(),
      p_hidden_by: input.hiddenBy || null,
      p_force: Boolean(input.force),
      p_construction_site_id: input.constructionSiteId || null,
    });
    if (error) throw error;
    return mapProject(data);
  },

  async restore(projectId: string): Promise<Project> {
    if (!isSupabaseConfigured) {
      return {
        id: projectId,
        code: projectId,
        name: projectId,
        projectType: 'construction',
        status: 'planning',
        isHidden: false,
        source: 'manual',
      };
    }
    const { data, error } = await supabase.rpc('restore_project', {
      p_project_id: projectId,
    });
    if (error) throw error;
    return mapProject(data);
  },
};
