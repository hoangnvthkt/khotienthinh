import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PermissionTemplateFill from '../../components/permissions/PermissionTemplateFill';
import PermissionModuleEditor from '../../components/permissions/PermissionModuleEditor';
import PermissionDiffPreview from '../../components/permissions/PermissionDiffPreview';
import { userPermissionTemplateService } from '../../lib/userPermissionTemplateService';
import { userTemplateAssignmentService, type UserTemplateAssignment } from '../../lib/userTemplateAssignmentService';
import type { PermissionAdminCatalog } from '../../lib/permissions/permissionTypes';
import type { UserPermissionGrant } from '../../types';

const act = (permissionCode: string, label: string, extra: Record<string, unknown> = {}) => ({
  action: permissionCode.split('.').pop()!, label, permissionCode, scopeTypes: ['global', 'own', 'assigned'], sortOrder: 1,
  riskLevel: 'normal', grantReadiness: 'enforced', directGrantAllowed: true, directGrantRequiresExpiry: false,
  isDefaultView: false, defaultScopeType: 'global', ...extra,
});
const catalog = { generatedAt: '2026-09-28T00:00:00Z', applications: [
  { code: 'wms', label: 'Kho vật tư', sortOrder: 1, hasDefaultViewBundle: false, modules: [
    { code: 'wms.request', label: 'Đề xuất vật tư', sortOrder: 1, actions: [
      act('wms.request.view', 'Xem'), act('wms.request.create', 'Tạo'),
      act('wms.request.approve', 'Duyệt', { directGrantRequiresExpiry: true, riskLevel: 'sensitive' }),
    ] },
  ] },
  { code: 'kb', label: 'Kho tri thức', sortOrder: 2, hasDefaultViewBundle: false, modules: [
    { code: 'kb.articles', label: 'Bài viết', sortOrder: 1, actions: [act('kb.view', 'Xem'), act('kb.manage', 'Quản lý')] },
    { code: 'hrm.payroll', label: 'Bảng lương', sortOrder: 2, actions: [act('hrm.payroll.view', 'Xem bảng lương', { directGrantAllowed: false })] },
  ] },
] } as unknown as PermissionAdminCatalog;

// Stand-ins for the Cloud reads.
userPermissionTemplateService.list = async () => [
  { code: 'basic_employee', name: 'Nhân viên cơ bản', description: 'Mọi nhân viên: xem tri thức.', items: [{ permissionCode: 'kb.view', scopeType: 'global' }], suggestedPositionIds: [], options: [], sortOrder: 10, isActive: true },
  { code: 'warehouse_manager', name: 'Quản lý kho', description: 'Đề xuất, duyệt đề xuất vật tư; xem tri thức.', items: [
    { permissionCode: 'kb.view', scopeType: 'global' }, { permissionCode: 'wms.request.view', scopeType: 'global' },
    { permissionCode: 'wms.request.create', scopeType: 'global' }, { permissionCode: 'wms.request.approve', scopeType: 'global', expiresInDays: 365 },
  ], suggestedPositionIds: ['pos-kho'], options: ['po_approver'], sortOrder: 30, isActive: true },
];
userPermissionTemplateService.getUserPositionId = async () => 'pos-kho';
userPermissionTemplateService.listOptionDefs = async () => [
  { key: 'po_approver', label: 'Duyệt PO', description: 'Người được chọn duyệt PO.', items: [{ permissionCode: 'system.procurement.approve', scopeType: 'global' }] },
];
// Gắn mẫu: giả lập máy chủ trong bộ nhớ (?assigned=1 để mở sẵn người đang theo mẫu).
let fakeAssignment: UserTemplateAssignment | null = new URLSearchParams(window.location.search).has('assigned') ? {
  userId: 'fixture', templateCode: 'warehouse_manager', templateName: 'Quản lý kho', options: ['po_approver'],
  excludedCount: 1, appliedCount: 4, assignedAt: '2026-10-23T08:00:00Z', updatedAt: '2026-10-23T08:00:00Z', assignedByName: 'Admin Hoàng',
} : null;
userTemplateAssignmentService.get = async () => fakeAssignment;
userTemplateAssignmentService.preview = async (_userId, code, options) => ({
  add: code === 'warehouse_manager'
    ? [{ permissionCode: 'wms.request.view', scopeType: 'global', label: 'Xem', moduleCode: 'wms.request', moduleLabel: 'Đề xuất vật tư' },
      { permissionCode: 'wms.request.create', scopeType: 'global', label: 'Tạo', moduleCode: 'wms.request', moduleLabel: 'Đề xuất vật tư' },
      ...(options.includes('po_approver') ? [{ permissionCode: 'system.procurement.approve', scopeType: 'global', label: 'Duyệt PO', moduleCode: 'system.procurement', moduleLabel: 'Mua hàng' }] : [])]
    : [],
  remove: fakeAssignment && fakeAssignment.templateCode !== code
    ? [{ permissionCode: 'wms.request.approve', scopeType: 'global', label: 'Duyệt', moduleCode: 'wms.request', moduleLabel: 'Đề xuất vật tư' }] : [],
  excludedCount: 0,
});
userTemplateAssignmentService.save = async (_userId, code, options) => {
  fakeAssignment = { userId: 'fixture', templateCode: code, templateName: code === 'warehouse_manager' ? 'Quản lý kho' : 'Nhân viên cơ bản',
    options: [...options], excludedCount: 0, appliedCount: 4, assignedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assignedByName: 'Admin Hoàng' };
  return { added: code === 'warehouse_manager' ? 2 + (options.includes('po_approver') ? 1 : 0) : 0, removed: 0 };
};
userTemplateAssignmentService.remove = async () => { fakeAssignment = null; };

const initial: UserPermissionGrant[] = [
  { id: 'g1', userId: 'fixture', permissionCode: 'kb.manage', scopeType: 'global', scopeId: '*', isActive: true },
];
const Fixture = () => {
  const [grants, setGrants] = useState(initial);
  const [reason, setReason] = useState('');
  return <div className="mx-auto max-w-4xl space-y-3 p-4">
    <PermissionTemplateFill userId="fixture" catalog={catalog} grants={grants} inheritedCodes={[]} reason={reason}
      disabled={false} onGrantsChange={setGrants} onReasonChange={setReason}
      hasUnsavedChanges={JSON.stringify(grants) !== JSON.stringify(initial)} onAssignmentChanged={() => undefined} />
    <PermissionModuleEditor catalog={catalog} grants={grants} targetUserId="fixture" onChange={setGrants}
      initialExpandedApplicationCodes={['wms', 'kb']} initialExpandedAdvancedModuleCodes={['kb.articles', 'hrm.payroll']}
      inheritedSources={[{ permissionCode: 'kb.view', sourceType: 'ROLE', sourceCode: 'HR', scopeType: 'global', scopeId: '*', isBusinessApproval: false, metadata: {} }]} />
    <PermissionDiffPreview before={initial} after={grants} />
    <output aria-label="Reason">{reason}</output>
  </div>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
