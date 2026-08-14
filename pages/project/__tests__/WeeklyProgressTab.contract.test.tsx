import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as weeklyProgressTabModule from '../WeeklyProgressTab';

const renderControls = (patch: Record<string, unknown> = {}) => {
  const Controls = (weeklyProgressTabModule as any).WeeklyProgressPeriodControls;
  expect(Controls).toBeTypeOf('function');
  if (typeof Controls !== 'function') return '';

  return renderToStaticMarkup(
    <Controls
      periodType="daily"
      periodStart="2026-08-08"
      stateLoaded
      state={{ isLocked: false }}
      canEdit={false}
      canConfirm={false}
      busy={false}
      hasRows
      onSave={vi.fn()}
      onClose={vi.fn()}
      onReopen={vi.fn()}
      {...patch}
    />,
  );
};

describe('WeeklyProgressTab period controls', () => {
  it('derives chart history and mutation rows from one authoritative period bundle', () => {
    const buildBundleView = (weeklyProgressTabModule as any).buildWeeklyProgressBundleView;
    expect(buildBundleView).toBeTypeOf('function');
    if (typeof buildBundleView !== 'function') return;

    const dailyBaseline = {
      id: 'daily-baseline',
      scopeKey: 'project-1_site-1',
      taskId: 'task-1',
      progressDate: '2026-08-02',
      weekStart: '2026-07-27',
      progressPercent: 20,
      quantityDone: 2,
      dailyQuantityDone: 2,
    };
    const dailyCurrent = {
      ...dailyBaseline,
      id: 'daily-current',
      progressDate: '2026-08-07',
      weekStart: '2026-08-03',
      progressPercent: 40,
      quantityDone: 4,
      dailyQuantityDone: 2,
    };
    const weeklyCurrent = {
      id: 'weekly-current',
      scopeKey: 'project-1_site-1',
      taskId: 'task-1',
      weekStart: '2026-08-03',
      progressPercent: 40,
      quantityDone: 4,
    };

    const view = buildBundleView({
      dailyRows: [dailyCurrent],
      dailyBaselineRows: [dailyBaseline],
      weeklyRows: [weeklyCurrent],
      weeklyBaselineRows: [],
      selectedWeeklyRows: [weeklyCurrent],
      windowFromWeek: '2026-06-15',
      windowToWeek: '2026-08-03',
    });

    expect(view.allDailyProgress.map((row: { id: string }) => row.id))
      .toEqual(['daily-baseline', 'daily-current']);
    expect(view.selectedDailyMutationRows.map((row: { id: string }) => row.id))
      .toEqual(['daily-baseline', 'daily-current']);
    expect(view.allWeeklyProgress).toEqual([weeklyCurrent]);
    expect(view.selectedWeeklyMutationRows).toEqual([weeklyCurrent]);
    expect(view.loadedWeekRange).toEqual({
      fromWeek: '2026-06-15',
      toWeek: '2026-08-03',
    });
  });

  it('reloads the newly selected date in the same week when an older save resolves', async () => {
    const completeMutation = (weeklyProgressTabModule as any).completeWeeklyProgressMutationWithReload;
    expect(completeMutation).toBeTypeOf('function');
    if (typeof completeMutation !== 'function') return;

    let resolveSave!: () => void;
    const save = new Promise<void>(resolve => { resolveSave = resolve; });
    let currentTarget = {
      key: 'project-1_site-1__daily__2026-08-07',
      scopeKey: 'project-1_site-1',
      periodType: 'daily',
      periodStart: '2026-08-07',
    };
    const reloadedKeys: string[] = [];

    const completion = completeMutation({
      capturedTarget: currentTarget,
      mutate: () => save,
      getCurrentTarget: () => currentTarget,
      reload: async (target: { key: string }) => { reloadedKeys.push(target.key); },
    });

    currentTarget = {
      key: 'project-1_site-1__daily__2026-08-08',
      scopeKey: 'project-1_site-1',
      periodType: 'daily',
      periodStart: '2026-08-08',
    };
    resolveSave();

    await expect(completion).resolves.toMatchObject({ ok: true, remainedOnCapturedTarget: false });
    expect(reloadedKeys).toEqual(['project-1_site-1__daily__2026-08-08']);
  });

  it('returns a stale failure outcome without throwing after the selected period changes', async () => {
    const completeMutation = (weeklyProgressTabModule as any).completeWeeklyProgressMutationWithReload;
    expect(completeMutation).toBeTypeOf('function');
    if (typeof completeMutation !== 'function') return;

    const capturedTarget = {
      key: 'project-1_site-1__weekly__2026-08-03',
      scopeKey: 'project-1_site-1',
      periodType: 'weekly',
      periodStart: '2026-08-03',
    };
    const currentTarget = {
      ...capturedTarget,
      key: 'project-1_site-1__weekly__2026-08-10',
      periodStart: '2026-08-10',
    };
    const failure = new Error('captured period failed');

    await expect(completeMutation({
      capturedTarget,
      mutate: async () => { throw failure; },
      getCurrentTarget: () => currentTarget,
      reload: vi.fn().mockResolvedValue(undefined),
    })).resolves.toEqual({
      ok: false,
      error: failure,
      remainedOnCapturedTarget: false,
    });
  });

  it('gates every mutation handler outcome before filters or notifications', () => {
    const source = readFileSync(new URL('../WeeklyProgressTab.tsx', import.meta.url), 'utf8');
    const handlerNames = [
      'handleSaveDailyProgress',
      'handleSaveWeeklyProgress',
      'handleCloseProgressPeriod',
      'handleReopenProgressPeriod',
    ];

    handlerNames.forEach((handlerName, index) => {
      const start = source.indexOf(`const ${handlerName}`);
      const end = index + 1 < handlerNames.length
        ? source.indexOf(`const ${handlerNames[index + 1]}`, start)
        : source.indexOf('// Flatten tree construction', start);
      expect(start).toBeGreaterThan(-1);
      expect(source.slice(start, end)).toContain('if (!outcome.remainedOnCapturedTarget) return;');
    });
  });

  it('invalidates immediately and applies only the newest keyed resource generation', async () => {
    const runReload = (weeklyProgressTabModule as any).runWeeklyProgressKeyedReload;
    expect(runReload).toBeTypeOf('function');
    if (typeof runReload !== 'function') return;

    let currentKey = 'project-1_site-1__daily__2026-08-07';
    let generation = 1;
    let resolveOld!: (value: { state: string; drafts: string }) => void;
    const oldRead = new Promise<{ state: string; drafts: string }>(resolve => { resolveOld = resolve; });
    const events: string[] = [];

    const oldReload = runReload({
      targetKey: currentKey,
      generation,
      read: () => oldRead,
      getCurrentKey: () => currentKey,
      getGeneration: () => generation,
      onInvalidate: () => events.push('invalidate-old'),
      onReady: () => events.push('ready-old'),
      onError: () => events.push('error-old'),
    });
    expect(events).toEqual(['invalidate-old']);

    currentKey = 'project-1_site-1__daily__2026-08-08';
    generation = 2;
    await runReload({
      targetKey: currentKey,
      generation,
      read: async () => ({ state: 'new-state', drafts: 'new-drafts' }),
      getCurrentKey: () => currentKey,
      getGeneration: () => generation,
      onInvalidate: () => events.push('invalidate-new'),
      onReady: value => events.push(`ready-${value.state}`),
      onError: () => events.push('error-new'),
    });
    resolveOld({ state: 'old-state', drafts: 'old-drafts' });
    await oldReload;

    expect(events).toEqual(['invalidate-old', 'invalidate-new', 'ready-new-state']);
  });

  it('keeps chart history independent from strict selected-period mutation rows', () => {
    const findLatest = (weeklyProgressTabModule as any).getLatestDailyProgressRow;
    expect(findLatest).toBeTypeOf('function');
    if (typeof findLatest !== 'function') return;

    const chartRows = [{
      id: 'daily-1',
      scopeKey: 'project-1_site-1',
      taskId: 'task-1',
      progressDate: '2026-08-07',
      weekStart: '2026-08-03',
      progressPercent: 55,
      quantityDone: 5.5,
      dailyQuantityDone: 1,
    }];
    const strictWeeklyModeRows: unknown[] = [];

    expect(findLatest(chartRows, 'project-1_site-1', 'task-1', '2026-08-07')).toMatchObject({
      id: 'daily-1',
      progressPercent: 55,
    });
    expect(findLatest(strictWeeklyModeRows, 'project-1_site-1', 'task-1', '2026-08-07')).toBeUndefined();

    const source = readFileSync(new URL('../WeeklyProgressTab.tsx', import.meta.url), 'utf8');
    const historyStart = source.indexOf('const dailyHistoryRollup');
    const historyEnd = source.indexOf('const staffMap', historyStart);
    expect(source.slice(historyStart, historyEnd)).toContain('getLatestDailyProgressRow(allDailyProgress');
  });

  it('keys base data loading by scope and blocks mutations until it is current', () => {
    const source = readFileSync(new URL('../WeeklyProgressTab.tsx', import.meta.url), 'utf8');
    expect(source).toContain('baseDataLoadKey');
    expect(source).toContain('baseDataRequestGeneration');
    expect(source).toContain('baseDataReadyForCurrentScope');
    expect(source).toContain('baseDataReady: baseDataReadyForCurrentScope');
  });

  it('renders period data read failures as unavailable with retry and no mutations', () => {
    const Unavailable = (weeklyProgressTabModule as any).WeeklyProgressPeriodUnavailable;
    expect(Unavailable).toBeTypeOf('function');
    if (typeof Unavailable !== 'function') return;

    const html = renderToStaticMarkup(<Unavailable onRetry={vi.fn()} />);
    expect(html).toContain('Không thể tải dữ liệu kỳ tiến độ');
    expect(html).toContain('Thử lại');
    expect(html).not.toContain('Lưu thay đổi');
    expect(html).not.toContain('>Chốt<');
    expect(html).not.toContain('Mở chốt');
  });

  it('does not expose mutations before the selected period state loads', () => {
    const html = renderControls({
      stateLoaded: false,
      state: null,
      canEdit: true,
      canConfirm: true,
    });

    expect(html).toContain('Đang tải trạng thái');
    expect(html).not.toContain('Lưu thay đổi');
    expect(html).not.toContain('>Chốt<');
    expect(html).not.toContain('Mở chốt');
  });

  it('shows open status and the independently granted save and close actions', () => {
    const html = renderControls({ canEdit: true, canConfirm: true });

    expect(html).toContain('Đang mở');
    expect(html).toContain('Lưu thay đổi');
    expect(html).toContain('>Chốt<');
    expect(html).not.toContain('Mở chốt');
  });

  it('shows only reopen for a closer viewing a locked period', () => {
    const html = renderControls({
      state: { isLocked: true },
      canEdit: true,
      canConfirm: true,
    });

    expect(html).toContain('Đã chốt');
    expect(html).toContain('Mở chốt');
    expect(html).not.toContain('Lưu thay đổi');
    expect(html).not.toContain('>Chốt<');
  });

  it('preserves status-only viewing without edit or confirm actions', () => {
    const html = renderControls();

    expect(html).toContain('Đang mở');
    expect(html).not.toContain('<button');
  });

  it('keeps every mutation disabled until state and drafts match the current period key', () => {
    const periodKey = (weeklyProgressTabModule as any).getWeeklyProgressPeriodKey;
    const getReadiness = (weeklyProgressTabModule as any).getWeeklyProgressMutationReadiness;
    expect(periodKey).toBeTypeOf('function');
    expect(getReadiness).toBeTypeOf('function');
    if (typeof periodKey !== 'function' || typeof getReadiness !== 'function') return;

    const oldKey = periodKey('project-1_site-1', 'daily', '2026-08-07');
    const currentKey = periodKey('project-1_site-1', 'daily', '2026-08-08');

    expect(getReadiness({
      actionsLoaded: true,
      canView: true,
      canEdit: true,
      canConfirm: true,
      currentKey,
      stateKey: currentKey,
      draftKey: oldKey,
      isLocked: false,
    })).toEqual({ canSave: false, canClose: false, canReopen: false });

    expect(getReadiness({
      actionsLoaded: true,
      canView: true,
      canEdit: true,
      canConfirm: true,
      currentKey,
      stateKey: oldKey,
      draftKey: currentKey,
      isLocked: true,
    })).toEqual({ canSave: false, canClose: false, canReopen: false });

    expect(getReadiness({
      actionsLoaded: true,
      canView: true,
      canEdit: true,
      canConfirm: true,
      currentKey,
      stateKey: currentKey,
      draftKey: currentKey,
      isLocked: false,
    })).toEqual({ canSave: true, canClose: true, canReopen: false });
  });

  it('renders an explicit retry surface instead of the workspace when action loading fails', () => {
    const Unavailable = (weeklyProgressTabModule as any).WeeklyProgressPermissionUnavailable;
    expect(Unavailable).toBeTypeOf('function');
    if (typeof Unavailable !== 'function') return;

    const html = renderToStaticMarkup(<Unavailable state="error" onRetry={vi.fn()} />);
    expect(html).toContain('Không thể tải quyền tiến độ');
    expect(html).toContain('Thử lại');
  });

  it('keys async state and draft readiness and rejects stale request generations', () => {
    const source = readFileSync(new URL('../WeeklyProgressTab.tsx', import.meta.url), 'utf8');

    expect(source).toContain('periodStateRequestGeneration.current');
    expect(source).toContain('dailyPeriodStateKey');
    expect(source).toContain('weeklyPeriodStateKey');
    expect(source).toContain('dailyDraftKey');
    expect(source).toContain('weeklyDraftKey');
  });
});
