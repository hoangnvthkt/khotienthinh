import { isSupabaseConfigured, supabase } from './supabase';
import { specKey } from './materialLineDescription';

// Danh sách quy cách chuẩn của từng mã (doc 13 mục 9.3, 16.3). So trùng bằng specKey (bỏ dấu, dấu cách, x/*/×, ly = mm).

export type ItemSpecStatus = 'active' | 'pending' | 'retired' | 'merged';
export interface ItemSpecOption { id: string; name: string; status: ItemSpecStatus; aliases: string[] }
export interface ItemSpec extends ItemSpecOption {
  itemId: string; source: 'catalog' | 'purchase' | 'contract' | 'warehouse' | 'backfill'; note: string | null;
  createdAt: string; createdByName: string | null; reviewedAt: string | null; reviewedByName: string | null; lastUsedAt: string | null;
  stock: Array<{ warehouseId: string; warehouseName: string; qty: number }>; incoming: number; orders: number;
}
export interface PendingItemSpec extends ItemSpec { itemName: string; sku: string; unit: string | null; siblings: Array<{ id: string; name: string; status: ItemSpecStatus }> }
export type ItemSpecAction =
  | { action: 'add'; itemId: string; name: string }
  | { action: 'approve'; specId: string }
  | { action: 'rename'; specId: string; name: string }
  | { action: 'merge'; specId: string; targetId: string; reason?: string }
  | { action: 'retire'; specId: string; reason: string }
  | { action: 'reactivate'; specId: string };

export const SPEC_SOURCE_LABELS: Record<ItemSpec['source'], string> = {
  catalog: 'Danh mục', purchase: 'Mua hàng', contract: 'Bảng giá HĐ', warehouse: 'Kho', backfill: 'Chứng từ cũ',
};
/** Lý do ngừng dùng gợi ý khi rà quy cách mới (mục 16.3). */
export const SPEC_RETIRE_REASONS = ['Là ghi chú, không phải quy cách', 'Là vật tư khác — cần mã riêng', 'Không dùng nữa'];

const ERRORS: Record<string, string> = {
  CATALOG_ISSUE_DENIED: 'Chỉ người có ô quyền "Cấp mã" sửa được danh sách quy cách.',
  ITEM_SPEC_NAME_INVALID: 'Quy cách 1–80 ký tự.',
  ITEM_SPEC_SAME: 'Tên mới giống tên cũ.',
  ITEM_SPEC_NOT_FOUND: 'Không tìm thấy quy cách — tải lại.',
  ITEM_SPEC_STATE: 'Quy cách đã được người khác xử lý — tải lại.',
  ITEM_SPEC_TARGET_INVALID: 'Chọn quy cách giữ lại khác, cùng mã.',
  ITEM_SPEC_HAS_STOCK: 'Quy cách còn tồn ở kho — gộp vào quy cách khác hoặc chuyển quy cách hết tồn trước khi ngừng dùng.',
  ITEM_SPEC_INCOMING: 'Quy cách còn hàng đang về theo đơn mua — chờ nhận xong rồi ngừng dùng.',
  CATALOG_REASON_REQUIRED: 'Cần ghi lý do.',
  CATALOG_ACTION_INVALID: 'Thao tác không hợp lệ.',
};
export const itemSpecErrorMessage = (error: unknown): string => {
  const raw = String((error as any)?.message || error || '');
  const dup = raw.match(/ITEM_SPEC_DUPLICATE:(.+)/);
  if (dup) return `Trùng với quy cách “${dup[1].trim()}” đã có (so sau khi bỏ dấu, dấu cách, x/*). Dùng quy cách đó.`;
  const code = Object.keys(ERRORS).find(k => raw.includes(k));
  return code ? ERRORS[code] : raw || 'Chưa thực hiện được. Thử lại sau.';
};

const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

// Gợi ý theo mã: gom nhiều mã trong một lần gọi, nhớ trong phiên (xóa khi danh sách đổi).
const cache = new Map<string, Promise<ItemSpecOption[]>>();
let queued: Array<{ id: string; resolve: (v: ItemSpecOption[]) => void; reject: (e: unknown) => void }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const flush = () => {
  const batch = queued; queued = []; timer = null;
  const ids = [...new Set(batch.map(b => b.id))];
  rpc<Record<string, ItemSpecOption[]>>('get_item_specs_v1', { p_item_ids: ids })
    .then(map => batch.forEach(b => b.resolve(map?.[b.id] || [])))
    .catch(e => { ids.forEach(id => cache.delete(id)); batch.forEach(b => b.reject(e)); });
};

export const itemSpecService = {
  options(itemId: string): Promise<ItemSpecOption[]> {
    let p = cache.get(itemId);
    if (!p) {
      p = new Promise((resolve, reject) => { queued.push({ id: itemId, resolve, reject }); if (!timer) timer = setTimeout(flush, 20); });
      cache.set(itemId, p);
    }
    return p;
  },
  forget(itemId?: string) { if (itemId) cache.delete(itemId); else cache.clear(); },
  list: (itemId: string) => rpc<{ canManage: boolean; specs: ItemSpec[] }>('list_item_specs_v1', { p_item_id: itemId }),
  pending: () => rpc<{ canManage: boolean; specs: PendingItemSpec[] }>('list_pending_item_specs_v1'),
  manage: async (input: ItemSpecAction) => {
    const r = await rpc<ItemSpec & { moved: number }>('manage_item_spec_v1', { p: input });
    cache.delete(r.itemId);
    return r;
  },
};

/** Quy cách chuẩn khớp chữ đã gõ (kể cả tên cũ / tên đã gộp). */
export const matchItemSpec = (options: ItemSpecOption[], text: string): ItemSpecOption | null => {
  const k = specKey(text);
  if (!k) return null;
  return options.find(o => specKey(o.name) === k || o.aliases.some(a => specKey(a) === k)) || null;
};

/**
 * "Có thể là vật tư khác" (mục 9.3): quy cách ghi kích thước cùng loại với tên mã nhưng khác số, VD mã "Thép XD D8" mà quy cách "D10".
 * So các cụm chữ + số (D8, M24, PN10, DN50, Φ16) và số đi với mm.
 */
export const specSizeConflict = (itemName: string, spec: string): string | null => {
  const tokens = (s: string) => {
    const t = s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Φ|Ø/g, 'D');
    const out = new Map<string, Set<string>>();
    for (const m of t.matchAll(/\b(D|DN|M|PN|K)\s?(\d+(?:[.,]\d+)?)(?![\d.,])/g)) {
      const key = m[1]; const val = m[2].replace(',', '.');
      out.set(key, (out.get(key) || new Set()).add(val));
    }
    for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s?(MM|LY)\b/g)) out.set('MM', (out.get('MM') || new Set()).add(m[1].replace(',', '.')));
    return out;
  };
  const a = tokens(itemName); const b = tokens(spec);
  for (const [k, vals] of b) {
    const base = a.get(k);
    if (!base) continue;
    const other = [...vals].find(v => !base.has(v));
    if (other) return `Mã ghi ${k === 'MM' ? '' : k}${[...base].join('/')}${k === 'MM' ? 'mm' : ''}, quy cách ghi ${k === 'MM' ? '' : k}${other}${k === 'MM' ? 'mm' : ''} — có thể là vật tư khác (cần mã riêng).`;
  }
  return null;
};
