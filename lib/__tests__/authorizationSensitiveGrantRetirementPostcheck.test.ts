import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('sensitive grant retirement postcheck', () => {
  it('is rollback-only and checks only aggregate retirement controls', () => {
    const sql = fs.readFileSync(path.resolve(
      process.cwd(),
      'supabase/tests/authorization_sensitive_grant_retirement_postcheck.sql',
    ), 'utf8');

    expect(sql).toMatch(/^begin;[\s\S]*rollback;\s*$/i);
    expect(sql).toMatch(/expected_active_retired_count/i);
    expect(sql).toMatch(/expected_retirement_audit_count/i);
    expect(sql).toContain("'project.material_request.confirm'");
    expect(sql).toContain("'project.material_request.verify'");
    expect(sql).toMatch(/authorization_sensitive_grant_retirement_postcheck_passed/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });
});
