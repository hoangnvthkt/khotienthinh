import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('G4 material plan UI contract', () => {
  it('connects saved plans to strict save, revision and conversion commands', () => {
    const workspace = read('components/project/material/BoqMaterialPlanningWorkspace.tsx');
    expect(workspace).toContain('materialPlanService.list');
    expect(workspace).toContain('materialPlanService.get');
    expect(workspace).toContain('materialPlanService.save');
    expect(workspace).toContain('materialPlanService.convert');
    expect(workspace).toContain('buildMaterialPlanDraft');
    expect(workspace).toContain('payloadSchemaVersion: 1');
  });

  it('keeps plan loading, empty, denied and failure states distinct', () => {
    const workspace = read('components/project/material/BoqMaterialPlanningWorkspace.tsx');
    expect(workspace).toContain('Đang tải kế hoạch đã lưu');
    expect(workspace).toContain('Chưa có kế hoạch đã lưu');
    expect(workspace).toContain('Bạn chưa có quyền xem kế hoạch đã lưu');
    expect(workspace).toContain('Không thể tải kế hoạch đã lưu');
  });

  it('shows job-oriented save metadata and keeps the MR approval boundary explicit', () => {
    const preview = read('components/project/material/BoqMaterialPlanPreview.tsx');
    const detail = read('components/project/material/MaterialPlanDetailPanel.tsx');
    expect(preview).toContain('Tên kế hoạch');
    expect(preview).toContain('Khoảng thời gian');
    expect(preview).toContain('Lưu kế hoạch');
    expect(detail).toContain('Tạo MR nháp');
    expect(detail).toContain('MR vẫn cần được gửi duyệt theo quy trình hiện hành');
    expect(detail).toContain('Mở MR để gửi duyệt');
    expect(detail).toContain('Lịch sử phiên bản');
  });

  it('passes permissions, warehouse context and request navigation from MaterialTab', () => {
    const materialTab = read('pages/project/MaterialTab.tsx');
    expect(materialTab).toContain('canManage={canEditPlanning}');
    expect(materialTab).toContain('defaultSiteWarehouseId={defaultSiteWarehouseId}');
    expect(materialTab).toContain('onOpenRequest={openMaterialPlanRequest}');
  });
});
