import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowContextSource = readFileSync(
  resolve(process.cwd(), 'context/WorkflowContext.tsx'),
  'utf8',
);
const kanbanSource = readFileSync(
  resolve(process.cwd(), 'components/KanbanBoard.tsx'),
  'utf8',
);
const detailSource = readFileSync(
  resolve(process.cwd(), 'pages/wf/WorkflowInstanceDetail.tsx'),
  'utf8',
);
const runningMutationMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260916095000_authorization_v2_task12_4_2_workflow_running_mutation_guard.sql',
  ),
  'utf8',
);
const draftCommandsMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260916102100_authorization_v2_task12_4_2_workflow_draft_commands.sql',
  ),
  'utf8',
);
const workflowInstancesSource = readFileSync(
  resolve(process.cwd(), 'pages/wf/WorkflowInstances.tsx'),
  'utf8',
);

describe('workflow instance capability commands', () => {
  it('routes lifecycle and watcher mutations through guarded RPC commands', () => {
    expect(workflowContextSource).toContain("supabase.rpc('create_workflow_instance_draft'");
    expect(workflowContextSource).toContain("supabase.rpc('submit_workflow_instance_draft'");
    expect(workflowContextSource).toContain("supabase.rpc('delete_workflow_instance_draft'");
    expect(workflowContextSource).toContain("supabase.rpc('update_workflow_instance_content'");
    expect(workflowContextSource).toContain("supabase.rpc('cancel_workflow_instance'");
    expect(workflowContextSource).toContain("supabase.rpc('reopen_workflow_instance'");
    expect(workflowContextSource).toContain("supabase.rpc('update_workflow_instance_watchers'");
  });

  it('does not keep the previous direct lifecycle table updates', () => {
    expect(workflowContextSource).not.toContain("from('workflow_instances').update");
    expect(workflowContextSource).not.toContain("from('workflow_instances').delete");
    expect(workflowContextSource).not.toContain("from('workflow_instance_logs').delete");
    expect(workflowContextSource).not.toContain("from('workflow_instances').insert");
    expect(workflowContextSource).not.toContain("from('workflow_instance_logs').insert");
    const cancelBody = workflowContextSource.match(
      /const cancelInstance[\s\S]*?const reopenInstance/,
    )?.[0] || '';
    const reopenBody = workflowContextSource.match(
      /const reopenInstance[\s\S]*?\/\/ ---- Instance Watchers ----/,
    )?.[0] || '';
    const watcherBody = workflowContextSource.match(
      /const updateInstanceWatchers[\s\S]*?\/\/ ==================== PRINT TEMPLATES/,
    )?.[0] || '';

    expect(cancelBody).not.toContain("from('workflow_instances').update");
    expect(reopenBody).not.toContain("from('workflow_instances').update");
    expect(watcherBody).not.toContain("from('workflow_instances').update");
  });

  it('exposes reopen drag only to the canonical capability or compatibility admin', () => {
    expect(kanbanSource).toContain("canPerform(user, 'workflow.instance.reopen'");
    expect(kanbanSource).toContain('if (!canReopenWorkflowInstance) return;');
  });

  it('limits running content edits to current-step assignees or instance administrators', () => {
    expect(runningMutationMigration).toContain('workflow_instance_actor_is_current_assignee');
    expect(runningMutationMigration).toContain("'workflow.instance.administer'");
    expect(runningMutationMigration).toContain("v_step_prefix := 'step_' || i.current_node_id::text || '_'");
    expect(runningMutationMigration).toContain('revoke update, delete on public.workflow_instances');
    expect(runningMutationMigration).toContain('revoke update, delete on public.workflow_instance_logs');
    expect(detailSource).toContain("canPerform(user, 'workflow.instance.administer'");
    expect(detailSource).toContain('canEdit={canAct || canAdministerInstance}');
    expect(detailSource).not.toContain('canEdit={canAct || instance.createdBy === user.id');
  });

  it('implements a real owner-only draft lifecycle without direct table inserts', () => {
    expect(draftCommandsMigration).toContain("instance_row.status = 'DRAFT'");
    expect(draftCommandsMigration).toContain('instance_row.created_by = p_actor_id');
    expect(draftCommandsMigration).toContain("'workflow.instance.edit_own_draft'");
    expect(draftCommandsMigration).toContain("'workflow.instance.delete_own_draft'");
    expect(draftCommandsMigration).toContain('revoke insert on public.workflow_instances');
    expect(draftCommandsMigration).toContain('revoke insert on public.workflow_instance_logs');
    expect(workflowInstancesSource).toContain('onClick={handleSaveDraft}');
    expect(workflowInstancesSource).toContain('onClick={handleSubmitDraft}');
    expect(workflowInstancesSource).toContain('onClick={handleDeleteDraft}');
    expect(workflowInstancesSource).toContain("DRAFT: { label: 'Bản nháp'");
  });
});
