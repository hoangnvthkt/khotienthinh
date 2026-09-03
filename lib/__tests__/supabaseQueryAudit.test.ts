import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../../scripts/lib/supabaseQueryAudit.mjs';

const readFixture = (name: string) => readFileSync(
  resolve(process.cwd(), 'scripts/fixtures', name),
  'utf8',
);

describe('Supabase query audit', () => {
  it('flags wildcard lists and accepts explicit bounded query shapes', () => {
    const unsafe = readFixture('supabase-query-audit-unsafe.ts');
    const safe = readFixture('supabase-query-audit-safe.ts');

    expect(analyzeSource(unsafe, 'unsafe.ts')).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'wildcard-list', severity: 'error' }),
      expect.objectContaining({ rule: 'missing-result-policy', severity: 'error' }),
    ]));
    expect(analyzeSource(safe, 'safe.ts').filter(row => row.severity === 'error')).toEqual([]);
  });

  it('follows result modifiers assigned to a query variable', () => {
    const safe = readFixture('supabase-query-audit-safe.ts');
    const findings = analyzeSource(safe, 'safe.ts');

    expect(findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        functionName: 'loadSafePage',
        rule: 'missing-result-policy',
      }),
    ]));
  });

  it('recognizes complete-read helpers and bounded mutation returns', () => {
    const safe = readFixture('supabase-query-audit-safe.ts');
    const findings = analyzeSource(safe, 'safe.ts');

    expect(findings.filter((row: any) => [
      'loadEverySafeRow',
      'loadEveryAssignedSafeRow',
      'createManySafeRows',
    ].includes(row.functionName))).toEqual([]);
  });
});
