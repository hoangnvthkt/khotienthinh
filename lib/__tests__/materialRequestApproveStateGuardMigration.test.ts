import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_material_request_approve_state_guard.sql'));

describe('Material Request approve state-guard migration', () => {
  it('permits only PENDING to APPROVED through the project approval action', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    expect(sql).toMatch(/create or replace function public\.transition_project_material_request_status/i);
    expect(sql).toMatch(/v_required_permission\s*=\s*'project\.material_request\.approve'/i);
    expect(sql).toMatch(/v_request\.status\s+is distinct from\s+'PENDING'::public\.request_status/i);
    expect(sql).toMatch(/upper\(coalesce\(p_status,\s*''\)\)\s*<>\s*'APPROVED'/i);
    expect(sql).toMatch(/upper\(coalesce\(p_action,\s*''\)\)\s*<>\s*'APPROVED'/i);
    expect(sql).toMatch(/using errcode = '23514'/i);
    expect(sql).not.toMatch(/grant_readiness/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
