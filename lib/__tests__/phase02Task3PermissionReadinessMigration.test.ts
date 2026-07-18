import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_phase02_task3_permission_readiness.sql'));

const promotable = [
  'project.material_request.approve',
  'project.material_po.approve',
  'project.custom_material.approve',
] as const;

describe('Phase 02 Task 3 permission readiness migration', () => {
  it('promotes only the exact evidence-backed tranche', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    for (const code of promotable) expect(sql).toContain(`'${code}'`);

    expect(sql).toMatch(/grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'declared'/i);
    expect(sql).toMatch(/get diagnostics\s+v_updated\s*=\s*row_count/i);
    expect(sql).toMatch(/v_updated\s*<>\s*3/i);
    expect(sql).not.toContain("'project.material_request.confirm'");
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
  });
});
