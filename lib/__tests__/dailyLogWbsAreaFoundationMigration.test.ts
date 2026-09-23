import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260923090000_daily_log_wbs_area_foundation.sql',
);

describe('daily log WBS area foundation migration', () => {
  it('creates normalized WBS ownership and resource provider contracts', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('create table public.daily_log_work_items');
    expect(sql).toContain('create table public.daily_log_wbs_decisions');
    expect(sql).toContain('daily_log_work_items_owner_check');
    expect(sql).toContain('work_area_name');
    expect(sql).toContain('source_fingerprint');
    expect(sql).toContain('provider_entry_mode');
    expect(sql).toContain('manual_provider_name');
    expect(sql).toContain('resource_semantics_version');
    expect(sql).toContain('daily_log_labor_owner_check');
    expect(sql).toContain('daily_log_machines_owner_check');
    expect(sql).toContain('daily_log_labor_provider_check');
    expect(sql).toContain('daily_log_machines_provider_check');
  });

  it('adds a fail-closed rollout gate and read-only direct table access', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('app_private.daily_log_wbs_rollout_scopes');
    expect(sql).toContain('get_daily_log_wbs_rollout_access_v1');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke insert, update, delete on public.daily_log_work_items from authenticated');
    expect(sql).not.toContain('grant insert, update, delete on public.daily_log_work_items to authenticated');
    expect(sql).not.toContain('grant select on app_private.daily_log_wbs_rollout_scopes to authenticated');
  });

  it('preserves legacy resource semantics without inferred backfill', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('resource_semantics_version integer not null default 1');
    expect(sql).not.toMatch(/update\s+public\.daily_log_(labor|machines)[\s\S]*resource_semantics_version\s*=\s*2/);
  });

  it('rechecks the target daily log scope when a legacy resource row is updated', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();
    const laborUpdatePolicy = sql.slice(
      sql.indexOf('create policy daily_log_labor_update'),
      sql.indexOf('drop policy daily_log_labor_delete'),
    );
    const machineUpdatePolicy = sql.slice(
      sql.indexOf('create policy daily_log_machines_update'),
      sql.indexOf('drop policy daily_log_machines_delete'),
    );

    expect(laborUpdatePolicy).toMatch(/with check \([\s\S]*app_private\.daily_log_can_edit/);
    expect(machineUpdatePolicy).toMatch(/with check \([\s\S]*app_private\.daily_log_can_edit/);
  });
});
