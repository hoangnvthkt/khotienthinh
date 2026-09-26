import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20260926102824_daily_log_source_selection_v2.sql', import.meta.url), 'utf8');

describe('Daily Log source selection v2 security contract', () => {
  it('keeps privileged code and retry receipts private with RLS and explicit ACLs', () => {
    expect(sql).toContain('create table app_private.daily_log_source_command_receipts');
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/revoke all on table app_private\.daily_log_source_command_receipts from public, anon, authenticated/);
    expect(sql).toMatch(/create function public\.create_daily_log_source_v2[\s\S]*security invoker/);
    expect(sql).toMatch(/create function public\.get_daily_log_document_bundle_v2[\s\S]*security invoker/);
    expect(sql).not.toMatch(/is_admin|user_metadata/);
  });

  it('serializes retry and actor/scope/date/area creation without rewriting historical duplicates', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH');
    expect(sql).toContain('DAILY_LOG_SOURCE_AREA_EXISTS');
    expect(sql).toContain('payload_fingerprint');
    expect(sql).not.toMatch(/update public\.daily_log_contributions|delete from public\.daily_log_contributions/);
    expect(sql).toMatch(/create unique index ux_daily_log_contrib_scope_day_author[\s\S]*where source_document_version = 1/);
    expect(sql).toContain('DAILY_LOG_SOURCE_DOCUMENT_VERSION_IMMUTABLE');
    expect(sql).toContain('DAILY_LOG_SOURCE_V2_CREATION_COMMAND_REQUIRED');
  });

  it('requires explicit owner and scope and distinguishes absent prior rows from null quantities', () => {
    expect(sql).toContain('DAILY_LOG_SOURCE_SELECTION_DENIED');
    expect(sql).toContain('myContributions');
    expect(sql).toContain('baselineQuantityStates');
    expect(sql).toContain("then 'none'");
    expect(sql).toContain("then 'unknown'");
    expect(sql).toContain("else 'known'");
    expect(sql).toContain('current_actor_has_effective_room_action');
    expect(sql).toContain('is not distinct from p_construction_site_id');
    expect(sql).not.toContain('create or replace function public.get_daily_log_wbs_bundle_v1');
  });
});
