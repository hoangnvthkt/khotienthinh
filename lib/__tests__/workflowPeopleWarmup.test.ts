import { describe, expect, it } from 'vitest';
import * as warmupPolicy from '../appDataWarmupPolicy';

type GetWorkflowWarmupModules = (pathname: string) => string[];

const getWorkflowWarmupModules = (
  warmupPolicy as unknown as Record<string, unknown>
).getWorkflowWarmupModules as GetWorkflowWarmupModules | undefined;

describe('workflow people warmup', () => {
  it('loads only the workflow people projection instead of the complete HRM module', () => {
    expect(getWorkflowWarmupModules).toBeTypeOf('function');
    if (!getWorkflowWarmupModules) return;

    expect(getWorkflowWarmupModules('/wf/instances')).toEqual(['workflow-people']);
  });

  it('does not warm workflow people outside workflow routes', () => {
    expect(getWorkflowWarmupModules).toBeTypeOf('function');
    if (!getWorkflowWarmupModules) return;

    expect(getWorkflowWarmupModules('/hrm/attendance')).toEqual([]);
  });
});
