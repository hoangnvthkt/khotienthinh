import { supabase } from './supabase';

export type SubjectType = 'daily_log';
export type SubjectAction = 'view' | 'submit' | 'verify' | 'approve' | 'return';

export interface DailyLogResponsibilityTarget {
  userId: string;
  name: string;
  responsibility: 'current_verifier' | 'current_approver';
  permissionCode: 'project.daily_log.verify' | 'project.daily_log.approve';
  scopeType: 'global' | 'project' | 'construction_site';
  scopeId: string;
  resolvedBy: 'responsibility_slot';
}

export interface DailyLogAssignmentContext {
  assignmentId: string;
  userId: string;
  name: string;
  responsibility: string;
  permissionCode: string | null;
  status: 'active';
  startsAt: string;
  expiresAt: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isResponsibilityTarget = (value: unknown): value is DailyLogResponsibilityTarget =>
  isRecord(value)
  && typeof value.userId === 'string'
  && typeof value.name === 'string'
  && (value.responsibility === 'current_verifier' || value.responsibility === 'current_approver')
  && (value.permissionCode === 'project.daily_log.verify' || value.permissionCode === 'project.daily_log.approve')
  && (value.scopeType === 'global' || value.scopeType === 'project' || value.scopeType === 'construction_site')
  && typeof value.scopeId === 'string'
  && value.resolvedBy === 'responsibility_slot';

const isAssignmentContext = (value: unknown): value is DailyLogAssignmentContext =>
  isRecord(value)
  && typeof value.assignmentId === 'string'
  && typeof value.userId === 'string'
  && typeof value.name === 'string'
  && typeof value.responsibility === 'string'
  && (typeof value.permissionCode === 'string' || value.permissionCode === null)
  && value.status === 'active'
  && typeof value.startsAt === 'string'
  && (typeof value.expiresAt === 'string' || value.expiresAt === null);

const requireRpcData = <T>(data: unknown, predicate: (value: unknown) => value is T, message: string): T => {
  if (!predicate(data)) throw new Error(message);
  return data;
};

export const subjectAuthorizationService = {
  async canView(subjectType: SubjectType, subjectId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_view_subject', {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
    });
    if (error) throw error;
    return data === true;
  },

  async canAct(subjectType: SubjectType, subjectId: string, action: SubjectAction): Promise<boolean> {
    const { data, error } = await supabase.rpc('can_act_on_subject', {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
      p_action: action,
    });
    if (error) throw error;
    return data === true;
  },

  async getDailyLogResponsibilityTarget(logId: string): Promise<DailyLogResponsibilityTarget> {
    const { data, error } = await supabase.rpc('get_daily_log_responsibility_target', {
      p_log_id: logId,
    });
    if (error) throw error;
    return requireRpcData(data, isResponsibilityTarget, 'Responsibility target không hợp lệ.');
  },

  async getDailyLogAssignmentContext(logId: string): Promise<DailyLogAssignmentContext | null> {
    const { data, error } = await supabase.rpc('get_daily_log_assignment_context', {
      p_log_id: logId,
    });
    if (error) throw error;
    if (data === null) return null;
    return requireRpcData(data, isAssignmentContext, 'Assignment context không hợp lệ.');
  },
};
