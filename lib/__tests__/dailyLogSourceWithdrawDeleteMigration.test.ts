import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sql = read('supabase/migrations/20260930100000_daily_log_source_withdraw_delete_v2.sql').toLowerCase();

describe('Daily Log slip withdraw / delete migration', () => {
  it('records both commands as idempotent receipts', () => {
    expect(sql).toContain("check (operation = any (array['create','return','submit','withdraw','delete']))");
    expect(sql).toContain("operation in ('return','submit','withdraw')");
    // A retried delete must be answered from the receipt after the slip is gone.
    expect(sql.indexOf('from app_private.daily_log_source_command_receipts r where r.command_id=v_command_id'))
      .toBeLessThan(sql.indexOf('select * into source from public.daily_log_contributions where id=(p_input->>'));
  });

  it('lets only the author withdraw a sent slip that no summary holds yet', () => {
    expect(sql).toContain("case p_operation when 'withdraw' then 'submit' else 'edit' end");
    expect(sql).toContain('source.author_user_id is distinct from actor::text');
    expect(sql).toContain("if p_old.status<>'submitted' or p_new.status<>'draft'");
    expect(sql).toContain("message='daily_log_source_in_summary'");
    expect(sql).toContain('s.source_version=p_source.row_version');
  });

  it('deletes only never-sent drafts outside any summary, inside the open rollout period', () => {
    expect(sql).toContain("source.status<>'draft' or source.submitted_at is not null");
    expect(sql).toContain("message='daily_log_source_delete_not_draft'");
    expect(sql).toContain("message='period_locked'");
    expect(sql).toContain("message='daily_log_source_rollout_disabled'");
    expect(sql).toContain('delete from public.daily_log_contributions where id=source.id');
  });

  it('tells the screen what the author may do, and tells the summarizer about a withdrawal', () => {
    expect(sql).toContain("app_private.daily_log_source_author_actions_v2(v_source)");
    for (const key of ['candeletesource', 'canwithdrawsource', 'sourceinsummary']) expect(sql).toContain(`'${key}'`);
    expect(sql).toContain("'dailylog_source_withdrawn'");
    expect(sql).toContain("elsif new.status = 'draft' and v_old_status = 'submitted' then");
  });

  it('keeps helpers private and exposes only the two commands', () => {
    for (const fn of ['daily_log_source_in_summary_v2', 'daily_log_source_author_actions_v2']) {
      expect(sql).toMatch(new RegExp(`revoke all on function app_private\\.${fn}\\([^)]*\\) from public,anon,authenticated`));
    }
    expect(sql).toContain('grant execute on function public.withdraw_daily_log_source_v2(jsonb),public.delete_daily_log_source_v2(jsonb) to authenticated');
  });
});
