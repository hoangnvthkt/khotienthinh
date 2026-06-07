import { isSupabaseConfigured, supabase } from './supabase';
import type {
  InventoryBalance,
  InventoryLedgerEntry,
  InventoryLedgerTransactionType,
} from '../types';

export type InventoryLedgerFilters = {
  warehouseId?: string;
  materialId?: string;
  projectId?: string;
  constructionSiteId?: string;
  transactionType?: InventoryLedgerTransactionType | 'all';
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type InventoryLedgerLoadResult = {
  entries: InventoryLedgerEntry[];
  available: boolean;
};

const num = (value: unknown) => Number(value || 0);

const mapLedgerEntry = (row: any): InventoryLedgerEntry => ({
  id: row.id,
  inventoryTransactionId: row.inventory_transaction_id,
  entryNo: Number(row.entry_no || 0),
  documentCode: row.document_code,
  transactionDate: row.transaction_date,
  transactionType: row.transaction_type,
  movementDirection: row.movement_direction,
  materialId: row.material_id,
  warehouseId: row.warehouse_id,
  projectId: row.project_id,
  constructionSiteId: row.construction_site_id,
  lotNo: row.lot_no,
  batchNo: row.batch_no,
  serialNo: row.serial_no,
  sourceType: row.source_type,
  sourceId: row.source_id,
  sourceCode: row.source_code,
  sourceLineId: row.source_line_id,
  relatedRequestId: row.related_request_id,
  quantityIn: num(row.quantity_in),
  quantityOut: num(row.quantity_out),
  quantityDelta: num(row.quantity_delta),
  unit: row.unit,
  unitPrice: num(row.unit_price),
  amount: num(row.amount),
  balanceAfterQty: num(row.balance_after_qty),
  balanceAfterValue: num(row.balance_after_value),
  description: row.description,
  metadata: row.metadata || {},
  createdBy: row.created_by,
  approvedBy: row.approved_by,
  createdAt: row.created_at,
});

const mapBalance = (row: any): InventoryBalance => ({
  id: row.id,
  materialId: row.material_id,
  warehouseId: row.warehouse_id,
  projectId: row.project_id,
  constructionSiteId: row.construction_site_id,
  lotNo: row.lot_no,
  batchNo: row.batch_no,
  serialNo: row.serial_no,
  onHandQty: num(row.on_hand_qty),
  totalValue: num(row.total_value),
  averageUnitCost: num(row.average_unit_cost),
  lastLedgerEntryId: row.last_ledger_entry_id,
  lastTransactionDate: row.last_transaction_date,
  updatedAt: row.updated_at,
});

const isMissingLedgerTable = (error: any) =>
  String(error?.code || '') === '42P01'
  || String(error?.message || '').includes('inventory_ledger_entries')
  || String(error?.message || '').includes('inventory_balances');

const toEndOfDayIso = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
};

export const inventoryLedgerService = {
  async listEntries(filters: InventoryLedgerFilters = {}): Promise<InventoryLedgerLoadResult> {
    if (!isSupabaseConfigured) return { entries: [], available: false };

    try {
      let query = supabase
        .from('inventory_ledger_entries')
        .select('*')
        .order('transaction_date', { ascending: true })
        .order('entry_no', { ascending: true })
        .limit(filters.limit || 5000);

      if (filters.warehouseId && filters.warehouseId !== 'ALL') {
        query = query.eq('warehouse_id', filters.warehouseId);
      }
      if (filters.materialId && filters.materialId !== 'ALL') {
        query = query.eq('material_id', filters.materialId);
      }
      if (filters.projectId) {
        query = query.eq('project_id', filters.projectId);
      }
      if (filters.constructionSiteId) {
        query = query.eq('construction_site_id', filters.constructionSiteId);
      }
      if (filters.transactionType && filters.transactionType !== 'all') {
        query = query.eq('transaction_type', filters.transactionType);
      }
      if (filters.dateTo) {
        query = query.lte('transaction_date', toEndOfDayIso(filters.dateTo));
      }

      const { data, error } = await query;
      if (error) throw error;

      return { entries: (data || []).map(mapLedgerEntry), available: true };
    } catch (error: any) {
      if (isMissingLedgerTable(error)) return { entries: [], available: false };
      throw error;
    }
  },

  async listPeriodEntries(filters: InventoryLedgerFilters = {}): Promise<InventoryLedgerLoadResult> {
    const result = await this.listEntries(filters);
    if (!filters.dateFrom || !result.available) return result;
    const fromTime = new Date(filters.dateFrom);
    fromTime.setHours(0, 0, 0, 0);
    return {
      ...result,
      entries: result.entries.filter(entry => new Date(entry.transactionDate) >= fromTime),
    };
  },

  async listBalances(filters: Pick<InventoryLedgerFilters, 'warehouseId' | 'materialId' | 'projectId' | 'constructionSiteId'> = {}): Promise<{ balances: InventoryBalance[]; available: boolean }> {
    if (!isSupabaseConfigured) return { balances: [], available: false };

    try {
      let query = supabase
        .from('inventory_balances')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(5000);

      if (filters.warehouseId && filters.warehouseId !== 'ALL') {
        query = query.eq('warehouse_id', filters.warehouseId);
      }
      if (filters.materialId && filters.materialId !== 'ALL') {
        query = query.eq('material_id', filters.materialId);
      }
      if (filters.projectId) {
        query = query.eq('project_id', filters.projectId);
      }
      if (filters.constructionSiteId) {
        query = query.eq('construction_site_id', filters.constructionSiteId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return { balances: (data || []).map(mapBalance), available: true };
    } catch (error: any) {
      if (isMissingLedgerTable(error)) return { balances: [], available: false };
      throw error;
    }
  },
};
