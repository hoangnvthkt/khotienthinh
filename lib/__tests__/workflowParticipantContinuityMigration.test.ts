import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260918103356_authorization_v2_workflow_participant_continuity.sql',
  'utf8',
);

describe('Workflow participant continuity migration', () => {
  it('creates an isolated participant ledger with private writes', () => {
    expect(migration).toContain('create table public.workflow_instance_participants');
    expect(migration).toMatch(/participant_role text not null check \(participant_role in \('CREATOR',\s*'ASSIGNEE',\s*'WATCHER'\)\)/);
    expect(migration).toContain('primary key (instance_id, user_id, participant_role)');
    expect(migration).toContain('alter table public.workflow_instance_participants enable row level security');
    expect(migration).toContain('revoke all on public.workflow_instance_participants from public, anon, authenticated');
    expect(migration).toContain('app_private.upsert_workflow_instance_participant');
  });

  it('backfills generic instances and historical assignment actors idempotently', () => {
    expect(migration).toMatch(/not exists\s*\(\s*select 1 from public\.workflow_subjects/);
    expect(migration).toContain("action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')");
    expect(migration).toContain('on conflict (instance_id, user_id, participant_role) do update');
  });

  it('separates historical selection from current-step action authorization', () => {
    expect(migration).toContain('app_private.workflow_instance_user_can_select');
    expect(migration).toContain("'workflow.instance.view'");
    expect(migration).not.toContain('create or replace function app_private.workflow_instance_actor_can_process');
  });
});
