import { describe, expect, it } from 'vitest';
import { buildWorkflowRoute } from '../workflowRoutes';

describe('Workflow canonical routes', () => {
  it('builds an encoded UUID detail path with supported anchors', () => {
    expect(buildWorkflowRoute('wf/instance 1', {
      nodeId: 'node/2',
      commentId: 'comment 3',
      eventKey: 'workflow.step_assigned',
    })).toBe('/wf/wf%2Finstance%201?node=node%2F2&comment=comment+3&event=workflow.step_assigned');
  });

  it('rejects an empty instance id', () => {
    expect(() => buildWorkflowRoute('')).toThrow('Workflow instance id is required');
  });
});
