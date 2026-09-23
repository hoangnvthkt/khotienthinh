import { supabase } from '../supabase';
import { parseQuantity6 } from '../procurement/decimal';
import type { ProjectV2PlanType } from '../../types/projectV2';

type CommandBase = { planId: string; expectedVersion: number; idempotencyKey: string };
type ReasonCommand = CommandBase & { reason: string };
type SaveLine = Record<string, unknown>;
type SaveInput = {
  workspaceId: string; planId: string | null; expectedVersion: number | null;
  idempotencyKey: string; planType: ProjectV2PlanType; code: string; title: string;
  periodStart: string; periodEnd: string; lines: SaveLine[];
};

function required(value: string, code: string): string {
  if (!value || !value.trim()) throw new Error(code);
  return value;
}

function version(value: number | null, allowNull = false): void {
  if (allowNull && value === null) return;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('PROJECT_V2_VERSION_INVALID');
}

function validateQuantities(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(validateQuantities);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['quantity', 'sourceQuantity', 'sourceWorkQuantity', 'derivedQuantity',
      'normFactor', 'coefficient', 'conversionNumerator', 'conversionDenominator'].includes(key)) {
      if (item === null) continue; // The server reports incomplete/unknown values without coercing them.
      if (typeof item !== 'string') throw new Error('PROJECT_V2_QUANTITY_INVALID');
      try { parseQuantity6(item); } catch { throw new Error('PROJECT_V2_QUANTITY_INVALID'); }
    } else validateQuantities(item);
  }
}

async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PROJECT_V2_COMMAND_RESPONSE_INVALID');
  return data;
}

function commandPayload(input: CommandBase): Record<string, unknown> {
  required(input.planId, 'PROJECT_V2_PLAN_ID_REQUIRED');
  required(input.idempotencyKey, 'PROJECT_V2_IDEMPOTENCY_KEY_REQUIRED');
  version(input.expectedVersion);
  return { p_plan_id: input.planId, p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey };
}

export const projectV2CommandService = {
  activateWorkspace(input: { projectId: string; primaryConstructionSiteId: string | null;
    idempotencyKey: string }) {
    required(input.projectId, 'PROJECT_V2_PROJECT_ID_REQUIRED');
    required(input.idempotencyKey, 'PROJECT_V2_IDEMPOTENCY_KEY_REQUIRED');
    return rpc('activate_project_v2_workspace_v1', {
      p_project_id: input.projectId,
      p_primary_construction_site_id: input.primaryConstructionSiteId,
      p_idempotency_key: input.idempotencyKey,
    });
  },
  save(input: SaveInput) {
    required(input.workspaceId, 'PROJECT_V2_WORKSPACE_ID_REQUIRED');
    required(input.idempotencyKey, 'PROJECT_V2_IDEMPOTENCY_KEY_REQUIRED');
    if (input.planId === null && input.expectedVersion !== null) throw new Error('PROJECT_V2_VERSION_INVALID');
    if (input.planId !== null) version(input.expectedVersion);
    validateQuantities(input.lines);
    return rpc('save_project_v2_plan_v1', {
      p_workspace_id: input.workspaceId, p_plan_id: input.planId,
      p_expected_version: input.expectedVersion, p_idempotency_key: input.idempotencyKey,
      p_plan_type: input.planType, p_code: input.code, p_title: input.title,
      p_period_start: input.periodStart, p_period_end: input.periodEnd, p_lines: input.lines,
    });
  },
  submit(input: ReasonCommand) {
    return rpc('submit_project_v2_plan_v1', { ...commandPayload(input), p_reason: input.reason });
  },
  return(input: ReasonCommand) {
    required(input.reason, 'PROJECT_V2_REASON_REQUIRED');
    return rpc('return_project_v2_plan_v1', { ...commandPayload(input), p_reason: input.reason });
  },
  approve(input: CommandBase) {
    return rpc('approve_project_v2_plan_v1', commandPayload(input));
  },
  createRevision(input: CommandBase) {
    return rpc('create_project_v2_plan_revision_v1', commandPayload(input));
  },
  cancel(input: ReasonCommand) {
    required(input.reason, 'PROJECT_V2_REASON_REQUIRED');
    return rpc('cancel_project_v2_plan_v1', { ...commandPayload(input), p_reason: input.reason });
  },
  deleteDraft(input: CommandBase) {
    return rpc('delete_project_v2_plan_draft_v1', commandPayload(input));
  },
  addComment(input: CommandBase & { body: string }) {
    required(input.body, 'PROJECT_V2_COMMENT_REQUIRED');
    return rpc('add_project_v2_plan_comment_v1', { ...commandPayload(input), p_body: input.body });
  },
  listSourceCandidates(input: { workspaceId: string; targetType: 'month' | 'construction' | 'material' }) {
    required(input.workspaceId, 'PROJECT_V2_WORKSPACE_ID_REQUIRED');
    return rpc('list_project_v2_source_candidates_v1', {
      p_workspace_id: input.workspaceId, p_target_type: input.targetType,
    });
  },
};
