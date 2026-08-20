import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(directory).find(name => name.endsWith('_hrm_legacy_position_migration.sql'));
const sql = file ? readFileSync(join(directory, file), 'utf8') : '';

describe('HRM legacy position migration', () => {
  it('moves employees and slots to one approved target position atomically', () => {
    expect(file).toBeDefined();
    expect(sql).toContain('app_private.migrate_hrm_legacy_position');
    expect(sql).toContain('update public.employees');
    expect(sql).toContain('update public.hrm_org_position_slots');
    expect(sql).toContain('position_id = p_target_position_id');
    expect(sql).toContain("source <> 'legacy'");
    expect(sql).toContain('is_active = false');
  });

  it('exposes only an invoker wrapper and restricts execution to authenticated users', () => {
    expect(sql).toContain('public.migrate_hrm_legacy_position');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("public.is_module_admin('HRM')");
    expect(sql).toContain('revoke all on function public.migrate_hrm_legacy_position');
    expect(sql).toContain('grant execute on function public.migrate_hrm_legacy_position');
  });
});
