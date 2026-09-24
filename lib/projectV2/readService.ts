import { supabase } from '../supabase';
import { parseQuantity6 } from '../procurement/decimal';
import type { ProjectV2PlanStatus, ProjectV2PlanType } from '../../types/projectV2';

type Json = Record<string, unknown>;
const fail = (code: string): never => { throw new Error(code); };
const object = (value: unknown, code = 'PROJECT_V2_RESPONSE_INVALID'): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : fail(code);
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : fail('PROJECT_V2_RESPONSE_INVALID');
const string = (value: unknown): string => typeof value === 'string' && value.length > 0
  ? value : fail('PROJECT_V2_RESPONSE_INVALID');
const nullableString = (value: unknown): string | null => value === null ? null : string(value);
const instant = (value: unknown): string => {
  const result = string(value);
  if (!Number.isFinite(Date.parse(result))) fail('PROJECT_V2_DATE_INVALID');
  return result;
};
const date = (value: unknown): string => {
  const result = string(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`)))
    fail('PROJECT_V2_DATE_INVALID');
  return result;
};
const integer = (value: unknown, min = 1): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min
    ? value : fail('PROJECT_V2_COUNT_INVALID');
const decimal = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value === 'string') {
    try { parseQuantity6(value); return value; } catch { return fail('PROJECT_V2_DECIMAL_INVALID'); }
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    Number.isSafeInteger(Math.round(value * 1_000_000)) &&
    Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 0.00001) {
    return value.toFixed(6);
  }
  return fail('PROJECT_V2_DECIMAL_INVALID');
};

const planTypes: ProjectV2PlanType[] = ['month', 'construction', 'material'];
const statuses: ProjectV2PlanStatus[] = ['draft', 'pending_approval', 'returned',
  'approved', 'superseded', 'cancelled'];
const planType = (value: unknown): ProjectV2PlanType =>
  planTypes.includes(value as ProjectV2PlanType) ? value as ProjectV2PlanType : fail('PROJECT_V2_TYPE_INVALID');
const status = (value: unknown): ProjectV2PlanStatus =>
  statuses.includes(value as ProjectV2PlanStatus) ? value as ProjectV2PlanStatus : fail('PROJECT_V2_STATUS_INVALID');

export interface ProjectV2WorkspaceSummary {
  id: string; projectId: string; projectName: string; projectCode: string;
  clientName: string | null; siteName: string | null; primaryConstructionSiteId: string | null;
  lifecycle: 'pilot' | 'active'; version: number;
}
export interface ProjectV2PlanSummary {
  id: string; workspaceId: string; planType: ProjectV2PlanType; code: string; title: string;
  status: ProjectV2PlanStatus; periodStart: string; periodEnd: string;
  ownerUserId: string | null; creatorUserId: string; submitterUserId: string | null;
  followerUserId?: string | null;
  approverUserId: string | null; revision: number; version: number;
  createdAt: string; updatedAt: string;
}
export interface ProjectV2PlanCursor { createdAt: string; id: string }
export interface ProjectV2CollaborationCursor { at: string; id: string }
export type ProjectV2Comment = { kind: 'comments'; id: string; revision: number;
  authorUserId: string; body: string; createdAt: string };
export type ProjectV2Event = { kind: 'events'; id: string; revision: number;
  eventType: string; actorUserId: string; reason: string | null;
  metadata: Json; occurredAt: string };
export type ProjectV2PlanLink = { canOpen: false } | { canOpen: true; id: string;
  revision: number | null; code: string; title: string; planType: ProjectV2PlanType };
export interface ProjectV2PlanListQuery {
  workspaceId: string; planType: ProjectV2PlanType | null; status: ProjectV2PlanStatus | null;
  limit: number; cursor: ProjectV2PlanCursor | null; snapshotToken: string | null;
}

function workspace(value: unknown): ProjectV2WorkspaceSummary {
  const row = object(value);
  const lifecycle = string(row.lifecycle);
  if (lifecycle !== 'pilot' && lifecycle !== 'active') fail('PROJECT_V2_LIFECYCLE_INVALID');
  return { id: string(row.id), projectId: string(row.project_id),
    projectName: string(row.project_name), projectCode: string(row.project_code),
    clientName: nullableString(row.client_name), siteName: nullableString(row.construction_site_name),
    primaryConstructionSiteId: nullableString(row.primary_construction_site_id),
    lifecycle: lifecycle as 'pilot' | 'active', version: integer(row.version) };
}
function plan(value: unknown): ProjectV2PlanSummary {
  const row = object(value);
  return { id: string(row.id), workspaceId: string(row.workspace_id),
    planType: planType(row.plan_type), code: string(row.code), title: string(row.title),
    status: status(row.status), periodStart: date(row.period_start), periodEnd: date(row.period_end),
    ownerUserId: nullableString(row.owner_user_id), followerUserId: nullableString(row.follower_user_id ?? null),
    creatorUserId: string(row.creator_user_id),
    submitterUserId: nullableString(row.submitter_user_id), approverUserId: nullableString(row.approver_user_id),
    revision: integer(row.revision_no), version: integer(row.version),
    createdAt: instant(row.created_at), updatedAt: instant(row.updated_at) };
}
function unique<T>(values: T[], getId: (value: T) => string): T[] {
  const ids = new Set<string>();
  for (const value of values) {
    const id = getId(value);
    if (ids.has(id)) fail('PROJECT_V2_DUPLICATE_ID');
    ids.add(id);
  }
  return values;
}
async function rpc(name: string, args?: Json): Promise<Json> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return object(data);
}

export const projectV2ReadService = {
  async getCollaborationPage(planId: string, kind: 'comments' | 'events', limit = 30,
    cursor: ProjectV2CollaborationCursor | null = null) {
    if (!planId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      fail('PROJECT_V2_COLLABORATION_QUERY_INVALID');
    const payload = await rpc('list_project_v2_plan_collaboration_v1', {
      p_plan_id: planId, p_kind: kind, p_limit: limit,
      p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null,
    });
    const items = unique(array(payload.items).map(value => {
      const row = object(value);
      const common = { id: string(row.id), revision: integer(row.revision) };
      return kind === 'comments' ? { ...common, kind, authorUserId: string(row.authorUserId),
        body: string(row.body), createdAt: instant(row.createdAt) } as ProjectV2Comment
        : { ...common, kind, eventType: string(row.eventType),
          actorUserId: string(row.actorUserId), reason: nullableString(row.reason),
          metadata: object(row.metadata), occurredAt: instant(row.occurredAt) } as ProjectV2Event;
    }), item => item.id);
    const rawCursor = payload.nextCursor === null ? null : object(payload.nextCursor);
    const nextCursor = rawCursor ? { at: instant(rawCursor.at), id: string(rawCursor.id) } : null;
    if (nextCursor && !items.some(item => item.id === nextCursor.id))
      fail('PROJECT_V2_COLLABORATION_CURSOR_INVALID');
    return { asOf: instant(payload.asOf), items, nextCursor };
  },
  async getLineage(planId: string, revision: number): Promise<{
    sources: ProjectV2PlanLink[]; downstream: ProjectV2PlanLink[] }> {
    if (!planId.trim() || !Number.isSafeInteger(revision) || revision < 1)
      fail('PROJECT_V2_LINEAGE_QUERY_INVALID');
    const payload = await rpc('get_project_v2_plan_lineage_v1', {
      p_plan_id: planId, p_revision_no: revision,
    });
    const link = (value: unknown): ProjectV2PlanLink => {
      const row = object(value);
      if (row.canOpen === false) return { canOpen: false };
      if (row.canOpen !== true) fail('PROJECT_V2_LINEAGE_INVALID');
      return { canOpen: true, id: string(row.id),
        revision: row.revision === null ? null : integer(row.revision),
        code: string(row.code), title: string(row.title), planType: planType(row.planType) };
    };
    return { sources: array(payload.sources).map(link),
      downstream: array(payload.downstream).map(link) };
  },
  async getDiscussion(planId: string) {
    const payload = await rpc('get_project_v2_plan_discussion_v1', { p_plan_id: planId });
    return { asOf: instant(payload.asOf),
      comments: unique(array(payload.comments).map(value => {
        const row = object(value);
        return { id: string(row.id), revision: integer(row.revision),
          authorUserId: string(row.authorUserId), body: string(row.body),
          createdAt: instant(row.createdAt) };
      }), item => item.id),
      events: unique(array(payload.events).map(value => {
        const row = object(value);
        return { id: string(row.id), revision: integer(row.revision),
          eventType: string(row.eventType), actorUserId: string(row.actorUserId),
          reason: nullableString(row.reason), occurredAt: instant(row.occurredAt) };
      }), item => item.id) };
  },
  async listActiveCohortIds(projectIds: string[] | null = null): Promise<string[]> {
    if (projectIds && projectIds.length > 100) fail('PROJECT_V2_COHORT_SCOPE_INVALID');
    if (projectIds?.length === 0) return [];
    let payload: Json;
    try {
      payload = await rpc('list_project_v2_cohort_ids_v1', { p_project_ids: projectIds });
    } catch (error) {
      // The legacy project list must remain usable before the V2 migration is deployed.
      if (error && typeof error === 'object' && 'code' in error && 'message' in error &&
        error.code === 'PGRST202' && typeof error.message === 'string' &&
        error.message.includes('public.list_project_v2_cohort_ids_v1(')) return [];
      throw error;
    }
    const ids = unique(array(payload.projectIds).map(string), item => item);
    if (projectIds && ids.some(id => !projectIds.includes(id))) fail('PROJECT_V2_SCOPE_MISMATCH');
    return ids;
  },
  async listWorkspaces() {
    const payload = await rpc('list_project_v2_workspaces_v1');
    return { asOf: instant(payload.asOf),
      workspaces: unique(array(payload.workspaces).map(workspace), item => item.id) };
  },
  async listPlans(query: ProjectV2PlanListQuery) {
    const payload = await rpc('list_project_v2_plans_v1', {
      p_workspace_id: query.workspaceId, p_plan_type: query.planType, p_status: query.status,
      p_limit: query.limit, p_before_created_at: query.cursor?.createdAt ?? null,
      p_before_id: query.cursor?.id ?? null, p_snapshot_token: query.snapshotToken,
    });
    const snapshotToken = payload.snapshotToken === null ? null : instant(payload.snapshotToken);
    if (query.snapshotToken !== null && snapshotToken !== query.snapshotToken) fail('PROJECT_V2_SNAPSHOT_STALE');
    const plans = unique(array(payload.plans).map(plan), item => item.id);
    if (plans.some(item => item.workspaceId !== query.workspaceId ||
      (query.planType !== null && item.planType !== query.planType) ||
      (query.status !== null && item.status !== query.status))) fail('PROJECT_V2_SCOPE_MISMATCH');
    const rawCounts = object(payload.statusCounts);
    const statusCounts: Partial<Record<ProjectV2PlanStatus, number>> = {};
    for (const [key, value] of Object.entries(rawCounts)) {
      status(key);
      statusCounts[key as ProjectV2PlanStatus] = integer(value, 0);
    }
    const last = plans.at(-1);
    return { asOf: instant(payload.asOf), snapshotToken, totalCount: integer(payload.totalCount, 0),
      statusCounts, capabilities: object(payload.capabilities), plans,
      nextCursor: plans.length === query.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
  },
  async getPlan(planId: string, revision: number | null = null) {
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))
      fail('PROJECT_V2_REVISION_INVALID');
    const payload = revision === null
      ? await rpc('get_project_v2_plan_v1', { p_plan_id: planId })
      : await rpc('get_project_v2_plan_revision_v1', {
        p_plan_id: planId, p_revision_no: revision });
    const selected = plan(payload.plan);
    if (selected.id !== planId) fail('PROJECT_V2_SCOPE_MISMATCH');
    const lines = unique(array(payload.lines).map(value => {
      const row = object(value);
      if (string(row.plan_id) !== planId || integer(row.revision_no) !== selected.revision ||
        planType(row.plan_type) !== selected.planType) fail('PROJECT_V2_SCOPE_MISMATCH');
      return { ...row, id: string(row.id), quantity: decimal(row.quantity) };
    }), item => item.id);
    const lineIds = new Set(lines.map(item => item.id));
    const sources = unique(array(payload.sources).map(value => {
      const row = object(value);
      if (!lineIds.has(string(row.target_line_id))) fail('PROJECT_V2_SCOPE_MISMATCH');
      return { ...row, id: string(row.id), sourceWorkQuantity: decimal(row.source_work_quantity),
        derivedQuantity: decimal(row.derived_quantity) };
    }), item => item.id);
    return { asOf: instant(payload.asOf), historical: payload.historical === true,
      plan: selected,
      capabilities: object(payload.capabilities), lines, sources };
  },
};
