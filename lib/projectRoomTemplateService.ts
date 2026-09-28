import { supabase } from './supabase';
import type { ProjectPermissionRoomCode, ProjectRoomActionCode } from './permissions/projectPermissionRooms';

// Role templates for project Rooms: a bundle of Room actions an Admin applies
// to one project staff member at a time (server: apply_project_room_template).

export type ProjectRoomTemplateActions = Partial<Record<ProjectPermissionRoomCode, ProjectRoomActionCode[]>>;

export interface ProjectRoomTemplate {
  code: string;
  name: string;
  description: string | null;
  roomActions: ProjectRoomTemplateActions;
  suggestedPositionIds: string[];
  sortOrder: number;
  isActive: boolean;
  updatedAt?: string;
}

export type ProjectRoomTemplateMode = 'merge' | 'replace' | 'exact';

export interface ProjectRoomTemplateChange {
  roomCode: ProjectPermissionRoomCode;
  before: ProjectRoomActionCode[];
  after: ProjectRoomActionCode[];
}

const toTemplate = (row: any): ProjectRoomTemplate => ({
  code: row.code,
  name: row.name,
  description: row.description,
  roomActions: row.room_actions || {},
  suggestedPositionIds: row.suggested_position_ids || [],
  sortOrder: row.sort_order ?? 100,
  isActive: row.is_active !== false,
  updatedAt: row.updated_at,
});

export const projectRoomTemplateService = {
  async list(): Promise<ProjectRoomTemplate[]> {
    const { data, error } = await supabase
      .from('project_room_templates')
      .select('code,name,description,room_actions,suggested_position_ids,sort_order,is_active,updated_at')
      .order('sort_order')
      .limit(200);
    if (error) throw error;
    return (data || []).map(toTemplate);
  },

  async save(template: Omit<ProjectRoomTemplate, 'sortOrder' | 'updatedAt'>): Promise<ProjectRoomTemplate> {
    const { data, error } = await supabase.rpc('save_project_room_template', {
      p_code: template.code,
      p_name: template.name,
      p_description: template.description,
      p_room_actions: template.roomActions,
      p_suggested_position_ids: template.suggestedPositionIds,
      p_is_active: template.isActive,
    });
    if (error) throw error;
    return toTemplate(data);
  },

  /** A project member's current Room actions. */
  async getStaffRoomActions(projectId: string, constructionSiteId: string | null | undefined, staffId: string): Promise<ProjectRoomTemplateActions> {
    const { data, error } = await supabase.rpc('get_project_staff_room_actions', {
      p_project_id: projectId,
      p_construction_site_id: constructionSiteId || null,
      p_project_staff_id: staffId,
    });
    if (error) throw error;
    return (data || {}) as ProjectRoomTemplateActions;
  },

  /**
   * Preview (dryRun) or apply Room actions to one project member. With
   * mode 'exact' the person ends up with exactly roomActions (a template
   * adjusted for them, or a hand-made set when templateCode is null).
   */
  async apply(input: {
    projectId: string;
    constructionSiteId?: string | null;
    staffId: string;
    templateCode: string | null;
    mode: ProjectRoomTemplateMode;
    dryRun: boolean;
    roomActions?: ProjectRoomTemplateActions;
  }): Promise<ProjectRoomTemplateChange[]> {
    const { data, error } = await supabase.rpc('apply_project_room_template', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId || null,
      p_project_staff_id: input.staffId,
      p_template_code: input.templateCode,
      p_mode: input.mode,
      p_dry_run: input.dryRun,
      p_room_actions: input.roomActions ?? null,
    });
    if (error) throw error;
    return ((data as any)?.changes || []) as ProjectRoomTemplateChange[];
  },
};

/** Templates suggested for a position, best first; the rest follow. */
export const orderTemplatesForPosition = (
  templates: readonly ProjectRoomTemplate[],
  positionId: string | null | undefined,
): Array<ProjectRoomTemplate & { suggested: boolean }> => templates
  .filter(template => template.isActive)
  .map(template => ({ ...template, suggested: Boolean(positionId && template.suggestedPositionIds.includes(positionId)) }))
  .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.sortOrder - b.sortOrder);

/** Starting point of the editable set: template added to or replacing the current actions. */
export const buildDraftFromTemplate = (
  current: ProjectRoomTemplateActions,
  template: ProjectRoomTemplateActions,
  mode: 'merge' | 'replace',
): ProjectRoomTemplateActions => {
  if (mode === 'replace') return structuredClone(template);
  const draft: ProjectRoomTemplateActions = structuredClone(current);
  for (const [room, actions] of Object.entries(template) as Array<[keyof ProjectRoomTemplateActions, string[]]>) {
    draft[room] = [...new Set([...(draft[room] || []), ...actions])] as any;
  }
  return draft;
};

/** Room-level differences between two action sets. */
export const diffRoomActions = (before: ProjectRoomTemplateActions, after: ProjectRoomTemplateActions) => {
  const rooms = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof ProjectRoomTemplateActions>;
  return [...rooms].map(room => {
    const was = new Set(before[room] || []);
    const now = new Set(after[room] || []);
    return {
      roomCode: room,
      added: [...now].filter(action => !was.has(action)),
      removed: [...was].filter(action => !now.has(action)),
    };
  }).filter(change => change.added.length > 0 || change.removed.length > 0);
};
