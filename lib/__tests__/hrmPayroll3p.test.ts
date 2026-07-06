import { describe, expect, it } from 'vitest';
import {
  calculatePayroll3p,
  parseCompensationMatrixRows,
  parseEmployeeCompensationSeedRows,
} from '../hrmPayroll3p';

const matrixRows = [
  [],
  [],
  [],
  ['', 'TT', 'Chức danh', 'Nhóm', 'Cấp bậc', 'Lương P1\r\n(BHXH)', 'Lương P3 - Tiêu chuẩn', '', ''],
  ['', '', '', '', '', '', 'Bậc D1', 'Bậc B3', 'Bậc A4'],
  ['', '', '', '', '', '', ' 0.30 ', ' 2.07 ', ' 3.67 '],
  ['', '1', '• Chuyên viên QLDA', 'Nhân viên kĩ thuật', 'E5', ' 6,600,000 ', ' 2,000,000 ', ' 13,700,000 ', ' 24,300,000 '],
  ['', '2', '• Chuyên viên phiên dịch', 'Chuyên viên và Nhân viên quản lý chuyên môn', 'E4', ' 6,000,000 ', ' 1,800,000 ', ' 12,500,000 ', ' 22,100,000 '],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  ['', '', '', '', '', '', 'Hệ số KPI hàng tháng theo kết quả công việc'],
  ['', '', '', '', '', '', 'Mã hạng', 'Hạng A', 'Mã hạng', 'Hạng B', 'Mã hạng', 'Hạng C', 'Mã hạng', 'Hạng D'],
  ['', '', '', '', '', '', '', '> 1.06 → 1.20', '', '> 0.90 → 1.05', '', '> 0.75 → 0.89', '', '≥ 0.6 → 0.74'],
  ['', '', '', '', '', '', 'A1', '1.30', 'B1', '1.10', 'C1', '0.90', 'D1', '0.70'],
  ['', '', '', '', '', '', 'A2', '1.25', 'B2', '1.05', 'C2', '0.85', 'D2', '0.65'],
  ['', '', '', '', '', '', 'A3', '1.20', 'B3', '1.00', 'C3', '0.80', 'D3', '0.60'],
  ['', '', '', '', '', '', 'A4', '1.15', 'B4', '0.95', 'C4', '0.75', 'D4', '0.55'],
];

const seedRows = [
  ['STT', 'Mã NV', 'Họ và tên', 'Giới tính', 'Ngày sinh', 'Số CCCD', 'Ngày cấp CCCD', 'Nguyên quán', 'Địa chỉ thường trú', 'SĐT', 'Khối', 'Phòng/Bộ phận', 'Mã khối', 'Mã BP', 'Vị trí/chức danh công việc', 'Level', 'Nhóm VTCV ', 'Trình độ', 'Ngày vào', 'Ngày chính thức', 'Thâm niên (tháng)', 'Loại HĐLĐ', 'Ngày gia hạn HĐLĐ', 'Trạng thái LV', 'Ngày nghỉ việc', 'Lý do nghỉ / Ghi chú HĐ', 'Lương cơ bản (đ)', 'PC trách nhiệm (đ)', 'Tổng thu nhập (đ)', 'Mức lương đóng BHXH (đ)', 'Chênh lệch lương mới/cũ', 'Tổng P1+P3 tiêu chuẩn', 'Lương P1 (BHXH)', 'PC chức danh (đ)', 'PC điện thoại (đ)', 'Hệ số thu hút', 'Hỗ trợ\r\nthu hút (đ)', 'Số công thực tế', 'Hỗ trợ\r\năn ca (đ)', 'PC thâm niên (đ)', 'Bậc lương P3 - TC', 'Lương P3\r\ntiêu chuẩn', 'Tổng thu nhập (P1+P3+PC)', 'Lương căn cứ đóng BHXH', 'Trạng thái BHXH', 'Người phụ thuộc', 'Ngày điều chỉnh lương gần nhất', 'Cảnh báo / Xác minh'],
  ['1', 'TT0063', 'Vũ Trọng Hiệp', 'Nam', '', '', '', '', '', '', 'Văn phòng Hưng Yên', 'Phòng Quản lý Dự án', 'K1', 'QLDA', 'Chuyên viên QLDA', 'L5', 'CV', 'Đại học', '', '', '', '', '', 'Đang làm', '', '', '14,000,000', '4,000,000', '18,000,000', '5,100,000', '(300,000)', '17,700,000', '6,600,000', '450,000', '450,000', '-', '0', '26', '650,000', '100,000', 'Bậc B1', '11,100,000', '19,350,000', '7,150,000', 'Tham gia', '', '', ''],
  ['2', 'TT0071', 'Người trùng 1', 'Nam', '', '', '', '', '', '', 'NMSX', 'Nhà máy sản xuất', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'CN', 'Sơ cấp', '', '', '', '', '', 'Đang làm', '', '', '', '', '', '', '', '6,900,000', '5,300,000', '100,000', '100,000', '-', '0', '26', '650,000', '0', 'Bậc D1', '1,600,000', '7,750,000', '5,400,000', 'Tham gia', '', '', ''],
  ['3', 'TT0071', 'Người trùng 2', 'Nam', '', '', '', '', '', '', 'NMSX', 'Nhà máy sản xuất', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'CN', 'Sơ cấp', '', '', '', '', '', 'Đang làm', '', '', '', '', '', '', '', '6,900,000', '5,300,000', '100,000', '100,000', '-', '0', '26', '650,000', '0', 'Bậc D1', '1,600,000', '7,750,000', '5,400,000', 'Tham gia', '', '', ''],
  ['4', 'TT0130', 'Nguyễn Thị Thu Hồng', 'Nữ', '', '', '', '', '', '', 'VP Hà Nội', 'Phòng Hành chính Nhân sự', 'K4', 'VPHN', 'Nhân viên phiên dịch', '', '', 'Đại học', '', '', '', 'Thử việc', '', 'Đang làm', '', '', '18,000,000', '-', '18,000,000', '', '(18,000,000)', '-', '', '', '', '-', '0', '26', '650,000', '0', '', '', '650,000', '-', 'Chưa tham gia', '', '', ''],
];

describe('hrmPayroll3p', () => {
  it('parses the 2026 matrix with P1, P3 bands, and KPI B3 multiplier', () => {
    const result = parseCompensationMatrixRows(matrixRows);

    expect(result.bands.map(band => band.code)).toEqual(['D1', 'B3', 'A4']);
    expect(result.grades.find(grade => grade.code === 'E5')?.p1SalaryAmount).toBe(6600000);
    expect(result.rates.find(rate => rate.gradeCode === 'E5' && rate.bandCode === 'B3')?.p3StandardAmount).toBe(13700000);
    expect(result.kpiMultipliers.B3).toBe(1);
  });

  it('validates employee seed rows, detects duplicate codes, and defaults missing P3 to B3/E4 review', () => {
    const result = parseEmployeeCompensationSeedRows(seedRows, { defaultP3BandCode: 'B3', defaultGradeCode: 'E4' });

    expect(result.rows).toHaveLength(4);
    expect(result.duplicateEmployeeCodes).toEqual(['TT0071']);
    expect(result.rows.filter(row => row.employeeCode === 'TT0071').every(row => row.validationStatus === 'error')).toBe(true);

    const missing = result.rows.find(row => row.employeeCode === 'TT0130');
    expect(missing?.p3BandCode).toBe('B3');
    expect(missing?.gradeCode).toBe('E4');
    expect(missing?.reviewStatus).toBe('needs_review');
    expect(missing?.warnings).toContain('Thiếu bậc P3, mặc định B3.');
  });

  it('calculates immutable 3P payroll snapshots without P2', () => {
    const matrix = parseCompensationMatrixRows(matrixRows);
    const payroll = calculatePayroll3p({
      employeeId: 'emp-1',
      employeeCode: 'TT0063',
      employeeName: 'Vũ Trọng Hiệp',
      month: 7,
      year: 2026,
      standardDays: 26,
      workingDays: 26,
      gradeCode: 'E5',
      p3BandCode: 'B3',
      kpiBandCode: 'B3',
      recurringAllowances: {
        title: 450000,
        phone: 450000,
        attraction: 0,
        meal: 650000,
        seniority: 100000,
      },
      matrix,
    });

    expect(payroll.calculationMode).toBe('3p');
    expect(payroll.p1Salary).toBe(6600000);
    expect(payroll.p3StandardSalary).toBe(13700000);
    expect(payroll.p3ActualSalary).toBe(13700000);
    expect(payroll.recurringAllowanceTotal).toBe(1650000);
    expect(payroll.grossSalary).toBe(21950000);
    expect(payroll.netSalary).toBe(21950000);
    expect(payroll.calculationSnapshot).not.toHaveProperty('p2');
  });
});
