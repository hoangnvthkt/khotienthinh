import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDir)
  .find(name => name.endsWith('_vehicle_booking_phase3_hardening.sql'));
const sql = migrationName
  ? readFileSync(join(migrationsDir, migrationName), 'utf8').toLowerCase().replace(/\s+/g, ' ')
  : '';

describe('vehicle booking phase 3 hardening migration', () => {
  it('binds both private commands to the authenticated app actor', () => {
    expect(sql).toContain('create or replace function app_private.vehicle_require_current_actor');
    expect(sql).toContain('p_actor_user_id is distinct from public.current_app_user_id()');
    expect(sql.match(/perform app_private\.vehicle_require_current_actor\(p_actor_user_id\)/g))
      .toHaveLength(2);
  });

  it('keeps public command wrappers as security invokers', () => {
    const feedbackWrapper = sql.match(/create or replace function public\.submit_vehicle_feedback[\s\S]+?\$\$;/)?.[0] || '';
    const issueWrapper = sql.match(/create or replace function public\.transition_vehicle_booking_issue[\s\S]+?\$\$;/)?.[0] || '';

    expect(feedbackWrapper).toContain('security invoker');
    expect(issueWrapper).toContain('security invoker');
    expect(feedbackWrapper).not.toContain('security definer');
    expect(issueWrapper).not.toContain('security definer');
  });

  it('emits distinct assignment-created and assignment-superseded audit events', () => {
    const timeline = sql.match(/create or replace function public\.get_vehicle_booking_audit_timeline[\s\S]+?\$\$;/)?.[0] || '';

    expect(timeline).toContain("'assignment_created:' || assignment.id::text");
    expect(timeline).toContain("'assignment_superseded:' || assignment.id::text");
    expect(timeline).toContain('assignment.assigned_at');
    expect(timeline).toContain('assignment.superseded_at');
    expect(timeline).toContain('actor.id = assignment.assigned_by_user_id');
    expect(timeline).toContain('actor.id = assignment.superseded_by_user_id');
    expect(timeline).toContain('where assignment.superseded_at is not null');
  });

  it('persists the notification event type instead of using the generic default', () => {
    const enqueue = sql.match(/create or replace function app_private\.vehicle_enqueue_notification[\s\S]+?\$\$;/)?.[0] || '';

    expect(enqueue).toContain('event_key, event_type, recipient_user_id, payload');
    expect(enqueue).toContain('p_event_type');
  });
});
