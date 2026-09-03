import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanWorkspace } from '../../scripts/lib/supabaseQueryAudit.mjs';

describe('remaining Supabase query policies', () => {
  it('has no unclassified or unsafe-error findings', () => {
    const root = process.cwd();
    const policy = JSON.parse(readFileSync(resolve(root, 'scripts/supabase-query-policy.json'), 'utf8'));
    const report = scanWorkspace(root, policy);

    expect(report.findings.filter((row: any) => !row.classification)).toEqual([]);
    expect(report.findings.filter((row: any) => row.classification === 'page' && row.projection === '*')).toEqual([]);
    expect(report.findings.filter((row: any) => row.severity === 'error')).toEqual([]);
  });
});
