import { supabase } from '../supabase';
import { buildProcurementPurchaseDraft, type ProcurementPurchaseOrderInput,
  type ProcurementPurchaseSelection } from './procurementPurchaseDraft';

export type ProcurementPurchaseCandidate = Omit<ProcurementPurchaseSelection,
  'needQty' | 'unitPrice' | 'vendorId' | 'vendorName' | 'warehouseId' | 'note' | 'poLineId' | 'fulfilledQty' | 'purchaseUnit' | 'conversionNumerator' | 'conversionDenominator'> & {
    fulfilledQty: string | null;
    destinationId: string | null;
    purchaseUnit: string | null;
    conversionNumerator: string | null;
    conversionDenominator: string | null;
  };

export interface ProcurementPurchaseCandidatePage {
  projectId: string;
  constructionSiteId: string | null;
  canViewPrice: boolean;
  canAllocate: boolean;
  lines: ProcurementPurchaseCandidate[];
}

export const procurementPurchaseOrderService = {
  async listCandidates(demandId: string): Promise<ProcurementPurchaseCandidatePage> {
    if (!demandId.trim()) throw new Error('PROCUREMENT_DEMAND_ID_REQUIRED');
    const { data, error } = await supabase.rpc('get_procurement_purchase_candidates_v1', {
      p_demand_id: demandId,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || !Array.isArray((data as Record<string, unknown>).lines))
      throw new Error('PROCUREMENT_PURCHASE_CANDIDATES_INVALID');
    const page = data as ProcurementPurchaseCandidatePage;
    return { ...page, lines: page.lines.map(line => ({ ...line,
      projectId: page.projectId, constructionSiteId: page.constructionSiteId,
      canViewPrice: page.canViewPrice, canAllocate: page.canAllocate,
    })) };
  },

  async saveRaw(input: { purchaseOrder: Record<string, unknown>;
    requestLineLinks: Array<Record<string, unknown>>;
    allocations: Array<Record<string, unknown>>;
    actorUserId: string; idempotencyKey: string }) {
    const { data, error } = await supabase.rpc('create_procurement_purchase_order_v1', {
      p_purchase_order: input.purchaseOrder,
      p_request_line_links: input.requestLineLinks,
      p_allocations: input.allocations,
      p_actor_user_id: input.actorUserId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('PROCUREMENT_PURCHASE_ORDER_RESPONSE_INVALID');
    return data as Record<string, unknown>;
  },

  async create(selections: ProcurementPurchaseSelection[], order: ProcurementPurchaseOrderInput) {
    const draft = buildProcurementPurchaseDraft(selections, order);
    return this.saveRaw({ purchaseOrder: draft.purchaseOrder,
      requestLineLinks: draft.requestLineLinks, allocations: draft.allocations,
      actorUserId: order.actorUserId, idempotencyKey: order.idempotencyKey });
  },

  async nextNumber(): Promise<string> {
    const { data, error } = await supabase.rpc('next_purchase_order_number_v2');
    if (error) throw error;
    const number = String(data || '').trim();
    if (!number) throw new Error('PURCHASE_ORDER_NUMBER_UNAVAILABLE');
    return number;
  },
};
