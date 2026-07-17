import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAllPermissionActions,
  getPermissionApplications,
  getPermissionModuleByCode,
  getPermissionModules,
  getPermissionRoutes,
  permissionRegistry,
} from '../permissions/permissionRegistry';
import {
  PROJECT_MATERIAL_TAB_PERMISSIONS,
  PROJECT_TAB_PERMISSIONS,
} from '../projectTabPermissions';
import { classifyPermissionAction } from '../permissions/permissionRisk';

const scanFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...scanFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
};

describe('permissionRegistry', () => {
  it('defines unique permission codes and module codes', () => {
    const actions = getAllPermissionActions();
    const actionCodes = actions.map(action => action.permissionCode);
    const moduleCodes = getPermissionModules().map(module => module.code);

    expect(new Set(actionCodes).size).toBe(actionCodes.length);
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
  });

  it('seeds the common ERP applications and project detail permissions', () => {
    const applicationCodes = getPermissionApplications().map(app => app.code);
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(applicationCodes).toEqual(expect.arrayContaining(['system', 'project']));
    expect(actionCodes).toEqual(expect.arrayContaining([
      'system.wms.view',
      'system.settings.manage',
      'system.authorization.manage_roles',
      'system.authorization.manage_grants',
      'system.authorization.manage_scopes',
      'system.authorization.audit',
      'system.authorization.override',
      'project.daily_log.view',
      'project.daily_log.approve',
      'project.material_request.view_available_stock',
      'project.quality.manage',
    ]));
  });

  it('attaches deterministic risk metadata to every registered action', () => {
    const actionByCode = Object.fromEntries(
      getAllPermissionActions().map(action => [action.permissionCode, action]),
    );

    expect(actionByCode['project.daily_log.approve']).toMatchObject({
      riskLevel: 'sensitive',
      isBusinessAction: true,
      isBusinessApproval: true,
      directGrantRequiresExpiry: true,
    });
    expect(actionByCode['system.authorization.manage_grants']).toMatchObject({
      riskLevel: 'sensitive',
      isBusinessAction: false,
      isBusinessApproval: false,
      directGrantRequiresExpiry: true,
    });

    for (const module of getPermissionModules()) {
      for (const action of module.actions) {
        expect({
          riskLevel: action.riskLevel,
          isBusinessAction: action.isBusinessAction,
          isBusinessApproval: action.isBusinessApproval,
          directGrantRequiresExpiry: action.directGrantRequiresExpiry,
        }, action.permissionCode).toEqual(
          classifyPermissionAction(module.code, action.action),
        );
      }
    }
  });

  it('seeds the full Project PBAC v2 module tree', () => {
    const moduleCodes = getPermissionModules().map(module => module.code);
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(moduleCodes).toEqual(expect.arrayContaining([
      'project.overview',
      'project.org',
      'project.executive',
      'project.daily_log',
      'project.material_request',
      'project.material_plan',
      'project.material_boq',
      'project.material_po',
      'project.custom_material',
      'project.gantt',
      'project.weekly_progress',
      'project.contract',
      'project.subcontract',
      'project.payment',
      'project.quantity_acceptance',
      'project.cashflow',
      'project.budget',
      'project.quality',
      'project.safety',
      'project.documents',
      'project.report',
    ]));

    expect(actionCodes).toEqual(expect.arrayContaining([
      'project.org.grant_permissions',
      'project.daily_log.verify',
      'project.daily_log.delete_own',
      'project.daily_log.delete_all',
      'project.material_request.confirm',
      'project.material_po.receive',
      'project.payment.mark_paid',
      'project.documents.upload',
      'project.report.export',
    ]));
  });

  it('seeds the Phase 3 Project submodule permission surface', () => {
    const moduleCodes = getPermissionModules().map(module => module.code);
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(moduleCodes).toEqual(expect.arrayContaining([
      'project.master',
      'project.material_waste',
      'project.contract_item',
      'project.contract_variation',
      'project.dashboard',
    ]));

    expect(actionCodes).toEqual(expect.arrayContaining([
      'project.master.view',
      'project.master.create',
      'project.master.edit',
      'project.master.hide',
      'project.master.restore',
      'project.master.manage_categories',
      'project.daily_log.summarize',
      'project.material_waste.record',
      'project.material_waste.approve',
      'project.contract_item.view',
      'project.contract_item.edit',
      'project.contract_variation.create',
      'project.contract_variation.submit',
      'project.contract_variation.verify',
      'project.contract_variation.approve',
      'project.gantt.create_task',
      'project.gantt.edit_task',
      'project.gantt.assign_task',
      'project.gantt.submit_completion',
      'project.gantt.verify_completion',
      'project.weekly_progress.lock',
      'project.quality.template_manage',
      'project.quality.checklist_create',
      'project.quality.checklist_edit_own',
      'project.quality.checklist_edit_all',
      'project.quality.delete',
      'project.safety.worker_manage',
      'project.safety.issue_close',
      'project.safety.training_manage',
      'project.safety.document_verify',
      'project.documents.edit_metadata',
      'project.documents.delete_own',
      'project.documents.delete_all',
      'project.documents.approve',
      'project.dashboard.view_financials',
      'project.dashboard.view_progress',
      'project.dashboard.view_risk',
    ]));
  });

  it('seeds the Phase 4 ERP-wide domain permission surface', () => {
    const applicationCodes = getPermissionApplications().map(app => app.code);
    const moduleCodes = getPermissionModules().map(module => module.code);
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(applicationCodes).toEqual(expect.arrayContaining([
      'wms',
      'hrm',
      'expense',
      'workflow',
      'request',
      'asset',
      'contract',
      'ai',
      'storage',
      'kb',
      'analytics',
    ]));

    expect(moduleCodes).toEqual(expect.arrayContaining([
      'wms.inventory',
      'wms.request',
      'wms.transaction',
      'hrm.employee',
      'hrm.attendance',
      'expense.expense_record',
      'workflow.template',
      'request.instance',
      'asset.assignment',
      'contract.supplier',
      'ai.report',
      'analytics.dashboard',
    ]));

    expect(actionCodes).toEqual(expect.arrayContaining([
      'wms.transaction.complete',
      'wms.request.receive',
      'hrm.payroll.manage',
      'expense.expense_record.view_all',
      'workflow.instance.act_assigned',
      'request.category.manage',
      'asset.audit.perform',
      'contract.cost_library.view',
      'ai.report.generate',
      'storage.manage',
      'kb.manage',
      'analytics.export',
    ]));
  });

  it('keeps Phase 4 domain modules scoped to their allowed operational scopes', () => {
    const actionByCode = Object.fromEntries(
      getAllPermissionActions().map(action => [action.permissionCode, action])
    );

    expect(actionByCode['wms.inventory.view'].scopeTypes).toEqual(expect.arrayContaining(['global', 'warehouse']));
    expect(actionByCode['wms.request.create'].scopeTypes).toEqual(expect.arrayContaining(['global', 'own', 'assigned', 'warehouse']));
    expect(actionByCode['hrm.employee.view'].scopeTypes).toEqual(expect.arrayContaining(['global', 'own', 'department', 'assigned']));
    expect(actionByCode['expense.expense_record.edit_own'].scopeTypes).toEqual(expect.arrayContaining(['global', 'own', 'department']));
    expect(actionByCode['workflow.instance.act_assigned'].scopeTypes).toEqual(expect.arrayContaining(['global', 'own', 'assigned']));
    expect(actionByCode['asset.assignment.approve'].scopeTypes).toEqual(expect.arrayContaining(['global', 'warehouse', 'department', 'assigned']));
    expect(actionByCode['contract.supplier.manage'].scopeTypes).toEqual(['global']);
    expect(actionByCode['analytics.export'].scopeTypes).toEqual(['global']);
  });

  it('maps every Project tab route to a project view permission', () => {
    const projectRoutes = [
      ...PROJECT_TAB_PERMISSIONS.map(tab => tab.route),
      ...PROJECT_MATERIAL_TAB_PERMISSIONS.map(tab => tab.route),
    ];

    for (const route of projectRoutes) {
      const matchingModules = getPermissionModules().filter(module =>
        (module.routes || []).includes(route)
      );

      expect(matchingModules.length, route).toBeGreaterThan(0);
      expect(
        matchingModules.some(module =>
          module.code.startsWith('project.') &&
          module.actions.some(action => action.action === 'view' && action.permissionCode.startsWith('project.'))
        ),
        route,
      ).toBe(true);
    }
  });

  it('keeps Project modules scoped to project or construction site grants', () => {
    const projectModules = getPermissionModules().filter(module => module.code.startsWith('project.'));

    for (const module of projectModules) {
      expect(getPermissionModuleByCode(module.code)).toBe(module);
      for (const action of module.actions) {
        expect(action.scopeTypes).toEqual(expect.arrayContaining(['project', 'construction_site']));
      }
    }
  });

  it('keeps registry routes unique', () => {
    const routes = getPermissionRoutes();

    expect(routes.length).toBeGreaterThan(20);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('tracks the remaining legacy generic Project permission consumers during Phase 3 rollout', () => {
    const allowedLegacyConsumers = new Set([
      'components/project/BoqReconciliationPanel.tsx',
      'components/project/ContractItemTable.tsx',
      'components/project/ContractPaymentSchedulePanel.tsx',
      'components/project/ContractVariationPanel.tsx',
      'components/project/PaymentCertificatePanel.tsx',
      'components/project/ProjectSubmissionDialog.tsx',
      'components/project/QuantityAcceptancePanel.tsx',
      'lib/approvalService.ts',
      'lib/notificationAlertRules.ts',
      'lib/permissions/projectPermissionService.ts',
      'lib/projectStaffService.ts',
      'pages/project/GanttTab.tsx',
      'pages/project/PaymentWorkbenchTab.tsx',
      'pages/project/ProjectOrgTab.tsx',
      'pages/project/QualityTab.tsx',
      'pages/settings/SettingsAlerts.tsx',
    ]);
    const legacyPattern = /ProjectPermissionCode|requireProjectPermission\(|checkPermission\(/;
    const scannedRoots = ['components', 'lib', 'pages'];
    const actualLegacyConsumers = scannedRoots
      .flatMap(root => scanFiles(join(process.cwd(), root)))
      .filter(file => legacyPattern.test(readFileSync(file, 'utf8')))
      .map(file => relative(process.cwd(), file))
      .sort();

    expect(actualLegacyConsumers).toEqual([...allowedLegacyConsumers].sort());
  });

  it('keeps Daily Log on explicit project.daily_log actions after Phase 3.2', () => {
    const dailyLogSource = readFileSync(join(process.cwd(), 'pages/project/DailyLogTab.tsx'), 'utf8');

    expect(dailyLogSource).not.toContain('ProjectPermissionCode');
    expect(dailyLogSource).not.toContain('checkPermission(');
    expect(dailyLogSource).not.toContain('checkProjectPermission(');
    expect(dailyLogSource).not.toContain('requireProjectPermission(');
    expect(dailyLogSource).toContain('project.daily_log.summarize');
  });

  it('keeps Project Org permissions on the scoped matrix instead of legacy quick toggles', () => {
    const projectOrgSource = readFileSync(join(process.cwd(), 'pages/project/ProjectOrgTab.tsx'), 'utf8');

    expect(projectOrgSource).not.toContain('handleQuickTogglePerm');
    expect(projectOrgSource).not.toContain('togglePerm');
    expect(projectOrgSource).not.toContain('PROJECT_PERMISSION_TEMPLATES =');
    expect(projectOrgSource).toContain('PermissionMatrix');
    expect(projectOrgSource).toContain('canAssignStaff');
    expect(projectOrgSource).toContain('canGrantPermissions');
  });

  it('seeds new project staff with scoped Project PBAC grants, not legacy permission type ids', () => {
    const projectDashboardSource = readFileSync(join(process.cwd(), 'pages/ProjectDashboard.tsx'), 'utf8');

    expect(projectDashboardSource).not.toContain('projectPermissionTypeService');
    expect(projectDashboardSource).toContain('getProjectPermissionTemplateCodes');
    expect(projectDashboardSource).toContain('replaceProjectStaffPermissionGrants');
    expect(projectDashboardSource).toContain('permissionTypeIds: []');
  });

  it('exports immutable application definitions', () => {
    expect(() => {
      (permissionRegistry[0].modules as any).push({ code: 'bad' });
    }).toThrow();
  });
});
