import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_safety_workforce_son_mien_bac_backfill.sql'));
const migrationSql = migrationFile
  ? readFileSync(resolve(migrationDirectory, migrationFile), 'utf8').toLowerCase()
  : '';

const preflightPath = resolve(
  process.cwd(),
  'supabase/audits/safety_workforce_son_mien_bac_preflight.sql',
);
const preflightSql = existsSync(preflightPath)
  ? readFileSync(preflightPath, 'utf8').toLowerCase()
  : '';

describe('Sơn Miền Bắc safety workforce backfill', () => {
  it('keeps the Cloud preflight aggregate-only and read-only', () => {
    expect(preflightSql).toContain('begin read only');
    expect(preflightSql).toContain('site_count');
    expect(preflightSql).toContain('project_count');
    expect(preflightSql).toContain('profile_count');
    expect(preflightSql).toContain('duplicate_identity_count');
    expect(preflightSql).toContain('unmapped_contractor_count');
    expect(preflightSql).toContain('ambiguous_team_count');
    expect(preflightSql).toContain('assignment_outside_target_count');
    expect(preflightSql).not.toMatch(/identity_number\s*(,|as)/i);
  });

  it('fails closed when the approved Cloud snapshot changes', () => {
    expect(migrationFile).toBeDefined();
    expect(migrationSql).toContain('v_expected_profile_count constant integer := 54');
    expect(migrationSql).toContain('safety_backfill_profile_count_changed');
    expect(migrationSql).toContain('safety_backfill_duplicate_identity');
    expect(migrationSql).toContain('safety_backfill_assignment_outside_target');
    expect(migrationSql).toContain('safety_backfill_unmapped_contractor');
    expect(migrationSql).toContain('safety_backfill_ambiguous_team');
  });

  it('creates deterministic memberships and assignment history without cards', () => {
    expect(migrationSql).toContain("'son_mien_bac_backfill_v1'");
    expect(migrationSql).toContain('pg_temp.safety_worker_backfill_map');
    expect(migrationSql).toContain('on conflict (worker_id, construction_site_id) do update');
    expect(migrationSql).toContain("assignment_status = 'active'");
    expect(migrationSql).toContain("source = coalesce(assignment.source, 'legacy')");
    expect(migrationSql).toContain('where not exists');
    expect(migrationSql).toMatch(
      /drop constraint(?: if exists)? safety_project_assignments_active_unique/,
    );
    expect(migrationSql).not.toContain('insert into public.safety_cards');
  });

  it('asserts the exact post-backfill cardinalities and final constraints', () => {
    expect(migrationSql).toContain('v_expected_backfill_assignment_count constant integer := 53');
    expect(migrationSql).toContain('safety_backfill_membership_count_invalid');
    expect(migrationSql).toContain('safety_backfill_active_assignment_count_invalid');
    expect(migrationSql).toContain('safety_backfill_source_count_invalid');
    expect(migrationSql).toContain('alter column worker_kind set not null');
    expect(migrationSql).toContain('alter column membership_id set not null');
    expect(migrationSql).toContain('alter column assignment_status set not null');
    expect(migrationSql).toContain('alter column started_at set not null');
    expect(migrationSql).toContain('alter column source set not null');
  });
});
