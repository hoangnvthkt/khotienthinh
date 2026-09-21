import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('G3 BOQ material planning UI contract', () => {
  it('mounts S01 before the reference forecast and disables its direct PO action', () => {
    const materialTab = read('pages/project/MaterialTab.tsx');
    expect(materialTab).toContain('BoqMaterialPlanningWorkspace');
    expect(materialTab.indexOf('<BoqMaterialPlanningWorkspace')).toBeLessThan(
      materialTab.indexOf('<MaterialPlanningPanel'),
    );
    expect(materialTab).toContain('Dự báo tham khảo');
    expect(materialTab).toContain('allowCreatePo={false}');
    expect(materialTab).toContain('canViewPo ? (');
  });

  it('keeps loading, denied, failed and empty reads visibly distinct', () => {
    const workspace = read('components/project/material/BoqMaterialPlanningWorkspace.tsx');
    expect(workspace).toContain('Đang tải cân đối BOQ');
    expect(workspace).toContain('Bạn chưa có quyền xem cân đối BOQ');
    expect(workspace).toContain('Không thể tải cân đối BOQ');
    expect(workspace).toContain('Không có dòng BOQ phù hợp');
    expect(workspace).toContain('Thử lại');
  });

  it('exposes accessible tree and draft controls while disabling unknown lines', () => {
    const tree = read('components/project/material/BoqMaterialTree.tsx');
    expect(tree).toContain('aria-expanded');
    expect(tree).toContain('aria-label={`Chọn ${line.itemName}`}');
    expect(tree).toContain('disabled={!line.balance.selectable}');
    expect(tree).toContain('aria-label={`Số lượng dự kiến cho ${line.itemName}`}');
    expect(tree).toContain('aria-label={`Ngày cần cho ${line.itemName}`}');
    expect(tree).toContain('aria-label={`Nơi nhận cho ${line.itemName}`}');
  });

  it('renders price only behind the server capability and has no save or request command', () => {
    const tree = read('components/project/material/BoqMaterialTree.tsx');
    const workspace = read('components/project/material/BoqMaterialPlanningWorkspace.tsx');
    const preview = read('components/project/material/BoqMaterialPlanPreview.tsx');
    expect(tree).toContain('canViewPrice &&');
    expect(workspace).toContain('Xem preview');
    expect(preview).toContain('Chưa lưu kế hoạch / chưa tạo MR');
    expect(`${workspace}\n${preview}`).not.toMatch(/syncFrom|create_material_request|onCreateRequest|savePlan|submitPlan/);
  });
});
