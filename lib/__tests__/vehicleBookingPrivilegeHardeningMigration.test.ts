import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260812000011_vehicle_booking_privilege_hardening.sql';

describe('vehicle booking privilege hardening migration', () => {
  it('revokes TRUNCATE and direct DML from API roles on every mutable booking table', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
    const tables = [
      'fleet_locations',
      'fleet_system_settings',
      'fleet_vehicle_profiles',
      'vehicle_driver_authorizations',
      'vehicle_unavailability_periods',
      'operator_unavailability_periods',
      'vehicle_bookings',
      'vehicle_booking_participants',
      'vehicle_booking_assignments',
      'vehicle_trip_logs',
      'vehicle_handover_logs',
      'vehicle_booking_issues',
      'vehicle_booking_feedback',
    ];

    for (const table of tables) {
      expect(sql).toContain(`revoke insert, update, delete, truncate on table public.${table} from anon, authenticated`);
    }
  });
});
