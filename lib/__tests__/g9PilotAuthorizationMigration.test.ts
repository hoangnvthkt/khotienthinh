import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260921190000_g9_pilot_permission_command.sql', import.meta.url),
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('G9 pilot permission command migration', () => {
  it('previews the exact grant replacement with a server fingerprint and SoD decision', () => {
    expect(sql).toContain('create or replace function public.preview_direct_permission_grants_v3');
    expect(sql).toContain('app_private.user_permission_state_fingerprint');
    expect(sql).toContain('app_private.evaluate_direct_grant_replacement_impl');
    expect(sql).toContain("'fingerprint'");
    expect(sql).toContain("'decision'");
  });

  it('applies through the audited replacement engine with optimistic concurrency and warning evidence', () => {
    expect(sql).toContain('create or replace function public.apply_direct_permission_grants_v3');
    expect(sql).toContain('p_expected_fingerprint text');
    expect(sql).toContain('p_warning_acceptances jsonb');
    expect(sql).toContain("using errcode = '40001'");
    expect(sql).toContain('app_private.replace_user_permission_grants_v2_impl');
    expect(sql).toContain('p_warning_acceptances');
    expect(sql).not.toContain('insert into public.user_permission_grants');
  });

  it('keeps the public surface authenticated-only and the owner functions private', () => {
    expect(sql).toMatch(/revoke all on function public\.preview_direct_permission_grants_v3[^;]+from public/);
    expect(sql).toMatch(/revoke all on function public\.apply_direct_permission_grants_v3[^;]+from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.preview_direct_permission_grants_v3[^;]+to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.apply_direct_permission_grants_v3[^;]+to authenticated/);
    expect(sql).toMatch(/revoke all on function app_private\.preview_direct_permission_grants_v3_impl[^;]+from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function app_private\.apply_direct_permission_grants_v3_impl[^;]+from public, anon, authenticated/);
  });
});
