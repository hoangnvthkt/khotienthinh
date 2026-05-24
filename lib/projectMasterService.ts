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

    const { data, error } = await supabase
      .from(TABLE)
      .insert(payload)
      .select('*')
      .single();
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

    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq('id', project.id)
      .select('*')
      .single();
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

    const { data, error } = await supabase
      .from(TABLE)
      .update({
        is_pinned: pinned,
        pinned_at: pinned ? new Date().toISOString() : null,
        pinned_by: pinned ? pinnedBy || null : null,
      })
      .eq('id', projectId)
      .select('*')
      .single();
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

    const { data, error } = await supabase
      .from(TABLE)
      .update({
        is_hidden: true,
        hidden_at: new Date().toISOString(),
        hidden_by: input.hiddenBy || null,
        hidden_reason: input.reason.trim(),
      })
      .eq('id', projectId)
      .select('*')
      .single();
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
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        is_hidden: false,
        hidden_at: null,
        hidden_by: null,
        hidden_reason: null,
      })
      .eq('id', projectId)
      .select('*')
      .single();
    if (error) throw error;
    return mapProject(data);
  },
};
