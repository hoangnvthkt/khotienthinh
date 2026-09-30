import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name => name.endsWith('_request_watchers_reassign_soft_delete.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
const fn = (name: string) => sql.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$function\\$;`, 'i'))?.[0] ?? '';

describe('request watchers / reassign / soft delete migration', () => {
  it('hides soft-deleted requests from every viewer, admins included', () => {
    const canSelect = fn('app_private\\.request_instance_can_select');
    expect(canSelect.indexOf('live_request.deleted_at is null'))
      .toBeLessThan(canSelect.indexOf('app_private.request_user_can_manage(p_user_id)'));
  });

  it('lets the pending approver reassign their own share, or an admin any share', () => {
    const reassign = fn('app_private\\.reassign_request_assignment');
    expect(reassign).toContain("v_assignment.assignee_user_id <> v_actor\n     and not app_private.request_action_is_admin(v_actor)");
    expect(reassign).toContain('REQUEST_REASSIGN_REASON_REQUIRED');
    expect(reassign).toContain('REQUEST_REASSIGN_TARGET_DUPLICATE');
    expect(reassign).toContain('REQUEST_APPROVER_SELF_NOT_ALLOWED');
    // New assignment is inserted while the actor's own assignment is still pending.
    expect(reassign.indexOf('insert into public.workflow_step_assignments'))
      .toBeLessThan(reassign.indexOf("set status = 'CANCELLED'"));
    expect(fn('app_private\\.request_actor_has_lifecycle_action')).toMatch(/when 'REASSIGN' then[\s\S]*own_assignment\.assignee_user_id = p_actor_id/);
  });

  it('allows delete only by the creator before anyone acted or after cancel', () => {
    const del = fn('app_private\\.delete_request');
    expect(del).toContain('v_request.created_by <> v_actor');
    expect(del).toContain("v_request.status = 'CANCELLED'");
    expect(del).toContain("acted.status in ('APPROVED', 'REJECTED', 'RETURNED')");
    expect(del).toContain('set deleted_at = now(), deleted_by = v_actor');
    expect(del).not.toMatch(/delete from public\.request_instances/i);
  });

  it('keeps template watchers and only removes manual ones', () => {
    expect(fn('app_private\\.remove_request_watcher')).toContain("and source = 'request_manual'");
    expect(fn('app_private\\.add_request_watchers')).toContain("'WATCHER', 'request_manual'");
  });

  it('exposes the new RPCs to authenticated users only', () => {
    for (const signature of [
      'reassign_request_assignment(uuid, uuid, uuid, text, text, timestamptz)',
      'add_request_watchers(uuid, uuid[])',
      'remove_request_watcher(uuid, uuid)',
      'delete_request(uuid, timestamptz)',
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated;`);
    }
  });
});
