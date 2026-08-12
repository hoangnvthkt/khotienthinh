import type * as Xlsx from 'xlsx';
import type {
  VehicleBookingAnalytics,
  VehicleBookingAnalyticsExportRow,
} from '../types';

type XlsxModule = typeof Xlsx;

const DETAIL_HEADERS = [
  'Mã đơn',
  'Phòng ban',
  'Giờ yêu cầu',
  'Giờ đón thực tế',
  'Giờ trả thực tế',
  'Hình thức',
  'Mã xe',
  'Tên xe',
  'Quãng đường (km)',
  'Chi phí xe ngoài (VND)',
  'Trạng thái',
  'Lý do đóng',
  'Đúng giờ',
] as const;

const formatVietnamDateTime = (value: string | null): string => value
  ? new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
  : '';

const fulfillmentLabel = (value: VehicleBookingAnalyticsExportRow['fulfillmentType']): string => ({
  INTERNAL_WITH_DRIVER: 'Xe nội bộ có tài xế',
  INTERNAL_SELF_DRIVE: 'Xe nội bộ tự lái',
  EXTERNAL_TRANSPORT: 'Xe ngoài / Taxi',
} as Record<string, string>)[value || ''] || '';

const toDetailValues = (row: VehicleBookingAnalyticsExportRow): Array<string | number> => [
  row.bookingCode,
  row.departmentName,
  formatVietnamDateTime(row.requestedPickupAt),
  formatVietnamDateTime(row.actualPickupAt),
  formatVietnamDateTime(row.actualReturnAt),
  fulfillmentLabel(row.fulfillmentType),
  row.vehicleCode || '',
  row.vehicleName || '',
  row.distanceKm ?? '',
  row.externalActualCost ?? '',
  row.status,
  row.closeReason || '',
  row.isOnTime === null ? '' : row.isOnTime ? 'Có' : 'Không',
];

export function buildVehicleBookingAnalyticsWorkbook(
  XLSX: XlsxModule,
  analytics: VehicleBookingAnalytics,
  rows: VehicleBookingAnalyticsExportRow[],
): Xlsx.WorkBook {
  const summary = [
    ['BÁO CÁO VẬN HÀNH ĐẶT XE'],
    ['Từ', formatVietnamDateTime(analytics.period.fromAt)],
    ['Đến (không bao gồm)', formatVietnamDateTime(analytics.period.toAt)],
    [],
    ['Chỉ số', 'Giá trị'],
    ['Chuyến hoàn thành', analytics.kpis.completedTrips],
    ['Chuyến đúng giờ', analytics.kpis.onTimeTrips],
    ['Mẫu số đúng giờ', analytics.kpis.onTimeEligibleTrips],
    ['Tỷ lệ đúng giờ (%)', analytics.kpis.onTimeRate ?? ''],
    ['Booking đã gửi', analytics.kpis.submittedBookings],
    ['Hủy sát giờ', analytics.kpis.lateCancelledBookings],
    ['Tỷ lệ hủy sát giờ (%)', analytics.kpis.lateCancellationRate ?? ''],
    ['Phút sử dụng xe', analytics.kpis.usedVehicleMinutes],
    ['Phút năng lực khả dụng', analytics.kpis.availableVehicleMinutes],
    ['Công suất sử dụng (%)', analytics.kpis.vehicleUtilizationRate ?? ''],
    [],
    ['Ghi chú', 'Năng lực dùng trạng thái active hiện tại của đội xe công ty.'],
  ];
  const detail = [[...DETAIL_HEADERS], ...rows.map(toDetailValues)];
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  const detailSheet = XLSX.utils.aoa_to_sheet(detail);
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 32 }];
  detailSheet['!cols'] = [
    { wch: 16 }, { wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
    { wch: 24 }, { wch: 14 }, { wch: 24 }, { wch: 18 }, { wch: 24 },
    { wch: 16 }, { wch: 22 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Tong hop');
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Chi tiet');
  return workbook;
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildVehicleBookingAnalyticsCsv(
  rows: VehicleBookingAnalyticsExportRow[],
): string {
  const lines = [
    DETAIL_HEADERS.map(csvCell).join(','),
    ...rows.map(row => toDetailValues(row).map(csvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}
