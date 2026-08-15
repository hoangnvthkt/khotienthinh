import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = join(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationDir)
  .find(name => name.endsWith('_request_vehicle_direct_manager_routing.sql'));
const sql = migrationName ? readFileSync(join(migrationDir, migrationName), 'utf8') : '';

describe('request direct-manager routing migration', () => {
  it('resolves only an active manager who differs from the requester', () => {
    expect(sql).toContain('resolve_active_direct_manager');
    expect(sql).toContain('manager.id <> p_user_id');
    expect(sql).toContain('resolve_request_direct_manager');
  });

  it('rejects self approval for every approver source', () => {
    expect(sql).toContain('REQUEST_APPROVER_SELF_NOT_ALLOWED');
    expect(sql).toContain('v_id = p_creator_id');
  });

  it('rejects reassignment back to the request creator', () => {
    expect(sql).toContain('enforce_request_approver_not_creator');
    expect(sql).toContain('new.assignee_user_id = v_creator_id');
    expect(sql).toContain('REQUEST_APPROVER_SELF_NOT_ALLOWED');
  });
});
