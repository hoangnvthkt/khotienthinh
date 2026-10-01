import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workflow log visibility follows the ticket (20260930092517)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260930092517_workflow_logs_rls_follow_ticket.sql'),
    'utf8',
  );

  it('derives log visibility from ticket visibility instead of re-checking every row', () => {
    expect(sql).toContain('alter policy wf_logs_select on public.workflow_instance_logs');
    expect(sql).toContain('instance_id in (select visible.id from public.workflow_instances visible)');
    expect(sql).not.toContain('workflow_instance_actor_can_select(instance_id)');
  });
});
