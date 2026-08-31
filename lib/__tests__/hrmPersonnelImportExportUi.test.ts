import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(join(
  process.cwd(), 'components/hrm/HrmPersonnelImportExportPanel.tsx',
), 'utf8');
const employeesPage = readFileSync(join(process.cwd(), 'pages/hrm/Employees.tsx'), 'utf8');

describe('HRM personnel import/export UI', () => {
  it('uses governed permissions and the private dry-run service', () => {
    expect(component).toContain("canPerform(user, 'hrm.employee.import')");
    expect(component).toContain("canPerform(user, 'hrm.employee.export')");
    expect(component).toContain('uploadAndPreview');
    expect(component).toContain('preview.errorRows !== 0');
    expect(component).toContain('preview.fingerprint');
  });

  it('shows only safe error coordinates and requires an audit reason', () => {
    expect(component).toContain('error.sheetCode');
    expect(component).toContain('error.rowNumber');
    expect(component).toContain('error.column');
    expect(component).toContain('error.errorCode');
    expect(component).toContain('reason.trim().length < 10');
  });

  it('replaces the direct legacy employee import/export controls', () => {
    expect(employeesPage).toContain('<HrmPersonnelImportExportPanel');
    expect(employeesPage).not.toContain('applyImportChanges');
    expect(employeesPage).not.toContain('handleExportEmployees');
    expect(employeesPage).not.toContain('parseExcelRows');
  });
});
