import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canRejectAtWorkflowStep, getWorkflowStepActionCopy } from '../workflowStepType';
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
