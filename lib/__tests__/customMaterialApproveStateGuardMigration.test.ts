import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_custom_material_approve_state_guard.sql'));

describe('Custom Material approve state-guard migration', () => {
  it('limits approval to submitted requests and rejects cancellation through this handler', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    expect(sql).toMatch(/create or replace function public\.transition_custom_material_request_status/i);
    expect(sql).toMatch(/v_required_permission\s*=\s*'project\.custom_material\.approve'/i);
    expect(sql).toMatch(/v_request\.status\s+is distinct from\s+'submitted'/i);
    expect(sql).toMatch(/coalesce\(p_status,\s*''\)\s+not in\s*\('approved',\s*'returned',\s*'rejected'\)/i);
    expect(sql).toMatch(/coalesce\(p_status,\s*''\)\s*=\s*'cancelled'/i);
    expect(sql).toMatch(/using errcode = '23514'/i);
    expect(sql).not.toMatch(/grant_readiness/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
