import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(name => name.endsWith('_safety_workforce_membership_foundation.sql'));
const sql = migrationFile
  ? readFileSync(resolve(migrationDirectory, migrationFile), 'utf8').toLowerCase()
  : '';

describe('Safety Workforce membership foundation migration', () => {
  it('creates the canonical site membership and assignment lifecycle', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('create table public.safety_worker_site_memberships');
    expect(sql).toContain('identity_number_normalized');
    expect(sql).toContain('membership_id uuid');
    expect(sql).toContain('assignment_status text');
    expect(sql).toContain('started_at timestamptz');
    expect(sql).toContain('ended_at timestamptz');
    expect(sql).toContain('subcontractor_id uuid');
    expect(sql).toContain('team_id uuid');
  });

  it('enforces one active site per worker and unique normalized identity', () => {
    expect(sql).toContain('safety_worker_assignments_one_active_idx');
    expect(sql).toContain("where assignment_status = 'active'");
    expect(sql).toContain('safety_worker_profiles_identity_normalized_idx');
    expect(sql).toContain('where identity_number_normalized is not null');
    expect(sql).toContain('unique (worker_id, construction_site_id)');
  });

  it('indexes every new foreign key and the scoped roster access path', () => {
    for (const indexName of [
      'safety_memberships_worker_idx',
      'safety_memberships_project_idx',
      'safety_memberships_site_status_created_idx',
      'safety_memberships_default_subcontractor_idx',
      'safety_memberships_default_team_idx',
      'safety_assignments_membership_started_idx',
      'safety_assignments_subcontractor_idx',
      'safety_assignments_team_idx',
      'safety_assignments_ended_by_idx',
    ]) expect(sql).toContain(indexName);
  });

  it('uses private scoped authorization helpers with hardened search paths', () => {
    for (const helper of [
      'app_private.safety_workforce_normalize_identity',
      'app_private.safety_workforce_assert_scope',
      'app_private.safety_workforce_can_view',
      'app_private.safety_workforce_can_manage',
      'app_private.safety_workforce_can_view_sensitive',
      'app_private.safety_workforce_can_access_worker_storage',
      'app_private.safety_workforce_assert_subcontractor_team',
    ]) expect(sql).toContain(helper);

    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('project.safety.view');
    expect(sql).toContain('project.safety.worker_manage');
    expect(sql).toContain('project.safety.document_verify');
    expect(sql).toContain('app_private.project_has_permission_v2');
    expect(sql).toContain("p_worker_kind is null or p_worker_kind not in ('company_staff', 'contractor_worker')");
  });

  it('enables scoped RLS without embedding privileged credentials', () => {
    expect(sql).toContain('alter table public.safety_worker_site_memberships enable row level security');
    expect(sql).toContain('create policy safety_worker_memberships_select');
    expect(sql).toContain('create policy safety_worker_memberships_insert');
    expect(sql).toContain('create policy safety_worker_memberships_update');
    expect(sql).not.toMatch(/service_role/i);
  });
});
