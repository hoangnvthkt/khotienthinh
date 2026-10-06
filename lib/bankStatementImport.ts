// Đọc file Excel / CSV sao kê ngân hàng (Vietcombank, BIDV, VietinBank, Techcombank, MB, ACB, Agribank…) thành dòng chuẩn.
// Mỗi ngân hàng đặt tên cột khác nhau: tự tìm dòng tiêu đề, rồi nhận cột theo từ khoá. "Ghi nợ" (debit) = tiền RA khỏi tài khoản, "Ghi có" (credit) = tiền VÀO.
import { loadXlsx } from './loadXlsx';

export interface BankStatementRow {
  row: number; date: string; direction: 'in' | 'out'; amount: number;
  description: string; reference: string | null; counterparty: string | null; balance: number | null;
}
export interface BankStatementParse { rows: BankStatementRow[]; skipped: Array<{ row: number; reason: string }>; columns: Record<string, string | null>; headerRow: number | null }

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
const COLS: Record<string, string[]> = {
  date: ['ngày giao dịch', 'ngày gd', 'ngày hiệu lực', 'ngày hạch toán', 'transaction date', 'trans date', 'txn date', 'value date', 'ngày', 'date'],
  debit: ['ghi nợ', 'số tiền ghi nợ', 'phát sinh nợ', 'rút ra', 'tiền ra', 'chi', 'debit', 'withdrawal', 'số tiền rút'],
  credit: ['ghi có', 'số tiền ghi có', 'phát sinh có', 'gửi vào', 'tiền vào', 'thu', 'credit', 'deposit', 'số tiền gửi'],
  amount: ['số tiền giao dịch', 'số tiền', 'amount'],
  sign: ['loại giao dịch', 'nợ/có', 'c/d', 'dr/cr', 'loại'],
  description: ['nội dung giao dịch', 'nội dung', 'diễn giải', 'mô tả', 'chi tiết giao dịch', 'description', 'remark', 'details', 'narrative'],
  reference: ['số tham chiếu', 'số bút toán', 'mã giao dịch', 'số giao dịch', 'số ct', 'số chứng từ', 'reference', 'ref no', 'transaction no', 'seq'],
  counterparty: ['tên đối ứng', 'tên tài khoản đối ứng', 'đơn vị thụ hưởng', 'người chuyển', 'người hưởng', 'đối tác', 'counterparty', 'beneficiary', 'tên người nhận'],
  balance: ['số dư', 'balance', 'số dư cuối'],
};
// Một cột chỉ thuộc một nghĩa; ưu tiên cột khớp đúng tên, rồi cột chứa từ khoá (debit/credit trước amount để "Số tiền ghi nợ" không bị nhận là "Số tiền").
const ORDER = ['date', 'debit', 'credit', 'balance', 'reference', 'counterparty', 'description', 'sign', 'amount'];

export const parseNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim(); if (!s || s === '-') return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  // 1.234.567 | 1,234,567 | 1.234.567,89 | 1,234,567.89
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  const dec = lastDot > lastComma ? (s.length - lastDot - 1 <= 2 && s.split('.').length === 2 ? '.' : null) : lastComma > lastDot ? (s.length - lastComma - 1 <= 2 && s.split(',').length === 2 ? ',' : null) : null;
  const n = Number(dec ? s.replace(dec === '.' ? /,/g : /\./g, '').replace(',', '.') : s.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

export const parseDate = (v: unknown): string | null => {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

export const detectColumns = (header: string[]): Record<string, number | null> => {
  const h = header.map(norm); const used = new Set<number>(); const out: Record<string, number | null> = {};
  for (const key of ORDER) {
    let idx = h.findIndex((c, i) => !used.has(i) && c && COLS[key].includes(c));
    // Từ ngắn (chi, thu, loại, ngày…) chỉ nhận khi khớp đúng tên cột, tránh "Chi tiết giao dịch", "Loại tiền".
    if (idx < 0) idx = h.findIndex((c, i) => !used.has(i) && c && COLS[key].some(k => k.length >= 5 && c.includes(k)));
    out[key] = idx >= 0 ? idx : null; if (idx >= 0) used.add(idx);
  }
  return out;
};

export const parseBankStatementGrid = (grid: unknown[][]): BankStatementParse => {
  let headerRow = -1; let cols: Record<string, number | null> = {};
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const c = detectColumns((grid[r] || []).map(x => String(x ?? '')));
    if (c.date != null && (c.debit != null || c.credit != null || c.amount != null)) { headerRow = r; cols = c; break; }
  }
  const header = headerRow >= 0 ? (grid[headerRow] || []).map(x => String(x ?? '').trim()) : [];
  const columns = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, i == null ? null : header[i] || null]));
  if (headerRow < 0) return { rows: [], skipped: [], columns, headerRow: null };
  const rows: BankStatementRow[] = []; const skipped: BankStatementParse['skipped'] = [];
  const at = (line: unknown[], k: string) => cols[k] == null ? '' : line[cols[k] as number];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const line = grid[r] || []; const no = r + 1;
    if (line.every(x => String(x ?? '').trim() === '')) continue;
    const text = line.map(norm).join(' ');
    if (/^(tổng|cộng|total|số dư đầu|số dư cuối|opening|closing)/.test(norm(at(line, 'date')) || norm(line[0])) || (/tổng cộng|total/.test(text) && !parseDate(at(line, 'date')))) continue;
    const date = parseDate(at(line, 'date'));
    let amount: number | null = null; let direction: 'in' | 'out' | null = null;
    const debit = parseNumber(at(line, 'debit')); const credit = parseNumber(at(line, 'credit'));
    if (credit && Math.abs(credit) > 0) { amount = Math.abs(credit); direction = 'in'; }
    else if (debit && Math.abs(debit) > 0) { amount = Math.abs(debit); direction = 'out'; }
    else {
      const a = parseNumber(at(line, 'amount')); const sign = norm(at(line, 'sign'));
      if (a) { amount = Math.abs(a); direction = /^(c|cr|có|ghi có|credit|\+)/.test(sign) ? 'in' : /^(d|dr|nợ|ghi nợ|debit|-)/.test(sign) ? 'out' : a < 0 ? 'out' : 'in'; }
    }
    if (!date) { if (amount) skipped.push({ row: no, reason: 'Không đọc được ngày' }); continue; }
    if (!amount || !direction) { skipped.push({ row: no, reason: 'Không có số tiền ghi nợ / ghi có' }); continue; }
    rows.push({ row: no, date, direction, amount: Math.round(amount * 100) / 100, description: String(at(line, 'description') ?? '').trim(),
      reference: String(at(line, 'reference') ?? '').trim() || null, counterparty: String(at(line, 'counterparty') ?? '').trim() || null, balance: parseNumber(at(line, 'balance')) });
  }
  return { rows, skipped, columns, headerRow: headerRow + 1 };
};

export const readBankStatementFile = async (data: ArrayBuffer): Promise<BankStatementParse> => {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true });
  let best: BankStatementParse | null = null;
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
    const p = parseBankStatementGrid(grid);
    if (!best || p.rows.length > best.rows.length) best = p;
  }
  return best || { rows: [], skipped: [], columns: {}, headerRow: null };
};
