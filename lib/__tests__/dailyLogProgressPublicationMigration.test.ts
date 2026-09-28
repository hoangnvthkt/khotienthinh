import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../../supabase/migrations/20260923100000_daily_log_summary_progress_publication.sql', import.meta.url);
const smokeUrl = new URL('../../supabase/tests/daily_log_summary_progress_publication_smoke.sql', import.meta.url);

describe('daily log summary progress publication migration', () => {
  it('defines atomic submit and idempotent publication contracts', () => {
    const sql = readFileSync(migrationUrl, 'utf8');
    expect(sql).toContain('create table public.daily_log_publish_commands');
    expect(sql).toContain('submit_daily_log_summary_v1');
    expect(sql).toContain('publish_daily_log_summary_v1');
    expect(sql).toContain("summary_source_type = 'member_contributions'");
    expect(sql).toContain("'publish_progress'");
    expect(sql).toContain('for update');
    expect(sql).toContain('source_daily_log_id');
    expect(sql).toContain('on conflict (command_id)');
  });

  it('revalidates sources, decisions, baselines, periods and physical providers on the server', () => {
    const sql = readFileSync(migrationUrl, 'utf8');
    expect(sql).toContain('STALE_PROGRESS_BASELINE');
    expect(sql).toContain('FORECAST_CHANGE_REASON_REQUIRED');
    expect(sql).toContain('SUMMARY_SOURCE_REVIEW_BLOCKED');
    expect(sql).toContain('CATALOG_PROVIDER_NOT_ACTIVE');
    expect(sql).toContain('MANUAL_PROVIDER_TYPE_REQUIRED');
    expect(sql).toContain('PERIOD_LOCKED');
    expect(sql).toContain('app_private.write_project_progress_period_payload');
  });

  it('keeps publication physical-only and outside project accounting', () => {
    const sql = readFileSync(migrationUrl, 'utf8');
    expect(sql).not.toMatch(/insert\s+into\s+public\.project_transactions/i);
    expect(sql).not.toMatch(/insert\s+into\s+[^;]*accrual/i);
    expect(sql).not.toMatch(/update\s+public\.daily_log_(labor|machines)[\s\S]{0,200}(unit_cost|total_cost)/i);
  });

  it('ships rollback smoke coverage for idempotency and failure atomicity', () => {
    const smoke = readFileSync(smokeUrl, 'utf8');
    expect(smoke).toContain('begin;');
    expect(smoke).toContain('rollback;');
    expect(smoke).toContain('same command id did not return the same receipt');
    expect(smoke).toContain('different command id created duplicate progress');
    expect(smoke).toContain('locked period changed status or progress');
    expect(smoke).toContain('STALE_PROGRESS_BASELINE');
    expect(smoke).toContain('FORECAST_CHANGE_REASON_REQUIRED');
    expect(smoke).toContain('project_transactions count changed');
  });
});
