import type {
  BoqMaterialPlanPreview,
  ConvertMaterialPlanInput,
  MaterialPlanAllocation,
  MaterialPlanCommandResult,
  MaterialPlanConversionResult,
  MaterialPlanConversionSummary,
  MaterialPlanDetail,
  MaterialPlanLine,
  MaterialPlanLineDraft,
  MaterialPlanRevisionSummary,
  MaterialPlanStatus,
  MaterialPlanSummary,
  SaveMaterialPlanInput,
} from '../../types/materialPlanning';
import { formatDecimal6, parseQuantity6 } from '../procurement/decimal';
import { mapErpCompletionCommandError } from '../erpCompletionRollout';
import { supabase } from '../supabase';

type JsonObject = Record<string, unknown>;

const fail = (code: string): never => { throw new Error(code); };
const object = (value: unknown, code: string): JsonObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : fail(code)
);
const array = (value: unknown, code: string): unknown[] => Array.isArray(value) ? value : fail(code);
const string = (value: unknown, code: string): string => (
  typeof value === 'string' && value.length > 0 ? value : fail(code)
);
const nullableString = (value: unknown, code: string): string | null => value === null ? null : string(value, code);
const integer = (value: unknown, code: string): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail(code)
);
const count = (value: unknown, code: string): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(code)
);
const boolean = (value: unknown, code: string): boolean => typeof value === 'boolean' ? value : fail(code);
const isoDate = (value: unknown, code: string): string => {
  const result = string(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(code);
  return result;
};
const instant = (value: unknown, code: string): string => {
  const result = string(value, code);
  if (!Number.isFinite(Date.parse(result))) fail(code);
  return result;
};
const decimal = (value: unknown, code: string): string => {
  const result = string(value, code);
  parseQuantity6(result);
  return result;
};
const unit = (value: unknown): string => {
  const result = string(value, 'MATERIAL_PLAN_UNIT_INVALID');
  if (result.trim() !== result) fail('MATERIAL_PLAN_UNIT_INVALID');
  return result;
};
const status = (value: unknown): MaterialPlanStatus => {
  const result = string(value, 'MATERIAL_PLAN_STATUS_INVALID');
  if (!['draft', 'confirmed', 'superseded', 'cancelled'].includes(result)) fail('MATERIAL_PLAN_STATUS_INVALID');
  return result as MaterialPlanStatus;
};

const assertIdentity = (value: string, code: string): string => {
  if (!value.trim()) fail(code);
  return value;
};

const mapAllocation = (value: unknown): MaterialPlanAllocation => {
  const source = object(value, 'MATERIAL_PLAN_ALLOCATION_INVALID');
  const quantity = decimal(source.quantity, 'MATERIAL_PLAN_DECIMAL_INVALID');
  const convertedQty = decimal(source.convertedQty, 'MATERIAL_PLAN_DECIMAL_INVALID');
  const remainingQty = decimal(source.remainingQty, 'MATERIAL_PLAN_DECIMAL_INVALID');
  if (parseQuantity6(convertedQty) + parseQuantity6(remainingQty) !== parseQuantity6(quantity)) {
    fail('MATERIAL_PLAN_ALLOCATION_BALANCE_MISMATCH');
  }
  return {
    id: string(source.id, 'MATERIAL_PLAN_ALLOCATION_ID_INVALID'),
    sourceBudgetLineId: string(source.sourceBudgetLineId, 'MATERIAL_PLAN_SOURCE_INVALID'),
    sourceWorkBoqItemId: nullableString(source.sourceWorkBoqItemId, 'MATERIAL_PLAN_SOURCE_INVALID'),
    sourceTaskId: nullableString(source.sourceTaskId, 'MATERIAL_PLAN_SOURCE_INVALID'),
    quantity,
    convertedQty,
    remainingQty,
    neededDate: isoDate(source.neededDate, 'MATERIAL_PLAN_DATE_INVALID'),
    destination: string(source.destination, 'MATERIAL_PLAN_DESTINATION_INVALID'),
  };
};

const mapLine = (value: unknown): MaterialPlanLine => {
  const source = object(value, 'MATERIAL_PLAN_LINE_INVALID');
  const lineUnit = unit(source.unit);
  const quantity = decimal(source.quantity, 'MATERIAL_PLAN_DECIMAL_INVALID');
  const convertedQty = decimal(source.convertedQty, 'MATERIAL_PLAN_DECIMAL_INVALID');
  const remainingQty = decimal(source.remainingQty, 'MATERIAL_PLAN_DECIMAL_INVALID');
  const allocations = array(source.allocations, 'MATERIAL_PLAN_ALLOCATIONS_INVALID')
    .map(mapAllocation);
  const allocationTotal = allocations.reduce((sum, item) => sum + parseQuantity6(item.quantity), 0n);
  const allocationConverted = allocations.reduce((sum, item) => sum + parseQuantity6(item.convertedQty), 0n);
  if (allocationTotal !== parseQuantity6(quantity)
      || allocationConverted !== parseQuantity6(convertedQty)
      || parseQuantity6(convertedQty) + parseQuantity6(remainingQty) !== parseQuantity6(quantity)) {
    fail('MATERIAL_PLAN_LINE_BALANCE_MISMATCH');
  }
  return {
    id: string(source.id, 'MATERIAL_PLAN_LINE_ID_INVALID'),
    itemId: string(source.itemId, 'MATERIAL_PLAN_ITEM_ID_INVALID'),
    sku: nullableString(source.sku, 'MATERIAL_PLAN_SKU_INVALID'),
    itemName: string(source.itemName, 'MATERIAL_PLAN_ITEM_NAME_INVALID'),
    unit: lineUnit,
    quantity,
    convertedQty,
    remainingQty,
    neededDate: isoDate(source.neededDate, 'MATERIAL_PLAN_DATE_INVALID'),
    destination: string(source.destination, 'MATERIAL_PLAN_DESTINATION_INVALID'),
    allocations,
  };
};

const mapRevision = (value: unknown): MaterialPlanRevisionSummary => {
  const source = object(value, 'MATERIAL_PLAN_REVISION_INVALID');
  const sourceHash = string(source.sourceHash, 'MATERIAL_PLAN_HASH_INVALID');
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) fail('MATERIAL_PLAN_HASH_INVALID');
  return {
    version: integer(source.version, 'MATERIAL_PLAN_VERSION_INVALID'),
    sourceHash,
    changedBy: string(source.changedBy, 'MATERIAL_PLAN_ACTOR_INVALID'),
    createdAt: instant(source.createdAt, 'MATERIAL_PLAN_INSTANT_INVALID'),
  };
};

const mapConversion = (value: unknown): MaterialPlanConversionSummary => {
  const source = object(value, 'MATERIAL_PLAN_CONVERSION_INVALID');
  const state = string(source.state, 'MATERIAL_PLAN_CONVERSION_STATE_INVALID');
  if (!['active', 'reversed'].includes(state)) fail('MATERIAL_PLAN_CONVERSION_STATE_INVALID');
  return {
    id: string(source.id, 'MATERIAL_PLAN_CONVERSION_ID_INVALID'),
    planVersion: integer(source.planVersion, 'MATERIAL_PLAN_VERSION_INVALID'),
    requestId: string(source.requestId, 'MATERIAL_PLAN_REQUEST_INVALID'),
    requestCode: string(source.requestCode, 'MATERIAL_PLAN_REQUEST_INVALID'),
    quantity: decimal(source.quantity, 'MATERIAL_PLAN_DECIMAL_INVALID'),
    unit: unit(source.unit),
    state: state as 'active' | 'reversed',
    createdAt: instant(source.createdAt, 'MATERIAL_PLAN_INSTANT_INVALID'),
  };
};

const mapDetail = (value: unknown, expectedScope?: { projectId: string; constructionSiteId: string | null }): MaterialPlanDetail => {
  const source = object(value, 'MATERIAL_PLAN_DETAIL_INVALID');
  const projectId = string(source.projectId, 'MATERIAL_PLAN_SCOPE_INVALID');
  const constructionSiteId = nullableString(source.constructionSiteId, 'MATERIAL_PLAN_SCOPE_INVALID');
  if (expectedScope && (projectId !== expectedScope.projectId
      || constructionSiteId !== expectedScope.constructionSiteId)) fail('MATERIAL_PLAN_SCOPE_MISMATCH');
  const capabilities = object(source.capabilities, 'MATERIAL_PLAN_CAPABILITIES_INVALID');
  const periodStart = isoDate(source.periodStart, 'MATERIAL_PLAN_DATE_INVALID');
  const periodEnd = isoDate(source.periodEnd, 'MATERIAL_PLAN_DATE_INVALID');
  if (periodEnd < periodStart) fail('MATERIAL_PLAN_DATE_INVALID');
  return {
    id: string(source.id, 'MATERIAL_PLAN_ID_INVALID'),
    planNo: string(source.planNo, 'MATERIAL_PLAN_NO_INVALID'),
    projectId,
    constructionSiteId,
    title: string(source.title, 'MATERIAL_PLAN_TITLE_INVALID'),
    periodStart,
    periodEnd,
    note: nullableString(source.note, 'MATERIAL_PLAN_NOTE_INVALID'),
    status: status(source.status),
    version: integer(source.version, 'MATERIAL_PLAN_VERSION_INVALID'),
    createdBy: string(source.createdBy, 'MATERIAL_PLAN_ACTOR_INVALID'),
    createdAt: instant(source.createdAt, 'MATERIAL_PLAN_INSTANT_INVALID'),
    updatedAt: instant(source.updatedAt, 'MATERIAL_PLAN_INSTANT_INVALID'),
    capabilities: {
      canEdit: boolean(capabilities.canEdit, 'MATERIAL_PLAN_CAPABILITIES_INVALID'),
      canConvert: boolean(capabilities.canConvert, 'MATERIAL_PLAN_CAPABILITIES_INVALID'),
    },
    lines: array(source.lines, 'MATERIAL_PLAN_LINES_INVALID').map(mapLine),
    revisions: array(source.revisions, 'MATERIAL_PLAN_REVISIONS_INVALID').map(mapRevision),
    conversions: array(source.conversions, 'MATERIAL_PLAN_CONVERSIONS_INVALID').map(mapConversion),
  };
};

const mapCommand = (value: unknown): MaterialPlanCommandResult => {
  const source = object(value, 'MATERIAL_PLAN_COMMAND_RESPONSE_INVALID');
  const outcome = string(source.outcome, 'MATERIAL_PLAN_COMMAND_RESPONSE_INVALID');
  if (!['committed', 'replayed'].includes(outcome)) fail('MATERIAL_PLAN_COMMAND_RESPONSE_INVALID');
  return {
    commandId: string(source.commandId, 'MATERIAL_PLAN_COMMAND_RESPONSE_INVALID'),
    outcome: outcome as 'committed' | 'replayed',
  };
};

const validateDraftLine = (line: MaterialPlanLineDraft) => {
  assertIdentity(line.id, 'MATERIAL_PLAN_LINE_ID_INVALID');
  assertIdentity(line.itemId, 'MATERIAL_PLAN_ITEM_ID_INVALID');
  unit(line.unit);
  const total = parseQuantity6(line.quantity);
  if (total <= 0n || line.allocations.length === 0) fail('MATERIAL_PLAN_LINE_INVALID');
  const allocationTotal = line.allocations.reduce((sum, allocation) => {
    assertIdentity(allocation.id, 'MATERIAL_PLAN_ALLOCATION_ID_INVALID');
    assertIdentity(allocation.sourceBudgetLineId, 'MATERIAL_PLAN_SOURCE_INVALID');
    return sum + parseQuantity6(allocation.quantity);
  }, 0n);
  if (allocationTotal !== total) fail('MATERIAL_PLAN_LINE_TOTAL_MISMATCH');
};

export function buildMaterialPlanDraft(input: {
  preview: BoqMaterialPlanPreview;
  identity?: () => string;
}): { lines: MaterialPlanLineDraft[] } {
  const identity = input.identity ?? (() => crypto.randomUUID());
  const lines = input.preview.groups.map(group => {
    if (group.key !== `${group.itemId}:${group.unit}`) fail('MATERIAL_PLAN_ALLOCATION_UNIT_MISMATCH');
    const allocationTotal = group.allocations.reduce((sum, item) => sum + parseQuantity6(item.quantity), 0n);
    if (allocationTotal !== parseQuantity6(group.totalQty)) fail('MATERIAL_PLAN_LINE_TOTAL_MISMATCH');
    const first = group.allocations[0];
    if (!first) fail('MATERIAL_PLAN_LINE_INVALID');
    return {
      id: identity(),
      itemId: group.itemId,
      sku: group.sku,
      itemName: group.itemName,
      unit: group.unit,
      quantity: formatDecimal6(allocationTotal),
      neededDate: group.allocations.map(item => item.neededDate).sort()[0],
      destination: new Set(group.allocations.map(item => item.destination)).size === 1
        ? first.destination
        : 'Nhiều điểm nhận',
      allocations: group.allocations.map(allocation => ({ id: identity(), ...allocation })),
    };
  });
  lines.forEach(validateDraftLine);
  return { lines };
}

const validateSave = (input: SaveMaterialPlanInput) => {
  if (!input.projectId.trim() || !input.title.trim() || !input.idempotencyKey.trim()
      || input.payloadSchemaVersion !== 1 || !['draft', 'confirmed'].includes(input.status)
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart)
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd)
      || input.periodEnd < input.periodStart || input.lines.length === 0) fail('MATERIAL_PLAN_COMMAND_INVALID');
  if ((input.planId === null) !== (input.expectedVersion === null)) fail('MATERIAL_PLAN_EXPECTED_VERSION_INVALID');
  if (input.expectedVersion !== null && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    fail('MATERIAL_PLAN_EXPECTED_VERSION_INVALID');
  }
  const identities = new Set<string>();
  input.lines.forEach(line => {
    validateDraftLine(line);
    for (const id of [line.id, ...line.allocations.map(item => item.id)]) {
      if (identities.has(id)) fail('MATERIAL_PLAN_ID_DUPLICATE');
      identities.add(id);
    }
  });
};

const validateConvert = (input: ConvertMaterialPlanInput) => {
  if (!input.planId.trim() || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
      || !input.siteWarehouseId.trim() || !input.idempotencyKey.trim()
      || input.payloadSchemaVersion !== 1 || input.allocations.length === 0
      || !['RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION'].includes(input.fulfillmentMode)) {
    fail('MATERIAL_PLAN_COMMAND_INVALID');
  }
  const ids = new Set<string>();
  input.allocations.forEach(item => {
    if (!item.allocationId.trim() || parseQuantity6(item.quantity) <= 0n || ids.has(item.allocationId)) {
      fail('MATERIAL_PLAN_CONVERSION_INVALID');
    }
    ids.add(item.allocationId);
  });
};

export const materialPlanService = {
  async save(input: SaveMaterialPlanInput): Promise<{ plan: MaterialPlanDetail; command: MaterialPlanCommandResult }> {
    validateSave(input);
    const { data, error } = await supabase.rpc('save_material_plan_v1' as never, {
      p_plan_id: input.planId,
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId,
      p_expected_version: input.expectedVersion,
      p_title: input.title.trim(),
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_note: input.note?.trim() || null,
      p_status: input.status,
      p_lines: input.lines,
      p_payload_schema_version: input.payloadSchemaVersion,
      p_idempotency_key: input.idempotencyKey,
    } as never);
    if (error) throw mapErpCompletionCommandError(error);
    const result = object(data, 'MATERIAL_PLAN_COMMAND_RESPONSE_INVALID');
    return {
      plan: mapDetail(result.plan, { projectId: input.projectId, constructionSiteId: input.constructionSiteId }),
      command: mapCommand(result.command),
    };
  },

  async get(input: { planId: string; projectId: string; constructionSiteId: string | null }): Promise<MaterialPlanDetail> {
    if (!input.planId.trim() || !input.projectId.trim()) fail('MATERIAL_PLAN_SCOPE_REQUIRED');
    const { data, error } = await supabase.rpc('get_material_plan_v1' as never, {
      p_plan_id: input.planId,
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId,
    } as never);
    if (error) throw error;
    if (data == null) fail('MATERIAL_PLAN_NOT_FOUND');
    return mapDetail(data, { projectId: input.projectId, constructionSiteId: input.constructionSiteId });
  },

  async list(input: { projectId: string; constructionSiteId: string | null }): Promise<MaterialPlanSummary[]> {
    if (!input.projectId.trim()) fail('MATERIAL_PLAN_SCOPE_REQUIRED');
    const { data, error } = await supabase.rpc('list_material_plans_v1' as never, {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId,
    } as never);
    if (error) throw error;
    return array(data, 'MATERIAL_PLAN_LIST_INVALID').map(value => {
      const source = object(value, 'MATERIAL_PLAN_SUMMARY_INVALID');
      return {
        id: string(source.id, 'MATERIAL_PLAN_ID_INVALID'),
        planNo: string(source.planNo, 'MATERIAL_PLAN_NO_INVALID'),
        title: string(source.title, 'MATERIAL_PLAN_TITLE_INVALID'),
        periodStart: isoDate(source.periodStart, 'MATERIAL_PLAN_DATE_INVALID'),
        periodEnd: isoDate(source.periodEnd, 'MATERIAL_PLAN_DATE_INVALID'),
        status: status(source.status),
        version: integer(source.version, 'MATERIAL_PLAN_VERSION_INVALID'),
        lineCount: count(source.lineCount, 'MATERIAL_PLAN_COUNT_INVALID'),
        remainingAllocationCount: count(source.remainingAllocationCount, 'MATERIAL_PLAN_COUNT_INVALID'),
        updatedAt: instant(source.updatedAt, 'MATERIAL_PLAN_INSTANT_INVALID'),
      };
    });
  },

  async convert(input: ConvertMaterialPlanInput): Promise<MaterialPlanConversionResult> {
    validateConvert(input);
    const { data, error } = await supabase.rpc('convert_material_plan_to_request_v1' as never, {
      p_plan_id: input.planId,
      p_expected_version: input.expectedVersion,
      p_site_warehouse_id: input.siteWarehouseId,
      p_fulfillment_mode: input.fulfillmentMode,
      p_allocations: input.allocations,
      p_payload_schema_version: input.payloadSchemaVersion,
      p_idempotency_key: input.idempotencyKey,
    } as never);
    if (error) throw mapErpCompletionCommandError(error);
    const source = object(data, 'MATERIAL_PLAN_COMMAND_RESPONSE_INVALID');
    const command = mapCommand(source);
    return {
      ...command,
      planId: string(source.planId, 'MATERIAL_PLAN_ID_INVALID'),
      planVersion: integer(source.planVersion, 'MATERIAL_PLAN_VERSION_INVALID'),
      requestId: string(source.requestId, 'MATERIAL_PLAN_REQUEST_INVALID'),
      requestCode: string(source.requestCode, 'MATERIAL_PLAN_REQUEST_INVALID'),
      convertedQty: decimal(source.convertedQty, 'MATERIAL_PLAN_DECIMAL_INVALID'),
    };
  },
};
