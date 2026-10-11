import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('G3 BOQ material planning UI contract', () => {
  // 12/10/2026 (P1 dọn tab Vật tư): tab Kế hoạch vật tư dùng kế hoạch vật tư tuần/tháng mới; cân đối BOQ (S01) và
  // dự báo tham khảo không còn gắn trong Dự án (0 kế hoạch đã lưu). Thành phần vẫn giữ để dùng lại nếu cần.
  it('Kế hoạch vật tư trong Dự án dùng kế hoạch tuần/tháng mới, không còn S01 + dự báo tham khảo', () => {
    const materialTab = read('pages/project/MaterialTab.tsx');
    expect(materialTab).toContain('<WorkPlanTab');
    expect(materialTab).toContain('materialOnly');
    expect(materialTab).not.toContain('<BoqMaterialPlanningWorkspace');
    expect(materialTab).not.toContain('<MaterialPlanningPanel');
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

  it('renders price only behind the server capability and keeps direct PO creation out', () => {
    const tree = read('components/project/material/BoqMaterialTree.tsx');
    const workspace = read('components/project/material/BoqMaterialPlanningWorkspace.tsx');
    const preview = read('components/project/material/BoqMaterialPlanPreview.tsx');
    expect(tree).toContain('canViewPrice &&');
    expect(workspace).toContain('Xem preview');
    expect(preview).toContain('Chưa tạo MR');
    expect(`${workspace}\n${preview}`).not.toMatch(/syncFrom|create_material_request|onCreatePo/);
  });
});
