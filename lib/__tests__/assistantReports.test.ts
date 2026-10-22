import { describe, expect, it } from 'vitest';
import { attendanceReport, bucketLabels, financeReport, inventoryReport, leaveReport, million, officeReport, procurementReport, progressReport, reportRange, requestsReport, vehicleReport, workflowReport } from '../../supabase/functions/ai-gateway/reports';
import { donutTotal, panelRows, parseChart } from '../assistantChart';

const TODAY = '2026-10-20';

describe('bao_cao — khoảng kỳ', () => {
  it('bỏ trống = 3 tháng gần nhất tới hôm nay, nhóm theo tháng; ≤ 70 ngày thì theo tuần; tương lai / quá dài / ngược → lỗi rõ', () => {
    expect(reportRange({}, TODAY)).toEqual({ from: '2026-08-01', to: '2026-10-20', group: 'month' });
    expect(reportRange({ tu_ngay: '2026-10-01' }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-20', group: 'week' });
    expect(reportRange({ tu_ngay: '2026-07-01', den_ngay: '2026-09-30' }, TODAY)).toEqual({ from: '2026-07-01', to: '2026-09-30', group: 'month' });
    expect(reportRange({ tu_ngay: '2026-07-01', den_ngay: '2026-09-30', nhom_theo: 'tuan' }, TODAY)).toMatchObject({ group: 'week' });
    expect(reportRange({ den_ngay: '2026-12-31', tu_ngay: '2026-10-01' }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-20', group: 'week' });
    expect('loi' in reportRange({ tu_ngay: '2026-11-01' }, TODAY)).toBe(true);
    expect('loi' in reportRange({ tu_ngay: '2025-01-01', den_ngay: '2026-10-01' }, TODAY)).toBe(true);
    expect('loi' in reportRange({ tu_ngay: 'quý 3' }, TODAY)).toBe(true);
    expect(bucketLabels(['2026-10-06', '2026-10-13'], 'week')).toEqual(['06/10', '13/10']);
    expect(bucketLabels(['2026-08-01', '2026-09-01'], 'month')).toEqual(['T8', 'T9']);
    expect(bucketLabels(['2025-12-01', '2026-01-01'], 'month')).toEqual(['T12/25', 'T1/26']);
    expect(million(1_250_000)).toBe(1.3);
  });
});

describe('bao_cao — dựng thẻ', () => {
  const range = { from: '2026-08-01', to: '2026-10-20', group: 'month' as const };
  it('phiếu quy trình: cột 3 chuỗi theo kỳ + tròn theo mẫu; ô số; ghi chú hoàn thành theo ngày cập nhật', () => {
    const built = workflowReport({ buckets: [{ start: '2026-08-01', created: 30, completed: 25, returned: 3 }, { start: '2026-09-01', created: 40, completed: 35, returned: 2 }, { start: '2026-10-01', created: 49, completed: 20, returned: 1 }],
      byTemplate: [{ name: 'Đề nghị tạm ứng', count: 60 }, { name: 'Đề nghị thanh toán', count: 40 }, { name: null, count: 19 }], byStatus: { RUNNING: 63, COMPLETED: 50, REJECTED: 6 }, total: 119, runningNow: 63, runningStale: 12 }, range)!;
    const spec = parseChart(built.chart)!;
    expect(spec.title).toBe('Phiếu quy trình 01/08/2026 – 20/10/2026');
    expect(spec.labels).toEqual(['T8', 'T9', 'T10']);
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Tạo mới', 119], ['Hoàn thành', 80], ['Trả lại / hủy', 6], ['Đang xử lý', 63]]);
    expect(spec.panels[0]).toMatchObject({ kind: 'bar', series: [{ label: 'Tạo mới', values: [30, 40, 49] }, { label: 'Hoàn thành', values: [25, 35, 20] }, { label: 'Trả lại / hủy', values: [3, 2, 1] }] });
    expect(spec.panels[1]).toMatchObject({ kind: 'donut', labels: ['Đề nghị tạm ứng', 'Đề nghị thanh toán', 'Mẫu khác'] });
    expect(donutTotal(spec.panels[1])).toBe(119);
    expect(panelRows(spec, spec.panels[1])[0]).toEqual({ label: 'Đề nghị tạm ứng', values: [60] });
    expect(built.forModel).toMatchObject({ tong_tao_moi: 119, hoan_thanh: 80, qua_7_ngay_chua_dong: 12 });
    expect(spec.notes[0]).toMatch(/ngày cập nhật cuối/);
  });

  it('kho: không vật tư → giá trị (triệu đ) + tròn vật tư xuất nhiều; có vật tư → số lượng theo đơn vị + tồn hiện tại', () => {
    const noItem = inventoryReport({ buckets: [{ start: '2026-08-01', inAmount: 1_200_000_000, outAmount: 800_000_000, docsIn: 12, docsOut: 20, inQty: 5, outQty: 3 }], warehouses: ['Kho SMB'], item: null,
      topOut: [{ name: 'Thép XD D16', unit: 'kg', qty: 6300, amount: 100_000_000 }, { name: 'Xi măng PCB40', unit: 'tấn', qty: 10, amount: 16_500_000 }], totalInAmount: 1_200_000_000, totalOutAmount: 800_000_000 }, range)!;
    const s1 = parseChart(noItem.chart)!;
    expect(s1.stats.map(s => s.value)).toEqual([1200, 800, 12, 20]);
    expect(s1.panels[0]).toMatchObject({ kind: 'bar', unit: 'triệu đ' });
    expect(s1.panels[1]).toMatchObject({ kind: 'donut', labels: ['Thép XD D16', 'Xi măng PCB40'], series: [{ values: [100, 16.5] }] });
    const withItem = inventoryReport({ buckets: [{ start: '2026-08-01', inQty: 6300, outQty: 4100 }], warehouses: ['Kho SMB', 'Kho Xinhai'], item: { id: 'i1', sku: 'VT0000828', name: 'Thép XD D16', unit: 'Cây' },
      stockNow: [{ warehouse: 'Kho SMB', qty: 1500 }, { warehouse: 'Kho Xinhai', qty: 700 }], totalIn: 6300, totalOut: 4100 }, range)!;
    const s2 = parseChart(withItem.chart)!;
    expect(s2.title).toContain('Thép XD D16');
    expect(s2.stats.map(s => [s.label, s.value])).toEqual([['Nhập', 6300], ['Xuất', 4100], ['Tồn hiện tại', 2200], ['Số kho', 2]]);
    expect(s2.panels).toHaveLength(1);
    expect(withItem.forModel).toMatchObject({ don_vi: 'Cây', ton_hien_tai_theo_kho: [{ kho: 'Kho SMB', ton: 1500 }, { kho: 'Kho Xinhai', ton: 700 }] });
  });

  it('đơn mua: giá trị theo kỳ + tròn NCC + tròn dự án (chỉ khi > 1 dự án); trạng thái dịch tiếng Việt; rỗng → null', () => {
    const built = procurementReport({ buckets: [{ start: '2026-08-01', count: 20, amount: 2_500_000_000 }, { start: '2026-09-01', count: 30, amount: 4_000_000_000 }], byStatus: { confirmed: 30, sent: 20 },
      byVendor: [{ name: 'Hợp Thành', count: 12, amount: 3_000_000_000 }, { name: 'Tôn Đoàn Minh', count: 6, amount: 1_500_000_000 }], byProject: [{ name: 'SMB-2026', count: 40, amount: 6_000_000_000 }], total: 50, totalAmount: 6_500_000_000 }, range)!;
    const spec = parseChart(built.chart)!;
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Số đơn', 50], ['Tổng giá trị', 6500], ['Nhà cung cấp', 2], ['Dự án', 1]]);
    expect(spec.panels.map(p => p.kind)).toEqual(['bar', 'donut']);
    expect(built.forModel).toMatchObject({ theo_trang_thai: [{ trang_thai: 'Đã duyệt', so_don: 30 }, { trang_thai: 'Chờ duyệt', so_don: 20 }] });
    expect(procurementReport({ buckets: [] }, range)).toBeNull();
  });

  it('parseChart: dạng lạ → đường; cột chồng giữ tới 4 chuỗi; tròn chỉ 1 chuỗi và nhãn riêng ≤ 12', () => {
    const spec = parseChart({ title: 'x', labels: ['a', 'b'], panels: [
      { title: 'p1', kind: 'stacked', unit: '', series: [{ label: '1', values: [1, 2] }, { label: '2', values: [1, 2] }, { label: '3', values: [1, 2] }, { label: '4', values: [1, 2] }, { label: '5', values: [1, 2] }] },
      { title: 'p2', kind: 'donut', unit: '', labels: Array.from({ length: 15 }, (_, i) => `m${i}`), series: [{ label: 'v', values: Array.from({ length: 15 }, (_, i) => i) }, { label: 'w', values: [1] }] },
      { title: 'p3', kind: 'bubble', unit: '', series: [{ label: 'v', values: [1, 2] }] },
    ] })!;
    expect(spec.panels[0].series).toHaveLength(4);
    expect(spec.panels[1].labels).toHaveLength(12);
    expect(spec.panels[1].series).toHaveLength(1);
    expect(spec.panels[2].kind).toBe('line');
  });
});

describe('bao_cao đợt A2 (22/10) — dựng thẻ 7 loại', () => {
  const week = { from: '2026-09-01', to: '2026-10-20', group: 'week' as const };
  const month = { from: '2026-08-01', to: '2026-10-20', group: 'month' as const };

  it('tiến độ dự án: đường % cuối kỳ (null khi chưa có nhật ký), cột nhật ký, hạng mục chậm + lý do chậm cho model; thiếu dự án → null', () => {
    const built = progressReport({ project: { id: 'p-smb', code: 'SMB-2026', name: 'Nhà máy SMB' },
      buckets: [{ start: '2026-10-05', logs: 5, logsVerified: 4, tasksUpdated: 6, progressEnd: 61.25 }, { start: '2026-10-12', logs: 6, logsVerified: 6, tasksUpdated: 7, progressEnd: 64.9 }, { start: '2026-10-19', logs: 1, logsVerified: 0, tasksUpdated: 0, progressEnd: null }],
      now: { tasks: 300, done: 120, late: 45, progress: 68.04, tracked: 40 },
      lateTasks: [{ name: 'Xây tường tầng 4', end: '2026-10-10', progress: 45, days: 10, reason: null }, { name: 'Sơn tường tầng 1', end: '2026-10-15', progress: 30, days: 5, reason: 'Thiếu thợ sơn' }],
      delays: [{ category: 'material', count: 3, days: 6 }, { category: 'weather', count: 2, days: 2 }] }, week)!;
    const spec = parseChart(built.chart)!;
    expect(spec.title).toBe('Tiến độ SMB-2026 01/09/2026 – 20/10/2026');
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Tiến độ hiện tại', 68], ['Chậm kế hoạch', 45], ['Nhật ký duyệt', 10], ['Có nhật ký', 40]]);
    expect(spec.panels[0]).toMatchObject({ kind: 'line', unit: '%' });
    expect(spec.panels[0].series[0].values).toEqual([61.3, 64.9, null]);
    expect(spec.panels[1]).toMatchObject({ kind: 'bar' }); expect(spec.panels[1].series.map(s => s.label)).toEqual(['Nhật ký duyệt', 'Hạng mục cập nhật']);
    expect(spec.panels[2]).toMatchObject({ kind: 'donut', labels: ['Vật tư', 'Thời tiết'] });
    expect(spec.notes.join(' ')).toContain('Xây tường tầng 4 (45%, trễ 10 ngày)');
    expect(built.forModel).toMatchObject({ du_an: 'SMB-2026 · Nhà máy SMB', tien_do_hien_tai_pct: 68, cham_ke_hoach: 45, hang_muc_cham: [{ hang_muc: 'Xây tường tầng 4', cham_ngay: 10 }, { hang_muc: 'Sơn tường tầng 1', ly_do: 'Thiếu thợ sơn' }], ly_do_cham: [{ ly_do: 'Vật tư', so_lan: 3, so_ngay: 6 }, { ly_do: 'Thời tiết', so_lan: 2 }] });
    expect(progressReport(null, week)).toBeNull();
    expect(progressReport({ project: {}, buckets: [{ start: '2026-10-05' }] }, week)).toBeNull();
    const noDelay = progressReport({ project: { id: 'p', code: 'DA29', name: 'X' }, buckets: [{ start: '2026-10-05' }], now: {}, lateTasks: [], delays: [] }, week)!;
    expect(parseChart(noDelay.chart)!.panels).toHaveLength(2);
    expect(noDelay.forModel.ghi_chu_so).toMatch(/Chưa có sự kiện lý do chậm/);
  });

  it('tài chính: thu / chi triệu theo kỳ, tròn chi theo hạng mục, theo dự án khi toàn công ty; công nợ chỉ khi quản lý', () => {
    const raw = { canManage: true, project: null, buckets: [{ start: '2026-08-01', in: 2_000_000_000, out: 1_500_000_000 }, { start: '2026-09-01', in: 500_000_000, out: 1_200_000_000 }, { start: '2026-10-01', in: 0, out: 300_000_000 }],
      totalIn: 2_500_000_000, totalOut: 3_000_000_000, byCategory: [{ name: 'Vật tư', amount: 2_000_000_000 }, { name: 'Nhân công', amount: 1_000_000_000 }],
      byProject: [{ code: 'SMB-2026', in: 2_500_000_000, out: 2_000_000_000 }, { code: 'DA29', in: 0, out: 1_000_000_000 }],
      payable: { outstanding: 4_200_000_000, overdue: 800_000_000, soon: 300_000_000, docs: 12, top: [{ name: 'Hanaka', outstanding: 1_500_000_000 }] } };
    const built = financeReport(raw, month)!;
    const spec = parseChart(built.chart)!;
    expect(spec.title).toBe('Thu chi 01/08/2026 – 20/10/2026');
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Thu', 2500], ['Chi', 3000], ['Thu − chi', -500], ['Công nợ NCC', 4200]]);
    expect(spec.stats[3].hint).toBe('800 tr quá hạn · 300 tr đến hạn 7 ngày');
    expect(spec.panels.map(p => p.kind)).toEqual(['bar', 'donut', 'donut']);
    expect(spec.panels[2].labels).toEqual(['SMB-2026', 'DA29']);
    expect(built.forModel).toMatchObject({ du_an: 'toàn công ty', cong_no_ncc: { con_no_trieu: 4200, ncc_lon_nhat: [{ ncc: 'Hanaka', con_no_trieu: 1500 }] } });
    const staff = financeReport({ ...raw, canManage: false, payable: null, project: { id: 'p', code: 'SMB-2026', name: 'SMB' } }, month)!;
    const s2 = parseChart(staff.chart)!;
    expect(s2.title).toBe('Thu chi · SMB-2026 01/08/2026 – 20/10/2026');
    expect(s2.stats[3]).toMatchObject({ value: null, hint: 'cần quyền quản lý Tài chính' });
    expect(s2.panels.map(p => p.kind)).toEqual(['bar', 'donut']);
    expect(staff.forModel.cong_no_ncc).toMatch(/ngoài quyền/);
  });

  it('chấm công: cột chồng đi làm / nghỉ / công tác, đường người, tròn công trường', () => {
    const built = attendanceReport({ records: 420, people: 38, buckets: [{ start: '2026-10-05', present: 190, people: 36, leave: 4, trip: 2, outOfRange: 3 }, { start: '2026-10-12', present: 200, people: 37, leave: 2, trip: 1, outOfRange: 0 }],
      bySite: [{ name: 'SMB Hưng Yên', count: 250 }, { name: 'Văn phòng', count: 140 }] }, week)!;
    const spec = parseChart(built.chart)!;
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Lượt chấm công', 420], ['Người', 38], ['Nghỉ', 6], ['Ngoài vùng', 3]]);
    expect(spec.panels.map(p => p.kind)).toEqual(['stacked', 'line', 'donut']);
    expect(spec.panels[0].series.map(s => s.label)).toEqual(['Đi làm', 'Nghỉ', 'Công tác']);
    expect(built.forModel.theo_cong_truong).toEqual([{ noi: 'SMB Hưng Yên', luot: 250 }, { noi: 'Văn phòng', luot: 140 }]);
  });

  it('nghỉ phép: đơn + chờ duyệt, ngày phép duyệt theo kỳ, tròn theo loại và theo đơn vị (ngày); trạng thái tiếng Việt', () => {
    const built = leaveReport({ total: 24, people: 15, pendingNow: 3, buckets: [{ start: '2026-08-01', requests: 8, approvedDays: 12.5, pending: 0 }, { start: '2026-09-01', requests: 10, approvedDays: 9, pending: 1 }, { start: '2026-10-01', requests: 6, approvedDays: 4, pending: 2 }],
      byType: [{ name: 'Nghỉ phép năm', count: 15, days: 20 }, { name: 'Nghỉ không lương', count: 9, days: 5.5 }], byUnit: [{ name: 'Phòng Kỹ thuật', count: 10, days: 14 }, { name: null, count: 2, days: null }], byStatus: { approved: 19, pending: 3, rejected: 2 } }, month)!;
    const spec = parseChart(built.chart)!;
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Đơn nghỉ', 24], ['Ngày phép duyệt', 25.5], ['Chờ duyệt', 3], ['Người', 15]]);
    expect(spec.panels.map(p => p.kind)).toEqual(['bar', 'donut', 'donut']);
    expect(spec.panels[2].labels).toEqual(['Phòng Kỹ thuật']);
    expect(built.forModel.theo_trang_thai).toEqual([{ trang_thai: 'Đã duyệt', so_don: 19 }, { trang_thai: 'Chờ duyệt', so_don: 3 }, { trang_thai: 'Từ chối', so_don: 2 }]);
    expect(built.forModel.theo_don_vi).toEqual([{ don_vi: 'Phòng Kỹ thuật', so_don: 10, ngay_duyet: 14 }, { don_vi: 'Chưa xếp đơn vị', so_don: 2, ngay_duyet: 0 }]);
  });

  it('yêu cầu: tạo mới / duyệt / trả lại, tròn theo mẫu, theo dự án chỉ khi > 1; ô chờ duyệt nhắc quá 3 ngày', () => {
    const built = requestsReport({ total: 45, pendingNow: 17, pendingStale: 5, buckets: [{ start: '2026-08-01', created: 15, approved: 12, rejected: 1, pending: 0 }, { start: '2026-09-01', created: 20, approved: 15, rejected: 2, pending: 1 }, { start: '2026-10-01', created: 10, approved: 3, rejected: 1, pending: 6 }],
      byTemplate: [{ name: 'Đề xuất vật tư', count: 40 }, { name: null, count: 5 }], byProject: [{ code: 'SMB-2026', count: 30 }, { code: 'DA29', count: 15 }], byStatus: { APPROVED: 25, PENDING: 17, REJECTED: 3 } }, month)!;
    const spec = parseChart(built.chart)!;
    expect(spec.stats.map(s => [s.label, s.value])).toEqual([['Tạo mới', 45], ['Đã duyệt', 30], ['Trả lại', 4], ['Chờ duyệt', 17]]);
    expect(spec.stats[3].hint).toBe('5 phiếu quá 3 ngày');
    expect(spec.panels.map(p => p.kind)).toEqual(['bar', 'donut', 'donut']);
    expect(spec.panels[1].labels).toEqual(['Đề xuất vật tư', 'Không qua mẫu']);
    expect(built.forModel.theo_trang_thai).toContainEqual({ trang_thai: 'Trả lại', so_phieu: 3 });
  });

  it('đặt xe: chuyến theo kỳ, tròn đơn vị, tròn loại chuyến dịch tiếng Việt; văn bản: cột chồng đến / đi / khác, tròn loại, quá hạn', () => {
    const vb = vehicleReport({ total: 6, passengers: 9, openNow: 1, buckets: [{ start: '2026-09-01', bookings: 4, completed: 1, cancelled: 2 }, { start: '2026-10-01', bookings: 2, completed: 0, cancelled: 0 }],
      byUnit: [{ name: 'Phòng Kế hoạch', count: 4 }, { name: null, count: 2 }], byTrip: [{ name: 'ROUND_TRIP', count: 3 }, { name: 'ONE_WAY', count: 3 }], byStatus: { DRAFT: 3, COMPLETED: 1, CANCELLED: 2 } }, month)!;
    const vs = parseChart(vb.chart)!;
    expect(vs.stats.map(s => s.value)).toEqual([6, 1, 2, 1]);
    expect(vs.panels[2].labels).toEqual(['Khứ hồi', 'Một chiều']);
    expect(vb.forModel.theo_trang_thai).toContainEqual({ trang_thai: 'Hoàn thành', so_chuyen: 1 });
    const od = officeReport({ total: 15, overdue: 2, processingNow: 4, buckets: [{ start: '2026-08-01', incoming: 1, outgoing: 0, other: 5 }, { start: '2026-09-01', incoming: 0, outgoing: 2, other: 4 }, { start: '2026-10-01', incoming: 0, outgoing: 0, other: 3 }],
      byGroup: { INCOMING: 1, OUTGOING: 2, ANNOUNCEMENT: 12 }, byType: [{ name: 'Thông báo', count: 12 }, { name: null, count: 3 }], byStatus: { ISSUED: 5, PENDING_APPROVAL: 3, ARCHIVED: 2, REVOKED: 3, DRAFT: 1, APPROVED: 1 } }, month)!;
    const os = parseChart(od.chart)!;
    expect(os.stats.map(s => [s.label, s.value])).toEqual([['Văn bản', 15], ['Đến', 1], ['Đi / thông báo', 14], ['Quá hạn xử lý', 2]]);
    expect(os.panels.map(p => p.kind)).toEqual(['stacked', 'donut']);
    expect(od.forModel.theo_nhom).toEqual([{ nhom: 'Văn bản đến', so_van_ban: 1 }, { nhom: 'Văn bản đi', so_van_ban: 2 }, { nhom: 'Thông báo nội bộ', so_van_ban: 12 }]);
    expect(od.forModel.theo_trang_thai).toContainEqual({ trang_thai: 'Thu hồi', so_van_ban: 3 });
  });
});
