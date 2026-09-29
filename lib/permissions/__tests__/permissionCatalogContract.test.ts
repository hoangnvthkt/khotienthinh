import { describe, expect, it } from 'vitest';
import { getAllPermissionActions } from '../permissionRegistry';
import dbCatalog from './fixtures/dbPermissionCatalog.json';

// Codes the frontend ships before their Cloud migration lands (other tracks).
// Remove an entry once the migration is applied and the fixture refreshed.
const FRONTEND_AHEAD_OF_DB = new Set([
  'system.vehicle_booking.view',
  'system.vehicle_booking.manage',
  // Daily Log migrations in this candidate have not reached the production catalog.
  'project.daily_log.publish_progress',
  'project.payment.view_resource_evidence',
]);

const dbCodes = new Map(dbCatalog.actions.map(action => [action.permissionCode, action.scopeTypes]));
const frontendActions = getAllPermissionActions();

describe('permission catalog contract (refresh: scripts/authorization-v2/export-permission-catalog.mjs)', () => {
  it('knows every capability the database enforces', () => {
    const frontendCodes = new Set(frontendActions.map(action => action.permissionCode));
    expect([...dbCodes.keys()].filter(code => !frontendCodes.has(code))).toEqual([]);
  });

  it('declares no capability missing from the database', () => {
    expect(frontendActions
      .map(action => action.permissionCode)
      .filter(code => !dbCodes.has(code) && !FRONTEND_AHEAD_OF_DB.has(code))).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    expect([...FRONTEND_AHEAD_OF_DB].filter(code => dbCodes.has(code))).toEqual([]);
  });

  it('uses the scopes the database accepts', () => {
    const mismatches = frontendActions
      .filter(action => dbCodes.has(action.permissionCode) && action.scopeTypes)
      .filter(action => [...action.scopeTypes!].sort().join(',') !== dbCodes.get(action.permissionCode)!.join(','))
      .map(action => `${action.permissionCode}: frontend ${[...action.scopeTypes!].sort().join('|')} / db ${dbCodes.get(action.permissionCode)!.join('|')}`);
    expect(mismatches).toEqual([]);
  });
});
