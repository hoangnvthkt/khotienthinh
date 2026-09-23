import type { ProjectV2PlanStatus, ProjectV2PlanType } from '../../types/projectV2';

export type ProjectV2Sort = 'newest' | 'oldest' | 'code';
export interface ProjectV2Query {
  projectId: string;
  planType: ProjectV2PlanType;
  status: ProjectV2PlanStatus | 'all';
  search: string;
  period: string;
  sort: ProjectV2Sort;
  page: number;
}

const types: ProjectV2PlanType[] = ['month', 'construction', 'material'];
const statuses: ProjectV2PlanStatus[] = ['draft', 'pending_approval', 'returned',
  'approved', 'superseded', 'cancelled'];

export function parseProjectV2Query(search: string): ProjectV2Query {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const type = params.get('type') as ProjectV2PlanType;
  const status = params.get('status') as ProjectV2PlanStatus;
  const sort = params.get('sort') as ProjectV2Sort;
  const page = Number(params.get('page'));
  const period = params.get('period') ?? '';
  return {
    projectId: (params.get('project') ?? '').trim(),
    planType: types.includes(type) ? type : 'month',
    status: statuses.includes(status) ? status : 'all',
    search: (params.get('search') ?? '').trim().slice(0, 120),
    period: /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : '',
    sort: ['newest', 'oldest', 'code'].includes(sort) ? sort : 'newest',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function serializeProjectV2Query(query: ProjectV2Query): string {
  const params = new URLSearchParams();
  if (query.projectId) params.set('project', query.projectId);
  params.set('type', query.planType);
  if (query.status !== 'all') params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  if (query.period) params.set('period', query.period);
  if (query.sort !== 'newest') params.set('sort', query.sort);
  if (query.page > 1) params.set('page', String(query.page));
  return params.toString();
}

export function updateProjectV2Query(current: ProjectV2Query,
  patch: Partial<ProjectV2Query>): ProjectV2Query {
  const filtersChanged = Object.keys(patch).some(key => key !== 'page' &&
    patch[key as keyof ProjectV2Query] !== current[key as keyof ProjectV2Query]);
  return { ...current, ...patch, page: filtersChanged ? 1 : patch.page ?? current.page };
}

export function createProjectV2RequestGate() {
  let generation = 0;
  return { next: () => ++generation, isCurrent: (value: number) => value === generation };
}

export function filterLegacyProjectCohort<T extends { id: string }>(projects: readonly T[],
  workspaces: readonly { projectId: string; lifecycle: string }[]): T[] {
  const enrolled = new Set(workspaces.filter(item => item.lifecycle !== 'archived').map(item => item.projectId));
  return projects.filter(project => !enrolled.has(project.id));
}

export function buildProjectV2ExclusionFilter(projectIds: readonly string[]): string {
  return `(${projectIds.map(id => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}
