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
});
