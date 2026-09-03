import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Supabase Cloud baseline V2 migration', () => {
  it('is a complete application baseline that sorts before PERF02', () => {
    const migrationDir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
    const baselineFiles = files.filter(name => name.endsWith('_cloud_schema_baseline_v2.sql'));
    const perfFiles = files.filter(name => name.endsWith('_perf02_query_indexes.sql'));

    expect(baselineFiles).toHaveLength(1);
    expect(perfFiles).toHaveLength(1);
    expect(baselineFiles[0].localeCompare(perfFiles[0])).toBeLessThan(0);

    const sql = readFileSync(join(migrationDir, baselineFiles[0]), 'utf8');
    const normalized = sql.toLowerCase();
    for (const schema of ['public', 'app_private', 'private']) {
      expect(normalized).toMatch(new RegExp(`create schema(?: if not exists)? ["']?${schema}["']?`));
    }
    for (const managedSchema of ['auth', 'storage', 'realtime', 'vault', 'supabase_migrations']) {
      expect(normalized).not.toMatch(new RegExp(`create schema(?: if not exists)? ["']?${managedSchema}["']?`));
    }

    expect(sql).toContain('-- Managed-schema application policies and triggers.');
    expect(sql).toContain('-- Allowlisted non-secret baseline configuration.');
    expect(normalized).toContain('create policy');
    expect(normalized).toContain('enable row level security');
    expect(normalized).toContain('grant ');
    // Top-level inserts would be copied production rows. Indented inserts inside
    // stored procedure bodies are schema definitions and must remain intact.
    expect(normalized).not.toMatch(/^insert\s+into\s+(?:public\.)?(?:transactions|requests|users)\b/mu);
    expect(normalized).not.toMatch(/^insert\s+into\s+(?:auth\.users|storage\.objects)\b/mu);
    expect(sql).not.toMatch(/postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{20,}|password\s*=/u);
  });
});
