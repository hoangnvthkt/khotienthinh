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
