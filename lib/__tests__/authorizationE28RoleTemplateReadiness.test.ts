import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateRoleTemplateReadiness } from '../../scripts/authorization-v2/check-task12-4-2-role-template-readiness.mjs';

const blueprints = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-role-template-blueprints.json', import.meta.url),
  'utf8',
));
const decisions = JSON.parse(readFileSync(
  new URL('../../scripts/authorization-v2/task12-4-2-owner-decisions.json', import.meta.url),
  'utf8',
));
const approvedCodes: string[] = blueprints.applications
  .filter((application: { code: string }) => ['wms', 'workflow'].includes(application.code))
  .flatMap((application: { templates: Array<{ permissionCodes: string[] }> }) =>
    application.templates.flatMap(template => template.permissionCodes));

const catalog = (grantReadiness = 'verified') => [...new Set<string>(approvedCodes)].map(permissionCode => ({
  permissionCode,
  grantReadiness,
  scopeTypes: permissionCode.startsWith('wms.')
    ? ['global', 'warehouse', 'own', 'assigned']
    : permissionCode.includes('edit_own_draft') || permissionCode.includes('delete_own_draft')
      ? ['own']
      : permissionCode.includes('cancel') || permissionCode.includes('reopen') || permissionCode.includes('administer')
        ? ['global']
        : ['global', 'own', 'assigned'],
}));

describe('Task 12.4.2 E28 role-template pilot readiness', () => {
  it('captures exactly the two cohorts explicitly approved by the business owner', () => {
    const approved = decisions.decisions.filter(
      (decision: { status: string }) => decision.status === 'owner_approved',
    );
    expect(approved.map((decision: { cohort: string }) => decision.cohort).sort())
      .toEqual(['wms_manage', 'workflow']);
    expect(approved.every((decision: { approvedAt?: string; approvalEvidence?: string }) =>
      decision.approvedAt === '2026-09-16' && Boolean(decision.approvalEvidence))).toBe(true);
    expect(decisions.decisions.filter((decision: { status: string }) =>
      decision.status === 'owner_pending')).toHaveLength(13);
  });

  it('accepts the approved templates only when every action and item scope is verified', () => {
    const report = evaluateRoleTemplateReadiness({ blueprints, decisions, catalogActions: catalog() });
    expect(report.approvedCohorts).toEqual(['wms_manage', 'workflow']);
    expect(report.templates.map((template: { templateCode: string }) => template.templateCode).sort())
      .toEqual(['WAREHOUSE_MANAGER', 'WAREHOUSE_OPERATOR', 'WORKFLOW_ADMIN', 'WORKFLOW_USER']);
    expect(report).toMatchObject({
      pilotReadyTemplates: 4, blockedTemplates: 0, blockerCount: 0, uniqueBlockedActions: 0,
    });
  });

  it('fails closed for declared/legacy actions instead of materializing an incomplete role', () => {
    const catalogActions = catalog();
    catalogActions.find(action => action.permissionCode === 'wms.inventory.view')!.grantReadiness = 'declared';
    catalogActions.find(action => action.permissionCode === 'workflow.template.view')!.grantReadiness = 'legacy';
    const report = evaluateRoleTemplateReadiness({ blueprints, decisions, catalogActions });
    expect(report.pilotReadyTemplates).toBe(0);
    expect(report.templates.filter((template: { canPilot: boolean }) => !template.canPilot)).toHaveLength(4);
    expect(report.uniqueBlockedActions).toBe(2);
    expect(report.templates.flatMap((template: { blockers: Array<{ permissionCode?: string }> }) => template.blockers))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ permissionCode: 'wms.inventory.view', actual: 'declared' }),
        expect.objectContaining({ permissionCode: 'workflow.template.view', actual: 'legacy' }),
      ]));
  });

  it('fails closed when an approved item scope is unsupported by the catalog', () => {
    const catalogActions = catalog();
    catalogActions.find(action => action.permissionCode === 'wms.request.delete')!.scopeTypes = ['global'];
    const report = evaluateRoleTemplateReadiness({ blueprints, decisions, catalogActions });
    const manager = report.templates.find(template => template.templateCode === 'WAREHOUSE_MANAGER');
    expect(manager.canPilot).toBe(false);
    expect(manager.blockers).toContainEqual(expect.objectContaining({
      type: 'unsupported_item_scope', permissionCode: 'wms.request.delete', scopeType: 'warehouse',
    }));
  });
});
