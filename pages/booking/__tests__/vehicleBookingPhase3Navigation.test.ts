import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { User } from '../../../types';
import {
  canResolveSensitiveVehicleIssues,
  canViewSensitiveVehicleIssues,
  canViewVehicleAudit,
  canViewVehicleReports,
} from '../../../lib/vehicleBookingPermissions';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const layout = read('pages/booking/VehicleBookingLayout.tsx');
const sidebar = read('components/Sidebar.tsx');
const userModal = read('components/UserModal.tsx');

const withGrants = (...permissionCodes: string[]) => ({
  permissionGrants: permissionCodes.map(permissionCode => ({
    id: permissionCode,
    permissionCode,
    scopeType: 'global',
    scopeId: '*',
    isActive: true,
  })),
}) as Pick<User, 'permissionGrants'>;

describe('vehicle booking Phase 3 navigation', () => {
  it('keeps report, issue view, issue resolution, and audit capabilities independent', () => {
    const reports = withGrants('booking.vehicle.view_reports');
    expect([canViewVehicleReports(reports), canViewSensitiveVehicleIssues(reports), canViewVehicleAudit(reports)]).toEqual([true, false, false]);

    const issueViewer = withGrants('booking.vehicle.view_sensitive_feedback');
    expect(canViewSensitiveVehicleIssues(issueViewer)).toBe(true);
    expect(canResolveSensitiveVehicleIssues(issueViewer)).toBe(false);

    const issueResolver = withGrants('booking.vehicle.resolve_sensitive_feedback');
    expect(canViewSensitiveVehicleIssues(issueResolver)).toBe(false);
    expect(canResolveSensitiveVehicleIssues(issueResolver)).toBe(true);

    const audit = withGrants('booking.vehicle.view_audit');
    expect([canViewVehicleReports(audit), canViewSensitiveVehicleIssues(audit), canViewVehicleAudit(audit)]).toEqual([false, false, true]);
  });

  it('registers guarded pages and labels in the booking layout', () => {
    expect(layout).toContain('VehicleBookingAnalyticsPage');
    expect(layout).toContain('VehicleBookingIssuesPage');
    expect(layout).toContain('VehicleBookingAuditTrailPage');
    expect(layout).toContain('Dashboard & Báo cáo KPI');
    expect(layout).toContain('Quản lý xe');
    expect(layout).toContain('Quản lý tài xế');
    expect(layout).toContain('Cấu hình');
    expect(layout).toContain('Phản ánh');
    expect(layout).toContain('Lịch sử vận hành');
    expect(layout).toContain('path="reports"');
    expect(layout).toContain('path="issues"');
    expect(layout).toContain('path="audit"');
    expect(layout).toContain('path="drivers"');
    expect(layout).toContain('path="settings"');
    expect(layout.indexOf("label: 'Tạo đơn đặt xe'")).toBeLessThan(layout.indexOf("label: 'Quản lý xe'"));
    expect(layout.indexOf("label: 'Quản lý xe'")).toBeLessThan(layout.indexOf("label: 'Quản lý tài xế'"));
    expect(layout.indexOf("label: 'Quản lý tài xế'")).toBeLessThan(layout.indexOf("label: 'Dashboard & Báo cáo KPI'"));
  });

  it('keeps Sidebar and user permission configuration in sync', () => {
    for (const source of [sidebar, userModal]) {
      expect(source).toContain('/booking/vehicle/reports');
      expect(source).toContain('/booking/vehicle/issues');
      expect(source).toContain('/booking/vehicle/audit');
      expect(source).toContain('/booking/vehicle/drivers');
      expect(source).toContain('/booking/vehicle/settings');
      expect(source).toContain('Dashboard & Báo cáo KPI');
    }
    expect(sidebar).toContain('canViewVehicleReports');
    expect(sidebar).toContain('canViewSensitiveVehicleIssues');
    expect(sidebar).toContain('canViewVehicleAudit');
  });
});
