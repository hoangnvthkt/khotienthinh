import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const context = readFileSync('context/WorkflowContext.tsx', 'utf8');

describe('Workflow client notification cutover', () => {
  it('does not retain the generic React fan-out path', () => {
    expect(context).not.toContain('notifyWorkflowUsers');
    expect(context).toContain('notifyMaterialWorkflowUsers');
    expect(context).toContain("input.category !== 'material'");
    expect(context).toContain("input.sourceType !== 'material_request'");
  });
});
