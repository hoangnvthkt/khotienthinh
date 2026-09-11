import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => {
  const path = join(process.cwd(), ...parts);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

describe('HRM Task 12.2 self-service UI isolation', () => {
  it('loads Check-in from its own current-actor projection, not the HRM batch', () => {
    const page = read('pages', 'hrm', 'CheckIn.tsx');
    const app = read('App.tsx');

    expect(page).toContain('checkInService.loadMyContext()');
    expect(page).not.toContain("useModuleData('hrm')");
    expect(page).not.toContain("loadModuleData('hrm'");
    expect(app).toMatch(/pathname === '\/hrm\/checkin'[\s\S]{0,300}setActiveRealtimeModules\(\[\]\)[\s\S]{0,100}return/);
  });

  it('registers a dedicated personal payslip page that uses no target employee id', () => {
    const app = read('App.tsx');
    const page = read('pages', 'hrm', 'MyPayroll.tsx');

    expect(app).toContain("import('./pages/hrm/MyPayroll')");
    expect(app).toContain('path="my-payroll"');
    expect(page).toContain('hrmSensitiveProjectionService.listMyPayrolls()');
    expect(page).not.toContain('employeeId');
    expect(page).not.toContain("useModuleData('hrm')");
  });
});
