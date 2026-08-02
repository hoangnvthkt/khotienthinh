import { describe, expect, it } from 'vitest';
import { shouldWarmWorkflowData } from '../workflowWarmup';

describe('workflow data warmup', () => {
  it('warms workflow data when a project screen is opened directly', () => {
    expect(shouldWarmWorkflowData('/da')).toBe(true);
    expect(shouldWarmWorkflowData('/da/project/123')).toBe(true);
  });

  it('preserves workflow routes without matching the standard dashboard', () => {
    expect(shouldWarmWorkflowData('/wf/templates')).toBe(true);
    expect(shouldWarmWorkflowData('/employee-dashboard')).toBe(true);
    expect(shouldWarmWorkflowData('/custom-dashboard')).toBe(true);
    expect(shouldWarmWorkflowData('/dashboard')).toBe(false);
  });
});
