import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_work_r1a_core_schema.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

const publicTables = [
  'work_task_groups',
  'work_tasks',
  'work_task_recipient_specs',
  'work_task_recipient_members',
  'work_task_recipient_member_sources',
  'work_task_assignments',
  'work_task_participants',
  'work_task_submissions',
  'work_task_checklist_items',
  'work_task_comments',
  'work_task_mentions',
  'work_task_attachments',
  'work_task_versions',
  'work_task_events',
  'work_task_pins',
  'work_task_notification_preferences',
  'work_sla_calendars',
  'work_sla_calendar_exceptions',
  'work_sla_policies',
] as const;

describe('Work R1A core schema migration', () => {
  it('creates the complete task domain with typed scope identifiers', () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of publicTables) {
      expect(normalized).toContain(`create table public.${table}`);
    }
    expect(normalized).toContain('department_id uuid');
    expect(normalized).toContain('project_id text');
    expect(normalized).toContain('work_tasks_scope_shape_check');
    expect(normalized).toContain("scope_type = 'direct'");
    expect(normalized).toContain("scope_type = 'department'");
    expect(normalized).toContain("scope_type = 'project'");
  });

  it('keeps commands and delivery internals private', () => {
    expect(normalized).toContain('create table app_private.work_task_code_counters');
    expect(normalized).toContain('create table app_private.work_command_idempotency');
    expect(normalized).toContain('create table app_private.work_notification_outbox');
    expect(normalized).toContain('create table app_private.work_notification_deliveries');
    expect(normalized).toContain('create or replace function app_private.next_work_task_code');
    expect(normalized).toContain("timezone('asia/ho_chi_minh'");
    expect(normalized).toContain('revoke all on table app_private.work_command_idempotency from public, anon, authenticated');
    expect(normalized).toContain('revoke all on table app_private.work_notification_outbox from public, anon, authenticated');
    expect(normalized).toContain('revoke all on table app_private.work_notification_deliveries from public, anon, authenticated');
  });

  it('enables RLS and exposes read-only task rows through one canonical helper', () => {
    for (const table of publicTables) {
      expect(normalized).toContain(`alter table public.${table} enable row level security`);
    }
    expect(normalized).toContain('create or replace function app_private.work_task_actor_can_view');
    expect(normalized).toContain("app_private.has_permission(v_actor_id, 'work.module.access'");
    expect(normalized).toContain("app_private.has_permission(v_actor_id, 'work.task.view_related'");
    expect(normalized).toMatch(/app_private\.has_permission\(\s*v_actor_id, 'work\.task\.view_restricted'/);
    expect(normalized).toContain('grant select on public.work_tasks to authenticated');
    expect(normalized).not.toContain('grant all on public.work_');
    expect(normalized).not.toContain('grant update on public.work_tasks');
    expect(normalized).not.toContain('to anon using');
  });

  it('adds indexes for relationship access, cursor lists, history, labels, and outbox work', () => {
    for (const indexName of [
      'work_tasks_updated_cursor_idx',
      'work_tasks_open_deadline_idx',
      'work_task_assignments_active_user_idx',
      'work_task_assignments_one_active_user_idx',
      'work_task_participants_active_user_idx',
      'work_task_comments_cursor_idx',
      'work_task_events_cursor_idx',
      'work_tasks_labels_gin_idx',
      'work_notification_outbox_pending_idx',
    ]) {
      expect(normalized).toContain(indexName);
    }
  });
});
