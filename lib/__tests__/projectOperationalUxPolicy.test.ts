import { describe, expect, it } from 'vitest';
import type { ProjectWorkflowRollbackDependencyResult } from '../../types';
import {
  buildWorkflowDependencyUrl,
  getWorkflowActionErrorMessage,
  mergeWorkflowDependencyLabels,
  resolveProjectProgressDisplay,
  resolveProjectSiteState,
  resolveWorkflowDependencyGate,
} from '../projectOperationalUxPolicy';

const activePo: ProjectWorkflowRollbackDependencyResult = {
  allowed: false,
  activeCount: 1,
  dependencies: [{ type: 'purchase_order', id: 'po-462', status: 'active' }],
};

describe('project operational UX policy', () => {
  it.each(['reject', 'rollback'] as const)(
    'blocks %s while downstream dependencies are loading',
    action => {
      expect(resolveWorkflowDependencyGate({ action, loading: true, error: null, dependencies: null }))
        .toEqual({ blocked: true, state: 'loading' });
    },
  );

  it.each(['reject', 'rollback'] as const)(
    'blocks %s when the downstream dependency check fails',
    action => {
      expect(resolveWorkflowDependencyGate({
        action,
        loading: false,
        error: 'Mất kết nối',
        dependencies: null,
      })).toEqual({ blocked: true, state: 'error' });
    },
  );

  it.each(['reject', 'rollback'] as const)(
    'blocks %s when an active PO exists',
    action => {
      expect(resolveWorkflowDependencyGate({
        action,
        loading: false,
        error: null,
        dependencies: activePo,
      })).toEqual({ blocked: true, state: 'blocked' });
    },
  );

  it('allows reject after a successful clean dependency check', () => {
    expect(resolveWorkflowDependencyGate({
      action: 'reject',
      loading: false,
      error: null,
      dependencies: { allowed: true, activeCount: 0, dependencies: [] },
    })).toEqual({ blocked: false, state: 'ready' });
  });

  it('does not require a downstream check for return', () => {
    expect(resolveWorkflowDependencyGate({
      action: 'return',
      loading: false,
      error: null,
      dependencies: activePo,
    })).toEqual({ blocked: false, state: 'not_required' });
  });

  it('keeps a project site-linked while site metadata is still loading', () => {
    expect(resolveProjectSiteState({
      constructionSiteId: 'site-1',
      siteResolved: false,
      moduleStatus: 'loading',
    })).toEqual({ hasSiteScope: true, state: 'loading' });
  });

  it('keeps project tabs available when linked site metadata cannot be loaded', () => {
    expect(resolveProjectSiteState({
      constructionSiteId: 'site-1',
      siteResolved: false,
      moduleStatus: 'error',
    })).toEqual({ hasSiteScope: true, state: 'error' });
  });

  it('reports unlinked only when the project has no construction-site id', () => {
    expect(resolveProjectSiteState({
      constructionSiteId: null,
      siteResolved: false,
      moduleStatus: 'loaded',
    })).toEqual({ hasSiteScope: false, state: 'unlinked' });
  });

  it('reports missing metadata separately after a linked site finishes loading', () => {
    expect(resolveProjectSiteState({
      constructionSiteId: 'site-1',
      siteResolved: false,
      moduleStatus: 'loaded',
    })).toEqual({ hasSiteScope: true, state: 'unavailable' });
  });

  it('adds a readable PO number without changing dependency status', () => {
    expect(mergeWorkflowDependencyLabels(activePo, [{ id: 'po-462', label: 'PO-462' }]))
      .toEqual({
        allowed: false,
        activeCount: 1,
        dependencies: [{ type: 'purchase_order', id: 'po-462', status: 'active', label: 'PO-462' }],
      });
  });

  it('builds a project PO deep-link for an active purchase order', () => {
    expect(buildWorkflowDependencyUrl({
      dependency: { type: 'purchase_order', id: 'po-462', status: 'active' },
      projectId: 'project 1',
      constructionSiteId: 'site/1',
    })).toBe('/da?projectId=project+1&siteId=site%2F1&tab=material&materialTab=po&poId=po-462');
  });

  it('turns a server dependency race into an actionable Vietnamese message', () => {
    expect(getWorkflowActionErrorMessage(
      new Error('reject is locked by active downstream dependencies: {"activeCount":1}'),
    )).toBe('Chứng từ liên quan vừa thay đổi. Hãy mở PO/đợt cấp đang hoạt động để xử lý, sau đó thử lại.');
  });

  it('does not show a temporary zero while Gantt progress is loading', () => {
    expect(resolveProjectProgressDisplay({
      mode: 'gantt_weighted',
      taskStatus: 'loading',
      taskProgress: undefined,
      financeProgress: 0,
      manualProgress: 0,
    })).toEqual({ state: 'loading', percent: null, label: 'Đang tải tiến độ…' });
  });

  it('uses calculated Gantt progress after tasks load', () => {
    expect(resolveProjectProgressDisplay({
      mode: 'gantt_weighted',
      taskStatus: 'loaded',
      taskProgress: 73,
      financeProgress: 1,
      manualProgress: 0,
    })).toEqual({ state: 'ready', percent: 73, label: 'Tiến độ: 73%' });
  });

  it('uses manual project progress without waiting for Gantt', () => {
    expect(resolveProjectProgressDisplay({
      mode: 'manual',
      taskStatus: 'loading',
      taskProgress: undefined,
      financeProgress: 1,
      manualProgress: 45,
    })).toEqual({ state: 'ready', percent: 45, label: 'Tiến độ: 45%' });
  });
});
