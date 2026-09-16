import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260916110400_authorization_v2_task12_4_2_wms_operator_hardening.sql', import.meta.url),
  'utf8',
).toLowerCase();
const upsertGuard = readFileSync(
  new URL('../../supabase/migrations/20260916110500_authorization_v2_task12_4_2_wms_operator_upsert_guard.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('E29 WMS operator hardening migration', () => {
  it('guards the WMS request lifecycle with exact actions', () => {
    expect(migration).toContain('trg_requests_wms_lifecycle_action');
    expect(migration).toContain("then 'wms.request.create'");
    expect(migration).toContain("then 'wms.request.approve'");
    expect(migration).toContain("then 'wms.request.export'");
    expect(migration).toContain("then 'wms.request.receive'");
    expect(migration).toContain("using errcode = '42501'");
  });

  it('requires export in addition to transaction creation for linked WMS requests', () => {
    expect(migration).toContain("app_private.wms_has_action(\n        'wms.transaction.create'");
    expect(migration).toContain("app_private.wms_request_has_action(\n            'wms.request.export'");
    expect(migration).toContain("coalesce(r.request_origin, 'wms') = 'wms'");
  });

  it('only exposes private helpers through their table policies and trigger', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('revoke all on function app_private.wms_request_has_action');
    expect(migration).toContain('revoke all on function app_private.assert_wms_request_lifecycle_action');
  });

  it('marks the complete ten-action operator blueprint executable', () => {
    const actions = [
      'wms.inventory.view',
      'wms.request.view',
      'wms.request.create',
      'wms.request.approve',
      'wms.request.export',
      'wms.request.receive',
      'wms.transaction.view',
      'wms.transaction.create',
      'wms.transaction.approve',
      'wms.transaction.complete',
    ];
    actions.forEach(action => expect(migration).toContain(`'${action}'`));
    expect(migration).toContain("set grant_readiness = 'enforced'");
  });

  it('lets existing Supabase upserts reach the authoritative update action guard', () => {
    expect(upsertGuard).toContain("if tg_op = 'insert' and exists (");
    expect(upsertGuard).toContain('where request_row.id = new.id');
    expect(upsertGuard).toContain("elsif v_old_status is distinct from v_new_status");
    expect(upsertGuard).toContain('revoke all on function app_private.assert_wms_request_lifecycle_action() from authenticated');
  });
});
