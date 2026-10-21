// Trợ lý · báo cáo đợt A1 (chủ SP 20/10/2026: ưu tiên báo cáo / biểu đồ): công cụ bao_cao gọi 3 RPC tổng hợp (security invoker → số theo
// đúng quyền xem của người hỏi) rồi dựng thẻ biểu đồ dùng chung (lib/assistantChart.ts: cột, cột chồng, đường, tròn) + số gọn cho model.
// Tệp này không dùng API Deno để vitest kiểm thử được.

export type ReportKind = 'phieu_quy_trinh' | 'kho_nhap_xuat' | 'don_mua';
export const REPORT_KINDS: ReportKind[] = ['phieu_quy_trinh', 'kho_nhap_xuat', 'don_mua'];
export type ReportGroup = 'week' | 'month';
export interface ReportRange { from: string; to: string; group: ReportGroup }

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const isoDay = (v: unknown): string | null => { const m = DAY.exec(String(v ?? '').trim()); return m && !Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}`)) ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const viDay = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Tiền → triệu đồng, 1 số lẻ (số chưa có → null). */
export const million = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n / 1e5) / 10; };
const roundQty = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n * 100) / 100; };
const sum = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

/**
 * Khoảng báo cáo từ lời người dùng: tu_ngay / den_ngay (YYYY-MM-DD); bỏ trống = 3 tháng gần nhất tới hôm nay.
 * nhom_theo "tuan" | "thang"; bỏ trống → ≤ 70 ngày theo tuần, dài hơn theo tháng. Tối đa 400 ngày, không ở tương lai.
 */
export const reportRange = (args: Record<string, unknown>, today: string): ReportRange | { loi: string } => {
  const to = args.den_ngay ? isoDay(args.den_ngay) : today;
  if (!to) return { loi: 'Ngày kết thúc chưa đúng (YYYY-MM-DD). Hỏi lại người dùng khoảng thời gian.' };
  const toClamped = to > today ? today : to;
  let from: string | null;
  if (args.tu_ngay) from = isoDay(args.tu_ngay);
  else { const d = new Date(Date.parse(toClamped)); from = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; from = addDays(from, 0); const m = new Date(Date.parse(from)); m.setUTCMonth(m.getUTCMonth() - 2); from = m.toISOString().slice(0, 10); }
  if (!from) return { loi: 'Ngày bắt đầu chưa đúng (YYYY-MM-DD). Hỏi lại người dùng.' };
  if (from > toClamped) return { loi: from > today ? 'Khoảng thời gian ở tương lai — chưa có số. Nói rõ với người dùng.' : 'Ngày bắt đầu sau ngày kết thúc. Hỏi lại người dùng.' };
  if (daysBetween(from, toClamped) > 400) return { loi: 'Tối đa 13 tháng mỗi lần. Hỏi lại người dùng khoảng ngắn hơn.' };
  const asked = text(args.nhom_theo).toLowerCase();
  const group: ReportGroup = asked.startsWith('tu') ? 'week' : asked.startsWith('th') ? 'month' : daysBetween(from, toClamped) <= 70 ? 'week' : 'month';
  return { from, to: toClamped, group };
};

/** Nhãn kỳ: tuần → "20/10" (ngày đầu tuần); tháng → "T10" hoặc "T10/26" khi nhiều năm. */
export const bucketLabels = (starts: string[], group: ReportGroup): string[] => {
  const years = new Set(starts.map(s => s.slice(0, 4)));
  return starts.map(s => (group === 'week' ? shortDay(s) : years.size > 1 ? `T${Number(s.slice(5, 7))}/${s.slice(2, 4)}` : `T${Number(s.slice(5, 7))}`));
};
const spanText = (r: ReportRange) => `${viDay(r.from)} – ${viDay(r.to)}`;
const groupText = (g: ReportGroup) => (g === 'week' ? 'tuần' : 'tháng');

export interface BuiltReport { chart: Record<string, unknown>; forModel: Record<string, unknown> }
const WF_STATUS: Record<string, string> = { RUNNING: 'Đang xử lý', COMPLETED: 'Hoàn thành', REJECTED: 'Trả lại / từ chối', CANCELLED: 'Đã hủy', DRAFT: 'Nháp' };

/** assistant_report_workflow_v1 → thẻ: tạo mới / hoàn thành / trả lại theo kỳ + tròn theo mẫu. */
export const workflowReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const buckets = asArray(d.buckets).map(asObject);
  if (!buckets.length) return null;
  const starts = buckets.map(b => isoDay(b.start) || r.from);
  const labels = bucketLabels(starts, r.group);
  const created = buckets.map(b => num(b.created) ?? 0); const completed = buckets.map(b => num(b.completed) ?? 0); const returned = buckets.map(b => num(b.returned) ?? 0);
  const byTemplate = asArray(d.byTemplate).map(asObject).map(t => ({ name: text(t.name, 40) || 'Mẫu khác', count: num(t.count) ?? 0 })).filter(t => t.count > 0);
  const byStatus = Object.entries(asObject(d.byStatus)).map(([k, v]) => ({ status: WF_STATUS[k] || k, count: num(v) ?? 0 }));
  const total = num(d.total) ?? sum(created);
  const chart = {
    v: 1, title: `Phiếu quy trình ${spanText(r)}`,
    stats: [
      { label: 'Tạo mới', value: total, hint: `theo ${groupText(r.group)}` },
      { label: 'Hoàn thành', value: sum(completed), hint: 'theo ngày cập nhật cuối' },
      { label: 'Trả lại / hủy', value: sum(returned), hint: null },
      { label: 'Đang xử lý', value: num(d.runningNow), hint: (num(d.runningStale) ?? 0) > 0 ? `${num(d.runningStale)} phiếu quá 7 ngày chưa động` : 'hiện tại' },
    ],
    labels,
    panels: [
      { title: `Phiếu theo ${groupText(r.group)}`, kind: 'bar', unit: 'phiếu', series: [{ label: 'Tạo mới', values: created }, { label: 'Hoàn thành', values: completed }, { label: 'Trả lại / hủy', values: returned }] },
      ...(byTemplate.length ? [{ title: 'Theo mẫu quy trình', kind: 'donut', unit: 'phiếu', labels: byTemplate.map(t => t.name), series: [{ label: 'Phiếu', values: byTemplate.map(t => t.count) }] }] : []),
    ],
    notes: ['Chỉ tính phiếu trong phạm vi người hỏi được xem. "Hoàn thành" và "Trả lại" tính theo ngày cập nhật cuối của phiếu.'],
    source: 'Quy trình · phiếu theo ngày tạo', link: { route: '/wf', label: 'Mở Quy trình' },
  };
  return { chart, forModel: {
    khoang: `${r.from} → ${r.to}`, nhom_theo: groupText(r.group), tong_tao_moi: total, hoan_thanh: sum(completed), tra_lai_huy: sum(returned),
    dang_xu_ly_hien_tai: num(d.runningNow), qua_7_ngay_chua_dong: num(d.runningStale),
    theo_ky: labels.map((l, i) => ({ ky: l, tao_moi: created[i], hoan_thanh: completed[i], tra_lai: returned[i] })),
    theo_mau: byTemplate, theo_trang_thai: byStatus,
  } };
};

/** assistant_report_inventory_v1 → thẻ: có vật tư → số lượng nhập / xuất + tồn hiện tại; không → giá trị nhập / xuất (triệu đ) + tròn vật tư xuất nhiều. */
export const inventoryReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const buckets = asArray(d.buckets).map(asObject);
  if (!buckets.length) return null;
  const starts = buckets.map(b => isoDay(b.start) || r.from);
  const labels = bucketLabels(starts, r.group);
  const item = d.item ? asObject(d.item) : null;
  const warehouses = asArray(d.warehouses).map(w => text(w, 60)).filter(Boolean);
  const where = warehouses.length === 1 ? warehouses[0] : warehouses.length ? `${warehouses.length} kho` : 'kho được xem';
  if (item) {
    const unit = text(item.unit, 20) || 'đv';
    const inQ = buckets.map(b => roundQty(b.inQty) ?? 0); const outQ = buckets.map(b => roundQty(b.outQty) ?? 0);
    const stock = asArray(d.stockNow).map(asObject).map(s => ({ kho: text(s.warehouse, 60), ton: roundQty(s.qty) }));
    const chart = {
      v: 1, title: `${text(item.name, 60)} · nhập xuất ${spanText(r)}`,
      stats: [
        { label: 'Nhập', value: roundQty(d.totalIn), hint: unit }, { label: 'Xuất', value: roundQty(d.totalOut), hint: unit },
        { label: 'Tồn hiện tại', value: stock.length ? sum(stock.map(s => s.ton)) : null, hint: stock.length ? `${unit} · ${where}` : 'chưa có sổ kho' },
        { label: 'Số kho', value: warehouses.length || null, hint: where },
      ],
      labels,
      panels: [{ title: `Nhập và xuất theo ${groupText(r.group)}`, kind: 'bar', unit, series: [{ label: 'Nhập', values: inQ }, { label: 'Xuất', values: outQ }] }],
      notes: ['Số từ sổ kho đã ghi sổ, chỉ các kho người hỏi được xem.'],
      source: `Sổ kho · ${text(item.sku, 30)} ${text(item.name, 60)}`, link: { route: '/reports', label: 'Thẻ kho / Báo cáo NXT' },
    };
    return { chart, forModel: { vat_tu: `${text(item.sku, 30)} ${text(item.name, 80)}`, don_vi: unit, kho: warehouses, khoang: `${r.from} → ${r.to}`, tong_nhap: roundQty(d.totalIn), tong_xuat: roundQty(d.totalOut), ton_hien_tai_theo_kho: stock,
      theo_ky: labels.map((l, i) => ({ ky: l, nhap: inQ[i], xuat: outQ[i] })) } };
  }
  const inA = buckets.map(b => million(b.inAmount) ?? 0); const outA = buckets.map(b => million(b.outAmount) ?? 0);
  const docsIn = buckets.map(b => num(b.docsIn) ?? 0); const docsOut = buckets.map(b => num(b.docsOut) ?? 0);
  const top = asArray(d.topOut).map(asObject).map(t => ({ name: text(t.name, 40), amount: million(t.amount) ?? 0, qty: roundQty(t.qty), unit: text(t.unit, 12) })).filter(t => t.amount > 0);
  const chart = {
    v: 1, title: `Nhập xuất kho ${spanText(r)}`,
    stats: [
      { label: 'Giá trị nhập', value: million(d.totalInAmount), hint: 'triệu đ' }, { label: 'Giá trị xuất', value: million(d.totalOutAmount), hint: 'triệu đ' },
      { label: 'Phiếu nhập', value: sum(docsIn), hint: null }, { label: 'Phiếu xuất', value: sum(docsOut), hint: where },
    ],
    labels,
    panels: [
      { title: `Giá trị nhập và xuất theo ${groupText(r.group)}`, kind: 'bar', unit: 'triệu đ', series: [{ label: 'Nhập', values: inA }, { label: 'Xuất', values: outA }] },
      ...(top.length ? [{ title: 'Vật tư xuất nhiều nhất (giá trị)', kind: 'donut', unit: 'triệu đ', labels: top.map(t => t.name), series: [{ label: 'Giá trị xuất', values: top.map(t => t.amount) }] }] : []),
    ],
    notes: ['Giá trị theo đơn giá trên sổ kho; chỉ các kho người hỏi được xem. Muốn số lượng một vật tư thì hỏi kèm tên vật tư.'],
    source: 'Sổ kho đã ghi sổ', link: { route: '/reports', label: 'Báo cáo nhập xuất tồn' },
  };
  return { chart, forModel: { kho: warehouses, khoang: `${r.from} → ${r.to}`, gia_tri_nhap_trieu: million(d.totalInAmount), gia_tri_xuat_trieu: million(d.totalOutAmount), so_phieu_nhap: sum(docsIn), so_phieu_xuat: sum(docsOut),
    theo_ky: labels.map((l, i) => ({ ky: l, nhap_trieu: inA[i], xuat_trieu: outA[i], phieu_nhap: docsIn[i], phieu_xuat: docsOut[i] })), vat_tu_xuat_nhieu: top } };
};

const PO_STATUS: Record<string, string> = { sent: 'Chờ duyệt', confirmed: 'Đã duyệt', in_transit: 'Đang giao', partial: 'Giao một phần', delivered: 'Đã giao', returned: 'Trả lại', draft: 'Nháp' };

/** assistant_report_procurement_v1 → thẻ: giá trị đơn theo kỳ + tròn theo NCC + tròn theo dự án. */
export const procurementReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const buckets = asArray(d.buckets).map(asObject);
  if (!buckets.length) return null;
  const starts = buckets.map(b => isoDay(b.start) || r.from);
  const labels = bucketLabels(starts, r.group);
  const amounts = buckets.map(b => million(b.amount) ?? 0); const counts = buckets.map(b => num(b.count) ?? 0);
  const vendors = asArray(d.byVendor).map(asObject).map(v => ({ name: text(v.name, 40), count: num(v.count) ?? 0, amount: million(v.amount) ?? 0 })).filter(v => v.amount > 0);
  const projects = asArray(d.byProject).map(asObject).map(p => ({ name: text(p.name, 40), count: num(p.count) ?? 0, amount: million(p.amount) ?? 0 })).filter(p => p.amount > 0);
  const byStatus = Object.entries(asObject(d.byStatus)).map(([k, v]) => ({ trang_thai: PO_STATUS[k] || k, so_don: num(v) ?? 0 }));
  const chart = {
    v: 1, title: `Đơn mua hàng ${spanText(r)}`,
    stats: [
      { label: 'Số đơn', value: num(d.total), hint: 'không tính nháp' }, { label: 'Tổng giá trị', value: million(d.totalAmount), hint: 'triệu đ' },
      { label: 'Nhà cung cấp', value: vendors.length || null, hint: vendors[0] ? `lớn nhất: ${vendors[0].name}` : null }, { label: 'Dự án', value: projects.length || null, hint: projects[0] ? `lớn nhất: ${projects[0].name}` : null },
    ],
    labels,
    panels: [
      { title: `Giá trị đơn theo ${groupText(r.group)}`, kind: 'bar', unit: 'triệu đ', series: [{ label: 'Giá trị đơn', values: amounts }] },
      ...(vendors.length ? [{ title: 'Theo nhà cung cấp', kind: 'donut', unit: 'triệu đ', labels: vendors.map(v => v.name), series: [{ label: 'Giá trị', values: vendors.map(v => v.amount) }] }] : []),
      ...(projects.length > 1 ? [{ title: 'Theo dự án', kind: 'donut', unit: 'triệu đ', labels: projects.map(p => p.name), series: [{ label: 'Giá trị', values: projects.map(p => p.amount) }] }] : []),
    ],
    notes: ['Giá trị theo tổng tiền trên đơn (chưa phải số đã giao / đã trả); chỉ đơn người hỏi được xem.'],
    source: 'Mua hàng · đơn theo ngày đặt', link: { route: '/procurement?mode=orders', label: 'Mở Mua hàng' },
  };
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, so_don: num(d.total), tong_gia_tri_trieu: million(d.totalAmount),
    theo_ky: labels.map((l, i) => ({ ky: l, so_don: counts[i], gia_tri_trieu: amounts[i] })), theo_ncc: vendors, theo_du_an: projects, theo_trang_thai: byStatus } };
};
