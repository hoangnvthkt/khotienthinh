// Chốt chặn khi kho nhận hàng theo đơn mua: liệt kê mọi tình huống gõ/chọn sai có thể làm lệch kho, đơn, công nợ.
// Ca thật PO-272 (13/10/2026): ô thực nhận 21.000 bị trả về số phiếu 35.930, hộp xác nhận chung chung không hiện số → nhập thừa 14.930 kg.
// Nguyên tắc: trước khi ghi sổ luôn cho người nhận thấy đúng con số sẽ ghi; tình huống bất thường phải tích xác nhận.

export type ReceiptGuardLevel = 'block' | 'confirm' | 'warn' | 'info';

export interface ReceiptGuardIssue {
  level: ReceiptGuardLevel;
  code: string;
  text: string;
  lineIndex?: number;
}

export interface ReceiptGuardLine {
  name: string;
  unit: string;
  /** Số trên phiếu (đợt giao), đơn vị kho. */
  plannedQty: number;
  /** Thực nhận người dùng gõ, đơn vị kho (NaN = chưa nhập / nhập sai). */
  actualQty: number;
  /** Đơn vị mua trên mỗi đơn vị kho (1 khi cùng đơn vị). */
  purchasePerStock: number;
  purchaseUnit?: string | null;
  /** Tiến độ đơn (đơn vị mua) — thiếu khi chưa tải được, khi đó không cảnh báo theo đơn. */
  orderedQty?: number;
  receivedQty?: number;
  pendingOtherQty?: number;
  maxWithoutOver?: number;
  /** Phiếu nhập ngoài đơn cùng vật tư/kho/NCC. */
  outsideImports?: Array<{ code: string | null; date: string; qty: number }>;
}

export interface ReceiptGuardInput {
  lines: ReceiptGuardLine[];
  arrivalDate: string;
  today: string;
  documentDate?: string | null;
  poCreatedAt?: string | null;
  shortPlan: 'continue' | 'close' | null;
  nextDeliveryNo?: number | null;
  otherOpenBatches?: Array<{ deliveryNo: number; qty: number }>;
  /** Tiến độ đơn chưa tải được → nhắc người nhận kiểm tra tay. */
  contextUnavailable?: boolean;
}

export interface ReceiptGuardRow {
  index: number;
  name: string;
  unit: string;
  plannedQty: number;
  actualQty: number;
  diff: number;
  orderedQty: number | null;
  receivedBefore: number | null;
  receivedAfter: number | null;
  remainingAfter: number | null;
  purchaseUnit: string | null;
  actualPurchaseQty: number;
}

export interface ReceiptGuardResult {
  rows: ReceiptGuardRow[];
  issues: ReceiptGuardIssue[];
  blocked: boolean;
  /** Có tình huống bất thường cần tích "Tôi đã kiểm tra". */
  needsAck: boolean;
  /** Dòng nhận vượt phần đơn còn lại — gửi overConfirmed sau khi người dùng xác nhận. */
  overLineIndexes: number[];
  totalShort: number;
}

const EPS = 1e-6;
export const fmtQ = (value: number) => (Number.isFinite(value) ? value.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) : '—');
const viDay = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000);

export const evaluateReceiptGuards = (input: ReceiptGuardInput): ReceiptGuardResult => {
  const issues: ReceiptGuardIssue[] = [];
  const overLineIndexes: number[] = [];
  let totalShort = 0;
  let anyShort = false;

  const rows = input.lines.map((line, index): ReceiptGuardRow => {
    const label = input.lines.length > 1 ? `${line.name}: ` : '';
    const actual = line.actualQty;
    const planned = line.plannedQty;
    const valid = Number.isFinite(actual) && actual >= 0;
    const factor = line.purchasePerStock > 0 ? line.purchasePerStock : 1;
    const actualPurchase = valid ? actual * factor : Number.NaN;
    const hasPo = line.orderedQty !== undefined && line.receivedQty !== undefined;
    const receivedAfter = hasPo && valid ? (line.receivedQty || 0) + actualPurchase : null;
    const remainingAfter = hasPo && receivedAfter !== null ? (line.orderedQty || 0) - receivedAfter : null;

    if (!valid) {
      issues.push({ level: 'block', code: 'qty_missing', lineIndex: index, text: `${label}Chưa có số thực nhận hợp lệ.` });
    } else {
      const diff = actual - planned;
      if (Math.abs(diff) <= EPS) {
        issues.push({ level: 'info', code: 'full', lineIndex: index, text: `${label}Nhận đủ ${fmtQ(actual)} ${line.unit} — đúng bằng số trên phiếu. Chỉ đồng ý nếu đã cân/đếm đủ.` });
      } else if (actual <= EPS) {
        anyShort = true; totalShort += planned;
        issues.push({ level: 'warn', code: 'zero', lineIndex: index, text: `${label}Không nhận gì (0 ${line.unit}) — cả ${fmtQ(planned)} ${line.unit} tính là thiếu.` });
      } else if (diff < 0) {
        anyShort = true; totalShort += -diff;
        if (actual * 10 <= planned) {
          issues.push({ level: 'confirm', code: 'tiny', lineIndex: index, text: `${label}Chỉ nhận ${fmtQ(actual)} / ${fmtQ(planned)} ${line.unit} (${Math.round((actual / planned) * 100)}%). Kiểm tra có gõ thiếu chữ số 0 hoặc nhầm dấu phẩy.` });
        }
      } else {
        issues.push({ level: 'warn', code: 'over_batch', lineIndex: index, text: `${label}Dư ${fmtQ(diff)} ${line.unit} so với số trên phiếu.` });
        if (planned > 0 && actual >= planned * 10) {
          issues.push({ level: 'confirm', code: 'huge', lineIndex: index, text: `${label}Nhận gấp ${Math.round(actual / planned)} lần số trên phiếu — kiểm tra có gõ thừa chữ số 0.` });
        }
      }
      if (hasPo && line.maxWithoutOver !== undefined && actualPurchase > line.maxWithoutOver + EPS) {
        overLineIndexes.push(index);
        const pu = line.purchaseUnit || line.unit;
        issues.push({ level: 'confirm', code: 'over_po', lineIndex: index,
          text: `${label}Vượt đơn: nhận ${fmtQ(actualPurchase)} ${pu}, đơn chỉ còn ${fmtQ(Math.max(line.maxWithoutOver, 0))} ${pu} (đặt ${fmtQ(line.orderedQty || 0)}, đã nhận ${fmtQ(line.receivedQty || 0)}${line.pendingOtherQty ? `, đợt khác đang mở ${fmtQ(line.pendingOtherQty)}` : ''}). Chỉ xác nhận khi NCC giao dư thật.` });
      }
    }
    for (const outside of line.outsideImports || []) {
      issues.push({ level: 'confirm', code: 'outside_import', lineIndex: index,
        text: `${label}Kho đã có phiếu nhập ngoài đơn ${outside.code || ''} ngày ${viDay(outside.date)}: ${fmtQ(outside.qty)} ${line.unit} cùng vật tư. Nếu là hàng của đơn này thì đơn đang tính thiếu — báo Mua hàng gắn vào đơn, đừng nhận trùng.`.replace('  ', ' ') });
    }
    return {
      index, name: line.name, unit: line.unit, plannedQty: planned, actualQty: actual, diff: valid ? actual - planned : Number.NaN,
      orderedQty: hasPo ? line.orderedQty ?? null : null, receivedBefore: hasPo ? line.receivedQty ?? null : null,
      receivedAfter, remainingAfter, purchaseUnit: line.purchaseUnit || null, actualPurchaseQty: actualPurchase,
    };
  });

  if (anyShort) {
    if (!input.shortPlan) {
      issues.push({ level: 'block', code: 'short_plan', text: 'Nhận thiếu: chọn "NCC giao tiếp phần còn lại" hay "Chốt thiếu — báo Mua hàng".' });
    } else if (input.shortPlan === 'continue') {
      issues.push({ level: 'info', code: 'short_continue', text: `Phần thiếu ${fmtQ(totalShort)}: mở ${input.nextDeliveryNo ? `đợt giao ${input.nextDeliveryNo}` : 'đợt giao kế tiếp'} chờ NCC giao.` });
    } else {
      issues.push({ level: 'info', code: 'short_close', text: `Phần thiếu ${fmtQ(totalShort)}: đơn dừng ở Về một phần, Mua hàng kết thúc thiếu hoặc lập đợt bù.` });
    }
  }

  if (!input.arrivalDate) {
    issues.push({ level: 'block', code: 'date_missing', text: 'Chọn ngày hàng về thực tế.' });
  } else if (input.arrivalDate > input.today) {
    issues.push({ level: 'block', code: 'date_future', text: 'Ngày hàng về không được sau hôm nay.' });
  } else {
    if (input.poCreatedAt && input.arrivalDate < input.poCreatedAt.slice(0, 10)) {
      issues.push({ level: 'warn', code: 'date_before_po', text: `Ngày hàng về ${viDay(input.arrivalDate)} trước ngày lập đơn ${viDay(input.poCreatedAt)}.` });
    }
    const back = daysBetween(input.arrivalDate, input.today);
    if (back > 7) issues.push({ level: 'warn', code: 'date_backdated', text: `Ghi lùi ${back} ngày (${viDay(input.arrivalDate)}): sổ kho, công nợ, kỳ đối soát ghi theo ngày này.` });
  }

  for (const batch of input.otherOpenBatches || []) {
    issues.push({ level: 'info', code: 'other_batch', text: `Đơn còn đợt giao ${batch.deliveryNo} đang chờ nhận ${fmtQ(batch.qty)} — kiểm tra đúng xe hàng của đợt này.` });
  }
  if (input.contextUnavailable) {
    issues.push({ level: 'warn', code: 'context_missing', text: 'Chưa tải được tiến độ đơn — tự đối chiếu số đã nhận trước khi đồng ý.' });
  }

  const order: Record<ReceiptGuardLevel, number> = { block: 0, confirm: 1, warn: 2, info: 3 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return {
    rows, issues, overLineIndexes, totalShort,
    blocked: issues.some(issue => issue.level === 'block'),
    needsAck: issues.some(issue => issue.level === 'confirm'),
  };
};
