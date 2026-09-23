import type {
  BusinessPartner,
  DailyLog,
  DailyLogContribution,
  DailyLogLabor,
  DailyLogLaborInput,
  DailyLogMachine,
  DailyLogMachineInput,
  DailyLogSummarySource,
  DailyLogWbsDecision,
  DailyLogWorkConflictCode,
  DailyLogWorkItem,
  ProjectDailyTaskProgress,
  ProjectTask,
  ProjectWorkBoqItem,
} from '../types';
import type { ProjectProgressPeriodState } from './projectWeeklyProgressService';
import { mapDailyLogWbsCommandError } from './dailyLogWorkflow';
import { supabase } from './supabase';

const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const fromDb = (value: unknown): any => {
  if (Array.isArray(value)) return value.map(fromDb);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [toCamel(key), fromDb(child)]));
  }
  return value;
};

export interface DailyLogWbsBundle {
  rollout: { mode: 'off' | 'pilot' | 'enforced' | 'paused'; cutoverDate: string | null; enabled: boolean };
  tasks: ProjectTask[];
  workBoqItems: ProjectWorkBoqItem[];
  resourceProviders: BusinessPartner[];
  previousProgressRows: ProjectDailyTaskProgress[];
  nextProgressRows: ProjectDailyTaskProgress[];
  contribution: DailyLogContribution | null;
  contributionsForSummary: DailyLogContribution[];
  summaryLog: DailyLog | null;
  summarySources: DailyLogSummarySource[];
  workItems: DailyLogWorkItem[];
  decisions: DailyLogWbsDecision[];
  labor: DailyLogLabor[];
  machines: DailyLogMachine[];
  periodState: ProjectProgressPeriodState | null;
  permissions: {
    canEditSource: boolean;
    canSummarize: boolean;
    canApprove: boolean;
    canPublishProgress: boolean;
  };
}

export interface DailyLogWorkSaveReceipt {
  rowVersion: number;
  updatedAt: string;
  sourceFingerprint: string;
  conflicts: Array<{ code: DailyLogWorkConflictCode; taskId?: string; summarySourceId?: string }>;
}

export interface DailyLogWbsBundleInput {
  projectId: string;
  constructionSiteId?: string | null;
  logDate: string;
  dailyLogId?: string | null;
}

export interface DailyLogContributionWorkItemInput {
  clientKey: string;
  taskId: string;
  workBoqItemId?: string | null;
  areaPlannedQuantity?: number | null;
  cumulativeProgressPercent: number;
  forecastFinishDate?: string | null;
  forecastChangeReason?: string | null;
  note?: string | null;
  attachments?: unknown[];
}

export interface SaveDailyLogContributionWorkInput {
  contributionId: string;
  expectedRowVersion: number;
  workAreaCode: string;
  workAreaName: string;
  items: DailyLogContributionWorkItemInput[];
  labor: DailyLogLaborInput[];
  machines: DailyLogMachineInput[];
}

export interface SaveDailyLogSummaryWorkInput {
  dailyLogId: string;
  expectedUpdatedAt: string;
  sources: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  labor: Array<Record<string, unknown>>;
  machines: Array<Record<string, unknown>>;
}

export interface RequestDailyLogSourceChangeInput {
  dailyLogId: string;
  summarySourceId: string;
  comment: string;
  expectedUpdatedAt: string;
}

const callRpc = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw mapDailyLogWbsCommandError(error);
  return fromDb(data) as T;
};

export const dailyLogWbsService = {
  getBundle(input: DailyLogWbsBundleInput): Promise<DailyLogWbsBundle> {
    return callRpc<Record<string, any>>('get_daily_log_wbs_bundle_v1', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId,
      p_log_date: input.logDate,
      p_daily_log_id: input.dailyLogId || null,
    }).then(bundle => ({
      ...bundle,
      tasks: bundle.tasks || bundle.leafTasks || [],
    } as DailyLogWbsBundle));
  },

  saveContribution(input: SaveDailyLogContributionWorkInput): Promise<DailyLogWorkSaveReceipt> {
    return callRpc('save_daily_log_contribution_work_v1', {
      p_contribution_id: input.contributionId,
      p_expected_row_version: input.expectedRowVersion,
      p_work_area_code: input.workAreaCode,
      p_work_area_name: input.workAreaName,
      p_items: input.items,
      p_labor: input.labor,
      p_machines: input.machines,
    });
  },

  saveSummary(input: SaveDailyLogSummaryWorkInput): Promise<DailyLogWorkSaveReceipt> {
    return callRpc('save_daily_log_summary_work_v1', {
      p_daily_log_id: input.dailyLogId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_sources: input.sources,
      p_items: input.items,
      p_decisions: input.decisions,
      p_labor: input.labor,
      p_machines: input.machines,
    });
  },

  requestSourceChange(input: RequestDailyLogSourceChangeInput): Promise<DailyLogWorkSaveReceipt> {
    return callRpc('request_daily_log_summary_source_changes_v1', {
      p_daily_log_id: input.dailyLogId,
      p_summary_source_id: input.summarySourceId,
      p_comment: input.comment,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },
};
