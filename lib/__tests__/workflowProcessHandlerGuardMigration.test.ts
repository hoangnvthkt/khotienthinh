import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261028200000_wf_process_handler_guard.sql', 'utf8');
const normalized = sql.replace(/\s+/g, ' ');

const functionBody = (name: string) => {
  const start = normalized.indexOf(`create or replace function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return normalized.slice(start, normalized.indexOf('$$;', start));
};

describe('Workflow process handler guard migration', () => {
  it('revokes the legacy 4-argument process RPCs that skip the handler check', () => {
    expect(normalized).toContain(
      'revoke execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) from public, anon, authenticated',
    );
    expect(normalized).toContain(
      'revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text) from public, anon, authenticated',
    );
    expect(normalized).not.toMatch(/grant execute on function public\.process_workflow_instance(_fast)?\(uuid, public\.workflow_instance_action, uuid, text\)/);
  });

  it('only lets the current-step handler or an administrator write a decision log', () => {
    const canProcess = functionBody('app_private.workflow_instance_actor_can_process');
    expect(canProcess).toContain("instance_row.status = 'RUNNING'");
    expect(canProcess).toContain('app_private.workflow_instance_actor_is_current_assignee(instance_row.id, p_actor_id)');
    expect(canProcess).toContain("coalesce(template_row.managers, '{}'::text[]) @> array[p_actor_id::text]");
    expect(canProcess).toContain("'workflow.instance.administer'");
    // Holding act_assigned alone is no longer enough.
    expect(canProcess).not.toContain('workflow.instance.act_assigned');

    const guard = functionBody('app_private.guard_generic_workflow_process_log');
    expect(guard).toContain("coalesce(current_setting('app.workflow_command', true), '') <> 'cancel'");
    expect(guard).toContain('app_private.workflow_instance_actor_can_process(new.instance_id, new.acted_by)');
  });

  it('scopes workflow-attachments reads and uploads to the workflow instance', () => {
    const canSelect = functionBody('app_private.workflow_attachment_object_can_select');
    expect(canSelect).toContain("'$.** ? (@.storagePath == $path)'");
    expect(canSelect).toContain('app_private.workflow_instance_actor_can_select(instance_row.id)');
    expect(canSelect).toContain("app_private.workflow_instance_actor_can_select(split_part(p_name, '/', 2)::uuid)");

    const canInsert = functionBody('app_private.workflow_attachment_object_can_insert');
    expect(canInsert).toContain("app_private.workflow_step_task_actor_can_write(split_part(p_name, '/', 2)::uuid)");
    expect(canInsert).toContain("p_name ~ '^[0-9]{4}/[^/]+$'");
    expect(canInsert).toContain('else false');

    expect(normalized).toMatch(
      /create policy workflow_attachments_select on storage\.objects for select to authenticated using \( bucket_id = 'workflow-attachments' and \( owner_id = \(select auth\.uid\(\)\)::text or app_private\.workflow_attachment_object_can_select\(name\) \) \)/,
    );
    expect(normalized).toMatch(
      /create policy workflow_attachments_insert on storage\.objects for insert to authenticated with check \( bucket_id = 'workflow-attachments' and app_private\.workflow_attachment_object_can_insert\(name\) \)/,
    );
  });

  it('splits workflow_step_tasks into read for viewers and writes for handlers', () => {
    expect(normalized).toContain('drop policy if exists workflow_step_tasks_instance_access on public.workflow_step_tasks');
    expect(normalized).not.toMatch(/create policy \w+ on public\.workflow_step_tasks for all/);
    for (const command of ['insert', 'update', 'delete']) {
      const start = normalized.indexOf(`create policy workflow_step_tasks_${command} on public.workflow_step_tasks for ${command}`);
      expect(start).toBeGreaterThan(-1);
      expect(normalized.slice(start, normalized.indexOf(');', start))).toContain(
        'app_private.workflow_step_task_actor_can_write(instance_id)',
      );
    }
    expect(normalized).toContain('and created_by = (select public.current_app_user_id())');
  });

  it('keeps new helpers private to authenticated callers and reloads PostgREST', () => {
    for (const helper of [
      'app_private.workflow_step_task_actor_can_write(uuid)',
      'app_private.workflow_attachment_object_can_select(text)',
      'app_private.workflow_attachment_object_can_insert(text)',
    ]) {
      expect(normalized).toContain(`revoke all on function ${helper} from public, anon`);
      expect(normalized).toContain(`grant execute on function ${helper} to authenticated`);
    }
    expect(normalized).toContain("notify pgrst, 'reload schema'");
  });
});
