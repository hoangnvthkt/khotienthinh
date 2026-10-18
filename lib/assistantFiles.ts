// Trợ lý v2 · T3 — tệp trong chat (chủ SP 18/10/2026). Bảng tính (Excel / CSV) đọc NGAY TRÊN MÁY thành bảng chữ, số giữ nguyên
// (không dấu phân cách nghìn → AI không nhầm 6.300 với 6,3); ảnh thu về cạnh 2000 px rồi gửi kèm câu hỏi. Không lưu tệp ở máy chủ:
// hội thoại chỉ ghi tên tệp, lượt sau cần thì gửi lại. PDF (≤ 50 MB): chữ đọc trên máy, PDF scan → ảnh các trang đầu (lib/assistantPdf).
import { loadXlsx } from './loadXlsx';
import { prepareCapturePhoto } from './wmsDeliveryCaptureService';
import { isPdfFile, readPdf } from './assistantPdf';

export interface ImageAttachment { kind: 'image'; id: string; name: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; b64: string; previewUrl: string }
export interface TableAttachment { kind: 'table'; id: string; name: string; text: string; rows: number; sheets: string[]; truncated: boolean }
/** PDF có chữ: gửi như bảng tính (chữ từng trang). */
export interface DocAttachment { kind: 'doc'; id: string; name: string; text: string; pages: number; truncated: boolean }
export type ChatAttachment = ImageAttachment | TableAttachment | DocAttachment;

export const MAX_IMAGES = 4;
export const MAX_TABLES = 3;
/** Tổng chữ của bảng tính + PDF mỗi lần gửi (cổng AI nhận tối đa 30.000). */
const MAX_FILES_TEXT = 29000;
const MAX_TABLE_CHARS = 14000;
const MAX_ROWS = 200;
const MAX_COLS = 15;
const MAX_CELL = 60;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf,.xlsx,.xls,.csv';

const TABLE_EXT = /\.(xlsx|xls|csv)$/i;
export const isTableFile = (file: Pick<File, 'name' | 'type'>) => TABLE_EXT.test(file.name) || /spreadsheet|excel|csv/i.test(file.type);
export const isImageFile = (file: Pick<File, 'name' | 'type'>) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);

const cellText = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : '';
  // Số giữ nguyên dạng máy (6300, 15850, 7.5) — không định dạng kiểu Việt để AI không nhầm dấu nghìn.
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
  return String(v).replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, MAX_CELL);
};

/** Một sheet → bảng chữ "| a | b |": bỏ hàng / cột trống, tối đa 200 hàng × 15 cột; trả số hàng có dữ liệu. */
export const sheetToText = (matrix: unknown[][]): { text: string; rows: number; truncated: boolean } => {
  const rows = matrix.map(r => (Array.isArray(r) ? r : []).map(cellText)).filter(r => r.some(Boolean));
  if (!rows.length) return { text: '', rows: 0, truncated: false };
  const width = Math.min(MAX_COLS, Math.max(...rows.map(r => r.length)));
  const used = Array.from({ length: width }, (_, c) => rows.some(r => r[c])).map((u, c) => (u ? c : -1)).filter(c => c >= 0);
  const kept = rows.slice(0, MAX_ROWS);
  const text = kept.map(r => `| ${used.map(c => r[c] || '').join(' | ')} |`).join('\n');
  return { text, rows: rows.length, truncated: rows.length > MAX_ROWS || rows.some(r => r.length > MAX_COLS) };
};

/** Nhiều sheet → một khối chữ (≤ 14.000 ký tự): mỗi sheet có tiêu đề; cắt bớt thì ghi rõ để AI biết bảng chưa đủ. */
export const workbookToText = (sheets: Array<{ name: string; matrix: unknown[][] }>): { text: string; rows: number; sheets: string[]; truncated: boolean } => {
  const parts: string[] = []; const names: string[] = [];
  let rows = 0; let truncated = false; let size = 0;
  for (const sheet of sheets) {
    const t = sheetToText(sheet.matrix);
    if (!t.rows) continue;
    const head = `[Sheet ${sheet.name} · ${t.rows} hàng${t.truncated ? `, chỉ gửi ${MAX_ROWS} hàng đầu` : ''}]`;
    let body = t.text;
    if (size + head.length + body.length > MAX_TABLE_CHARS) {
      body = body.slice(0, Math.max(0, MAX_TABLE_CHARS - size - head.length - 40));
      body = body.slice(0, body.lastIndexOf('\n') > 0 ? body.lastIndexOf('\n') : body.length);
      truncated = true;
    }
    if (!body) { truncated = true; break; }
    parts.push(`${head}\n${body}`); names.push(sheet.name);
    rows += t.rows; size += head.length + body.length + 2;
    truncated ||= t.truncated;
    if (size >= MAX_TABLE_CHARS || names.length >= 3) { truncated ||= sheets.length > names.length; break; }
  }
  const text = parts.join('\n\n') + (truncated ? '\n(… tệp dài, đã cắt bớt — chỉ dựa trên phần trên)' : '');
  return { text, rows, sheets: names, truncated };
};

const fileToB64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Không đọc được tệp.'));
  r.readAsDataURL(f);
});
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const readTableFile = async (file: File): Promise<TableAttachment> => {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name}: tệp quá lớn (trên 8 MB).`);
  const XLSX = await loadXlsx();
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheets = book.SheetNames.map(name => ({ name, matrix: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }) }));
  const out = workbookToText(sheets);
  if (!out.rows) throw new Error(`${file.name}: không thấy dữ liệu trong tệp.`);
  return { kind: 'table', id: uid(), name: file.name, text: out.text, rows: out.rows, sheets: out.sheets, truncated: out.truncated };
};

export const readImageFile = async (file: File): Promise<ImageAttachment> => {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: ảnh quá lớn (trên 25 MB).`);
  const prepared = await prepareCapturePhoto(file);
  const mime = (['image/jpeg', 'image/png', 'image/webp'].includes(prepared.type) ? prepared.type : 'image/jpeg') as ImageAttachment['mime'];
  const b64 = await fileToB64(prepared);
  if (b64.length > 6_000_000) throw new Error(`${file.name}: ảnh quá lớn sau khi thu nhỏ.`);
  return { kind: 'image', id: uid(), name: file.name || 'ảnh', mime, b64, previewUrl: URL.createObjectURL(prepared) };
};

const textUsed = (list: ChatAttachment[]) => list.reduce((n, a) => n + (a.kind === 'image' ? 0 : a.text.length), 0);
const blobToImage = async (blob: Blob, name: string): Promise<ImageAttachment> =>
  ({ kind: 'image', id: uid(), name, mime: 'image/jpeg', b64: await fileToB64(blob), previewUrl: URL.createObjectURL(blob) });

/** Thêm tệp vào danh sách đính kèm: giữ giới hạn 4 ảnh / 3 tệp chữ (Excel, CSV, PDF); tệp lạ hoặc quá giới hạn báo lý do (không chặn tệp khác). */
export const addAttachments = async (current: ChatAttachment[], files: File[]): Promise<{ list: ChatAttachment[]; errors: string[] }> => {
  const list = [...current]; const errors: string[] = [];
  const textFiles = () => list.filter(a => a.kind !== 'image').length;
  const images = () => list.filter(a => a.kind === 'image').length;
  for (const file of files) {
    try {
      if (isPdfFile(file)) {
        const budget = MAX_FILES_TEXT - textUsed(list);
        const read = await readPdf(file, MAX_IMAGES - images(), Math.min(14000, budget));
        if (read.kind === 'text' && read.text) {
          if (textFiles() >= MAX_TABLES) { errors.push(`Tối đa ${MAX_TABLES} tệp Excel / PDF mỗi lần.`); continue; }
          if (budget < 1500) { errors.push(`${file.name}: các tệp đã đủ dài — gửi riêng PDF này ở câu sau.`); continue; }
          list.push({ kind: 'doc', id: uid(), name: file.name, text: read.text.text, pages: read.pages, truncated: read.text.truncated });
        } else {
          for (const img of read.images || []) list.push(await blobToImage(img.blob, `${file.name} · trang ${img.page}`));
          if (read.pages > (read.images || []).length) errors.push(`${file.name}: PDF scan — chỉ gửi ${(read.images || []).length}/${read.pages} trang đầu dạng ảnh.`);
        }
      } else if (isTableFile(file)) {
        if (textFiles() >= MAX_TABLES) { errors.push(`Tối đa ${MAX_TABLES} tệp Excel / PDF mỗi lần.`); continue; }
        const table = await readTableFile(file);
        if (textUsed(list) + table.text.length > MAX_FILES_TEXT) { errors.push(`${file.name}: các tệp đã đủ dài — gửi riêng tệp này ở câu sau.`); continue; }
        list.push(table);
      } else if (isImageFile(file)) {
        if (images() >= MAX_IMAGES) { errors.push(`Tối đa ${MAX_IMAGES} ảnh mỗi lần.`); continue; }
        list.push(await readImageFile(file));
      } else errors.push(`${file.name}: chưa đọc được loại tệp này (dùng ảnh, PDF, Excel hoặc CSV).`);
    } catch (e) { errors.push(e instanceof Error ? e.message : `${file.name}: chưa đọc được.`); }
  }
  return { list, errors: Array.from(new Set(errors)) };
};

/** Dòng tên tệp hiện dưới câu hỏi (giống dòng cổng AI ghi vào hội thoại). */
export const attachmentLabel = (list: ChatAttachment[]) => {
  const tables = list.filter(a => a.kind !== 'image').map(a => a.name);
  const images = list.filter(a => a.kind === 'image').length;
  const names = [...tables, ...(images ? [`${images} ảnh`] : [])];
  return names.length ? `📎 ${names.join(' · ')}` : '';
};
