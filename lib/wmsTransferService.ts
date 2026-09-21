import { TransactionStatus } from '../types';
import { mapErpCompletionCommandError } from './erpCompletionRollout';
import { supabase } from './supabase';
import { fetchAllSupabaseRows } from './supabaseCompleteRead';

export interface WmsTransferCommandResult {
  transactionId: string;
  status: TransactionStatus;
  rowVersion: number;
  inTransitQty: number;
  replayed: boolean;
}

export interface WmsTransferProgressLine {
  id: string;
  transactionId: string;
  lineKey: string;
  itemId: string;
  unit: string | null;
  dispatchedQty: number;
  receivedQty: number;
  returnedQty: number;
  lostQty: number;
  inTransitQty: number;
  rowVersion: number;
}

export interface WmsTransferQuantityInput {
  transferLineId: string;
  quantity: number;
}

const asObject = (data: unknown): Record<string, unknown> => {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object') throw new Error('Kết quả lệnh chuyển kho không hợp lệ.');
  return value as Record<string, unknown>;
};

const mapResult = (data: unknown, transactionId: string): WmsTransferCommandResult => {
  const value = asObject(data);
  const result: WmsTransferCommandResult = {
    transactionId: String(value.transactionId ?? value.transaction_id ?? ''),
    status: String(value.status ?? '') as TransactionStatus,
    rowVersion: Number(value.rowVersion ?? value.row_version),
    inTransitQty: Number(value.inTransitQty ?? value.in_transit_qty),
    replayed: value.replayed === true,
  };
  if (result.transactionId !== transactionId
    || ![TransactionStatus.APPROVED, TransactionStatus.COMPLETED].includes(result.status)
    || !Number.isInteger(result.rowVersion) || result.rowVersion < 1
    || !Number.isFinite(result.inTransitQty) || result.inTransitQty < 0) {
    throw new Error('Kết quả lệnh chuyển kho không hợp lệ.');
  }
  return result;
};

const validateLines = (lines: WmsTransferQuantityInput[]) => {
  if (!lines.length || lines.some(line => !line.transferLineId || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
    throw new Error('Số lượng xử lý chuyển kho không hợp lệ.');
  }
  return lines;
};

export const wmsTransferService = {
  async listProgress(transactionId: string): Promise<WmsTransferProgressLine[]> {
    const { data, error } = await fetchAllSupabaseRows(supabase
      .from('wms_transfer_lines')
      .select('id,transaction_id,line_key,item_id,unit,dispatched_qty,received_qty,returned_qty,lost_qty,row_version')
      .eq('transaction_id', transactionId)
      .order('line_key', { ascending: true }), {
      label: 'lib/wmsTransferService.ts:listProgress',
      maxRows: 20_000,
      orderBy: ['transaction_id', 'id'],
    });
    if (error) throw error;
    return (data || []).map((row: any) => {
      const dispatchedQty = Number(row.dispatched_qty);
      const receivedQty = Number(row.received_qty);
      const returnedQty = Number(row.returned_qty);
      const lostQty = Number(row.lost_qty);
      return {
        id: row.id,
        transactionId: row.transaction_id,
        lineKey: row.line_key,
        itemId: row.item_id,
        unit: row.unit ?? null,
        dispatchedQty,
        receivedQty,
        returnedQty,
        lostQty,
        inTransitQty: Math.max(0, dispatchedQty - receivedQty - returnedQty - lostQty),
        rowVersion: Number(row.row_version || 1),
      };
    });
  },

  async dispatch(input: { transactionId: string; expectedVersion: number; idempotencyKey: string }) {
    const { data, error } = await supabase.rpc('dispatch_wms_transfer_v1', {
      p_transaction_id: input.transactionId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapErpCompletionCommandError(error);
    return mapResult(data, input.transactionId);
  },

  async receive(input: { transactionId: string; lines: WmsTransferQuantityInput[]; expectedVersion: number; idempotencyKey: string }) {
    const { data, error } = await supabase.rpc('receive_wms_transfer_v1', {
      p_transaction_id: input.transactionId,
      p_lines: validateLines(input.lines),
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapErpCompletionCommandError(error);
    return mapResult(data, input.transactionId);
  },

  async dispose(input: { transactionId: string; disposition: 'returned' | 'lost'; lines: WmsTransferQuantityInput[]; reason: string; expectedVersion: number; idempotencyKey: string }) {
    if (!input.reason.trim()) throw new Error('Phải nhập lý do xử lý hàng đang chuyển.');
    const { data, error } = await supabase.rpc('dispose_wms_transfer_v1', {
      p_transaction_id: input.transactionId,
      p_disposition: input.disposition,
      p_lines: validateLines(input.lines),
      p_reason: input.reason.trim(),
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw mapErpCompletionCommandError(error);
    return mapResult(data, input.transactionId);
  },
};
