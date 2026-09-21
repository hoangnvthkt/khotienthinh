import { supabase } from './supabase';
import { realtimeService } from './realtimeService';
import {
  MANAGEMENT_DATASET_VERSION,
  type ManagementCompleteness,
  type ManagementDatasetFilter,
  type ManagementDatasetPage,
  type ManagementDatasetRow,
  type ManagementMetricDefinition,
  type ManagementSeverity,
  type ManagementVatBasis,
  type ManagementViewId,
} from './managementDataset';

type ListInput = ManagementDatasetFilter & {
  cursor?: string | null;
  limit?: number;
  asOf?: string | null;
  bypassCache?: boolean;
};

type CacheEntry = { expiresAt: number; page?: ManagementDatasetPage; pending?: Promise<ManagementDatasetPage> };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;
let actorKey = 'current-session';

const object = (value: unknown, code: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, any>;
};
const string = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
};
const nullableString = (value: unknown): string | null => value == null || value === '' ? null : String(value);
const numberOrNull = (value: unknown, code: string): number | null => {
  if (value == null) return null;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(code);
  return result;
};
const enumValue = <T extends string>(value: unknown, values: readonly T[], code: string): T => {
  if (!values.includes(value as T)) throw new Error(code);
  return value as T;
};

const mapDefinition = (value: unknown): ManagementMetricDefinition => {
  const source = object(value, 'MANAGEMENT_METRIC_DEFINITION_INVALID');
  return {
    id: string(source.id, 'MANAGEMENT_METRIC_ID_INVALID'),
    viewId: enumValue(source.viewId, ['M01', 'M02', 'M03', 'M04', 'M05'] as const, 'MANAGEMENT_VIEW_INVALID'),
    definitionVersion: string(source.definitionVersion, 'MANAGEMENT_METRIC_VERSION_INVALID'),
    label: string(source.label, 'MANAGEMENT_METRIC_LABEL_INVALID'),
    unit: string(source.unit, 'MANAGEMENT_METRIC_UNIT_INVALID'),
    currency: nullableString(source.currency),
    vatBasis: enumValue(source.vatBasis, ['not_applicable', 'net', 'gross', 'mixed'] as const, 'MANAGEMENT_VAT_BASIS_INVALID'),
    availability: enumValue(source.availability, ['available', 'restricted', 'unavailable'] as const, 'MANAGEMENT_METRIC_AVAILABILITY_INVALID'),
    unavailableReason: nullableString(source.unavailableReason),
  };
};

const mapRow = (value: unknown): ManagementDatasetRow => {
  const source = object(value, 'MANAGEMENT_DATASET_ROW_INVALID');
  const lineage = object(source.source, 'MANAGEMENT_DATASET_SOURCE_INVALID');
  const drill = object(source.drill, 'MANAGEMENT_DATASET_DRILL_INVALID');
  const completeness = enumValue<ManagementCompleteness>(source.completeness, ['complete', 'partial', 'unknown'], 'MANAGEMENT_COMPLETENESS_INVALID');
  const mapped: ManagementDatasetRow = {
    id: string(source.id, 'MANAGEMENT_ROW_ID_INVALID'),
    viewId: enumValue<ManagementViewId>(source.viewId, ['M01', 'M02', 'M03', 'M04', 'M05'], 'MANAGEMENT_VIEW_INVALID'),
    metricId: string(source.metricId, 'MANAGEMENT_METRIC_ID_INVALID'),
    metricDefinitionVersion: string(source.metricDefinitionVersion, 'MANAGEMENT_METRIC_VERSION_INVALID'),
    title: string(source.title, 'MANAGEMENT_ROW_TITLE_INVALID'),
    description: nullableString(source.description),
    severity: enumValue<ManagementSeverity>(source.severity, ['critical', 'warning', 'info'], 'MANAGEMENT_SEVERITY_INVALID'),
    projectId: nullableString(source.projectId),
    constructionSiteId: nullableString(source.constructionSiteId),
    projectName: nullableString(source.projectName),
    ownerId: nullableString(source.ownerId),
    ownerName: nullableString(source.ownerName),
    dueAt: nullableString(source.dueAt),
    value: numberOrNull(source.value, 'MANAGEMENT_VALUE_INVALID'),
    unit: string(source.unit, 'MANAGEMENT_UNIT_INVALID'),
    currency: nullableString(source.currency),
    vatBasis: enumValue<ManagementVatBasis>(source.vatBasis, ['not_applicable', 'net', 'gross', 'mixed'], 'MANAGEMENT_VAT_BASIS_INVALID'),
    completeness,
    qualityIssues: Array.isArray(source.qualityIssues) ? source.qualityIssues.map(String) : [],
    source: {
      type: string(lineage.type, 'MANAGEMENT_SOURCE_TYPE_INVALID'),
      id: string(lineage.id, 'MANAGEMENT_SOURCE_ID_INVALID'),
      label: string(lineage.label, 'MANAGEMENT_SOURCE_LABEL_INVALID'),
      inferred: lineage.inferred === true,
    },
    drill: {
      type: string(drill.type, 'MANAGEMENT_DRILL_TYPE_INVALID'),
      id: string(drill.id, 'MANAGEMENT_DRILL_ID_INVALID'),
      path: string(drill.path, 'MANAGEMENT_DRILL_PATH_INVALID'),
    },
  };
  if (mapped.completeness === 'unknown' && mapped.value !== null) throw new Error('MANAGEMENT_UNKNOWN_VALUE_INVALID');
  return mapped;
};

export const mapManagementDatasetPage = (value: unknown): ManagementDatasetPage => {
  const source = object(value, 'MANAGEMENT_DATASET_INVALID');
  if (source.metricVersion !== MANAGEMENT_DATASET_VERSION) throw new Error('MANAGEMENT_DATASET_VERSION_INVALID');
  if (!Array.isArray(source.catalog) || !Array.isArray(source.rows)) throw new Error('MANAGEMENT_DATASET_COLLECTION_INVALID');
  const totals = object(source.totals, 'MANAGEMENT_TOTALS_INVALID');
  const capabilities = object(source.capabilities, 'MANAGEMENT_CAPABILITIES_INVALID');
  const options = source.options && typeof source.options === 'object' && !Array.isArray(source.options)
    ? source.options as Record<string, unknown> : { projects: [] };
  return {
    metricVersion: MANAGEMENT_DATASET_VERSION,
    asOf: string(source.asOf, 'MANAGEMENT_AS_OF_INVALID'),
    staleAfter: string(source.staleAfter, 'MANAGEMENT_STALE_AFTER_INVALID'),
    filter: object(source.filter, 'MANAGEMENT_FILTER_INVALID'),
    capabilities: { canViewFinancials: capabilities.canViewFinancials === true, canExport: capabilities.canExport === true },
    options: {
      projects: Array.isArray(options.projects) ? options.projects.map(value => {
        const project = object(value, 'MANAGEMENT_PROJECT_OPTION_INVALID');
        return { id: string(project.id, 'MANAGEMENT_PROJECT_OPTION_INVALID'), name: string(project.name, 'MANAGEMENT_PROJECT_OPTION_INVALID'), constructionSiteId: nullableString(project.constructionSiteId) };
      }) : [],
    },
    catalog: source.catalog.map(mapDefinition),
    totals: {
      rowCount: Number(totals.rowCount ?? 0),
      criticalCount: Number(totals.criticalCount ?? 0),
      warningCount: Number(totals.warningCount ?? 0),
      unknownCount: Number(totals.unknownCount ?? 0),
    },
    rows: source.rows.map(mapRow),
    nextCursor: nullableString(source.nextCursor),
  };
};

const normalizedFilter = (input: ManagementDatasetFilter): Record<string, string> => Object.fromEntries(
  Object.entries(input)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => [key, String(value).trim()]),
);

const keyFor = (filter: Record<string, string>, cursor: string | null, limit: number, asOf: string | null) =>
  JSON.stringify([actorKey, filter, cursor, limit, asOf]);

const list = async (input: ListInput): Promise<ManagementDatasetPage> => {
  const { cursor = null, limit = 50, asOf = null, bypassCache = false, ...filterInput } = input;
  const filter = normalizedFilter(filterInput);
  const boundedLimit = Math.min(200, Math.max(1, limit));
  const cacheKey = keyFor(filter, cursor, boundedLimit, asOf);
  const existing = cache.get(cacheKey);
  if (!bypassCache && existing?.page && existing.expiresAt > Date.now()) return existing.page;
  if (!bypassCache && existing?.pending) return existing.pending;

  const pending = (async () => {
    const { data, error } = await supabase.rpc('list_management_dataset_v1', {
      p_filter: filter,
      p_cursor: cursor,
      p_limit: boundedLimit,
      p_as_of: asOf,
    });
    if (error) throw error;
    const page = mapManagementDatasetPage(data);
    cache.set(cacheKey, { page, expiresAt: Date.now() + CACHE_TTL_MS });
    return page;
  })();
  if (!bypassCache) cache.set(cacheKey, { pending, expiresAt: Date.now() + CACHE_TTL_MS });
  try {
    return await pending;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
};

const listAllForExport = async (filter: ManagementDatasetFilter): Promise<ManagementDatasetPage> => {
  let cursor: string | null = null;
  let asOf: string | null = null;
  let first: ManagementDatasetPage | null = null;
  const rows: ManagementDatasetRow[] = [];
  do {
    const page = await list({ ...filter, cursor, limit: 200, asOf, bypassCache: true });
    if (!first) {
      first = page;
      asOf = page.asOf;
    } else if (page.metricVersion !== first.metricVersion || page.asOf !== first.asOf) {
      throw new Error('MANAGEMENT_EXPORT_SNAPSHOT_CHANGED');
    }
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  if (!first) throw new Error('MANAGEMENT_EXPORT_EMPTY_RESPONSE');
  return { ...first, rows, nextCursor: null };
};

const invalidate = (input: { table?: string; projectId?: string | null } = {}) => {
  for (const [key] of cache) {
    if (!input.projectId || key.includes(`\"projectId\":\"${input.projectId}\"`) || !key.includes('\"projectId\"')) cache.delete(key);
  }
};

const INVALIDATION_TABLES = new Set([
  'project_tasks', 'material_plans', 'material_plan_allocations', 'procurement_demands',
  'procurement_demand_lines', 'procurement_supply_allocations', 'purchase_orders',
  'purchase_order_delivery_batches', 'wms_inventory_reconciliation_issues',
  'supplier_payable_documents', 'supplier_invoice_payable_links', 'supplier_payment_batches',
]);

const bindRealtimeInvalidation = (onInvalidate?: () => void): (() => void) => {
  let lostConnection = false;
  let connectedOnce = realtimeService.status === 'connected';
  const offEvent = realtimeService.on('*', event => {
    if (!INVALIDATION_TABLES.has(event.table)) return;
    const record = event.newRecord || event.oldRecord || {};
    invalidate({ table: event.table, projectId: record.project_id ?? null });
    onInvalidate?.();
  });
  const offStatus = realtimeService.onStatusChange(status => {
    if ((status === 'disconnected' || status === 'error') && connectedOnce) lostConnection = true;
    if (status === 'connected' && !connectedOnce) {
      connectedOnce = true;
      return;
    }
    if (status === 'connected' && connectedOnce && lostConnection) {
      lostConnection = false;
      cache.clear();
      onInvalidate?.();
    }
  });
  return () => { offEvent(); offStatus(); };
};

export const managementDatasetService = {
  list,
  listAllForExport,
  invalidate,
  bindRealtimeInvalidation,
  clearCache: () => cache.clear(),
  setActor: (nextActorKey: string | null | undefined) => {
    const next = nextActorKey || 'anonymous';
    if (next !== actorKey) {
      actorKey = next;
      cache.clear();
    }
  },
};
