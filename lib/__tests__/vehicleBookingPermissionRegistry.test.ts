import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import { canAccessRoute } from '../routeAccess';
import { getPermissionModulesByLegacyKey } from '../permissions/permissionRegistry';

const bookingUser = (allowedModules: string[]): User => ({
  id: 'booking-user-1',
  name: 'Nguyễn Văn Booking',
  email: 'booking@example.com',
  role: Role.EMPLOYEE,
  allowedModules,
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
  permissionGrants: [],
});

describe('vehicle booking permission registry', () => {
  it('registers every protected vehicle booking route under VEHICLE_BOOKING', () => {
    const [module] = getPermissionModulesByLegacyKey('VEHICLE_BOOKING');

    expect(module?.routes).toEqual([
      '/booking/vehicle',
      '/booking/vehicle/my',
      '/booking/vehicle/approvals',
      '/booking/vehicle/dispatch',
      '/booking/vehicle/trips',
      '/booking/vehicle/handover',
      '/booking/vehicle/fleet',
      '/booking/vehicle/drivers',
      '/booking/vehicle/reports',
      '/booking/vehicle/settings',
    ]);
  });

  it('allows a legacy user assigned VEHICLE_BOOKING to open booking routes', () => {
    expect(canAccessRoute(bookingUser(['VEHICLE_BOOKING']), '/booking/vehicle/my')).toBe(true);
  });

  it('blocks a user without VEHICLE_BOOKING', () => {
    expect(canAccessRoute(bookingUser(['HRM']), '/booking/vehicle/my')).toBe(false);
  });
});
