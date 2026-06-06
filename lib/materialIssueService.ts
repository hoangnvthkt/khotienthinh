import {
  MaterialIssueLedgerType,
  MaterialIssueLine,
  MaterialIssueOrder,
  MaterialIssueReceipt,
  MaterialIssueReceiptLine,
  MaterialIssueRecipientType,
  MaterialIssueReturn,
  MaterialIssueReturnLine,
  MaterialIssueStatus,
  MaterialPartyBalance,
} from '../types';
import { fromDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

const ORDER_TABLE = 'material_issue_orders';
const LINE_TABLE = 'material_issue_lines';
const RECEIPT_TABLE = 'material_issue_receipts';
const RECEIPT_LINE_TABLE = 'material_issue_receipt_lines';
const RETURN_TABLE = 'material_issue_returns';
const RETURN_LINE_TABLE = 'material_issue_return_lines';

export type MaterialIssueCreateLineInput = {
  itemId: string;
  quantity: number;
  unit?: string | null;
  unitPrice?: number | null;
  materialBudgetItemId?: string | null;
  materialRequestLineId?: string | null;
  workBoqItemId?: string | null;
  subcontractorContractId?: string | null;
  note?: string | null;
};

export type MaterialIssueCreateInput = {
  projectId?: string | null;
  constructionSiteId?: string | null;
  sourceWarehouseId: string;
  recipientType: MaterialIssueRecipientType;
  recipientId?: string | null;
  recipientName: string;
  responsibleUserId?: string | null;
  subcontractorContractId?: string | null;
  materialRequestId?: string | null;
  workBoqItemId?: string | null;
  neededDate?: string | null;
  note?: string | null;
  lines: MaterialIssueCreateLineInput[];
};

export type MaterialIssueReceiptLineInput = {
  issueLineId: string;
  receivedQty: number;
  varianceReason?: string | null;
};

export type MaterialIssueReturnLineInput = {
  issueLineId: string;
  returnQty: number;
  reason?: string | null;
};

export type MaterialIssueSettlementLineInput = {
  issueLineId: string;
  quantity: number;
};

type ListOptions = {
  projectId?: string | null;
  constructionSiteId?: string | null;
  sourceWarehouseId?: string | null;
  status?: MaterialIssueStatus | MaterialIssueStatus[];
  limit?: number;
};

const mapLine = (row: any): MaterialIssueLine => fromDb(row) as MaterialIssueLine;
const mapReceiptLine = (row: any): MaterialIssueReceiptLine => fromDb(row) as MaterialIssueReceiptLine;
const mapReturnLine = (row: any): MaterialIssueReturnLine => fromDb(row) as MaterialIssueReturnLine;

const mapReceipt = (row: any, lines: MaterialIssueReceiptLine[] = []): MaterialIssueReceipt => ({
  ...(fromDb(row) as MaterialIssueReceipt),
  attachments: row.attachments || [],
  lines,
});

const mapReturn = (row: any, lines: MaterialIssueReturnLine[] = []): MaterialIssueReturn => ({
  ...(fromDb(row) as MaterialIssueReturn),
  lines,
});

const mapOrder = (
  row: any,
  lines: MaterialIssueLine[] = [],
  receipts: MaterialIssueReceipt[] = [],
  returns: MaterialIssueReturn[] = [],
): MaterialIssueOrder => ({
  ...(fromDb(row) as MaterialIssueOrder),
  attachments: row.attachments || [],
  lines,
  receipts,
  returns,
});

const normalizeDate = (value?: string | null) => value || null;

async function hydrateOrders(orderRows: any[]): Promise<MaterialIssueOrder[]> {
  if (!isSupabaseConfigured || orderRows.length === 0) return [];

  const orderIds = orderRows.map(row => row.id);
  const [{ data: lineRows, error: lineError }, { data: receiptRows, error: receiptError }, { data: returnRows, error: returnError }] =
    await Promise.all([
      supabase.from(LINE_TABLE).select('*').in('issue_order_id', orderIds).order('created_at', { ascending: true }),
      supabase.from(RECEIPT_TABLE).select('*').in('issue_order_id', orderIds).order('received_at', { ascending: true }),
      supabase.from(RETURN_TABLE).select('*').in('issue_order_id', orderIds).order('created_at', { ascending: true }),
    ]);

  if (lineError) throw lineError;
  if (receiptError) throw receiptError;
  if (returnError) throw returnError;

  const receiptIds = (receiptRows || []).map(row => row.id);
  const returnIds = (returnRows || []).map(row => row.id);

  const [{ data: receiptLineRows, error: receiptLineError }, { data: returnLineRows, error: returnLineError }] =
    await Promise.all([
      receiptIds.length
        ? supabase.from(RECEIPT_LINE_TABLE).select('*').in('receipt_id', receiptIds).order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null } as any),
      returnIds.length
        ? supabase.from(RETURN_LINE_TABLE).select('*').in('issue_return_id', returnIds).order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null } as any),
    ]);

  if (receiptLineError) throw receiptLineError;
  if (returnLineError) throw returnLineError;

  const linesByOrder = new Map<string, MaterialIssueLine[]>();
  (lineRows || []).map(mapLine).forEach(line => {
    const lines = linesByOrder.get(line.issueOrderId) || [];
    lines.push(line);
    linesByOrder.set(line.issueOrderId, lines);
  });

  const receiptLinesByReceipt = new Map<string, MaterialIssueReceiptLine[]>();
  (receiptLineRows || []).map(mapReceiptLine).forEach(line => {
    const lines = receiptLinesByReceipt.get(line.receiptId) || [];
    lines.push(line);
    receiptLinesByReceipt.set(line.receiptId, lines);
  });

  const receiptsByOrder = new Map<string, MaterialIssueReceipt[]>();
  (receiptRows || []).forEach(row => {
    const receipt = mapReceipt(row, receiptLinesByReceipt.get(row.id) || []);
    const receipts = receiptsByOrder.get(receipt.issueOrderId) || [];
    receipts.push(receipt);
    receiptsByOrder.set(receipt.issueOrderId, receipts);
  });

  const returnLinesByReturn = new Map<string, MaterialIssueReturnLine[]>();
  (returnLineRows || []).map(mapReturnLine).forEach(line => {
    const lines = returnLinesByReturn.get(line.issueReturnId) || [];
    lines.push(line);
    returnLinesByReturn.set(line.issueReturnId, lines);
  });

  const returnsByOrder = new Map<string, MaterialIssueReturn[]>();
  (returnRows || []).forEach(row => {
    const materialReturn = mapReturn(row, returnLinesByReturn.get(row.id) || []);
    const returns = returnsByOrder.get(materialReturn.issueOrderId) || [];
    returns.push(materialReturn);
    returnsByOrder.set(materialReturn.issueOrderId, returns);
  });

  return orderRows.map(row => mapOrder(
    row,
    linesByOrder.get(row.id) || [],
    receiptsByOrder.get(row.id) || [],
    returnsByOrder.get(row.id) || [],
  ));
}

const orderOrThrow = async (row: any): Promise<MaterialIssueOrder> => {
  const [order] = await hydrateOrders([row]);
  if (!order) throw new Error('Không tìm thấy phiếu xuất cấp.');
  return order;
};

export const materialIssueService = {
  async list(options: ListOptions = {}): Promise<MaterialIssueOrder[]> {
    if (!isSupabaseConfigured) return [];

    let query = supabase
      .from(ORDER_TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (options.projectId) query = query.eq('project_id', options.projectId);
    if (options.constructionSiteId) query = query.eq('construction_site_id', options.constructionSiteId);
    if (options.sourceWarehouseId) query = query.eq('source_warehouse_id', options.sourceWarehouseId);
    if (options.status) {
      query = Array.isArray(options.status)
        ? query.in('status', options.status)
        : query.eq('status', options.status);
    }
    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw error;
    return hydrateOrders(data || []);
  },

  async getById(id: string): Promise<MaterialIssueOrder | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.from(ORDER_TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return orderOrThrow(data);
  },

  async createDraft(input: MaterialIssueCreateInput): Promise<MaterialIssueOrder> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');

    const { data, error } = await supabase.rpc('create_material_issue_order', {
      p_project_id: input.projectId || null,
      p_construction_site_id: input.constructionSiteId || null,
      p_source_warehouse_id: input.sourceWarehouseId,
      p_recipient_type: input.recipientType,
      p_recipient_id: input.recipientId || null,
      p_recipient_name: input.recipientName,
      p_responsible_user_id: input.responsibleUserId || null,
      p_subcontractor_contract_id: input.subcontractorContractId || null,
      p_material_request_id: input.materialRequestId || null,
      p_work_boq_item_id: input.workBoqItemId || null,
      p_needed_date: normalizeDate(input.neededDate),
      p_note: input.note || null,
      p_lines: input.lines,
    });
    if (error) throw error;
    return orderOrThrow(data);
  },

  async submit(orderId: string, overrideReason?: string | null): Promise<MaterialIssueOrder> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.rpc('submit_material_issue_order', {
      p_order_id: orderId,
      p_override_reason: overrideReason || null,
    });
    if (error) throw error;
    return orderOrThrow(data);
  },

  async createAndSubmit(input: MaterialIssueCreateInput, overrideReason?: string | null): Promise<MaterialIssueOrder> {
    const draft = await this.createDraft(input);
    return this.submit(draft.id, overrideReason);
  },

  async cancel(orderId: string, reason: string): Promise<MaterialIssueOrder> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.rpc('cancel_material_issue_order', {
      p_order_id: orderId,
      p_reason: reason,
    });
    if (error) throw error;
    return orderOrThrow(data);
  },

  async confirmReceipt(args: {
    orderId: string;
    lines: MaterialIssueReceiptLineInput[];
    note?: string | null;
    attachments?: any[];
    signatureUrl?: string | null;
  }): Promise<MaterialIssueOrder> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.rpc('confirm_material_issue_receipt', {
      p_order_id: args.orderId,
      p_lines: args.lines,
      p_note: args.note || null,
      p_attachments: args.attachments || [],
      p_signature_url: args.signatureUrl || null,
    });
    if (error) throw error;
    return orderOrThrow(data);
  },

  async createReturn(args: {
    orderId: string;
    targetWarehouseId: string;
    lines: MaterialIssueReturnLineInput[];
    reason: string;
    note?: string | null;
  }): Promise<MaterialIssueReturn> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.rpc('create_material_issue_return', {
      p_order_id: args.orderId,
      p_target_warehouse_id: args.targetWarehouseId,
      p_lines: args.lines,
      p_reason: args.reason,
      p_note: args.note || null,
    });
    if (error) throw error;
    const materialReturn = mapReturn(data);
    const fresh = await this.getById(args.orderId);
    return fresh?.returns?.find(item => item.id === materialReturn.id) || materialReturn;
  },

  async recordSettlement(args: {
    orderId: string;
    settlementType: Extract<MaterialIssueLedgerType, 'consume' | 'loss'>;
    lines: MaterialIssueSettlementLineInput[];
    reason: string;
    attachments?: any[];
  }): Promise<MaterialIssueOrder> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.rpc('record_material_issue_settlement', {
      p_order_id: args.orderId,
      p_settlement_type: args.settlementType,
      p_lines: args.lines,
      p_reason: args.reason,
      p_attachments: args.attachments || [],
    });
    if (error) throw error;
    return orderOrThrow(data);
  },

  async getPartyBalance(filters: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    recipientType?: MaterialIssueRecipientType | null;
    recipientId?: string | null;
  } = {}): Promise<MaterialPartyBalance[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.rpc('get_material_party_balance', {
      p_project_id: filters.projectId || null,
      p_construction_site_id: filters.constructionSiteId || null,
      p_recipient_type: filters.recipientType || null,
      p_recipient_id: filters.recipientId || null,
    });
    if (error) throw error;
    return (data || []).map(row => fromDb(row) as MaterialPartyBalance);
  },
};
