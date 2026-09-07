import type { SupabaseClient } from '@supabase/supabase-js';
import type { MembershipChange, WorkspaceCursor, WorkspacePage } from './workWorkspaceTypes';
import { mapWorkWorkspaceError, WorkWorkspaceRpcError } from './workWorkspaceService';

export type WorkspacePeopleSource = 'organization' | 'project' | 'directory';
export type WorkspacePersonEligibility = 'ELIGIBLE' | 'NO_APP_ACCOUNT' | 'ACCOUNT_INACTIVE' | 'EMPLOYEE_INACTIVE';
export interface WorkspacePerson {
  userId: string | null;
  employeeId: string | null;
  name: string;
  avatarUrl: string | null;
  position: string | null;
  sourceLabel: string | null;
  sourceReference: string | null;
  eligibility: WorkspacePersonEligibility;
  alreadyMember: boolean;
}
export type WorkspaceSourceChange = MembershipChange;
export interface WorkspaceSourceDiffItem {
  person: WorkspacePerson;
  change: WorkspaceSourceChange;
  reason: 'joined_source' | 'left_source';
}
export interface WorkspaceSourceDiff extends WorkspacePage<WorkspaceSourceDiffItem> {
  fingerprint: string;
}

export function createWorkWorkspacePeopleService(client: Pick<SupabaseClient, 'rpc'>) {
  const validate = (workspaceId: string, search = '') => {
    if (!workspaceId?.trim()) throw new WorkWorkspaceRpcError('WORK_INVALID_SCOPE', 'Workspace is required.');
    if (search.length > 100) throw new WorkWorkspaceRpcError('WORK_INVALID_FILTER', 'Search is limited to 100 characters.');
  };
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) throw error;
      if (data == null) throw new WorkWorkspaceRpcError('WORK_WORKSPACE_EMPTY_RESPONSE', 'The server did not return a result.');
      return data as T;
    } catch (error) {
      throw mapWorkWorkspaceError(error);
    }
  };
  return {
    async people(workspaceId: string, source: WorkspacePeopleSource, search = '', cursor: WorkspaceCursor | null = null) {
      validate(workspaceId, search);
      return call<WorkspacePage<WorkspacePerson>>('list_work_workspace_people', {
        p_workspace_id: workspaceId, p_source: source, p_search: search, p_cursor: cursor, p_limit: 30,
      });
    },
    async sourceDiff(workspaceId: string, cursor: WorkspaceCursor | null = null) {
      validate(workspaceId);
      return call<WorkspaceSourceDiff>('preview_work_workspace_source_diff', {
        p_workspace_id: workspaceId, p_cursor: cursor, p_limit: 30,
      });
    },
  };
}
export type WorkWorkspacePeopleService = ReturnType<typeof createWorkWorkspacePeopleService>;
