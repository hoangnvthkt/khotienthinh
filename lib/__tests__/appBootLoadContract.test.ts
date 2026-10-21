import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// Đo 12/10/2026 (/da, tải mới): ~63 lệnh gọi trước khi thẻ dự án hiện, snapshot phân quyền 2 lần,
// 22 lệnh Nhân sự (lương, chấm công…) và 7 lệnh Quy trình mà trang Dự án không cần lúc mở.
describe('Giảm tải lúc khởi động ứng dụng', () => {
  const app = read('App.tsx');
  const appContext = read('context/AppContext.tsx');
  const auth = read('context/AuthContext.tsx');

  it('Dự án / Mua hàng chỉ nạp danh bạ nhân sự (hrm-core), không nạp cả module Nhân sự', () => {
    expect(app).toContain("loadModuleData('hrm-core'),");
    expect(app).not.toMatch(/startsWith\('\/da'\)[\s\S]{0,300}loadModuleData\('hrm'\)/);
    expect(app).not.toMatch(/startsWith\('\/procurement'\)[\s\S]{0,300}loadModuleData\('hrm'\)/);
    const core = appContext.slice(appContext.indexOf("module === 'hrm-core'"), appContext.indexOf("} else if (module === 'hrm') {"));
    expect(core).toContain('hrmSensitiveProjectionService.listEmployees()');
    expect(core).toContain("fetchTableHelper('hrm_positions')");
    expect(core).toContain("fetchTableHelper('org_units')");
    expect(core).not.toMatch(/payroll|attendance|leave|salary|LaborContracts/i);
    expect(appContext).toContain("(module === 'hrm-core' && loadedModulesRef.current.has('hrm'))");
  });

  it('cùng token đăng nhập chỉ xác minh hồ sơ + phân quyền một lần', () => {
    expect(auth).toContain('const sessionVerificationsRef = useRef(new KeyedSingleFlightCoordinator<string, User>());');
    expect(auth).toContain('() => resolveCandidateSession(session, authGateway),');
  });

  it('Dự án tự nạp Quy trình khi cần thay vì nạp sẵn lúc mở trang', () => {
    expect(read('pages/project/MaterialTab.tsx')).toContain('refreshData: refreshWorkflowData } = useWorkflow();');
    expect(read('pages/ProjectDashboard.tsx')).toContain('workflowTemplatesRequestedRef');
  });

  it('ảnh đại diện ở Cài đặt lưu vào kho ảnh, không lưu base64 vào users.avatar', () => {
    const settings = read('pages/Settings.tsx');
    const handler = settings.slice(settings.indexOf('const handleAvatarUpload'), settings.indexOf('// Warehouse Handlers'));
    expect(handler).toContain("supabase.storage.from('avatars').upload(path, file");
    expect(handler).not.toContain('readAsDataURL');
  });
});
