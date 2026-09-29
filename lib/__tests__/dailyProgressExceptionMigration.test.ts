import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20260923101500_daily_progress_exception_command.sql', import.meta.url), 'utf8');

describe('daily progress exception migration', () => {
  it('defines the audited, dual-capability exception command', () => {
    expect(migration).toContain('create table public.daily_progress_exception_audit');
    expect(migration).toContain('save_daily_progress_exception_v1');
    expect(migration).toContain("'weekly_progress', 'edit'");
    expect(migration).toContain("'daily_log', 'publish_progress'");
    expect(migration).toContain('for update');
    expect(migration).toContain('DAILY_PROGRESS_EXCEPTION_REASON_REQUIRED');
    expect(migration).toContain('before_data');
    expect(migration).toContain('after_data');
  });

  it('guards rollout, period locks and adjacent baselines', () => {
    expect(migration).toContain('DAILY_LOG_PROGRESS_NOT_AUTHORITATIVE');
    expect(migration).toContain('PERIOD_LOCKED');
    expect(migration).toContain('PREVIOUS_PROGRESS_CONFLICT');
    expect(migration).toContain('NEXT_PROGRESS_CONFLICT');
    expect(migration).toContain('get_daily_progress_authority_v1');
  });
});
