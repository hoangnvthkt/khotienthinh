import type {
  ResourceEvidenceGroup,
  ResourceEvidenceProvider,
  ResourceEvidenceRevisionState,
  ResourceEvidenceType,
  VerifiedResourceUsageEvidence,
} from '../types';

const normalizeProviderName = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

export const buildResourceEvidenceProviderKey = (provider: ResourceEvidenceProvider): string =>
  provider.entryMode === 'catalog'
    ? `catalog:${provider.partnerId}`
    : `manual:${provider.manualProviderType}:${normalizeProviderName(provider.manualProviderName || '')}`;

const field = (row: Record<string, unknown>, camel: string, snake: string): unknown =>
  row[camel] ?? row[snake];

const nullableString = (value: unknown): string | null => value == null ? null : String(value);
const nullableNumber = (value: unknown): number | null => value == null ? null : Number(value);

const sanitizeProvider = (value: unknown): ResourceEvidenceProvider => {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    entryMode: field(row, 'entryMode', 'entry_mode') as ResourceEvidenceProvider['entryMode'],
    partnerId: nullableString(field(row, 'partnerId', 'partner_id')),
    providerCodeSnapshot: nullableString(field(row, 'providerCodeSnapshot', 'provider_code_snapshot')),
    providerNameSnapshot: nullableString(field(row, 'providerNameSnapshot', 'provider_name_snapshot')),
    manualProviderType: field(row, 'manualProviderType', 'manual_provider_type') as ResourceEvidenceProvider['manualProviderType'] ?? null,
    manualProviderName: nullableString(field(row, 'manualProviderName', 'manual_provider_name')),
    manualProviderNote: nullableString(field(row, 'manualProviderNote', 'manual_provider_note')),
  };
};

export const sanitizeResourceEvidenceRow = (row: Record<string, unknown>): VerifiedResourceUsageEvidence => ({
  resourceLineId: String(field(row, 'resourceLineId', 'resource_line_id')),
  resourceType: field(row, 'resourceType', 'resource_type') as ResourceEvidenceType,
  dailyLogId: String(field(row, 'dailyLogId', 'daily_log_id')),
  summarySourceId: String(field(row, 'summarySourceId', 'summary_source_id')),
  contributionId: String(field(row, 'contributionId', 'contribution_id')),
  revisionNo: Number(field(row, 'revisionNo', 'revision_no') ?? 1),
  revisionState: field(row, 'revisionState', 'revision_state') as ResourceEvidenceRevisionState,
  projectId: nullableString(field(row, 'projectId', 'project_id')),
  constructionSiteId: nullableString(field(row, 'constructionSiteId', 'construction_site_id')),
  logDate: String(field(row, 'logDate', 'log_date')),
  workAreaCode: String(field(row, 'workAreaCode', 'work_area_code')),
  workAreaName: String(field(row, 'workAreaName', 'work_area_name')),
  taskId: String(field(row, 'taskId', 'task_id')),
  wbsCode: nullableString(field(row, 'wbsCode', 'wbs_code')),
  taskName: String(field(row, 'taskName', 'task_name')),
  provider: sanitizeProvider(row.provider),
  peopleCount: nullableNumber(field(row, 'peopleCount', 'people_count')),
  hoursPerPerson: nullableNumber(field(row, 'hoursPerPerson', 'hours_per_person')),
  totalLaborHours: nullableNumber(field(row, 'totalLaborHours', 'total_labor_hours')),
  machineCount: nullableNumber(field(row, 'machineCount', 'machine_count')),
  hoursPerMachine: nullableNumber(field(row, 'hoursPerMachine', 'hours_per_machine')),
  totalMachineHours: nullableNumber(field(row, 'totalMachineHours', 'total_machine_hours')),
  sourceUserName: nullableString(field(row, 'sourceUserName', 'source_user_name')),
  verifiedByName: nullableString(field(row, 'verifiedByName', 'verified_by_name')),
  verifiedAt: String(field(row, 'verifiedAt', 'verified_at')),
});

export const groupResourceEvidence = (rows: VerifiedResourceUsageEvidence[]): ResourceEvidenceGroup[] => {
  const groups = new Map<string, ResourceEvidenceGroup>();
  for (const row of rows) {
    if (row.revisionState !== 'current') continue;
    const providerKey = buildResourceEvidenceProviderKey(row.provider);
    let group = groups.get(providerKey);
    if (!group) {
      group = {
        providerKey,
        provider: sanitizeProvider(row.provider),
        peopleCount: 0,
        totalLaborHours: 0,
        machineCount: 0,
        totalMachineHours: 0,
        lineCount: 0,
      };
      groups.set(providerKey, group);
    }
    group.peopleCount += row.peopleCount ?? 0;
    group.totalLaborHours += row.totalLaborHours ?? 0;
    group.machineCount += row.machineCount ?? 0;
    group.totalMachineHours += row.totalMachineHours ?? 0;
    group.lineCount += 1;
  }
  return [...groups.values()];
};
