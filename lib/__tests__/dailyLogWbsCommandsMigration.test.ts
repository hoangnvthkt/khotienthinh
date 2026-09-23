import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../supabase/migrations/20260923093000_daily_log_wbs_area_commands.sql', import.meta.url);

describe('daily log WBS area command migration', () => {
  const sql = () => readFileSync(migrationPath, 'utf8');

  it('defines the bundle and three write commands with hardened function ACLs', () => {
    const source = sql();
    expect(source).toContain('create function public.get_daily_log_wbs_bundle_v1');
    expect(source).toContain('create function public.save_daily_log_contribution_work_v1');
    expect(source).toContain('create function public.save_daily_log_summary_work_v1');
    expect(source).toContain('create function public.request_daily_log_summary_source_changes_v1');
    expect(source.match(/security definer/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('RESOURCE_PRICE_FIELDS_NOT_ALLOWED');
    expect(source).toContain('MANUAL_PROVIDER_NAME_REQUIRED');
  });

  it('rejects forbidden monetary keys before replacing any contribution details', () => {
    const source = sql();
    const command = source.slice(
      source.indexOf('create function public.save_daily_log_contribution_work_v1'),
      source.indexOf('create function public.save_daily_log_summary_work_v1'),
    );
    const rejectIndex = command.indexOf('RESOURCE_PRICE_FIELDS_NOT_ALLOWED');
    const deleteIndex = command.indexOf('delete from public.daily_log_work_items');
    expect(rejectIndex).toBeGreaterThan(0);
    expect(deleteIndex).toBeGreaterThan(rejectIndex);
    expect(command).toMatch(/unitCost|unit_cost/);
    expect(command).toMatch(/totalCost|total_cost/);
  });

  it('keeps version 2 resources physical-only and server-computed', () => {
    const source = sql();
    expect(source).toMatch(/resource_semantics_version[\s\S]*2/);
    expect(source).toMatch(/people_count[\s\S]*hours_per_person[\s\S]*total_labor_hours/);
    expect(source).toMatch(/machine_count[\s\S]*hours_per_machine[\s\S]*total_machine_hours/);
    expect(source).toMatch(/unit_cost[\s\S]*null/);
    expect(source).toMatch(/total_cost[\s\S]*null/);
  });

  it('contains executable rollback contract cases for provider name and price rejection', () => {
    const source = sql();
    expect(source).toContain('app_private.assert_daily_log_wbs_resource_payload_v1');
    expect(source).toContain("'MANUAL_PROVIDER_NAME_REQUIRED'");
    expect(source).toContain("'RESOURCE_PRICE_FIELDS_NOT_ALLOWED'");
  });

  it('does not expose legacy embedded resource or monetary fields in the new bundle', () => {
    const source = sql();
    const bundle = source.slice(
      source.indexOf('create function public.get_daily_log_wbs_bundle_v1'),
      source.indexOf('create function public.save_daily_log_contribution_work_v1'),
    );
    expect(bundle).toContain("to_jsonb(log) - 'labor_details' - 'machines'");
    expect(bundle).toContain("to_jsonb(labor) - 'unit_cost' - 'total_cost'");
    expect(bundle).toContain("to_jsonb(machine) - 'unit_cost' - 'total_cost'");
    expect(bundle).not.toMatch(/work\.unit_price|work\.total_amount|task\.unit_price|task\.total_price/);
  });
});
