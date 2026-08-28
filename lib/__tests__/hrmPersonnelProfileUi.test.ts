import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'pages/ep/HrmPersonnelProfile.tsx'), 'utf8');
const app = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');

describe('HRM personnel profile 8-tab UI', () => {
  it('defines exactly the eight governed profile sections', () => {
    const keys = [
      'overview', 'personal_contact', 'work_organization', 'attendance_leave',
      'contracts_employment', 'legal_insurance', 'compensation_tax_bank',
      'qualifications_documents',
    ];
    keys.forEach(key => expect(page).toContain(`key: '${key}'`));
    expect(app).toContain("import('./pages/ep/HrmPersonnelProfile')");
  });

  it('renders separate permission, loading, empty and error states', () => {
    expect(page).toContain('Không có quyền xem');
    expect(page).toContain('Đang tải hồ sơ');
    expect(page).toContain('Chưa có dữ liệu');
    expect(page).toContain('Không tải được phần hồ sơ');
  });

  it('loads detail payloads only through the selected section callback', () => {
    expect(page).toContain('hrmPersonnelProfileService.getOverview(employeeId)');
    expect(page).toContain('hrmPersonnelProfileService.getSection(section, employeeId)');
    expect(page).not.toContain("useModuleData('ts')");
    expect(page).not.toContain("useModuleData('wms')");
  });
});

