import { isSupabaseConfigured, supabase } from './supabase';
import { accessPayload, type LegacyGrant, type WmsAccess, type WmsAccessData } from './wmsAccess';
import type { DuplicatesData } from './wmsCatalogMerge';

// V1 Module Vật tư: Danh mục vật tư một cửa (cấp mã, sửa, ngừng dùng, cách quản lý kho) và Tồn kho đọc thẳng sổ kho.

export type InventoryMode = 'stock' | 'use' | 'service';
export const INVENTORY_MODE_LABELS: Record<InventoryMode, string> = { stock: 'Lưu kho', use: 'Dùng ngay', service: 'Không qua kho' };
export const INVENTORY_MODE_HINTS: Record<InventoryMode, string> = {
  stock: 'Có tồn, xuất dần khi dùng',
  use: 'Nhận hàng là ghi nhập + xuất dùng cùng lúc',
  service: 'Dịch vụ: chỉ ghi chi phí, không có tồn',
};

export interface CatalogItem {
  id: string; sku: string; name: string; unit: string; category: string;
  purchaseUnit: string | null; purchaseConversionFactor: number; minStock: number; accountingCode: string | null;
  status: 'active' | 'retired'; inventoryMode: InventoryMode; retiredAt: string | null; retiredReason: string | null; createdAt: string | null;
  /** V1-3a: đã gộp vào mã này. */
  mergedIntoId?: string | null;
}
export interface CatalogUsage { stockQty: number; ledger: number; transactions: number; purchaseOrders: number; openPurchaseOrders: number; requests: number }
export interface CatalogRename { itemId: string; at: string; by: string | null; old: string | null; new: string | null; reason?: string | null; usage: CatalogUsage;
  /** Mã đã có chứng từ trước lần đổi tên → chứng từ cũ đang hiện tên mới. */
  usedBefore: boolean }
export interface CatalogOverview {
  can: { issueCode: boolean; request: boolean };
  /** itemId → [số dòng sổ kho, tồn mọi kho] */
  usage: Record<string, [number, number]>;
  openPoItems: string[];
  renames: CatalogRename[];
}
export interface CatalogItemDetail {
  item: CatalogItem;
  usage: CatalogUsage;
  stock: Array<{ warehouseId: string; warehouseName: string; qty: number; value: number; lastMove: string | null }>;
  events: Array<{ at: string; by: string | null; action: string; reason?: string | null; fields?: string[] | null; before?: any; after?: any }>;
}
export interface StockRow {
  warehouseId: string; itemId: string; sku: string | null; name: string; unit: string | null; category: string | null; minStock: number;
  inventoryMode: InventoryMode; itemStatus: 'active' | 'retired' | null; orphan: boolean;
  qty: number; value: number; lastMove: string | null; out30: number; incoming: number;
}
export interface StockOverview {
  today: string;
  can: { issueCode: boolean };
  warehouses: Array<{ id: string; name: string; type: string; canOperate: boolean }>;
  rows: StockRow[];
}
export interface ItemCard {
  entries: Array<{ date: string; code: string; type: string; qtyIn: number; qtyOut: number; unitPrice: number; amount: number; description: string | null;
    /** V1-3a: dòng của mã cũ đã gộp vào mã này. */
    fromSku?: string | null }>;
  otherWarehouses: Array<{ warehouseId: string; warehouseName: string; qty: number }>;
}

const ERRORS: Record<string, string> = {
  CATALOG_ISSUE_DENIED: 'Bạn chưa có ô quyền "Cấp mã". Nhờ Admin cấp ở Cài đặt → Người dùng → Kho vật tư.',
  CATALOG_VIEW_DENIED: 'Bạn chưa có quyền xem danh mục vật tư.',
  CATALOG_FIELDS_REQUIRED: 'Cần đủ tên, đơn vị tính và nhóm vật tư.',
  CATALOG_MODE_INVALID: 'Cách quản lý kho không hợp lệ.',
  CATALOG_FACTOR_INVALID: 'Hệ số quy đổi phải lớn hơn 0.',
  CATALOG_REASON_REQUIRED: 'Cần ghi lý do.',
  CATALOG_ITEMS_REQUIRED: 'Chưa chọn mã nào.',
  CATALOG_ACTION_INVALID: 'Thao tác không hợp lệ.',
  CODE_REQUEST_NOT_FOUND: 'Không tìm thấy đề xuất cấp mã.',
  CODE_REQUEST_NOT_PENDING: 'Đề xuất này đã được người khác xử lý. Tải lại để xem.',
  ITEM_NOT_FOUND: 'Không tìm thấy vật tư.',
  ITEM_RETIRED: 'Mã này đã ngừng dùng.',
  ITEM_RENAME_CHANGES_NATURE: 'Mã đã có chứng từ: tên mới làm mất con số kích thước hoặc khác hẳn tên cũ. Nếu là vật tư khác, hãy đề xuất mã mới.',
  ITEM_UNIT_LOCKED: 'Mã đã có chứng từ nên không đổi được đơn vị tính kho.',
  ITEM_RETIRE_HAS_STOCK: 'Mã còn tồn ở kho — chỉ ngừng dùng khi tồn bằng 0.',
  ITEM_RETIRE_OPEN_PO: 'Mã đang nằm trong đơn mua chưa xong — chờ đơn xong rồi ngừng dùng.',
  ITEM_ALREADY_RETIRED: 'Mã đã ngừng dùng.',
  ITEM_ALREADY_ACTIVE: 'Mã đang dùng.',
  WMS_STOCK_VIEW_DENIED: 'Bạn chưa có quyền xem tồn kho này.',
  MERGE_KEEP_NOT_ACTIVE: 'Mã giữ lại đã ngừng dùng. Chọn mã khác.',
  MERGE_ITEM_NOT_ACTIVE: 'Có mã đã ngừng dùng hoặc đã gộp. Tải lại.',
  MERGE_NOTHING: 'Chọn ít nhất hai mã.',
  items_merged_retired_check: 'Mã đã gộp vào mã khác nên không mở lại được.',
};

/** Đổi lỗi server (mã lỗi ở đầu thông báo) thành câu tiếng Việt. */
export const catalogErrorMessage = (error: unknown, fallback = 'Chưa thực hiện được. Thử lại sau.'): string => {
  const raw = String((error as any)?.message || error || '');
  const dup = raw.match(/ITEM_NAME_DUPLICATE:(\S+)/);
  if (dup) return `Tên trùng với mã ${dup[1]} đã có (so sau khi bỏ dấu, khoảng trắng). Dùng mã đó hoặc ghi rõ khác biệt.`;
  const merge = raw.match(/MERGE_(?:SIZE_DIFF|UNIT_CONFIRM|BLOCKED): (.+)/);
  if (merge) return merge[1];
  const code = Object.keys(ERRORS).find(k => raw.includes(k));
  return code ? ERRORS[code] : raw && !/^[A-Z0-9_:\s]+$/.test(raw) ? raw : fallback;
};

const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

export const wmsCatalogService = {
  overview: () => rpc<CatalogOverview>('get_catalog_overview_v1'),
  item: (itemId: string) => rpc<CatalogItemDetail>('get_catalog_item_v1', { p_item_id: itemId }),
  issue: (input: { requestId?: string; name: string; unit: string; category: string; purchaseUnit?: string | null; purchaseConversionFactor?: number; minStock?: number; inventoryMode: InventoryMode; reason?: string }) =>
    rpc<CatalogItem>('issue_material_code_v1', { p: input }),
  resolveRequest: (input: { requestId: string; action: 'use_existing' | 'reject'; itemId?: string; reason?: string }) =>
    rpc<{ requestId: string; action: string }>('resolve_material_code_request_v1', { p: input }),
  update: (input: { itemId: string; name?: string; unit?: string; category?: string; purchaseUnit?: string | null; purchaseConversionFactor?: number; minStock?: number; reason?: string }) =>
    rpc<CatalogItem>('update_catalog_item_v1', { p: input }),
  setStatus: (input: { itemId: string; action: 'retire' | 'reactivate'; reason: string }) => rpc<CatalogItem>('set_catalog_item_status_v1', { p: input }),
  setMode: (input: { itemIds: string[]; mode: InventoryMode; reason?: string }) => rpc<{ updated: number }>('set_inventory_mode_v1', { p: input }),
  stock: (warehouseId?: string) => rpc<StockOverview>('list_wms_stock_v1', { p: warehouseId ? { warehouseId } : {} }),
  card: (itemId: string, warehouseId: string) => rpc<ItemCard>('get_wms_item_card_v1', { p_item_id: itemId, p_warehouse_id: warehouseId }),
  // V1-3a: gộp mã trùng
  duplicates: () => rpc<DuplicatesData>('get_catalog_duplicates_v1'),
  previewMerge: (keepId: string, mergeIds: string[]) => rpc<Record<string, string[]>>('preview_catalog_merge_v1', { p: { keepId, mergeIds } }),
  merge: (input: { keepId: string; mergeIds: string[]; unitConfirmed: boolean; note?: string }) =>
    rpc<{ keepId: string; mergedIds: string[]; transactions: string[]; warehouses: number; budgetLines: number }>('merge_catalog_items_v1', { p: input }),
  dismissDuplicate: (input: { itemIds: string[]; reason: string }) => rpc<{ itemIds: string[] }>('dismiss_catalog_duplicate_v1', { p: input }),
};

// --- So trùng phía giao diện (giống app_private.catalog_name_key) ---
export const foldVi = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
export const catalogNameKey = (t: string) => foldVi(t).replace(/,/g, '.').replace(/[×*]/g, 'x').replace(/\bly\b/g, 'mm').replace(/[\s\-_/().]+/g, '');

/** Mã gần giống theo từ (không dấu); khớp khóa chuẩn hóa thì điểm 99. */
export const similarCatalogItems = <T extends { name: string }>(items: T[], query: string, limit = 6) => {
  const words = foldVi(query).split(/[\s/*x×-]+/).filter(w => w.length > 1);
  if (!words.length) return [] as Array<{ item: T; score: number }>;
  const key = catalogNameKey(query);
  return items.map(item => {
    const n = foldVi(item.name);
    return { item, score: catalogNameKey(item.name) === key ? 99 : words.filter(w => n.includes(w)).length / words.length };
  }).filter(x => x.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, limit);
};

/** Gợi ý cách quản lý kho theo tên / ĐVT / nhóm (danh sách cuối cùng do người Cấp mã quyết). */
export const guessInventoryMode = (name: string, unit?: string | null, category?: string | null): InventoryMode =>
  category === 'DV' || ['Giờ', 'Ca', 'Lần', 'Chuyến'].includes(unit || '') || /^chi phí|ca máy|vận chuyển/i.test(name) ? 'service'
    : /bê tông thương phẩm|^base\b|dầu diezel|dầu do\b/i.test(name) ? 'use' : 'stock';

// ---------- Phân quyền kho (mở rộng Người phụ trách V1-2) ----------
const OWNER_ERRORS: Record<string, string> = {
  WMS_OWNERS_EDIT_DENIED: 'Chỉ Admin sửa được phân quyền kho.',
  WMS_OWNERS_VIEW_DENIED: 'Bạn chưa có quyền xem kho.',
  WMS_OWNERS_CLOSER_NOT_ACCOUNTANT: 'Người khóa kỳ phải nằm trong danh sách Kế toán kho.',
  WMS_OWNERS_WAREHOUSE_INVALID: 'Có kho không còn hoạt động. Tải lại trang.',
  WMS_OWNERS_USER_INVALID: 'Có người đã nghỉ / bị khóa tài khoản. Tải lại trang.',
};
export const ownersErrorMessage = (error: unknown, fallback = 'Chưa lưu được. Thử lại sau.') => {
  const raw = String((error as any)?.message || error || '');
  const code = Object.keys(OWNER_ERRORS).find(k => raw.includes(k));
  return code ? OWNER_ERRORS[code] : catalogErrorMessage(error, fallback);
};

export const wmsAccessService = {
  get: () => rpc<WmsAccessData>('get_wms_access_v1'),
  save: (a: WmsAccess, revoke: LegacyGrant[]) => rpc<{ added: number; removed: number; lines: string[] }>('save_wms_access_v1', { p: accessPayload(a, revoke) }),
};
