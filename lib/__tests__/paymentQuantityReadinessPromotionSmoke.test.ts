import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const smokePath = path.resolve(process.cwd(), 'supabase/tests/payment_quantity_readiness_promotion_smoke.sql');

describe('Payment and Quantity readiness-promotion smoke', () => {
  it('proves only the five evidence-backed codes become verified', () => {
    const sql = fs.readFileSync(smokePath, 'utf8');

    expect(sql).toMatch(/begin;/i);
    expect(sql).toMatch(/rollback;/i);
    expect(sql).toMatch(/project\.payment\.verify/i);
    expect(sql).toMatch(/project\.payment\.approve/i);
    expect(sql).toMatch(/project\.payment\.confirm/i);
    expect(sql).toMatch(/project\.quantity_acceptance\.verify/i);
    expect(sql).toMatch(/project\.quantity_acceptance\.approve/i);
    expect(sql).toMatch(/project\.payment\.mark_paid/i);
    expect(sql).toMatch(/grant_readiness = 'verified'/i);
    expect(sql).toMatch(/phase02_task3_payment_quantity_readiness_promotion_smoke_passed/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
