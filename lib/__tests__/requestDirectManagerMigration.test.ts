import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name => name.endsWith('_request_direct_manager_phase1.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

describe('request direct manager migration', () => {
  it('stores and resolves only an active manager', () => {
    expect(sql).toContain('manager_id uuid');
    expect(sql).toContain('resolve_request_direct_manager');
    expect(sql).toContain('account_status');
    expect(sql).toContain("'ACTIVE'");
  });
});
