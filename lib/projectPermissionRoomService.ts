import type { ProjectStaff } from '../types';
import { supabase } from './supabase';
import {
  getProjectPermissionRoom,
  isRoomActionAllowed,
  PROJECT_ROOM_ACTION_CODES,
  type ProjectPermissionRoomCode,
  type ProjectRoomActionCode,
} from './permissions/projectPermissionRooms';

export interface ReplaceProjectRoomMemberInput {
  staffId: string;
  actionCodes: ProjectRoomActionCode[];
}

export interface ProjectPermissionRoomMember {
  roomMemberId: string;
  staffId: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  positionName?: string | null;
  constructionSiteId?: string | null;
  actionCodes: ProjectRoomActionCode[];
  isActive: boolean;
}

export interface ProjectPermissionRoomSummary {
  roomCode: ProjectPermissionRoomCode;
  groupCode: string;
  roomName: string;
  description: string;
  allowedActions: ProjectRoomActionCode[];
  requiredActions: ProjectRoomActionCode[];
  memberCount: number;
  memberPreview: Array<{ userId: string; userName: string; userAvatar?: string | null }>;
  actionCounts: Partial<Record<ProjectRoomActionCode, number>>;
  missingRequiredActions: ProjectRoomActionCode[];
}

export interface ProjectRoomStaffCandidate {
  staffId: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  positionName?: string | null;
  constructionSiteId?: string | null;
  isRoomMember: boolean;
  disabledReason?: string | null;
}

type RoomRow = {
  code: ProjectPermissionRoomCode;
  group_code: string;
  name: string;
  description: string;
  allowed_actions: string[];
  required_actions: string[];
};

const asRoomActionCodes = (values: unknown): ProjectRoomActionCode[] =>
  Array.isArray(values)
    ? values.filter((value): value is ProjectRoomActionCode =>
      typeof value === 'string' && PROJECT_ROOM_ACTION_CODES.includes(value as ProjectRoomActionCode))
    : [];

const assertRoomAction = (roomCode: ProjectPermissionRoomCode, actionCode: ProjectRoomActionCode) => {
  if (!isRoomActionAllowed(roomCode, actionCode)) {
    throw new Error(`Quyền "${actionCode}" không hợp lệ trong Room "${roomCode}".`);
  }
};

const ensureRoomCode = (roomCode: string): ProjectPermissionRoomCode => {
  if (!getProjectPermissionRoom(roomCode as ProjectPermissionRoomCode)) {
    throw new Error(`Room "${roomCode}" không tồn tại.`);
  }
  return roomCode as ProjectPermissionRoomCode;
};

const toRoomMember = (row: any): ProjectPermissionRoomMember | null => {
  if (!row?.member_id || !row?.project_staff_id || !row?.user_id) return null;
  return {
    roomMemberId: row.member_id,
    staffId: row.project_staff_id,
    userId: row.user_id,
    userName: row.user_name || 'Chưa có tên',
    userAvatar: row.user_avatar ?? null,
    positionName: row.position_name ?? null,
    constructionSiteId: row.construction_site_id ?? null,
    actionCodes: asRoomActionCodes(row.action_codes),
    isActive: true,
  };
};

const getRoomRows = async (
  projectId: string,
  constructionSiteId: string | null | undefined,
  roomCode: ProjectPermissionRoomCode,
) => {
  const { data, error } = await supabase.rpc('get_project_permission_room', {
    p_project_id: projectId,
    p_construction_site_id: constructionSiteId || null,
    p_room_code: roomCode,
  });
  if (error) throw error;
  return data || [];
};

export const projectPermissionRoomService = {
  async listRooms(
    projectId: string,
    constructionSiteId?: string | null,
  ): Promise<ProjectPermissionRoomSummary[]> {
    const { data, error } = await supabase.rpc('list_project_permission_rooms');
    if (error) throw error;

    const rooms = (data || []) as RoomRow[];
    const memberRows = await Promise.all(rooms.map(room =>
      getRoomRows(projectId, constructionSiteId, ensureRoomCode(room.code)),
    ));

    return rooms.map((room, index) => {
      const members = memberRows[index]
        .map(toRoomMember)
        .filter((member): member is ProjectPermissionRoomMember => Boolean(member));
      const actionCounts: Partial<Record<ProjectRoomActionCode, number>> = {};
      members.forEach(member => {
        member.actionCodes.forEach(action => { actionCounts[action] = (actionCounts[action] || 0) + 1; });
      });
      const requiredActions = asRoomActionCodes(room.required_actions);

      return {
        roomCode: ensureRoomCode(room.code),
        groupCode: room.group_code,
        roomName: room.name,
        description: room.description,
        allowedActions: asRoomActionCodes(room.allowed_actions),
        requiredActions,
        memberCount: members.length,
        memberPreview: members.slice(0, 5).map(member => ({
          userId: member.userId,
          userName: member.userName,
          userAvatar: member.userAvatar,
        })),
        actionCounts,
        missingRequiredActions: requiredActions.filter(action => !actionCounts[action]),
      };
    });
  },

  async getRoom(
    projectId: string,
    constructionSiteId: string | null | undefined,
    roomCode: ProjectPermissionRoomCode,
  ): Promise<ProjectPermissionRoomMember[]> {
    ensureRoomCode(roomCode);
    return (await getRoomRows(projectId, constructionSiteId, roomCode))
      .map(toRoomMember)
      .filter((member): member is ProjectPermissionRoomMember => Boolean(member));
  },

  async listCandidates(
    projectId: string,
    constructionSiteId: string | null | undefined,
    roomCode: ProjectPermissionRoomCode,
  ): Promise<ProjectRoomStaffCandidate[]> {
    ensureRoomCode(roomCode);
    const [{ data, error }, roomMembers] = await Promise.all([
      supabase.rpc('list_project_room_staff_candidates', {
        p_project_id: projectId,
        p_construction_site_id: constructionSiteId || null,
      }),
      this.getRoom(projectId, constructionSiteId, roomCode),
    ]);
    if (error) throw error;
    const memberIds = new Set(roomMembers.map(member => member.staffId));

    return (data || []).map((row: any): ProjectRoomStaffCandidate => ({
      staffId: row.project_staff_id,
      userId: row.user_id,
      userName: row.user_name || 'Chưa có tên',
      userAvatar: row.user_avatar ?? null,
      positionName: row.position_name ?? null,
      constructionSiteId: row.construction_site_id ?? null,
      isRoomMember: memberIds.has(row.project_staff_id),
      disabledReason: null,
    }));
  },

  async replaceMembers(
    projectId: string,
    constructionSiteId: string | null | undefined,
    roomCode: ProjectPermissionRoomCode,
    members: ReplaceProjectRoomMemberInput[],
  ): Promise<void> {
    ensureRoomCode(roomCode);
    members.forEach(member => member.actionCodes.forEach(action => assertRoomAction(roomCode, action)));
    const { error } = await supabase.rpc('replace_project_permission_room_members', {
      p_project_id: projectId,
      p_construction_site_id: constructionSiteId || null,
      p_room_code: roomCode,
      p_members: members.map(member => ({
        project_staff_id: member.staffId,
        action_codes: member.actionCodes,
      })),
    });
    if (error) throw error;
  },

  async listRecipients(
    projectId: string,
    constructionSiteId: string | null | undefined,
    roomCode: ProjectPermissionRoomCode,
    actionCode: ProjectRoomActionCode,
  ): Promise<ProjectStaff[]> {
    ensureRoomCode(roomCode);
    assertRoomAction(roomCode, actionCode);
    const { data, error } = await supabase.rpc('list_project_room_action_recipients', {
      p_project_id: projectId,
      p_construction_site_id: constructionSiteId || null,
      p_room_code: roomCode,
      p_action_code: actionCode,
    });
    if (error) throw error;
    return (data || []).map((row: any): ProjectStaff => ({
      id: row.project_staff_id,
      projectId,
      constructionSiteId: constructionSiteId || null,
      userId: row.user_id,
      userName: row.user_name,
      userAvatar: row.user_avatar ?? undefined,
      positionId: '',
      sortOrder: 0,
    }));
  },

  async hasAction(
    userId: string,
    projectId: string,
    constructionSiteId: string | null | undefined,
    roomCode: ProjectPermissionRoomCode,
    actionCode: ProjectRoomActionCode,
  ): Promise<boolean> {
    ensureRoomCode(roomCode);
    assertRoomAction(roomCode, actionCode);
    const { data, error } = await supabase.rpc('project_user_has_room_action', {
      p_project_id: projectId,
      p_construction_site_id: constructionSiteId || null,
      p_room_code: roomCode,
      p_action_code: actionCode,
      p_user_id: userId,
    });
    if (error) throw error;
    return Boolean(data);
  },
};
