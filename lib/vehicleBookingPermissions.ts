import type { User } from '../types';

type VehicleBookingGrantUser = Pick<User, 'permissionGrants'> & Partial<Pick<User, 'role'>>;

export function hasActiveVehicleBookingGrant(
  user: VehicleBookingGrantUser | null | undefined,
  permissionCodes: string[],
  reference = new Date(),
): boolean {
  const acceptedCodes = new Set([...permissionCodes, 'booking.vehicle.admin']);
  return Boolean(user?.permissionGrants?.some(grant =>
    acceptedCodes.has(grant.permissionCode)
      && grant.isActive !== false
      && (!grant.expiresAt || new Date(grant.expiresAt).getTime() > reference.getTime())
  ));
}

export function canAccessVehicleApprovalQueue(
  user: Pick<User, 'id' | 'permissionGrants'> & Partial<Pick<User, 'role'>> | null | undefined,
  users: Array<Pick<User, 'id' | 'managerId'>>,
): boolean {
  if (!user) return false;
  return hasActiveVehicleBookingGrant(user, ['booking.vehicle.approve_direct_reports'])
    || users.some(candidate => candidate.id !== user.id && candidate.managerId === user.id);
}

export const canViewVehicleReports = (
  user: VehicleBookingGrantUser | null | undefined,
): boolean => hasActiveVehicleBookingGrant(user, ['booking.vehicle.view_reports']);

export const canViewSensitiveVehicleIssues = (
  user: VehicleBookingGrantUser | null | undefined,
): boolean => hasActiveVehicleBookingGrant(user, ['booking.vehicle.view_sensitive_feedback']);

export const canResolveSensitiveVehicleIssues = (
  user: VehicleBookingGrantUser | null | undefined,
): boolean => hasActiveVehicleBookingGrant(user, ['booking.vehicle.resolve_sensitive_feedback']);

export const canViewVehicleAudit = (
  user: VehicleBookingGrantUser | null | undefined,
): boolean => hasActiveVehicleBookingGrant(user, ['booking.vehicle.view_audit']);
