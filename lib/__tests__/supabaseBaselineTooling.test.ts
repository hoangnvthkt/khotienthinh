import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { buildMigrationInventory } from '../../scripts/supabase-baseline/migration-inventory.mjs';

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'vioo-baseline-'));
  mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(join(root, 'supabase', 'migrations_archive', 'pre_baseline_20260903'), { recursive: true });
  mkdirSync(join(root, 'supabase', 'baseline'), { recursive: true });
  return root;
};

const write = (root: string, relativePath: string, value = '-- fixture\n') => {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, value);
};

const runGuard = (root: string) => spawnSync(
  process.execPath,
  ['scripts/check-supabase-migration-baseline.mjs', '--root', root],
  { cwd: process.cwd(), encoding: 'utf8' },
);

describe('Supabase baseline migration tooling', () => {
  it('reports invalid names, duplicate versions, and local/remote differences deterministically', () => {
    const root = makeRoot();
    const activeDir = join(root, 'supabase', 'migrations');
    const archiveDir = join(root, 'supabase', 'migrations_archive', 'pre_baseline_20260903');
    write(root, 'supabase/migrations/20260903090000_base.sql');
    write(root, 'supabase/migrations/20260903090000_duplicate.sql');
    write(root, 'supabase/migrations/20260903090100_perf.sql');
    write(root, 'supabase/migrations/20260903_bad.sql');

    expect(buildMigrationInventory({
      activeDir,
      archiveDir,
      remoteVersions: ['20260903090000', '20260903090200'],
    })).toMatchObject({
      activeSqlCount: 4,
      validUniqueActiveVersions: ['20260903090000', '20260903090100'],
      invalidActiveFiles: ['20260903_bad.sql'],
      duplicateActiveVersions: ['20260903090000'],
      localOnlyVersions: ['20260903090100'],
      remoteOnlyVersions: ['20260903090200'],
    });
  });

  it('allows legacy inventory before a baseline marker exists', () => {
    const root = makeRoot();
    write(root, 'supabase/migrations/20260903_legacy.sql');

    const result = runGuard(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pre-baseline warning');
  });

  it('rejects invalid, duplicate, or pre-boundary active migrations after cutover', () => {
    const root = makeRoot();
    write(root, 'supabase/migrations/20260903090000_cloud_schema_baseline_v2.sql');
    write(root, 'supabase/migrations/20260903090000_duplicate.sql');
    write(root, 'supabase/migrations/20260903085959_historical.sql');
    write(root, 'supabase/migrations/20260903_invalid.sql');
    write(root, 'supabase/baseline/current.json', JSON.stringify({
      baselineVersion: '20260903090000',
      baselineFilename: '20260903090000_cloud_schema_baseline_v2.sql',
      allowedPostBaselineFiles: [],
    }));

    const result = runGuard(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid migration filename');
    expect(result.stderr).toContain('duplicate migration version');
    expect(result.stderr).toContain('at or before baseline boundary');
  });

  it('rejects include-all in deployment configuration', () => {
    const root = makeRoot();
    write(root, 'supabase/migrations/20260903090000_cloud_schema_baseline_v2.sql');
    write(root, 'supabase/baseline/current.json', JSON.stringify({
      baselineVersion: '20260903090000',
      baselineFilename: '20260903090000_cloud_schema_baseline_v2.sql',
      allowedPostBaselineFiles: [],
    }));
    write(root, 'package.json', JSON.stringify({ scripts: { deploy: 'supabase db push --include-all' } }));

    const result = runGuard(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('forbidden --include-all');
  });
});
