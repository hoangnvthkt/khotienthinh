// V1-3a Gộp mã trùng: phân loại nhóm tên giống nhau và gợi ý mã giữ. Logic thuần, máy chủ là get_catalog_duplicates_v1 / merge_catalog_items_v1.

export interface DuplicateItem {
  id: string; sku: string; name: string; unit: string; numbers: string[] | null;
  usage: { ledger: number; requests: number; stockQty: number; transactions: number; purchaseOrders: number; openPurchaseOrders: number };
  stock: Array<{ warehouseId: string; warehouseName: string; qty: number; value: number }>;
  plan: number; pending: number; lastUsed: string | null;
}
export interface DuplicateGroup { key: string; items: DuplicateItem[] }
export interface DuplicatesData {
  can: { merge: boolean };
  groups: DuplicateGroup[];
  merged: Array<{ id: string; sku: string; name: string; intoId: string; intoSku: string; at: string }>;
  dismissed: Array<{ itemIds: string[]; reason: string; at: string; by: string | null }>;
}

export type DuplicateVerdict = 'dup' | 'accent' | 'unit' | 'diffnum';
export const VERDICT_LABEL: Record<DuplicateVerdict, string> = {
  dup: 'Trùng', accent: 'Cần xem — khác chữ', unit: 'Cần xem — khác ĐVT', diffnum: 'Không trùng — khác số',
};

const nums = (i: DuplicateItem) => [...(i.numbers || [])].sort().join(',');
// Giữ dấu tiếng Việt, chỉ bỏ hoa thường, dấu cách, "/", "-", "*" / "x" — để "nhỏ / nhỡ", "Tụ / Tủ" không bị coi là trùng rõ.
const tight = (s: string) => s.toLowerCase().normalize('NFC').replace(/[*×]/g, 'x').replace(/[\s/\-_,()]+/g, '');

export const verdictOf = (g: DuplicateGroup): { v: DuplicateVerdict; why: string } => {
  const [a] = g.items;
  const bad = g.items.find(i => nums(i) !== nums(a));
  if (bad) return { v: 'diffnum', why: `khác số: ${(a.numbers || []).join('×') || '—'} / ${(bad.numbers || []).join('×') || '—'}` };
  const u = g.items.find(i => i.unit.trim().toLowerCase() !== a.unit.trim().toLowerCase());
  if (u) return { v: 'unit', why: `khác ĐVT: ${a.unit} / ${u.unit}` };
  const t = g.items.find(i => tight(i.name) !== tight(a.name));
  if (t) return { v: 'accent', why: `khác chữ / dấu: “${a.name}” / “${t.name}”` };
  return { v: 'dup', why: 'chỉ khác cách viết (hoa thường, dấu cách, * / x)' };
};

export const isUsed = (i: DuplicateItem) =>
  i.usage.ledger + i.usage.transactions + i.usage.purchaseOrders + i.usage.requests + i.plan > 0 || i.stock.length > 0;

/** Gợi ý mã giữ: có kế hoạch → đơn mua mở → phiếu chờ → có tồn → nhiều chứng từ hơn. */
export const keepScore = (i: DuplicateItem) =>
  i.plan * 100 + i.usage.openPurchaseOrders * 50 + i.pending * 40 + (i.stock.some(s => s.qty > 0) ? 30 : 0) + i.usage.ledger + i.usage.transactions;
export const suggestKeep = (g: DuplicateGroup) => [...g.items].sort((a, b) => keepScore(b) - keepScore(a) || a.sku.localeCompare(b.sku))[0];

const ORDER: DuplicateVerdict[] = ['dup', 'accent', 'unit', 'diffnum'];
export const sortGroups = (groups: DuplicateGroup[]) =>
  groups.map(g => ({ ...g, verdict: verdictOf(g) })).sort((a, b) => ORDER.indexOf(a.verdict.v) - ORDER.indexOf(b.verdict.v) || a.key.localeCompare(b.key));
