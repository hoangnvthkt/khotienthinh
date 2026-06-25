import { supabase } from './supabase';
import { fromDb, toDb } from './dbMapping';
import { notificationService } from './notificationService';
import {
  SafetyAttachment,
  SafetyComment,
  SafetyContractorStatus,
  SafetyDashboardSummary,
  SafetyEquipment,
  SafetyEquipmentDocument,
  SafetyEquipmentStatus,
  SafetyInspection,
  SafetyInspectionItem,
  SafetyInspectionResult,
  SafetyIssue,
  SafetyIssueStatus,
  SafetyIssueType,
  SafetySeverity,
  SafetySubcontractor,
  SafetyTeam,
} from '../types';
import { SAFETY_ISSUE_STATUS_LABELS, SAFETY_SEVERITY_LABELS } from './safetyWorkflow';

const BUCKET = 'project-safety-attachments';
const ISSUE_TABLE = 'safety_issues';
const COMMENT_TABLE = 'safety_issue_comments';
const LOG_TABLE = 'safety_issue_status_logs';
const INSPECTION_TABLE = 'safety_inspections';
const INSPECTION_ITEM_TABLE = 'safety_inspection_items';
const CONTRACTOR_TABLE = 'safety_subcontractors';
const EQUIPMENT_TABLE = 'safety_equipment';
const EQUIPMENT_DOCUMENT_TABLE = 'safety_equipment_documents';
const TEAM_TABLE = 'safety_teams';

const todayIso = () => new Date().toISOString().slice(0, 10);

const safeStorageFileName = (name: string): string => {
  const safe = name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'safety-file';
};

const asArray = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];

const omitUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const isImageAttachment = (attachment: SafetyAttachment) =>
  String(attachment.fileType || attachment.name || '').toLowerCase().match(/image|\.png|\.jpe?g|\.webp|\.gif/);

async function signAttachment(attachment: SafetyAttachment): Promise<SafetyAttachment> {
  const storagePath = attachment.storagePath || (!/^https?:\/\//i.test(attachment.url || '') ? attachment.url : undefined);
  if (!storagePath) return attachment;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);
  return {
    ...attachment,
    storagePath,
    url: data?.signedUrl || attachment.url,
    previewUrl: data?.signedUrl || attachment.previewUrl,
  };
}

const signAttachments = async (attachments?: SafetyAttachment[] | null): Promise<SafetyAttachment[]> =>
  Promise.all(asArray(attachments).map(signAttachment));

async function hydrateIssue(row: any): Promise<SafetyIssue> {
  const item = fromDb(row) as SafetyIssue;
  return {
    ...item,
    beforePhotos: await signAttachments(item.beforePhotos),
    afterPhotos: await signAttachments(item.afterPhotos),
    attachments: await signAttachments(item.attachments),
  };
}

async function hydrateInspection(row: any): Promise<SafetyInspection> {
  const item = fromDb(row) as SafetyInspection;
  return { ...item, attachments: await signAttachments(item.attachments) };
}

async function hydrateInspectionItem(row: any): Promise<SafetyInspectionItem> {
  const item = fromDb(row) as SafetyInspectionItem;
  return { ...item, photos: await signAttachments(item.photos) };
}

async function hydrateComment(row: any): Promise<SafetyComment> {
  const item = fromDb(row) as SafetyComment;
  return { ...item, attachments: await signAttachments(item.attachments) };
}

const isUuid = (value?: string | null): value is string =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const getSafetyEquipmentDocumentsStatus = (
  checklist?: Array<Pick<SafetyEquipmentDocument, 'isDone'>>,
): SafetyEquipment['documentsStatus'] => {
  const items = asArray(checklist);
  if (items.length === 0) return 'missing';
  return items.every(item => item.isDone) ? 'complete' : 'partial';
};

async function hydrateEquipmentDocument(row: any): Promise<SafetyEquipmentDocument> {
  const item = fromDb(row) as SafetyEquipmentDocument;
  return { ...item, attachments: await signAttachments(item.attachments) };
}

async function hydrateEquipment(row: any, documentChecklist: SafetyEquipmentDocument[] = []): Promise<SafetyEquipment> {
  const item = fromDb(row) as SafetyEquipment;
  return {
    ...item,
    documentChecklist,
    attachments: await signAttachments(item.attachments),
  };
}

async function hydrateContractor(row: any): Promise<SafetySubcontractor> {
  const item = fromDb(row) as SafetySubcontractor;
  return { ...item, attachments: await signAttachments(item.attachments) };
}

async function hydrateTeam(row: any): Promise<SafetyTeam> {
  const item = fromDb(row) as SafetyTeam;
  return { ...item, attachments: await signAttachments(item.attachments) };
}

const scopeQuery = <T extends { eq: (column: string, value: string) => T }>(
  query: T,
  projectId?: string | null,
  constructionSiteId?: string | null,
) => {
  let scoped = query;
  if (projectId) scoped = scoped.eq('project_id', projectId);
  if (constructionSiteId) scoped = scoped.eq('construction_site_id', constructionSiteId);
  return scoped;
};

async function nextCode(table: string, prefix: string, projectId: string): Promise<string> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if (error) throw error;
  return `${prefix}-${String((count || 0) + 1).padStart(4, '0')}`;
}

async function notifySafety(params: {
  projectId?: string | null;
  constructionSiteId?: string | null;
  sourceType: string;
  sourceId: string;
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'critical';
  recipientIds?: string[];
  actorId?: string | null;
  metadata?: Record<string, any>;
}) {
  const metadata = {
    projectId: params.projectId,
    constructionSiteId: params.constructionSiteId,
    safetyId: params.sourceId,
    safetyView: params.sourceType.replace('safety_', ''),
    ...(params.metadata || {}),
  };

  if (params.recipientIds?.length) {
    await notificationService.notifyProjectUsers({
      recipientIds: params.recipientIds,
      actorId: params.actorId,
      type: params.severity === 'critical' ? 'error' : params.severity === 'warning' ? 'warning' : 'info',
      category: 'safety',
      title: params.title,
      message: params.message,
      severity: params.severity || 'info',
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      constructionSiteId: params.constructionSiteId || undefined,
      link: '/da',
      metadata,
    });
    return;
  }

  if (params.severity === 'critical') {
    await notificationService.create({
      userId: undefined,
      type: 'error',
      category: 'safety',
      title: params.title,
      message: params.message,
      severity: 'critical',
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      constructionSiteId: params.constructionSiteId || undefined,
      link: '/da',
      metadata,
    });
  }
}

export interface SafetyIssueFilters {
  search?: string;
  status?: SafetyIssueStatus | 'all';
  severity?: SafetySeverity | 'all';
  type?: SafetyIssueType | 'all';
  assignedToUserId?: string | 'all';
}

export const safetyService = {
  async getDashboardSummary(projectId: string, constructionSiteId?: string | null): Promise<SafetyDashboardSummary> {
    const today = todayIso();
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const [issuesRes, inspectionsRes, equipmentRes, contractorsRes] = await Promise.all([
      scopeQuery(
        supabase
          .from(ISSUE_TABLE)
          .select('id,code,title,status,severity,area,due_at,assigned_to_name,created_at')
          .order('created_at', { ascending: false })
          .limit(250),
        projectId,
        constructionSiteId,
      ),
      scopeQuery(
        supabase
          .from(INSPECTION_TABLE)
          .select('id,status,inspection_date,score')
          .gte('inspection_date', today)
          .lte('inspection_date', today)
          .limit(100),
        projectId,
        constructionSiteId,
      ),
      scopeQuery(
        supabase
          .from(EQUIPMENT_TABLE)
          .select('id,name,equipment_code,status,inspection_expiry_date')
          .or(`inspection_expiry_date.lte.${in30Days},status.eq.expired`)
          .limit(100),
        projectId,
        constructionSiteId,
      ),
      scopeQuery(
        supabase
          .from(CONTRACTOR_TABLE)
          .select('id,name,status,documents_status,violation_count')
          .limit(100),
        projectId,
        constructionSiteId,
      ),
    ]);

    if (issuesRes.error) throw issuesRes.error;
    if (inspectionsRes.error) throw inspectionsRes.error;
    if (equipmentRes.error) throw equipmentRes.error;
    if (contractorsRes.error) throw contractorsRes.error;

    const issues = (issuesRes.data || []) as any[];
    const inspections = (inspectionsRes.data || []) as any[];
    const equipment = (equipmentRes.data || []) as any[];
    const contractors = (contractorsRes.data || []) as any[];

    const openIssues = issues.filter(issue => !['closed', 'resolved'].includes(issue.status)).length;
    const highRiskIssues = issues.filter(issue => issue.severity === 'high' && !['closed', 'resolved'].includes(issue.status)).length;
    const criticalIssues = issues.filter(issue => issue.severity === 'critical' && !['closed', 'resolved'].includes(issue.status)).length;
    const dueTodayInspections = inspections.length;
    const completedTodayInspections = inspections.filter(item => item.status === 'completed').length;
    const expiredEquipment = equipment.filter(item => item.status === 'expired' || (item.inspection_expiry_date && item.inspection_expiry_date < today)).length;
    const expiringEquipment = equipment.filter(item => item.inspection_expiry_date && item.inspection_expiry_date >= today && item.inspection_expiry_date <= in30Days).length;
    const contractorsMissingDocs = contractors.filter(item => item.documents_status !== 'complete' || item.status === 'pending_documents').length;

    const areaCounts = issues.reduce<Record<string, number>>((acc, issue) => {
      const key = issue.area || 'Chưa rõ khu vực';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const penalty = openIssues * 2 + highRiskIssues * 6 + criticalIssues * 12 + expiredEquipment * 8 + contractorsMissingDocs * 4;
    const safetyScore = Math.max(0, Math.min(100, 100 - penalty));

    const issueActions = issues
      .filter(issue => !['closed', 'resolved'].includes(issue.status))
      .sort((a, b) => {
        const score = (issue: any) => (issue.severity === 'critical' ? 0 : issue.severity === 'high' ? 1 : 2);
        return score(a) - score(b) || new Date(a.due_at || a.created_at).getTime() - new Date(b.due_at || b.created_at).getTime();
      })
      .slice(0, 8)
      .map(issue => ({
        id: issue.id,
        title: issue.title,
        code: issue.code,
        status: issue.status,
        severity: issue.severity as SafetySeverity,
        dueAt: issue.due_at,
        actorName: issue.assigned_to_name,
        sourceType: 'safety_issue' as const,
      }));

    const equipmentActions = equipment
      .filter(item => item.status === 'expired' || (item.inspection_expiry_date && item.inspection_expiry_date <= in30Days))
      .slice(0, Math.max(0, 8 - issueActions.length))
      .map(item => ({
        id: item.id,
        title: item.name,
        code: item.equipment_code,
        status: item.status,
        dueAt: item.inspection_expiry_date,
        sourceType: 'safety_equipment' as const,
      }));

    return {
      safetyScore,
      openIssues,
      highRiskIssues,
      criticalIssues,
      dueTodayInspections,
      completedTodayInspections,
      expiringEquipment,
      expiredEquipment,
      untrainedWorkers: 0,
      contractorsMissingDocs,
      topRiskAreas: Object.entries(areaCounts)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      nextActions: [...issueActions, ...equipmentActions],
    };
  },

  async listIssues(params: {
    projectId: string;
    constructionSiteId?: string | null;
    filters?: SafetyIssueFilters;
    page?: number;
    pageSize?: number;
    includeTotal?: boolean;
  }): Promise<{ items: SafetyIssue[]; count: number; hasNextPage: boolean }> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 25;
    const from = (page - 1) * pageSize;
    const readTo = params.includeTotal ? from + pageSize - 1 : from + pageSize;
    const baseIssueQuery = params.includeTotal
      ? supabase.from(ISSUE_TABLE).select('*', { count: 'exact' })
      : supabase.from(ISSUE_TABLE).select('*');
    let query = scopeQuery(
      baseIssueQuery.order('created_at', { ascending: false }),
      params.projectId,
      params.constructionSiteId,
    );

    const filters = params.filters || {};
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.severity && filters.severity !== 'all') query = query.eq('severity', filters.severity);
    if (filters.type && filters.type !== 'all') query = query.eq('type', filters.type);
    if (filters.assignedToUserId && filters.assignedToUserId !== 'all') query = query.eq('assigned_to_user_id', filters.assignedToUserId);
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      query = query.or(`title.ilike.%${term}%,code.ilike.%${term}%,area.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error, count } = await query.range(from, readTo);
    if (error) throw error;
    const rows = data || [];
    const hasExtraRow = !params.includeTotal && rows.length > pageSize;
    const pageRows = hasExtraRow ? rows.slice(0, pageSize) : rows;
    const hasNextPage = params.includeTotal
      ? from + pageRows.length < Number(count || 0)
      : hasExtraRow;
    return {
      items: await Promise.all(pageRows.map(hydrateIssue)),
      count: params.includeTotal ? Number(count || 0) : from + pageRows.length + (hasNextPage ? 1 : 0),
      hasNextPage,
    };
  },

  async createIssue(input: Partial<SafetyIssue> & {
    projectId: string;
    title: string;
    createdBy?: string;
    actorName?: string;
  }): Promise<SafetyIssue> {
    const code = input.code || await nextCode(ISSUE_TABLE, 'SAFE', input.projectId);
    const status: SafetyIssueStatus = input.assignedToUserId ? 'assigned' : (input.status || 'new');
    const payload = toDb({
      ...input,
      code,
      status,
      beforePhotos: input.beforePhotos || [],
      afterPhotos: input.afterPhotos || [],
      attachments: input.attachments || [],
      severity: input.severity || 'medium',
      type: input.type || 'hazard',
    });
    delete payload.id;
    delete payload.actor_name;
    const { data, error } = await supabase.from(ISSUE_TABLE).insert(payload).select().single();
    if (error) throw error;
    const issue = await hydrateIssue(data);

    const severity = issue.severity === 'critical' || issue.severity === 'high'
      ? (issue.severity === 'critical' ? 'critical' : 'warning')
      : 'info';
    await notifySafety({
      projectId: issue.projectId,
      constructionSiteId: issue.constructionSiteId,
      sourceType: 'safety_issue',
      sourceId: issue.id,
      title: `${SAFETY_SEVERITY_LABELS[issue.severity]}: ${issue.title}`,
      message: issue.assignedToName
        ? `${issue.code} đã giao cho ${issue.assignedToName}.`
        : `${issue.code} vừa được ghi nhận tại ${issue.area || 'công trường'}.`,
      severity,
      recipientIds: issue.assignedToUserId ? [issue.assignedToUserId] : undefined,
      actorId: input.createdBy,
      metadata: { safetyView: 'issues' },
    }).catch(error => console.warn('Cannot create safety notification', error));

    return issue;
  },

  async updateIssue(id: string, updates: Partial<SafetyIssue>): Promise<SafetyIssue> {
    const payload = toDb(updates);
    delete payload.id;
    const { data, error } = await supabase.from(ISSUE_TABLE).update(payload).eq('id', id).select().single();
    if (error) throw error;
    return hydrateIssue(data);
  },

  async setIssueStatus(id: string, status: SafetyIssueStatus, actorId?: string, reason?: string): Promise<SafetyIssue> {
    const now = new Date().toISOString();
    const updates: Partial<SafetyIssue> = { status };
    if (status === 'resolved') updates.resolvedAt = now;
    if (status === 'closed') updates.closedAt = now;
    const issue = await this.updateIssue(id, updates);
    if (reason?.trim()) {
      await supabase.from(LOG_TABLE).insert({
        project_id: issue.projectId,
        construction_site_id: issue.constructionSiteId,
        issue_id: id,
        from_status: null,
        to_status: status,
        reason: reason.trim(),
        metadata: { event: 'manual_reason' },
        created_by: actorId || null,
      });
    }
    await notifySafety({
      projectId: issue.projectId,
      constructionSiteId: issue.constructionSiteId,
      sourceType: 'safety_issue',
      sourceId: issue.id,
      title: `Cập nhật an toàn ${issue.code}`,
      message: `${issue.title} chuyển sang ${SAFETY_ISSUE_STATUS_LABELS[status]}.`,
      severity: status === 'overdue' ? 'critical' : 'info',
      recipientIds: issue.assignedToUserId ? [issue.assignedToUserId] : undefined,
      actorId,
      metadata: { safetyView: 'issues' },
    }).catch(error => console.warn('Cannot notify safety status', error));
    return issue;
  },

  async removeDraftIssue(id: string): Promise<void> {
    const { error } = await supabase.from(ISSUE_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async listComments(issueId: string): Promise<SafetyComment[]> {
    const { data, error } = await supabase
      .from(COMMENT_TABLE)
      .select('*')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return Promise.all((data || []).map(hydrateComment));
  },

  async listStatusLogs(issueId: string) {
    const { data, error } = await supabase
      .from(LOG_TABLE)
      .select('*')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async addComment(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    issueId: string;
    body: string;
    attachments?: SafetyAttachment[];
    createdBy?: string;
    createdByName?: string;
  }): Promise<SafetyComment> {
    const payload = toDb({ ...input, attachments: input.attachments || [] });
    const { data, error } = await supabase.from(COMMENT_TABLE).insert(payload).select().single();
    if (error) throw error;
    return hydrateComment(data);
  },

  async listInspections(projectId: string, constructionSiteId?: string | null): Promise<SafetyInspection[]> {
    const { data, error } = await scopeQuery(
      supabase
        .from(INSPECTION_TABLE)
        .select('*')
        .order('inspection_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100),
      projectId,
      constructionSiteId,
    );
    if (error) throw error;
    return Promise.all((data || []).map(hydrateInspection));
  },

  async getInspectionItems(inspectionId: string): Promise<SafetyInspectionItem[]> {
    const { data, error } = await supabase
      .from(INSPECTION_ITEM_TABLE)
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return Promise.all((data || []).map(hydrateInspectionItem));
  },

  async createInspection(input: Partial<SafetyInspection> & {
    projectId: string;
    items?: Array<Partial<SafetyInspectionItem> & { itemName: string }>;
  }): Promise<{ inspection: SafetyInspection; items: SafetyInspectionItem[] }> {
    const code = input.code || await nextCode(INSPECTION_TABLE, 'SI', input.projectId);
    const inspectionPayload = toDb({
      ...input,
      code,
      status: input.status || 'draft',
      inspectionDate: input.inspectionDate || todayIso(),
      attachments: input.attachments || [],
    });
    delete inspectionPayload.id;
    delete inspectionPayload.items;
    const { data, error } = await supabase.from(INSPECTION_TABLE).insert(inspectionPayload).select().single();
    if (error) throw error;
    const inspection = await hydrateInspection(data);

    const itemInputs = input.items?.length ? input.items : [
      { itemName: 'Khu vực làm việc sạch sẽ, không có nguy cơ vấp ngã', result: 'na' as SafetyInspectionResult },
      { itemName: 'Công nhân sử dụng PPE đúng quy định', result: 'na' as SafetyInspectionResult },
      { itemName: 'Thiết bị/máy móc có hồ sơ kiểm định hợp lệ', result: 'na' as SafetyInspectionResult },
    ];

    const itemPayloads = itemInputs.map((item, index) => toDb({
      ...item,
      projectId: input.projectId,
      constructionSiteId: input.constructionSiteId || null,
      inspectionId: inspection.id,
      result: item.result || 'na',
      riskLevel: item.riskLevel || 'medium',
      photos: item.photos || [],
      sortOrder: item.sortOrder ?? index + 1,
      createdBy: input.createdBy,
    }));
    const { data: itemRows, error: itemError } = await supabase.from(INSPECTION_ITEM_TABLE).insert(itemPayloads).select();
    if (itemError) throw itemError;
    return {
      inspection,
      items: await Promise.all((itemRows || []).map(hydrateInspectionItem)),
    };
  },

  async updateInspection(id: string, updates: Partial<SafetyInspection>): Promise<SafetyInspection> {
    const payload = toDb(updates);
    delete payload.id;
    const { data, error } = await supabase.from(INSPECTION_TABLE).update(payload).eq('id', id).select().single();
    if (error) throw error;
    return hydrateInspection(data);
  },

  async updateInspectionItem(id: string, updates: Partial<SafetyInspectionItem>): Promise<SafetyInspectionItem> {
    const payload = toDb(updates);
    delete payload.id;
    const { data, error } = await supabase.from(INSPECTION_ITEM_TABLE).update(payload).eq('id', id).select().single();
    if (error) throw error;
    return hydrateInspectionItem(data);
  },

  async completeInspection(inspectionId: string): Promise<SafetyInspection> {
    const items = await this.getInspectionItems(inspectionId);
    const doneItems = items.filter(item => item.result !== 'na');
    const passed = items.filter(item => item.result === 'pass').length;
    const score = doneItems.length ? Math.round((passed / doneItems.length) * 100) : 0;
    return this.updateInspection(inspectionId, { status: 'completed', score });
  },

  async createIssueFromInspectionItem(inspection: SafetyInspection, item: SafetyInspectionItem, actorId?: string): Promise<SafetyIssue> {
    const issue = await this.createIssue({
      projectId: inspection.projectId || item.projectId || '',
      constructionSiteId: inspection.constructionSiteId || item.constructionSiteId || null,
      title: item.itemName,
      type: 'hazard',
      severity: item.riskLevel,
      status: item.assignedToUserId ? 'assigned' : 'new',
      area: inspection.area,
      description: item.note || item.requirement || '',
      beforePhotos: item.photos || [],
      assignedToUserId: item.assignedToUserId,
      assignedToName: item.assignedToName,
      dueAt: item.dueAt,
      sourceInspectionId: inspection.id,
      sourceInspectionItemId: item.id,
      createdBy: actorId,
    });
    await this.updateInspectionItem(item.id, { generatedIssueId: issue.id });
    return issue;
  },

  async listContractors(projectId: string, constructionSiteId?: string | null): Promise<SafetySubcontractor[]> {
    const { data, error } = await scopeQuery(
      supabase.from(CONTRACTOR_TABLE).select('*').order('created_at', { ascending: false }).limit(100),
      projectId,
      constructionSiteId,
    );
    if (error) throw error;
    return Promise.all((data || []).map(hydrateContractor));
  },

  async upsertContractor(input: Partial<SafetySubcontractor> & { projectId: string; name: string }): Promise<SafetySubcontractor> {
    const payload = toDb({
      ...input,
      status: input.status || 'pending_documents',
      documentsStatus: input.documentsStatus || 'missing',
      violationCount: input.violationCount || 0,
      attachments: input.attachments || [],
    });
    let result;
    if (input.id) result = await supabase.from(CONTRACTOR_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(CONTRACTOR_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    const contractor = await hydrateContractor(result.data);
    if (contractor.documentsStatus !== 'complete') {
      await notifySafety({
        projectId: contractor.projectId,
        constructionSiteId: contractor.constructionSiteId,
        sourceType: 'safety_subcontractor',
        sourceId: contractor.id,
        title: 'Nhà thầu phụ thiếu hồ sơ an toàn',
        message: `${contractor.name} cần bổ sung hồ sơ trước khi thi công.`,
        severity: 'warning',
        metadata: { safetyView: 'contractors' },
      }).catch(error => console.warn('Cannot notify contractor safety', error));
    }
    return contractor;
  },

  async deleteContractor(id: string): Promise<void> {
    const { error } = await supabase.from(CONTRACTOR_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async listEquipment(projectId: string, constructionSiteId?: string | null): Promise<SafetyEquipment[]> {
    const { data, error } = await scopeQuery(
      supabase.from(EQUIPMENT_TABLE).select('*').order('created_at', { ascending: false }).limit(100),
      projectId,
      constructionSiteId,
    );
    if (error) throw error;
    const rows = data || [];
    const equipmentIds = rows.map(row => row.id).filter(Boolean);
    const documentsByEquipment = new Map<string, SafetyEquipmentDocument[]>();

    if (equipmentIds.length > 0) {
      const { data: documentRows, error: documentError } = await supabase
        .from(EQUIPMENT_DOCUMENT_TABLE)
        .select('*')
        .in('equipment_id', equipmentIds)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (documentError) throw documentError;
      const documents = await Promise.all((documentRows || []).map(hydrateEquipmentDocument));
      documents.forEach(document => {
        const current = documentsByEquipment.get(document.equipmentId) || [];
        current.push(document);
        documentsByEquipment.set(document.equipmentId, current);
      });
    }

    return Promise.all(rows.map(row => hydrateEquipment(row, documentsByEquipment.get(row.id) || [])));
  },

  async upsertEquipment(input: Partial<SafetyEquipment> & { projectId: string; name: string }): Promise<SafetyEquipment> {
    const checklistInput = Array.isArray(input.documentChecklist)
      ? input.documentChecklist
        .map((item, index) => ({
          ...item,
          name: String(item.name || '').trim(),
          documentType: String(item.documentType || 'missing_document'),
          sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
          isDone: Boolean(item.isDone),
        }))
        .filter(item => item.name)
      : undefined;
    const payload = toDb(omitUndefined({
      ...input,
      status: input.status || 'pending_review',
      documentsStatus: checklistInput ? getSafetyEquipmentDocumentsStatus(checklistInput) : input.documentsStatus || 'missing',
      attachments: input.attachments || [],
      documentChecklist: undefined,
    }));
    delete payload.document_checklist;
    let result;
    if (input.id) result = await supabase.from(EQUIPMENT_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(EQUIPMENT_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    const equipmentId = result.data.id;

    if (checklistInput) {
      const { error: deleteError } = await supabase
        .from(EQUIPMENT_DOCUMENT_TABLE)
        .delete()
        .eq('equipment_id', equipmentId);
      if (deleteError) throw deleteError;

      if (checklistInput.length > 0) {
        const { error: insertError } = await supabase
          .from(EQUIPMENT_DOCUMENT_TABLE)
          .insert(checklistInput.map((item, index) => toDb(omitUndefined({
            id: isUuid(item.id) ? item.id : undefined,
            projectId: input.projectId,
            constructionSiteId: input.constructionSiteId || null,
            equipmentId,
            documentType: item.documentType || 'missing_document',
            name: item.name,
            status: item.isDone ? 'submitted' : 'missing',
            isDone: item.isDone,
            doneBy: item.isDone ? item.doneBy || input.createdBy || null : null,
            doneAt: item.isDone ? item.doneAt || new Date().toISOString() : null,
            sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
            attachments: item.attachments || [],
            note: item.note || null,
            createdBy: item.createdBy || input.createdBy || null,
          }))));
        if (insertError) throw insertError;
      }
    }

    const { data: freshRow, error: freshError } = await supabase
      .from(EQUIPMENT_TABLE)
      .select('*')
      .eq('id', equipmentId)
      .single();
    if (freshError) throw freshError;

    const { data: documentRows, error: documentError } = await supabase
      .from(EQUIPMENT_DOCUMENT_TABLE)
      .select('*')
      .eq('equipment_id', equipmentId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (documentError) throw documentError;

    const equipment = await hydrateEquipment(
      freshRow,
      await Promise.all((documentRows || []).map(hydrateEquipmentDocument)),
    );
    const expiry = equipment.inspectionExpiryDate;
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    if (expiry && (expiry <= in30Days || equipment.status === 'expired')) {
      await notifySafety({
        projectId: equipment.projectId,
        constructionSiteId: equipment.constructionSiteId,
        sourceType: 'safety_equipment',
        sourceId: equipment.id,
        title: 'Thiết bị cần kiểm tra hồ sơ an toàn',
        message: `${equipment.name} ${expiry < todayIso() ? 'đã hết hạn' : 'sắp hết hạn'} kiểm định.`,
        severity: expiry < todayIso() ? 'critical' : 'warning',
        metadata: { safetyView: 'equipment' },
      }).catch(error => console.warn('Cannot notify equipment safety', error));
    }
    return equipment;
  },

  async toggleEquipmentDocumentChecklistItem(
    item: Pick<SafetyEquipmentDocument, 'id'>,
    nextDone: boolean,
    currentUserId: string,
  ): Promise<SafetyEquipmentDocument> {
    const { data, error } = await supabase
      .from(EQUIPMENT_DOCUMENT_TABLE)
      .update(toDb({
        isDone: nextDone,
        doneBy: nextDone ? currentUserId : null,
        doneAt: nextDone ? new Date().toISOString() : null,
        status: nextDone ? 'submitted' : 'missing',
      }))
      .eq('id', item.id)
      .select()
      .single();
    if (error) throw error;
    return hydrateEquipmentDocument(data);
  },

  async deleteEquipment(id: string): Promise<void> {
    const { error } = await supabase.from(EQUIPMENT_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async deleteInspection(id: string): Promise<void> {
    const { error: itemsError } = await supabase.from(INSPECTION_ITEM_TABLE).delete().eq('inspection_id', id);
    if (itemsError) throw itemsError;
    const { error } = await supabase.from(INSPECTION_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async listTeams(projectId: string, constructionSiteId?: string | null): Promise<SafetyTeam[]> {
    const { data, error } = await scopeQuery(
      supabase.from(TEAM_TABLE).select('*').order('created_at', { ascending: false }).limit(100),
      projectId,
      constructionSiteId,
    );
    if (error) throw error;
    return Promise.all((data || []).map(hydrateTeam));
  },

  async upsertTeam(input: Partial<SafetyTeam> & { projectId: string; name: string }): Promise<SafetyTeam> {
    const payload = toDb({
      ...input,
      status: input.status || 'active',
      attachments: input.attachments || [],
    });
    let result;
    if (input.id) result = await supabase.from(TEAM_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(TEAM_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    return hydrateTeam(result.data);
  },

  async deleteTeam(id: string): Promise<void> {
    const { error } = await supabase.from(TEAM_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async uploadAttachment(params: {
    projectId: string;
    recordType: string;
    recordId: string;
    file: File;
    uploadedBy?: string;
    category?: string;
  }): Promise<SafetyAttachment> {
    const storagePath = [
      params.projectId,
      params.recordType,
      params.recordId,
      `${Date.now()}-${safeStorageFileName(params.file.name)}`,
    ].join('/');
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, params.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: params.file.type || undefined,
    });
    if (error) throw error;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);
    return {
      id: crypto.randomUUID(),
      name: params.file.name,
      fileName: params.file.name,
      url: data?.signedUrl || storagePath,
      previewUrl: isImageAttachment({ name: params.file.name, url: storagePath, fileType: params.file.type }) ? data?.signedUrl : undefined,
      storagePath,
      fileType: params.file.type,
      fileSize: params.file.size,
      category: params.category,
      uploadedAt: new Date().toISOString(),
      uploadedBy: params.uploadedBy,
    };
  },

  isImageAttachment,
};
