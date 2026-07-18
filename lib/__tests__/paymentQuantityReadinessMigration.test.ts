import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_payment_quantity_readiness.sql'));

const evidenceBackedCodes = [
  'project.payment.verify',
  'project.payment.approve',
  'project.payment.confirm',
  'project.quantity_acceptance.verify',
  'project.quantity_acceptance.approve',
];

describe('Payment and Quantity readiness migration', () => {
  it('promotes only the five Cloud-evidence-backed lifecycle codes', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    for (const permissionCode of evidenceBackedCodes) {
      expect(sql).toContain(`'${permissionCode}'`);
    }
    expect(sql).toMatch(/set\s+grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'declared'/i);
    expect(sql).not.toContain('project.payment.mark_paid');
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
