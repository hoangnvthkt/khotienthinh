import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase', 'migrations');
const sodFiles = readdirSync(dir)
  .filter(file => file.endsWith('_authorization_minimal_sod_registry.sql'))
  .sort();
const sodSql = sodFiles.length === 1 ? readFileSync(join(dir, sodFiles[0]), 'utf8') : '';
const normalized = sodSql.replace(/\s+/g, ' ').trim();

describe('minimal SoD registry migration', () => {
  it('creates one typed, seed-controlled registry without a policy DSL', () => {
    expect(sodFiles).toHaveLength(1);
    expect(normalized).toMatch(/create table public\.authorization_sod_rules/i);
    expect(normalized).toMatch(/rule_type in \('SELF_GRANT','PERMISSION_PAIR','SUBJECT_RELATION'\)/i);
    expect(normalized).toMatch(/effect in \('DENY','WARN','REQUIRE_OVERRIDE'\)/i);
    expect(normalized).not.toMatch(/policy_expression|sql_expression|condition_expression/i);
  });

  it('keeps warning acceptance append-only and owner-controlled', () => {
    expect(normalized).toMatch(/create table public\.authorization_sod_warning_acceptances/i);
    expect(normalized).toMatch(/control_owner_user_id uuid not null references public\.users/i);
    expect(normalized).toMatch(/compensating_controls text not null/i);
    expect(normalized).toMatch(/expires_at timestamptz not null/i);
    expect(normalized).not.toMatch(/grant (insert|update|delete).*authorization_sod_warning_acceptances.*authenticated/i);
  });

  it('derives preview actor and exposes hard-deny subject guards', () => {
    expect(normalized).toMatch(/create or replace function app_private\.evaluate_authorization_change/i);
    expect(normalized).toMatch(/create or replace function app_private\.evaluate_authorization_change_set/i);
    expect(normalized).toMatch(/create or replace function public\.preview_authorization_change/i);
    expect(normalized).toMatch(/v_actor_user_id uuid := public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/p_actor_user_id is distinct from public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/create or replace function app_private\.assert_subject_sod/i);
  });
});
