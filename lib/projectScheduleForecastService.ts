import type {
  DailyLog,
  ProjectDelayEvent,
  ProjectDelayEventStatus,
  ProjectScheduleRevision,
  ProjectScheduleRevisionTask,
  ProjectTask,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import { taskService } from './projectService';
import { supabase } from './supabase';

const missingRelation = (error: any): boolean => {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42P01' || /does not exist|schema cache/i.test(message);
};

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const stripGeneratedColumns = (row: any): any => {
  delete row.created_at;
  delete row.updated_at;
  return row;
};

const delayEventToDb = (event: ProjectDelayEvent): any => stripGeneratedColumns(toDb(event));
const revisionToDb = (revision: ProjectScheduleRevision): any => {
  const row = toDb(revision);
  delete row.created_at;
  return row;
};
const revisionTaskToDb = (row: ProjectScheduleRevisionTask): any => {
  const dbRow = toDb({ ...row, id: row.id || newId() });
  delete dbRow.created_at;
  return dbRow;
};

export const delayEventService = {
  async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectDelayEvent[]> {
    const { data, error } = await supabase
      .from('project_delay_events')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      if (missingRelation(error)) {
        console.warn('project_delay_events table is not available yet; skipping schedule forecast delay events.');
        return [];
      }
      throw error;
    }
    return dedupeRowsById(data || []).map(row => fromDb(row) as ProjectDelayEvent);
  },

  async upsert(event: ProjectDelayEvent): Promise<void> {
    const { error } = await supabase
      .from('project_delay_events')
      .upsert(delayEventToDb(event), { onConflict: 'id' });
    if (error) throw error;
  },

  async createFromDailyLog(log: DailyLog, createdBy?: string | null): Promise<ProjectDelayEvent[]> {
    const delayTasks = (log.delayTasks || []).filter(row => row.taskId && Number(row.delayDays || 0) > 0);
    if (delayTasks.length === 0) return [];

    const { data: existingRows, error: existingError } = await supabase
      .from('project_delay_events')
      .select('*')
      .eq('source_daily_log_id', log.id);
    if (existingError) throw existingError;

    const existingByTaskId = new Map((existingRows || []).map(row => [row.task_id as string, fromDb(row) as ProjectDelayEvent]));
    const saved: ProjectDelayEvent[] = [];

    for (const row of delayTasks) {
      const existing = existingByTaskId.get(row.taskId);
      const lockedStatus = existing && ['applied', 'resolved', 'void'].includes(existing.status);
      const event: ProjectDelayEvent = {
        id: existing?.id || newId(),
        projectId: log.projectId || null,
        constructionSiteId: log.constructionSiteId || null,
        sourceDailyLogId: log.id,
        taskId: row.taskId,
        taskNameSnapshot: row.taskName || 'Hạng mục tiến độ',
        category: row.category || 'other',
        reason: row.reason || null,
        impactDays: Math.max(0, Math.ceil(Number(row.delayDays || 0))),
        status: lockedStatus ? existing.status : 'reported',
        responsibility: existing?.responsibility || null,
        occurredOn: log.date,
        createdBy: existing?.createdBy || createdBy || null,
        acceptedBy: existing?.acceptedBy || null,
        acceptedAt: existing?.acceptedAt || null,
        resolvedAt: existing?.resolvedAt || null,
        createdAt: existing?.createdAt,
        updatedAt: existing?.updatedAt,
      };
      await this.upsert(event);
      saved.push(event);
      existingByTaskId.set(row.taskId, event);
    }

    return saved;
  },

  async markStatus(id: string, status: ProjectDelayEventStatus, actorId?: string | null): Promise<void> {
    const now = new Date().toISOString();
    const patch: Partial<ProjectDelayEvent> = { status };
    if (status === 'accepted') {
      patch.acceptedBy = actorId || null;
      patch.acceptedAt = now;
      patch.resolvedAt = null;
    } else if (status === 'resolved' || status === 'void') {
      patch.resolvedAt = now;
    }

    const { error } = await supabase
      .from('project_delay_events')
      .update(toDb(patch))
      .eq('id', id);
    if (error) throw error;
  },
};

export const scheduleRevisionService = {
  async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectScheduleRevision[]> {
    const { data, error } = await supabase
      .from('project_schedule_revisions')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('applied_at', { ascending: false });
    if (error) {
      if (missingRelation(error)) {
        console.warn('project_schedule_revisions table is not available yet; skipping schedule revisions.');
        return [];
      }
      throw error;
    }
    return dedupeRowsById(data || []).map(row => fromDb(row) as ProjectScheduleRevision);
  },

  async createAndApply(input: {
    revision: ProjectScheduleRevision;
    revisionTasks: ProjectScheduleRevisionTask[];
    updatedTasks: ProjectTask[];
    sourceDelayEventIds: string[];
  }): Promise<void> {
    const { error: revisionError } = await supabase
      .from('project_schedule_revisions')
      .insert(revisionToDb(input.revision));
    if (revisionError) throw revisionError;

    if (input.revisionTasks.length > 0) {
      const { error: taskError } = await supabase
        .from('project_schedule_revision_tasks')
        .insert(input.revisionTasks.map(revisionTaskToDb));
      if (taskError) throw taskError;
    }

    if (input.updatedTasks.length > 0) {
      await taskService.upsertMany(input.updatedTasks);
    }

    if (input.sourceDelayEventIds.length > 0) {
      const { error: eventError } = await supabase
        .from('project_delay_events')
        .update(toDb({ status: 'applied', resolvedAt: new Date().toISOString() }))
        .in('id', input.sourceDelayEventIds);
      if (eventError) throw eventError;
    }
  },
};
