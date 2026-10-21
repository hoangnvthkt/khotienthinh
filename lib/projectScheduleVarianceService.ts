// Nạp dữ liệu cho thẻ "Tiến độ tổng — đang tới đâu?" ở Tổng quan dự án.
import type { ProjectTask } from '../types';
import { supabase } from './supabase';
import { taskService } from './projectService';
import { projectWeeklyProgressService } from './projectWeeklyProgressService';
import { dailyLogWbsService } from './dailyLogWbsService';
import type { VarianceDelayReasons } from '../components/project/schedule-variance/ScheduleVarianceUi';

export interface ScheduleVarianceInputs {
  tasks: ProjectTask[];
  authoritative: boolean;
  logs: Array<{ date: string; status: string | null; issues: string | null; summarySourceType: string | null; supersededByDailyLogId: string | null }>;
  /** Lý do chậm đã công bố ở Nhật ký; null khi không tải được (thẻ vẫn hiện). */
  delayReasons: VarianceDelayReasons | null;
}

export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const loadVarianceDelayReasons = (projectId: string, constructionSiteId: string | null): Promise<VarianceDelayReasons | null> =>
  dailyLogWbsService.getDelayReasons({ projectId, constructionSiteId })
    .then(bundle => ({ catalog: bundle.catalog, latest: bundle.latest }))
    .catch(error => { console.warn('Delay reasons load failed', error); return null; });

export const loadScheduleVarianceInputs = async (projectId: string, constructionSiteId: string | null): Promise<ScheduleVarianceInputs> => {
  const [tasks, authority, logResult, delayReasons] = await Promise.all([
    taskService.list(projectId, constructionSiteId),
    projectWeeklyProgressService.getDailyProgressAuthority({ projectId, constructionSiteId, progressDate: localToday() }).catch(() => null),
    supabase.from('daily_logs')
      .select('date,status,issues,summary_source_type,superseded_by_daily_log_id')
      .eq('project_id', projectId)
      .eq('status', 'verified')
      .order('date', { ascending: false })
      .limit(60),
    loadVarianceDelayReasons(projectId, constructionSiteId),
  ]);
  if (logResult.error) throw logResult.error;
  return {
    tasks,
    delayReasons,
    authoritative: authority?.authoritative === true,
    logs: (logResult.data || []).map(row => ({
      date: String(row.date), status: row.status, issues: row.issues, summarySourceType: row.summary_source_type,
      supersededByDailyLogId: row.superseded_by_daily_log_id,
    })),
  };
};
