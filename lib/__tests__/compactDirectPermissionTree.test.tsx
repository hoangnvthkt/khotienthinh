import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('CompactDirectPermissionTree source contract', () => {
  it('starts module children collapsed and reveals actions through expanded state', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain("useState<Set<string>>(new Set())");
    expect(source).toContain('toggleExpanded');
    expect(source).toContain('expandedModules.has(module.code)');
    expect(source).toContain('ChevronRight');
    expect(source).toContain('ChevronDown');
  });

  it('edits only Direct Grants through the unified draft toggle', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain('toggleUnifiedDirectGrant');
    expect(source).toContain('onGrantsChange');
    expect(source).not.toContain('onLegacyStateChange');
    expect(source).not.toContain('toggleLegacy');
    expect(source).not.toContain('principal_role_assignments');
  });

  it('keeps Role and Legacy evidence read-only through badges', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain('row.sourceBadges.map');
    expect(source).toContain('Nguồn quyền');
    expect(source).toContain('hasDirectGrant');
  });
});
