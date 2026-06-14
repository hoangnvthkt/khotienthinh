import { fromDb, toDb } from '../dbMapping';
import { isSupabaseConfigured, supabase } from '../supabase';
import type { InventoryItem, MaterialBudgetItem, ProjectWorkBoqItem } from '../../types';
import type {
  CostNormComponentRecord,
  CostNormItemRecord,
  CostNormLibraryRecord,
  CostNormResourceRecord,
} from './costNormImportService';
import type { CostNormResourceType } from './import/types';

const LIBRARY_TABLE = 'cost_norm_libraries';
const ITEM_TABLE = 'cost_norm_items';
const RESOURCE_TABLE = 'cost_norm_resources';
const COMPONENT_TABLE = 'cost_norm_item_components';
const WORK_BOQ_TABLE = 'project_work_boq_items';
const MATERIAL_BUDGET_TABLE = 'material_budget_items';
const MAPPING_TABLE = 'project_work_boq_norm_mappings';
const ESTIMATE_TABLE = 'project_work_boq_norm_component_estimates';
const READ_PAGE_SIZE = 1000;
const MATERIAL_BUDGET_QTY_PRECISION = 6;

const DOWNSTREAM_GUARD_TABLES = [
  'material_request_boq_line_snapshots',
  'material_request_fulfillment_lines',
  'purchase_order_request_lines',
  'material_issue_lines',
];

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const roundQty = (value: number) => {
  if (!Number.isFinite(value) || value < 0) return 0;
  const multiplier = 10 ** MATERIAL_BUDGET_QTY_PRECISION;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeLookup = (value: unknown) => normalizeText(value).toLowerCase();
const normalizeCode = (value: unknown) => normalizeText(value).toUpperCase();

const escapeLike = (value: string) => value.replace(/[%_]/g, char => `\\${char}`);

const assertSupabaseConfigured = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
};

const chunk = <T>(items: T[], size = 200): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

const fetchPaged = async <T>(buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const to = from + READ_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < READ_PAGE_SIZE) break;
  }
  return rows;
};

export interface G8NormSearchResult {
  id: string;
  libraryId: string;
  libraryName: string;
  libraryCode: string;
  code: string;
  name: string;
  unit?: string | null;
  sourceRowStart?: number | null;
}

export interface ProjectWorkBoqNormMappingRecord {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  workBoqItemId: string;
  costNormLibraryId?: string | null;
  costNormItemId?: string | null;
  normCodeSnapshot: string;
  normNameSnapshot: string;
  normUnitSnapshot?: string | null;
  workBoqQtySnapshot: number;
  workBoqUnitSnapshot?: string | null;
  status: 'active' | 'removed';
  selectedComponentIds?: string[];
  overrideData?: Record<string, unknown>;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectWorkBoqNormComponentEstimateRecord {
  id: string;
  mappingId: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  workBoqItemId?: string | null;
  costNormComponentId?: string | null;
  costNormResourceId?: string | null;
  resourceType: CostNormResourceType;
  resourceCodeSnapshot?: string | null;
  resourceNameSnapshot: string;
  unit?: string | null;
  coefficient?: number | null;
  workBoqQtySnapshot: number;
  estimatedQty: number;
  selected: boolean;
  materialBudgetItemId?: string | null;
  lineIndex: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface G8NormComponentPreview {
  componentId: string;
  resourceId?: string | null;
  resourceType: CostNormResourceType;
  resourceCode?: string | null;
  resourceName: string;
  unit?: string | null;
  coefficient: number;
  estimatedQty: number;
  selected: boolean;
  lineIndex: number;
  existingEstimateId?: string | null;
  materialBudgetItemId?: string | null;
}

export interface G8NormApplyPreview {
  workBoqItem: ProjectWorkBoqItem;
  library: CostNormLibraryRecord;
  normItem: CostNormItemRecord;
  mapping?: ProjectWorkBoqNormMappingRecord | null;
  estimates?: ProjectWorkBoqNormComponentEstimateRecord[];
  components: G8NormComponentPreview[];
}

export interface G8NormApplyOptions {
  selectedComponentIds?: string[];
  coefficientOverrides?: Record<string, number>;
  estimatedQtyOverrides?: Record<string, number>;
  inventoryItems?: InventoryItem[];
  actorId?: string | null;
}

export interface G8NormApplyResult {
  mapping: ProjectWorkBoqNormMappingRecord;
  estimates: ProjectWorkBoqNormComponentEstimateRecord[];
  materialBudgetItems: MaterialBudgetItem[];
}

const mapMappingRow = (row: any): ProjectWorkBoqNormMappingRecord => {
  const mapped = fromDb(row) as ProjectWorkBoqNormMappingRecord;
  return {
    ...mapped,
    selectedComponentIds: Array.isArray(mapped.selectedComponentIds) ? mapped.selectedComponentIds : [],
    overrideData: mapped.overrideData || {},
  };
};

const mapEstimateRow = (row: any): ProjectWorkBoqNormComponentEstimateRecord =>
  fromDb(row) as ProjectWorkBoqNormComponentEstimateRecord;

const mapComponentRows = (
  componentRows: any[],
  resourcesById: Map<string, CostNormResourceRecord>,
): CostNormComponentRecord[] =>
  componentRows.map(row => {
    const component = fromDb(row) as CostNormComponentRecord;
    return {
      ...component,
      resource: component.resourceId ? resourcesById.get(component.resourceId) || null : null,
    };
  });

const findInventoryMatch = (component: G8NormComponentPreview, inventoryItems: InventoryItem[] = []) => {
  const code = normalizeLookup(component.resourceCode);
  const name = normalizeLookup(component.resourceName);
  return inventoryItems.find(item => code && normalizeLookup(item.sku) === code)
    || inventoryItems.find(item => name && normalizeLookup(item.name) === name)
    || null;
};

const buildPreview = (
  workBoqItem: ProjectWorkBoqItem,
  library: CostNormLibraryRecord,
  normItem: CostNormItemRecord,
  mapping?: ProjectWorkBoqNormMappingRecord | null,
  estimates: ProjectWorkBoqNormComponentEstimateRecord[] = [],
  options: Pick<G8NormApplyOptions, 'selectedComponentIds' | 'coefficientOverrides' | 'estimatedQtyOverrides'> = {},
): G8NormApplyPreview => {
  const workQty = Number(workBoqItem.plannedQty || 0);
  const selectedSet = options.selectedComponentIds
    ? new Set(options.selectedComponentIds)
    : new Set((mapping?.selectedComponentIds || []).length ? mapping?.selectedComponentIds || [] : normItem.components.filter(row => row.resourceType === 'material').map(row => row.id));
  const estimatesByComponentId = new Map(estimates.map(row => [row.costNormComponentId || '', row]));

  const components = normItem.components.map(component => {
    const estimate = estimatesByComponentId.get(component.id);
    const coefficient = Number(options.coefficientOverrides?.[component.id] ?? estimate?.coefficient ?? component.coefficient ?? 0);
    const estimatedQty = roundQty(Number(options.estimatedQtyOverrides?.[component.id] ?? estimate?.estimatedQty ?? workQty * coefficient));
    return {
      componentId: component.id,
      resourceId: component.resourceId || null,
      resourceType: component.resourceType,
      resourceCode: component.rawResourceCode || component.resource?.code || null,
      resourceName: component.rawResourceName || component.resource?.name || '',
      unit: component.unit || component.resource?.unit || null,
      coefficient,
      estimatedQty,
      selected: selectedSet.has(component.id),
      lineIndex: component.lineIndex,
      existingEstimateId: estimate?.id || null,
      materialBudgetItemId: estimate?.materialBudgetItemId || null,
    };
  });

  return { workBoqItem, library, normItem, mapping: mapping || null, estimates, components };
};

const getActiveLibraries = async () => {
  const { data, error } = await supabase
    .from(LIBRARY_TABLE)
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).map(fromDb) as CostNormLibraryRecord[];
};

const getNormItemWithLibrary = async (normItemId: string) => {
  const { data: itemRow, error: itemError } = await supabase
    .from(ITEM_TABLE)
    .select('*')
    .eq('id', normItemId)
    .single();
  if (itemError) throw itemError;

  const item = fromDb(itemRow) as CostNormItemRecord;
  const { data: libraryRow, error: libraryError } = await supabase
    .from(LIBRARY_TABLE)
    .select('*')
    .eq('id', item.libraryId)
    .eq('status', 'active')
    .single();
  if (libraryError) throw libraryError;

  const componentRows = await fetchPaged<any>((from, to) => supabase
    .from(COMPONENT_TABLE)
    .select('*')
    .eq('norm_item_id', normItemId)
    .order('line_index', { ascending: true })
    .range(from, to) as any);
  const resourceIds = Array.from(new Set(componentRows.map(row => row.resource_id).filter(Boolean)));
  const resourceRows = (await Promise.all(chunk(resourceIds).map(ids =>
    fetchPaged<any>((from, to) => supabase
      .from(RESOURCE_TABLE)
      .select('*')
      .in('id', ids)
      .range(from, to) as any)
  ))).flat();
  const resourcesById = new Map<string, CostNormResourceRecord>();
  resourceRows.map(fromDb).forEach((row: any) => resourcesById.set(row.id, row));

  return {
    library: fromDb(libraryRow) as CostNormLibraryRecord,
    normItem: {
      ...item,
      components: mapComponentRows(componentRows, resourcesById),
    },
  };
};

const getWorkBoqItem = async (workBoqItemId: string): Promise<ProjectWorkBoqItem> => {
  const { data, error } = await supabase
    .from(WORK_BOQ_TABLE)
    .select('*')
    .eq('id', workBoqItemId)
    .single();
  if (error) throw error;
  return fromDb(data) as ProjectWorkBoqItem;
};

const getExistingMapping = async (workBoqItemId: string, normItemId: string) => {
  const { data, error } = await supabase
    .from(MAPPING_TABLE)
    .select('*')
    .eq('work_boq_item_id', workBoqItemId)
    .eq('cost_norm_item_id', normItemId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapMappingRow(data) : null;
};

const getEstimatesByMapping = async (mappingId: string) => {
  if (!mappingId) return [];
  const rows = await fetchPaged<any>((from, to) => supabase
    .from(ESTIMATE_TABLE)
    .select('*')
    .eq('mapping_id', mappingId)
    .order('line_index', { ascending: true })
    .range(from, to) as any);
  return rows.map(mapEstimateRow);
};

const getMaterialRowsByIds = async (ids: string[]) => {
  const usableIds = Array.from(new Set(ids.filter(Boolean)));
  if (!usableIds.length) return [];
  const rows = (await Promise.all(chunk(usableIds).map(batch =>
    fetchPaged<any>((from, to) => supabase
      .from(MATERIAL_BUDGET_TABLE)
      .select('*')
      .in('id', batch)
      .range(from, to) as any)
  ))).flat();
  return rows.map(fromDb) as MaterialBudgetItem[];
};

const hasDownstreamUsage = async (materialBudgetItemIds: string[]) => {
  const ids = Array.from(new Set(materialBudgetItemIds.filter(Boolean)));
  if (!ids.length) return false;
  for (const table of DOWNSTREAM_GUARD_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .in('material_budget_item_id', ids)
      .limit(1);
    if (error) {
      if (error.code === '42P01' || String(error.message || '').includes('does not exist')) continue;
      throw error;
    }
    if ((data || []).length > 0) return true;
  }
  return false;
};

const deleteGeneratedMaterialsIfUnused = async (materialBudgetItemIds: string[]) => {
  const ids = Array.from(new Set(materialBudgetItemIds.filter(Boolean)));
  if (!ids.length) return;
  if (await hasDownstreamUsage(ids)) {
    throw new Error('Định mức đã phát sinh yêu cầu/PO/cấp phát, không thể xoá vật tư tự động.');
  }
  const { error } = await supabase
    .from(MATERIAL_BUDGET_TABLE)
    .delete()
    .in('id', ids)
    .eq('source_type', 'g8_norm');
  if (error) throw error;
};

export const g8NormConsumptionService = {
  async searchActiveNormItems(query: string, limit = 20): Promise<G8NormSearchResult[]> {
    if (!isSupabaseConfigured) return [];
    const libraries = await getActiveLibraries();
    const librariesById = new Map(libraries.map(library => [library.id, library]));
    const libraryIds = libraries.map(library => library.id);
    if (!libraryIds.length) return [];

    let request: any = supabase
      .from(ITEM_TABLE)
      .select('*')
      .in('library_id', libraryIds)
      .order('code', { ascending: true })
      .limit(limit);
    const trimmed = normalizeText(query);
    if (trimmed) {
      const like = `%${escapeLike(trimmed)}%`;
      request = request.or(`code.ilike.${like},name.ilike.${like},search_text.ilike.${like}`);
    }
    const { data, error } = await request;
    if (error) throw error;
    return (data || []).map((row: any) => {
      const item = fromDb(row) as CostNormItemRecord;
      const library = librariesById.get(item.libraryId);
      return {
        id: item.id,
        libraryId: item.libraryId,
        libraryName: library?.name || '',
        libraryCode: library?.code || '',
        code: item.code,
        name: item.name,
        unit: item.unit,
        sourceRowStart: item.sourceRowStart,
      };
    });
  },

  async getNormItemWithComponents(normItemId: string) {
    if (!normItemId) throw new Error('Thiếu định mức G8.');
    assertSupabaseConfigured();
    return getNormItemWithLibrary(normItemId);
  },

  async listMappingsByWorkBoqIds(workBoqItemIds: string[]): Promise<ProjectWorkBoqNormMappingRecord[]> {
    if (!isSupabaseConfigured) return [];
    const ids = Array.from(new Set(workBoqItemIds.filter(Boolean)));
    if (!ids.length) return [];
    const rows = (await Promise.all(chunk(ids).map(batch =>
      fetchPaged<any>((from, to) => supabase
        .from(MAPPING_TABLE)
        .select('*')
        .in('work_boq_item_id', batch)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .range(from, to) as any)
    ))).flat();
    return rows.map(mapMappingRow);
  },

  async getMappingDetails(mappingId: string): Promise<G8NormApplyPreview | null> {
    if (!isSupabaseConfigured || !mappingId) return null;
    const { data: mappingRow, error: mappingError } = await supabase
      .from(MAPPING_TABLE)
      .select('*')
      .eq('id', mappingId)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mappingRow) return null;
    const mapping = mapMappingRow(mappingRow);
    if (!mapping.costNormItemId) return null;
    const [workBoqItem, details, estimates] = await Promise.all([
      getWorkBoqItem(mapping.workBoqItemId),
      getNormItemWithLibrary(mapping.costNormItemId),
      getEstimatesByMapping(mapping.id),
    ]);
    return buildPreview(workBoqItem, details.library, details.normItem, mapping, estimates);
  },

  async previewApplyNorm(workBoqItemId: string, normItemId: string, options: Pick<G8NormApplyOptions, 'selectedComponentIds' | 'coefficientOverrides' | 'estimatedQtyOverrides'> = {}): Promise<G8NormApplyPreview> {
    if (!workBoqItemId) throw new Error('Thiếu đầu mục BOQ triển khai.');
    if (!normItemId) throw new Error('Thiếu định mức G8.');
    assertSupabaseConfigured();
    const [workBoqItem, details] = await Promise.all([
      getWorkBoqItem(workBoqItemId),
      getNormItemWithLibrary(normItemId),
    ]);
    const mapping = await getExistingMapping(workBoqItemId, normItemId);
    const estimates = mapping ? await getEstimatesByMapping(mapping.id) : [];
    return buildPreview(workBoqItem, details.library, details.normItem, mapping, estimates, options);
  },

  async applyNormToWorkBoq(workBoqItemId: string, normItemId: string, options: G8NormApplyOptions = {}): Promise<G8NormApplyResult> {
    assertSupabaseConfigured();
    const preview = await this.previewApplyNorm(workBoqItemId, normItemId, options);
    if (Number(preview.workBoqItem.plannedQty || 0) <= 0) {
      throw new Error('Đầu mục BOQ chưa có khối lượng dự toán.');
    }

    const selectedComponentIds = options.selectedComponentIds || preview.components.filter(component => component.resourceType === 'material').map(component => component.componentId);
    const selectedSet = new Set(selectedComponentIds);
    const existingMapping = preview.mapping || null;
    const mappingId = existingMapping?.id || newId();
    const now = new Date().toISOString();

    const mappingPayload = toDb({
      id: mappingId,
      projectId: preview.workBoqItem.projectId || null,
      constructionSiteId: preview.workBoqItem.constructionSiteId || null,
      workBoqItemId,
      costNormLibraryId: preview.library.id,
      costNormItemId: preview.normItem.id,
      normCodeSnapshot: preview.normItem.code,
      normNameSnapshot: preview.normItem.name,
      normUnitSnapshot: preview.normItem.unit || null,
      workBoqQtySnapshot: Number(preview.workBoqItem.plannedQty || 0),
      workBoqUnitSnapshot: preview.workBoqItem.unit || null,
      status: 'active',
      selectedComponentIds,
      overrideData: {
        coefficientOverrides: options.coefficientOverrides || {},
        estimatedQtyOverrides: options.estimatedQtyOverrides || {},
      },
      createdBy: existingMapping?.createdBy || options.actorId || null,
      updatedBy: options.actorId || null,
      createdAt: existingMapping?.createdAt || now,
    });
    const { data: mappingRows, error: mappingError } = await supabase
      .from(MAPPING_TABLE)
      .upsert(mappingPayload, { onConflict: 'id' })
      .select('*');
    if (mappingError) throw mappingError;
    const rawMappingRow = (mappingRows || [])[0] || mappingPayload;
    const mappedRow = mapMappingRow(rawMappingRow);
    const mapping = {
      ...mappedRow,
      id: mappedRow.id || mappingId,
    };
    const persistedMappingId = mapping.id || mappingId;

    const existingEstimates = await getEstimatesByMapping(persistedMappingId);
    const estimatesByComponentId = new Map(existingEstimates.map(row => [row.costNormComponentId || '', row]));
    const estimateRows = preview.components.map(component => {
      const existing = estimatesByComponentId.get(component.componentId);
      return toDb({
        id: existing?.id || newId(),
        mappingId: persistedMappingId,
        projectId: preview.workBoqItem.projectId || null,
        constructionSiteId: preview.workBoqItem.constructionSiteId || null,
        workBoqItemId,
        costNormComponentId: component.componentId,
        costNormResourceId: component.resourceId || null,
        resourceType: component.resourceType,
        resourceCodeSnapshot: component.resourceCode || null,
        resourceNameSnapshot: component.resourceName,
        unit: component.unit || null,
        coefficient: component.coefficient,
        workBoqQtySnapshot: Number(preview.workBoqItem.plannedQty || 0),
        estimatedQty: component.estimatedQty,
        selected: selectedSet.has(component.componentId),
        materialBudgetItemId: existing?.materialBudgetItemId || null,
        lineIndex: component.lineIndex,
      });
    });
    const { data: estimateData, error: estimateError } = await supabase
      .from(ESTIMATE_TABLE)
      .upsert(estimateRows, { onConflict: 'id' })
      .select('*');
    if (estimateError) throw estimateError;
    let estimates = (estimateData || []).map(mapEstimateRow);
    const estimateByComponentId = new Map(estimates.map(row => [row.costNormComponentId || '', row]));

    const selectedMaterialComponents = preview.components.filter(component => component.resourceType === 'material' && selectedSet.has(component.componentId));
    const selectedMaterialIds = new Set(selectedMaterialComponents.map(component => component.componentId));
    const deselectedGeneratedMaterialIds = estimates
      .filter(estimate => estimate.resourceType === 'material' && estimate.materialBudgetItemId && !selectedMaterialIds.has(estimate.costNormComponentId || ''))
      .map(estimate => estimate.materialBudgetItemId as string);
    if (deselectedGeneratedMaterialIds.length) {
      await deleteGeneratedMaterialsIfUnused(deselectedGeneratedMaterialIds);
    }

    const materialRows = selectedMaterialComponents.map(component => {
      const estimate = estimateByComponentId.get(component.componentId);
      const inventory = findInventoryMatch(component, options.inventoryItems || []);
      const existingId = estimate?.materialBudgetItemId || newId();
      const unitPrice = Number(inventory?.priceIn || 0);
      return toDb({
        id: existingId,
        projectId: preview.workBoqItem.projectId || null,
        constructionSiteId: preview.workBoqItem.constructionSiteId || null,
        workBoqItemId,
        inventoryItemId: inventory?.id || undefined,
        materialCode: component.resourceCode || inventory?.sku || undefined,
        category: inventory?.category || 'Vật liệu định mức G8',
        itemName: inventory?.name || component.resourceName,
        unit: inventory?.unit || component.unit || '',
        budgetQty: component.estimatedQty,
        budgetUnitPrice: unitPrice,
        budgetTotal: component.estimatedQty * unitPrice,
        actualQty: 0,
        wasteThreshold: component.coefficient,
        sortOrder: component.lineIndex,
        notes: `Sinh từ định mức G8 ${preview.normItem.code}`,
        sourceType: 'g8_norm',
        sourceNormMappingId: persistedMappingId,
        sourceNormComponentEstimateId: estimate?.id || null,
        sourceNormCodeSnapshot: preview.normItem.code,
      });
    });

    let materialBudgetItems: MaterialBudgetItem[] = [];
    if (materialRows.length) {
      const { data: materialData, error: materialError } = await supabase
        .from(MATERIAL_BUDGET_TABLE)
        .upsert(materialRows, { onConflict: 'id' })
        .select('*');
      if (materialError) throw materialError;
      materialBudgetItems = (materialData || []).map(fromDb) as MaterialBudgetItem[];
    }

    const materialByEstimateId = new Map(materialBudgetItems.map(item => [item.sourceNormComponentEstimateId || '', item]));
    const estimateUpdates = estimates.map(estimate => {
      const material = materialByEstimateId.get(estimate.id);
      const shouldClearMaterial = estimate.resourceType === 'material' && !selectedMaterialIds.has(estimate.costNormComponentId || '');
      return toDb({
        id: estimate.id,
        materialBudgetItemId: shouldClearMaterial ? null : material?.id || estimate.materialBudgetItemId || null,
        selected: selectedSet.has(estimate.costNormComponentId || ''),
      });
    });
    const { data: refreshedEstimateData, error: refreshedEstimateError } = await supabase
      .from(ESTIMATE_TABLE)
      .upsert(estimateUpdates, { onConflict: 'id' })
      .select('*');
    if (refreshedEstimateError) throw refreshedEstimateError;
    estimates = (refreshedEstimateData || []).map(mapEstimateRow);

    return { mapping, estimates, materialBudgetItems };
  },

  async removeNormMapping(mappingId: string, mode: 'delete_materials' | 'unlink_only' = 'delete_materials'): Promise<void> {
    assertSupabaseConfigured();
    const details = await this.getMappingDetails(mappingId);
    if (!details?.mapping) throw new Error('Không tìm thấy mapping định mức G8.');
    const estimates = await getEstimatesByMapping(mappingId);
    const materialIds = estimates.map(row => row.materialBudgetItemId).filter(Boolean) as string[];

    if (mode === 'delete_materials') {
      await deleteGeneratedMaterialsIfUnused(materialIds);
    } else if (materialIds.length) {
      const { error: materialError } = await supabase
        .from(MATERIAL_BUDGET_TABLE)
        .update(toDb({
          sourceType: 'manual',
          sourceNormMappingId: null,
          sourceNormComponentEstimateId: null,
          sourceNormCodeSnapshot: null,
        }))
        .in('id', materialIds)
        .eq('source_type', 'g8_norm');
      if (materialError) throw materialError;
    }

    if (estimates.length) {
      const { error: estimateError } = await supabase
        .from(ESTIMATE_TABLE)
        .upsert(estimates.map(row => toDb({ id: row.id, selected: false, materialBudgetItemId: null })), { onConflict: 'id' });
      if (estimateError) throw estimateError;
    }

    const { error: mappingError } = await supabase
      .from(MAPPING_TABLE)
      .update(toDb({ status: 'removed' }))
      .eq('id', mappingId);
    if (mappingError) throw mappingError;
  },

  async getGeneratedMaterialRows(mappingId: string): Promise<MaterialBudgetItem[]> {
    if (!isSupabaseConfigured || !mappingId) return [];
    const { data, error } = await supabase
      .from(MATERIAL_BUDGET_TABLE)
      .select('*')
      .eq('source_norm_mapping_id', mappingId)
      .eq('source_type', 'g8_norm');
    if (error) throw error;
    return (data || []).map(fromDb) as MaterialBudgetItem[];
  },
};
