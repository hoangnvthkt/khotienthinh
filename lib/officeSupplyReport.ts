import { loadXlsx } from './loadXlsx';
import type { VppReport, VppXntRow } from './officeSupplyService';

// Báo cáo VPP tháng: tháng, lọc bảng XNT, dựng bảng tính theo mẫu XNT của thủ kho (STT, Mã, Tên, ĐVT, Tồn đầu, Nhập, Xuất,
// Tồn cuối, Ghi chú = cấp cho ai, Đơn giá, Thành tiền) + 2 trang theo người và theo phòng ban.

export const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
export const shiftMonth = (m: string, delta: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const currentMonth = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

/** Mã có tồn hoặc có phát sinh trong tháng. */
export const xntActive = (r: VppXntRow) => r.openQty !== 0 || r.inQty !== 0 || r.outQty !== 0;

export const XNT_HEADER = ['STT', 'Mã', 'Tên vật tư', 'ĐVT', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Ghi chú', 'Đơn giá', 'Thành tiền'];

export const xntSheetRows = (report: VppReport) => {
  const rows = report.xnt.map((r, i) => [i + 1, r.sku || '', r.name, r.unit, r.openQty, r.inQty, r.outQty, r.closeQty, r.note || '', r.unitPrice, r.closeValue]);
  const total = report.xnt.reduce((s, r) => s + r.closeValue, 0);
  return [
    [`BẢNG NHẬP – XUẤT – TỒN VĂN PHÒNG PHẨM THÁNG ${monthLabel(report.month)}`],
    [report.warehouseName || ''],
    XNT_HEADER,
    ...rows,
    ['', '', 'Cộng', '', '', '', '', '', '', '', total],
  ];
};

export const peopleSheetRows = (report: VppReport) => [
  ['Người đề xuất', 'Phòng ban', 'Số phiếu', 'SL đề xuất', 'SL đã cấp', 'Giá trị đã cấp'],
  ...report.people.map(p => [p.name || '', p.orgUnitName, p.requestCount, p.requestedQty, p.issuedQty, p.value]),
  ['Cộng', '', report.people.reduce((s, p) => s + p.requestCount, 0), '', '', report.people.reduce((s, p) => s + p.value, 0)],
];

export const deptSheetRows = (report: VppReport) => [
  ['Phòng ban', 'Số người', 'Số phiếu', 'SL đề xuất', 'SL đã cấp', 'Giá trị cấp', 'Trả lại', 'Chi phí'],
  ...report.departments.map(d => [d.name, d.people, d.requestCount, d.requestedQty, d.issuedQty, d.issuedValue, d.returnedValue, d.value]),
  ['Cộng', '', report.departments.reduce((s, d) => s + d.requestCount, 0), '', '',
    report.departments.reduce((s, d) => s + d.issuedValue, 0), report.departments.reduce((s, d) => s + d.returnedValue, 0),
    report.departments.reduce((s, d) => s + d.value, 0)],
];

export const reportFileName = (report: VppReport) => `XNT-VPP-${report.month}.xlsx`;

export const exportVppReport = async (report: VppReport) => {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();
  const xnt = XLSX.utils.aoa_to_sheet(xntSheetRows(report));
  xnt['!cols'] = [6, 9, 34, 7, 9, 9, 9, 9, 36, 11, 14].map(wch => ({ wch }));
  xnt['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } }];
  XLSX.utils.book_append_sheet(book, xnt, 'XNT');
  const people = XLSX.utils.aoa_to_sheet(peopleSheetRows(report));
  people['!cols'] = [26, 30, 9, 11, 11, 15].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(book, people, 'Theo người');
  const dept = XLSX.utils.aoa_to_sheet(deptSheetRows(report));
  dept['!cols'] = [30, 9, 9, 11, 11, 14, 12, 14].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(book, dept, 'Theo phòng ban');
  XLSX.writeFile(book, reportFileName(report));
};
