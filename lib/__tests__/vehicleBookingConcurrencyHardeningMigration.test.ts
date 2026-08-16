import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260815154344_vehicle_booking_concurrency_reassignment_hardening.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

describe('vehicle booking concurrency and reassignment hardening migration', () => {
  it('atomically releases a declined assignment and returns its booking to dispatch', () => {
    expect(sql).toContain("operator_confirmation_status = 'DECLINED'");
    expect(sql).toContain("new.is_active := false");
    expect(sql).toContain("new.released_at := coalesce(new.released_at, now())");
    expect(sql).toMatch(/update public\.vehicle_bookings[\s\S]+status = 'WAITING_DISPATCH'/);
    expect(sql).toMatch(/delete from public\.vehicle_trip_logs[\s\S]+trip_status = 'NOT_STARTED'/);
  });

  it('increments assignment versions and snapshots the actual version when redispatching', () => {
    expect(sql).toMatch(/coalesce\(max\(assignment\.version\), 0\) \+ 1/);
    expect(sql).toMatch(/new\.assignment_version_snapshot := v_assignment_version/);
  });

  it('prevents one operator from having two trips in progress', () => {
    expect(sql).toContain('vehicle_trip_logs_one_active_trip_per_operator');
    expect(sql).toMatch(/where trip_status = 'IN_PROGRESS'[\s\S]+operator_user_id_snapshot is not null/);
  });

  it('keeps all implementation functions private and public APIs unchanged', () => {
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\./i);
    expect(sql).toContain('revoke all on function app_private.vehicle_release_declined_assignment()');
    expect(sql).toContain('revoke all on function app_private.vehicle_normalize_assignment_version()');
    expect(sql).toContain('revoke all on function app_private.vehicle_snapshot_assignment_version()');
  });
});
