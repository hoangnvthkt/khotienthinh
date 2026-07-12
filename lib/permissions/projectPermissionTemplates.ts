import { getAllPermissionActions } from './permissionRegistry';

export const PROJECT_PERMISSION_TEMPLATES = [
  { key: 'viewer', label: 'Viewer' },
  { key: 'field_engineer', label: 'Field engineer' },
  { key: 'site_manager', label: 'Site manager' },
  { key: 'qs', label: 'QS' },
  { key: 'project_accountant', label: 'Kế toán dự án' },
  { key: 'site_keeper', label: 'Thủ kho công trường' },
  { key: 'qa_qc', label: 'QA/QC' },
  { key: 'safety', label: 'An toàn' },
  { key: 'project_manager', label: 'Project manager' },
  { key: 'access_admin', label: 'Quản trị phân quyền' },
] as const;

export type ProjectPermissionTemplateKey = typeof PROJECT_PERMISSION_TEMPLATES[number]['key'];

const allProjectActionCodes = (actions: readonly string[]) =>
  getAllPermissionActions()
    .filter(action => action.permissionCode.startsWith('project.') && actions.includes(action.action))
    .map(action => action.permissionCode);

const DEPRECATED_PROJECT_TEMPLATE_CODES = new Set([
  'project.quality.create',
  'project.quality.edit_all',
  'project.safety.create',
  'project.safety.edit_all',
  'project.safety.verify',
  'project.safety.approve',
]);

const withoutAccessAdminPrivileges = (codes: readonly string[]) =>
  codes.filter(code =>
    !DEPRECATED_PROJECT_TEMPLATE_CODES.has(code) &&
    code !== 'project.org.grant_permissions' &&
    code !== 'project.master.hide' &&
    code !== 'project.master.restore' &&
    code !== 'project.master.manage_categories' &&
    !code.endsWith('.manage')
  );

export const getProjectPermissionTemplateCodes = (templateKey: ProjectPermissionTemplateKey): readonly string[] => {
  switch (templateKey) {
    case 'viewer':
      return allProjectActionCodes(['view']);
    case 'field_engineer':
      return [
        'project.daily_log.view',
        'project.daily_log.create',
        'project.daily_log.edit_own',
        'project.daily_log.submit',
        'project.material_request.view',
        'project.material_request.create',
        'project.material_request.submit',
        'project.documents.view',
        'project.documents.upload',
      ];
    case 'site_manager':
      return [
        ...allProjectActionCodes(['view']),
        'project.daily_log.create',
        'project.daily_log.edit_all',
        'project.daily_log.verify',
        'project.material_request.create',
        'project.material_request.approve',
        'project.weekly_progress.verify',
        'project.safety.document_verify',
        'project.safety.issue_close',
      ];
    case 'qs':
      return [
        'project.budget.view',
        'project.budget.edit',
        'project.quantity_acceptance.view',
        'project.quantity_acceptance.create',
        'project.quantity_acceptance.verify',
        'project.payment.view',
        'project.material_boq.view',
        'project.material_boq.edit',
      ];
    case 'project_accountant':
      return [
        'project.payment.view',
        'project.payment.verify',
        'project.payment.confirm',
        'project.payment.mark_paid',
        'project.cashflow.view',
        'project.cashflow.manage',
        'project.budget.view',
      ];
    case 'site_keeper':
      return [
        'project.material_request.view',
        'project.material_request.confirm_fulfillment',
        'project.material_request.view_available_stock',
        'project.material_po.view',
        'project.material_po.receive',
      ];
    case 'qa_qc':
      return [
        'project.quality.view',
        'project.quality.template_manage',
        'project.quality.checklist_create',
        'project.quality.checklist_edit_all',
        'project.quality.submit',
        'project.quality.return',
        'project.quality.approve',
      ];
    case 'safety':
      return [
        'project.safety.view',
        'project.safety.worker_manage',
        'project.safety.issue_create',
        'project.safety.issue_edit_all',
        'project.safety.document_verify',
        'project.safety.issue_close',
      ];
    case 'project_manager':
      return withoutAccessAdminPrivileges(allProjectActionCodes([
        'view',
        'create',
        'edit',
        'edit_own',
        'edit_all',
        'delete',
        'delete_own',
        'delete_all',
        'submit',
        'return',
        'verify',
        'confirm',
        'approve',
        'assign_staff',
      ]));
    case 'access_admin':
      return [
        'project.org.view',
        'project.org.assign_staff',
        'project.org.grant_permissions',
      ];
    default:
      return [];
  }
};
