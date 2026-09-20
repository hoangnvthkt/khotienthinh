import type { ProcurementCommandResult } from '../../types/procurementIdentity';
import { formatDecimal6, parseDecimal6, parseQuantity6 } from './decimal';
import { supabase } from '../supabase';

export type ProcurementAllocationMethod = 'stock' | 'po' | 'direct_purchase' | 'contract_delivery' | 'material_plan';
export type ProcurementAllocationState = 'planned' | 'reserved' | 'committed';

export interface ProcurementAllocationQuantities {
  reservedNeedQty: string;
  committedNeedQty: string;
  executionQty: string;
  executionUnit: string;
  needUnit: string;
  conversionNumerator: string;
  conversionDenominator: string;
}

export function validateAllocationQuantities(input: ProcurementAllocationQuantities) {
  if (!input.executionUnit.trim() || !input.needUnit.trim()) throw new Error('PROCUREMENT_UNIT_REQUIRED');
  const reserved = parseQuantity6(input.reservedNeedQty);
  const committed = parseQuantity6(input.committedNeedQty);
  const execution = parseQuantity6(input.executionQty);
  const numerator = parseQuantity6(input.conversionNumerator);
  const denominator = parseQuantity6(input.conversionDenominator);
  if (reserved + committed <= 0n || execution <= 0n || numerator <= 0n || denominator <= 0n) {
    throw new Error('PROCUREMENT_ALLOCATION_QUANTITY_INVALID');
  }
  const convertedNumerator = execution * numerator;
  if (convertedNumerator % denominator !== 0n || convertedNumerator / denominator !== reserved + committed) {
    throw new Error('PROCUREMENT_CONVERSION_MISMATCH');
  }
  return {
    reservedNeedQty: formatDecimal6(reserved),
    committedNeedQty: formatDecimal6(committed),
    executionQty: formatDecimal6(execution),
  };
}

export interface SaveProcurementAllocationInput extends ProcurementAllocationQuantities {
  demandLineId: string;
  sourceRevisionId: string;
  executionSourceLineRegistryId: string;
  method: ProcurementAllocationMethod;
  state: ProcurementAllocationState;
  expectedDemandLineVersion: number;
  idempotencyKey: string;
  reason: string;
}

export interface RecordProcurementFulfillmentInput {
  allocationId: string;
  sourceRevisionId: string;
  canonicalEffectId: string;
  effectKind: 'receipt' | 'return' | 'reversal';
  quantity: string;
  unit: string;
  reversesAttributionId?: string | null;
  expectedDemandLineVersion: number;
  idempotencyKey: string;
}

const assertVersionAndKey = (version: number, key: string) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('PROCUREMENT_EXPECTED_VERSION_REQUIRED');
  if (!key.trim()) throw new Error('PROCUREMENT_COMMAND_INVALID');
};

export const procurementAllocationService = {
  async save(input: SaveProcurementAllocationInput): Promise<ProcurementCommandResult> {
    assertVersionAndKey(input.expectedDemandLineVersion, input.idempotencyKey);
    if (!input.reason.trim()) throw new Error('PROCUREMENT_REASON_REQUIRED');
    const quantity = validateAllocationQuantities(input);
    const { data, error } = await supabase.rpc('save_procurement_allocation_v1', {
      p_demand_line_id: input.demandLineId,
      p_source_revision_id: input.sourceRevisionId,
      p_execution_source_line_registry_id: input.executionSourceLineRegistryId,
      p_method: input.method,
      p_state: input.state,
      p_reserved_need_qty: quantity.reservedNeedQty,
      p_committed_need_qty: quantity.committedNeedQty,
      p_need_unit: input.needUnit,
      p_execution_qty: quantity.executionQty,
      p_execution_unit: input.executionUnit,
      p_conversion_numerator: input.conversionNumerator,
      p_conversion_denominator: input.conversionDenominator,
      p_expected_demand_line_version: input.expectedDemandLineVersion,
      p_reason: input.reason.trim(),
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('PROCUREMENT_COMMAND_RESPONSE_INVALID');
    return data as ProcurementCommandResult;
  },

  async recordFulfillment(input: RecordProcurementFulfillmentInput): Promise<ProcurementCommandResult> {
    assertVersionAndKey(input.expectedDemandLineVersion, input.idempotencyKey);
    const quantity = parseDecimal6(input.quantity);
    if (!input.unit.trim() || quantity === 0n) throw new Error('PROCUREMENT_EFFECT_QUANTITY_INVALID');
    if (input.effectKind === 'receipt' && quantity < 0n) throw new Error('PROCUREMENT_EFFECT_SIGN_INVALID');
    if (input.effectKind !== 'receipt' && (!input.reversesAttributionId || quantity > 0n)) {
      throw new Error('PROCUREMENT_REVERSAL_LINK_REQUIRED');
    }
    const { data, error } = await supabase.rpc('record_procurement_fulfillment_attribution_v1', {
      p_allocation_id: input.allocationId,
      p_source_revision_id: input.sourceRevisionId,
      p_canonical_effect_id: input.canonicalEffectId,
      p_effect_kind: input.effectKind,
      p_quantity: formatDecimal6(quantity),
      p_unit: input.unit,
      p_reverses_attribution_id: input.reversesAttributionId || null,
      p_expected_demand_line_version: input.expectedDemandLineVersion,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('PROCUREMENT_COMMAND_RESPONSE_INVALID');
    return data as ProcurementCommandResult;
  },
};
