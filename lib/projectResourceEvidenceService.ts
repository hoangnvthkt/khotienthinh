import type { ResourceEvidenceFilters, ResourceEvidenceGroup, VerifiedResourceUsageEvidence } from '../types';
import { groupResourceEvidence, sanitizeResourceEvidenceRow } from './resourceUsageEvidenceRules';
import { supabase } from './supabase';
import { assertResourceEvidenceHasNoMoneyKeys } from './resourceEvidenceNoMoneyLeak';

export interface ResourceEvidenceTotals {
  providerCount: number;
  peopleCount: number;
  totalLaborHours: number;
  machineCount: number;
  totalMachineHours: number;
  lineCount: number;
}

export interface ResourceEvidencePage {
  rows: VerifiedResourceUsageEvidence[];
  groups: ResourceEvidenceGroup[];
  totals: ResourceEvidenceTotals;
  unknownLegacyCount: number;
  nextCursor: string | null;
}

const invalidResponse = (): Error => new Error('Dữ liệu bằng chứng nguồn lực chưa đầy đủ. Hãy tải lại hoặc liên hệ quản trị dự án.');

const numberField = (value: unknown): number => {
  if (value == null || value === '') throw invalidResponse();
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw invalidResponse();
  return parsed;
};

const evidenceError = (error: { message?: string; code?: string }): Error => {
  const message = error.message || '';
  if (message.includes('RESOURCE_EVIDENCE_SCOPE_DENIED') || error.code === '42501') {
    return new Error('Bạn chưa được cấp quyền xem bằng chứng nguồn lực trong phạm vi này. Hãy liên hệ quản trị dự án.');
  }
  if (message.includes('INVALID_DATE_RANGE')) {
    return new Error('Khoảng ngày không hợp lệ hoặc vượt quá 366 ngày. Hãy chọn lại khoảng ngày.');
  }
  return new Error('Không tải được bằng chứng nguồn lực. Hãy thử tải lại hoặc liên hệ quản trị dự án.');
};

export const projectResourceEvidenceService = {
  async getEvidence(input: ResourceEvidenceFilters): Promise<ResourceEvidencePage> {
    const { data, error } = await supabase.rpc('get_verified_resource_usage_evidence_v1', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId || null,
      p_from_date: input.fromDate,
      p_to_date: input.toDate,
      p_provider_key: input.providerKey || null,
      p_task_id: input.taskId || null,
      p_resource_type: input.resourceType || null,
      p_include_superseded: input.includeSuperseded || false,
      p_cursor: input.cursor || null,
      p_limit: input.limit ?? 200,
    });
    if (error) throw evidenceError(error);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidResponse();
    const result = data as Record<string, unknown>;
    if (!Array.isArray(result.rows) || !result.totals || typeof result.totals !== 'object'
      || Array.isArray(result.totals)) throw invalidResponse();
    const rows = result.rows
      .map(row => sanitizeResourceEvidenceRow(row as Record<string, unknown>));
    const rawTotals = result.totals as Record<string, unknown>;
    const page: ResourceEvidencePage = {
      rows,
      groups: groupResourceEvidence(rows),
      totals: {
        providerCount: numberField(rawTotals.providerCount),
        peopleCount: numberField(rawTotals.peopleCount),
        totalLaborHours: numberField(rawTotals.totalLaborHours),
        machineCount: numberField(rawTotals.machineCount),
        totalMachineHours: numberField(rawTotals.totalMachineHours),
        lineCount: numberField(rawTotals.lineCount),
      },
      unknownLegacyCount: numberField(result.unknownLegacyCount),
      nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null,
    };
    assertResourceEvidenceHasNoMoneyKeys(page);
    return page;
  },
};
