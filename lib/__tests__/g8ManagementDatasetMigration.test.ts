import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260921170000_g8_management_dataset_lineage.sql', import.meta.url), 'utf8');

describe('G8 management dataset migration contract', () => {
  it('exposes one versioned, session-actor RPC and denies anonymous execution', () => {
    expect(sql).toContain('create function app_private.list_management_dataset_v1');
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("'g8.management.dataset.v1'");
    expect(sql).toContain('create function public.list_management_dataset_v1');
    expect(sql).toContain('revoke all on function public.list_management_dataset_v1');
    expect(sql).toContain('from public, anon');
    expect(sql).toContain('grant execute on function public.list_management_dataset_v1');
    expect(sql).toContain('to authenticated, service_role');
  });

  it('filters authorized projects before building rows and gates finance values separately', () => {
    expect(sql).toContain('authorized_projects as materialized');
    expect(sql).toContain("'project.dashboard.view_progress'");
    expect(sql).toContain("'project.dashboard.view_financials'");
    expect(sql).toContain("'FINANCE_SCOPE_RESTRICTED'");
    expect(sql).not.toContain('project_finances');
  });

  it('returns stable cutoff totals, cursor, catalog, completeness, and source lineage', () => {
    for (const token of ["'metricVersion'", "'asOf'", "'staleAfter'", "'catalog'", "'totals'", "'rows'", "'nextCursor'", "'completeness'", "'source'", "'inferred'"]) {
      expect(sql).toContain(token);
    }
    expect(sql).toContain('create or replace function app_private.get_management_lineage_v1');
    expect(sql).toContain('create function public.get_management_lineage_v1');
  });

  it('keeps malformed legacy task dates from aborting the complete management read', () => {
    expect(sql.match(/pg_input_is_valid\(task\.end_date, 'date'\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("pg_input_is_valid(po.expected_delivery_date, 'date')");
    expect(sql).not.toContain("task.end_date ~ '^\\d{4}");
    expect(sql).not.toContain("po.expected_delivery_date ~ '^\\d{4}");
  });
});
