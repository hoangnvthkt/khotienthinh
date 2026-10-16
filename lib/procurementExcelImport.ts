// Nhập danh sách vật tư từ Excel cho đơn mua (đơn chủ động): đọc file → khớp danh mục vật tư → quy đổi đơn vị.
import type { ProcurementCatalogItem } from './procurementInboxService';
import { normalizeHeader, parseLooseNumber, type TableImportResult } from './excelTableImport';
import { qtyInUnit } from './materialRequestText';

export const PO_IMPORT_COLUMNS = ['Mã vật tư', 'Tên vật tư', 'Quy cách', 'Đơn vị tính', 'Số lượng', 'Đơn giá'];
/** Tên cột hay gặp trong báo giá / bảng kê. Không dùng từ quá ngắn ("mã", "giá") vì dễ khớp nhầm cột khác. */
export const PO_IMPORT_ALIASES = [
  ['mã vt', 'mã hàng', 'mã số', 'mã sp', 'sku', 'mã hh'],
  ['tên hàng', 'tên hàng hóa', 'tên sản phẩm', 'diễn giải', 'nội dung', 'mô tả', 'hàng hóa', 'vật tư', 'tên vt'],
  ['thông số', 'đặc tính', 'kích thước', 'chủng loại', 'thông số kỹ thuật'],
  ['đvt', 'đơn vị', 'dvt'],
  ['sl', 'khối lượng', 'kl', 'số lg'],
  ['đg', 'giá mua', 'giá đơn vị', 'đơn giá chưa vat'],
];

export interface PoImportRow {
  /** Số dòng hiển thị (1, 2, …) theo thứ tự trong file. */
  index: number;
  sku: string; name: string; spec: string; unit: string;
  qty: number | null; price: number | null;
  /** Ghi chú của dòng (báo giá AI đọc: "3115 cây" khi bán theo kg) — dùng để đối chiếu quy đổi. */
  note?: string | null;
}

export const readPoImportRows = (result: TableImportResult): PoImportRow[] =>
  result.rows.map((row, i) => {
    const raw = result.rawRows[i] || [];
    return {
      index: i + 1, sku: row[0], name: row[1], spec: row[2], unit: row[3],
      qty: parseLooseNumber(raw[4]), price: parseLooseNumber(raw[5]),
    };
  }).filter(row => row.sku || row.name);

const tokens = (text: string) => normalizeHeader(text).split(' ').filter(Boolean);

/** 0–1: mức giống nhau của hai tên theo số từ trùng (không phân biệt dấu, hoa thường). */
export const nameSimilarity = (a: string, b: string): number => {
  const ta = new Set(tokens(a)); const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0; ta.forEach(t => { if (tb.has(t)) common += 1; });
  return common / new Set([...ta, ...tb]).size;
};

export type MatchConfidence = 'sku' | 'name' | 'suggested';
export interface CatalogMatch { item: ProcurementCatalogItem | null; confidence: MatchConfidence | null; options: ProcurementCatalogItem[] }

/** Mác thép phân định loại: CB300 trở lên (vằn) không phải "tròn trơn"; CB240 là tròn trơn (TCVN 1651). */
const steelGradePenalty = (text: string, itemName: string): number => {
  const t = normalizeHeader(text); const n = normalizeHeader(itemName);
  if (/\bcb ?[3-6]\d\d\b|\bsd ?\d{3}\b|\bvan\b/.test(t) && /tron tron/.test(n)) return 0.15;
  if (/\bcb ?240\b/.test(t) && /\bvan\b/.test(n)) return 0.15;
  return 0;
};

/** Chọn vật tư cho một dòng: trùng mã > trùng tên > tên gần giống (≥ 50% từ trùng). */
export const pickCatalogMatch = (row: Pick<PoImportRow, 'sku' | 'name'> & { spec?: string }, candidates: ProcurementCatalogItem[]): CatalogMatch => {
  const unique = Array.from(new Map(candidates.map(item => [item.id, item])).values());
  const sku = normalizeHeader(row.sku);
  if (sku) {
    const bySku = unique.find(item => normalizeHeader(item.sku) === sku);
    if (bySku) return { item: bySku, confidence: 'sku', options: [bySku] };
  }
  const gradeText = `${row.name} ${row.spec || ''}`;
  const ranked = unique
    .map(item => ({ item, score: nameSimilarity(row.name, item.name) - steelGradePenalty(gradeText, item.name) }))
    .filter(entry => entry.score > 0)
    .sort((x, y) => y.score - x.score || Number(y.item.inBoq) - Number(x.item.inBoq));
  const options = ranked.slice(0, 6).map(entry => entry.item);
  const top = ranked[0];
  if (top && normalizeHeader(top.item.name) === normalizeHeader(row.name)) return { item: top.item, confidence: 'name', options };
  if (top && top.score >= 0.5) return { item: top.item, confidence: 'suggested', options };
  return { item: null, confidence: null, options };
};

/** Các câu tìm gửi server (server đòi đủ mọi từ): mã, tên đầy đủ, rồi bớt dần từ cuối. */
export const searchQueriesFor = (row: Pick<PoImportRow, 'sku' | 'name'>): string[] => {
  const words = row.name.trim().split(/\s+/).filter(Boolean);
  const queries = row.sku.trim() ? [row.sku.trim()] : [];
  for (let n = Math.min(words.length, 4); n >= 1; n -= 1) queries.push(words.slice(0, n).join(' '));
  return Array.from(new Set(queries));
};

const UNIT_GROUPS = [['cai', 'chiec'], ['kg', 'kilogam', 'kilogram', 'kgs'], ['m3', 'khoi', 'met khoi'], ['m2', 'met vuong'], ['m', 'met'], ['tan', 'ton']];
export const normalizeUnit = (unit: string | null | undefined): string => {
  const base = normalizeHeader(String(unit ?? '').replace(/²/g, '2').replace(/³/g, '3'));
  return UNIT_GROUPS.find(group => group.includes(base))?.[0] ?? base;
};

export interface ImportedPoLine {
  item: ProcurementCatalogItem;
  spec: string;
  /** SL theo đơn vị kho. */
  stockQty: number;
  /** Mua theo đơn vị mua của vật tư (ĐVT trong file = đơn vị mua). */
  altUnit: boolean; purchaseQty: number | null;
  /** Đơn giá theo đơn vị mua (altUnit) hoặc đơn vị kho. */
  price: number | null;
  warnings: string[];
  /** Số dòng file đã gộp vào dòng này. */
  sourceRows: number[];
}

/** ĐVT trong file → SL kho; ĐVT là đơn vị mua thì quy đổi; ĐVT lạ thì coi như đơn vị kho và cảnh báo. */
export const toImportedLine = (row: PoImportRow, item: ProcurementCatalogItem): ImportedPoLine => {
  const warnings: string[] = [];
  const unit = normalizeUnit(row.unit);
  const factor = item.purchaseFactor && item.purchaseFactor > 0 ? item.purchaseFactor : 1;
  const asPurchase = Boolean(unit && item.purchaseUnit && unit === normalizeUnit(item.purchaseUnit) && unit !== normalizeUnit(item.unit));
  if (unit && !asPurchase && unit !== normalizeUnit(item.unit)) {
    warnings.push(`ĐVT trong file "${row.unit}" khác ĐVT kho "${item.unit || '—'}" — đang hiểu SL theo ${item.unit || 'đơn vị kho'}.`);
  }
  if (row.qty == null || !(row.qty > 0)) warnings.push('Chưa có số lượng hợp lệ.');
  const qty = row.qty && row.qty > 0 ? row.qty : 0;
  const converted = asPurchase ? Math.round(qty * factor * 1000) / 1000 : qty;
  // Báo giá bán theo ĐV mua mà ghi kèm số theo ĐV kho ("21.490 kg · 3115 cây"): kho nhận theo số NCC ghi, tiền theo SL mua —
  // không quy đổi lại theo hệ số danh mục (thép thiếu cân / barem khác). Lệch > 2% thì báo để người mua kiểm.
  const stated = asPurchase && qty > 0 ? qtyInUnit({ note: row.note ?? null, spec: null, raw: '' }, item.unit) : null;
  if (stated != null && converted > 0 && Math.abs(stated - converted) / stated > 0.02) {
    const vi = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);
    warnings.push(`Báo giá ghi ${vi(stated)} ${item.unit}; hệ số danh mục ra ${vi(converted)} ${item.unit} (lệch ${vi(Math.abs(stated - converted) / stated * 100)}%) — đơn lấy ${vi(stated)} ${item.unit} theo báo giá, kiểm barem / cân thực tế.`);
  }
  return {
    item, spec: row.spec,
    stockQty: stated ?? converted,
    altUnit: asPurchase, purchaseQty: asPurchase ? qty : null,
    price: row.price != null && row.price >= 0 ? row.price : null,
    warnings, sourceRows: [row.index],
  };
};

/** Cùng một vật tư xuất hiện nhiều dòng: cộng SL (cùng cách tính đơn vị), giữ đơn giá dòng đầu. */
export const mergeImportedLines = (lines: ImportedPoLine[]): ImportedPoLine[] => {
  const byItem = new Map<string, ImportedPoLine>();
  lines.forEach(line => {
    const key = `${line.item.id}:${line.altUnit ? 'p' : 's'}`;
    const prev = byItem.get(key);
    if (!prev) { byItem.set(key, { ...line, warnings: [...line.warnings], sourceRows: [...line.sourceRows] }); return; }
    prev.stockQty = Math.round((prev.stockQty + line.stockQty) * 1000) / 1000;
    if (prev.purchaseQty != null && line.purchaseQty != null) prev.purchaseQty = Math.round((prev.purchaseQty + line.purchaseQty) * 1000) / 1000;
    if (prev.price == null) prev.price = line.price;
    else if (line.price != null && line.price !== prev.price) prev.warnings.push(`Dòng ${line.sourceRows.join(', ')} có đơn giá khác — giữ giá dòng ${prev.sourceRows[0]}.`);
    if (!prev.spec && line.spec) prev.spec = line.spec;
    prev.sourceRows.push(...line.sourceRows);
  });
  return Array.from(byItem.values());
};
