import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Đợt 1 audit mẫu quyền: được giao là được làm (20261028210000)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261028210000_permission_dot1_assigned_can_act.sql'),
    'utf8',
  );
  const body = (name: string) => {
    const start = sql.indexOf(`create or replace function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf('$$;', start));
  };

  it('lets the holder of a pending request step approve, reject and return without a separate permission', () => {
    const lifecycle = body('app_private.request_actor_has_lifecycle_action');
    for (const action of ['APPROVE', 'REJECT', 'RETURN']) {
      expect(lifecycle).toContain(
        `when '${action}' then app_private.request_actor_holds_pending_step(request_row.workflow_subject_id, p_actor_id)`,
      );
    }
    expect(lifecycle).not.toContain("'system.rq.view'");
    expect(lifecycle).not.toContain("'request.instance.approve_assigned'");
    expect(body('app_private.request_actor_holds_pending_step')).toContain("assignment_row.status = 'PENDING'");
    // The helper is created before the function that calls it.
    expect(sql.indexOf('function app_private.request_actor_holds_pending_step('))
      .toBeLessThan(sql.indexOf('function app_private.request_actor_has_lifecycle_action('));
  });

  it('lets the creator resubmit, edit and cancel their own request', () => {
    const lifecycle = body('app_private.request_actor_has_lifecycle_action');
    expect(lifecycle).toContain("when 'RESUBMIT' then request_row.created_by = p_actor_id");
    expect(lifecycle).toContain("when 'EDIT_CONTENT' then request_row.created_by = p_actor_id");
    expect(lifecycle).toMatch(/when 'CANCEL' then\s+request_row\.created_by = p_actor_id/);
  });

  it('lets creators, current handlers and template managers add workflow watchers; removing others stays admin-only', () => {
    const watchers = body('public.update_workflow_instance_watchers');
    expect(watchers).toContain('i.created_by is distinct from v_actor');
    expect(watchers).toContain('app_private.workflow_instance_actor_is_current_assignee(i.id, v_actor)');
    expect(watchers).toContain("coalesce(template_row.managers, '{}'::text[]) @> array[v_actor::text]");
    expect(watchers).toContain('if cardinality(v_removed_others) > 0 and not v_is_admin then');
  });

  it('lets the creator cancel their own running workflow ticket', () => {
    const cancel = body('public.cancel_workflow_instance');
    expect(cancel).toContain('v_instance.created_by = v_actor');
    expect(cancel).toContain("v_instance.status <> 'RUNNING'");
    expect(cancel).toContain("perform set_config('app.workflow_command', 'cancel', true)");
  });

  it('stops the two "assigned" request approvals from expiring', () => {
    expect(sql).toMatch(/update public\.permission_actions\s+set direct_grant_requires_expiry = false/);
    expect(sql).toMatch(/update public\.user_permission_grants\s+set expires_at = null/);
    expect(sql).toContain("'request.instance.approve_assigned', 'request.instance.reject_assigned'");
  });
});
