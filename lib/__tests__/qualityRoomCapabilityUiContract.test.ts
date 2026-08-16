import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages/project/QualityTab.tsx'), 'utf8');

describe('Quality Room capability UI', () => {
  it('loads effective Quality Room actions before business data', () => {
    expect(source).toContain('projectPermissionRoomService.listMyActions');
    expect(source).toContain("roomCode === 'quality'");
    expect(source).toContain('Đang tải quyền Room Chất lượng');
    expect(source).toContain('Bạn không có quyền xem Room Chất lượng');
  });

  it('uses Quality Room actions instead of legacy manage and approve checks', () => {
    expect(source).toContain('qualityCapabilities.canEdit');
    expect(source).toContain('qualityCapabilities.canSubmit');
    expect(source).toContain('getQualityChecklistCapabilities');
    expect(source).not.toContain('canReviewQualityChecklist');
    expect(source).not.toContain('requireProjectPermission');
  });

  it('uses project and site scoped storage paths', () => {
    expect(source).toContain('`quality/${projectId}/${folderSiteId}/${recordId}/');
  });
});
