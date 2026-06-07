import { isSupabaseConfigured, supabase } from './supabase';
import type {
  InventoryBalance,
  InventoryLedgerEntry,
  InventoryLedgerReportResult,
  InventoryLedgerStockReportRow,
  InventoryLedgerTransactionType,
  InventoryLedgerWarehouseReportRow,
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
  search?: string;
  cursor?: string | null;
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

const mapStockReportRow = (row: any): InventoryLedgerStockReportRow => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  unit: row.unit,
  opening: num(row.opening),
  inImport: num(row.in_import ?? row.inImport),
  inTransfer: num(row.in_transfer ?? row.inTransfer),
  inAdjustment: num(row.in_adjustment ?? row.inAdjustment),
  totalIn: num(row.total_in ?? row.totalIn),
  outExport: num(row.out_export ?? row.outExport),
  outTransfer: num(row.out_transfer ?? row.outTransfer),
  outLiquidation: num(row.out_liquidation ?? row.outLiquidation),
  totalOut: num(row.total_out ?? row.totalOut),
  closing: num(row.closing),
  value: num(row.value),
});

const mapWarehouseReportRow = (row: any): InventoryLedgerWarehouseReportRow => ({
  key: row.key || `${row.warehouse_id ?? row.warehouseId}:${row.material_id ?? row.materialId}`,
  warehouseId: row.warehouse_id ?? row.warehouseId,
  materialId: row.material_id ?? row.materialId,
  warehouseName: row.warehouse_name ?? row.warehouseName,
  materialName: row.material_name ?? row.materialName,
  sku: row.sku,
  unit: row.unit,
  inQty: num(row.in_qty ?? row.inQty),
  outQty: num(row.out_qty ?? row.outQty),
  balanceQty: num(row.balance_qty ?? row.balanceQty),
  lastDate: row.last_date ?? row.lastDate ?? null,
});

const isMissingLedgerTable = (error: any) =>
  String(error?.code || '') === '42P01'
  || ['42883', 'PGRST202'].includes(error?.code)
  || String(error?.message || '').includes('get_inventory_ledger_report')
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
  async getReport(filters: InventoryLedgerFilters = {}): Promise<InventoryLedgerReportResult> {
    if (!isSupabaseConfigured) {
      return {
        summary: { opening: 0, totalIn: 0, totalOut: 0, closing: 0, totalValue: 0 },
        stockRows: [],
        warehouseRows: [],
        entriesPage: [],
        nextCursor: null,
        available: false,
      };
    }

    try {
      const { data, error } = await supabase.rpc('get_inventory_ledger_report', {
        p_filters: {
          warehouseId: filters.warehouseId,
          materialId: filters.materialId,
          projectId: filters.projectId,
          constructionSiteId: filters.constructionSiteId,
          transactionType: filters.transactionType,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          search: filters.search,
        },
        p_limit: filters.limit || 500,
        p_cursor: filters.cursor || null,
      });
      if (error) throw error;
      return {
        summary: {
          opening: num(data?.summary?.opening),
          totalIn: num(data?.summary?.totalIn ?? data?.summary?.total_in),
          totalOut: num(data?.summary?.totalOut ?? data?.summary?.total_out),
          closing: num(data?.summary?.closing),
          totalValue: num(data?.summary?.totalValue ?? data?.summary?.total_value),
        },
        stockRows: (data?.stockRows || data?.stock_rows || []).map(mapStockReportRow),
        warehouseRows: (data?.warehouseRows || data?.warehouse_rows || []).map(mapWarehouseReportRow),
        entriesPage: (data?.entriesPage || data?.entries_page || []).map(mapLedgerEntry),
        nextCursor: data?.nextCursor ?? data?.next_cursor ?? null,
        available: true,
      };
    } catch (error: any) {
      if (isMissingLedgerTable(error)) {
        return {
          summary: { opening: 0, totalIn: 0, totalOut: 0, closing: 0, totalValue: 0 },
          stockRows: [],
          warehouseRows: [],
          entriesPage: [],
          nextCursor: null,
          available: false,
        };
      }
      throw error;
    }
  },

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
      if (filters.dateFrom) {
        query = query.gte('transaction_date', new Date(filters.dateFrom).toISOString());
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
