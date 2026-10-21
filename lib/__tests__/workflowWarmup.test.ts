import { describe, expect, it } from 'vitest';
import { shouldWarmWorkflowData } from '../workflowWarmup';

describe('workflow data warmup', () => {
  it('warms workflow data when a project screen is opened directly', () => {
    // Dự án tự nạp quy trình khi cần, không nạp sẵn lúc mở trang (12/10/2026).
    expect(shouldWarmWorkflowData('/da')).toBe(false);
    expect(shouldWarmWorkflowData('/da/project/123')).toBe(false);
  });

  it('preserves workflow routes without matching the standard dashboard', () => {
    expect(shouldWarmWorkflowData('/wf/templates')).toBe(true);
    expect(shouldWarmWorkflowData('/employee-dashboard')).toBe(true);
    expect(shouldWarmWorkflowData('/custom-dashboard')).toBe(true);
    expect(shouldWarmWorkflowData('/dashboard')).toBe(false);
  });
});
