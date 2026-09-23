import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260923075546_project_v2_planning_commands.sql', 'utf8').toLowerCase();

describe('Project V2 planning commands', () => {
  it.each(['save', 'submit', 'return', 'approve', 'create_project_v2_plan_revision',
    'cancel', 'delete_project_v2_plan_draft', 'add_project_v2_plan_comment'])('exposes %s command', name => {
    const functionName = name.startsWith('create_') || name.startsWith('delete_') || name.startsWith('add_')
      ? `${name}_v1` : `${name}_project_v2_plan_v1`;
    expect(sql).toContain(`function public.${functionName}`);
  });

  it('uses server actor, expected version and idempotency ledger', () => {
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain('p_expected_version');
    expect(sql).toContain('p_idempotency_key');
    expect(sql).toContain('app_private.project_v2_commands');
    expect(sql).toContain('project_v2_idempotency_conflict');
    expect(sql).toContain('project_v2_version_stale');
  });

  it('locks the workspace, plan, and sorted source identities before allocation checks', () => {
    expect(sql).toContain('for update of w');
    expect(sql).toContain('for update of p');
    expect(sql).toMatch(/order by id\s+loop[\s\S]*?for update of [pl]/);
    expect(sql).toContain('project_v2_source_quantity_exceeded');
  });

  it('preserves approval and cancellation boundaries', () => {
    expect(sql).toContain('project_v2_self_approval_denied');
    expect(sql).toContain('project_v2_plan_revisions');
    expect(sql).toContain('project_v2_plan_events');
    expect(sql).toContain('project_v2_downstream_reconciliation_required');
    expect(sql).toContain('project_v2_source_hash_stale');
  });

  it('grants wrappers only to authenticated callers', () => {
    expect(sql).toContain('security definer set search_path =');
    expect(sql).toContain('to authenticated');
    expect(sql).toContain('from public, anon, authenticated');
  });
});
