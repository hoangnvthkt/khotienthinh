import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_material_approval_readiness.sql'));

const promotedCodes = [
  'project.material_request.approve',
  'project.material_po.approve',
  'project.custom_material.approve',
];

describe('Material approval readiness migration', () => {
  it('promotes only the three active declared approval actions', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    for (const permissionCode of promotedCodes) {
      expect(sql).toContain(`'${permissionCode}'`);
    }
    expect(sql).toMatch(/is_active\s+and\s+grant_readiness\s*=\s*'declared'/i);
    expect(sql).toMatch(/set\s+grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/cardinality\(v_codes\)/i);
    expect(sql).not.toContain('project.material_request.confirm');
    expect(sql).not.toContain('project.material_request.verify');
    expect(sql).not.toContain('project.payment.mark_paid');
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
