import { describe, expect, it } from 'vitest';
import {
  createHrmPersonnelExportBytes,
  createHrmPersonnelTemplateBytes,
  HRM_PERSONNEL_WORKBOOK_SHEETS,
  mapWorkbookRowsToStaging,
} from '../hrmPersonnelWorkbook';
import { loadXlsx } from '../loadXlsx';

describe('HRM personnel workbook contract', () => {
  it('defines eight data sheets plus one non-import guide sheet', () => {
    expect(HRM_PERSONNEL_WORKBOOK_SHEETS).toHaveLength(8);
    expect(new Set(HRM_PERSONNEL_WORKBOOK_SHEETS.map(sheet => sheet.code)).size).toBe(8);
    expect(HRM_PERSONNEL_WORKBOOK_SHEETS.every(sheet => sheet.headers.includes('employee_code'))).toBe(true);
  });

  it('maps typed rows without using employee names as identifiers', () => {
    const rows = mapWorkbookRowsToStaging('06_Phap_ly_bao_hiem', [{
      record_type: 'IDENTITY_DOCUMENT', employee_code: 'TT194', record_code: 'CCCD-01',
      document_type_code: 'CCCD', document_number: '034194003482', is_primary: true,
      employee_name: 'Tên chỉ để đối chiếu',
    }]);

    expect(rows).toEqual([expect.objectContaining({
      sheetCode: 'LEGAL_INSURANCE', rowNumber: 2, employeeCode: 'TT194',
      recordCode: 'CCCD-01', recordType: 'IDENTITY_DOCUMENT',
      payload: expect.objectContaining({
        documentTypeCode: 'CCCD', documentNumber: '034194003482', isPrimary: true,
      }),
    })]);
    expect(rows[0].payload).not.toHaveProperty('employeeName');
  });

  it('rejects the guide sheet and unknown sheet names from import mapping', () => {
    expect(mapWorkbookRowsToStaging('03_Cong_viec_to_chuc', [{
      record_type: 'WORK_ORGANIZATION_PROJECTION', employee_code: 'TT194',
    }])).toEqual([]);
    expect(() => mapWorkbookRowsToStaging('Huong_dan', [])).toThrow('HRM_WORKBOOK_SHEET_UNSUPPORTED');
    expect(() => mapWorkbookRowsToStaging('Lương', [])).toThrow('HRM_WORKBOOK_SHEET_UNSUPPORTED');
  });

  it('generates a nine-sheet template and an export manifest workbook', async () => {
    const XLSX = await loadXlsx();
    const template = XLSX.read(await createHrmPersonnelTemplateBytes(), { type: 'array' });
    expect(template.SheetNames).toEqual([
      ...HRM_PERSONNEL_WORKBOOK_SHEETS.map(sheet => sheet.name), 'Huong_dan',
    ]);

    const exported = XLSX.read(await createHrmPersonnelExportBytes({
      watermark: 'Dữ liệu mật', generatedAt: '2026-08-28T00:00:00Z',
      employeeCount: 1, manifestHash: 'hash', employees: [{
        overview: { employeeCode: 'TT194', fullName: 'Nguyễn A', status: 'Đang làm việc', summary: {} },
      }],
    }), { type: 'array' });
    const overviewRows = XLSX.utils.sheet_to_json(exported.Sheets['01_Tong_quan']);
    expect(overviewRows).toEqual([expect.objectContaining({
      record_type: 'EMPLOYEE_CORE', employee_code: 'TT194', full_name: 'Nguyễn A',
    })]);
  });
});
