import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260813070319_gantt_room_authoritative_cutover.sql',
), 'utf8');
const normalized = migration.toLowerCase().replace(/\s+/g, ' ').trim();

describe('gantt Room authoritative migration', () => {
  it('replaces the Room contract with three pilot actions and no PBAC fallback', () => {
    expect(normalized).toContain("allowed_actions = array['view', 'edit', 'delete']::text[]");
    expect(normalized).toContain("required_actions = '{}'::text[]");
    expect(normalized).toContain("'gantt', 'edit'");
    expect(normalized).toContain("'gantt', 'delete'");
    expect(normalized).toContain("'pilot'");
    expect(normalized).toContain('pbac_fallback_enabled = false');
    expect(normalized).toContain("action_code in ('submit', 'verify', 'approve')");
  });

  it('preserves manual grants while marking generated grants as PBAC backfill', () => {
    expect(normalized).toContain("else 'pbac_backfill'");
    expect(normalized).toContain("grant_source = case");
    expect(normalized).toContain("then public.project_permission_room_member_actions.grant_source");
    expect(normalized).toContain("'view' as action_code");
    expect(normalized).toContain(
      'group by project_staff_id, project_id, construction_site_id, action_code',
    );
    expect(normalized).toContain(
      'group by project_id, construction_site_id, project_staff_id',
    );
  });

  it('adds optimistic concurrency and a private idempotency ledger', () => {
    expect(normalized).toContain('add column if not exists updated_at timestamptz');
    expect(normalized).toContain('add column if not exists row_version bigint');
    expect(normalized).toContain('create trigger trg_project_tasks_gantt_version');
    expect(normalized).toContain('create table if not exists app_private.project_gantt_command_requests');
    expect(normalized).toContain('unique (actor_user_id, request_id)');
  });

  it('retires completion mode and removes product access without deleting history', () => {
    expect(normalized).toContain("set progress_mode = 'manual'");
    expect(normalized).not.toContain('delete from public.project_task_completion_requests');
    expect(normalized).toContain('drop policy if exists project_task_completion_requests_select');
    expect(normalized).toMatch(
      /revoke all on table public\.project_task_completion_requests from [^;]*authenticated/,
    );

    const progressConstraint = normalized.slice(normalized.lastIndexOf('add constraint project_tasks_progress_mode_check'));
    expect(progressConstraint).not.toContain("'completion_request'");
  });
});
