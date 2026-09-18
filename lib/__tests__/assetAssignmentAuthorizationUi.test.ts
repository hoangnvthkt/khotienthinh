import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../pages/ts/AssetAssignment.tsx', import.meta.url), 'utf8');
const context = readFileSync(new URL('../../context/AppContext.tsx', import.meta.url), 'utf8');

describe('asset assignment UI authorization contract', () => {
  it('guards every operation with its own capability and awaits persistence', () => {
    expect(source).toContain("canStartAssetAssignmentAction(user, 'assign', asset)");
    expect(source).toContain("canStartAssetAssignmentAction(user, 'return', asset)");
    expect(source).toContain("canStartAssetAssignmentAction(user, 'transfer', asset)");
    expect(source).toContain('await addAssetAssignment');
    expect(source).toContain('toast.error');
  });

  it('routes mutations through the canonical command instead of direct table sync', () => {
    expect(context).toContain('await assetAssignmentService.record(a)');
    expect(context).not.toContain("syncToSupabase('asset_assignments'");
  });
});
