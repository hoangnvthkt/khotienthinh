import { describe, expect, it } from 'vitest';
import { bucketLabels, inventoryReport, million, procurementReport, reportRange, workflowReport } from '../../supabase/functions/ai-gateway/reports';
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
