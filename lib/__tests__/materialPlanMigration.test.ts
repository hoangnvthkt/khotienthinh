import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260921093000_material_plan_revision_aggregate.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('material plan aggregate migration', () => {
  it('creates revisioned plan, line, allocation and conversion records', () => {
    expect(sql).toContain('create table public.material_plans');
    expect(sql).toContain('create table public.material_plan_lines');
    expect(sql).toContain('create table public.material_plan_allocations');
    expect(sql).toContain('create table public.material_plan_revisions');
    expect(sql).toContain('create table public.material_plan_conversions');
    expect(sql).toContain('material_plan_revision_immutable');
  });

  it('saves with server actor, expected version, idempotency and exact BOQ identities', () => {
    expect(sql).toContain('save_material_plan_v1');
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain("'material_planning', 'edit'");
    expect(sql).toContain('p_expected_version');
    expect(sql).toContain('p_idempotency_key');
    expect(sql).toContain('procurement_idempotency_conflict');
    expect(sql).toMatch(/material_budget_items[\s\S]+work_boq_item_id[\s\S]+inventory_item_id[\s\S]+unit/);
    expect(sql).toContain('material_plan_revision_below_converted');
  });

  it('converts under stable locks and creates MR plus lineage atomically', () => {
    expect(sql).toContain('convert_material_plan_to_request_v1');
    expect(sql).toContain("'material_request', 'edit'");
    expect(sql).toMatch(/order by allocation\.source_budget_line_id[\s\S]+for update/);
    expect(sql).toContain('material_plan_conversion_exceeded');
    expect(sql).toContain('material_plan_budget_exceeded');
    expect(sql).toContain('material_plan_budget_completeness_unknown');
    expect(sql).toContain('material_plan_conversion_duplicate');
    expect(sql).toMatch(/v_work\.source_task_id is distinct from v_allocation\.source_task_id/);
    expect(sql).toContain('insert into public.requests');
    expect(sql).toContain('insert into public.material_plan_conversions');
    expect(sql).toContain('insert into public.material_request_events');
    expect(sql).toContain('app.material_plan_fail_after_request');
  });

  it('does not double count a conversion after its MR leaves draft', () => {
    expect(sql).toMatch(/lower\(request_row\.status::text\) in \('draft', 'rejected'\)/);
    expect(sql).toMatch(/lower\(request_row\.status::text\) in \('pending', 'approved', 'in_transit', 'completed'\)/);
  });

  it('keeps authenticated callers behind actor-derived public RPCs and RLS', () => {
    for (const table of ['material_plans', 'material_plan_lines', 'material_plan_allocations', 'material_plan_revisions', 'material_plan_conversions']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
    expect(sql).toMatch(/create function public\.save_material_plan_v1[\s\S]+security invoker\s+set search_path = ''/);
    expect(sql).toMatch(/create function public\.convert_material_plan_to_request_v1[\s\S]+security invoker\s+set search_path = ''/);
    expect(sql).not.toMatch(/create function public\.save_material_plan_v1\((?:(?!\) returns)[\s\S])*p_actor/);
    expect(sql).toMatch(/function app_private\.get_material_plan_v1[\s\S]+material_plan_detail_json\(p_plan_id, v_actor\)/);
    expect(sql).toMatch(/function app_private\.list_material_plans_v1[\s\S]+if v_actor is null/);
    expect(sql).toMatch(/grant execute on function public\.save_material_plan_v1[\s\S]+to authenticated, service_role/);
    expect(sql).toMatch(/grant execute on function app_private\.save_material_plan_v1[\s\S]+to authenticated, service_role/);
  });
});
