import { describe, expect, it } from 'vitest';
import type { User } from '../../types';
import * as bookingService from '../vehicleBookingService';
import * as bookingPermissions from '../vehicleBookingPermissions';

const service = bookingService as typeof bookingService & {
  mergeFleetSystemSettings: (current: any, patch: Record<string, unknown>) => Record<string, unknown>;
  buildFleetVehicleProfileUpdate: (current: any, patch: Record<string, unknown>) => Record<string, unknown>;
  getDriverAuthorizationEvidenceValidationError: (input: {
    licenseFrontPhotoPath?: string | null;
    licenseBackPhotoPath?: string | null;
  }) => 'LICENSE_FRONT_PHOTO_REQUIRED' | 'LICENSE_BACK_PHOTO_REQUIRED' | null;
  getFleetInspectionEvidenceValidationError: (input: {
    inspectionCertificateNumber?: string | null;
    inspectionExpiryDate?: string | null;
    inspectionPhotoPath?: string | null;
  }) => 'INSPECTION_PHOTO_REQUIRED' | null;
  resolvePrivateEvidencePreviewItems: (
    items: Array<{ label: string; path?: string | null }>,
    signer: (path: string) => Promise<string>,
  ) => Promise<Array<{ label: string; url: string }>>;
};

const activeGrant = (permissionCode: string) => ({
  id: permissionCode,
  permissionCode,
  scopeType: 'global',
  scopeId: '*',
  isActive: true,
});

describe('fleet settings and master-data safety', () => {
  it('requires both driver-license images before an authorization can be saved', () => {
    expect(service.getDriverAuthorizationEvidenceValidationError).toBeTypeOf('function');
    expect(service.getDriverAuthorizationEvidenceValidationError({
      licenseFrontPhotoPath: null,
      licenseBackPhotoPath: null,
    })).toBe('LICENSE_FRONT_PHOTO_REQUIRED');
    expect(service.getDriverAuthorizationEvidenceValidationError({
      licenseFrontPhotoPath: 'licenses/driver/front.jpg',
      licenseBackPhotoPath: null,
    })).toBe('LICENSE_BACK_PHOTO_REQUIRED');
    expect(service.getDriverAuthorizationEvidenceValidationError({
      licenseFrontPhotoPath: 'licenses/driver/front.jpg',
      licenseBackPhotoPath: 'licenses/driver/back.jpg',
    })).toBeNull();
  });

  it('requires an inspection image when a fleet profile contains inspection data', () => {
    expect(service.getFleetInspectionEvidenceValidationError).toBeTypeOf('function');
    expect(service.getFleetInspectionEvidenceValidationError({
      inspectionExpiryDate: '2027-04-16',
      inspectionPhotoPath: null,
    })).toBe('INSPECTION_PHOTO_REQUIRED');
    expect(service.getFleetInspectionEvidenceValidationError({
      inspectionCertificateNumber: 'CERT-003',
      inspectionPhotoPath: 'fleet/TS-003/inspection.jpg',
    })).toBeNull();
    expect(service.getFleetInspectionEvidenceValidationError({
      inspectionPhotoPath: null,
    })).toBeNull();
  });

  it('resolves only saved private evidence into temporary view URLs', async () => {
    expect(service.resolvePrivateEvidencePreviewItems).toBeTypeOf('function');

    await expect(service.resolvePrivateEvidencePreviewItems([
      { label: 'Mặt trước', path: 'licenses/user/front.jpg' },
      { label: 'Mặt sau', path: null },
      { label: 'Ảnh lỗi', path: 'licenses/user/broken.jpg' },
    ], async path => path.endsWith('broken.jpg') ? '' : `https://signed.example/${path}`)).resolves.toEqual([
      { label: 'Mặt trước', url: 'https://signed.example/licenses/user/front.jpg' },
    ]);
  });

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

  it('restores full Booking access for system ADMIN while normal users require grants', () => {
    const user = (permissionGrants: any[] = [], role = 'EMPLOYEE') => ({
      role,
      permissionGrants,
    }) as Pick<User, 'role' | 'permissionGrants'>;

    expect(bookingPermissions.hasActiveVehicleBookingGrant).toBeTypeOf('function');
    expect(bookingPermissions.hasActiveVehicleBookingGrant(user([], 'ADMIN'), ['booking.vehicle.dispatch'])).toBe(true);
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
