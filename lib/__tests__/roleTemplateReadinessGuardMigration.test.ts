import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260916110600_authorization_v2_task12_4_2_role_template_readiness_guard.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('E30 role template technical-readiness guard', () => {
  it('rejects non-ready actions at save, preview and assignment boundaries', () => {
    expect(sql).toContain('assert_business_role_payload_grantable');
    expect(sql).toContain('assert_business_role_template_grantable');
    expect(sql).toContain("grant_readiness not in ('enforced', 'verified')");
    expect(sql).toContain('create or replace function public.preview_business_role_assignment_v2');
    expect(sql).toContain('create or replace function app_private.save_business_role_v2_impl');
    expect(sql).toContain('create or replace function app_private.assign_business_role_v2_impl');
  });

  it('keeps the protected dynamic SUPER_ADMIN exception explicit', () => {
    expect(sql).toContain("if v_code <> 'super_admin'");
    expect(sql).toContain("using errcode = '23514'");
  });

  it('keeps helper ACLs private from public and anon', () => {
    expect(sql).toContain('revoke all on function app_private.assert_business_role_payload_grantable(jsonb) from public, anon');
    expect(sql).toContain('revoke all on function app_private.assert_business_role_template_grantable(uuid) from public, anon');
  });
});
