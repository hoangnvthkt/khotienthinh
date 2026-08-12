import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260812000015_vehicle_booking_phase3_notification_links.sql';
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

describe('vehicle booking notification migration contract', () => {
  it('canonicalizes new and existing notification links at the database boundary', () => {
    expect(migration).toContain('canonicalize_vehicle_booking_notification');
    expect(migration).toContain("'/booking/vehicle/my?booking='");
    expect(migration).toContain('create trigger');
    expect(migration).toContain('update public.notifications');
  });

  it('adds the resolved-issue notification title', () => {
    expect(migration).toContain("when 'issue_resolved'");
  });
});
