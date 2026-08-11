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
});
