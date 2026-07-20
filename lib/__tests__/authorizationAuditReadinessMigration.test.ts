import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_authorization_audit_readiness.sql'));

describe('authorization audit readiness migration', () => {
  it('promotes only the exact authorization View and Audit actions', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');
    expect(sql).toMatch(
      /permission_code\s+in\s*\([^)]*'system\.authorization\.view'[^)]*'system\.authorization\.audit'/is,
    );
    expect(sql).toMatch(/grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'declared'/i);
    expect(sql).not.toMatch(/system\.authorization\.(manage_roles|manage_grants|manage_scopes|override)/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
