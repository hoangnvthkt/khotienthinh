import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const smokePath = path.resolve(process.cwd(), 'supabase/tests/phase3_payment_contract_permissions_smoke.sql');

describe('Payment and Quantity readiness smoke', () => {
  it('proves only the runtime-backed lifecycle codes', () => {
    const sql = fs.readFileSync(smokePath, 'utf8');

    expect(sql).toMatch(/begin;/i);
    expect(sql).toMatch(/rollback;/i);
    expect(sql).toMatch(/transition_project_payment_certificate_status/i);
    expect(sql).toMatch(/transition_project_quantity_acceptance_status/i);
    expect(sql).toMatch(/project\.payment\.verify/i);
    expect(sql).toMatch(/project\.payment\.approve/i);
    expect(sql).toMatch(/project\.payment\.confirm/i);
    expect(sql).toMatch(/project\.quantity_acceptance\.verify/i);
    expect(sql).toMatch(/project\.quantity_acceptance\.approve/i);
    expect(sql).toMatch(/phase02_task3_payment_quantity_readiness_smoke_passed/i);
    expect(sql).not.toMatch(/grant_readiness/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
