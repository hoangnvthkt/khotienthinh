import { supabase } from './supabase';

export type WmsInventoryClassification = 'matched' | 'cache_missing' | 'negative_quantity' | 'quantity_mismatch' | 'unclassified' | string;

export interface WmsInventoryWorkspaceRow {
  key: string;
  warehouseId: string;
  warehouseName: string;
  materialId: string;
  sku: string;
  materialName: string;
  unit: string | null;
  cacheQty: number | null;
  onHandQty: number;
  reservedQty: number;
  availableQty: number | null;
  inTransitQty: number;
  receiptCustodyQty: number | null;
  teamCustodyQty: number;
  authoritative: boolean;
  classification: WmsInventoryClassification;
  reconciliationIssueId: string | null;
  ownerUserId: string | null;
  disposition: string | null;
}

export interface WmsInventoryWorkspace {
  asOf: string;
  metricVersion: string;
  warehouseId: string | null;
  rows: WmsInventoryWorkspaceRow[];
  nextCursor: string | null;
  completeness: { authoritative: boolean; openReconciliationIssues: number; unknownReceiptCounts: number };
}

export interface MaterialCustodyRow {
  issueOrderId: string;
  issueNo: string;
  issueLineId: string;
  projectId: string | null;
  constructionSiteId: string | null;
  sourceWarehouseId: string;
  recipientType: string;
  recipientId: string | null;
  recipientName: string;
  responsibleUserId: string | null;
  itemId: string;
  itemName: string;
  unit: string | null;
  issuedQty: number;
  receivedConfirmedQty: number;
  consumedQty: number;
  returnedQty: number;
  lostQty: number;
  custodyQty: number;
  workBoqItemId: string | null;
  materialBudgetItemId: string | null;
  allocationComplete: boolean;
  status: string;
  neededDate: string | null;
}

const objectValue = (data: unknown, label: string): Record<string, any> => {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object') throw new Error(`${label} không hợp lệ.`);
  return value as Record<string, any>;
};
const finite = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} không hợp lệ.`);
  return number;
};

export const wmsWorkspaceService = {
  async getInventory(input: { warehouseId?: string | null; search?: string; cursor?: string | null; limit?: number } = {}): Promise<WmsInventoryWorkspace> {
    const { data, error } = await supabase.rpc('get_wms_inventory_workspace_v1', {
      p_warehouse_id: input.warehouseId || null,
      p_search: input.search?.trim() || null,
      p_cursor: input.cursor || null,
      p_limit: input.limit || 50,
    });
    if (error) throw error;
    const value = objectValue(data, 'Dữ liệu kiểm soát kho');
    if (value.metricVersion !== 'g6.wms.quantity.v1' || !Array.isArray(value.rows)) {
      throw new Error('Dữ liệu kiểm soát kho không hợp lệ.');
    }
    const rows = value.rows.map((row: Record<string, any>): WmsInventoryWorkspaceRow => ({
      key: String(row.key || ''), warehouseId: String(row.warehouseId || ''), warehouseName: String(row.warehouseName || ''),
      materialId: String(row.materialId || ''), sku: String(row.sku || ''), materialName: String(row.materialName || ''), unit: row.unit ?? null,
      cacheQty: row.cacheQty == null ? null : finite(row.cacheQty, 'Tồn cache'), onHandQty: finite(row.onHandQty, 'Tồn sổ'),
      reservedQty: finite(row.reservedQty, 'Đã giữ'), availableQty: row.availableQty == null ? null : finite(row.availableQty, 'Khả dụng'),
      inTransitQty: finite(row.inTransitQty, 'Đang chuyển'), receiptCustodyQty: row.receiptCustodyQty == null ? null : finite(row.receiptCustodyQty, 'Chờ xử lý nhận'),
      teamCustodyQty: finite(row.teamCustodyQty, 'Đội đang giữ'), authoritative: row.authoritative === true,
      classification: String(row.classification || 'unclassified'), reconciliationIssueId: row.reconciliationIssueId ?? null,
      ownerUserId: row.ownerUserId ?? null, disposition: row.disposition ?? null,
    }));
    const completeness = objectValue(value.completeness, 'Mức hoàn chỉnh dữ liệu kho');
    return {
      asOf: String(value.asOf || ''), metricVersion: value.metricVersion, warehouseId: value.warehouseId ?? null,
      rows, nextCursor: value.nextCursor ?? null,
      completeness: {
        authoritative: completeness.authoritative === true,
        openReconciliationIssues: finite(completeness.openReconciliationIssues, 'Số lỗi đối soát'),
        unknownReceiptCounts: finite(completeness.unknownReceiptCounts ?? 0, 'Số dòng nhận thiếu kiểm đếm'),
      },
    };
  },

  async getMaterialCustody(input: { projectId?: string | null; constructionSiteId?: string | null; recipientType?: string | null; recipientId?: string | null; limit?: number } = {}) {
    const { data, error } = await supabase.rpc('get_material_custody_v1', {
      p_project_id: input.projectId || null, p_construction_site_id: input.constructionSiteId || null,
      p_recipient_type: input.recipientType || null, p_recipient_id: input.recipientId || null, p_limit: input.limit || 200,
    });
    if (error) throw error;
    const value = objectValue(data, 'Dữ liệu bàn giao vật tư');
    if (value.metricVersion !== 'g6.material-custody.v1' || !Array.isArray(value.rows)) throw new Error('Dữ liệu bàn giao vật tư không hợp lệ.');
    return value as { asOf: string; metricVersion: string; rows: MaterialCustodyRow[]; completeness: { allocationComplete: boolean } };
  },
  // Kiểm kê: dùng stockCountService (K5, có duyệt); lối G6 tự chốt đã đóng.
};
