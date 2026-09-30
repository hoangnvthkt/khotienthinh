import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalAdvancesStage, canRejectAtWorkflowStep, getWorkflowStepActionCopy, getWorkflowStepApprovalState } from '../workflowStepType';
import { getWorkflowProcessErrorMessage } from '../workflowAssignmentResolver';
import { WorkflowNodeType } from '../../types';

describe('workflow step type wording', () => {
  it('uses "Hoàn thành" and no reject for action steps', () => {
    const copy = getWorkflowStepActionCopy({ type: WorkflowNodeType.ACTION, config: {} });
    expect(copy.primaryLabel).toBe('Hoàn thành');
    expect(copy.dragButton).toBe('✓ Hoàn thành');
    expect(copy.doneBy).toBe('Hoàn thành bởi');
    expect(copy.canReject).toBe(false);
  });

  it('keeps approve/reject for approval steps unless reject is switched off', () => {
    const copy = getWorkflowStepActionCopy({ type: WorkflowNodeType.APPROVAL, config: {} });
    expect(copy.primaryLabel).toBe('Chuyển tiếp / Duyệt');
    expect(copy.canReject).toBe(true);
    expect(canRejectAtWorkflowStep({ type: WorkflowNodeType.APPROVAL, config: { allowReject: false } })).toBe(false);
    expect(canRejectAtWorkflowStep(null)).toBe(false);
  });

  it('explains a refused reject', () => {
    expect(getWorkflowProcessErrorMessage({ message: 'WORKFLOW_REJECT_NOT_ALLOWED' })).toMatch(/không cho phép từ chối/);
  });
});

describe('workflow action step migration', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260930052309_workflow_action_step_complete.sql'),
    'utf8',
  );

  it('guards reject on action steps and on approval steps with reject switched off', () => {
    expect(sql).toContain("v_current_node.type = ''ACTION''::public.workflow_node_type");
    expect(sql).toContain("v_current_node.config ->> ''allowReject'', ''true'') = ''false''");
    expect(sql).toContain('WORKFLOW_REJECT_NOT_ALLOWED');
    expect(sql).toContain("raise exception 'process_workflow_instance_fast anchor not found'");
  });

  it('words the notification for a completed action step', () => {
    expect(sql).toContain('Đã hoàn thành bước');
    expect(sql).toContain("o.payload ->> ''outgoingNodeId''");
  });
});

describe('"tất cả phải duyệt" approval state', () => {
  const node = (approvalPolicy?: 'ANY_ONE' | 'ALL') => ({ id: 'stage', config: approvalPolicy ? { approvalPolicy } : {} });
  const instance = (assignees: string[], approved: string[] = []) => ({
    stepAssignees: { stage: assignees },
    stepApprovals: { stage: approved },
  });

  it('is off for "one is enough" stages and for a single assignee', () => {
    expect(getWorkflowStepApprovalState(instance(['a', 'b']), node()).requiresAll).toBe(false);
    expect(getWorkflowStepApprovalState(instance(['a']), node('ALL')).requiresAll).toBe(false);
  });

  it('tracks who approved and who is still pending, ignoring people no longer assigned', () => {
    const state = getWorkflowStepApprovalState(instance(['a', 'b', 'c'], ['a', 'x']), node('ALL'));
    expect(state).toEqual({ requiresAll: true, required: ['a', 'b', 'c'], approved: ['a'], pending: ['b', 'c'] });
  });

  it('advances only on the last pending approval, or for an override outside the list', () => {
    const state = getWorkflowStepApprovalState(instance(['a', 'b'], ['a']), node('ALL'));
    expect(approvalAdvancesStage(state, 'b')).toBe(true);
    expect(approvalAdvancesStage(getWorkflowStepApprovalState(instance(['a', 'b']), node('ALL')), 'a')).toBe(false);
    expect(approvalAdvancesStage(state, 'admin')).toBe(true);
    expect(getWorkflowProcessErrorMessage({ message: 'WORKFLOW_ALREADY_APPROVED' })).toMatch(/đã duyệt/);
  });
});

describe('all-must-approve migration', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260930075928_workflow_all_must_approve.sql'),
    'utf8',
  );

  it('holds the stage until every assignee approved and resets on stage change', () => {
    expect(sql).toContain("coalesce(v_current_node.config ->> 'approvalPolicy', 'ANY_ONE') = 'ALL'");
    expect(sql).toContain('if not (v_required <@ v_approved) then');
    expect(sql).toContain("raise exception 'WORKFLOW_ALREADY_APPROVED'");
    expect(sql).toContain('new.current_node_id is distinct from old.current_node_id');
    // The earlier reject guard for "Hành động" stages is kept.
    expect(sql).toContain("raise exception 'WORKFLOW_REJECT_NOT_ALLOWED'");
  });

  it('allows ALL only on generic templates and moves templates in one checked command', () => {
    expect(sql).toContain("not in (''ANY_ONE'', ''ALL'')");
    expect(sql).toContain('public.project_workflow_bindings binding');
    expect(sql).toContain('create or replace function public.move_workflow_templates_to_category');
    expect(sql).toContain('not app_private.workflow_template_actor_can_edit(x, v_actor)');
  });
});
