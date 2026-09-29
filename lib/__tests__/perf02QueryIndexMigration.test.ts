import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PERF-02 query index migration', () => {
  it('creates the three reviewed indexes transactionally only on an empty database', () => {
    const migrationDir = join(process.cwd(), 'supabase/migrations');
    const migrations = readdirSync(migrationDir)
      .filter(name => name.endsWith('_perf02_query_indexes.sql'));

    expect(migrations).toHaveLength(1);
    const sql = readFileSync(join(migrationDir, migrations[0]), 'utf8');
    expect(sql).toMatch(/raise\s+exception\s+'PERF02_NONEMPTY_DATABASE_REQUIRES_CONCURRENT_APPLY'/iu);
    expect(sql).toMatch(/exists\s*\(select\s+1\s+from\s+public\.transactions\s+limit\s+1\)/iu);
    expect(sql).toMatch(/exists\s*\(select\s+1\s+from\s+public\.requests\s+limit\s+1\)/iu);
    expect(sql).not.toMatch(/create\s+index\s+concurrently/iu);
    expect(sql).not.toMatch(/drop\s+(?:table|column|index)|alter\s+table|create\s+policy|row\s+level\s+security/iu);

    const evidencePath = join(process.cwd(), 'docs/performance/perf02-cloud-results.md');
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = readFileSync(evidencePath, 'utf8');
    const indexNames = [...sql.matchAll(/create\s+index\s+if\s+not\s+exists\s+([a-z0-9_]+)/giu)]
      .map(match => match[1]);
    expect(indexNames).toEqual([
      'idx_transactions_source_wh_date_id_perf02',
      'idx_transactions_target_wh_date_id_perf02',
      'idx_requests_origin_created_id_perf02',
    ]);
    expect(sql).toMatch(/idx_transactions_source_wh_date_id_perf02\s+on\s+public\.transactions\s*\(source_warehouse_id,\s*date\s+desc,\s*id\s+desc\)\s+where\s+source_warehouse_id\s+is\s+not\s+null/iu);
    expect(sql).toMatch(/idx_transactions_target_wh_date_id_perf02\s+on\s+public\.transactions\s*\(target_warehouse_id,\s*date\s+desc,\s*id\s+desc\)\s+where\s+target_warehouse_id\s+is\s+not\s+null/iu);
    expect(sql).toMatch(/idx_requests_origin_created_id_perf02\s+on\s+public\.requests\s*\(request_origin,\s*created_date\s+desc,\s*id\s+desc\)\s+where\s+request_origin\s+is\s+not\s+null/iu);
    for (const indexName of indexNames) expect(evidence).toContain(`\`${indexName}\``);
  });
});
