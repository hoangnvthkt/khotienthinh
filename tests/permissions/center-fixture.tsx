import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '../../index.css';
import PermissionCenterView from '../../components/permissions/center/PermissionCenterView';
import { permissionCenterService, type CenterPerson, type CenterTemplate, type PermissionCenterData } from '../../lib/permissions/permissionCenterService';
import { userTemplateAssignmentService } from '../../lib/userTemplateAssignmentService';
import { permissionBulkService, type AuditRow, type BulkPreviewRow } from '../../lib/permissions/permissionBulkService';
import { sodService, type SodWarning } from '../../lib/permissions/sodService';

// Trung tâm phân quyền · fixture (không gọi Supabase). Số liệu giống Cloud 23/10/2026, rút gọn người.
// ?denied=1: người không quản lý phân quyền. ?fail=1: lỗi tải. ?staff=1: không phải Admin (không sửa mô tả mẫu).
const params = new URLSearchParams(location.search);
const calls: Array<Record<string, unknown>> = [];
(window as unknown as { __centerCalls: typeof calls }).__centerCalls = calls;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const row = (ab: string, title: string, text: string) => ({ ab, title, text });
const TEMPLATES: CenterTemplate[] = [
  { code: 'basic_employee', name: 'Nhân viên cơ bản', description: 'Việc chung của mọi nhân viên.', sortOrder: 10, itemCount: 34, people: 0, options: [],
    summary: [row('NS', 'Nhân sự của tôi', 'Hồ sơ, chấm công, nghỉ phép, phiếu lương của mình; danh bạ'), row('YC', 'Phiếu yêu cầu', 'Tạo, sửa, hủy phiếu của mình; xử lý bước được giao'),
      row('QT', 'Quy trình', 'Tạo, sửa nháp; xử lý bước được giao'), row('VB', 'Vioo Office', 'Xem; xử lý và duyệt văn bản được giao'), row('CV', 'Vioo Work', 'Tạo việc, nhận việc, cập nhật tiến độ')] },
  { code: 'material_staff', name: 'Mua hàng', description: 'Lập và quản lý đơn mua, HĐ nguyên tắc, mua nóng; xem kho, hợp đồng NCC.', sortOrder: 20, itemCount: 45, people: 0,
    options: [{ key: 'po_approver', label: 'Duyệt PO', description: 'Duyệt đơn mua của người khác (không tự duyệt đơn mình lập)' }],
    summary: [row('MH', 'Mua hàng', 'Lập, sửa, gửi đơn mua; HĐ nguyên tắc, gọi hàng, mua nóng'), row('KH', 'Kho', 'Xem tồn, phiếu kho, đề xuất vật tư')] },
  { code: 'warehouse_manager', name: 'Cán bộ kho', description: 'Xem kho, tồn, phiếu kho, đề xuất, đơn mua.', sortOrder: 30, itemCount: 47, people: 0, options: [],
    summary: [row('KH', 'Kho', 'Xem tồn, phiếu kho, đề xuất vật tư'), row('TK', 'Thủ kho', 'Nhập, xuất, kiểm kê theo kho được giao (Phân quyền kho)')] },
  { code: 'site_staff', name: 'Cán bộ công trường', description: 'Xem kho công trường, tài sản. Việc dự án theo Room.', sortOrder: 40, itemCount: 43, people: 0, options: [],
    summary: [row('KH', 'Kho công trường', 'Xem tồn, phiếu kho, đề xuất vật tư'), row('DA', 'Việc dự án', 'Theo vai trò trong Room từng dự án')] },
  { code: 'accountant', name: 'Kế toán', description: 'Công nợ, đề nghị chi, thu chi, chi phí; xem kho, mua hàng, hợp đồng.', sortOrder: 50, itemCount: 62, people: 0,
    options: [{ key: 'chief_accountant', label: 'Kế toán trưởng', description: 'Xác nhận đã chi, sửa ngân sách, danh mục chi phí, khóa kỳ kho' }, { key: 'warehouse_accounting', label: 'Kế toán kho', description: 'Đối chiếu, giá vốn, báo cáo kho' }],
    summary: [row('TC', 'Tài chính', 'Công nợ, đề nghị chi, thu chi, sao kê, hóa đơn'), row('CP', 'Chi phí, ngân sách', 'Tạo, duyệt chi phí; xem ngân sách')] },
  { code: 'executive', name: 'Ban lãnh đạo', description: 'Xem toàn công ty.', sortOrder: 100, itemCount: 76, people: 0,
    options: [{ key: 'po_approver', label: 'Duyệt PO', description: 'Duyệt đơn mua của người khác (không tự duyệt đơn mình lập)' }],
    summary: [row('TC', 'Tài chính', 'Xem toàn công ty; Quản trị Tài chính do Admin cấp riêng'), row('DA', 'Dự án', 'Xem tất cả dự án, tiến độ, nhật ký')] },
];
const p = (patch: Partial<CenterPerson> & Pick<CenterPerson, 'userId' | 'name'>): CenterPerson => ({
  department: '', position: '', avatar: null, templateCode: 'basic_employee', options: [], grantCount: 34, sensitive: [], extraCount: 0, extra: [],
  expiringSoon: 0, warehouses: [], hrRoles: [], roomProjects: 0, conflicts: [], ...patch,
});
const PEOPLE: CenterPerson[] = [
  p({ userId: 'u-thinh', name: 'Dương Xuân Thịnh', department: 'Ban lãnh đạo', position: 'Tổng giám đốc', templateCode: 'executive', grantCount: 142,
    sensitive: ['Công việc: Quản lý theo phạm vi', 'Ghi nhận chi phí: Duyệt'], extraCount: 45, extra: ['Báo cáo: Xem', 'BOQ vật tư: Quản trị'], hrRoles: ['Xem nhân sự tổng hợp'], roomProjects: 3 }),
  p({ userId: 'u-mo', name: 'Nguyễn Thị Mơ', department: 'Ban lãnh đạo', position: 'Giám đốc điều hành', templateCode: 'executive', options: ['po_approver'], grantCount: 162,
    sensitive: ['Mua hàng: Duyệt PO'], extraCount: 51, extra: ['Báo cáo: Xem'], hrRoles: ['Xem nhân sự tổng hợp'], roomProjects: 4 }),
  p({ userId: 'u-tam', name: 'Bùi Thị Tâm', department: 'Phòng Tài chính - Kế toán', position: 'Chuyên viên Kế toán dự án', templateCode: 'accountant', options: ['warehouse_accounting'],
    grantCount: 87, sensitive: ['Kế toán kho: Kế toán kho'], extraCount: 22, extra: ['Mua hàng: Quản trị', 'Danh mục kho: Quản trị danh mục'], warehouses: ['Kho Sơn Miền Bắc'], roomProjects: 3,
    conflicts: [{ rule: 'Mua hàng + Thủ kho', scope: 'Kho Sơn Miền Bắc', until: '2027-04-23T00:00:00Z', controlOwner: 'Nguyễn Thị Hương' }] }),
  p({ userId: 'u-huong', name: 'Nguyễn Thị Hương', department: 'Phòng Tài chính - Kế toán', position: 'Trưởng phòng TCKT', templateCode: 'accountant', options: ['chief_accountant', 'warehouse_accounting'], grantCount: 120, hrRoles: ['Xem nhân sự tổng hợp'] }),
  p({ userId: 'u-ha', name: 'Đặng Thị Thu Hà', department: 'Phòng Vật tư - Thiết bị', position: 'Quyền phó phòng VTTB', templateCode: 'material_staff', options: ['po_approver'], grantCount: 84,
    sensitive: ['Mua hàng: Duyệt PO'], conflicts: [{ rule: 'Mua hàng + Duyệt PO', scope: 'Toàn công ty', until: '2027-04-23T00:00:00Z', controlOwner: 'Nguyễn Thị Mơ' }] }),
  p({ userId: 'u-chung', name: 'Bùi Quang Chung', department: 'Phòng Vật tư - Thiết bị', position: 'Chuyên viên Vật tư', templateCode: 'material_staff', grantCount: 98, extraCount: 33, extra: ['Báo cáo: Xem'] }),
  p({ userId: 'u-luat', name: 'Nguyễn Văn Luật', department: 'Ban chỉ huy công trình Sơn Miền Bắc', position: 'Trợ lý dự án', templateCode: 'warehouse_manager', grantCount: 90, warehouses: ['Kho Sơn Miền Bắc'], roomProjects: 1 }),
  p({ userId: 'u-son', name: 'Phạm Ngọc Sơn', department: 'Ban chỉ huy công trình Sơn Miền Bắc', position: 'Chỉ huy phó BCH SMB', templateCode: 'site_staff', grantCount: 96, roomProjects: 1 }),
  p({ userId: 'u-khoi', name: 'Trần Văn Khôi', department: 'Ban chỉ huy công trình Sơn Miền Bắc', position: 'Cán bộ Trắc đạc', templateCode: 'site_staff', grantCount: 76 }),
  p({ userId: 'u-tien', name: 'Phạm Minh Tiến', department: 'Phòng Thiết kế - Đấu thầu', position: 'Trưởng phòng TKĐT', grantCount: 97, expiringSoon: 1 }),
  p({ userId: 'u-vinh', name: 'Nguyễn Văn Vĩnh', templateCode: null }),
];
TEMPLATES.forEach(template => { template.people = PEOPLE.filter(person => person.templateCode === template.code).length; });

let data: PermissionCenterData = { generatedAt: '2026-10-23T15:00:00Z', templates: TEMPLATES, people: PEOPLE };
permissionCenterService.load = async () => {
  calls.push({ load: true }); await sleep(60);
  if (params.has('fail')) throw new Error('Mất kết nối máy chủ');
  return JSON.parse(JSON.stringify(data));
};
permissionCenterService.saveSummary = async (code, summary) => {
  calls.push({ saveSummary: { code, summary } }); await sleep(40);
  data = { ...data, templates: data.templates.map(template => (template.code === code ? { ...template, summary: [...summary] } : template)) };
};
userTemplateAssignmentService.preview = async (userId, code, options) => {
  calls.push({ preview: { userId, code, options } }); await sleep(40);
  const sod = userId === 'u-chung' && code === 'material_staff' && options.includes('po_approver');
  return {
    add: [{ permissionCode: 'system.procurement.manage', scopeType: 'global', label: 'Quản trị', moduleCode: 'system.procurement', moduleLabel: 'Mua hàng' },
      ...(options.includes('po_approver') ? [{ permissionCode: 'system.procurement.approve', scopeType: 'global', label: 'Duyệt PO', moduleCode: 'system.procurement', moduleLabel: 'Mua hàng' }] : [])],
    remove: [], excludedCount: 0,
    sod: { warnings: sod ? [{ ruleCode: 'PROCUREMENT_BUY_APPROVE_PO', name: 'Mua hàng + Duyệt PO', description: 'Người mua hàng cũng duyệt đơn mua.', scopeType: 'global', scopeId: '*', scopeLabel: null,
      permissions: [{ code: 'system.procurement.manage', label: 'Quản trị', moduleLabel: 'Mua hàng' }, { code: 'system.procurement.approve', label: 'Duyệt PO', moduleLabel: 'Mua hàng' }],
      controls: ['Ban lãnh đạo xem lại đơn mua lớn hằng tuần'] }] : [], hardDenies: [], defaultControlOwnerId: 'u-ha' },
  };
};
userTemplateAssignmentService.save = async (userId, code, options, reason, acceptances = []) => {
  calls.push({ save: { userId, code, options, reason, acceptances } }); await sleep(40);
  data = { ...data, people: data.people.map(person => (person.userId === userId ? { ...person, templateCode: code, options: [...options] } : person)) };
  return { added: 1 + options.length, removed: 0 };
};

// Bước 3: Hàng loạt, Sao chép, Kiểm soát, Nhật ký.
const PO_WARNING: SodWarning = { ruleCode: 'PROCUREMENT_BUY_APPROVE_PO', name: 'Mua hàng + Duyệt PO', description: 'Người mua hàng cũng duyệt đơn mua.', scopeType: 'global', scopeId: '*', scopeLabel: null,
  permissions: [{ code: 'system.procurement.manage', label: 'Quản trị', moduleLabel: 'Mua hàng' }, { code: 'system.procurement.approve', label: 'Duyệt PO', moduleLabel: 'Mua hàng' }],
  controls: ['Ban lãnh đạo xem lại đơn mua lớn hằng tuần'] };
const KEEPER_WARNING: SodWarning = { ...PO_WARNING, ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho', scopeType: 'warehouse', scopeId: 'wh-smb', scopeLabel: 'Kho Sơn Miền Bắc' };
const nameOf = (userId: string) => data.people.find(person => person.userId === userId)?.name || userId;
const templateName = (code: string | null) => TEMPLATES.find(template => template.code === code)?.name || null;
permissionBulkService.grantableCatalog = async () => {
  calls.push({ catalog: true }); await sleep(30);
  return [
    { code: 'hrm.attendance.approve', label: 'Duyệt/chốt công', module: 'Chấm công', scopeType: 'global', sensitive: false, search: 'nhan su cham cong duyet/chot cong' },
    { code: 'project.report.export', label: 'Xuất dữ liệu', module: 'Báo cáo dự án', scopeType: 'global', sensitive: false, search: 'du an bao cao du an xuat du lieu' },
    { code: 'system.finance.manage', label: 'Quản trị', module: 'Tài chính', scopeType: 'global', sensitive: true, search: 'tai chinh quan tri' },
  ];
};
permissionBulkService.previewBulk = async (userIds, action) => {
  calls.push({ previewBulk: { userIds: [...userIds], action } }); await sleep(50);
  return userIds.map((userId): BulkPreviewRow => {
    const person = data.people.find(item => item.userId === userId)!;
    const base = { userId, name: person.name, fromTemplate: templateName(person.templateCode), toTemplate: null, skip: false, note: null, add: 0, remove: 0, extended: 0, warnings: [] as SodWarning[] };
    if (action.kind === 'template') {
      if (person.templateCode === action.templateCode) return { ...base, toTemplate: templateName(action.templateCode), skip: true, note: 'Đã theo mẫu này' };
      return { ...base, toTemplate: templateName(action.templateCode), add: 5, remove: 2 };
    }
    if (action.kind === 'option') {
      const template = TEMPLATES.find(item => item.code === person.templateCode);
      if (!template?.options.some(option => option.key === action.optionKey)) return { ...base, skip: true, note: `Mẫu ${template?.name || ''} không có ô này` };
      if (person.options.includes(action.optionKey) === action.on) return { ...base, skip: true, note: action.on ? 'Đã tích sẵn' : 'Chưa tích' };
      return { ...base, add: action.on ? 1 : 0, remove: action.on ? 0 : 1, warnings: action.on && person.templateCode === 'material_staff' ? [PO_WARNING] : [] };
    }
    if (action.kind === 'extend') return person.expiringSoon ? { ...base, extended: person.expiringSoon } : { ...base, skip: true, note: 'Không có quyền sắp hết hạn' };
    return { ...base, add: 1 };
  });
};
permissionBulkService.applyBulk = async (userIds, action, reason, ack, onProgress) => {
  calls.push({ applyBulk: { userIds: [...userIds], action, reason, ack } }); await sleep(80);
  if (params.has('bulkfail')) throw new Error('Mất kết nối máy chủ');
  if (action.kind === 'template') {
    data = { ...data, people: data.people.map(person => (userIds.includes(person.userId) ? { ...person, templateCode: action.templateCode, options: [...action.options] } : person)) };
  }
  onProgress?.(userIds.length, userIds.length);
  const failed = userIds.filter(userId => userId === 'u-vinh').map(userId => ({ userId, name: nameOf(userId), error: 'Tài khoản đã khóa' }));
  return { done: userIds.filter(userId => userId !== 'u-vinh').map(userId => ({ userId, name: nameOf(userId), added: 5, removed: 2 })), failed, skipped: [] };
};
permissionBulkService.previewCopy = async (fromUserId, toUserIds, what) => {
  calls.push({ previewCopy: { fromUserId, toUserIds: [...toUserIds], what } }); await sleep(50);
  const source = data.people.find(person => person.userId === fromUserId)!;
  return toUserIds.map(userId => {
    const person = data.people.find(item => item.userId === userId)!;
    const lines: { text: string; tone: 'ok' | 'warn' | 'muted' }[] = [];
    if (what.template) lines.push(person.templateCode === source.templateCode
      ? { text: `Mẫu: giữ ${templateName(source.templateCode)}`, tone: 'muted' }
      : { text: `Mẫu: ${templateName(person.templateCode) || 'chưa có'} → ${templateName(source.templateCode)} (thêm 20, gỡ 0)`, tone: 'ok' });
    if (what.extra) lines.push({ text: `+ ${source.extraCount} quyền riêng${source.sensitive.length ? `, có ${source.sensitive.length} quyền nhạy cảm` : ''}`, tone: source.sensitive.length ? 'warn' : 'ok' });
    if (what.warehouses) lines.push({ text: `+ 1 quyền riêng`, tone: 'ok' });
    if (what.room) lines.push({ text: `Room: thêm vào ${source.roomProjects} dự án, cùng vị trí và vai trò`, tone: 'ok' });
    return { userId, name: person.name, lines, warnings: fromUserId === 'u-tam' && what.extra ? [KEEPER_WARNING] : [] };
  });
};
permissionBulkService.applyCopy = async (fromUserId, toUserIds, what, reason, ack, onProgress) => {
  calls.push({ applyCopy: { fromUserId, toUserIds: [...toUserIds], what, reason, ack } }); await sleep(80);
  onProgress?.(toUserIds.length, toUserIds.length);
  return { done: toUserIds.map(userId => ({ userId, name: nameOf(userId), added: 3, rooms: what.room ? 1 : 0 })), failed: [], skipped: [] };
};
const log = (id: string, patch: Partial<AuditRow>): AuditRow => ({ id, at: '2026-10-23T14:27:07Z', eventType: 'user_authorization_v2_updated', kind: 'change', actor: 'Admin Hoàng',
  target: 'Nguyễn Quang Thuận', reason: 'Theo chức danh', before: 80, after: 81, added: null, removed: null, template: null, rule: null, controlOwner: null, until: null, room: null, project: null, ...patch });
permissionBulkService.listAudit = async before => {
  calls.push({ listAudit: before || null }); await sleep(40);
  if (before) return [log('old-1', { at: '2026-09-22T04:14:25Z', reason: 'Screenshot 2026-09-22 at 11.14.25', target: 'Hà Thị Tuyết Minh' })];
  return [
    log('e1', { eventType: 'sod_existing_conflict_acknowledged', kind: 'sod', target: 'Bùi Thị Tâm', rule: 'Mua hàng + Thủ kho', controlOwner: 'Nguyễn Thị Hương',
      until: '2027-04-23T14:27:07Z', reason: 'Kế toán kiêm thủ kho và mua hàng Kho Sơn Miền Bắc (chủ SP chốt 23/10)', before: null, after: null }),
    log('e2', { eventType: 'user_template_assignment_saved', kind: 'template', target: 'Bùi Thị Tâm', template: 'Kế toán', added: 21, removed: 0, reason: 'Đợt 3: gắn mẫu quyền theo bộ phận (chủ SP duyệt 23/10/2026)' }),
    log('e3', { at: '2026-10-23T09:00:00Z', reason: 'Okokokokok', target: 'Nguyễn Văn Năm' }),
    log('e4', { at: '2026-10-22T09:00:00Z', eventType: 'replace_project_permission_room_members', kind: 'room', target: null, reason: '', room: 'Nhật ký công trường', project: 'Sơn Miền Bắc' }),
    log('e5', { at: '2026-10-21T09:00:00Z', reason: 'thuannq@tienthinhjsc.vn' }),
    ...Array.from({ length: 95 }, (_, index) => log(`f${index}`, { at: new Date(Date.UTC(2026, 9, 20, 12, 0) - index * 3600_000).toISOString(), reason: 'Phân quyền Room dự án', target: 'Phạm Ngọc Sơn' })),
  ];
};
permissionBulkService.expiryOverview = async () => { calls.push({ expiry: true }); await sleep(30); return { nextExpiry: '2026-12-31T16:59:59Z', within30: 0, within90: 0 }; };
sodService.listConflicts = async userId => {
  const person = data.people.find(item => item.userId === userId);
  if (!person?.conflicts.length) return [];
  return [{ userId: person.userId, name: person.name, email: '', conflicts: person.conflicts.map(conflict => ({
    ruleCode: conflict.rule === 'Mua hàng + Thủ kho' ? 'PROCUREMENT_BUY_WAREHOUSE_KEEPER' : 'PROCUREMENT_BUY_APPROVE_PO', name: conflict.rule, description: '',
    scopes: [{ scopeType: conflict.scope === 'Toàn công ty' ? 'global' : 'warehouse', scopeId: '*', scopeLabel: conflict.scope }],
    acceptance: conflict.until ? { expiresAt: conflict.until, reason: 'Chủ SP chốt 23/10', compensatingControls: 'Rà soát hằng tuần', controlOwnerName: conflict.controlOwner, acceptedAt: '2026-10-23T14:27:07Z' } : null,
  })) }];
};
sodService.recordExisting = async (userId, ruleCode, ack) => { calls.push({ recordExisting: { userId, ruleCode, ack } }); await sleep(40); };

const Where: React.FC = () => { const l = useLocation(); return <p data-testid="route" className="sr-only">{l.pathname}{l.search}</p>; };
const people = [...PEOPLE.map(person => ({ id: person.userId, name: person.name, active: true })), { id: 'u-admin', name: 'Admin Hoàng', active: true }];
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/permissions']}>
    <main className="mx-auto max-w-[1600px] p-4 md:p-6">
      <Routes>
        <Route path="/permissions" element={<PermissionCenterView allowed={!params.has('denied')} currentUserId="u-admin" isAdmin={!params.has('staff')} people={people}
          canOpenRoute={() => true} onOpenDetail={userId => calls.push({ openDetail: userId })} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </main>
  </MemoryRouter>,
);
