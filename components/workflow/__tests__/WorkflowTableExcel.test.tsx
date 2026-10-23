import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorkflowTableExcel, { WorkflowTableExportButton } from '../WorkflowTableExcel';

const COLUMNS = ['Tên vật tư', 'ĐVT', 'SL đề xuất'];

describe('WorkflowTableExcel buttons', () => {
  it('read-only table: export is enabled only when the table has data', () => {
    const withData = renderToStaticMarkup(<WorkflowTableExportButton label="Bảng kê vật tư" columns={COLUMNS} rows={[['Dầu', 'Thùng', '1']]} />);
    expect(withData).toContain('Xuất Excel');
    expect(withData).not.toContain('disabled=""');
    const empty = renderToStaticMarkup(<WorkflowTableExportButton label="Bảng kê vật tư" columns={COLUMNS} rows={[['', '', '']]} />);
    expect(empty).toContain('disabled=""');
  });

  it('edit table: template + import always, export only when there is data', () => {
    const empty = renderToStaticMarkup(<WorkflowTableExcel label="Bảng kê vật tư" columns={COLUMNS} rows={[['', '', '']]} onImport={() => {}} />);
    expect(empty).toContain('Tải mẫu Excel');
    expect(empty).toContain('Nhập từ Excel');
    expect(empty).not.toContain('Xuất Excel');
    const filled = renderToStaticMarkup(<WorkflowTableExcel label="Bảng kê vật tư" columns={COLUMNS} rows={[['Dầu', 'Thùng', '1']]} onImport={() => {}} />);
    expect(filled).toContain('Xuất Excel');
  });
});
