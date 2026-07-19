import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gatePath = path.resolve(
  process.cwd(),
  'supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql',
);

describe('sensitive grant manifest revision gate', () => {
  it('is rollback-only and retires only the two obsolete codes', () => {
    const sql = fs.readFileSync(gatePath, 'utf8');

    expect(sql).toMatch(/^begin;[\s\S]*rollback;\s*$/i);
    expect(sql).toContain("'project.material_request.confirm'");
    expect(sql).toContain("'project.material_request.verify'");
    expect(sql).toMatch(/active_retired_count/i);
    expect(sql).toMatch(/expected_original_source_fingerprint/i);
    expect(sql).toMatch(/expected_original_regrant_fingerprint/i);
    expect(sql).toMatch(/expected_revised_regrant_fingerprint/i);
    expect(sql).toMatch(/expected_active_direct_grant_count/i);
    expect(sql).toMatch(/expected_durable_operator_count/i);
    expect(sql).toMatch(/authorization_sensitive_grant_manifest_revision_gate_passed/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });
});
