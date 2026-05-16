import { WorkGroup, WorkGroupMember, WorkGroupMemberRole, WorkGroupWithMembers } from '../types';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

const GROUP_TABLE = 'work_groups';
const MEMBER_TABLE = 'work_group_members';

type WorkGroupInput = {
  code?: string;
  name: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
};

type ListOptions = {
  activeOnly?: boolean;
  memberActiveOnly?: boolean;
};

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const normalizeCode = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 48) || crypto.randomUUID().slice(0, 8);

const mapGroup = (row: any): WorkGroup => ({
  ...fromDb(row),
  sortOrder: row.sort_order ?? row.sortOrder ?? 0,
  isActive: row.is_active ?? row.isActive ?? true,
});

const mapMember = (row: any): WorkGroupMember => ({
  ...fromDb(row),
  groupId: row.group_id ?? row.groupId,
  userId: row.user_id ?? row.userId,
  memberRole: row.member_role ?? row.memberRole ?? 'member',
  isActive: row.is_active ?? row.isActive ?? true,
});

const groupPayload = (input: WorkGroupInput) => cleanUndefined(toDb({
  code: input.code?.trim() || normalizeCode(input.name),
  name: input.name.trim(),
  description: input.description?.trim() || null,
  sortOrder: input.sortOrder ?? 0,
  isActive: input.isActive ?? true,
}));

export const workGroupService = {
  async listGroups(options: Pick<ListOptions, 'activeOnly'> = {}): Promise<WorkGroup[]> {
    if (!isSupabaseConfigured) return [];

    let query = supabase
      .from(GROUP_TABLE)
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (options.activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapGroup);
  },

  async listGroupsWithMembers(options: ListOptions = {}): Promise<WorkGroupWithMembers[]> {
    if (!isSupabaseConfigured) return [];

    const groups = await this.listGroups({ activeOnly: options.activeOnly });
    if (groups.length === 0) return [];

    let query = supabase
      .from(MEMBER_TABLE)
      .select('*')
      .in('group_id', groups.map(group => group.id))
      .order('created_at', { ascending: true });

    if (options.memberActiveOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;

    const membersByGroup = new Map<string, WorkGroupMember[]>();
    (data || []).map(mapMember).forEach(member => {
      const members = membersByGroup.get(member.groupId) || [];
      members.push(member);
      membersByGroup.set(member.groupId, members);
    });

    return groups.map(group => ({
      ...group,
      members: membersByGroup.get(group.id) || [],
    }));
  },

  async createGroup(input: WorkGroupInput): Promise<WorkGroup> {
    const payload = groupPayload(input);

    if (!isSupabaseConfigured) {
      return {
        id: crypto.randomUUID(),
        code: payload.code,
        name: payload.name,
        description: payload.description || undefined,
        sortOrder: payload.sort_order ?? 0,
        isActive: payload.is_active ?? true,
        createdAt: new Date().toISOString(),
      };
    }

    const { data, error } = await supabase
      .from(GROUP_TABLE)
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return mapGroup(data);
  },

  async updateGroup(group: WorkGroup): Promise<WorkGroup> {
    if (!isSupabaseConfigured) return { ...group, updatedAt: new Date().toISOString() };

    const { data, error } = await supabase
      .from(GROUP_TABLE)
      .update(groupPayload(group))
      .eq('id', group.id)
      .select('*')
      .single();
    if (error) throw error;
    return mapGroup(data);
  },

  async archiveGroup(groupId: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(GROUP_TABLE).update({ is_active: false }).eq('id', groupId);
    if (error) throw error;
  },

  async removeGroup(groupId: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(GROUP_TABLE).delete().eq('id', groupId);
    if (error) throw error;
  },

  async addMember(groupId: string, userId: string, memberRole: WorkGroupMemberRole = 'member'): Promise<WorkGroupMember> {
    if (!isSupabaseConfigured) {
      return {
        id: crypto.randomUUID(),
        groupId,
        userId,
        memberRole,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }

    const payload = cleanUndefined(toDb({
      groupId,
      userId,
      memberRole,
      isActive: true,
    }));

    const { data, error } = await supabase
      .from(MEMBER_TABLE)
      .upsert(payload, { onConflict: 'group_id,user_id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapMember(data);
  },

  async updateMember(memberId: string, updates: { memberRole?: WorkGroupMemberRole; isActive?: boolean }): Promise<WorkGroupMember> {
    if (!isSupabaseConfigured) {
      return {
        id: memberId,
        groupId: '',
        userId: '',
        memberRole: updates.memberRole || 'member',
        isActive: updates.isActive ?? true,
        updatedAt: new Date().toISOString(),
      };
    }

    const { data, error } = await supabase
      .from(MEMBER_TABLE)
      .update(cleanUndefined(toDb(updates)))
      .eq('id', memberId)
      .select('*')
      .single();
    if (error) throw error;
    return mapMember(data);
  },

  async removeMember(memberId: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(MEMBER_TABLE).delete().eq('id', memberId);
    if (error) throw error;
  },
};
