import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import {
  canResolveSensitiveVehicleIssues,
  canViewSensitiveVehicleIssues,
  canViewVehicleAudit,
  canViewVehicleReports,
} from '../vehicleBookingPermissions';

const userWith = (permissionCode?: string, expiresAt?: string) => ({
  permissionGrants: permissionCode ? [{
    id: permissionCode,
    permissionCode,
    scopeType: 'global',
    scopeId: '*',
    isActive: true,
    expiresAt,
  }] : [],
}) as Pick<User, 'permissionGrants'>;

describe('vehicle booking phase 3 permission helpers', () => {
  it('lets a system ADMIN use every booking capability without explicit grants', () => {
    const admin = { role: Role.ADMIN, permissionGrants: [] } as Pick<User, 'role' | 'permissionGrants'>;

    expect(canViewVehicleReports(admin)).toBe(true);
    expect(canViewSensitiveVehicleIssues(admin)).toBe(true);
    expect(canResolveSensitiveVehicleIssues(admin)).toBe(true);
    expect(canViewVehicleAudit(admin)).toBe(true);
  });

  it('requires an active report grant', () => {
    expect(canViewVehicleReports(userWith())).toBe(false);
    expect(canViewVehicleReports(userWith('booking.vehicle.view_reports'))).toBe(true);
    expect(canViewVehicleReports(userWith('booking.vehicle.view_reports', '2020-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('keeps sensitive issue view and resolution separate', () => {
    expect(canViewSensitiveVehicleIssues(userWith('booking.vehicle.resolve_sensitive_feedback'))).toBe(false);
    expect(canResolveSensitiveVehicleIssues(userWith('booking.vehicle.view_sensitive_feedback'))).toBe(false);
    expect(canViewSensitiveVehicleIssues(userWith('booking.vehicle.view_sensitive_feedback'))).toBe(true);
    expect(canResolveSensitiveVehicleIssues(userWith('booking.vehicle.resolve_sensitive_feedback'))).toBe(true);
  });

  it('requires an active audit grant', () => {
    expect(canViewVehicleAudit(userWith())).toBe(false);
    expect(canViewVehicleAudit(userWith('booking.vehicle.view_audit'))).toBe(true);
  });

  it('lets the explicit booking admin grant inherit every phase 3 capability', () => {
    const admin = userWith('booking.vehicle.admin');
    expect(canViewVehicleReports(admin)).toBe(true);
    expect(canViewSensitiveVehicleIssues(admin)).toBe(true);
    expect(canResolveSensitiveVehicleIssues(admin)).toBe(true);
    expect(canViewVehicleAudit(admin)).toBe(true);
  });
});
