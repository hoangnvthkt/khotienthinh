import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_authorization_v2_phase4_remaining_enforced_rooms.sql'));
const migration = migrationFile
  ? readFileSync(join(migrationsDir, migrationFile), 'utf8')
  : '';

describe('Authorization V2 remaining Room cutover migration', () => {
  it('cuts over only the three remaining Rooms and turns global Room fallback off', () => {
    expect(migrationFile).toBeDefined();
    expect(migration).toContain("'quantity_acceptance'");
    expect(migration).toContain("'payment'");
    expect(migration).toContain("'safety'");
    expect(migration).toContain("'project_room_pbac_fallback_enabled'");
    expect(migration).toContain("'false'::jsonb");
  });

  it('retires material_request.verify with evidence and reconciles drift without re-cutover', () => {
    expect(migration).toContain('authorization_room_action_dispositions');
    expect(migration).toContain("'material_request', 'verify'");
    expect(migration).toContain("'retired_no_business_path'");
    expect(migration).toContain('inactive_project_staff');
    expect(migration).toContain("'weekly_progress'");
  });

  it('fails closed unless every active Room action is enforced and stale-free', () => {
    expect(migration).toContain("enforcement_status <> 'enforced'");
    expect(migration).toContain('pbac_fallback_enabled');
    expect(migration).toContain('staff.end_date is not null');
    expect(migration).toContain('raise exception');
  });
});
