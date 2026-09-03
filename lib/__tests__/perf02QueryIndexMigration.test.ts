import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PERF-02 query index migration', () => {
  it('contains only concurrent additive indexes backed by Cloud evidence', () => {
    const migrationDir = join(process.cwd(), 'supabase/migrations');
    const migrations = readdirSync(migrationDir)
      .filter(name => name.endsWith('_perf02_query_indexes.sql'));

    expect(migrations).toHaveLength(1);
    const sql = readFileSync(join(migrationDir, migrations[0]), 'utf8');
    expect(sql).toMatch(/create\s+index\s+concurrently\s+if\s+not\s+exists/iu);
    expect(sql).not.toMatch(/drop\s+(?:table|column|index)|alter\s+table|create\s+policy|row\s+level\s+security/iu);

    const evidencePath = join(process.cwd(), 'docs/performance/perf02-cloud-results.md');
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = readFileSync(evidencePath, 'utf8');
    const indexNames = [...sql.matchAll(/create\s+index\s+concurrently\s+if\s+not\s+exists\s+([a-z0-9_]+)/giu)]
      .map(match => match[1]);
    expect(indexNames.length).toBeGreaterThan(0);
    for (const indexName of indexNames) expect(evidence).toContain(`\`${indexName}\``);
  });
});
