import { describe, expect, it } from 'vitest';
import type { User } from '../../types';
import * as bookingService from '../vehicleBookingService';
import * as bookingPermissions from '../vehicleBookingPermissions';

const service = bookingService as typeof bookingService & {
  mergeFleetSystemSettings: (current: any, patch: Record<string, unknown>) => Record<string, unknown>;
  buildFleetVehicleProfileUpdate: (current: any, patch: Record<string, unknown>) => Record<string, unknown>;
};

const activeGrant = (permissionCode: string) => ({
  id: permissionCode,
  permissionCode,
  scopeType: 'global',
  scopeId: '*',
  isActive: true,
});

describe('fleet settings and master-data safety', () => {
  it('preserves all ten Cloud settings when only visible fields are edited', () => {
    const current = {
      booking_buffer_minutes: 30,
      late_cancellation_cutoff_minutes: 120,
      feedback_auto_close_hours: 24,
      home_base_warning_radius_meters: 850,
      on_time_tolerance_minutes: 20,
      trip_reminder_minutes: 45,
      max_evidence_image_mb: 7.5,
      require_handover_for_self_drive: false,
      allow_dispatch_approval_override: false,
      require_direct_manager_approval: true,
    };

    expect(service.mergeFleetSystemSettings).toBeTypeOf('function');
    expect(service.mergeFleetSystemSettings(current, {
      booking_buffer_minutes: 40,
      max_evidence_image_mb: 6,
    })).toEqual({
      ...current,
      booking_buffer_minutes: 40,
      max_evidence_image_mb: 6,
    });
  });

  it('retains the vehicle home base and untouched profile fields during an edit', () => {
    const current = {
      asset_id: 'CAR-01',
      home_base_id: 'location-01',
      vehicle_type: 'SUV',
      seat_count: 7,
      availability_status: 'AVAILABLE',
      allow_self_drive: true,
      inspection_certificate_number: 'CERT-1',
      inspection_expiry_date: '2027-01-01',
      inspection_photo_path: 'fleet/CAR-01/cert.jpg',
      insurance_expiry_date: '2027-02-01',
      parking_spot_code: 'BAY-A01',
    };

    expect(service.buildFleetVehicleProfileUpdate).toBeTypeOf('function');
    expect(service.buildFleetVehicleProfileUpdate(current, { parking_spot_code: 'BAY-A02' })).toEqual({
      ...current,
      parking_spot_code: 'BAY-A02',
    });
  });
});

describe('vehicle booking sensitive navigation permissions', () => {
  it('shows the approval queue to a snapshot manager even without a sensitive grant', () => {
    const manager = { id: 'manager-1', permissionGrants: [] } as Pick<User, 'id' | 'permissionGrants'>;
    const users = [
      { id: 'employee-1', managerId: 'manager-1' },
      { id: 'employee-2', managerId: 'manager-2' },
    ] as Array<Pick<User, 'id' | 'managerId'>>;

    expect(bookingPermissions.canAccessVehicleApprovalQueue).toBeTypeOf('function');
    expect(bookingPermissions.canAccessVehicleApprovalQueue(manager, users)).toBe(true);
    expect(bookingPermissions.canAccessVehicleApprovalQueue(
      { id: 'employee-1', permissionGrants: [] },
      users,
    )).toBe(false);
  });

  it('requires explicit grants from ADMIN and normal users alike', () => {
    const user = (permissionGrants: any[] = [], role = 'EMPLOYEE') => ({
      role,
      permissionGrants,
    }) as Pick<User, 'role' | 'permissionGrants'>;

    expect(bookingPermissions.hasActiveVehicleBookingGrant).toBeTypeOf('function');
    expect(bookingPermissions.hasActiveVehicleBookingGrant(user([], 'ADMIN'), ['booking.vehicle.dispatch'])).toBe(false);
    expect(bookingPermissions.hasActiveVehicleBookingGrant(user(), ['booking.vehicle.dispatch'])).toBe(false);
    expect(bookingPermissions.hasActiveVehicleBookingGrant(
      user([activeGrant('booking.vehicle.dispatch')]),
      ['booking.vehicle.dispatch'],
    )).toBe(true);
    expect(bookingPermissions.hasActiveVehicleBookingGrant(
      user([activeGrant('booking.vehicle.admin')]),
      ['booking.vehicle.manage_fleet'],
    )).toBe(true);
    expect(bookingPermissions.hasActiveVehicleBookingGrant(
      user([{ ...activeGrant('booking.vehicle.dispatch'), expiresAt: '2020-01-01T00:00:00.000Z' }]),
      ['booking.vehicle.dispatch'],
    )).toBe(false);
  });
});
