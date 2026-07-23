import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260723100000_direct_purchase_lifecycle_v1.sql',
);

describe('direct-purchase lifecycle migration', () => {
  it('defines guarded payable confirmation, unrecording and full-document rejection', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('record_site_direct_purchase_payable_v1');
    expect(migration).toContain('unrecord_site_direct_purchase_payable_v1');
    expect(migration).toContain('reject_site_direct_purchase_v1');
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("status = 'rejected'");
    expect(migration).toContain('Đảo thanh toán');
  });

  it('moves direct-purchase status through a guarded lifecycle RPC', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('transition_site_direct_purchase_v1');
    expect(migration).toContain("'return_to_draft'");
    expect(migration).toContain("'approve_to_buy'");
    expect(migration).toContain("'cancel_approval'");
    expect(migration).toContain("'mark_purchased'");
    expect(migration).toContain("'close_after_payment'");
  });
});
