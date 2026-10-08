import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('pages/project/MaterialTab.tsx', 'utf8');

describe('kanban admin move (drag and drop)', () => {
  it('lets only workflow administrators drop a card on any workflow lane', () => {
    expect(source).toContain('if (!canManageRequestWorkflow || !toStage.startsWith(\'workflow:\')) return null;');
    expect(source).toContain("subject.status !== 'RUNNING' && subject.status !== 'RETURNED'");
  });

  it('keeps the normal next-step flow for assignees and opens the move dialog otherwise', () => {
    expect(source).toContain('if (!canMoveMaterialRequestNormally(request, toStage, fromStage))');
    expect(source).toContain('setAdminMoveTransition({ request, ...adminMove })');
    expect(source).toContain('action="move_step"');
  });
});
