import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260812000012_vehicle_booking_phase3_security.sql';
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

describe('vehicle booking phase 3 security migration', () => {
  it('registers separate sensitive-resolution and audit permissions', () => {
    expect(sql).toContain('booking.vehicle.resolve_sensitive_feedback');
    expect(sql).toContain('booking.vehicle.view_audit');
    expect(sql).toContain('/booking/vehicle/issues');
    expect(sql).toContain('/booking/vehicle/audit');
  });

  it('removes broad issue visibility and direct mutation', () => {
    const helper = sql.match(/create or replace function app_private\.vehicle_user_can_view_issue[\s\S]+?\$\$;/)?.[0] || '';
    expect(helper).toContain('booking.vehicle.view_sensitive_feedback');
    expect(helper).not.toContain('booking.vehicle.dispatch');
    expect(helper).not.toContain('booking.vehicle.manage_fleet');
    expect(sql).toContain('revoke insert, update, delete, truncate on public.vehicle_booking_issues from anon, authenticated');
  });

  it('contains raw audit table privileges without breaking legacy authenticated inserts', () => {
    expect(sql).toContain('revoke select, insert, update, delete, truncate on public.audit_trail from anon');
    expect(sql).toContain('revoke update, delete, truncate on public.audit_trail from authenticated');
    expect(sql).not.toContain('revoke insert on public.audit_trail from authenticated');
  });
});
