import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260813031106_allow_summary_submit_by_daily_log_summarizer.sql'),
  'utf8',
);
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('Daily Log summary submit authorization', () => {
  it('allows member contribution summaries to be submitted by scoped summarizers', () => {
    expect(normalized).toContain("v_log.summary_source_type = 'member_contributions'");
    expect(normalized).toContain("'project.daily_log.summarize'");
    expect(normalized).toMatch(/coalesce\(v_log\.status, 'draft'\) in \('draft', 'rejected'\)/);
  });

  it('keeps regular daily log submission owner-bound', () => {
    expect(normalized).toMatch(/v_owner_id = v_actor_user_id\s+and app_private\.daily_log_has_action\(/);
    expect(normalized).toContain("'project.daily_log.submit'");
  });
});
