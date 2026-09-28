import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sql = read('supabase/migrations/20260928170000_daily_log_pilot_readiness.sql').toLowerCase();

describe('Daily Log pilot readiness migration', () => {
  it('lets the Room screen grant publication and evidence reads, only where still audit-only', () => {
    expect(sql).toMatch(/set enforcement_status = 'enforced',\s+pbac_fallback_enabled = false/);
    expect(sql).toContain("(room_code = 'daily_log' and action_code = 'publish_progress')");
    expect(sql).toContain("(room_code = 'payment' and action_code = 'view_resource_evidence')");
    expect(sql).toContain("and enforcement_status = 'audit_only'");
  });

  it('notifies every workflow step from the database, never the person acting', () => {
    expect(sql).toContain('after insert or update of status on public.daily_log_contributions');
    expect(sql).toContain('after insert or update of status on public.daily_logs');
    for (const source of ['dailylog_source_submitted', 'dailylog_source_returned', 'dailylog_summary_submitted',
      'dailylog_rejected', 'dailylog_verified']) expect(sql).toContain(`'${source}'`);
    expect(sql).toContain('where recipient.id is distinct from p_actor');
    expect(sql).toContain("app_private.daily_log_room_recipient_ids(new.project_id, new.construction_site_id, 'verify')");
    expect(sql).toContain("new.summary_source_type is distinct from 'member_contributions'");
  });

  it('keeps helpers private', () => {
    for (const fn of ['daily_log_uuid', 'daily_log_room_recipient_ids', 'daily_log_link', 'daily_log_notify',
      'notify_daily_log_source_change', 'notify_daily_log_summary_change']) {
      expect(sql).toMatch(new RegExp(`revoke all on function app_private\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
    }
  });

  it('stops the browser from sending summary notices the database now sends', () => {
    const tab = read('pages/project/DailyLogTab.tsx');
    expect(tab).not.toContain('Nhật ký ngày chờ CHT duyệt');
    expect(tab).toContain('const notifyFromBrowser = !isSummaryDailyLog(log);');
  });
});
