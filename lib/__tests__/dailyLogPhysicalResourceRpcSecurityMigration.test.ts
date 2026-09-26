import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSql = () => {
  const filename = readdirSync('supabase/migrations').find(name =>
    name.endsWith('_secure_daily_log_physical_resources.sql'));
  expect(filename).toBeDefined();
  return readFileSync(`supabase/migrations/${filename}`, 'utf8').toLowerCase();
};

describe('Daily Log physical resource RPC security hardening', () => {
  it('moves owner reads to a private definer and exposes an invoker-only wrapper', () => {
    const sql = migrationSql();
    expect(sql).toContain('app_private.get_daily_log_physical_resources_impl_v1');
    expect(sql).toContain('alter function public.get_daily_log_physical_resources_v1(text[]) set schema app_private');
    const source = readFileSync('supabase/migrations/20260925161000_verified_resource_usage_evidence.sql', 'utf8').toLowerCase();
    expect(source).toContain('returns jsonb language plpgsql stable security definer set search_path');
    expect(sql).toContain('create or replace function public.get_daily_log_physical_resources_v1');
    expect(sql).toContain('security invoker set search_path');
    expect(source).toContain('daily_log_resource_access_denied');
  });
});
