import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260930150000_project_work_plans.sql'), 'utf8').toLowerCase();

describe('Kế hoạch tháng/tuần migration', () => {
  it('adds an enforced work_plan Room where week and month approvals are separate actions', () => {
    expect(sql).toContain("('work_plan', 'progress', 'kế hoạch tháng/tuần'");
    expect(sql).toContain("array['view', 'edit', 'delete', 'submit', 'verify', 'approve']::text[]");
    expect(sql).toContain("'enforced', a.description, false");
    expect(sql).toContain("when 'week' then 'verify' else 'approve' end");
  });

  it('keeps one open and one approved plan per calendar month or monday week', () => {
    expect(sql).toContain("where status in ('draft', 'submitted', 'returned')");
    expect(sql).toContain("where status = 'approved'");
    expect(sql).toContain("extract(isodow from period_start) = 1 and period_end = period_start + 6");
    expect(sql).toContain("period_start = date_trunc('month', period_start)::date");
  });

  it('reads actual work from recorded progress instead of storing it', () => {
    expect(sql).toContain('from public.project_daily_task_progress p');
    expect(sql).toContain("'actualqty', case when f.done_end is null then null");
    expect(sql).not.toMatch(/actual_qty\s+numeric/);
  });

  it('never edits an approved plan in place', () => {
    expect(sql).toContain("if v_plan.status not in ('draft', 'returned') then");
    expect(sql).toContain("message = 'work_plan_not_approved'");
    expect(sql).toContain("set status = 'superseded'");
  });

  it('offers overdue unfinished work with its whole remaining quantity', () => {
    expect(sql).toContain('when f.overdue then greatest(f.total_qty - coalesce(f.done_before, 0), 0)');
  });

  it('writes only through RPCs', () => {
    expect(sql).toContain('revoke insert, update, delete on public.project_work_plans, public.project_work_plan_lines, public.project_work_plan_events from authenticated');
    for (const table of ['project_work_plans', 'project_work_plan_lines', 'project_work_plan_events']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });
});
