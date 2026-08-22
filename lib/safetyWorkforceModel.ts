import type {
  SafetyAttachment,
  SafetyCard,
  SafetyPassportAssignmentStatus,
  SafetyPassportCardStatus,
  SafetyPassportDocumentReadiness,
  SafetyPassportWorkerStatus,
  SafetyProjectAssignment,
  SafetySiteWorkforceOptions,
  SafetyWorkerCertificate,
  SafetyWorkerDetailPayload,
  SafetyWorkerDetailProfile,
  SafetyWorkerDocument,
  SafetyWorkerKind,
  SafetyWorkerLookupResult,
  SafetyWorkerRosterItem,
  SafetyWorkerRosterPage,
  SafetyWorkerSiteMembership,
  SafetyWorkforceCapabilities,
  SafetyWorkforceCursor,
  SafetyWorkforceDashboard,
  SafetyWorkforceErrorCode,
} from '../types';

type JsonRecord = Record<string, unknown>;

const WORKFORCE_ERROR_CODES: readonly SafetyWorkforceErrorCode[] = [
  'SAFETY_SCOPE_REQUIRED',
  'SAFETY_SCOPE_MISMATCH',
  'SAFETY_WORKER_ACTIVE_ELSEWHERE',
  'SAFETY_CONTRACTOR_SCOPE_MISMATCH',
  'SAFETY_TEAM_SCOPE_MISMATCH',
  'SAFETY_ASSIGNMENT_NOT_ELIGIBLE',
  'SAFETY_ACTIVE_CARD_EXISTS',
  'SAFETY_TRANSFER_PERMISSION_REQUIRED',
] as const;

const invalidPayload = (): never => {
  throw new Error('SAFETY_INVALID_RPC_PAYLOAD');
};

const asRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidPayload();
  return value as JsonRecord;
};

const requiredString = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) invalidPayload();
  return value as string;
};

const optionalString = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  return requiredString(value);
};

const nullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return requiredString(value);
};

const requiredNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidPayload();
  return value as number;
};

const requiredBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') invalidPayload();
  return value as boolean;
};

const enumValue = <T extends string>(value: unknown, allowed: readonly T[]): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalidPayload();
  return value as T;
};

const parseAttachment = (value: unknown): SafetyAttachment => {
  const row = asRecord(value);
  const storagePath = optionalString(row.storagePath);
  const url = optionalString(row.url) || storagePath;
  if (!url) invalidPayload();

  return {
    id: optionalString(row.id),
    name: typeof row.name === 'string' && row.name.trim() ? row.name : url.split('/').pop() || 'attachment',
    fileName: optionalString(row.fileName),
    url,
    fileType: optionalString(row.fileType),
    fileSize: row.fileSize === undefined ? undefined : requiredNumber(row.fileSize),
    category: optionalString(row.category),
    uploadedAt: optionalString(row.uploadedAt),
    uploadedBy: optionalString(row.uploadedBy),
    storagePath,
    previewUrl: optionalString(row.previewUrl),
  };
};

const parseAttachments = (value: unknown): SafetyAttachment[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value.map(parseAttachment)
      : invalidPayload();

const parseCapabilities = (value: unknown): SafetyWorkforceCapabilities => {
  const row = asRecord(value);
  return {
    canViewBasic: row.canViewBasic === undefined ? false : requiredBoolean(row.canViewBasic),
    canManageWorker: row.canManageWorker === undefined ? false : requiredBoolean(row.canManageWorker),
    canVerifyDocuments: row.canVerifyDocuments === undefined ? false : requiredBoolean(row.canVerifyDocuments),
  };
};

const parseMembership = (value: unknown): SafetyWorkerSiteMembership => {
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    workerId: requiredString(row.workerId),
    projectId: requiredString(row.projectId),
    constructionSiteId: requiredString(row.constructionSiteId),
    defaultSubcontractorId: nullableString(row.defaultSubcontractorId),
    defaultTeamId: nullableString(row.defaultTeamId),
    status: enumValue(row.status, ['candidate', 'active', 'inactive'] as const),
    firstJoinedAt: requiredString(row.firstJoinedAt),
    lastLeftAt: nullableString(row.lastLeftAt),
    source: enumValue(row.source, ['manual', 'transfer', 'son_mien_bac_backfill_v1'] as const),
  };
};

const parseAssignment = (value: unknown): SafetyProjectAssignment => {
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    workerId: requiredString(row.workerId),
    membershipId: requiredString(row.membershipId),
    projectId: nullableString(row.projectId),
    constructionSiteId: nullableString(row.constructionSiteId),
    contractorId: nullableString(row.contractorId),
    subcontractorId: nullableString(row.subcontractorId),
    subcontractorName: nullableString(row.subcontractorName),
    teamId: nullableString(row.teamId),
    teamName: nullableString(row.teamName),
    roleName: nullableString(row.roleName),
    workType: nullableString(row.workType),
    siteAccessCardCode: nullableString(row.siteAccessCardCode),
    startDate: requiredString(row.startDate),
    endDate: nullableString(row.endDate),
    assignmentStatus: enumValue(row.assignmentStatus, ['active', 'ended', 'suspended', 'cancelled'] as const),
    startedAt: requiredString(row.startedAt),
    endedAt: nullableString(row.endedAt),
    endedBy: nullableString(row.endedBy),
    endedReason: nullableString(row.endedReason),
    source: enumValue(row.source, ['manual', 'legacy', 'transfer', 'son_mien_bac_backfill_v1'] as const),
    siteTrainingStatus: enumValue(row.siteTrainingStatus, ['pending', 'completed', 'expired'] as const),
    commitmentStatus: enumValue(row.commitmentStatus, ['pending', 'signed'] as const),
    ppeStatus: enumValue(row.ppeStatus, ['missing', 'partial', 'complete'] as const),
    toolboxStatus: enumValue(row.toolboxStatus, ['pending', 'completed', 'expired'] as const),
    isLocked: requiredBoolean(row.isLocked),
    lockReason: nullableString(row.lockReason),
    eligibilityStatus: enumValue<SafetyPassportAssignmentStatus>(row.eligibilityStatus, [
      'eligible',
      'missing_profile',
      'missing_certificate',
      'expired_certificate',
      'missing_site_requirement',
      'suspended',
    ]),
    eligibilityCheckedAt: nullableString(row.eligibilityCheckedAt),
    createdBy: nullableString(row.createdBy),
    createdAt: optionalString(row.createdAt),
    updatedAt: optionalString(row.updatedAt),
  };
};

export const parseSafetyCard = (value: unknown): SafetyCard => {
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    assignmentId: requiredString(row.assignmentId),
    workerId: requiredString(row.workerId),
    projectId: nullableString(row.projectId),
    constructionSiteId: nullableString(row.constructionSiteId),
    contractorId: nullableString(row.contractorId),
    templateId: nullableString(row.templateId),
    cardCode: requiredString(row.cardCode),
    qrToken: requiredString(row.qrToken),
    issuedAt: requiredString(row.issuedAt),
    expiresAt: requiredString(row.expiresAt),
    status: enumValue<SafetyPassportCardStatus>(row.status, ['draft', 'active', 'expired', 'revoked']),
    printedCount: requiredNumber(row.printedCount),
    revokedReason: nullableString(row.revokedReason),
    createdBy: nullableString(row.createdBy),
    createdAt: optionalString(row.createdAt),
    updatedAt: optionalString(row.updatedAt),
  };
};

const parseScopedSubcontractor = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    name: requiredString(row.name),
    code: nullableString(row.code),
    status: enumValue(row.status, ['pending_documents', 'approved', 'active', 'suspended', 'completed'] as const),
  };
};

const parseScopedTeam = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    name: requiredString(row.name),
    code: nullableString(row.code),
    status: enumValue(row.status, ['active', 'inactive', 'suspended'] as const),
  };
};

const parseRosterWorker = (value: unknown): SafetyWorkerRosterItem['worker'] => {
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    workerCode: requiredString(row.workerCode),
    fullName: requiredString(row.fullName),
    workerKind: enumValue<SafetyWorkerKind>(row.workerKind, ['company_staff', 'contractor_worker']),
    phone: nullableString(row.phone),
    status: enumValue<SafetyPassportWorkerStatus>(row.status, ['active', 'suspended', 'inactive']),
    photoStoragePath: nullableString(row.photoStoragePath),
    ...(row.photoUrl === undefined ? {} : { photoUrl: nullableString(row.photoUrl) }),
  };
};

const parseReadiness = (value: unknown): SafetyPassportDocumentReadiness =>
  enumValue<SafetyPassportDocumentReadiness>(value, ['missing', 'valid', 'expired', 'rejected']);

const parseRosterItem = (value: unknown): SafetyWorkerRosterItem => {
  const row = asRecord(value);
  const membership = parseMembership(row.membership);
  const worker = parseRosterWorker(row.worker);
  if (membership.workerId !== worker.id) invalidPayload();

  return {
    membership,
    worker,
    subcontractor: parseScopedSubcontractor(row.subcontractor),
    team: parseScopedTeam(row.team),
    activeAssignment: row.activeAssignment === null || row.activeAssignment === undefined
      ? null
      : parseAssignment(row.activeAssignment),
    activeCard: row.activeCard === null || row.activeCard === undefined ? null : parseSafetyCard(row.activeCard),
    identityNumberMasked: requiredString(row.identityNumberMasked),
    profileStatus: parseReadiness(row.profileStatus),
    healthStatus: parseReadiness(row.healthStatus),
    insuranceStatus: parseReadiness(row.insuranceStatus),
  };
};

const parseCursor = (value: unknown): SafetyWorkforceCursor | null => {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  return { createdAt: requiredString(row.createdAt), id: requiredString(row.id) };
};

const parseDocument = (value: unknown): SafetyWorkerDocument => {
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    workerId: requiredString(row.workerId),
    documentType: requiredString(row.documentType),
    name: requiredString(row.name),
    issueDate: nullableString(row.issueDate),
    expiryDate: nullableString(row.expiryDate),
    attachments: parseAttachments(row.attachments),
    status: enumValue(row.status, ['missing', 'submitted', 'approved', 'rejected', 'expired'] as const),
    isRequired: requiredBoolean(row.isRequired),
    note: nullableString(row.note),
    createdBy: nullableString(row.createdBy),
    createdAt: optionalString(row.createdAt),
    updatedAt: optionalString(row.updatedAt),
  };
};

const parseCertificate = (value: unknown): SafetyWorkerCertificate => {
  const row = asRecord(value);
  return {
    id: requiredString(row.id),
    workerId: requiredString(row.workerId),
    certificateTypeId: requiredString(row.certificateTypeId),
    certificateNo: nullableString(row.certificateNo),
    issueDate: nullableString(row.issueDate),
    expiryDate: nullableString(row.expiryDate),
    attachments: parseAttachments(row.attachments),
    status: enumValue(row.status, ['submitted', 'approved', 'rejected', 'revoked'] as const),
    computedStatus: enumValue(row.computedStatus, ['valid', 'expiring_soon', 'expired', 'rejected', 'revoked'] as const),
    verifiedBy: nullableString(row.verifiedBy),
    verifiedAt: nullableString(row.verifiedAt),
    note: nullableString(row.note),
    createdBy: nullableString(row.createdBy),
    createdAt: optionalString(row.createdAt),
    updatedAt: optionalString(row.updatedAt),
  };
};

const parseDetailProfile = (value: unknown): SafetyWorkerDetailProfile => {
  const row = asRecord(value);
  const profile: SafetyWorkerDetailProfile = {
    id: requiredString(row.id),
    workerCode: requiredString(row.workerCode),
    fullName: requiredString(row.fullName),
    workerKind: enumValue<SafetyWorkerKind>(row.workerKind, ['company_staff', 'contractor_worker']),
    phone: nullableString(row.phone),
    dateOfBirth: nullableString(row.dateOfBirth),
    roleName: nullableString(row.roleName),
    status: enumValue<SafetyPassportWorkerStatus>(row.status, ['active', 'suspended', 'inactive']),
    photoAttachment: row.photoAttachment === null || row.photoAttachment === undefined
      ? null
      : parseAttachment(row.photoAttachment),
  };

  if (row.identityType !== undefined) profile.identityType = enumValue(row.identityType, ['cccd', 'passport', 'other'] as const);
  if (row.identityNumber !== undefined) profile.identityNumber = nullableString(row.identityNumber);
  if (row.identityIssueDate !== undefined) profile.identityIssueDate = nullableString(row.identityIssueDate);
  if (row.identityIssuePlace !== undefined) profile.identityIssuePlace = nullableString(row.identityIssuePlace);
  if (row.permanentAddress !== undefined) profile.permanentAddress = nullableString(row.permanentAddress);
  return profile;
};

const parseArray = <T>(value: unknown, parser: (item: unknown) => T): T[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalidPayload();
  return (value as unknown[]).map(parser);
};

export const parseSafetyWorkerRosterPage = (value: unknown): SafetyWorkerRosterPage => {
  const row = asRecord(value);
  return {
    items: parseArray(row.items, parseRosterItem),
    nextCursor: parseCursor(row.nextCursor),
    capabilities: parseCapabilities(row.capabilities),
  };
};

export const parseSafetyWorkforceDashboard = (value: unknown): SafetyWorkforceDashboard => {
  const row = asRecord(value);
  return {
    totalWorkers: requiredNumber(row.totalWorkers),
    activeAssignments: requiredNumber(row.activeAssignments),
    eligibleAssignments: requiredNumber(row.eligibleAssignments),
    missingProfile: requiredNumber(row.missingProfile),
    missingCertificate: requiredNumber(row.missingCertificate),
    expiredCertificate: requiredNumber(row.expiredCertificate),
    missingSiteRequirement: requiredNumber(row.missingSiteRequirement),
    suspendedAssignments: requiredNumber(row.suspendedAssignments),
    expiringCertificates7Days: requiredNumber(row.expiringCertificates7Days),
    expiringCertificates30Days: requiredNumber(row.expiringCertificates30Days),
    expiredCertificates: requiredNumber(row.expiredCertificates),
    expiringCards30Days: requiredNumber(row.expiringCards30Days),
    problematicSubcontractors: parseArray(row.problematicSubcontractors, item => {
      const problem = asRecord(item);
      return {
        id: requiredString(problem.id),
        name: requiredString(problem.name),
        issueCount: requiredNumber(problem.issueCount),
      };
    }),
  };
};

export const parseSafetyWorkerDetailPayload = (value: unknown): SafetyWorkerDetailPayload => {
  const row = asRecord(value);
  const rosterItem = parseRosterItem(row.rosterItem);
  const profile = parseDetailProfile(row.profile);
  if (rosterItem.worker.id !== profile.id) invalidPayload();

  return {
    rosterItem,
    profile,
    documents: parseArray(row.documents, parseDocument),
    certificates: parseArray(row.certificates, parseCertificate),
    assignments: parseArray(row.assignments, parseAssignment),
    cards: parseArray(row.cards, parseSafetyCard),
    capabilities: parseCapabilities(row.capabilities),
    sensitiveLoaded: row.sensitiveLoaded === undefined ? false : requiredBoolean(row.sensitiveLoaded),
  };
};

export const parseSafetySiteWorkforceOptions = (value: unknown): SafetySiteWorkforceOptions => {
  const row = asRecord(value);
  return {
    subcontractors: parseArray(row.subcontractors, item => {
      const parsed = parseScopedSubcontractor(item);
      if (!parsed) invalidPayload();
      return parsed;
    }),
    teams: parseArray(row.teams, item => {
      const parsed = parseScopedTeam(item);
      if (!parsed) invalidPayload();
      const source = asRecord(item);
      return { ...parsed, subcontractorId: nullableString(source.subcontractorId) };
    }),
  };
};

export const parseSafetyWorkerLookupResult = (value: unknown): SafetyWorkerLookupResult | null => {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  return {
    workerId: requiredString(row.workerId),
    workerCode: requiredString(row.workerCode),
    fullName: requiredString(row.fullName),
    workerKind: enumValue<SafetyWorkerKind>(row.workerKind, ['company_staff', 'contractor_worker']),
    identityNumberMasked: requiredString(row.identityNumberMasked),
    targetMembershipId: nullableString(row.targetMembershipId),
    activeAssignmentId: nullableString(row.activeAssignmentId),
    activeProjectId: nullableString(row.activeProjectId),
    activeConstructionSiteId: nullableString(row.activeConstructionSiteId),
    activeSiteName: nullableString(row.activeSiteName),
    canTransfer: requiredBoolean(row.canTransfer),
  };
};

const errorText = (error: unknown, key: 'message' | 'details'): string => {
  if (error instanceof Error && key === 'message') return error.message;
  if (!error || typeof error !== 'object') return '';
  const value = (error as JsonRecord)[key];
  return typeof value === 'string' ? value : '';
};

export const parseSafetyWorkforceError = (error: unknown): {
  code: SafetyWorkforceErrorCode | 'UNKNOWN';
  message: string;
} => {
  const message = errorText(error, 'message') || 'Đã xảy ra lỗi không xác định';
  const searchable = `${message} ${errorText(error, 'details')}`;
  const token = searchable.match(/SAFETY_[A-Z_]+/)?.[0];
  const code = WORKFORCE_ERROR_CODES.includes(token as SafetyWorkforceErrorCode)
    ? token as SafetyWorkforceErrorCode
    : 'UNKNOWN';
  return { code, message };
};
