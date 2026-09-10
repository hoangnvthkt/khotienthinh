import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
  .find(name => name.endsWith('_authorization_v2_phase5_legacy_grant_migration.sql'));
const sql = migrationName
  ? readFileSync(join(process.cwd(), 'supabase', 'migrations', migrationName), 'utf8').toLowerCase()
  : '';

describe('Authorization V2 deterministic legacy grant migration', () => {
  it('backs up all four legacy fields with a stable checksum', () => {
    expect(migrationName).toBeDefined();
    expect(sql).toContain('authorization_legacy_user_snapshots');
    expect(sql).toContain('legacy_payload');
    expect(sql).toContain('checksum');
  });

  it('uses explicit dispositions and blocks unknown mappings', () => {
    for (const disposition of ['mapped_view', 'mapped_manage', 'room_owned', 'role_owned', 'manual_review', 'retired']) {
      expect(sql).toContain(`'${disposition}'`);
    }
    expect(sql).toContain('manual_review');
    expect(sql).toContain('raise exception');
  });

  it('does not derive workflow approvals from legacy module access', () => {
    expect(sql).toContain("action in ('view', 'view_own', 'view_related', 'access')");
    expect(sql).toContain("action = 'manage'");
    expect(sql).not.toMatch(/legacy.*(submit|verify|confirm|approve).*insert into public\.user_permission_grants/s);
  });

  it('keeps Project Room and HR authorization in their owning systems', () => {
    expect(sql).toContain('project_permission_room_action_bindings');
    expect(sql).toContain("legacy_key = 'hrm'");
    expect(sql).toContain('legacy_hr_');
    expect(sql).toContain('role_permission_templates');
    expect(sql).toContain('role_permission_template_items');
  });
});
