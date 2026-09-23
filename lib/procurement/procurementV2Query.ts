import type { ProcurementV2Filter, ProcurementV2Source, ProcurementV2Stage } from '../../types/procurementV2';

const sources: ProcurementV2Source[] = ['material_plan', 'project_material_request'];
const stages: ProcurementV2Stage[] = ['reconcile', 'plan_supply', 'monitor_fulfillment', 'withdrawn'];

export function parseProcurementV2Query(search: string): ProcurementV2Filter {
  const params = new URLSearchParams(search);
  const source = params.get('source');
  const stage = params.get('stage');
  const date = (key: string) => {
    const value = params.get(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  };
  return {
    ...(params.get('search')?.trim() ? { search: params.get('search')!.trim() } : {}),
    ...(params.get('projectId')?.trim() ? { projectId: params.get('projectId')!.trim() } : {}),
    ...(sources.includes(source as ProcurementV2Source) ? { source: source as ProcurementV2Source } : {}),
    ...(stages.includes(stage as ProcurementV2Stage) ? { stage: stage as ProcurementV2Stage } : {}),
    ...(date('neededFrom') ? { neededFrom: date('neededFrom') } : {}),
    ...(date('neededTo') ? { neededTo: date('neededTo') } : {}),
  };
}

export function serializeProcurementV2Query(query: ProcurementV2Filter): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ['search', 'projectId', 'source', 'stage', 'neededFrom', 'neededTo'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  return params;
}
