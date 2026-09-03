import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AppContext growing histories', () => {
  it('does not hydrate growing WMS histories through fetchTableHelper', () => {
    const source = readFileSync('context/AppContext.tsx', 'utf8');
    expect(source).not.toMatch(/fetchTableHelper\('transactions'/);
    expect(source).not.toMatch(/fetchTableHelper\('requests'/);
    expect(source).not.toMatch(/query:\s*any\s*=\s*supabase\.from\(table\)\.select\('\*'\)/);
  });
});
