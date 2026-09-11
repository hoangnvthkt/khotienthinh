import type { ModuleLoadStatus } from '../context/AppContext';
import type {
  ProjectWorkflowAction,
  ProjectWorkflowRollbackDependencyResult,
  ProjectProgressCalculationMode,
} from '../types';

export type WorkflowDependencyGateState = 'not_required' | 'loading' | 'error' | 'blocked' | 'ready';

export const resolveWorkflowDependencyGate = (input: {
  action: ProjectWorkflowAction;
  loading: boolean;
  error: string | null;
  dependencies: ProjectWorkflowRollbackDependencyResult | null;
}): { blocked: boolean; state: WorkflowDependencyGateState } => {
  if (input.action !== 'reject' && input.action !== 'rollback') {
    return { blocked: false, state: 'not_required' };
  }
  if (input.loading) return { blocked: true, state: 'loading' };
  if (input.error || !input.dependencies) return { blocked: true, state: 'error' };
  if (!input.dependencies.allowed) return { blocked: true, state: 'blocked' };
  return { blocked: false, state: 'ready' };
};

export type ProjectSiteState = 'unlinked' | 'loading' | 'error' | 'unavailable' | 'ready';

export const resolveProjectSiteState = (input: {
  constructionSiteId?: string | null;
  siteResolved: boolean;
  moduleStatus: ModuleLoadStatus;
}): { hasSiteScope: boolean; state: ProjectSiteState } => {
  if (!input.constructionSiteId) return { hasSiteScope: false, state: 'unlinked' };
  if (input.siteResolved) return { hasSiteScope: true, state: 'ready' };
  if (input.moduleStatus === 'idle' || input.moduleStatus === 'loading') {
    return { hasSiteScope: true, state: 'loading' };
  }
  if (input.moduleStatus === 'error') return { hasSiteScope: true, state: 'error' };
  return { hasSiteScope: true, state: 'unavailable' };
};

export const mergeWorkflowDependencyLabels = (
  result: ProjectWorkflowRollbackDependencyResult,
  labels: Array<{ id: string; label: string }>,
): ProjectWorkflowRollbackDependencyResult => {
  const labelById = new Map(labels.map(item => [item.id, item.label]));
  return {
    ...result,
    dependencies: result.dependencies.map(dependency => ({
      ...dependency,
      label: dependency.id ? labelById.get(dependency.id) || dependency.label : dependency.label,
    })),
  };
};

export const buildWorkflowDependencyUrl = (input: {
  dependency: ProjectWorkflowRollbackDependencyResult['dependencies'][number];
  projectId?: string | null;
  constructionSiteId?: string | null;
}): string | null => {
  if (input.dependency.type !== 'purchase_order' || !input.dependency.id) return null;
  const params = new URLSearchParams();
  if (input.projectId) params.set('projectId', input.projectId);
  if (input.constructionSiteId) params.set('siteId', input.constructionSiteId);
  params.set('tab', 'material');
  params.set('materialTab', 'po');
  params.set('poId', input.dependency.id);
  return `/da?${params.toString()}`;
};

export const getWorkflowActionErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('active downstream dependencies')) {
    return 'Chứng từ liên quan vừa thay đổi. Hãy mở PO/đợt cấp đang hoạt động để xử lý, sau đó thử lại.';
  }
  return message || 'Không xử lý được workflow.';
};

export type ProjectProgressLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export const resolveProjectProgressDisplay = (input: {
  mode: ProjectProgressCalculationMode;
  taskStatus: ProjectProgressLoadStatus;
  taskProgress?: number;
  financeProgress?: number;
  manualProgress?: number;
}): { state: 'loading' | 'ready' | 'error' | 'empty'; percent: number | null; label: string } => {
  if (input.mode === 'manual') {
    const percent = Number(input.manualProgress || 0);
    return { state: 'ready', percent, label: `Tiến độ: ${percent}%` };
  }
  if (input.taskStatus === 'idle' || input.taskStatus === 'loading') {
    return { state: 'loading', percent: null, label: 'Đang tải tiến độ…' };
  }
  if (input.taskProgress !== undefined) {
    return { state: 'ready', percent: input.taskProgress, label: `Tiến độ: ${input.taskProgress}%` };
  }
  if (input.taskStatus === 'error') {
    return { state: 'error', percent: null, label: 'Không tải được tiến độ' };
  }
  if (input.financeProgress !== undefined) {
    return { state: 'ready', percent: input.financeProgress, label: `Tiến độ: ${input.financeProgress}%` };
  }
  return { state: 'empty', percent: null, label: 'Chưa có tiến độ' };
};
