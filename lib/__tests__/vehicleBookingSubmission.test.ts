import { describe, expect, it } from 'vitest';
import * as presentation from '../vehicleBookingPresentation';

const submission = presentation as typeof presentation & {
  mapVehicleBookingSubmissionError?: (error: unknown) => { code: string; message: string };
  getVehicleBookingSubmitSuccessMessage?: (
    route: 'MANAGER' | 'CONFIG_DISABLED' | 'MISSING_MANAGER_BYPASS',
    bookingCode: string,
  ) => string;
};

describe('vehicle booking submission presentation', () => {
  it('maps a missing dispatcher to actionable Vietnamese guidance', () => {
    expect(submission.mapVehicleBookingSubmissionError).toBeTypeOf('function');
    expect(submission.mapVehicleBookingSubmissionError!({
      message: 'VEHICLE_DISPATCHER_MISSING',
    })).toEqual({
      code: 'VEHICLE_DISPATCHER_MISSING',
      message: 'Hệ thống chưa có Điều phối viên đặt xe đang hoạt động. Vui lòng liên hệ quản trị Booking.',
    });
  });

  it('uses route-specific success messages', () => {
    expect(submission.getVehicleBookingSubmitSuccessMessage).toBeTypeOf('function');
    expect(submission.getVehicleBookingSubmitSuccessMessage!('MANAGER', 'CAR-001'))
      .toBe('Đã gửi CAR-001 đến quản lý trực tiếp để phê duyệt.');
    expect(submission.getVehicleBookingSubmitSuccessMessage!('MISSING_MANAGER_BYPASS', 'CAR-001'))
      .toBe('Đã gửi CAR-001 thẳng đến bộ phận Điều phối.');
    expect(submission.getVehicleBookingSubmitSuccessMessage!('CONFIG_DISABLED', 'CAR-001'))
      .toBe('Đã gửi CAR-001 thẳng đến bộ phận Điều phối.');
  });
});
