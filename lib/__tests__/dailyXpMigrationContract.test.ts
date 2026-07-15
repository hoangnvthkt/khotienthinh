import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_repair_and_harden_daily_xp.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('daily XP repair and hardening migration contract', () => {
  it('has exactly one externally rollbackable transaction-safe repair migration', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
    expect(normalized).not.toMatch(/create (?:unique )?index concurrently/i);

    const lockPosition = normalized.indexOf(
      'lock table public.user_xp, public.xp_events in share row exclusive mode',
    );
    const snapshotPosition = normalized.indexOf('do $snapshot_source_rows$');
    expect(lockPosition).toBeGreaterThanOrEqual(0);
    expect(snapshotPosition).toBeGreaterThan(lockPosition);
  });

  it('archives source data, functions, and catalog security facts under one batch', () => {
    expect(normalized).toMatch(/create schema if not exists app_private/i);
    expect(normalized).toMatch(/create table if not exists app_private\.xp_repair_archive/i);
    for (const column of ['repair_batch_id uuid', 'archived_at timestamptz', 'source_table text', 'row_data jsonb']) {
      expect(normalized.toLowerCase()).toContain(column);
    }
    for (const source of [
      'public.user_xp',
      'public.xp_events',
      'catalog.pg_proc',
      'catalog.pg_class',
      'catalog.pg_policy',
      'catalog.pg_attribute',
      'catalog.pg_constraint',
      'catalog.pg_index',
      'catalog.acl',
    ]) {
      expect(migration).toContain(`'${source}'`);
    }
    expect(normalized).toMatch(/revoke all on table app_private\.xp_repair_archive from public, anon, authenticated/i);
    expect(normalized).toMatch(/grant usage on schema app_private to service_role/i);
  });

  it('canonicalizes legacy identities before UUID conversion and resolves profile collisions deterministically', () => {
    expect(normalized).toMatch(/public\.users[\s\S]*public\.employees[\s\S]*employee_user/i);
    expect(normalized).toMatch(/direct_user[\s\S]*employee_legacy/i);
    expect(normalized).toMatch(/row_number\(\) over \( partition by[\s\S]*canonical_user_id[\s\S]*(?:mapped_by = 'direct_user'|original_user_id = canonical_user_id::text)[\s\S]*created_at[\s\S]*id/i);
    expect(normalized).toMatch(/delete from public\.user_xp[\s\S]*profile_rank > 1/i);
    expect(normalized).toMatch(/created_at = coalesce\(created_at, transaction_timestamp\(\)\)/i);
    expect(normalized).not.toMatch(/created_at = coalesce\(created_at, clock_timestamp\(\)\)/i);
    expect(normalized).toMatch(/alter table public\.user_xp alter column user_id type uuid using user_id::uuid/i);
    expect(normalized).toMatch(/alter table public\.xp_events alter column user_id type uuid using user_id::uuid/i);
  });

  it('deduplicates daily awards on the Ho Chi Minh business day and preserves daily award values', () => {
    expect(migration).toContain("at time zone 'Asia/Ho_Chi_Minh'");
    expect(normalized).toMatch(/row_number\(\) over \( partition by[\s\S]*user_id[\s\S]*event_type[\s\S]*business_day[\s\S]*order by[\s\S]*created_at[\s\S]*id/i);
    expect(normalized).toMatch(/delete from public\.xp_events[\s\S]*daily_rank > 1/i);
    expect(normalized).toMatch(/when 'daily_login' then 5[\s\S]*when 'daily_checkin' then 10/i);
    expect(normalized).toMatch(/idempotency_key = format\( '%s:%s',[\s\S]*event_type[\s\S]*Asia\/Ho_Chi_Minh/i);
    expect(normalized).not.toMatch(/idempotency_key = coalesce/i);
  });

  it('recomputes totals, the complete level ladder, login streaks, and first-earned badges', () => {
    for (const threshold of [0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000]) {
      expect(normalized).toMatch(new RegExp(`(?:>=|,) ${threshold}(?:\\D|$)`));
    }
    expect(normalized).toMatch(/sum\(xp_amount\)/i);
    expect(normalized).toMatch(/event_type = 'daily_login'/i);
    for (const badge of ['first_login', 'streak_7', 'streak_30', 'xp_100', 'xp_500', 'xp_1000', 'level_5', 'level_10']) {
      expect(migration).toContain(`'${badge}'`);
    }
    expect(normalized).toMatch(/min\([^)]+\)[\s\S]*earned_at/i);
  });

  it('adds foreign keys, source metadata, and conflict/index support without invalid constraint syntax', () => {
    expect(normalized).toMatch(/foreign key \(user_id\) references public\.users\(id\)/i);
    expect((normalized.match(/foreign key \(user_id\) references public\.users\(id\)/gi) || [])).toHaveLength(2);
    expect(normalized).not.toMatch(/add constraint if not exists/i);
    expect(normalized).toMatch(/from pg_catalog\.pg_constraint[\s\S]*user_xp_user_id_fkey/i);
    expect(normalized).toMatch(/from pg_catalog\.pg_constraint[\s\S]*xp_events_user_id_fkey/i);
    expect(normalized).toMatch(/add column if not exists source_type text/i);
    expect(normalized).toMatch(/add column if not exists source_id uuid/i);
    expect(normalized).toMatch(/add column if not exists idempotency_key text/i);
    expect(normalized).toMatch(/create unique index if not exists[\s\S]*\(user_id, idempotency_key\)[\s\S]*where idempotency_key is not null/i);
    expect(normalized).toMatch(/create index if not exists[\s\S]*\(user_id, created_at desc\)/i);
  });

  it('enforces SELECT-only authenticated access with cached actor RLS', () => {
    expect(normalized).toMatch(/alter table public\.user_xp enable row level security/i);
    expect(normalized).toMatch(/alter table public\.xp_events enable row level security/i);
    expect(normalized).toMatch(/revoke all on table public\.user_xp, public\.xp_events from public, anon, authenticated/i);
    expect(normalized).toMatch(/grant select on table public\.user_xp, public\.xp_events to authenticated/i);
    expect(normalized).not.toMatch(/grant all[\s\S]*(?:anon|authenticated)/i);
    expect(normalized).toMatch(/revoke select \([^)]*\), insert \([^)]*\), update \([^)]*\), references \([^)]*\)[\s\S]*from public, anon, authenticated/i);
    expect(normalized).toMatch(/create policy user_xp_authenticated_leaderboard[\s\S]*for select[\s\S]*to authenticated[\s\S]*\(select public\.current_app_user_id\(\)\) is not null/i);
    expect(normalized).toMatch(/create policy xp_events_authenticated_own[\s\S]*for select[\s\S]*to authenticated[\s\S]*user_id = \(select public\.current_app_user_id\(\)\)/i);
  });

  it('exposes only the actor-bound daily RPC and validates attendance ownership', () => {
    expect(normalized).toMatch(/function app_private\.award_my_daily_xp_impl\(p_event_type text, p_source_id uuid\)[\s\S]*returns jsonb[\s\S]*security definer[\s\S]*set search_path = ''/i);
    expect(normalized).toMatch(/function public\.award_my_daily_xp\(p_event_type text, p_source_id uuid default null\)[\s\S]*returns jsonb[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(normalized).toMatch(/v_actor_user_id uuid := public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/p_event_type not in \('daily_login', 'daily_checkin'\)/i);
    expect(normalized).toMatch(/public\.hrm_attendance[\s\S]*public\.employees[\s\S]*"employeeId"[\s\S]*employee\.user_id = v_actor_user_id[\s\S]*"checkIn"/i);
    expect(normalized).toMatch(/for update/i);
    expect(normalized).toMatch(/on conflict \(user_id, idempotency_key\) where idempotency_key is not null do nothing/i);
    expect(normalized).toMatch(/revoke all on function public\.award_my_daily_xp\(text, uuid\) from public, anon/i);
    expect(normalized).toMatch(/revoke all on function app_private\.award_my_daily_xp_impl\(text, uuid\) from public, anon/i);
    expect(normalized).toMatch(/grant execute on function public\.award_my_daily_xp\(text, uuid\) to authenticated/i);
    expect(normalized).toMatch(/revoke all on routine[\s\S]*from public, anon, authenticated/i);
    expect(normalized).toMatch(/drop routine[\s\S]*award_my_daily_xp/i);
  });

  it('returns the exact camelCase XPAwardResult payload and accepts no client authority fields', () => {
    for (const key of [
      'awarded',
      'xpGained',
      'profile',
      'newBadges',
      'userId',
      'totalXp',
      'streakDays',
      'lastActiveDate',
      'createdAt',
      'updatedAt',
      'earnedAt',
    ]) {
      expect(migration).toContain(`'${key}'`);
    }
    expect(normalized).not.toMatch(/award_my_daily_xp\([^)]*(?:user_id|xp_amount|idempotency_key)/i);
  });
});
