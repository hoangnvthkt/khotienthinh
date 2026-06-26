import { supabase } from './supabase';
import { fromDb, toDb } from './dbMapping';
import {
  SafetyAttachment,
  SafetyCard,
  SafetyCardPrintLog,
  SafetyCardTemplate,
  SafetyCertificateType,
  SafetyPassportAssignmentStatus,
  SafetyPassportCertificateStatus,
  SafetyPassportContractor,
  SafetyPassportDashboard,
  SafetyProjectAssignment,
  SafetySiteInduction,
  SafetyWorkerCertificate,
  SafetyWorkerDocument,
  SafetyWorkerProfile,
} from '../types';

const BUCKET = 'safety-passport-attachments';

const CONTRACTOR_TABLE = 'safety_contractors';
const WORKER_TABLE = 'safety_worker_profiles';
const DOCUMENT_TABLE = 'safety_worker_documents';
const CERTIFICATE_TYPE_TABLE = 'safety_certificate_types';
const CERTIFICATE_TABLE = 'safety_worker_certificates';
const ASSIGNMENT_TABLE = 'safety_project_assignments';
const INDUCTION_TABLE = 'safety_site_inductions';
const CARD_TABLE = 'safety_cards';
const TEMPLATE_TABLE = 'safety_card_templates';
const PRINT_LOG_TABLE = 'safety_card_print_logs';
const AUDIT_TABLE = 'safety_audit_logs';

const todayIso = () => new Date().toISOString().slice(0, 10);

const inDaysIso = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const asArray = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];

const omitUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

export const getSafetyCertificateStatus = (
  certificate: Pick<SafetyWorkerCertificate, 'expiryDate' | 'status'>,
): SafetyPassportCertificateStatus => {
  if (certificate.status === 'rejected') return 'rejected';
  if (certificate.status === 'revoked') return 'revoked';
  if (!certificate.expiryDate) return 'valid';
  if (certificate.expiryDate < todayIso()) return 'expired';
  if (certificate.expiryDate <= inDaysIso(30)) return 'expiring_soon';
  return 'valid';
};

export const getSafetyAssignmentStatusLabel = (status: SafetyPassportAssignmentStatus): string => {
  switch (status) {
    case 'eligible': return 'Đủ điều kiện';
    case 'missing_profile': return 'Thiếu hồ sơ';
    case 'missing_certificate': return 'Thiếu chứng chỉ';
    case 'expired_certificate': return 'Hết hạn chứng chỉ';
    case 'missing_site_requirement': return 'Thiếu yêu cầu công trình';
    case 'suspended': return 'Tạm khóa';
    default: return status;
  }
};

export const buildSafetyCardQrPath = (qrToken: string): string => `/safety-card/${qrToken}`;

export const buildSafetyCardQrUrl = (qrToken: string): string => {
  const base = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`;
  return `${base}#${buildSafetyCardQrPath(qrToken)}`;
};

const safeStorageFileName = (name: string): string => {
  const safe = name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'safety-passport-file';
};

async function signAttachment(attachment?: SafetyAttachment | null): Promise<SafetyAttachment | null> {
  if (!attachment) return null;
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
  Promise.all(asArray(attachments).map(item => signAttachment(item) as Promise<SafetyAttachment>));

const mapContractor = (row: any): SafetyPassportContractor => fromDb(row) as SafetyPassportContractor;

async function mapWorker(row: any): Promise<SafetyWorkerProfile> {
  const item = fromDb(row) as SafetyWorkerProfile;
  return {
    ...item,
    photoAttachment: await signAttachment(item.photoAttachment),
    identityAttachments: await signAttachments(item.identityAttachments),
  };
}

async function mapDocument(row: any): Promise<SafetyWorkerDocument> {
  const item = fromDb(row) as SafetyWorkerDocument;
  return { ...item, attachments: await signAttachments(item.attachments) };
}

const mapCertificateType = (row: any): SafetyCertificateType => fromDb(row) as SafetyCertificateType;

async function mapCertificate(row: any, typeMap = new Map<string, SafetyCertificateType>()): Promise<SafetyWorkerCertificate> {
  const item = fromDb(row) as SafetyWorkerCertificate;
  const certificateType = item.certificateType || typeMap.get(item.certificateTypeId) || null;
  return {
    ...item,
    certificateType,
    computedStatus: getSafetyCertificateStatus(item),
    attachments: await signAttachments(item.attachments),
  };
}

const mapAssignment = (
  row: any,
  workerMap = new Map<string, SafetyWorkerProfile>(),
  contractorMap = new Map<string, SafetyPassportContractor>(),
): SafetyProjectAssignment => {
  const item = fromDb(row) as SafetyProjectAssignment;
  return {
    ...item,
    worker: item.worker || workerMap.get(item.workerId) || null,
    contractor: item.contractor || (item.contractorId ? contractorMap.get(item.contractorId) || null : null),
  };
};

const mapTemplate = (row: any): SafetyCardTemplate => fromDb(row) as SafetyCardTemplate;

const mapCard = (
  row: any,
  workerMap = new Map<string, SafetyWorkerProfile>(),
  assignmentMap = new Map<string, SafetyProjectAssignment>(),
  contractorMap = new Map<string, SafetyPassportContractor>(),
): SafetyCard => {
  const item = fromDb(row) as SafetyCard;
  return {
    ...item,
    worker: item.worker || workerMap.get(item.workerId) || null,
    assignment: item.assignment || assignmentMap.get(item.assignmentId) || null,
    contractor: item.contractor || (item.contractorId ? contractorMap.get(item.contractorId) || null : null),
  };
};

const nextCode = async (table: string, prefix: string): Promise<string> => {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw error;
  return `${prefix}-${String((count || 0) + 1).padStart(5, '0')}`;
};

async function logAudit(action: string, targetType: string, targetId?: string | null, metadata?: Record<string, any>) {
  await supabase.from(AUDIT_TABLE).insert(toDb({
    action,
    targetType,
    targetId: targetId || null,
    metadata: metadata || {},
  })).throwOnError();
}

async function loadWorkersByIds(ids: string[]): Promise<Map<string, SafetyWorkerProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from(WORKER_TABLE).select('*').in('id', ids);
  if (error) throw error;
  const workers = await Promise.all((data || []).map(mapWorker));
  return new Map(workers.map(item => [item.id, item]));
}

async function loadContractorsByIds(ids: string[]): Promise<Map<string, SafetyPassportContractor>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from(CONTRACTOR_TABLE).select('*').in('id', ids);
  if (error) throw error;
  const rows = (data || []).map(mapContractor);
  return new Map(rows.map(item => [item.id, item]));
}

async function loadAssignmentsByIds(ids: string[]): Promise<Map<string, SafetyProjectAssignment>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from(ASSIGNMENT_TABLE).select('*').in('id', ids);
  if (error) throw error;
  const workerMap = await loadWorkersByIds([...(new Set((data || []).map((row: any) => row.worker_id).filter(Boolean)))]);
  const contractorMap = await loadContractorsByIds([...(new Set((data || []).map((row: any) => row.contractor_id).filter(Boolean)))]);
  const rows = (data || []).map(row => mapAssignment(row, workerMap, contractorMap));
  return new Map(rows.map(item => [item.id, item]));
}

export const safetyPassportService = {
  async uploadAttachment(params: {
    workerId?: string;
    cardId?: string;
    category: string;
    file: File;
    uploadedBy?: string;
  }): Promise<SafetyAttachment> {
    const owner = params.workerId || params.cardId || 'shared';
    const storagePath = [
      owner,
      params.category,
      `${Date.now()}-${safeStorageFileName(params.file.name)}`,
    ].join('/');
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, params.file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    const attachment: SafetyAttachment = {
      id: crypto.randomUUID(),
      name: params.file.name,
      fileName: params.file.name,
      url: storagePath,
      storagePath,
      fileType: params.file.type,
      fileSize: params.file.size,
      category: params.category,
      uploadedAt: new Date().toISOString(),
      uploadedBy: params.uploadedBy,
    };
    return (await signAttachment(attachment)) || attachment;
  },

  async listDashboard(projectId: string, constructionSiteId?: string | null): Promise<SafetyPassportDashboard> {
    const [workersRes, certsRes, cardsRes, contractorsRes] = await Promise.all([
      supabase.from(WORKER_TABLE).select('id,status,contractor_id'),
      supabase.from(CERTIFICATE_TABLE).select('*').order('expiry_date', { ascending: true }).limit(500),
      supabase.from(CARD_TABLE).select('*').eq('project_id', projectId).order('expires_at', { ascending: true }).limit(500),
      supabase.from(CONTRACTOR_TABLE).select('*'),
    ]);

    if ((workersRes as any)?.error) throw (workersRes as any).error;

    const assignmentQuery = supabase.from(ASSIGNMENT_TABLE).select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1000);
    if (constructionSiteId) assignmentQuery.eq('construction_site_id', constructionSiteId);
    const { data: assignmentRows, error: assignmentError } = await assignmentQuery;
    if (assignmentError) throw assignmentError;

    if ((certsRes as any).error) throw (certsRes as any).error;
    if ((cardsRes as any).error) throw (cardsRes as any).error;
    if ((contractorsRes as any).error) throw (contractorsRes as any).error;

    const typeRows = await this.listCertificateTypes();
    const typeMap = new Map<string, SafetyCertificateType>(typeRows.map(item => [item.id, item]));
    const certificates = await Promise.all((((certsRes as any).data || []) as any[]).map(row => mapCertificate(row, typeMap)));
    const contractors = ((contractorsRes as any).data || []).map(mapContractor);
    const contractorMap = new Map(contractors.map(item => [item.id, item]));
    const assignments = (assignmentRows || []).map(row => mapAssignment(row));
    const cards = ((cardsRes as any).data || []).map((row: any) => mapCard(row));
    const contractorIssueCounts = new Map<string, number>();
    assignments
      .filter(item => item.eligibilityStatus !== 'eligible')
      .forEach(item => {
        if (!item.contractorId) return;
        contractorIssueCounts.set(item.contractorId, (contractorIssueCounts.get(item.contractorId) || 0) + 1);
      });

    const certExpiring7 = certificates.filter(item => item.expiryDate && item.expiryDate >= todayIso() && item.expiryDate <= inDaysIso(7));
    const certExpiring30 = certificates.filter(item => item.expiryDate && item.expiryDate >= todayIso() && item.expiryDate <= inDaysIso(30));

    return {
      totalWorkers: ((workersRes as any).data || []).length,
      totalAssignments: assignments.length,
      eligibleAssignments: assignments.filter(item => item.eligibilityStatus === 'eligible').length,
      missingProfile: assignments.filter(item => item.eligibilityStatus === 'missing_profile').length,
      missingCertificate: assignments.filter(item => item.eligibilityStatus === 'missing_certificate').length,
      expiredCertificate: assignments.filter(item => item.eligibilityStatus === 'expired_certificate').length,
      missingSiteRequirement: assignments.filter(item => item.eligibilityStatus === 'missing_site_requirement').length,
      suspendedAssignments: assignments.filter(item => item.eligibilityStatus === 'suspended').length,
      expiringCertificates7Days: certExpiring7,
      expiringCertificates30Days: certExpiring30,
      expiredCertificates: certificates.filter(item => item.computedStatus === 'expired'),
      expiringCards30Days: cards.filter(item => item.expiresAt >= todayIso() && item.expiresAt <= inDaysIso(30)),
      problematicContractors: [...contractorIssueCounts.entries()]
        .map(([contractorId, issueCount]) => ({ contractor: contractorMap.get(contractorId), issueCount }))
        .filter((row): row is { contractor: SafetyPassportContractor; issueCount: number } => !!row.contractor)
        .sort((a, b) => b.issueCount - a.issueCount)
        .slice(0, 5),
    };
  },

  async listContractors(): Promise<SafetyPassportContractor[]> {
    const { data, error } = await supabase.from(CONTRACTOR_TABLE).select('*').order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapContractor);
  },

  async upsertContractor(input: Partial<SafetyPassportContractor> & { name: string }): Promise<SafetyPassportContractor> {
    const payload = toDb(omitUndefined({
      ...input,
      contractorType: input.contractorType || 'subcontractor',
      status: input.status || 'active',
    }));
    let result;
    if (input.id) result = await supabase.from(CONTRACTOR_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(CONTRACTOR_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    await logAudit(input.id ? 'contractor.update' : 'contractor.create', 'safety_contractors', result.data.id).catch(() => undefined);
    return mapContractor(result.data);
  },

  async listCertificateTypes(): Promise<SafetyCertificateType[]> {
    const { data, error } = await supabase.from(CERTIFICATE_TYPE_TABLE).select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapCertificateType);
  },

  async listWorkers(): Promise<SafetyWorkerProfile[]> {
    const { data, error } = await supabase.from(WORKER_TABLE).select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const rows = await Promise.all((data || []).map(mapWorker));
    const contractorMap = await loadContractorsByIds([...(new Set(rows.map(row => row.contractorId).filter(Boolean) as string[]))]);
    return rows.map(row => ({ ...row, contractor: row.contractorId ? contractorMap.get(row.contractorId) || null : null }));
  },

  async getWorkerProfile(workerId: string): Promise<SafetyWorkerProfile | null> {
    const { data, error } = await supabase.from(WORKER_TABLE).select('*').eq('id', workerId).maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const worker = await mapWorker(data);
    const [documentsRes, types, certsRes, assignmentsRes] = await Promise.all([
      supabase.from(DOCUMENT_TABLE).select('*').eq('worker_id', workerId).order('created_at', { ascending: false }),
      this.listCertificateTypes(),
      supabase.from(CERTIFICATE_TABLE).select('*').eq('worker_id', workerId).order('expiry_date', { ascending: true }),
      supabase.from(ASSIGNMENT_TABLE).select('*').eq('worker_id', workerId).order('created_at', { ascending: false }),
    ]);

    if (documentsRes.error) throw documentsRes.error;
    if (certsRes.error) throw certsRes.error;
    if (assignmentsRes.error) throw assignmentsRes.error;

    const typeMap = new Map<string, SafetyCertificateType>(types.map(item => [item.id, item]));
    const contractorMap = await loadContractorsByIds([
      worker.contractorId,
      ...((assignmentsRes.data || []).map((row: any) => row.contractor_id)),
    ].filter(Boolean) as string[]);

    return {
      ...worker,
      contractor: worker.contractorId ? contractorMap.get(worker.contractorId) || null : null,
      documents: await Promise.all((documentsRes.data || []).map(mapDocument)),
      certificates: await Promise.all((certsRes.data || []).map(row => mapCertificate(row, typeMap))),
      assignments: (assignmentsRes.data || []).map(row => mapAssignment(row, new Map([[worker.id, worker]]), contractorMap)),
    };
  },

  async upsertWorkerProfile(input: Partial<SafetyWorkerProfile> & { fullName: string }): Promise<SafetyWorkerProfile> {
    const workerCode = input.workerCode?.trim() || await nextCode(WORKER_TABLE, 'WKR');
    const payload = toDb(omitUndefined({
      ...input,
      workerCode,
      status: input.status || 'active',
      identityType: input.identityType || 'cccd',
      identityAttachments: input.identityAttachments || [],
      documents: undefined,
      certificates: undefined,
      assignments: undefined,
      contractor: undefined,
    }));
    delete payload.documents;
    delete payload.certificates;
    delete payload.assignments;
    delete payload.contractor;

    let result;
    if (input.id) result = await supabase.from(WORKER_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(WORKER_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    await logAudit(input.id ? 'worker.update' : 'worker.create', 'safety_worker_profiles', result.data.id).catch(() => undefined);
    return mapWorker(result.data);
  },

  async upsertWorkerDocument(input: Partial<SafetyWorkerDocument> & { workerId: string; name: string }): Promise<SafetyWorkerDocument> {
    const payload = toDb(omitUndefined({
      ...input,
      documentType: input.documentType || 'other',
      status: input.status || 'submitted',
      attachments: input.attachments || [],
      isRequired: input.isRequired || false,
    }));
    let result;
    if (input.id) result = await supabase.from(DOCUMENT_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(DOCUMENT_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    await logAudit(input.id ? 'document.update' : 'document.create', 'safety_worker_documents', result.data.id, { workerId: input.workerId }).catch(() => undefined);
    return mapDocument(result.data);
  },

  async upsertWorkerCertificate(input: Partial<SafetyWorkerCertificate> & { workerId: string; certificateTypeId: string }): Promise<SafetyWorkerCertificate> {
    const payload = toDb(omitUndefined({
      ...input,
      status: input.status || 'submitted',
      attachments: input.attachments || [],
      certificateType: undefined,
      computedStatus: undefined,
    }));
    delete payload.certificate_type;
    delete payload.computed_status;
    let result;
    if (input.id) result = await supabase.from(CERTIFICATE_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(CERTIFICATE_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    const typeMap = new Map<string, SafetyCertificateType>((await this.listCertificateTypes()).map(item => [item.id, item]));
    await logAudit(input.id ? 'certificate.update' : 'certificate.create', 'safety_worker_certificates', result.data.id, { workerId: input.workerId }).catch(() => undefined);
    return mapCertificate(result.data, typeMap);
  },

  async assignWorkerToProject(input: Partial<SafetyProjectAssignment> & { workerId: string; projectId: string }): Promise<SafetyProjectAssignment> {
    const payload = toDb(omitUndefined({
      ...input,
      siteTrainingStatus: input.siteTrainingStatus || 'pending',
      commitmentStatus: input.commitmentStatus || 'pending',
      ppeStatus: input.ppeStatus || 'missing',
      toolboxStatus: input.toolboxStatus || 'pending',
      isLocked: input.isLocked || false,
      eligibilityStatus: input.eligibilityStatus || 'missing_profile',
      worker: undefined,
      contractor: undefined,
    }));
    delete payload.worker;
    delete payload.contractor;
    let result;
    if (input.id) result = await supabase.from(ASSIGNMENT_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(ASSIGNMENT_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    await logAudit(input.id ? 'assignment.update' : 'assignment.create', 'safety_project_assignments', result.data.id, { workerId: input.workerId, projectId: input.projectId }).catch(() => undefined);
    return this.recomputeEligibility(result.data.id);
  },

  async listProjectAssignments(projectId: string, constructionSiteId?: string | null): Promise<SafetyProjectAssignment[]> {
    let query = supabase.from(ASSIGNMENT_TABLE).select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(500);
    if (constructionSiteId) query = query.eq('construction_site_id', constructionSiteId);
    const { data, error } = await query;
    if (error) throw error;
    const workerMap = await loadWorkersByIds([...(new Set((data || []).map((row: any) => row.worker_id).filter(Boolean)))]);
    const contractorMap = await loadContractorsByIds([...(new Set((data || []).map((row: any) => row.contractor_id).filter(Boolean)))]);
    return (data || []).map(row => mapAssignment(row, workerMap, contractorMap));
  },

  async updateSiteInduction(input: Partial<SafetySiteInduction> & { assignmentId: string; trainingType: SafetySiteInduction['trainingType'] }): Promise<SafetySiteInduction> {
    const payload = toDb(omitUndefined({
      ...input,
      status: input.status || 'completed',
      completedAt: input.completedAt || new Date().toISOString(),
      attachments: input.attachments || [],
    }));
    let result;
    if (input.id) result = await supabase.from(INDUCTION_TABLE).update(payload).eq('id', input.id).select().single();
    else {
      delete payload.id;
      result = await supabase.from(INDUCTION_TABLE).insert(payload).select().single();
    }
    if (result.error) throw result.error;
    await logAudit('induction.upsert', 'safety_site_inductions', result.data.id, { assignmentId: input.assignmentId }).catch(() => undefined);
    return fromDb(result.data) as SafetySiteInduction;
  },

  async recomputeEligibility(assignmentId: string): Promise<SafetyProjectAssignment> {
    const { error: rpcError } = await supabase.rpc('recompute_safety_assignment_eligibility', { p_assignment_id: assignmentId });
    if (rpcError) throw rpcError;
    const { data, error } = await supabase.from(ASSIGNMENT_TABLE).select('*').eq('id', assignmentId).single();
    if (error) throw error;
    const workerMap = await loadWorkersByIds([data.worker_id]);
    const contractorMap = await loadContractorsByIds([data.contractor_id].filter(Boolean) as string[]);
    return mapAssignment(data, workerMap, contractorMap);
  },

  async listCardTemplates(): Promise<SafetyCardTemplate[]> {
    const { data, error } = await supabase.from(TEMPLATE_TABLE).select('*').eq('is_active', true).order('is_default', { ascending: false }).order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapTemplate);
  },

  async issueSafetyCard(input: {
    assignment: SafetyProjectAssignment;
    expiresAt?: string;
    templateId?: string | null;
    createdBy?: string | null;
  }): Promise<SafetyCard> {
    const cardCode = await nextCode(CARD_TABLE, 'SAFE-CARD');
    const expiresAt = input.expiresAt || inDaysIso(365);
    const payload = toDb({
      assignmentId: input.assignment.id,
      workerId: input.assignment.workerId,
      projectId: input.assignment.projectId,
      constructionSiteId: input.assignment.constructionSiteId || null,
      contractorId: input.assignment.contractorId || null,
      templateId: input.templateId || null,
      cardCode,
      expiresAt,
      status: 'active',
      createdBy: input.createdBy || null,
    });
    const { data, error } = await supabase.from(CARD_TABLE).insert(payload).select().single();
    if (error) throw error;
    await logAudit('card.issue', 'safety_cards', data.id, { assignmentId: input.assignment.id }).catch(() => undefined);
    return this.getCardByQrToken(data.qr_token) as Promise<SafetyCard>;
  },

  async listCards(projectId: string, constructionSiteId?: string | null): Promise<SafetyCard[]> {
    let query = supabase.from(CARD_TABLE).select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(500);
    if (constructionSiteId) query = query.eq('construction_site_id', constructionSiteId);
    const { data, error } = await query;
    if (error) throw error;
    const workerMap = await loadWorkersByIds([...(new Set((data || []).map((row: any) => row.worker_id).filter(Boolean)))]);
    const assignmentMap = await loadAssignmentsByIds([...(new Set((data || []).map((row: any) => row.assignment_id).filter(Boolean)))]);
    const contractorMap = await loadContractorsByIds([...(new Set((data || []).map((row: any) => row.contractor_id).filter(Boolean)))]);
    return (data || []).map(row => mapCard(row, workerMap, assignmentMap, contractorMap));
  },

  async getCardByQrToken(qrToken: string): Promise<SafetyCard | null> {
    const { data, error } = await supabase.from(CARD_TABLE).select('*').eq('qr_token', qrToken).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const workerMap = await loadWorkersByIds([data.worker_id]);
    const assignmentMap = await loadAssignmentsByIds([data.assignment_id]);
    const contractorMap = await loadContractorsByIds([data.contractor_id].filter(Boolean) as string[]);
    return mapCard(data, workerMap, assignmentMap, contractorMap);
  },

  async logCardPrint(card: SafetyCard, printedBy?: string | null): Promise<SafetyCardPrintLog> {
    const { data, error } = await supabase.from(PRINT_LOG_TABLE).insert(toDb({
      cardId: card.id,
      printedBy: printedBy || null,
      templateSnapshot: {
        cardCode: card.cardCode,
        workerName: card.worker?.fullName,
        workerCode: card.worker?.workerCode,
        contractor: card.contractor?.name,
        qrToken: card.qrToken,
      },
      metadata: { qrUrl: buildSafetyCardQrUrl(card.qrToken) },
    })).select().single();
    if (error) throw error;
    await logAudit('card.print', 'safety_cards', card.id).catch(() => undefined);
    return fromDb(data) as SafetyCardPrintLog;
  },
};
