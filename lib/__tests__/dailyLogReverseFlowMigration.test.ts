import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261008172000_daily_log_reverse_flow.sql'), 'utf8');
const lower = sql.toLowerCase();
const fn = (name: string) => {
  const start = lower.indexOf(`function ${name.toLowerCase()}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const ends = ['$function$;', '$$;'].map(mark => sql.indexOf(mark, start)).filter(index => index > 0);
  return sql.slice(start, Math.min(...ends));
};

describe('Nhật ký — luồng ngược 05/10', () => {
  it('người tổng hợp (verify) gửi được bản tổng hợp, không cần thêm quyền submit', () => {
    for (const name of ['app_private.submit_daily_log_summary_checked_v2', 'app_private.submit_daily_log_summary_legacy_v1']) {
      const body = fn(name);
      expect(body).toContain("'daily_log', 'verify')");
      expect(body).not.toContain("'daily_log', 'submit')");
      expect(body).toContain("'DAILY_LOG_APPROVER_REQUIRED'");
    }
    expect(fn('app_private.submit_daily_log_summary_draft_v2')).toContain("'daily_log','verify')");
    const guard = fn('app_private.enforce_daily_log_room_status');
    expect(guard).toContain("new.summary_source_type = 'member_contributions'");
    expect(guard).toContain('v_target_action');
  });

  it('thông báo phiếu chỉ tới người tổng hợp + CHT gần nhất, rơi về mọi verify khi chưa có bản tổng hợp', () => {
    const helper = fn('app_private.daily_log_source_recipient_ids');
    expect(helper).toContain('d.submitted_to_user_id');
    expect(helper).toContain("'approve'))");
    expect(helper).toContain("else app_private.daily_log_room_recipient_ids(p_project_id, p_construction_site_id, 'verify') end");
    expect(fn('app_private.notify_daily_log_source_change').match(/daily_log_source_recipient_ids/g)).toHaveLength(2);
    expect(sql).toContain('revoke all on function app_private.daily_log_source_recipient_ids(text, text) from public, anon, authenticated;');
  });

  it('báo kỹ sư khi phiếu bị bỏ khỏi bản tổng hợp chưa gửi, không báo khi xóa cả bản', () => {
    const body = fn('app_private.notify_daily_log_source_dropped');
    expect(body).toContain("not in ('draft', 'rejected') then return old");
    expect(body).toContain("v_src.status <> 'submitted' then return old");
    expect(sql).toContain('after delete on public.daily_log_summary_sources');
  });
});
