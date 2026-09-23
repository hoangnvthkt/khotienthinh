import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyProgressCutoverFields } from '../../pages/project/WeeklyProgressTab';

const row = {
  id: 'progress-1', scopeKey: 'project-1', projectId: 'project-1', taskId: 'task-1',
  progressDate: '2026-09-23', weekStart: '2026-09-21', progressPercent: 30,
  quantityDone: 12, dailyQuantityDone: 4, note: 'Đổ bê tông khu A',
  sourceDailyLogId: 'summary-1', updatedAt: '2026-09-23T03:05:00Z',
};

describe('Weekly Progress daily-log cutover', () => {
  it('presents Daily Log progress as read-only with source attribution after cutover', () => {
    const html = renderToStaticMarkup(<DailyProgressCutoverFields
      authoritative
      row={row}
      progressPercent="30"
      quantityDone="12"
      note="Đổ bê tông khu A"
      unit="m³"
      dailyLogHref="/da?tab=dailylog&dailyLogId=summary-1"
      onChange={() => undefined}
    />);

    expect(html).toContain('Nguồn: Nhật ký tổng hợp');
    expect(html).toContain('Mở nhật ký');
    expect(html).toContain('dailyLogId=summary-1');
    expect(html).not.toContain('aria-label="% hoàn thành"');
  });

  it('keeps the existing manual editor before cutover', () => {
    const html = renderToStaticMarkup(<DailyProgressCutoverFields
      authoritative={false}
      row={null}
      progressPercent="20"
      quantityDone="8"
      note="Legacy"
      unit="m³"
      dailyLogHref={null}
      onChange={() => undefined}
    />);

    expect(html).toContain('aria-label="% hoàn thành"');
    expect(html).toContain('type="number"');
    expect(html).not.toContain('Nguồn: Nhật ký tổng hợp');
  });

  it('removes the legacy reverse import from the Daily Log flow after cutover', () => {
    const dailyLogTab = readFileSync(
      new URL('../../pages/project/DailyLogTab.tsx', import.meta.url),
      'utf8',
    );

    expect(dailyLogTab).toContain(
      'onImportDailyProgressVolumes={isWbsContributionFlow ? undefined : handleImportDailyProgressVolumes}',
    );
  });
});
