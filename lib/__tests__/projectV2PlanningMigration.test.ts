import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrations = readdirSync('supabase/migrations');
const filename = migrations.find(name => name.endsWith('_project_v2_planning_foundation.sql'));
if (!filename) throw new Error('Project V2 planning foundation migration is missing');
const sql = readFileSync(`supabase/migrations/${filename}`, 'utf8').toLowerCase();

const publicTables = [
  'project_v2_workspaces', 'project_v2_crews', 'project_v2_crew_members',
  'project_v2_plans', 'project_v2_plan_lines', 'project_v2_plan_line_sources',
  'project_v2_plan_revisions', 'project_v2_plan_comments', 'project_v2_plan_events',
] as const;

describe('Project V2 planning foundation migration', () => {
  it.each(publicTables)('creates %s with RLS and no direct client DML', table => {
    expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated`);
  });

  it('keeps command and revision history private and immutable', () => {
    expect(sql).toContain('create table app_private.project_v2_commands');
    expect(sql).toContain('project_v2_plan_revision_immutable');
    expect(sql).toContain('revoke all on public.project_v2_plan_revisions from public, anon, authenticated');
    expect(sql).toContain('revoke all on public.project_v2_plan_events from public, anon, authenticated');
  });

  it('exposes only scoped, search-path-pinned read wrappers and activation', () => {
    for (const functionName of ['list_project_v2_workspaces_v1', 'list_project_v2_plans_v1',
      'get_project_v2_plan_v1', 'activate_project_v2_workspace_v1']) {
      expect(sql).toContain(`create or replace function public.${functionName}`);
    }
    expect(sql).toMatch(/set search_path\s*=\s*''/);
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain('app_private.project_has_permission_v2');
    expect(sql).toContain("'capabilities'");
    expect(sql).toContain("'statuscounts'");
    expect(sql).toContain('p_snapshot_token timestamptz default null');
    expect(sql).toContain('project_v2_snapshot_stale');
    expect(sql).toMatch(/revoke all on function app_private\.[\s\S]*?from public, anon, authenticated/);
  });

  it('keys lineage to an exact plan revision and line, with numeric quantities', () => {
    expect(sql).toContain('source_plan_revision_no');
    expect(sql).toContain('source_plan_line_id');
    expect(sql).toContain('source_plan_hash');
    expect(sql).toContain('numeric(20,6)');
    expect(sql).toContain('foreign key (source_plan_line_id, source_plan_id, source_plan_revision_no)');
    expect(sql).toContain('contract_item_id uuid references public.contract_items(id)');
    expect(sql).toContain('inventory_item_id text references public.items(id)');
  });
});
