import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260813070319_gantt_room_authoritative_cutover.sql',
), 'utf8').toLowerCase().replace(/\s+/g, ' ');

describe('gantt supporting commands and reads migration', () => {
  it('defines the four supporting edit commands with invoker wrappers', () => {
    for (const routine of [
      'replace_project_gantt_task_contract_items',
      'create_project_gantt_baseline',
      'transition_project_gantt_delay_event',
      'apply_project_gantt_forecast',
    ]) {
      expect(sql).toContain(`create or replace function public.${routine}(`);
      expect(sql).toContain(`app_private.${routine}_impl`);
    }
    expect(sql).toContain("assert_project_gantt_action(p_project_id, v_site_id, 'edit')");
  });

  it('locks forecast tasks and events deterministically and checks task versions', () => {
    expect(sql).toContain('order by task.id for update');
    expect(sql).toContain('order by event.id for update');
    expect(sql).toContain('expected_row_version');
    expect(sql).toContain('project_schedule_revision_tasks');
  });

  it('makes gantt view authoritative and revokes direct product mutations', () => {
    expect(sql).toContain('create policy project_tasks_gantt_view');
    expect(sql).toContain("'gantt', 'view'");
    for (const table of [
      'project_tasks',
      'project_baselines',
      'project_delay_events',
      'project_schedule_revisions',
      'project_schedule_revision_tasks',
      'task_contract_items',
    ]) {
      expect(sql).toContain(`revoke insert, update, delete on table public.${table} from authenticated`);
      expect(sql).toContain(`revoke all on table public.${table} from anon`);
    }
  });

  it('exposes only the approved minimal consumer catalog projection', () => {
    expect(sql).toContain('create or replace function public.get_project_gantt_catalog(');
    expect(sql).toContain("'daily_log', 'weekly_progress', 'material_planning'");
    expect(sql).toContain("'quantity_acceptance', 'quality', 'payment'");
    expect(sql).toContain("'contractitemids'");
    const catalog = sql.slice(sql.indexOf('create or replace function app_private.get_project_gantt_catalog_impl'));
    expect(catalog).not.toContain("'notes'");
    expect(catalog).not.toContain("'watchers'");
    expect(catalog).not.toContain("'estimatedcostperday'");
    expect(catalog).not.toContain('project_task_completion_requests');
    expect(catalog).not.toContain("'report'");
    expect(catalog).not.toContain("'portfolio'");
  });
});
