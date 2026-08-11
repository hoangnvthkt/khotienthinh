import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../supabase/migrations/20260808080743_weekly_progress_period_state.sql', import.meta.url);

describe('weekly progress Opening Balance preflight migration contract', () => {
  it('defines an authenticated non-mutating preflight that validates actor, scope, lock, and payload', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const privateStart = sql.indexOf('create or replace function app_private.preflight_project_progress_snapshot_impl');
    const publicStart = sql.indexOf('create or replace function public.preflight_project_progress_snapshot');
    expect(privateStart).toBeGreaterThan(-1);
    expect(publicStart).toBeGreaterThan(privateStart);
    if (privateStart < 0 || publicStart < 0) return;

    const privateBody = sql.slice(privateStart, publicStart).toLowerCase();
    expect(privateBody).toContain('stable');
    expect(privateBody).toContain('current_user_is_global_wms_keeper');
    expect(privateBody).toContain('assert_project_progress_scope_period');
    expect(privateBody).toContain('assert_project_progress_snapshot');
    expect(privateBody).toContain('is_locked');
    expect(privateBody).not.toMatch(/\binsert\s+into\b/);
    expect(privateBody).not.toMatch(/\bupdate\s+public\./);
    expect(privateBody).not.toMatch(/\bdelete\s+from\b/);
    expect(sql).toContain('grant execute on function public.preflight_project_progress_snapshot(text, text, date, jsonb)');
  });
});
