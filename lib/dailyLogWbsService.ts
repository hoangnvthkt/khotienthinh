import type {
  BusinessPartner,
  DailyLogBaselineQuantityState,
  DailyLog,
  DailyLogContribution,
  DailyLogLabor,
  DailyLogLaborInput,
  DailyLogMachine,
  DailyLogMachineInput,
  DailyLogPhoto,
  DailyLogSourceItemV2,
  DailyLogSummarySource,
  DailyLogWbsDecisionDraft,
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
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const mappedKey = toCamel(key);
      // Dictionary keys are task IDs, not database column names.
      if (mappedKey === 'baselineQuantityStates' || mappedKey === 'baselineQuantityFingerprints') return [mappedKey, child];
      if (mappedKey === 'quantityBaselines' && child && typeof child === 'object') {
        return [mappedKey, Object.fromEntries(Object.entries(child).map(([taskId, context]) => [taskId, fromDb(context)]))];
      }
      return [mappedKey, fromDb(child)];
    }));
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
  decisions: DailyLogWbsDecisionDraft[];
  labor: Array<DailyLogLabor & { contributionId?: string | null }>;
  machines: Array<DailyLogMachine & { contributionId?: string | null }>;
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

export interface DailyLogDocumentBundle extends DailyLogWbsBundle {
  myContributions: DailyLogContribution[];
  baselineQuantityStates: Record<string, DailyLogBaselineQuantityState>;
  baselineQuantityFingerprints: Record<string, string>;
  quantityBaselines: Record<string, {
    state: DailyLogBaselineQuantityState;
    fingerprint: string;
    allowOver100: boolean;
    priorRowId: string | null;
    previousItem: { cumulativeQuantityDone: number; areaPlannedQuantitySnapshot: number; unitSnapshot: string } | null;
    nextItem: { cumulativeQuantityDone: number | null; areaPlannedQuantitySnapshot: number | null; unitSnapshot: string | null } | null;
  }>;
  permissions: DailyLogWbsBundle['permissions'] & { canCreateSource: boolean; canSubmitSource: boolean };
}

export interface CreateDailyLogSourceInput {
  commandId: string;
  projectId: string;
  constructionSiteId?: string | null;
  date: string;
  workAreaCode: string;
  workAreaName: string;
}

export interface DailyLogSourceCreateReceipt {
  contributionId: string;
  rowVersion: number;
  updatedAt: string;
}

export interface SaveDailyLogSourceDocumentInput {
  contributionId: string;
  expectedRowVersion: number;
  workAreaCode: string;
  workAreaName: string;
  content: string;
  issues: string;
  photos: DailyLogPhoto[];
  items: DailyLogSourceItemV2[];
  labor: DailyLogLaborInput[];
  machines: DailyLogMachineInput[];
}

export interface DailyLogSourceTransitionReceipt {
  contributionId: string;
  status: 'submitted' | 'returned';
  rowVersion: number;
  updatedAt: string;
  sourceFingerprint: string;
  dailyLogId?: string;
  summaryUpdatedAt?: string;
}

export interface ReturnDailyLogSourceInput {
  commandId: string;
  dailyLogId: string;
  summarySourceId: string;
  contributionId: string;
  expectedSummaryUpdatedAt: string;
  expectedRowVersion: number;
  reason: string;
}

export interface SubmitDailyLogSourceInput {
  commandId: string;
  contributionId: string;
  expectedRowVersion: number;
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

export interface SubmitDailyLogSummaryInput {
  dailyLogId: string;
  expectedUpdatedAt: string;
  approverUserId: string;
}

export interface DailyLogSummarySubmitReceipt {
  dailyLogId: string;
  status: 'submitted';
  updatedAt: string;
}

export interface PublishDailyLogSummaryInput {
  commandId: string;
  dailyLogId: string;
  expectedUpdatedAt: string;
}

export interface DailyLogPublishReceipt {
  publishedProgress?: boolean;
  mismatchCount?: number;
  shadowId?: string;
  commandId: string;
  dailyLogId: string;
  progressDate: string;
  publishedTaskIds: string[];
  verifiedResourceLineIds: string[];
  progressFingerprint: string;
  resourceEvidenceFingerprint: string;
  publishedAt: string;
}

export function getDailyLogPublicationOutcome(receipt: Pick<DailyLogPublishReceipt, 'publishedProgress' | 'mismatchCount'>) {
  if (receipt.publishedProgress === false) {
    return {
      closeReview: false,
      message: receipt.mismatchCount === 0
        ? 'Đối chiếu thử nghiệm khớp. Chưa công bố tiến độ; cần bật chế độ chính thức.'
        : `Đã đối chiếu thử nghiệm: ${receipt.mismatchCount ?? 'chưa xác định số'} WBS còn sai khác. Chưa công bố tiến độ.`,
    };
  }
  return { closeReview: true, message: 'Đã duyệt và công bố tiến độ' };
}

export interface CreateDailyLogSummaryRevisionInput {
  dailyLogId: string;
  reason: string;
}

export interface DailyLogSummaryRevisionReceipt {
  dailyLogId: string;
  revisionNo: number;
  supersedesDailyLogId: string;
  status: 'draft';
  revisionReason: string;
  createdAt: string;
}

const callRpc = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw mapDailyLogWbsCommandError(error);
  return fromDb(data) as T;
};

export const dailyLogWbsService = {
  async updateSummaryMetadata(input: {
    dailyLogId: string;
    expectedUpdatedAt: string | null;
    weather: DailyLog['weather'];
    description: string;
    issues: string;
    nextDayPlan: string;
    photos: DailyLogPhoto[];
  }): Promise<{ updatedAt: string }> {
    // Metadata only: never invoke the legacy replace-detail-tables path.
    // Existing canonical daily_logs RLS remains the authorization boundary.
    const updatedAt = new Date().toISOString();
    let command = supabase.from('daily_logs').update({
      weather: input.weather, description: input.description, issues: input.issues || null,
      next_day_plan: input.nextDayPlan || null, photos: input.photos, last_action_at: updatedAt,
    }).eq('id',input.dailyLogId).eq('summary_source_type','member_contributions').in('status',['draft','rejected']);
    command = input.expectedUpdatedAt ? command.eq('last_action_at',input.expectedUpdatedAt) : command.is('last_action_at',null);
    const { data,error } = await command.select('id,last_action_at').maybeSingle();
    if (error) throw mapDailyLogWbsCommandError(error);
    if (!data) throw new Error('Bản tổng hợp đã thay đổi hoặc bạn không còn quyền chỉnh sửa. Tải lại để kiểm tra trước khi lưu.');
    return { updatedAt: data.last_action_at };
  },
  returnSource(input: ReturnDailyLogSourceInput): Promise<DailyLogSourceTransitionReceipt> {
    return callRpc('return_daily_log_source_v2', { p_input: input });
  },
  submitSource(input: SubmitDailyLogSourceInput): Promise<DailyLogSourceTransitionReceipt> {
    return callRpc('submit_daily_log_source_v2', { p_input: input });
  },
  saveSourceDocument(input: SaveDailyLogSourceDocumentInput): Promise<DailyLogWorkSaveReceipt> {
    return callRpc('save_daily_log_source_document_v2', { p_input: input });
  },
  getDocumentBundle(input: DailyLogWbsBundleInput & { contributionId?: string | null }): Promise<DailyLogDocumentBundle> {
    return callRpc<Record<string, any>>('get_daily_log_document_bundle_v2', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId ?? null,
      p_log_date: input.logDate,
      p_daily_log_id: input.dailyLogId ?? null,
      p_contribution_id: input.contributionId ?? null,
    }).then(bundle => ({
      ...bundle,
      tasks: bundle.tasks || [],
      myContributions: bundle.myContributions || [],
      baselineQuantityStates: bundle.baselineQuantityStates || {},
      workItems: (bundle.workItems || []).map((item: Record<string, any>) => ({
        ...item,
        ownerType: item.dailyLogId ? 'summary_source' : 'contribution',
        workAreaName: item.workAreaNameSnapshot ?? item.workAreaName,
        taskName: item.taskNameSnapshot ?? item.taskName,
        wbsCode: item.wbsCodeSnapshot ?? item.wbsCode,
        unit: item.unitSnapshot ?? item.unit,
        plannedQuantity: 'plannedQuantitySnapshot' in item ? item.plannedQuantitySnapshot : item.plannedQuantity,
        areaPlannedQuantity: 'areaPlannedQuantitySnapshot' in item ? item.areaPlannedQuantitySnapshot : item.areaPlannedQuantity,
        scheduleFinishDate: item.scheduleFinishDateSnapshot ?? item.scheduleFinishDate,
      })),
    } as DailyLogDocumentBundle));
  },

  createSource(input: CreateDailyLogSourceInput): Promise<DailyLogSourceCreateReceipt> {
    return callRpc('create_daily_log_source_v2', {
      p_command_id: input.commandId,
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId ?? null,
      p_log_date: input.date,
      p_work_area_code: input.workAreaCode,
      p_work_area_name: input.workAreaName,
    });
  },

  getBundle(input: DailyLogWbsBundleInput): Promise<DailyLogWbsBundle> {
    return callRpc<Record<string, any>>('get_daily_log_wbs_bundle_v1', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId,
      p_log_date: input.logDate,
      p_daily_log_id: input.dailyLogId || null,
    }).then(bundle => ({
      ...bundle,
      tasks: bundle.tasks || bundle.leafTasks || [],
      workItems: (bundle.workItems || []).map((item: Record<string, any>) => ({
        ...item,
        ownerType: item.dailyLogId ? 'summary_source' : 'contribution',
        workAreaName: item.workAreaNameSnapshot ?? item.workAreaName,
        taskName: item.taskNameSnapshot ?? item.taskName,
        wbsCode: item.wbsCodeSnapshot ?? item.wbsCode,
        unit: item.unitSnapshot ?? item.unit,
        plannedQuantity: 'plannedQuantitySnapshot' in item ? item.plannedQuantitySnapshot : item.plannedQuantity,
        areaPlannedQuantity: 'areaPlannedQuantitySnapshot' in item ? item.areaPlannedQuantitySnapshot : item.areaPlannedQuantity,
        scheduleFinishDate: item.scheduleFinishDateSnapshot ?? item.scheduleFinishDate,
      })),
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

  submitSummary(input: SubmitDailyLogSummaryInput): Promise<DailyLogSummarySubmitReceipt> {
    return callRpc('submit_daily_log_summary_v1', {
      p_daily_log_id: input.dailyLogId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_approver_user_id: input.approverUserId,
    });
  },

  publishSummary(input: PublishDailyLogSummaryInput): Promise<DailyLogPublishReceipt> {
    return callRpc('publish_daily_log_summary_v1', {
      p_command_id: input.commandId,
      p_daily_log_id: input.dailyLogId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },

  createSummaryRevision(input: CreateDailyLogSummaryRevisionInput): Promise<DailyLogSummaryRevisionReceipt> {
    const reason = input.reason.trim();
    if (!reason) throw new Error('Vui lòng nhập lý do tạo bản điều chỉnh.');
    return callRpc('create_daily_log_summary_revision_v1', {
      p_daily_log_id: input.dailyLogId,
      p_reason: reason,
    });
  },
};
