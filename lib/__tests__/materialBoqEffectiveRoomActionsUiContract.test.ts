import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'hooks', 'project', 'material', 'useProjectMaterialAccess.ts'),
  'utf8',
);

describe('material BOQ effective Room capabilities', () => {
  it('loads material-planning actions and maps them to BOQ capabilities', () => {
    expect(source).toContain('projectPermissionRoomService.listMyActions');
    expect(source).toContain("action.roomCode === 'material_planning'");
    expect(source).toContain('getProjectMaterialActionCodesForRoomAction');
  });

  it('does not check BOQ PBAC codes separately from the effective action RPC', () => {
    expect(source).toContain('NON_BOQ_PBAC_ACTION_CODES');
    expect(source).toContain("'project.material_boq.view'");
    expect(source).toContain("'project.material_boq.edit'");
    expect(source).toContain("'project.material_boq.delete'");
  });
});
