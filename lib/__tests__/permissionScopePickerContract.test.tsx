import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('PermissionScopePicker contract', () => {
  it('uses searchable lookup options for entity scopes and keeps raw id fallback', () => {
    const source = read('components/permissions/PermissionScopePicker.tsx');

    expect(source).toContain('SearchableSelect');
    expect(source).toContain('lookupOptions');
    expect(source).toContain('raw id');
    expect(source).toContain('PermissionScopeLookupOptionsByType');
    expect(source).toContain("scopeId: '*'");
  });
});
