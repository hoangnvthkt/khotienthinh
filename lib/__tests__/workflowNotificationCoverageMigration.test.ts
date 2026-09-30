import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../supabase/migrations', file), 'utf8');

describe('Quy trình notification coverage (20260930082919)', () => {
  const sql = read('20260930082919_workflow_notification_coverage.sql');

  it('lets people named on a ticket open it and receive its notifications', () => {
    const canSelect = sql.slice(sql.indexOf('function app_private.workflow_instance_user_can_select'));
    expect(canSelect).toContain('public.workflow_instance_participants participant_row');
    expect(canSelect).toContain('participant_row.ended_at is null');
    expect(sql).toContain("'MENTIONED'");
    expect(sql).toContain("new.instance_id, v_user, 'MENTIONED'");
  });

  it('resyncs participants on stage change and reports completion once', () => {
    expect(sql).toMatch(/after insert or update of created_by, watchers, step_assignees, current_node_id/);
    expect(sql).toContain("when 'APPROVED' then case when i.status = 'COMPLETED' then null else 'workflow.step_approved' end");
  });

  it('tells pending co-approvers about each partial "tất cả phải duyệt" approval', () => {
    expect(sql).toContain("'held', true");
    expect(sql).toContain('v_held\n        or p_event_type not in');
    expect(sql).toContain("'Đã %s %s/%s'");
  });

  it('runs stage SLA reminders from the worker and sends them to current handlers', () => {
    expect(sql).toContain("p_event_type in ('workflow.step_assigned', 'workflow.step_due_soon', 'workflow.step_overdue')");
    expect(sql).toContain("'workflow-reminder:stage:'");
    expect(sql).toContain('perform app_private.enqueue_workflow_notification_reminders(50);');
  });
});

describe('reminder guards', () => {
  it('stops overdue reminders after 7 days and skips project tickets', () => {
    expect(read('20260930083215_workflow_reminder_overdue_window.sql')).toContain(">= now() - interval ''7 days''");
    expect(read('20260930083244_workflow_reminder_skip_project_rows.sql'))
      .toContain('not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id)\\n    order by a.due_at');
  });
});
