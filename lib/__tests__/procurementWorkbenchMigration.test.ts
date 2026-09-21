import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260921110500_procurement_workbench_assignment_read_model.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('procurement workbench assignment and read model migration', () => {
  it('keeps assignment history immutable and uses optimistic/idempotent assignment', () => {
    expect(sql).toContain('procurement_assignment_history');
    expect(sql).toContain('procurement_assignment_history_immutable');
    expect(sql).toContain('assign_procurement_demand_v1');
    expect(sql).toContain('procurement_version_conflict');
    expect(sql).toContain('procurement_idempotency_conflict');
    expect(sql).toContain('for update');
  });

  it('derives actor and checks both current actor and assignee scope on the server', () => {
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain('app_private.procurement_assert_intake_access');
    expect(sql).toContain('app_private.procurement_access_v1');
    expect(sql).not.toContain('p_actor_user_id');
  });

  it('exposes cursor list and demand detail through invoker wrappers', () => {
    expect(sql).toContain('list_procurement_work_v1');
    expect(sql).toContain('get_procurement_demand_v1');
    expect(sql).toContain("'snapshottoken'");
    expect(sql).toContain("'nextcursor'");
    expect(sql).toContain("'allowedactions'");
    expect(sql).toMatch(/create function public\.list_procurement_work_v1[\s\S]+security invoker/);
    expect(sql).toMatch(/create function public\.get_procurement_demand_v1[\s\S]+security invoker/);
  });

  it('binds page cursors to the frozen result snapshot', () => {
    expect(sql).toContain('procurement_snapshot_stale');
    expect(sql).toMatch(/p_cursor[\s\S]+split_part\(p_cursor, ':', 2\)/);
    expect(sql).toMatch(/v_next := \(v_offset \+ v_limit\)::text \|\| ':' \|\| v_snapshot/);
  });

  it('keeps work and demand counters at their declared grains', () => {
    expect(sql).toMatch(/count\(distinct row_value ->> 'demandid'\)/);
    expect(sql).toContain("jsonb_build_object('key', 'demand', 'count', v_demand_count, 'grain', 'demand')");
  });

  it('applies source and allocation-method filters before paging and counters', () => {
    expect(sql).toContain("nullif(v_filter ->> 'source', '')");
    expect(sql).toContain("v_filter ->> 'source' = 'project_material_request'");
    expect(sql).toMatch(/nullif\(v_filter ->> 'method', ''\)[\s\S]+procurement_supply_allocations allocation_filter/);
  });

  it('only exposes planning when the current server balance is positive', () => {
    expect(sql).toMatch(/availabletoplanqty'\)::numeric, 0\) > 0[\s\S]+jsonb_build_array\('assign', 'plan_supply'\)/);
    expect(sql).toContain('v_can_plan');
  });

  it('does not grant direct authenticated access to assignment history or private owners', () => {
    expect(sql).toMatch(/revoke all on public\.procurement_assignment_history from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function app_private\.assign_procurement_demand_v1[\s\S]+from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function app_private\.assign_procurement_demand_v1[\s\S]+to authenticated, service_role/);
    expect(sql).toMatch(/grant execute on function public\.assign_procurement_demand_v1[\s\S]+to authenticated, service_role/);
  });
});
