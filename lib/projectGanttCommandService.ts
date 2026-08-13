import type {
  ProjectBaseline,
  ProjectDelayEvent,
  ProjectScheduleRevision,
  ProjectTask,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { taskService } from './projectService';
import { supabase } from './supabase';

export interface ProjectGanttScope {
  projectId: string;
  constructionSiteId?: string | null;
}

export type ProjectGanttConsumerRoom =
  | 'daily_log'
  | 'weekly_progress'
  | 'material_planning'
  | 'quantity_acceptance'
  | 'quality'
  | 'payment';

export type ProjectGanttTaskChange = Partial<ProjectTask> & {
  id: string;
  expectedRowVersion: number;
  contractItemIds?: string[];
};

export type ProjectGanttCatalogTask = Pick<ProjectTask,
  'id' | 'projectId' | 'constructionSiteId' | 'parentId' | 'name' |
  'wbsCode' | 'startDate' | 'endDate' | 'actualStartDate' | 'actualEndDate' |
  'duration' | 'progress' | 'progressMode' | 'isMilestone' | 'order' |
  'quantity' | 'unit' | 'fallbackUnit' | 'provisionalQuantity' |
  'completedQuantity' | 'updatedAt' | 'rowVersion'
> & { contractItemIds: string[] };

export interface ProjectGanttCommandResult {
  ok: true;
  requestId: string;
  replayed: boolean;
  mutated: boolean;
  tasks?: ProjectTask[];
  taskIds?: string[];
  taskId?: string;
  rowVersion?: number;
  contractItemIds?: string[];
  baseline?: ProjectBaseline;
  delayEvent?: ProjectDelayEvent;
  delayEvents?: ProjectDelayEvent[];
  revision?: ProjectScheduleRevision;
}

export type ProjectGanttErrorCode =
  | 'GANTT_PERMISSION_DENIED'
  | 'GANTT_SCOPE_MISMATCH'
  | 'GANTT_STALE_VERSION'
  | 'GANTT_DELETE_BLOCKED'
  | 'GANTT_REQUEST_ID_REUSED'
  | 'GANTT_INVALID_PAYLOAD'
  | 'GANTT_INVALID_TRANSITION'
  | 'GANTT_UNKNOWN_ERROR';

const ERROR_MESSAGES: Record<ProjectGanttErrorCode, string> = {
  GANTT_PERMISSION_DENIED: 'Bạn không có quyền thực hiện thao tác này trong Room Tiến độ.',
  GANTT_SCOPE_MISMATCH: 'Hạng mục không thuộc đúng dự án hoặc công trường đang mở.',
  GANTT_STALE_VERSION: 'Dữ liệu tiến độ đã thay đổi. Vui lòng tải lại trước khi lưu tiếp.',
  GANTT_DELETE_BLOCKED: 'Không thể xóa hạng mục vì đang có dữ liệu nghiệp vụ liên quan.',
  GANTT_REQUEST_ID_REUSED: 'Mã yêu cầu đã được dùng cho một nội dung khác. Vui lòng thử lại.',
  GANTT_INVALID_PAYLOAD: 'Dữ liệu tiến độ không hợp lệ. Vui lòng kiểm tra lại.',
  GANTT_INVALID_TRANSITION: 'Không thể chuyển sang trạng thái tiến độ đã chọn.',
  GANTT_UNKNOWN_ERROR: 'Không thể cập nhật tiến độ. Vui lòng thử lại.',
};

const KNOWN_ERROR_CODES = Object.keys(ERROR_MESSAGES) as ProjectGanttErrorCode[];

export class ProjectGanttCommandError extends Error {
  readonly code: ProjectGanttErrorCode;
  readonly shouldReload: boolean;
  readonly causeValue: unknown;

  constructor(code: ProjectGanttErrorCode, causeValue?: unknown) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProjectGanttCommandError';
    this.code = code;
    this.shouldReload = code === 'GANTT_STALE_VERSION';
    this.causeValue = causeValue;
  }
}

const readErrorText = (value: any): string => [
  value?.errorCode,
  value?.code,
  value?.message,
  value?.details,
  value?.hint,
].filter(Boolean).join(' ');

export const parseProjectGanttCommandError = (value: unknown): ProjectGanttCommandError => {
  if (value instanceof ProjectGanttCommandError) return value;
  const text = readErrorText(value);
  const code = KNOWN_ERROR_CODES.find(candidate => text.includes(candidate)) || 'GANTT_UNKNOWN_ERROR';
  return new ProjectGanttCommandError(code, value);
};

type RpcResult = { data: any; error: any };
type Rpc = (name: string, payload: Record<string, unknown>) => PromiseLike<RpcResult>;

interface ProjectGanttCommandDependencies {
  rpc: Rpc;
  invalidateTasks: () => void;
  newRequestId: () => string;
}

const defaultRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const rpcScope = (scope: ProjectGanttScope) => ({
  p_project_id: scope.projectId,
  p_construction_site_id: scope.constructionSiteId || '',
});

export const createProjectGanttCommandService = (dependencies: ProjectGanttCommandDependencies) => {
  const executeCommand = async (
    rpcName: string,
    scope: ProjectGanttScope,
    requestId: string | undefined,
    payload: Record<string, unknown>,
    invalidatesTasks = false,
  ): Promise<ProjectGanttCommandResult> => {
    const effectiveRequestId = requestId || dependencies.newRequestId();
    const { data, error } = await dependencies.rpc(rpcName, {
      p_request_id: effectiveRequestId,
      ...rpcScope(scope),
      ...payload,
    });
    if (error) throw parseProjectGanttCommandError(error);
    if (!data?.ok) throw parseProjectGanttCommandError(data);

    const mapped = fromDb(data) as ProjectGanttCommandResult;
    const result = { ...mapped, mutated: !mapped.replayed };
    if (invalidatesTasks && result.mutated) dependencies.invalidateTasks();
    return result;
  };

  return {
    saveTasks(
      scope: ProjectGanttScope,
      changes: ProjectGanttTaskChange[],
      requestId?: string,
    ): Promise<ProjectGanttCommandResult> {
      return executeCommand('save_project_gantt_tasks', scope, requestId, {
        p_changes: toDb(changes),
      }, true);
    },

    deleteTaskTree(
      scope: ProjectGanttScope,
      taskId: string,
      expectedRowVersion: number,
      requestId?: string,
    ): Promise<ProjectGanttCommandResult> {
      return executeCommand('delete_project_gantt_task_tree', scope, requestId, {
        p_task_id: taskId,
        p_expected_row_version: expectedRowVersion,
      }, true);
    },

    replaceTaskContractItems(
      scope: ProjectGanttScope,
      taskId: string,
      expectedRowVersion: number,
      contractItemIds: string[],
      requestId?: string,
    ): Promise<ProjectGanttCommandResult> {
      return executeCommand('replace_project_gantt_task_contract_items', scope, requestId, {
        p_task_id: taskId,
        p_expected_row_version: expectedRowVersion,
        p_contract_item_ids: contractItemIds,
      }, true);
    },

    createBaseline(
      scope: ProjectGanttScope,
      name: string,
      requestId?: string,
    ): Promise<ProjectGanttCommandResult> {
      return executeCommand('create_project_gantt_baseline', scope, requestId, {
        p_name: name,
      });
    },

    transitionDelayEvent(
      scope: ProjectGanttScope,
      eventId: string,
      status: 'accepted' | 'resolved' | 'void',
      expectedUpdatedAt: string,
      requestId?: string,
    ): Promise<ProjectGanttCommandResult> {
      return executeCommand('transition_project_gantt_delay_event', scope, requestId, {
        p_event_id: eventId,
        p_status: status,
        p_expected_updated_at: expectedUpdatedAt,
      });
    },

    applyForecast(
      scope: ProjectGanttScope,
      input: {
        revision: Record<string, unknown>;
        revisionTasks: Record<string, unknown>[];
        taskChanges: ProjectGanttTaskChange[];
      },
      requestId?: string,
    ): Promise<ProjectGanttCommandResult> {
      return executeCommand('apply_project_gantt_forecast', scope, requestId, {
        p_revision: toDb(input.revision),
        p_revision_tasks: toDb(input.revisionTasks),
        p_task_changes: toDb(input.taskChanges),
      }, true);
    },

    async loadCatalog(
      scope: ProjectGanttScope,
      consumerRoom: ProjectGanttConsumerRoom,
    ): Promise<ProjectGanttCatalogTask[]> {
      const { data, error } = await dependencies.rpc('get_project_gantt_catalog', {
        ...rpcScope(scope),
        p_consumer_room: consumerRoom,
      });
      if (error) throw parseProjectGanttCommandError(error);
      return fromDb(data || []) as ProjectGanttCatalogTask[];
    },
  };
};

export const projectGanttCommandService = createProjectGanttCommandService({
  rpc: (name, payload) => supabase.rpc(name as never, payload as never) as unknown as PromiseLike<RpcResult>,
  invalidateTasks: () => taskService.invalidateListCache(),
  newRequestId: defaultRequestId,
});
