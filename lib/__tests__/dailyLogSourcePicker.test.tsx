import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogSourcePicker } from '../../components/project/daily-log/DailyLogSourcePicker';
import { toggleDailyLogSourceSelection } from '../dailyLogWorkflow';
import type { DailyLogContribution } from '../../types';

const sources: DailyLogContribution[] = [
  { id: 'A', date: '2026-09-26', authorUserId: 'user-a', authorName: 'Kỹ sư A', workAreaName: 'Khu A', content: '', status: 'submitted', createdAt: '2026-09-26T00:00:00Z' },
  { id: 'B', date: '2026-09-26', authorUserId: 'user-a', authorName: 'Kỹ sư A', workAreaName: 'Khu B', content: '', status: 'returned', returnReason: 'Bổ sung khối lượng', createdAt: '2026-09-26T01:00:00Z' },
];

describe('Daily Log explicit source picker', () => {
  it('shows the author, area, localized status and a clear create-area action', () => {
    const html = renderToStaticMarkup(<DailyLogSourcePicker sources={sources} selectedIds={[]} selectionMode="single" onChange={() => {}} onCreateArea={() => {}} />);
    expect(html).toContain('Kỹ sư A');
    expect(html).toContain('Khu A');
    expect(html).toContain('Khu B');
    expect(html).toContain('Cần sửa');
    expect(html).toContain('Tạo phiếu khu vực khác');
    expect(html).not.toContain('checked=""');
  });

  it('keeps a returned slip visible but blocks adding it to a summary', () => {
    const html = renderToStaticMarkup(<DailyLogSourcePicker sources={sources} selectedIds={[]} selectionMode="multiple" onChange={() => {}} />);
    expect(html).toContain('Bổ sung khối lượng');
    expect(html).toMatch(/<input(?=[^>]*value="B")(?=[^>]*disabled="")[^>]*>/);
    expect(toggleDailyLogSourceSelection({ sources, selectedIds: ['A'], sourceId: 'B', selectionMode: 'multiple' })).toEqual(['A']);
  });

  it('opens returned own source in single mode, while multiple mode can remove an existing returned selection', () => {
    expect(toggleDailyLogSourceSelection({ sources, selectedIds: ['A'], sourceId: 'B', selectionMode: 'single' })).toEqual(['B']);
    expect(toggleDailyLogSourceSelection({ sources, selectedIds: ['A', 'B'], sourceId: 'B', selectionMode: 'multiple' })).toEqual(['A']);
  });

  it('does not auto-select or invent missing IDs; selection is explicit and stable', () => {
    expect(toggleDailyLogSourceSelection({ sources, selectedIds: [], sourceId: 'missing', selectionMode: 'single' })).toEqual([]);
    expect(toggleDailyLogSourceSelection({ sources, selectedIds: [], sourceId: 'A', selectionMode: 'multiple' })).toEqual(['A']);
    expect(toggleDailyLogSourceSelection({ sources, selectedIds: ['A'], sourceId: 'A', selectionMode: 'single' })).toEqual(['A']);
  });

  it('explains an empty source list rather than implying all engineers submitted', () => {
    const html = renderToStaticMarkup(<DailyLogSourcePicker sources={[]} selectedIds={[]} selectionMode="multiple" onChange={() => {}} />);
    expect(html).toContain('Chưa có phiếu');
    expect(html).not.toContain('đủ kỹ sư');
  });
});
