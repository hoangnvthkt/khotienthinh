import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_daily_log_responsibility_assignment_pilot.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('Daily Log responsibility and assignment migration contract', () => {
  it('creates one assignment foundation with deny-by-default exposure', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(normalized).toMatch(/create table if not exists public\.app_responsibility_slots/i);
    expect(normalized).toMatch(/create table if not exists public\.app_assignments/i);
    expect(normalized).toMatch(/create table if not exists public\.app_responsibility_slot_events/i);
    expect(normalized).toMatch(/alter table public\.app_responsibility_slots enable row level security/i);
    expect(normalized).toMatch(/alter table public\.app_assignments enable row level security/i);
    expect(normalized).toMatch(/alter table public\.app_responsibility_slot_events enable row level security/i);
    expect(normalized).toMatch(/revoke all on table public\.app_responsibility_slots, public\.app_assignments from public, anon, authenticated/i);
    expect(normalized).not.toMatch(/grant (?:all|select|insert|update|delete) on table public\.app_(?:responsibility_slots|assignments).*authenticated/i);
  });

  it('resolves a scoped responsibility slot before creating an active assignment', () => {
    expect(normalized).toMatch(/function app_private\.resolve_daily_log_responsibility/i);
    expect(normalized).toMatch(/order by.*scope_rank.*priority.*created_at/i);
    expect(normalized).toMatch(/project\.daily_log\.verify/i);
    expect(normalized).toMatch(/insert into public\.app_assignments/i);
    expect(normalized).toMatch(/responsibility.*current_verifier/i);
    expect(normalized).toMatch(/status.*active/i);
  });

  it('binds view and action decisions to the authenticated actor, scope, assignment, and workflow state', () => {
    expect(normalized).toMatch(/function app_private\.can_view_subject_impl\(\s*p_subject_type text, p_subject_id text\s*\)/i);
    expect(normalized).toMatch(/function app_private\.can_act_on_subject_impl\(\s*p_subject_type text, p_subject_id text, p_action text\s*\)/i);
    expect(normalized).toMatch(/function public\.can_view_subject\( p_subject_type text, p_subject_id text \) returns boolean language sql stable security definer set search_path = ''/i);
    expect(normalized).toMatch(/function public\.can_act_on_subject\( p_subject_type text, p_subject_id text, p_action text \) returns boolean language sql stable security definer set search_path = ''/i);
    expect(normalized).toMatch(/public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/app_private\.daily_log_has_action[\s\S]*project\.daily_log\.view/i);
    expect(normalized).toMatch(/app_private\.daily_log_assignment_is_active/i);
    expect(normalized).toMatch(/revoke all on function public\.can_view_subject\(text, text\) from public, anon/i);
    expect(normalized).toMatch(/revoke all on function public\.can_act_on_subject\(text, text, text\) from public, anon/i);
    expect(normalized).toMatch(/grant execute on function public\.can_view_subject\(text, text\) to authenticated/i);
    expect(normalized).toMatch(/grant execute on function public\.can_act_on_subject\(text, text, text\) to authenticated/i);
  });

  it('makes the transition RPC assignment-first and removes the sender-selected verifier fallback', () => {
    expect(normalized).toMatch(/create or replace function public\.transition_daily_log_status/i);
    expect(normalized).toMatch(/app_private\.create_daily_log_assignment/i);
    expect(normalized).toMatch(/app_private\.daily_log_assignment_is_active/i);
    expect(normalized).toMatch(/update public\.app_assignments[\s\S]*status = 'closed'/i);
    expect(normalized).toMatch(/p_requested_verifier_id is ignored/i);
    expect(normalized).not.toMatch(/p_requested_verifier_id::uuid/i);
  });

  it('records cancellation audit events whenever an active assignment is replaced', () => {
    expect(normalized).toMatch(/with cancelled_assignments as \( update public\.app_assignments[\s\S]*status = 'cancelled'[\s\S]*returning id \) insert into public\.app_assignment_events[\s\S]*select id, 'cancelled'/i);
  });

  it('does not expose private assignment mutation helpers to authenticated callers', () => {
    expect(normalized).toMatch(/revoke all on function app_private\.create_daily_log_assignment\(text, uuid\) from public, anon, authenticated/i);
    expect(normalized).toMatch(/revoke all on function app_private\.create_daily_log_revision_assignment\(text, uuid, uuid\) from public, anon, authenticated/i);
    expect(normalized).toMatch(/revoke all on function app_private\.close_daily_log_assignments\(text, uuid, text\) from public, anon, authenticated/i);
  });

  it('audits responsibility-slot changes and checks authority over the existing scope before an update', () => {
    expect(normalized).toMatch(/insert into public\.app_responsibility_slot_events/i);
    expect(normalized).toMatch(/event_type.*\('created', 'updated'\)/i);
    expect(normalized).toMatch(/from public\.app_responsibility_slots.*for update/i);
    expect(normalized).toMatch(/v_existing_scope_type/i);
  });

  it('allows an authorized administrator to deactivate a stale slot even after its assignee loses a grant', () => {
    expect(normalized).toMatch(/v_effective_status text/i);
    expect(normalized).toMatch(/if v_effective_status = 'active'\s+and not app_private\.daily_log_user_can_receive_assignment/i);
  });

  it('does not cast legacy Daily Log owner fields directly to UUID during authorization', () => {
    expect(normalized).not.toMatch(/coalesce\(v_log\.created_by_id, v_log\.submitted_by_id, v_log\.submitted_by, v_log\.created_by\), ''\)::uuid/i);
    expect(normalized).toMatch(/from public\.users owner_user/i);
    expect(normalized).toMatch(/owner_user\.id::text = coalesce\(/i);
    expect(normalized).toMatch(/nullif\(v_log\.created_by_id, ''\)/i);
  });

  it('backfills active assignments for legacy submitted logs without trusting a text id cast', () => {
    expect(normalized).toMatch(/legacy_submitted_daily_log_backfill/i);
    expect(normalized).toMatch(/from public\.daily_logs daily_log[\s\S]*join public\.users assignee on assignee\.id::text = coalesce\(nullif\(daily_log\.requested_verifier_id, ''\), nullif\(daily_log\.submitted_to_user_id, ''\)\)/i);
    expect(normalized).toMatch(/daily_log\.status = 'submitted'/i);
    expect(normalized).toMatch(/on conflict \(subject_type, subject_id, responsibility\) where status = 'active' do nothing/i);
  });
});
