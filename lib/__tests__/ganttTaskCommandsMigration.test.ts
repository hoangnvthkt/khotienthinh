import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260813070319_gantt_room_authoritative_cutover.sql',
), 'utf8').toLowerCase().replace(/\s+/g, ' ');

describe('authoritative gantt task commands migration', () => {
  it('exposes only invoker wrappers and keeps mutation implementations private', () => {
    expect(sql).toContain('create or replace function public.save_project_gantt_tasks(');
    expect(sql).toContain('create or replace function public.delete_project_gantt_task_tree(');
    expect(sql).toContain('security invoker');
    expect(sql).toContain('app_private.save_project_gantt_tasks_impl');
    expect(sql).toContain('app_private.delete_project_gantt_task_tree_impl');
    expect(sql).toContain('grant execute on function public.save_project_gantt_tasks(uuid, text, text, jsonb) to authenticated');
    expect(sql).toContain('grant execute on function public.delete_project_gantt_task_tree(uuid, text, text, text, bigint) to authenticated');
  });

  it('locks deterministic task order and enforces scope plus optimistic versions', () => {
    expect(sql).toContain('order by task.id for update');
    expect(sql).toContain('gantt_scope_mismatch');
    expect(sql).toContain('gantt_stale_version');
    expect(sql).toContain('expected_row_version');
    expect(sql).toContain("app_private.assert_project_gantt_action(p_project_id, v_site_id, 'edit')");
    expect(sql).toContain("app_private.assert_project_gantt_action(p_project_id, v_site_id, 'delete')");
  });

  it('validates hierarchy, dependencies, dates, actors and immutable gate metadata', () => {
    expect(sql).toContain('gantt_hierarchy_cycle');
    expect(sql).toContain('gantt_dependency_invalid');
    expect(sql).toContain('gantt_dependency_cycle');
    expect(sql).toContain('gantt_invalid_dates');
    expect(sql).toContain('gantt_invalid_assignee');
    expect(sql).toContain('gantt_gate_metadata_immutable');
  });

  it('implements replay-safe request IDs and auditable delete denial', () => {
    expect(sql).toContain('gantt_request_id_reused');
    expect(sql).toContain("'replayed', true");
    expect(sql).toContain("'gantt_delete_blocked'");
    expect(sql).toContain("'gantt_delete_blocked'");
    expect(sql).toContain('project_task_completion_requests');
    expect(sql).toContain('project_daily_task_progress');
    expect(sql).toContain('project_weekly_task_progress');
    expect(sql).toContain('daily_log_volumes');
    expect(sql).toContain('project_delay_events');
    expect(sql).toContain('quantity_acceptance_items');
  });
});
