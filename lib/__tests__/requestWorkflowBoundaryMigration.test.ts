import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260802153500_guard_request_owned_workflow_actions.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('Request-owned workflow action boundary migration', () => {
  it('guards the array-assignee generic workflow action overload', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toMatch(
      /create or replace function public\.process_workflow_instance_fast\s*\(\s*p_instance_id uuid,\s*p_action public\.workflow_instance_action,\s*p_user_id uuid,\s*p_comment text,\s*p_next_assignee_user_ids uuid\[\]/i,
    );
    expect(normalized).toContain('from public.request_instances request_instance');
    expect(normalized).toContain('request_instance.workflow_instance_id = p_instance_id');
    expect(normalized).toContain("message = 'REQUEST_WORKFLOW_USE_REQUEST_MODULE'");
  });

  it('checks ownership before recording an action', () => {
    const guardIndex = normalized.indexOf("message = 'REQUEST_WORKFLOW_USE_REQUEST_MODULE'");
    const logIndex = normalized.indexOf('insert into public.workflow_instance_logs');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(logIndex).toBeGreaterThan(guardIndex);
  });

  it('preserves the authenticated execute boundary and reloads PostgREST', () => {
    expect(normalized).toContain(
      'grant execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid[]) to authenticated',
    );
    expect(normalized).toContain("notify pgrst, 'reload schema'");
  });
});
