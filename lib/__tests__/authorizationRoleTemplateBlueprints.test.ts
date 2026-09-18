import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const blueprints = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-role-template-blueprints.json', import.meta.url),
  'utf8',
));
const decisions = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-owner-decisions.json', import.meta.url),
  'utf8',
));

const application = (code: string) => blueprints.applications.find(
  (item: { code: string }) => item.code === code,
);
const template = (applicationCode: string, templateCode: string) => application(applicationCode)
  ?.templates.find((item: { code: string }) => item.code === templateCode);

describe('Task 12.4.2 role-template blueprint', () => {
  it('records the owner-approved template and assignment principles', () => {
    expect(blueprints.principles).toEqual({
      templateContainsActionsOnly: true,
      assignmentCarriesConcreteScope: true,
      ordinarySelectAllFutureActions: 'manual_review',
      superAdminFutureActions: 'auto_include',
      superAdminLocked: true,
      templateInheritance: 'none_explicit_snapshot_only',
    });
    expect(decisions.approvedDesignPrinciples).toMatchObject(blueprints.principles);
  });

  it('keeps protected dynamic Super Admin separate from current System Admin', () => {
    const superAdmin = blueprints.systemTemplates.find(
      (item: { code: string }) => item.code === 'SUPER_ADMIN',
    );
    expect(superAdmin).toMatchObject({
      status: 'implemented_protected_dynamic',
      locked: true,
      dynamic: true,
      futureActionPolicy: 'auto_include',
      assignmentScopeTypes: ['global'],
    });
    expect(blueprints.systemTemplates.some(
      (item: { code: string }) => item.code === 'SYSTEM_ADMIN',
    )).toBe(false);
    expect(blueprints.cloudCatalogBaseline).toMatchObject({
      actions: 384,
      sensitiveActions: 68,
    });
  });

  it('covers every canonical business module from the audited Cloud baseline once', () => {
    const applicationCodes = blueprints.applications.map((item: { code: string }) => item.code);
    const moduleCodes = blueprints.applications.flatMap(
      (item: { moduleCodes: string[] }) => item.moduleCodes,
    );

    expect(new Set(applicationCodes).size).toBe(blueprints.cloudCatalogBaseline.applications);
    expect(moduleCodes).toHaveLength(blueprints.cloudCatalogBaseline.canonicalBusinessModules);
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
    expect(moduleCodes.every((code: string) => !code.startsWith('system.'))).toBe(true);
  });

  it('uses a concrete assignment scope for every application template family', () => {
    for (const item of blueprints.applications) {
      expect(item.assignmentScopeTypes.length).toBeGreaterThan(0);
      expect(item.templates.length).toBeGreaterThan(0);
      expect(item.templates.every((entry: { code: string; name: string }) => entry.code && entry.name))
        .toBe(true);
    }
  });

  it('makes Warehouse Manager an explicit snapshot superset of Warehouse Operator', () => {
    const operator = template('wms', 'WAREHOUSE_OPERATOR');
    const manager = template('wms', 'WAREHOUSE_MANAGER');
    expect(operator.permissionCodes).toHaveLength(10);
    expect(manager.permissionCodes).toHaveLength(17);
    expect(operator.permissionCodes.every((code: string) => manager.permissionCodes.includes(code)))
      .toBe(true);
    expect(manager.permissionCodes).toEqual(expect.arrayContaining([
      'wms.request.delete',
      'wms.transaction.reverse',
      'wms.material_issue.settle',
      'wms.material_issue.reverse_settlement',
      'wms.purchase_order.return_supplier',
    ]));
    expect(operator.permissionScopeType).toBe('warehouse');
    expect(manager.permissionScopeType).toBe('warehouse');
  });

  it('keeps regular workflow users away from template administration', () => {
    const user = template('workflow', 'WORKFLOW_USER');
    const admin = template('workflow', 'WORKFLOW_ADMIN');
    expect(user.permissionCodes).toEqual([
      'workflow.instance.view',
      'workflow.instance.create',
      'workflow.instance.act_assigned',
      'workflow.instance.edit_own_draft',
      'workflow.instance.delete_own_draft',
      'workflow.template.view',
    ]);
    expect(user.permissionCodes.some((code: string) => code.startsWith('workflow.template.')
      && /create|edit|publish/.test(code))).toBe(false);
    expect(admin.permissionCodes).toEqual(expect.arrayContaining([
      'workflow.instance.cancel',
      'workflow.instance.reopen',
      'workflow.instance.administer',
      'workflow.template.create',
      'workflow.template.edit',
      'workflow.template.publish',
    ]));
    expect(user.permissionScopes).toMatchObject({
      'workflow.instance.create': 'own',
      'workflow.instance.act_assigned': 'assigned',
      'workflow.template.view': 'global',
    });
    expect(admin.permissionScopes).toMatchObject({
      'workflow.instance.edit_own_draft': 'own',
      'workflow.instance.administer': 'global',
      'workflow.template.publish': 'global',
    });
  });

  it('closes the owner-approved workflow catalog gap', () => {
    expect(application('workflow')).toMatchObject({
      status: 'owner_approved_catalog_complete',
      catalogGaps: [],
    });
  });

  it('maps the implemented Request runtime lifecycle without claiming draft commands', () => {
    const requestUser = template('request', 'REQUEST_USER');
    const requestProcessor = template('request', 'REQUEST_PROCESSOR');
    const requestAdmin = template('request', 'REQUEST_TEMPLATE_ADMIN');

    expect(application('request')).toMatchObject({
      status: 'implemented_runtime_actions_pending_owner_template',
      catalogGaps: [
        'Request has no create/save/delete DRAFT command yet; do not represent those operations as completed capabilities.',
      ],
    });
    expect(requestUser.permissionCodes).toEqual(expect.arrayContaining([
      'request.instance.edit_own_content',
      'request.instance.resubmit_own',
      'request.instance.cancel',
    ]));
    expect(requestProcessor.permissionCodes).toEqual(expect.arrayContaining([
      'request.instance.approve_assigned',
      'request.instance.reject_assigned',
      'request.instance.return_assigned',
    ]));
    expect(requestAdmin.permissionCodes).toEqual(expect.arrayContaining([
      'request.instance.cancel',
      'request.instance.reassign',
    ]));
    expect([
      ...requestUser.permissionCodes,
      ...requestProcessor.permissionCodes,
      ...requestAdmin.permissionCodes,
    ]).not.toEqual(expect.arrayContaining([
      'request.instance.create_draft',
      'request.instance.save_draft',
      'request.instance.delete_own_draft',
    ]));
  });

  it('marks applications with only legacy shells as catalog blocked', () => {
    expect(application('chat')).toMatchObject({ status: 'catalog_blocked', moduleCodes: [] });
    expect(application('procurement')).toMatchObject({ status: 'catalog_blocked', moduleCodes: [] });
  });
});
