// Nạp dữ liệu cho thẻ "Tiến độ tổng — đang tới đâu?" ở Tổng quan dự án.
import type { ProjectTask } from '../types';
import { supabase } from './supabase';
import { taskService } from './projectService';
import { projectWeeklyProgressService } from './projectWeeklyProgressService';

export interface ScheduleVarianceInputs {
  tasks: ProjectTask[];
  authoritative: boolean;
  logs: Array<{ date: string; status: string | null; issues: string | null; summarySourceType: string | null; supersededByDailyLogId: string | null }>;
}

export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const loadScheduleVarianceInputs = async (projectId: string, constructionSiteId: string | null): Promise<ScheduleVarianceInputs> => {
  const [tasks, authority, logResult] = await Promise.all([
    taskService.list(projectId, constructionSiteId),
    projectWeeklyProgressService.getDailyProgressAuthority({ projectId, constructionSiteId, progressDate: localToday() }).catch(() => null),
    supabase.from('daily_logs')
      .select('date,status,issues,summary_source_type,superseded_by_daily_log_id')
      .eq('project_id', projectId)
      .eq('status', 'verified')
      .order('date', { ascending: false })
      .limit(60),
  ]);
  if (logResult.error) throw logResult.error;
  return {
    tasks,
    authoritative: authority?.authoritative === true,
    logs: (logResult.data || []).map(row => ({
      date: String(row.date), status: row.status, issues: row.issues, summarySourceType: row.summary_source_type,
      supersededByDailyLogId: row.superseded_by_daily_log_id,
    })),
  };
};
