import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PermissionTemplateFill from '../../components/permissions/PermissionTemplateFill';
import PermissionModuleEditor from '../../components/permissions/PermissionModuleEditor';
import PermissionDiffPreview from '../../components/permissions/PermissionDiffPreview';
import { userPermissionTemplateService } from '../../lib/userPermissionTemplateService';
import { userTemplateAssignmentService, type UserTemplateAssignment } from '../../lib/userTemplateAssignmentService';
import type { PermissionAdminCatalog } from '../../lib/permissions/permissionTypes';
import type { UserPermissionGrant } from '../../types';
import { SodAcknowledgeDialog, SodConflictNotice } from '../../components/permissions/SodAcknowledge';
import { emptySodAcknowledgement, sodService, toSodAcceptances, type SodWarning } from '../../lib/permissions/sodService';

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
  // Đợt 2c: tích Duyệt PO cho người đang Quản trị Mua hàng = kiêm nhiệm Mua hàng + Duyệt PO.
  sod: {
    warnings: code === 'warehouse_manager' && options.includes('po_approver') ? [{
      ruleCode: 'PROCUREMENT_BUY_APPROVE_PO', name: 'Mua hàng + Duyệt PO',
      description: 'Người mua hàng cũng duyệt đơn mua. Hệ thống vẫn chặn duyệt đơn do chính mình lập.',
      scopeType: 'global', scopeId: '*', scopeLabel: null,
      permissions: [{ code: 'system.procurement.manage', label: 'Quản trị', moduleLabel: 'Mua hàng' },
        { code: 'system.procurement.approve', label: 'Duyệt PO', moduleLabel: 'Mua hàng' }],
      controls: ['Không duyệt đơn do chính mình lập (hệ thống đã chặn)', 'Ban lãnh đạo xem lại đơn mua lớn hằng tuần'],
    }] : [],
    hardDenies: [],
    defaultControlOwnerId: 'u-thinh',
  },
});
userTemplateAssignmentService.save = async (_userId, code, options, _reason, acceptances = []) => {
  (window as unknown as { __sodAcceptances: unknown }).__sodAcceptances = acceptances;
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
      hasUnsavedChanges={JSON.stringify(grants) !== JSON.stringify(initial)} onAssignmentChanged={() => undefined}
      controlOwnerCandidates={[{ id: 'u-thinh', name: 'Dương Xuân Thịnh' }, { id: 'u-mo', name: 'Nguyễn Thị Mơ' }]} actorUserId="u-admin" />
    <PermissionModuleEditor catalog={catalog} grants={grants} targetUserId="fixture" onChange={setGrants}
      initialExpandedApplicationCodes={['wms', 'kb']} initialExpandedAdvancedModuleCodes={['kb.articles', 'hrm.payroll']}
      inheritedSources={[{ permissionCode: 'kb.view', sourceType: 'ROLE', sourceCode: 'HR', scopeType: 'global', scopeId: '*', isBusinessApproval: false, metadata: {} }]} />
    <PermissionDiffPreview before={initial} after={grants} />
    <output aria-label="Reason">{reason}</output>
  </div>;
};
// ?dialog=1: hộp ghi nhận kiêm nhiệm ở màn Người dùng (thủ kho 2 kho được thêm Mua hàng + Duyệt PO).
sodService.listConflicts = async () => [{ userId: 'fixture', name: 'Đặng Thị Hương', email: 'huongdt@example.com', conflicts: [{
  ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho', description: '',
  scopes: [{ scopeType: 'warehouse', scopeId: 'wh-1', scopeLabel: 'Kho Tổng Hưng Yên' }], acceptance: null,
}] }];
const keeperWarning = (scopeId: string, scopeLabel: string): SodWarning => ({
  ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho', description: 'Người mua hàng cũng là thủ kho, tự nhận hàng mình mua.',
  scopeType: 'warehouse', scopeId, scopeLabel,
  permissions: [{ code: 'system.procurement.manage', label: 'Quản trị', moduleLabel: 'Mua hàng' }, { code: 'wms.transaction.keeper', label: 'Thủ kho', moduleLabel: 'Phiếu kho' }],
  controls: ['Kế toán đối chiếu phiếu nhập kho với đơn mua hằng tháng', 'Kiểm kê kho định kỳ có người thứ hai'],
});
const dialogWarnings = [keeperWarning('wh-1', 'Kho Tổng Hưng Yên'), keeperWarning('wh-2', 'Kho VPP Hưng Yên')];
const DialogFixture = () => {
  const [ack, setAck] = useState(emptySodAcknowledgement('u-thinh'));
  const [sent, setSent] = useState<string | null>(null);
  return <div className="mx-auto max-w-4xl space-y-3 p-4">
    <SodConflictNotice userId="fixture" />
    {sent ? <output aria-label="Sent">{sent}</output> : <SodAcknowledgeDialog targetName="Đặng Thị Hương" targetUserId="fixture" actorUserId="u-admin"
      warnings={dialogWarnings} value={ack} onChange={setAck}
      candidates={[{ id: 'u-thinh', name: 'Dương Xuân Thịnh' }, { id: 'u-mo', name: 'Nguyễn Thị Mơ' }]}
      onConfirm={() => setSent(JSON.stringify(toSodAcceptances(dialogWarnings, ack).map(row => row.scopeId)))} onCancel={() => setSent('cancel')} />}
  </div>;
};
// ?existing=1: người đang kiêm nhiệm sẵn, Admin bấm Ghi nhận ở dòng nhắc.
const ExistingFixture = () => {
  const [sent, setSent] = useState<string | null>(null);
  sodService.recordExisting = async (_userId, ruleCode, ack) => { setSent(`${ruleCode}|${ack.controlOwnerUserId}|${ack.compensatingControls}`); };
  sodService.listConflicts = async () => [{ userId: 'fixture', name: 'Bùi Thị Tâm', email: 'tamtt@example.com', conflicts: [{
    ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho', description: 'Người mua hàng cũng là thủ kho, tự nhận hàng mình mua.',
    scopes: [{ scopeType: 'warehouse', scopeId: 'wh-smb', scopeLabel: 'Kho Sơn Miền Bắc' }],
    permissions: keeperWarning('wh-smb', 'Kho Sơn Miền Bắc').permissions, controls: keeperWarning('wh-smb', 'Kho Sơn Miền Bắc').controls,
    acceptance: sent ? { expiresAt: '2027-04-23T00:00:00Z', reason: 'x', compensatingControls: 'y', controlOwnerName: 'Nguyễn Thị Hương', acceptedAt: '2026-10-23T00:00:00Z' } : null,
  }] }];
  return <div className="mx-auto max-w-4xl space-y-3 p-4">
    <SodConflictNotice userId="fixture" targetName="Bùi Thị Tâm" reloadKey={sent ? 1 : 0} actorUserId="u-admin" defaultControlOwnerId="u-huong"
      candidates={[{ id: 'u-huong', name: 'Nguyễn Thị Hương' }, { id: 'u-mo', name: 'Nguyễn Thị Mơ' }]} />
    {sent && <output aria-label="Sent">{sent}</output>}
  </div>;
};
const mode = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(mode.has('existing') ? <ExistingFixture /> : mode.has('dialog') ? <DialogFixture /> : <Fixture />);
