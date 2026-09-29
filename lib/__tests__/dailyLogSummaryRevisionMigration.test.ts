import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL(
  '../../supabase/migrations/20260923103000_daily_log_summary_revisions.sql',
  import.meta.url,
);

describe('daily log summary revision migration', () => {
  it('returns a verified retry before changing downstream progress and rejects locked affected periods', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('REVISION_AFFECTED_PERIOD_LOCKED');
    expect(sql).toContain('COMMAND_ID_LOG_MISMATCH');
    expect(sql.indexOf('if v_existing_result is not null then return v_existing_result; end if;'))
      .toBeLessThan(sql.indexOf('with future_progress as'));
    expect(sql).toContain('REVISION_LINEAGE_WRITE_REQUIRED');
  });
  it('adds immutable revision lineage and a protected clone command', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('supersedes_daily_log_id');
    expect(sql).toContain('superseded_by_daily_log_id');
    expect(sql).toContain('revision_reason');
    expect(sql).toContain('create_daily_log_summary_revision_v1');
    expect(sql).not.toContain('delete from public.project_daily_task_progress');
  });

  it('requires dual capability, an open period and locked revision publication lineage', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("'daily_log', 'approve'");
    expect(sql).toContain("'daily_log', 'publish_progress'");
    expect(sql).toContain('PERIOD_LOCKED_WITH_REOPEN_REQUIRED');
    expect(sql).toContain('REVISION_REASON_REQUIRED');
    expect(sql).toContain('for update');
    expect(sql).toContain('source_daily_log_id = p_daily_log_id');
    expect(sql).toContain('review_status = \'superseded\'');
  });
});
