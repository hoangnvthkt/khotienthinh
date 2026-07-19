import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const smokePath = path.resolve(process.cwd(), 'supabase/tests/material_approval_readiness_promotion_smoke.sql');

describe('Material approval readiness-promotion smoke', () => {
  it('proves exactly three Material approval codes are verified', () => {
    const sql = fs.readFileSync(smokePath, 'utf8');

    expect(sql).toMatch(/begin;/i);
    expect(sql).toMatch(/rollback;/i);
    expect(sql).toMatch(/project\.material_request\.approve/i);
    expect(sql).toMatch(/project\.material_po\.approve/i);
    expect(sql).toMatch(/project\.custom_material\.approve/i);
    expect(sql).toMatch(/project\.material_request\.confirm/i);
    expect(sql).toMatch(/project\.material_request\.verify/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/phase02_task3_material_approval_readiness_promotion_smoke_passed/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
