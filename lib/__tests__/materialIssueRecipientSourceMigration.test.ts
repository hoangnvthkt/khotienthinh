import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const migrationName = readdirSync(migrationDir)
  .find(name => name.endsWith('_material_issue_recipient_source_atomic_create.sql'));

const migrationOrFail = () => {
  expect(migrationName).toBeTruthy();
  return readFileSync(`${migrationDir}/${migrationName}`, 'utf8');
};

describe('material issue recipient source migration', () => {
  it('stores recipient source inside the security-definer create RPC', () => {
    const migration = migrationOrFail();
    expect(migration).toContain('p_recipient_source_type text default null');
    expect(migration).toContain('p_recipient_source_id text default null');
    expect(migration).toContain('recipient_source_type, recipient_source_id');
    expect(migration).toContain('p_recipient_source_type, nullif(trim(coalesce(p_recipient_source_id');
    expect(migration).toContain("p_recipient_source_type not in ('supplier_contract', 'business_partner')");
  });

  it('preserves table least privilege and grants only the new RPC signature', () => {
    const migration = migrationOrFail();
    expect(migration).not.toMatch(/grant\s+update\s+on\s+(table\s+)?public\.material_issue_orders/i);
    expect(migration).toContain('grant execute on function public.create_material_issue_order(');
    expect(migration).toContain('to authenticated');
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});
