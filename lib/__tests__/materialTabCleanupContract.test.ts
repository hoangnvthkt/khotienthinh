import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Dự án → Vật tư sau khi dọn (P1, 12/10/2026)', () => {
  const materialTab = read('pages/project/MaterialTab.tsx');
  const summary = read('components/project/material/MaterialSummaryTab.tsx');
  const header = read('components/project/material/MaterialTabHeader.tsx');

  it('chỉ còn 4 tab con theo thứ tự công việc; link cũ tới tab đã gộp mở đúng chỗ mới', () => {
    expect(read('lib/projectMaterialTabUtils.ts')).toContain("export const MATERIAL_TAB_ORDER: ProjectMaterialTabKey[] = ['summary', 'request', 'planning', 'boq'];");
    expect(materialTab).toContain('MATERIAL_TAB_ORDER');
    expect(materialTab).toContain("{ waste: 'summary', dashboard: 'summary', custom: 'request' }");
    expect(materialTab).not.toContain('<MaterialWasteTab');
    expect(materialTab).not.toContain('<MaterialDashboardTab');
    expect(materialTab).not.toContain('<BoqReconciliationPanel');
  });

  it('Theo dõi: bỏ bảng đối chiếu trùng Bảng điều khiển, có "Cần chú ý" và link Bảng điều khiển đúng dự án', () => {
    expect(summary).not.toContain('Đối chiếu BOQ với sử dụng thực tế');
    expect(summary).toContain('Cần chú ý');
    expect(summary).toContain('Nhập – xuất – tồn theo chứng từ');
    expect(materialTab).toContain("board: 'materials', project: projectId");
  });

  it('đầu tab một hàng, không còn tiêu đề "Quản lý vật tư" và nút AI', () => {
    expect(header).not.toContain('Quản lý vật tư');
    expect(header).not.toContain('AiInsightPanel');
    expect(header).toContain('role="tablist"');
  });
});
