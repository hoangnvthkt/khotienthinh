import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = join(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationDir)
  .find(name => name.endsWith('_request_vehicle_direct_manager_routing.sql'));
const sql = migrationName ? readFileSync(join(migrationDir, migrationName), 'utf8') : '';

describe('vehicle booking direct-manager routing migration', () => {
  it('adds immutable routing data and a manager-approval setting', () => {
    expect(sql).toContain('require_direct_manager_approval');
    expect(sql).toContain('manager_approval_route');
    expect(sql).toContain('MISSING_MANAGER_BYPASS');
    expect(sql).toContain('manager_bypass_confirmed_by_user_id');
  });

  it('previews the authoritative route and blocks a missing dispatcher', () => {
    expect(sql).toContain('preview_vehicle_booking_submission_route');
    expect(sql).toContain('MISSING_MANAGER_CONFIRMATION_REQUIRED');
    expect(sql).toContain('VEHICLE_DISPATCHER_MISSING');
  });

  it('requires explicit confirmation before bypassing a missing manager', () => {
    expect(sql).toContain('p_confirm_missing_manager_bypass boolean default false');
    expect(sql).toContain('VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED');
    expect(sql).toContain("status = 'WAITING_DISPATCH'");
  });

  it('provides a stale-safe audited manager reassignment command', () => {
    expect(sql).toContain('command_reassign_vehicle_booking_manager');
    expect(sql).toContain('p_expected_updated_at timestamptz');
    expect(sql).toContain('VEHICLE_BOOKING_STALE_STATE');
    expect(sql).toContain('MANAGER_REASSIGNED');
  });

  it('seeds the current system administrator with an audited Booking grant', () => {
    expect(sql).toContain("'booking.vehicle.admin'");
    expect(sql).toContain("'booking_admin_seeded'");
  });
});
