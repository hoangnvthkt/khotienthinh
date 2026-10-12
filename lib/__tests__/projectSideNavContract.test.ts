import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Dự án: menu dạng cột (P2, 12/10/2026)', () => {
  const nav = read('components/project/ProjectSideNav.tsx');
  const dashboard = read('pages/ProjectDashboard.tsx');
  const materialTab = read('pages/project/MaterialTab.tsx');

  it('nhóm theo công việc; tab chưa xếp nhóm vẫn hiện ở "Khác"', () => {
    for (const label of ['Điều hành', 'Thi công', 'Vật tư', 'Chất lượng & An toàn', 'Hồ sơ', 'Thiết lập']) expect(nav).toContain(`label: '${label}'`);
    expect(nav).toContain("keys: ['gantt', 'work_plan', 'weekly_progress', 'dailylog']");
    expect(nav).toContain("label: 'Khác'");
  });

  it('màn rộng là cột trái cố định, màn hẹp là ngăn kéo trên nút chat', () => {
    expect(nav).toContain('lg:sticky');
    expect(nav).toContain('fixed inset-0 z-[999] lg:hidden');
    expect(dashboard).toContain('lg:grid-cols-[15rem_minmax(0,1fr)]');
    expect(dashboard).not.toContain('{/* Overview Sub-tabs */}');
  });

  it('mục con Vật tư lấy từ MaterialTab (đúng quyền thực tế) và giữ ?materialTab= khớp tab đang mở', () => {
    expect(dashboard).toContain('onSubNavChange={setMaterialNav}');
    expect(dashboard).toContain("buildProjectDashboardPath(selectedProjectId, siteId, 'material', { materialTab })");
    expect(materialTab).toContain("params.set('materialTab', activeSubTab);");
    // Link cũ tới PO / Mua nóng vẫn được chuyển sang Mua hàng, không bị ghi đè.
    expect(materialTab).toContain("if (MOVED_TO_PROCUREMENT_TABS.has(params.get('materialTab') as ProjectMaterialTabKey)) return;");
  });
});
