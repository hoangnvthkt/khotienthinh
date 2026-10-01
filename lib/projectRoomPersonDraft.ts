import {
  getProjectPermissionRoom,
  type ProjectPermissionRoomCode,
  type ProjectRoomActionCode,
} from './permissions/projectPermissionRooms';
import {
  canConfigureProjectRoomAction,
  type ProjectRoomEnforcementStatus,
} from './permissions/projectRoomEffectiveActions';
import {
  buildDraftFromTemplate,
  type ProjectRoomTemplateActions,
} from './projectRoomTemplateService';

// Editing one person's Room actions. The server (replace_project_permission_room_members)
// refuses to grant an action that is not fully enforced yet, always keeps the ones the person
// already has, and requires prerequisites; the draft follows the same rules so what the Admin
// sees is what gets saved.

export interface RoomRules {
  actionEnforcement: Partial<Record<ProjectRoomActionCode, ProjectRoomEnforcementStatus>>;
  actionPrerequisites: Partial<Record<ProjectRoomActionCode, ProjectRoomActionCode[]>>;
}

export type RoomRulesByRoom = Partial<Record<ProjectPermissionRoomCode, RoomRules>>;

const NO_RULES: RoomRules = { actionEnforcement: {}, actionPrerequisites: {} };

/** An action with no enforcement status is treated as not configurable, like the old Room screen. */
export const isActionConfigurable = (
  rules: RoomRulesByRoom,
  room: ProjectPermissionRoomCode,
  action: ProjectRoomActionCode,
): boolean => canConfigureProjectRoomAction((rules[room] || NO_RULES).actionEnforcement[action] || 'audit_only');

/** Every action other than "view" needs "view"; the server adds its own prerequisites. */
export const prerequisitesOf = (
  rules: RoomRulesByRoom,
  room: ProjectPermissionRoomCode,
  action: ProjectRoomActionCode,
): ProjectRoomActionCode[] => {
  const fromServer = (rules[room] || NO_RULES).actionPrerequisites[action] || [];
  const needsView = action !== 'view' && Boolean(getProjectPermissionRoom(room)?.actions.includes('view'));
  return [...new Set<ProjectRoomActionCode>([...(needsView ? ['view' as const] : []), ...fromServer])];
};

const actionsOf = (draft: ProjectRoomTemplateActions, room: ProjectPermissionRoomCode): Set<ProjectRoomActionCode> =>
  new Set(draft[room] || []);

/** Actions the person already has that cannot be changed from here. */
const lockedIn = (
  rules: RoomRulesByRoom,
  room: ProjectPermissionRoomCode,
  actions: ReadonlySet<ProjectRoomActionCode>,
): ProjectRoomActionCode[] => [...actions].filter(action => !isActionConfigurable(rules, room, action));

/** Why a box cannot be switched, or null when it can. */
export const toggleBlockedReason = (
  draft: ProjectRoomTemplateActions,
  room: ProjectPermissionRoomCode,
  action: ProjectRoomActionCode,
  rules: RoomRulesByRoom,
): string | null => {
  const actions = actionsOf(draft, room);
  if (!isActionConfigurable(rules, room, action)) return 'Chưa áp dụng đầy đủ';
  if (actions.has(action)) {
    const lockedDependent = lockedIn(rules, room, actions)
      .find(locked => prerequisitesOf(rules, room, locked).includes(action));
    return lockedDependent ? 'Cần cho quyền chưa áp dụng đầy đủ' : null;
  }
  const blockedPrerequisite = prerequisitesOf(rules, room, action)
    .find(required => !actions.has(required) && !isActionConfigurable(rules, room, required));
  return blockedPrerequisite ? 'Cần quyền chưa áp dụng đầy đủ' : null;
};

/** Switch one action; prerequisites follow it on and dependents follow it off. */
export const toggleRoomAction = (
  draft: ProjectRoomTemplateActions,
  room: ProjectPermissionRoomCode,
  action: ProjectRoomActionCode,
  rules: RoomRulesByRoom,
): ProjectRoomTemplateActions => {
  if (toggleBlockedReason(draft, room, action, rules)) return draft;
  const roomActions = getProjectPermissionRoom(room)?.actions || [];
  const next = actionsOf(draft, room);
  if (next.has(action)) {
    next.delete(action);
    for (const other of roomActions) {
      if (next.has(other) && isActionConfigurable(rules, room, other)
        && prerequisitesOf(rules, room, other).includes(action)) next.delete(other);
    }
  } else {
    next.add(action);
    prerequisitesOf(rules, room, action).forEach(required => next.add(required));
  }
  const result: ProjectRoomTemplateActions = { ...draft, [room]: [...next] };
  if (next.size === 0) delete result[room];
  return result;
};

/**
 * Template → draft the server will accept: nothing newly granted that is not fully enforced,
 * nothing the person has that the server would keep anyway is dropped, prerequisites present.
 */
export const buildSafeTemplateDraft = (
  current: ProjectRoomTemplateActions,
  template: ProjectRoomTemplateActions,
  mode: 'merge' | 'replace',
  rules: RoomRulesByRoom,
): { draft: ProjectRoomTemplateActions; skipped: number } => {
  const built = buildDraftFromTemplate(current, template, mode);
  const draft: ProjectRoomTemplateActions = {};
  let skipped = 0;
  const rooms = new Set([...Object.keys(built), ...Object.keys(current)]) as Set<ProjectPermissionRoomCode>;
  for (const room of rooms) {
    const had = actionsOf(current, room);
    const wanted = actionsOf(built, room);
    // Keep what the person has and cannot lose; skip new actions that cannot be granted yet.
    lockedIn(rules, room, had).forEach(action => wanted.add(action));
    for (const action of [...wanted]) {
      if (!had.has(action) && !isActionConfigurable(rules, room, action)) { wanted.delete(action); skipped += 1; }
    }
    // Prerequisites: add them (also for actions the person must keep); drop a new action
    // when one of them cannot be granted.
    for (const action of [...wanted]) {
      const mustKeep = had.has(action) && !isActionConfigurable(rules, room, action);
      for (const required of prerequisitesOf(rules, room, action)) {
        if (wanted.has(required)) continue;
        if (isActionConfigurable(rules, room, required)) wanted.add(required);
        else if (!mustKeep) { wanted.delete(action); skipped += 1; break; }
      }
    }
    if (wanted.size > 0) draft[room] = [...wanted];
  }
  return { draft, skipped };
};
