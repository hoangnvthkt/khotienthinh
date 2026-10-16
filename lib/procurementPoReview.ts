// Tóm tắt trước khi duyệt Đơn mua (lộ trình AI A1; chủ SP chốt 16/10/2026: Đơn mua trước, quy tắc + một câu AI).
// Máy chủ (get_procurement_po_review_v1) trả số liệu so sánh; tệp này dựng các dòng "cần xem" / "ổn" / "chưa rõ" và dòng sự kiện gửi AI.
// AI chỉ viết một câu từ đúng các dòng này (skill po_review_brief) — không thêm số, không khuyên duyệt hay không.
import { supabase } from './supabase';

export interface PoReviewRef { poId: string; poNumber: string | null }
export interface PoReviewLine {
  lineId: string; itemId: string; name: string | null; specification: string | null; unit: string | null; qty: number; price: number;
  boq: 'within' | 'over' | 'outside' | 'stock' | null;
  last: (PoReviewRef & { date: string | null; price: number }) | null;
  cheaper: (PoReviewRef & { vendorName: string | null; date: string | null; price: number }) | null;
  contract: { contractId: string; code: string | null; price: number } | null;
  duplicates: Array<PoReviewRef & { status: string; qty: number; unit: string | null }>;
  excessReason: string | null;
}
export interface PoReviewData {
  poId: string; poNumber: string | null; status: string; vendorId: string | null; vendorName: string | null; createdAt: string;
  lines: PoReviewLine[];
  /** null = đơn không gắn một dự án (không xét dự toán). check null = dự án chưa có dự toán vật tư. */
  budget: {
    check: { over: boolean; budget: number; projected: number } | null;
    approval: { status: 'pending' | 'approved' | 'rejected'; approverNames?: string[]; decidedByName?: string } | null;
  } | null;
  vendor: { orders: number; received: number; short: number } | null;
  captures: Array<{ id: string; docNo: string | null; docDate: string | null; createdAt: string; warehouseName: string | null }>;
}

export type PoReviewLevel = 'warn' | 'info';
export interface PoReviewItem { key: string; level: PoReviewLevel; text: string; href?: string }
export interface PoReview {
  needs: PoReviewItem[];
  ok: PoReviewItem[];
  /** Chưa đủ dữ liệu để kết luận (VD dự án chưa có dự toán vật tư) — không hiện như "ổn". */
  unknown: PoReviewItem[];
}

/** Giá lệch quá ngưỡng này (%) so với lần trước / NCC khác thì báo (doc audit mục 4.1: báo cam khi lệch quá 5%). */
export const PRICE_ALERT_PCT = 5;
const STATUS_LABELS: Record<string, string> = {
  draft: 'nháp', sent: 'chờ duyệt', confirmed: 'đã duyệt', in_transit: 'đang giao', partial: 'giao một phần',
};

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
const money = (v: number) => nf.format(Math.round(v));
const qty = (v: number) => nf.format(v);
/** Tiền lớn gọn: 4,39 tỷ · 186,4 tr — dòng dự toán đọc nhanh. */
const short = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(v / 1e9)} tỷ`;
  if (a >= 1e6) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(v / 1e6)} tr`;
  return `${money(v)} đ`;
};
const pct = (v: number) => `${nf.format(Math.round(Math.abs(v)))}%`;
const dateVi = (iso: string | null | undefined) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : '';
};
const lineName = (l: PoReviewLine) => [l.name || 'Vật tư', l.specification].filter(Boolean).join(' ');
export const poHref = (poId: string) => `#/procurement?po=${encodeURIComponent(poId)}`;
const delta = (price: number, base: number) => (base > 0 ? ((price - base) / base) * 100 : 0);

export const buildPoReview = (data: PoReviewData, extra: { overBoqReason?: string | null } = {}): PoReview => {
  const warn: PoReviewItem[] = []; const info: PoReviewItem[] = []; const ok: PoReviewItem[] = []; const unknown: PoReviewItem[] = [];
  const priced = data.lines.filter(l => l.price > 0);

  // Hàng đã về trước khi lập đơn (ca PO-618: đơn lập sau khi Kho đã nhận).
  for (const c of data.captures) {
    warn.push({ key: `cap:${c.id}`, level: 'warn', text: `Hàng đã về trước: Kho chụp phiếu giao của NCC này${c.docDate ? ` ngày ${dateVi(c.docDate)}` : ''}${c.warehouseName ? ` (${c.warehouseName})` : ''}, chưa gắn đơn` });
  }
  for (const l of data.lines) {
    for (const d of l.duplicates.slice(0, 1)) {
      warn.push({ key: `dup:${l.lineId}`, level: 'warn', href: poHref(d.poId),
        text: `Có thể trùng ${d.poNumber || 'đơn khác'} (${STATUS_LABELS[d.status] || d.status}): cùng ${lineName(l)}, ${qty(d.qty)} ${d.unit || l.unit || ''}`.trim() });
    }
  }
  // Ngân sách: vượt dự toán (chờ / đã duyệt / bị từ chối), trong dự toán, hoặc dự án chưa có dự toán.
  if (data.budget) {
    const c = data.budget.check; const a = data.budget.approval;
    const used = c && c.budget > 0 ? (c.projected / c.budget) * 100 : 0;
    const usedText = c ? `sau đơn dùng ${pct(used)} (${short(c.projected)} / ${short(c.budget)})` : '';
    // Duyệt vượt ngân sách đang chờ thì người duyệt đơn chưa duyệt được — báo kể cả khi dự toán hiện tại đã đủ.
    if (a?.status === 'pending') warn.push({ key: 'budget', level: 'warn', text: `Chờ duyệt vượt dự toán vật tư${usedText ? `: ${usedText}` : ''} — ${(a.approverNames || []).join(', ') || 'người duyệt vượt ngân sách'} duyệt ở Tài chính trước` });
    else if (a?.status === 'rejected') warn.push({ key: 'budget', level: 'warn', text: `Bị từ chối vượt dự toán vật tư${usedText ? `: ${usedText}` : ''}` });
    else if (!c) unknown.push({ key: 'budget', level: 'info', text: 'Dự án chưa có dự toán vật tư' });
    else if (c.over && a?.status === 'approved') info.push({ key: 'budget', level: 'info', text: `Đã duyệt vượt dự toán${a.decidedByName ? ` (${a.decidedByName})` : ''}: sau đơn dùng ${pct(used)} dự toán vật tư` });
    else if (c.over) warn.push({ key: 'budget', level: 'warn', text: `Vượt dự toán vật tư: ${usedText}` });
    else ok.push({ key: 'budget', level: 'info', text: `Trong dự toán (${pct(used)})` });
  }
  // Giá: HĐ nguyên tắc trước, rồi lần trước cùng NCC, rồi NCC khác rẻ hơn.
  let samePrice = 0; let cheaperThanLast = 0; let onContract = 0;
  for (const l of priced) {
    if (l.contract && l.contract.price > 0) {
      const d = delta(l.price, l.contract.price);
      if (d > 0.5) warn.push({ key: `hd:${l.lineId}`, level: 'warn', text: `${lineName(l)}: ${money(l.price)} đ/${l.unit || ''}, cao hơn giá HĐ ${l.contract.code || ''} ${pct(d)} (${money(l.contract.price)} đ)`.replace(/ {2,}/g, ' ') });
      else onContract += 1;
    }
    if (l.last && l.last.price > 0 && !(l.contract && delta(l.price, l.contract.price) > 0.5)) {
      const d = delta(l.price, l.last.price);
      if (d > PRICE_ALERT_PCT) {
        warn.push({ key: `gia:${l.lineId}`, level: 'warn', href: poHref(l.last.poId),
          text: `${lineName(l)}: ${money(l.price)} đ/${l.unit || ''}, cao hơn lần trước ${pct(d)} (${l.last.poNumber || 'đơn trước'}${l.last.date ? ` ${dateVi(l.last.date)}` : ''}, ${money(l.last.price)} đ)${d >= 100 ? ' — kiểm lại đơn giá' : ''}` });
      } else if (d < -PRICE_ALERT_PCT) cheaperThanLast += 1;
      else samePrice += 1;
    }
    if (l.cheaper && l.cheaper.price > 0) {
      const d = delta(l.price, l.cheaper.price);
      if (d > PRICE_ALERT_PCT) info.push({ key: `ncc:${l.lineId}`, level: 'info', href: poHref(l.cheaper.poId),
        text: `${lineName(l)}: ${l.cheaper.vendorName || 'NCC khác'} bán ${money(l.cheaper.price)} đ (${l.cheaper.poNumber || 'đơn khác'}${l.cheaper.date ? ` ${dateVi(l.cheaper.date)}` : ''}), rẻ hơn ${pct(d)}` });
    }
  }
  if (onContract) ok.push({ key: 'hd', level: 'info', text: onContract === priced.length ? 'Đúng giá HĐ' : `${onContract} dòng đúng giá HĐ` });
  if (samePrice) ok.push({ key: 'gia', level: 'info', text: samePrice === priced.length ? 'Giá như lần trước' : `${samePrice} dòng giá như lần trước` });
  if (cheaperThanLast) ok.push({ key: 'gia-re', level: 'info', text: `${cheaperThanLast} dòng rẻ hơn lần trước` });
  // BOQ (đơn chủ động) và đặt vượt nhu cầu (đơn theo phiếu nhu cầu).
  const over = data.lines.filter(l => l.boq === 'over'); const outside = data.lines.filter(l => l.boq === 'outside');
  const reason = extra.overBoqReason?.trim();
  if (over.length) warn.push({ key: 'boq-vuot', level: 'warn', text: `${over.length === 1 ? lineName(over[0]) : `${over.length} dòng`} vượt BOQ${reason ? ` — ${reason}` : ''}` });
  if (outside.length) info.push({ key: 'boq-ngoai', level: 'info', text: `${outside.length === data.lines.length ? 'Cả đơn' : outside.length === 1 ? lineName(outside[0]) : `${outside.length}/${data.lines.length} dòng`} ngoài BOQ${reason && !over.length ? ` — ${reason}` : ''}` });
  if (!over.length && !outside.length && data.lines.some(l => l.boq === 'within')) ok.push({ key: 'boq', level: 'info', text: 'Trong BOQ' });
  for (const l of data.lines) {
    if (l.excessReason) warn.push({ key: `vuot:${l.lineId}`, level: 'warn', text: `${lineName(l)}: đặt vượt nhu cầu — ${l.excessReason}` });
  }
  // NCC: mới, hay giao thiếu, hoặc quen.
  if (data.vendor && data.vendorId) {
    const v = data.vendor;
    if (v.orders === 0) info.push({ key: 'ncc-moi', level: 'info', text: 'NCC mới: chưa có đơn nào trong 12 tháng' });
    if (v.short >= 2) info.push({ key: 'ncc-thieu', level: 'info', text: `NCC giao thiếu ${v.short}/${v.received} lần nhận trong 6 tháng` });
    if (v.orders > 0 && v.short < 2) ok.push({ key: 'ncc', level: 'info', text: `NCC đã mua ${v.orders} đơn` });
  }
  return { needs: [...warn, ...info], ok, unknown };
};

/** Dòng gửi AI: "khóa | mức · nội dung" — đúng các dòng trên màn, không thêm dữ liệu. */
export const poReviewFacts = (review: PoReview, head: { poNumber: string | null; vendorName: string | null; total: number }) => [
  `don | Đơn ${head.poNumber || ''} · ${head.vendorName || 'chưa chọn NCC'} · ${money(head.total)} đ`,
  ...review.needs.map(n => `${n.key} | ${n.level === 'warn' ? 'Cần xem' : 'Lưu ý'} · ${n.text}`),
  ...review.ok.map(n => `${n.key} | Ổn · ${n.text}`),
  ...review.unknown.map(n => `${n.key} | Chưa rõ · ${n.text}`),
].join('\n');

const asNum = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
/** Chuẩn hóa JSON từ RPC (số có thể là chuỗi numeric). */
export const normalizePoReview = (raw: unknown): PoReviewData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const ref = (x: any) => (x && typeof x === 'object' ? { ...x, price: asNum(x.price) } : null);
  return {
    poId: String(r.poId), poNumber: r.poNumber ?? null, status: String(r.status || ''), vendorId: r.vendorId ?? null, vendorName: r.vendorName ?? null,
    createdAt: String(r.createdAt || ''),
    lines: (Array.isArray(r.lines) ? r.lines : []).map((l: any) => ({
      lineId: String(l.lineId), itemId: String(l.itemId), name: l.name ?? null, specification: l.specification ?? null, unit: l.unit ?? null,
      qty: asNum(l.qty), price: asNum(l.price), boq: l.boq ?? null, last: ref(l.last), cheaper: ref(l.cheaper), contract: ref(l.contract),
      duplicates: (Array.isArray(l.duplicates) ? l.duplicates : []).map((d: any) => ({ ...d, qty: asNum(d.qty) })),
      excessReason: l.excessReason ?? null,
    })),
    budget: r.budget ? {
      check: r.budget.check ? { over: Boolean(r.budget.check.over), budget: asNum(r.budget.check.budget), projected: asNum(r.budget.check.projected) } : null,
      approval: r.budget.approval && typeof r.budget.approval === 'object' ? r.budget.approval : null,
    } : null,
    vendor: r.vendor ? { orders: asNum(r.vendor.orders), received: asNum(r.vendor.received), short: asNum(r.vendor.short) } : null,
    captures: Array.isArray(r.captures) ? r.captures : [],
  };
};

export const poReviewService = {
  async get(poId: string): Promise<PoReviewData | null> {
    const { data, error } = await supabase.rpc('get_procurement_po_review_v1', { p_po_id: poId });
    if (error) throw error;
    return normalizePoReview(data);
  },
};
