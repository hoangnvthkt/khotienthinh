import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const requestMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260916110000_authorization_v2_task12_4_2_request_lifecycle_capabilities.sql',
), 'utf8');
const superAdminMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260916110100_authorization_v2_task12_4_2_super_admin_dynamic_role.sql',
), 'utf8');
const superAdminHardeningMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260916110200_authorization_v2_task12_4_2_super_admin_assignment_hardening.sql',
), 'utf8');

describe('authorization E26', () => {
  it('separates the implemented Request lifecycle boundaries', () => {
    for (const code of [
      'request.instance.approve_assigned',
      'request.instance.reject_assigned',
      'request.instance.return_assigned',
      'request.instance.resubmit_own',
      'request.instance.cancel',
      'request.instance.reassign',
      'request.instance.edit_own_content',
    ]) expect(requestMigration).toContain(code);
    expect(requestMigration).toContain('guard_request_instance_lifecycle_v2');
    expect(requestMigration).toContain('guard_request_assignment_lifecycle_v2');
  });

  it('implements SUPER_ADMIN as a locked dynamic role without item expansion', () => {
    expect(superAdminMigration).toContain("'SUPER_ADMIN'");
    expect(superAdminMigration).toContain('super_admin_sources as');
    expect(superAdminMigration).toContain('guard_super_admin_assignment');
    expect(superAdminMigration).toContain('guard_super_admin_template');
    expect(superAdminMigration).toContain('guard_super_admin_template_item');
    expect(superAdminMigration).not.toContain("insert into public.role_permission_template_items");
  });

  it('guards both sides of assignment role changes and direct deletion', () => {
    expect(superAdminHardeningMigration).toContain("v_new_role_code is distinct from 'SUPER_ADMIN'");
    expect(superAdminHardeningMigration).toContain("v_old_role_code is distinct from 'SUPER_ADMIN'");
    expect(superAdminHardeningMigration).toContain("new.role_template_id is distinct from old.role_template_id");
    expect(superAdminHardeningMigration).toContain("tg_op='DELETE'");
    expect(superAdminHardeningMigration).toContain('before insert or update or delete');
  });
});
