import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260808080743_weekly_progress_period_state.sql', import.meta.url),
  'utf8',
).toLowerCase();
const smoke = readFileSync(
  new URL('../../supabase/tests/weekly_progress_period_state_smoke.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('Opening Balance snapshot retry database boundary', () => {
  it('binds prepare/get/sync RPCs to one opening-balance id and canonical row data', () => {
    expect(migration).toContain('prepare_project_opening_balance_snapshot_impl');
    expect(migration).toContain('get_project_opening_balance_snapshot_retry_impl');
    expect(migration).toContain('sync_project_opening_balance_snapshot_impl');
    expect(migration).toContain('public.prepare_project_opening_balance_snapshot');
    expect(migration).toContain('public.get_project_opening_balance_snapshot_retry');
    expect(migration).toContain('public.sync_project_opening_balance_snapshot');

    const syncStart = migration.indexOf('create or replace function app_private.sync_project_opening_balance_snapshot_impl');
    const syncEnd = migration.indexOf('create or replace function public.sync_project_opening_balance_snapshot', syncStart);
    const syncBody = migration.slice(syncStart, syncEnd);
    expect(syncBody).toContain('p_opening_balance_id uuid');
    expect(syncBody).toContain('where balance.id = p_opening_balance_id');
    expect(syncBody).toContain('for update');
    expect(syncBody).toContain("date_trunc('week', v_balance.as_of_date)");
    expect(syncBody).toContain('v_balance.scope_key');
    expect(syncBody).toContain("'progressmode', 'opening_balance'");
    expect(syncBody).toContain('assert_project_progress_snapshot');
    expect(syncBody).toContain('refresh_project_progress_snapshot_impl');
  });

  it('removes direct retry-column writes and the unbound refresh RPC from authenticated clients', () => {
    expect(migration).toContain('revoke all on table public.project_opening_balances from authenticated');
    expect(migration).toContain('grant select (');
    expect(migration).toContain('grant insert (');
    expect(migration).toContain('grant update (');

    const tableGrantStart = migration.lastIndexOf('revoke all on table public.project_opening_balances from authenticated');
    const tableGrantEnd = migration.indexOf('revoke all on function', tableGrantStart);
    const tableGrants = migration.slice(tableGrantStart, tableGrantEnd);
    expect(tableGrants).not.toContain('progress_snapshot_status');
    expect(tableGrants).not.toContain('progress_snapshot_payload');
    expect(tableGrants).not.toContain('progress_snapshot_refreshed_at');
    expect(tableGrants).not.toContain('grant delete');

    expect(migration).toContain('revoke all on function public.refresh_project_progress_snapshot(text, text, date, jsonb)');
    expect(migration).not.toContain(
      'grant execute on function public.refresh_project_progress_snapshot(text, text, date, jsonb)\n  to authenticated',
    );
  });

  it('smoke-tests direct-write denial and canonicalization of legacy mismatched payloads', () => {
    expect(smoke).toContain('direct retry metadata update unexpectedly succeeded');
    expect(smoke).toContain('legacy mismatched retry payload escaped canonical opening balance binding');
    expect(smoke).toContain('sync_project_opening_balance_snapshot');
  });
});
