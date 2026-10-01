import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

// The person-first screen replaced the Room cards + drawer. Each case below is something the old
// screen did that must still be possible, so no permission can be lost in the switch.
describe('project permission Rooms UI (person-first)', () => {
  it('retires the old Room-by-Room editor', () => {
    const tab = read('pages/project/ProjectPermissionsTab.tsx');
    expect(tab).not.toContain('ProjectPermissionRoomsPanel');
    expect(tab).not.toContain('ProjectPermissionRoomDrawer');
    expect(tab).toContain('<ProjectPersonRoomEditor');
    expect(tab).toContain('<ProjectRoomOverview');
    expect(tab).toContain('<ProjectRoomBulkApply');
    expect(tab).toContain('<ProjectSensitiveAccessRoomCard');
  });

  it('still shows every Room with members, counts and missing approvers, searchable by group', () => {
    const overview = read('components/project/permissions/ProjectRoomOverview.tsx');
    expect(overview).toContain('userAvatar');
    expect(overview).toContain('thành viên');
    expect(overview).toContain('missingRequiredActions');
    expect(overview).toContain('actionCounts');
    expect(overview).toContain('fallbackOnlyUserCount');
    expect(overview).toContain('searchQuery');
    expect(overview).toContain('selectedGroup');
    expect(overview).toContain('membersByRoom');
    expect(overview).toContain('onEditPerson');
    expect(overview).toContain("room.roomCode === 'weekly_progress'");
    expect(overview).toContain("['edit', 'confirm']");
  });

  it('keeps edits in a local draft, saves once, and can be cancelled', () => {
    const editor = read('components/project/permissions/ProjectPersonRoomEditor.tsx');
    expect(editor).toContain('setDraft');
    expect(editor).toContain("mode: 'exact'");
    expect(editor).toContain('Hủy thay đổi');
    expect(editor).toContain('Lưu quyền cho');
    expect(editor).toContain('PROJECT_PERMISSION_ROOMS.map');
  });

  it('locks actions that are not fully applied and identifies legacy PBAC exceptions', () => {
    const editor = read('components/project/permissions/ProjectPersonRoomEditor.tsx');
    const draft = read('lib/projectRoomPersonDraft.ts');
    expect(draft).toContain('canConfigureProjectRoomAction');
    expect(draft).toContain('Chưa áp dụng đầy đủ');
    expect(editor).toContain('toggleBlockedReason');
    expect(editor).toContain('disabled={Boolean(blocked)');
    expect(editor).toContain('PBAC ngoại lệ');
    expect(editor).toContain('legacyPermissionCodes');
    expect(editor).toContain('Backfill từ PBAC');
    expect(editor).toContain('buildSafeTemplateDraft');
  });

  it('counts only people who can still act and lets leftover rows be removed', () => {
    const overview = read('components/project/permissions/ProjectRoomOverview.tsx');
    const tab = read('pages/project/ProjectPermissionsTab.tsx');
    expect(overview).toContain('eligibleStaffIds');
    expect(overview).toContain('Gỡ dòng cũ');
    expect(overview).toContain('dòng cũ không còn hiệu lực');
    expect(tab).toContain('listStaffCandidateIds');
    expect(tab).toContain('replaceMembers');
  });

  it('can still change several people at once, with the same safety rules', () => {
    const bulk = read('components/project/permissions/ProjectRoomBulkApply.tsx');
    expect(bulk).toContain('buildSafeTemplateDraft');
    expect(bulk).toContain("mode: 'exact'");
    expect(bulk).toContain("'clear'");
    expect(bulk).toContain('useConfirm');
  });

  it('loads Rooms, members and enforcement rules in one overview', () => {
    const service = read('lib/projectPermissionRoomService.ts');
    expect(service).toContain('listOverview');
    expect(service).toContain('membersByRoom');
    expect(service).toContain('listStaffCandidateIds');
  });

  it('uses the progress-specific lock label without changing other confirmation labels', async () => {
    const { getProjectPermissionRoomActionLabel } = await import('../permissions/projectPermissionRooms');

    expect(getProjectPermissionRoomActionLabel('weekly_progress', 'edit')).toBe('Sửa/Nhập liệu');
    expect(getProjectPermissionRoomActionLabel('weekly_progress', 'confirm')).toBe('Chốt/Mở chốt');
    expect(getProjectPermissionRoomActionLabel('material_po', 'edit')).toBe('Sửa');
    expect(getProjectPermissionRoomActionLabel('material_po', 'confirm')).toBe('Xác nhận');
  });
});
