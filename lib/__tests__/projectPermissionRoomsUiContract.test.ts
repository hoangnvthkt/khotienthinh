import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('project permission Rooms UI', () => {
  it('renders Room cards with searchable summaries', () => {
    const panelSource = read('components/project/permissions/ProjectPermissionRoomsPanel.tsx');
    const cardSource = read('components/project/permissions/ProjectPermissionRoomCard.tsx');

    expect(panelSource).toContain('projectPermissionRoomService.listRooms');
    expect(panelSource).toContain('ProjectPermissionRoomCard');
    expect(panelSource).toContain('searchQuery');
    expect(panelSource).toContain('selectedGroup');
    expect(cardSource).toContain('memberPreview');
    expect(cardSource).toContain('missingRequiredActions');
    expect(cardSource).toContain('actionCounts');
  });

  it('keeps edits in a local draft and saves the whole Room once', () => {
    const drawerSource = read('components/project/permissions/ProjectPermissionRoomDrawer.tsx');

    expect(drawerSource).toContain('draftMembers');
    expect(drawerSource).toContain('selectedStaffIds');
    expect(drawerSource).toContain('toggleMemberAction');
    expect(drawerSource).toContain('applyBulkAction');
    expect(drawerSource).toContain('removeSelectedMembers');
    expect(drawerSource).toContain('projectPermissionRoomService.replaceMembers');
    expect(drawerSource).toContain('Hủy thay đổi');
    expect(drawerSource).toContain('Lưu thay đổi');
  });

  it('locks audit-only actions and identifies legacy PBAC exceptions', () => {
    const drawerSource = read('components/project/permissions/ProjectPermissionRoomDrawer.tsx');
    const cardSource = read('components/project/permissions/ProjectPermissionRoomCard.tsx');

    expect(drawerSource).toContain('canConfigureProjectRoomAction');
    expect(drawerSource).toContain('Chưa áp dụng đầy đủ');
    expect(drawerSource).toContain('PBAC ngoại lệ');
    expect(drawerSource).toContain('candidate.legacyPermissionCodes');
    expect(drawerSource).toContain('disabled');
    expect(cardSource).toContain('fallbackOnlyUserCount');
  });

  it('uses the progress-specific lock label without changing other confirmation labels', async () => {
    const { getProjectPermissionRoomActionLabel } = await import('../permissions/projectPermissionRooms');

    expect(getProjectPermissionRoomActionLabel('weekly_progress', 'edit')).toBe('Sửa/Nhập liệu');
    expect(getProjectPermissionRoomActionLabel('weekly_progress', 'confirm')).toBe('Chốt/Mở chốt');
    expect(getProjectPermissionRoomActionLabel('material_po', 'edit')).toBe('Sửa');
    expect(getProjectPermissionRoomActionLabel('material_po', 'confirm')).toBe('Xác nhận');
  });

  it('shows edit counts as a business permission for weekly progress cards', () => {
    const cardSource = read('components/project/permissions/ProjectPermissionRoomCard.tsx');
    expect(cardSource).toContain("room.roomCode === 'weekly_progress'");
    expect(cardSource).toContain("['edit', 'confirm']");
  });
});
