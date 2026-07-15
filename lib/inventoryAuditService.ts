import type {
  AuditSession,
  AuditSessionItem,
  InventoryItem,
  LossReason,
  Transaction,
  TransactionItem,
} from '../types';
import { fromDb } from './dbMapping';
import { parseCanonicalDecimal, type DecimalPolicy } from './locale/decimal';
import { isSupabaseConfigured, supabase } from './supabase';

const QUANTITY_POLICY: DecimalPolicy = {
  kind: 'quantity',
  maxFractionDigits: 6,
  min: 0,
  allowNegative: false,
};

export interface InventoryAuditObservationCommand {
  itemId: string;
  actualQty: string;
  expectedSystemQty: string;
  lossReason: LossReason | null;
  note: string | null;
}

export interface PostInventoryAuditCommand {
  commandId: string;
  warehouseId: string;
  auditedAt: string;
  observations: InventoryAuditObservationCommand[];
}

export interface PostInventoryAuditResult {
  auditSession: AuditSession;
  stockTransaction: Transaction | null;
  updatedItems: InventoryItem[];
}

const canonicalQuantity = (value: string, field: string): string => {
  const parsed = parseCanonicalDecimal(value, QUANTITY_POLICY);
  if (parsed.ok === false || parsed.canonical !== value) {
    throw new RangeError(field + ' must be a canonical dot-decimal quantity with at most 6 digits.');
  }
  return parsed.canonical;
};

const decimalNumber = (value: unknown, field: string): number => {
  const text = String(value ?? '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    throw new Error('Invalid canonical decimal in inventory audit response: ' + field);
  }
  const number = Number(text);
  if (!Number.isFinite(number)) {
    throw new Error('Out-of-range decimal in inventory audit response: ' + field);
  }
  return number;
};

const optionalDecimalNumber = (value: unknown, field: string): number | undefined =>
  value === null || value === undefined || value === ''
    ? undefined
    : decimalNumber(value, field);

const mapAuditItem = (row: any): AuditSessionItem => {
  const item = fromDb(row || {});
  return {
    ...item,
    systemStock: decimalNumber(item.systemStock, 'audit_session.items.systemStock'),
    actualStock: decimalNumber(item.actualStock, 'audit_session.items.actualStock'),
    delta: decimalNumber(item.delta, 'audit_session.items.delta'),
    lossPercent: optionalDecimalNumber(item.lossPercent, 'audit_session.items.lossPercent'),
    normPercent: optionalDecimalNumber(item.normPercent, 'audit_session.items.normPercent'),
    lossValue: optionalDecimalNumber(item.lossValue, 'audit_session.items.lossValue'),
  };
};

const mapAuditSession = (row: any): AuditSession => {
  const session = fromDb(row || {});
  if (!session.id || !Array.isArray(session.items)) {
    throw new Error('Lệnh kiểm kê không trả về phiên kiểm kê hợp lệ.');
  }
  return {
    ...session,
    items: session.items.map(mapAuditItem),
    totalItems: Number(session.totalItems),
    totalDiscrepancies: Number(session.totalDiscrepancies),
    totalExceedNorm: Number(session.totalExceedNorm),
    totalLossValue: decimalNumber(session.totalLossValue, 'audit_session.totalLossValue'),
  };
};

const mapTransaction = (row: any): Transaction | null => {
  if (!row) return null;
  const transaction = fromDb(row);
  return {
    ...transaction,
    items: (transaction.items || []).map((item: any): TransactionItem => ({
      ...item,
      quantity: decimalNumber(item.quantity, 'stock_transaction.items.quantity'),
      price: decimalNumber(item.price ?? 0, 'stock_transaction.items.price'),
    })),
  } as Transaction;
};

const mapInventoryItem = (row: any): InventoryItem => {
  const source = row && typeof row === 'object' ? row : {};
  const stockByWarehouse = source.stock_by_warehouse ?? source.stockByWarehouse ?? {};
  const withoutOpaqueMap = { ...source };
  delete withoutOpaqueMap.stock_by_warehouse;
  delete withoutOpaqueMap.stockByWarehouse;
  return {
    ...(fromDb(withoutOpaqueMap) as InventoryItem),
    stockByWarehouse: Object.fromEntries(
      Object.entries(stockByWarehouse).map(([warehouseId, quantity]) => [
        warehouseId,
        decimalNumber(quantity, 'updated_items.stockByWarehouse.' + warehouseId),
      ]),
    ),
  };
};

export const inventoryAuditService = {
  async post(command: PostInventoryAuditCommand): Promise<PostInventoryAuditResult> {
    if (!isSupabaseConfigured) {
      throw new Error('Kiểm kê atomic yêu cầu kết nối Supabase.');
    }
    if (!command.commandId || !command.warehouseId) {
      throw new Error('Thiếu commandId hoặc kho kiểm kê.');
    }
    if (command.observations.length < 1 || command.observations.length > 500) {
      throw new RangeError('Mỗi phiên kiểm kê phải có từ 1 đến 500 vật tư.');
    }

    const observations = command.observations.map((observation, index) => ({
      item_id: observation.itemId,
      actual_qty: canonicalQuantity(observation.actualQty, 'observations[' + index + '].actualQty'),
      expected_system_qty: canonicalQuantity(
        observation.expectedSystemQty,
        'observations[' + index + '].expectedSystemQty',
      ),
      loss_reason: observation.lossReason || null,
      note: observation.note?.trim() || null,
    }));

    const { data, error } = await supabase.rpc('post_inventory_audit', {
      p_command_id: command.commandId,
      p_warehouse_id: command.warehouseId,
      p_audited_at: command.auditedAt,
      p_observations: observations,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') {
      throw new Error('Lệnh kiểm kê không trả về kết quả hợp lệ.');
    }

    return {
      auditSession: mapAuditSession((data as any).audit_session ?? (data as any).auditSession),
      stockTransaction: mapTransaction(
        (data as any).stock_transaction ?? (data as any).stockTransaction,
      ),
      updatedItems: (
        (data as any).updated_items
        ?? (data as any).updatedItems
        ?? []
      ).map(mapInventoryItem),
    };
  },
};
