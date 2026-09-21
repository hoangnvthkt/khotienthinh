import type { ProcurementQuery } from '../../types/procurementWorkbench';

export const DEFAULT_PROCUREMENT_QUERY: ProcurementQuery = { view: 'work' };

const VIEWS = new Set(['work', 'demand', 'orders', 'receiving', 'reconcile', 'partners', 'overview']);
const STAGES = new Set(['intake', 'processing', 'approval', 'receiving', 'reconcile']);
const DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

const clean = (value: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const date = (value: string | null): string | undefined => {
  const normalized = clean(value);
  if (!normalized || !DATE.test(normalized)) return undefined;
  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? normalized
    : undefined;
};

export const parseProcurementQuery = (params: URLSearchParams): ProcurementQuery => {
  const viewValue = clean(params.get('view'));
  const stageValue = clean(params.get('stage'));
  const query: ProcurementQuery = {
    view: VIEWS.has(viewValue || '') ? viewValue as ProcurementQuery['view'] : 'work',
  };
  if (STAGES.has(stageValue || '')) query.stage = stageValue as ProcurementQuery['stage'];
  const values: Array<[keyof ProcurementQuery, string | undefined]> = [
    ['projectId', clean(params.get('projectId'))],
    ['constructionSiteId', clean(params.get('siteId'))],
    ['assigneeId', clean(params.get('assigneeId'))],
    ['source', clean(params.get('source'))],
    ['method', clean(params.get('method'))],
    ['search', clean(params.get('search'))],
    ['neededFrom', date(params.get('neededFrom'))],
    ['neededTo', date(params.get('neededTo'))],
    ['demandId', clean(params.get('demandId'))],
  ];
  values.forEach(([key, value]) => {
    if (value) Object.assign(query, { [key]: value });
  });
  return query;
};

export const serializeProcurementQuery = (query: ProcurementQuery): URLSearchParams => {
  const params = new URLSearchParams();
  const values: Array<[string, string | undefined]> = [
    ['view', query.view === 'work' ? undefined : query.view],
    ['stage', query.stage],
    ['projectId', query.projectId],
    ['siteId', query.constructionSiteId],
    ['assigneeId', query.assigneeId],
    ['source', query.source],
    ['method', query.method],
    ['search', query.search?.trim() || undefined],
    ['neededFrom', query.neededFrom],
    ['neededTo', query.neededTo],
    ['demandId', query.demandId],
  ];
  values.forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
};
