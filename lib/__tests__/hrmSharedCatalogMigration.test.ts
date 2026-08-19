import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_hrm_shared_catalog_org_slots.sql'));
const sql = migrationFile
  ? readFileSync(join(migrationDirectory, migrationFile), 'utf8')
  : '';

describe('HRM shared catalog and organization slot migration', () => {
  it('creates effective-dated slot, assignment, and manual allowance tables', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('create table if not exists public.hrm_org_position_slots');
    expect(sql).toContain('create table if not exists public.hrm_employee_slot_assignments');
    expect(sql).toContain('create table if not exists public.hrm_employee_manual_allowances');
    expect(sql).toContain('manager_slot_id');
    expect(sql).toContain('hrm_employee_one_active_primary_slot_idx');
    expect(sql).toContain('hrm_slot_one_active_occupant_idx');
  });

  it('normalizes the approved source catalog without changing P3', () => {
    expect(sql).toContain("values ('CG', 'Chuyên gia'");
    expect(sql).toContain("'K4'");
    expect(sql).toContain("'C6'");
    expect(sql).toContain("'VPHN', 'BCH CT', 'CG/CV'");
    expect(sql).toContain("'E' || substring(code from 2)");
    expect(sql).not.toContain('update public.hrm_3p_bands');
    expect(sql).not.toContain('delete from public.hrm_3p_bands');
  });

  it('protects public tables with RLS and HRM-admin-only writes', () => {
    for (const table of [
      'hrm_org_position_slots',
      'hrm_employee_slot_assignments',
      'hrm_employee_manual_allowances',
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("public.is_module_admin('HRM')");
    expect(sql).toContain('revoke insert, update, delete');
  });

  it('resolves direct managers from reporting slots before the legacy fallback', () => {
    expect(sql).toContain('app_private.resolve_slot_direct_manager');
    expect(sql).toContain('app_private.resolve_active_direct_manager');
    expect(sql).toContain('coalesce(v_slot_manager_id, v_legacy_manager_id)');
    expect(sql).toContain('manager.id <> p_user_id');
  });

  it('assigns employees to slots atomically and synchronizes the employee profile', () => {
    expect(sql).toContain('public.assign_hrm_employee_to_slot');
    expect(sql).toContain("status = 'ENDED'");
    expect(sql).toContain('position_id = v_slot.position_id');
    expect(sql).toContain('grant execute on function public.assign_hrm_employee_to_slot');
  });
});
