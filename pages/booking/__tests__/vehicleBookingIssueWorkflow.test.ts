import { describe, expect, it } from 'vitest';
import {
  getVehicleBookingIssueTransitions,
  validateVehicleBookingIssueTransition,
} from '../../../lib/vehicleBookingIssueService';

describe('vehicle booking issue workflow', () => {
  it('allows only the strict forward state machine', () => {
    expect(getVehicleBookingIssueTransitions('PENDING')).toEqual(['IN_REVIEW']);
    expect(getVehicleBookingIssueTransitions('IN_REVIEW')).toEqual(['RESOLVED', 'DISMISSED']);
    expect(getVehicleBookingIssueTransitions('RESOLVED')).toEqual([]);
    expect(getVehicleBookingIssueTransitions('DISMISSED')).toEqual([]);
  });

  it('requires a resolution note for final states', () => {
    expect(validateVehicleBookingIssueTransition('IN_REVIEW', 'RESOLVED', '')).toBe('Vui lòng ghi nhận kết quả xử lý.');
    expect(validateVehicleBookingIssueTransition('IN_REVIEW', 'DISMISSED', 'Không đủ cơ sở.')).toBeNull();
  });

  it('rejects invalid transitions and overlong notes', () => {
    expect(validateVehicleBookingIssueTransition('PENDING', 'RESOLVED', 'Xong')).toBe('Trạng thái xử lý không hợp lệ.');
    expect(validateVehicleBookingIssueTransition('IN_REVIEW', 'RESOLVED', 'x'.repeat(4001))).toBe('Kết quả xử lý không được vượt quá 4.000 ký tự.');
  });
});
