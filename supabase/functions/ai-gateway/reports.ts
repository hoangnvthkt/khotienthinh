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

// ── Đợt A2 (chủ SP 22/10/2026): tiến độ dự án, tài chính, chấm công, nghỉ phép, yêu cầu, đặt xe, văn bản ─────────────────
export const REPORT_KINDS_A2 = ['tien_do_du_an', 'tai_chinh', 'cham_cong', 'nghi_phep', 'yeu_cau', 'dat_xe', 'van_ban'] as const;
export type ReportKindA2 = typeof REPORT_KINDS_A2[number];
const pct = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n * 10) / 10; };
const countsOf = (buckets: Record<string, unknown>[], key: string) => buckets.map(b => num(b[key]) ?? 0);
const bucketsOf = (d: Record<string, unknown>, r: ReportRange) => {
  const buckets = asArray(d.buckets).map(asObject);
  return { buckets, labels: bucketLabels(buckets.map(b => isoDay(b.start) || r.from), r.group) };
};
const namedCounts = (raw: unknown, nameKey: string, valueKey: string, fallback = 'Khác') =>
  asArray(raw).map(asObject).map(x => ({ name: text(x[nameKey], 40) || fallback, value: num(x[valueKey]) ?? 0 })).filter(x => x.value > 0);
const donut = (title: string, unit: string, rows: Array<{ name: string; value: number }>, label = 'Số') =>
  (rows.length ? [{ title, kind: 'donut', unit, labels: rows.map(x => x.name), series: [{ label, values: rows.map(x => x.value) }] }] : []);

const DELAY_CATEGORY: Record<string, string> = { weather: 'Thời tiết', material: 'Vật tư', labor: 'Nhân công', design: 'Thiết kế', owner: 'Chủ đầu tư', equipment: 'Máy móc', safety: 'An toàn', other: 'Khác', khac: 'Khác' };
/** assistant_report_progress_v1 → thẻ: % cuối kỳ (đường), nhật ký duyệt / hạng mục cập nhật theo kỳ, tròn lý do chậm; danh sách hạng mục chậm cho model. */
export const progressReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const project = asObject(d.project);
  const { buckets, labels } = bucketsOf(d, r);
  if (!project.id || !buckets.length) return null;
  const now = asObject(d.now);
  const progressEnd = buckets.map(b => pct(b.progressEnd));
  const logsVerified = countsOf(buckets, 'logsVerified'); const logs = countsOf(buckets, 'logs'); const tasksUpdated = countsOf(buckets, 'tasksUpdated');
  const late = asArray(d.lateTasks).map(asObject).map(t => ({ hang_muc: text(t.name, 80), het_han_kh: isoDay(t.end), tien_do: num(t.progress) ?? 0, cham_ngay: num(t.days) ?? 0, ly_do: text(t.reason, 80) || null }));
  const delays = asArray(d.delays).map(asObject).map(x => ({ name: DELAY_CATEGORY[text(x.category, 30)] || text(x.category, 30) || 'Khác', value: num(x.count) ?? 0, days: num(x.days) ?? 0 })).filter(x => x.value > 0);
  const code = text(project.code, 30); const name = text(project.name, 80);
  const chart = {
    v: 1, title: `Tiến độ ${code || name} ${spanText(r)}`,
    stats: [
      { label: 'Tiến độ hiện tại', value: pct(now.progress), hint: `${num(now.done) ?? 0}/${num(now.tasks) ?? 0} hạng mục xong` },
      { label: 'Chậm kế hoạch', value: num(now.late), hint: 'hạng mục quá ngày kết thúc KH' },
      { label: 'Nhật ký duyệt', value: sum(logsVerified), hint: `${sum(logs)} nhật ký trong kỳ` },
      { label: 'Có nhật ký', value: num(now.tracked), hint: 'hạng mục đã ghi tiến độ' },
    ],
    labels,
    panels: [
      { title: `Tiến độ cuối ${groupText(r.group)}`, kind: 'line', unit: '%', series: [{ label: 'Tiến độ %', values: progressEnd }] },
      { title: `Nhật ký theo ${groupText(r.group)}`, kind: 'bar', unit: 'phiếu', series: [{ label: 'Nhật ký duyệt', values: logsVerified }, { label: 'Hạng mục cập nhật', values: tasksUpdated }] },
      ...donut('Lý do chậm (sự kiện)', 'lần', delays),
    ],
    notes: ['% = bình quân hạng mục lá có nhật ký duyệt tới cuối kỳ, trọng số theo số ngày kế hoạch; hạng mục chưa có nhật ký không tính vào đường này. "Tiến độ hiện tại" tính trên mọi hạng mục lá.',
      ...(late.length ? [`Chậm kế hoạch nhiều nhất: ${late.slice(0, 3).map(t => `${t.hang_muc} (${t.tien_do}%, trễ ${t.cham_ngay} ngày)`).join('; ')}.`] : [])],
    source: `Dự án · nhật ký đã duyệt + hạng mục kế hoạch ${code}`, link: { route: '/da', label: 'Mở Dự án' },
  };
  return { chart, forModel: { du_an: `${code} · ${name}`.trim(), khoang: `${r.from} → ${r.to}`, tien_do_hien_tai_pct: pct(now.progress), hang_muc: num(now.tasks), xong: num(now.done), cham_ke_hoach: num(now.late),
    theo_ky: labels.map((l, i) => ({ ky: l, tien_do_cuoi_ky_pct: progressEnd[i], nhat_ky_duyet: logsVerified[i], hang_muc_cap_nhat: tasksUpdated[i] })),
    hang_muc_cham: late, ly_do_cham: delays.map(x => ({ ly_do: x.name, so_lan: x.value, so_ngay: x.days })),
    ghi_chu_so: delays.length ? null : 'Chưa có sự kiện lý do chậm ghi ở Nhật ký trong kỳ — chỉ nêu hạng mục quá hạn kế hoạch.' } };
};

/** assistant_report_finance_v1 → thẻ: thu / chi theo kỳ (triệu), tròn chi theo hạng mục, tròn theo dự án, công nợ NCC khi có quyền quản lý. */
export const financeReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const { buckets, labels } = bucketsOf(d, r);
  if (!buckets.length) return null;
  const inn = buckets.map(b => million(b.in) ?? 0); const out = buckets.map(b => million(b.out) ?? 0);
  const totalIn = million(d.totalIn) ?? 0; const totalOut = million(d.totalOut) ?? 0;
  const byCategory = asArray(d.byCategory).map(asObject).map(c => ({ name: text(c.name, 40) || 'Khác', value: million(c.amount) ?? 0 })).filter(c => c.value > 0);
  const byProject = asArray(d.byProject).map(asObject).map(p => ({ name: text(p.code, 30) || 'Khác', value: million(p.out) ?? 0, thu: million(p.in) ?? 0 })).filter(p => p.value > 0 || p.thu > 0);
  const payable = d.payable ? asObject(d.payable) : null;
  const project = asObject(d.project);
  const scope = project.code ? ` · ${text(project.code, 30)}` : '';
  const chart = {
    v: 1, title: `Thu chi${scope} ${spanText(r)}`,
    stats: [
      { label: 'Thu', value: totalIn, hint: 'triệu đ · tiền về' }, { label: 'Chi', value: totalOut, hint: 'triệu đ · chi phí ghi sổ' },
      { label: 'Thu − chi', value: Math.round((totalIn - totalOut) * 10) / 10, hint: 'triệu đ' },
      payable ? { label: 'Công nợ NCC', value: million(payable.outstanding), hint: `${million(payable.overdue) ?? 0} tr quá hạn · ${million(payable.soon) ?? 0} tr đến hạn 7 ngày` } : { label: 'Công nợ NCC', value: null, hint: 'cần quyền quản lý Tài chính' },
    ],
    labels,
    panels: [
      { title: `Thu / chi theo ${groupText(r.group)}`, kind: 'bar', unit: 'triệu đ', series: [{ label: 'Thu', values: inn }, { label: 'Chi', values: out }] },
      ...donut('Chi theo hạng mục', 'triệu đ', byCategory, 'Chi'),
      ...(!project.code && byProject.length > 1 ? donut('Chi theo dự án', 'triệu đ', byProject.map(p => ({ name: p.name, value: p.value })), 'Chi') : []),
    ],
    notes: ['Thu = tiền về đã ghi (revenue_received); Chi = chi phí ghi sổ theo ngày chứng từ, không gồm lô thanh toán NCC gộp. Công nợ NCC là số hiện tại, không theo kỳ.'],
    source: 'Tài chính · sổ thu chi dự án', link: { route: '/finance/overview', label: 'Mở Tài chính' },
  };
  const top = payable ? asArray(payable.top).map(asObject).map(s => ({ ncc: text(s.name, 60), con_no_trieu: million(s.outstanding) })) : [];
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, du_an: project.code ? `${text(project.code, 30)} · ${text(project.name, 80)}` : 'toàn công ty', thu_trieu: totalIn, chi_trieu: totalOut,
    theo_ky: labels.map((l, i) => ({ ky: l, thu_trieu: inn[i], chi_trieu: out[i] })), chi_theo_hang_muc: byCategory.map(c => ({ hang_muc: c.name, trieu: c.value })),
    theo_du_an: byProject.map(p => ({ du_an: p.name, thu_trieu: p.thu, chi_trieu: p.value })),
    cong_no_ncc: payable ? { con_no_trieu: million(payable.outstanding), qua_han_trieu: million(payable.overdue), den_han_7_ngay_trieu: million(payable.soon), so_chung_tu: num(payable.docs), ncc_lon_nhat: top } : 'ngoài quyền xem (cần quản lý Tài chính)' } };
};

/** assistant_report_attendance_v1 → thẻ: lượt chấm công / nghỉ / công tác theo kỳ, người đi làm theo kỳ, tròn theo công trường. */
export const attendanceReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const { buckets, labels } = bucketsOf(d, r);
  if (!buckets.length) return null;
  const present = countsOf(buckets, 'present'); const people = countsOf(buckets, 'people'); const leave = countsOf(buckets, 'leave'); const trip = countsOf(buckets, 'trip'); const oor = countsOf(buckets, 'outOfRange');
  const bySite = namedCounts(d.bySite, 'name', 'count', 'Chưa rõ');
  const chart = {
    v: 1, title: `Chấm công ${spanText(r)}`,
    stats: [
      { label: 'Lượt chấm công', value: num(d.records), hint: 'trong phạm vi được xem' }, { label: 'Người', value: num(d.people), hint: 'có chấm công' },
      { label: 'Nghỉ', value: sum(leave), hint: 'lượt ghi nghỉ' }, { label: 'Ngoài vùng', value: sum(oor), hint: 'lượt chấm ngoài phạm vi GPS' },
    ],
    labels,
    panels: [
      { title: `Lượt theo ${groupText(r.group)}`, kind: 'stacked', unit: 'lượt', series: [{ label: 'Đi làm', values: present }, { label: 'Nghỉ', values: leave }, { label: 'Công tác', values: trip }] },
      { title: `Người đi làm theo ${groupText(r.group)}`, kind: 'line', unit: 'người', series: [{ label: 'Người', values: people }] },
      ...donut('Theo công trường / điểm chấm', 'lượt', bySite, 'Lượt'),
    ],
    notes: ['Chỉ bản ghi chấm công người hỏi được xem (của mình, người mình quản lý, hoặc toàn công ty với HR). Một người một ngày một lượt.'],
    source: 'Nhân sự · chấm công', link: { route: '/hrm/attendance', label: 'Mở Chấm công' },
  };
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, luot: num(d.records), nguoi: num(d.people), theo_ky: labels.map((l, i) => ({ ky: l, di_lam: present[i], nguoi: people[i], nghi: leave[i], cong_tac: trip[i], ngoai_vung: oor[i] })),
    theo_cong_truong: bySite.map(s => ({ noi: s.name, luot: s.value })) } };
};

const LV_STATUS: Record<string, string> = { approved: 'Đã duyệt', pending: 'Chờ duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy' };
/** assistant_report_leave_v1 → thẻ: đơn / ngày phép duyệt theo kỳ, tròn theo loại, tròn theo đơn vị (ngày). */
export const leaveReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const { buckets, labels } = bucketsOf(d, r);
  if (!buckets.length) return null;
  const requests = countsOf(buckets, 'requests'); const days = buckets.map(b => roundQty(b.approvedDays) ?? 0); const pending = countsOf(buckets, 'pending');
  const byType = asArray(d.byType).map(asObject).map(t => ({ name: text(t.name, 40) || 'Khác', value: num(t.count) ?? 0, days: roundQty(t.days) ?? 0 })).filter(t => t.value > 0);
  const byUnit = asArray(d.byUnit).map(asObject).map(u => ({ name: text(u.name, 40) || 'Chưa xếp đơn vị', value: roundQty(u.days) ?? 0, count: num(u.count) ?? 0 })).filter(u => u.value > 0 || u.count > 0);
  const byStatus = Object.entries(asObject(d.byStatus)).map(([k, v]) => ({ trang_thai: LV_STATUS[k] || k, so_don: num(v) ?? 0 }));
  const chart = {
    v: 1, title: `Nghỉ phép ${spanText(r)}`,
    stats: [
      { label: 'Đơn nghỉ', value: num(d.total), hint: 'theo ngày bắt đầu nghỉ' }, { label: 'Ngày phép duyệt', value: sum(days), hint: 'ngày' },
      { label: 'Chờ duyệt', value: num(d.pendingNow), hint: 'hiện tại' }, { label: 'Người', value: num(d.people), hint: 'có đơn trong kỳ' },
    ],
    labels,
    panels: [
      // Thẻ vẽ tối đa 3 khung: đơn theo kỳ, loại, đơn vị (ngày phép duyệt theo kỳ có trong bảng số của khung 1 qua forModel + ô số).
      { title: `Đơn theo ${groupText(r.group)}`, kind: 'bar', unit: 'đơn', series: [{ label: 'Đơn nghỉ', values: requests }, { label: 'Chờ duyệt', values: pending }] },
      ...donut('Theo loại nghỉ', 'đơn', byType.map(t => ({ name: t.name, value: t.value })), 'Đơn'),
      ...donut('Ngày phép duyệt theo đơn vị', 'ngày', byUnit.filter(u => u.value > 0).map(u => ({ name: u.name, value: u.value })), 'Ngày'),
    ],
    notes: ['Chỉ đơn người hỏi được xem (của mình, mình duyệt, hoặc toàn công ty với HR). Đơn vị theo sơ đồ tổ chức hiện tại của nhân viên.'],
    source: 'Nhân sự · đơn nghỉ phép', link: { route: '/hrm/leave', label: 'Mở Nghỉ phép' },
  };
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, so_don: num(d.total), ngay_phep_duyet: sum(days), cho_duyet_hien_tai: num(d.pendingNow),
    theo_ky: labels.map((l, i) => ({ ky: l, so_don: requests[i], ngay_duyet: days[i], cho_duyet: pending[i] })), theo_loai: byType.map(t => ({ loai: t.name, so_don: t.value, ngay_duyet: t.days })),
    theo_don_vi: byUnit.map(u => ({ don_vi: u.name, so_don: u.count, ngay_duyet: u.value })), theo_trang_thai: byStatus } };
};

const RQ_STATUS: Record<string, string> = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', IN_TRANSIT: 'Đang chuyển', COMPLETED: 'Hoàn thành', REJECTED: 'Trả lại' };
/** assistant_report_requests_v1 → thẻ: tạo mới / duyệt / trả lại theo kỳ, tròn theo mẫu, tròn theo dự án. */
export const requestsReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const { buckets, labels } = bucketsOf(d, r);
  if (!buckets.length) return null;
  const created = countsOf(buckets, 'created'); const approved = countsOf(buckets, 'approved'); const rejected = countsOf(buckets, 'rejected');
  const byTemplate = namedCounts(d.byTemplate, 'name', 'count', 'Không qua mẫu'); const byProject = namedCounts(d.byProject, 'code', 'count');
  const byStatus = Object.entries(asObject(d.byStatus)).map(([k, v]) => ({ trang_thai: RQ_STATUS[k] || k, so_phieu: num(v) ?? 0 }));
  const stale = num(d.pendingStale) ?? 0;
  const chart = {
    v: 1, title: `Phiếu yêu cầu ${spanText(r)}`,
    stats: [
      { label: 'Tạo mới', value: num(d.total), hint: `theo ${groupText(r.group)}` }, { label: 'Đã duyệt', value: sum(approved), hint: 'gồm đang chuyển / hoàn thành' },
      { label: 'Trả lại', value: sum(rejected), hint: null }, { label: 'Chờ duyệt', value: num(d.pendingNow), hint: stale > 0 ? `${stale} phiếu quá 3 ngày` : 'hiện tại' },
    ],
    labels,
    panels: [
      { title: `Phiếu theo ${groupText(r.group)}`, kind: 'bar', unit: 'phiếu', series: [{ label: 'Tạo mới', values: created }, { label: 'Đã duyệt', values: approved }, { label: 'Trả lại', values: rejected }] },
      ...donut('Theo mẫu', 'phiếu', byTemplate, 'Phiếu'),
      ...(byProject.length > 1 ? donut('Theo dự án', 'phiếu', byProject, 'Phiếu') : []),
    ],
    notes: ['Chỉ phiếu người hỏi được xem. Trạng thái lấy ở thời điểm hiện tại của phiếu tạo trong kỳ.'],
    source: 'Yêu cầu · phiếu theo ngày tạo', link: { route: '/rq', label: 'Mở Yêu cầu' },
  };
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, tao_moi: num(d.total), da_duyet: sum(approved), tra_lai: sum(rejected), cho_duyet_hien_tai: num(d.pendingNow), qua_3_ngay: stale,
    theo_ky: labels.map((l, i) => ({ ky: l, tao_moi: created[i], da_duyet: approved[i], tra_lai: rejected[i] })), theo_mau: byTemplate.map(t => ({ mau: t.name, so_phieu: t.value })),
    theo_du_an: byProject.map(p => ({ du_an: p.name, so_phieu: p.value })), theo_trang_thai: byStatus } };
};

const VB_STATUS: Record<string, string> = { DRAFT: 'Nháp', SUBMITTED: 'Đã gửi', PENDING: 'Chờ duyệt', PENDING_MANAGER: 'Chờ quản lý', APPROVED: 'Đã duyệt', ASSIGNED: 'Đã xếp xe', IN_PROGRESS: 'Đang đi', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy', REJECTED: 'Từ chối' };
const TRIP_TYPE: Record<string, string> = { ONE_WAY: 'Một chiều', ROUND_TRIP: 'Khứ hồi', MULTI_STOP: 'Nhiều điểm', KHAC: 'Khác' };
/** assistant_report_vehicle_v1 → thẻ: chuyến đặt / hoàn thành / hủy theo kỳ, tròn theo đơn vị, tròn theo loại chuyến. */
export const vehicleReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const { buckets, labels } = bucketsOf(d, r);
  if (!buckets.length) return null;
  const bookings = countsOf(buckets, 'bookings'); const completed = countsOf(buckets, 'completed'); const cancelled = countsOf(buckets, 'cancelled');
  const byUnit = namedCounts(d.byUnit, 'name', 'count', 'Chưa rõ đơn vị');
  const byTrip = asArray(d.byTrip).map(asObject).map(x => ({ name: TRIP_TYPE[text(x.name, 20)] || text(x.name, 20) || 'Khác', value: num(x.count) ?? 0 })).filter(x => x.value > 0);
  const byStatus = Object.entries(asObject(d.byStatus)).map(([k, v]) => ({ trang_thai: VB_STATUS[k] || k, so_chuyen: num(v) ?? 0 }));
  const chart = {
    v: 1, title: `Đặt xe ${spanText(r)}`,
    stats: [
      { label: 'Chuyến đặt', value: num(d.total), hint: 'theo giờ đón' }, { label: 'Hoàn thành', value: sum(completed), hint: null },
      { label: 'Hủy', value: sum(cancelled), hint: null }, { label: 'Đang chờ', value: num(d.openNow), hint: 'hiện tại · chờ duyệt / xếp xe' },
    ],
    labels,
    panels: [
      { title: `Chuyến theo ${groupText(r.group)}`, kind: 'bar', unit: 'chuyến', series: [{ label: 'Đặt', values: bookings }, { label: 'Hoàn thành', values: completed }, { label: 'Hủy', values: cancelled }] },
      ...donut('Theo đơn vị', 'chuyến', byUnit, 'Chuyến'),
      ...donut('Theo loại chuyến', 'chuyến', byTrip, 'Chuyến'),
    ],
    notes: ['Chỉ chuyến người hỏi được xem. Đơn vị theo phòng ban lúc đặt xe.'],
    source: 'Đặt xe · theo giờ đón', link: { route: '/booking/vehicle', label: 'Mở Đặt xe' },
  };
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, so_chuyen: num(d.total), hoan_thanh: sum(completed), huy: sum(cancelled), dang_cho_hien_tai: num(d.openNow), hanh_khach: num(d.passengers),
    theo_ky: labels.map((l, i) => ({ ky: l, dat: bookings[i], hoan_thanh: completed[i], huy: cancelled[i] })), theo_don_vi: byUnit.map(u => ({ don_vi: u.name, so_chuyen: u.value })),
    theo_loai_chuyen: byTrip.map(t => ({ loai: t.name, so_chuyen: t.value })), theo_trang_thai: byStatus } };
};

const OD_STATUS: Record<string, string> = { DRAFT: 'Nháp', PENDING_APPROVAL: 'Chờ duyệt', APPROVED: 'Đã duyệt', ISSUED: 'Đã ban hành', REVOKED: 'Thu hồi', ARCHIVED: 'Lưu trữ' };
const OD_GROUP: Record<string, string> = { INCOMING: 'Văn bản đến', OUTGOING: 'Văn bản đi', ANNOUNCEMENT: 'Thông báo nội bộ', KHAC: 'Khác' };
/** assistant_report_office_v1 → thẻ: đến / đi / thông báo theo kỳ, tròn theo loại; quá hạn xử lý. */
export const officeReport = (raw: unknown, r: ReportRange): BuiltReport | null => {
  const d = asObject(raw);
  const { buckets, labels } = bucketsOf(d, r);
  if (!buckets.length) return null;
  const incoming = countsOf(buckets, 'incoming'); const outgoing = countsOf(buckets, 'outgoing'); const other = countsOf(buckets, 'other');
  const byType = namedCounts(d.byType, 'name', 'count', 'Chưa phân loại');
  const byGroup = Object.entries(asObject(d.byGroup)).map(([k, v]) => ({ nhom: OD_GROUP[k] || k, so_van_ban: num(v) ?? 0 }));
  const byStatus = Object.entries(asObject(d.byStatus)).map(([k, v]) => ({ trang_thai: OD_STATUS[k] || k, so_van_ban: num(v) ?? 0 }));
  const groups = asObject(d.byGroup);
  const chart = {
    v: 1, title: `Văn bản ${spanText(r)}`,
    stats: [
      { label: 'Văn bản', value: num(d.total), hint: 'theo ngày văn bản' }, { label: 'Đến', value: num(groups.INCOMING) ?? 0, hint: null },
      { label: 'Đi / thông báo', value: (num(groups.OUTGOING) ?? 0) + (num(groups.ANNOUNCEMENT) ?? 0), hint: null }, { label: 'Quá hạn xử lý', value: num(d.overdue), hint: `${num(d.processingNow) ?? 0} đang xử lý` },
    ],
    labels,
    panels: [
      { title: `Văn bản theo ${groupText(r.group)}`, kind: 'stacked', unit: 'văn bản', series: [{ label: 'Đến', values: incoming }, { label: 'Đi', values: outgoing }, { label: 'Thông báo / khác', values: other }] },
      ...donut('Theo loại văn bản', 'văn bản', byType, 'Văn bản'),
    ],
    notes: ['Chỉ văn bản người hỏi được xem (người nhận, người xử lý, người theo dõi, Văn thư). Quá hạn = có hạn xử lý đã qua mà chưa ghi kết quả.'],
    source: 'Office · văn bản theo ngày văn bản', link: { route: '/office/documents', label: 'Mở Văn bản' },
  };
  return { chart, forModel: { khoang: `${r.from} → ${r.to}`, so_van_ban: num(d.total), qua_han_xu_ly: num(d.overdue), dang_xu_ly: num(d.processingNow),
    theo_ky: labels.map((l, i) => ({ ky: l, den: incoming[i], di: outgoing[i], khac: other[i] })), theo_nhom: byGroup, theo_loai: byType.map(t => ({ loai: t.name, so_van_ban: t.value })), theo_trang_thai: byStatus } };
};
