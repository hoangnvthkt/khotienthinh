import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
});
