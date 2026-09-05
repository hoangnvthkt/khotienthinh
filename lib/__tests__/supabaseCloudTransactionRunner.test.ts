import { describe, expect, it } from 'vitest';

import {
  assertCloudTarget,
  buildRollbackSql,
} from '../../scripts/lib/supabase-cloud-transaction.mjs';

describe('Supabase Cloud transaction runner', () => {
  it('rejects a linked project that is not the approved Cloud target', () => {
    expect(() => assertCloudTarget('preview', 'ftciqmqhmfvjtwoycswe'))
      .toThrow(/Cloud target mismatch/);
  });

  it('wraps migration and smoke SQL in one rollback-only transaction', () => {
    expect(buildRollbackSql('select 1;', ['select 2;']))
      .toMatch(/^begin;[\s\S]*select 1;[\s\S]*select 2;[\s\S]*rollback;$/i);
  });

  it('removes a smoke file transaction boundary before composing the Cloud rollback', () => {
    const sql = buildRollbackSql('select 1;', ['BEGIN; select 2; ROLLBACK;']);

    expect(sql.match(/\bbegin\s*;/gi)).toHaveLength(1);
    expect(sql.match(/\brollback\s*;/gi)).toHaveLength(1);
    expect(sql).toContain('select 2;');
  });
});
