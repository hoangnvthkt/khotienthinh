import { describe, expect, it } from 'vitest';
import * as bookingService from '../vehicleBookingService';

const service = bookingService as typeof bookingService & {
  getVietnamDayRange: (reference: Date | string) => { startIso: string; endIso: string };
  selectVehicleHandoverQueue: (input: {
    bookings: any[];
    assignments: any[];
    handovers: any[];
  }) => Array<{ booking: any; assignment: any; action: 'OUTBOUND' | 'RETURN' }>;
  getDispatchValidationError: (input: {
    bookingStatus: string;
    fulfillmentType: string;
    vehicleAssetId?: string;
    operatorUserId?: string;
    handoverOfficerUserId?: string;
    overrideReason?: string;
    externalServiceType?: string;
  }) => string | null;
  getVehicleOperationalStatus: (
    profile: { active: boolean; availability_status: string; custody_status: string },
    flags?: { busy?: boolean; unavailable?: boolean },
  ) => 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' | 'IN_CUSTODY' | 'INACTIVE';
  getOperatorOperationalStatus: (
    eligible: boolean,
    flags?: { busy?: boolean; unavailable?: boolean },
  ) => 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' | 'INELIGIBLE';
  isDriverCompatibleWithVehicle: (
    driver: { authorization_type: string; allowed_vehicle_types?: string[] | null },
    vehicleType?: string | null,
  ) => boolean;
  getDispatchErrorMessage: (
    error: unknown,
    context?: { driverName?: string | null; vehicleType?: string | null },
  ) => string;
  selectCompatibleProfessionalDrivers: <T extends {
    authorization_type: string;
    allowed_vehicle_types?: string[] | null;
  }>(drivers: T[], vehicleType?: string | null) => T[];
  selectCompatibleSelfDrivers: <T extends {
    authorization_type: string;
    allowed_vehicle_types?: string[] | null;
  }>(drivers: T[], vehicleType?: string | null) => T[];
  selectActionableDriverAssignmentRows: <T extends {
    id: string;
    booking_id: string;
    is_active: boolean;
    reserved_start_at: string;
  }>(input: {
    assignments: T[];
    bookings: Array<{ id: string; status: string }>;
    referenceDate: Date | string;
  }) => T[];
  isDriverTripOverdue: (
    booking: { status: string; expected_return_at: string },
    referenceDate: Date | string,
  ) => boolean;
  getBookingResourceConflictSets: (input: {
    booking: { requested_pickup_at: string; expected_return_at: string };
    bufferMinutes: number;
    assignments: Array<{
      vehicle_asset_id?: string | null;
      operator_user_id?: string | null;
      reserved_start_at: string;
      reserved_end_at: string;
      is_active?: boolean;
      released_at?: string | null;
    }>;
    vehicleUnavailability: Array<{ vehicle_asset_id: string; start_at: string; end_at: string }>;
    operatorUnavailability: Array<{ operator_user_id: string; start_at: string; end_at: string }>;
  }) => {
    busyVehicleIds: Set<string>;
    busyOperatorIds: Set<string>;
    unavailableVehicleIds: Set<string>;
    unavailableOperatorIds: Set<string>;
  };
  selectBookingsAwaitingReassignment: (
    assignments: Array<{
      booking_id: string;
      is_active: boolean;
      operator_confirmation_status: string;
    }>,
  ) => Set<string>;
};

describe('vehicle booking operational rules', () => {
  it('calculates the current Vietnam calendar day independently of machine timezone', () => {
    expect(service.getVietnamDayRange).toBeTypeOf('function');
    expect(service.getVietnamDayRange('2026-08-12T10:30:00.000Z')).toEqual({
      startIso: '2026-08-11T17:00:00.000Z',
      endIso: '2026-08-12T17:00:00.000Z',
    });
  });

  it('selects only actionable self-drive handovers', () => {
    expect(service.selectVehicleHandoverQueue).toBeTypeOf('function');
    const assignments = [
      { id: 'a-out', booking_id: 'b-out', is_active: true, fulfillment_type: 'INTERNAL_SELF_DRIVE' },
      { id: 'a-return', booking_id: 'b-return', is_active: true, fulfillment_type: 'INTERNAL_SELF_DRIVE' },
      { id: 'a-done', booking_id: 'b-done', is_active: true, fulfillment_type: 'INTERNAL_SELF_DRIVE' },
      { id: 'a-driver', booking_id: 'b-driver', is_active: true, fulfillment_type: 'INTERNAL_WITH_DRIVER' },
    ];
    const bookings = [
      { id: 'b-out', status: 'ASSIGNED' },
      { id: 'b-return', status: 'COMPLETED' },
      { id: 'b-done', status: 'COMPLETED' },
      { id: 'b-driver', status: 'ASSIGNED' },
    ];
    const handovers = [
      { assignment_id: 'a-return', event_type: 'OUTBOUND_HANDOVER' },
      { assignment_id: 'a-done', event_type: 'OUTBOUND_HANDOVER' },
      { assignment_id: 'a-done', event_type: 'RETURN_RECEIPT' },
    ];

    expect(service.selectVehicleHandoverQueue({ bookings, assignments, handovers })).toEqual([
      { booking: bookings[0], assignment: assignments[0], action: 'OUTBOUND' },
      { booking: bookings[1], assignment: assignments[1], action: 'RETURN' },
    ]);
  });

  it('requires a complete dispatch payload before opening the mutation boundary', () => {
    expect(service.getDispatchValidationError).toBeTypeOf('function');
    expect(service.getDispatchValidationError({
      bookingStatus: 'PENDING_APPROVAL',
      fulfillmentType: 'INTERNAL_WITH_DRIVER',
      vehicleAssetId: 'CAR-1',
      operatorUserId: 'driver-1',
    })).toBe('OVERRIDE_REASON_REQUIRED');
    expect(service.getDispatchValidationError({
      bookingStatus: 'WAITING_DISPATCH',
      fulfillmentType: 'INTERNAL_SELF_DRIVE',
      operatorUserId: 'employee-1',
      handoverOfficerUserId: 'officer-1',
    })).toBe('VEHICLE_REQUIRED');
    expect(service.getDispatchValidationError({
      bookingStatus: 'WAITING_DISPATCH',
      fulfillmentType: 'EXTERNAL_TRANSPORT',
    })).toBe('EXTERNAL_SERVICE_TYPE_REQUIRED');
    expect(service.getDispatchValidationError({
      bookingStatus: 'WAITING_DISPATCH',
      fulfillmentType: 'INTERNAL_SELF_DRIVE',
      vehicleAssetId: 'CAR-1',
      operatorUserId: 'employee-1',
      handoverOfficerUserId: 'officer-1',
    })).toBeNull();
  });

  it('derives honest vehicle and operator availability labels', () => {
    expect(service.getVehicleOperationalStatus).toBeTypeOf('function');
    expect(service.getOperatorOperationalStatus).toBeTypeOf('function');
    const availableVehicle = { active: true, availability_status: 'AVAILABLE', custody_status: 'AVAILABLE' };

    expect(service.getVehicleOperationalStatus(availableVehicle)).toBe('AVAILABLE');
    expect(service.getVehicleOperationalStatus(availableVehicle, { busy: true })).toBe('BUSY');
    expect(service.getVehicleOperationalStatus(availableVehicle, { unavailable: true })).toBe('UNAVAILABLE');
    expect(service.getVehicleOperationalStatus({ ...availableVehicle, custody_status: 'IN_CUSTODY' })).toBe('IN_CUSTODY');
    expect(service.getVehicleOperationalStatus({ ...availableVehicle, availability_status: 'MAINTENANCE' })).toBe('UNAVAILABLE');
    expect(service.getOperatorOperationalStatus(true)).toBe('AVAILABLE');
    expect(service.getOperatorOperationalStatus(true, { busy: true })).toBe('BUSY');
    expect(service.getOperatorOperationalStatus(true, { unavailable: true })).toBe('UNAVAILABLE');
    expect(service.getOperatorOperationalStatus(false)).toBe('INELIGIBLE');
  });

  it('only accepts a professional driver explicitly authorized for the selected fleet vehicle type', () => {
    expect(service.isDriverCompatibleWithVehicle).toBeTypeOf('function');

    expect(service.isDriverCompatibleWithVehicle({
      authorization_type: 'PROFESSIONAL_DRIVER',
      allowed_vehicle_types: ['Xe con', 'Xe tải thùng'],
    }, 'Xe tải thùng')).toBe(true);
    expect(service.isDriverCompatibleWithVehicle({
      authorization_type: 'PROFESSIONAL_DRIVER',
      allowed_vehicle_types: ['Xe con', 'xe tải 500kg'],
    }, 'Xe tải thùng')).toBe(false);
    expect(service.isDriverCompatibleWithVehicle({
      authorization_type: 'SELF_DRIVE',
      allowed_vehicle_types: ['Xe tải thùng'],
    }, 'Xe tải thùng')).toBe(false);
  });

  it('translates a vehicle-type mismatch into an actionable Vietnamese dispatch error', () => {
    expect(service.getDispatchErrorMessage).toBeTypeOf('function');
    expect(service.getDispatchErrorMessage(
      new Error('DRIVER_LICENSE_CLASS_MISMATCH'),
      { driverName: 'Nguyễn Văn Hoàng', vehicleType: 'Xe tải thùng' },
    )).toBe('Nguyễn Văn Hoàng chưa được ủy quyền lái loại xe Xe tải thùng. Vui lòng cập nhật hồ sơ tài xế hoặc chọn tài xế khác.');
    expect(service.getDispatchErrorMessage(new Error('VEHICLE_UNAVAILABLE')))
      .toBe('VEHICLE_UNAVAILABLE');
  });

  it('translates concurrent assignment conflicts into actionable Vietnamese errors', () => {
    expect(service.getDispatchErrorMessage(
      new Error('conflicting key value violates exclusion constraint "no_vehicle_assignment_overlap"'),
    )).toBe('Xe vừa được xếp cho một chuyến khác trong cùng khung giờ. Danh sách đã được làm mới, vui lòng chọn xe khác.');
    expect(service.getDispatchErrorMessage({
      code: '23P01',
      message: 'conflicting key value violates exclusion constraint "no_operator_assignment_overlap"',
    })).toBe('Tài xế vừa được xếp cho một chuyến khác trong cùng khung giờ. Danh sách đã được làm mới, vui lòng chọn tài xế khác.');
    expect(service.getDispatchErrorMessage(new Error('OPERATOR_ALREADY_IN_PROGRESS')))
      .toBe('Tài xế đang thực hiện một chuyến khác. Hãy kết thúc chuyến đang chạy trước khi bắt đầu chuyến này.');
    expect(service.getDispatchErrorMessage(new Error(
      'duplicate key value violates unique constraint "vehicle_trip_logs_one_active_trip_per_operator"',
    ))).toBe('Tài xế đang thực hiện một chuyến khác. Hãy kết thúc chuyến đang chạy trước khi bắt đầu chuyến này.');
  });

  it('calculates vehicle and operator conflicts for the selected booking interval including buffer', () => {
    expect(service.getBookingResourceConflictSets).toBeTypeOf('function');
    const conflicts = service.getBookingResourceConflictSets({
      booking: {
        requested_pickup_at: '2026-08-15T02:00:00.000Z',
        expected_return_at: '2026-08-15T04:00:00.000Z',
      },
      bufferMinutes: 30,
      assignments: [
        {
          vehicle_asset_id: 'vehicle-overlap',
          operator_user_id: 'driver-overlap',
          reserved_start_at: '2026-08-15T04:15:00.000Z',
          reserved_end_at: '2026-08-15T05:00:00.000Z',
          is_active: true,
        },
        {
          vehicle_asset_id: 'vehicle-boundary',
          operator_user_id: 'driver-boundary',
          reserved_start_at: '2026-08-15T04:30:00.000Z',
          reserved_end_at: '2026-08-15T05:00:00.000Z',
          is_active: true,
        },
        {
          vehicle_asset_id: 'vehicle-released',
          operator_user_id: 'driver-released',
          reserved_start_at: '2026-08-15T03:00:00.000Z',
          reserved_end_at: '2026-08-15T04:00:00.000Z',
          is_active: false,
          released_at: '2026-08-15T01:00:00.000Z',
        },
      ],
      vehicleUnavailability: [
        { vehicle_asset_id: 'vehicle-maintenance', start_at: '2026-08-15T03:00:00.000Z', end_at: '2026-08-15T03:30:00.000Z' },
      ],
      operatorUnavailability: [
        { operator_user_id: 'driver-leave', start_at: '2026-08-15T01:00:00.000Z', end_at: '2026-08-15T02:15:00.000Z' },
      ],
    });

    expect([...conflicts.busyVehicleIds]).toEqual(['vehicle-overlap']);
    expect([...conflicts.busyOperatorIds]).toEqual(['driver-overlap']);
    expect([...conflicts.unavailableVehicleIds]).toEqual(['vehicle-maintenance']);
    expect([...conflicts.unavailableOperatorIds]).toEqual(['driver-leave']);
  });

  it('marks a waiting booking with a declined historical assignment as needing reassignment', () => {
    expect(service.selectBookingsAwaitingReassignment).toBeTypeOf('function');
    expect([...service.selectBookingsAwaitingReassignment([
      { booking_id: 'declined', is_active: false, operator_confirmation_status: 'DECLINED' },
      { booking_id: 'pending', is_active: true, operator_confirmation_status: 'PENDING' },
      { booking_id: 'confirmed', is_active: false, operator_confirmation_status: 'CONFIRMED' },
    ])]).toEqual(['declined']);
  });

  it('offers only compatible professional drivers after a fleet vehicle is selected', () => {
    expect(service.selectCompatibleProfessionalDrivers).toBeTypeOf('function');
    const drivers = [
      { user_id: 'driver-box', authorization_type: 'PROFESSIONAL_DRIVER', allowed_vehicle_types: ['Xe tải thùng'] },
      { user_id: 'driver-light', authorization_type: 'PROFESSIONAL_DRIVER', allowed_vehicle_types: ['xe tải 500kg'] },
      { user_id: 'self-driver', authorization_type: 'SELF_DRIVE', allowed_vehicle_types: ['Xe tải thùng'] },
    ];

    expect(service.selectCompatibleProfessionalDrivers(drivers, 'Xe tải thùng'))
      .toEqual([drivers[0]]);
    expect(service.selectCompatibleProfessionalDrivers(drivers, null)).toEqual([]);
  });

  it('offers only compatible self-driving employees after a fleet vehicle is selected', () => {
    expect(service.selectCompatibleSelfDrivers).toBeTypeOf('function');
    const drivers = [
      { user_id: 'professional', authorization_type: 'PROFESSIONAL_DRIVER', allowed_vehicle_types: ['Xe Carnival Trắng'] },
      { user_id: 'do', authorization_type: 'SELF_DRIVE', allowed_vehicle_types: ['Xe Carnival Trắng'] },
      { user_id: 'other-self-driver', authorization_type: 'SELF_DRIVE', allowed_vehicle_types: ['Xe tải thùng'] },
    ];

    expect(service.selectCompatibleSelfDrivers(drivers, 'Xe Carnival Trắng'))
      .toEqual([drivers[1]]);
    expect(service.selectCompatibleSelfDrivers(drivers, null)).toEqual([]);
  });

  it('keeps an overdue in-progress trip actionable after its scheduled day has passed', () => {
    expect(service.selectActionableDriverAssignmentRows).toBeTypeOf('function');
    const assignments = [
      { id: 'overdue-running', booking_id: 'booking-running', is_active: true, reserved_start_at: '2026-08-12T06:53:00.000Z' },
      { id: 'overdue-assigned', booking_id: 'booking-old-assigned', is_active: true, reserved_start_at: '2026-08-12T06:53:00.000Z' },
      { id: 'today-assigned', booking_id: 'booking-today', is_active: true, reserved_start_at: '2026-08-15T03:00:00.000Z' },
      { id: 'inactive-running', booking_id: 'booking-inactive', is_active: false, reserved_start_at: '2026-08-12T06:53:00.000Z' },
    ];
    const bookings = [
      { id: 'booking-running', status: 'IN_PROGRESS' },
      { id: 'booking-old-assigned', status: 'ASSIGNED' },
      { id: 'booking-today', status: 'ASSIGNED' },
      { id: 'booking-inactive', status: 'IN_PROGRESS' },
    ];

    expect(service.selectActionableDriverAssignmentRows({
      assignments,
      bookings,
      referenceDate: '2026-08-15T07:00:00.000Z',
    })).toEqual([assignments[0], assignments[2]]);
  });

  it('marks only an in-progress trip past its expected return as overdue', () => {
    expect(service.isDriverTripOverdue).toBeTypeOf('function');
    expect(service.isDriverTripOverdue({
      status: 'IN_PROGRESS',
      expected_return_at: '2026-08-12T10:53:00.000Z',
    }, '2026-08-15T07:00:00.000Z')).toBe(true);
    expect(service.isDriverTripOverdue({
      status: 'COMPLETED',
      expected_return_at: '2026-08-12T10:53:00.000Z',
    }, '2026-08-15T07:00:00.000Z')).toBe(false);
    expect(service.isDriverTripOverdue({
      status: 'IN_PROGRESS',
      expected_return_at: '2026-08-15T08:00:00.000Z',
    }, '2026-08-15T07:00:00.000Z')).toBe(false);
  });
});
