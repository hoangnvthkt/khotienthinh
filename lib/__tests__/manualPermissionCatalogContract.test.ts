import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAllPermissionActions,
  getPermissionApplications,
  getPermissionModules,
} from '../permissions/permissionRegistry';
import {
  canAddDirectGrant,
  resolvePermissionActionReadiness,
} from '../permissions/permissionReadiness';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('manual permission matrix catalog contract', () => {
  it('keeps the matrix all-application and every module anchored by view', () => {
    const applicationCodes = getPermissionApplications().map(application => application.code);

    expect(applicationCodes).toEqual(expect.arrayContaining([
      'system',
      'project',
      'wms',
      'hrm',
      'expense',
      'workflow',
      'request',
      'asset',
      'contract',
    ]));

    for (const module of getPermissionModules()) {
      expect(
        module.actions.some(action => action.action === 'view' && action.permissionCode.endsWith('.view')),
        module.code,
      ).toBe(true);
    }
  });

  it('does not make broad legacy manage actions newly grantable', () => {
    const manageActions = getAllPermissionActions().filter(action => action.action === 'manage');

    expect(manageActions.length).toBeGreaterThan(0);
    for (const action of manageActions) {
      expect(resolvePermissionActionReadiness(action), action.permissionCode).toBe('legacy');
      expect(canAddDirectGrant(action), action.permissionCode).toBe(false);
    }
  });

  it('keeps explicit action permissions separate from broad manage', () => {
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(actionCodes).toEqual(expect.arrayContaining([
      'project.daily_log.create',
      'project.daily_log.verify',
      'project.daily_log.approve',
      'project.payment.verify',
      'project.payment.approve',
      'project.payment.mark_paid',
      'project.documents.upload',
      'project.report.export',
      'system.authorization.manage_grants',
    ]));
  });

  it('records the manual matrix inventory boundary', () => {
    const inventory = read('docs/security/manual-permission-matrix-inventory.md');

    expect(inventory).toContain('Manual Permission Matrix Inventory');
    expect(inventory).toContain('Legacy manage remains compatibility-only');
    expect(inventory).toContain('Direct Grant matrix uses explicit action permissions');
    expect(inventory).toContain('Project is one application group, not the entire matrix');
    expect(inventory).toContain('No quick templates');
  });
});
