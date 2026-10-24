import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '../../index.css';
import PermissionCenterView from '../../components/permissions/center/PermissionCenterView';
import { permissionCenterService, type CenterPerson, type CenterTemplate, type PermissionCenterData } from '../../lib/permissions/permissionCenterService';
import { userTemplateAssignmentService } from '../../lib/userTemplateAssignmentService';

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
