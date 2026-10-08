// Nhập bảng từ Excel thông minh, dùng chung: trường "Bảng" của Quy trình, nhập vật tư Mua hàng.
// Phần đọc làm việc trên ma trận ô (đã đọc từ file) để kiểm thử được mà không cần file thật.

export const MAX_IMPORT_ROWS = 1000;
const HEADER_SCAN_ROWS = 20;

/** "Ngày tháng năm sinh" ≈ "ngay thang nam sinh" ≈ "NGÀY THÁNG NĂM SINH (*)". */
export const normalizeHeader = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  return String(value).replace(/\s+/g, ' ').trim();
};

/** 2 = trùng tên cột, 1 = tên này chứa tên kia (vd. "Họ và tên nhân viên"), 0 = không khớp. */
const matchScore = (target: string, source: string): number => {
  if (!target || !source) return 0;
  if (target === source) return 2;
  if (source.includes(target) || (target.includes(source) && source.length >= 3)) return 1;
  return 0;
};

/** Mỗi cột đích có thể có nhiều tên gọi (tên chính + từ đồng nghĩa), đã chuẩn hoá. */
const mapHeaderRow = (row: unknown[], targets: string[][]) => {
  const sources = row.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Array<number | null> = targets.map(() => null);
  const best = (names: string[], source: string) => Math.max(0, ...names.map(name => matchScore(name, source)));
  // Khớp chính xác trước, rồi mới tới khớp gần đúng, để một cột nguồn không bị hai cột đích giành.
  for (const level of [2, 1]) {
    targets.forEach((names, ti) => {
      if (mapping[ti] !== null) return;
      const si = sources.findIndex((source, index) => !used.has(index) && best(names, source) === level);
      if (si >= 0) { mapping[ti] = si; used.add(si); }
    });
  }
  return { mapping, matched: mapping.filter(index => index !== null).length };
};

export interface TableImportResult {
  rows: string[][];
  /** Giá trị gốc của cùng các ô (số, ngày…) để bên dùng tự đọc số chính xác. */
  rawRows: unknown[][];
  /** Tên cột trong file tương ứng từng cột của bảng; null = file không có cột này. */
  sourceHeaders: Array<string | null>;
  /** Cột trong file không dùng tới (STT, cột thừa…). */
  ignoredHeaders: string[];
  /** Không tìm thấy dòng tiêu đề: đọc theo thứ tự cột. */
  byPosition: boolean;
  skippedEmpty: number;
  truncated: boolean;
}

/** aliases[i]: các tên gọi khác của columns[i] (VD "ĐVT", "Đơn vị" cho "Đơn vị tính"). */
export const parseTableMatrix = (matrix: unknown[][], columns: string[], aliases: string[][] = []): TableImportResult => {
  const targets = columns.map((column, index) => [column, ...(aliases[index] || [])].map(normalizeHeader).filter(Boolean));
  let headerIndex = -1;
  let best = { mapping: [] as Array<number | null>, matched: 0 };
  matrix.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    const candidate = mapHeaderRow(row || [], targets);
    if (candidate.matched > best.matched) { best = candidate; headerIndex = index; }
  });
  // Ít nhất một nửa số cột (tối thiểu 1) phải khớp mới coi là dòng tiêu đề.
  const byPosition = headerIndex < 0 || best.matched < Math.max(1, Math.ceil(columns.length / 2));
  const mapping = byPosition ? columns.map((_, index) => index) : best.mapping;
  const header = byPosition ? [] : (matrix[headerIndex] || []);
  const body = byPosition ? matrix : matrix.slice(headerIndex + 1);

  const rows: string[][] = [];
  const rawRows: unknown[][] = [];
  let skippedEmpty = 0;
  let truncated = false;
  for (const raw of body) {
    const row = mapping.map(source => (source === null ? '' : cellText((raw || [])[source])));
    if (row.every(cell => cell === '')) { skippedEmpty += 1; continue; }
    if (rows.length >= MAX_IMPORT_ROWS) { truncated = true; break; }
    rows.push(row);
    rawRows.push(mapping.map(source => (source === null ? null : (raw || [])[source] ?? null)));
  }

  const usedSources = new Set(mapping.filter((index): index is number => index !== null));
  return {
    rows,
    rawRows,
    sourceHeaders: byPosition ? columns.map(() => null) : mapping.map(index => (index === null ? null : cellText(header[index]) || null)),
    ignoredHeaders: byPosition ? [] : header.map(cellText).filter((text, index) => text && !usedSources.has(index)),
    byPosition,
    skippedEmpty,
    truncated,
  };
};

/** Bảng chỉ có một dòng trống mặc định thì coi như chưa nhập gì. */
export const isTableEmpty = (rows: string[][] | null | undefined) =>
  !Array.isArray(rows) || rows.every(row => (row || []).every(cell => !String(cell ?? '').trim()));

export const tableTemplateFileName = (label: string) =>
  `Mau_${normalizeHeader(label).replace(/ /g, '_') || 'bang'}.xlsx`;

/** Số trong Excel: số thật giữ nguyên; chữ thì hiểu cả "1.234,5" (VN) lẫn "1,234.5" (EN); "1.500" = 1500. */
export const parseLooseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).replace(/[\s\u00a0đĐ₫]|vnd|VND/g, '').trim();
  if (!text) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Dấu xuất hiện sau cùng là dấu thập phân.
    text = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = text.split(sep);
    const thousands = parts.length > 2 || (parts[1]?.length === 3 && parts[0] !== '0' && parts[0] !== '-0');
    text = thousands ? parts.join('') : parts.join('.');
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};
