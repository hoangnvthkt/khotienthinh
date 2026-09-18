import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260917022452_authorization_v2_task12_4_2_workflow_boundary_hardening.sql',
), 'utf8');
const aclFixMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260917024602_authorization_v2_task12_4_2_workflow_boundary_acl_fix.sql',
), 'utf8');
const workflowContext = readFileSync(resolve(process.cwd(), 'context/WorkflowContext.tsx'), 'utf8');
const workflowTemplates = readFileSync(resolve(process.cwd(), 'pages/wf/WorkflowTemplates.tsx'), 'utf8');
const workflowInstances = readFileSync(resolve(process.cwd(), 'pages/wf/WorkflowInstances.tsx'), 'utf8');

describe('Workflow boundary hardening', () => {
  it('defines canonical template and instance capability helpers', () => {
    expect(migration).toContain('workflow_template_actor_can_view');
    expect(migration).toContain('workflow_template_actor_can_edit');
    expect(migration).toContain('workflow_template_actor_can_publish');
    expect(migration).toContain("'workflow.instance.act_assigned'");
    expect(migration).toContain("'workflow.instance.view'");
  });

  it('moves template lifecycle writes behind guarded RPCs', () => {
    expect(migration).toContain('create_workflow_template');
    expect(migration).toContain('update_workflow_template_metadata');
    expect(migration).toContain('publish_workflow_template');
    expect(migration).toContain('revoke insert, update, delete on public.workflow_templates');
    expect(migration).toContain('revoke insert, update, delete on public.workflow_nodes');
    expect(migration).toContain('revoke insert, update, delete on public.workflow_edges');
    expect(workflowContext).toContain("supabase.rpc('create_workflow_template'");
    expect(workflowContext).toContain("supabase.rpc('update_workflow_template_metadata'");
    expect(workflowContext).toContain("supabase.rpc('publish_workflow_template'");
    expect(workflowContext).not.toContain("from('workflow_templates').insert");
    expect(workflowContext).not.toContain("from('workflow_templates').update");
    expect(workflowContext).not.toContain("from('workflow_templates').delete");
    expect(workflowContext).not.toContain("from('workflow_nodes').upsert");
    expect(workflowContext).not.toContain("from('workflow_edges').insert");
  });

  it('narrows template and instance reads to canonical capability helpers', () => {
    expect(migration).toContain('workflow_templates_select');
    expect(migration).toContain('workflow_nodes_select');
    expect(migration).toContain('workflow_edges_select');
    expect(migration).toContain('workflow_instances_select');
    expect(migration).not.toMatch(/CREATE POLICY workflow_(templates|nodes|edges)_select[\s\S]{0,300}USING \(true\)/i);
  });

  it('keeps RLS predicate helpers callable by authenticated', () => {
    expect(aclFixMigration).toContain('grant execute on function app_private.workflow_instance_actor_can_select');
    expect(aclFixMigration).toContain('grant execute on function app_private.workflow_template_actor_can_view');
  });

  it('renders workflow controls from the canonical actions', () => {
    expect(workflowTemplates).toContain("canPerform(user, 'workflow.template.create'");
    expect(workflowTemplates).toContain("canPerform(user, 'workflow.template.edit'");
    expect(workflowTemplates).toContain("canPerform(user, 'workflow.template.publish'");
    expect(workflowInstances).toContain("canPerform(user, 'workflow.instance.act_assigned'");
  });
});
