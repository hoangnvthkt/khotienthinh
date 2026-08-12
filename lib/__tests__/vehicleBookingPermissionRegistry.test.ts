import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import { canAccessRoute } from '../routeAccess';
import {
  getPermissionApplications,
  getPermissionModulesByLegacyKey,
} from '../permissions/permissionRegistry';
import { canViewModule } from '../permissions/permissionService';

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
      '/booking/vehicle/issues',
      '/booking/vehicle/audit',
      '/booking/vehicle/settings',
    ]);
  });

  it('registers all granular vehicle booking permissions for the admin matrix', () => {
    const application = getPermissionApplications().find(item => item.code === 'resource_booking');
    const module = application?.modules.find(item => item.code === 'resource_booking.vehicle');

    expect(module?.actions.map(action => action.permissionCode)).toEqual([
      'booking.vehicle.create',
      'booking.vehicle.view_own',
      'booking.vehicle.approve_direct_reports',
      'booking.vehicle.dispatch',
      'booking.vehicle.trip.execute',
      'booking.vehicle.handover',
      'booking.vehicle.manage_authorizations',
      'booking.vehicle.manage_fleet',
      'booking.vehicle.view_reports',
      'booking.vehicle.view_sensitive_feedback',
      'booking.vehicle.resolve_sensitive_feedback',
      'booking.vehicle.view_audit',
      'booking.vehicle.admin',
    ]);
    expect(module?.actions.find(action => action.permissionCode === 'booking.vehicle.view_audit')?.scopeTypes)
      .toEqual(['global', 'department']);
    expect(module?.actions.find(action => action.permissionCode === 'booking.vehicle.resolve_sensitive_feedback')?.scopeTypes)
      .toEqual(['global']);
  });

  it('allows every authenticated app user to open the basic booking module', () => {
    const user = bookingUser(['HRM']);

    expect(canViewModule(user, 'VEHICLE_BOOKING')).toBe(true);
    expect(canAccessRoute(user, '/booking/vehicle')).toBe(true);
    expect(canAccessRoute(user, '/booking/vehicle/my')).toBe(true);
    expect(canAccessRoute(user, '/booking/vehicle/trips')).toBe(true);
  });

  it('keeps legacy VEHICLE_BOOKING access compatible', () => {
    expect(canAccessRoute(bookingUser(['VEHICLE_BOOKING']), '/booking/vehicle/my')).toBe(true);
  });
});
