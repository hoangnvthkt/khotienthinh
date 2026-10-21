import type { AppModule } from '../../context/AppContext';
import { getWorkflowWarmupModules } from '../appDataWarmupPolicy';

// Dữ liệu dùng chung (AppContext) một màn cần khi chạy trong tab Trung tâm. Ở router chính AppDataWarmup (App.tsx) nạp theo
// đường dẫn trình duyệt; trong tab, đường dẫn trình duyệt vẫn là /center nên tab tự nạp theo đường dẫn của màn — cùng quy tắc.
export const embedDataModules = (pathname: string): { modules: AppModule[]; workflow: boolean } => {
  const starts = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`);
  // Như AppDataWarmup: màn cá nhân tự đọc dữ liệu của chính mình, không nạp cả khối Nhân sự.
  if (['/my-profile', '/my-payroll', '/hrm/checkin'].some(starts)) return { modules: [], workflow: false };
  if (['/dashboard', '/inventory', '/operations', '/requests', '/material-code-requests', '/reports', '/audit', '/misa-export'].some(starts)) {
    return { modules: ['wms'], workflow: false };
  }
  if (starts('/hrm') || starts('/employee-dashboard') || starts('/org-map') || starts('/ep')) return { modules: ['hrm'], workflow: false };
  if (starts('/da')) return { modules: ['da', 'admin', 'hrm'], workflow: false };
  if (starts('/procurement')) return { modules: ['wms-core', 'admin', 'hrm'], workflow: false };
  if (starts('/rq')) return { modules: ['admin'], workflow: false };
  if (starts('/wf')) return { modules: getWorkflowWarmupModules(pathname) as AppModule[], workflow: true };
  if (starts('/ts')) return { modules: ['ts'], workflow: false };
  if (starts('/settings')) return { modules: ['admin'], workflow: false };
  return { modules: [], workflow: false };
};
