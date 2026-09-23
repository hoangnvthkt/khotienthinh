import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DailyLogWbsBundle } from '../dailyLogWbsService';
import { DailyLogWbsPicker } from '../../components/project/daily-log/DailyLogWbsPicker';
import {
  DailyLogContributionWorkEditor,
  buildContributionSaveInput,
  type ContributionEditorDraft,
} from '../../components/project/daily-log/DailyLogContributionWorkEditor';

const tasks = [
  { id: 'parent', name: 'Phần móng', wbsCode: '1', parentId: null, startDate: '2026-09-20', endDate: '2026-09-30' },
  { id: 'task-1', name: 'Bê tông móng', wbsCode: '1.1', parentId: 'parent', startDate: '2026-09-22', endDate: '2026-09-24', fallbackUnit: 'm³', provisionalQuantity: 100 },
  { id: 'task-2', name: 'Công tác phụ', wbsCode: '1.2', parentId: 'parent', startDate: '2026-09-22', endDate: '2026-09-25', fallbackUnit: 'm³', provisionalQuantity: 0 },
] as DailyLogWbsBundle['tasks'];

const bundle: DailyLogWbsBundle = {
  rollout: { mode: 'pilot', cutoverDate: '2026-09-23', enabled: true },
  tasks,
  workBoqItems: [],
  resourceProviders: [],
  previousProgressRows: [{
    id: 'progress-1', scopeKey: 'project-1_site-1', projectId: 'project-1', constructionSiteId: 'site-1',
    taskId: 'task-1', progressDate: '2026-09-22', weekStart: '2026-09-21',
    progressPercent: 10, quantityDone: 10, dailyQuantityDone: 10,
  }],
  nextProgressRows: [],
  contribution: {
    id: 'contribution-1', projectId: 'project-1', constructionSiteId: 'site-1', date: '2026-09-23',
    authorUserId: 'user-1', content: '', status: 'draft', rowVersion: 3,
    workAreaCode: 'A', workAreaName: 'Khu A', createdAt: '2026-09-23T00:00:00Z',
  },
  contributionsForSummary: [], summaryLog: null, summarySources: [],
  workItems: [{
    id: 'work-1', ownerType: 'contribution', contributionId: 'contribution-1', taskId: 'task-1',
    workAreaCode: 'A', workAreaName: 'Khu A', wbsCode: '1.1', taskName: 'Bê tông móng', unit: 'm³',
    plannedQuantity: 100, baselineProgressPercent: 10, baselineQuantityDone: 10,
    cumulativeProgressPercent: 30, cumulativeQuantityDone: 30, dailyQuantityDone: 20,
  }],
  decisions: [], labor: [], machines: [], periodState: null,
  permissions: { canEditSource: true, canSummarize: false, canApprove: false, canPublishProgress: false },
};

describe('DailyLogContributionWorkEditor', () => {
  it('only exposes checkboxes for leaf WBS tasks', () => {
    const html = renderToStaticMarkup(<DailyLogWbsPicker
      tasks={tasks} workBoqItems={[]} selectedTaskIds={new Set()} recentTaskIds={[]}
      onConfirm={() => undefined} onClose={() => undefined}
    />);
    expect(html).toContain('Phần móng');
    expect(html).toContain('aria-label="Chọn 1.1 Bê tông móng"');
    expect(html).toContain('aria-label="Chọn 1.2 Công tác phụ"');
    expect(html).not.toContain('aria-label="Chọn 1 Phần móng"');
  });

  it('shows cumulative progress and derives today quantity from the prior baseline', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={bundle} />);
    expect(html).toContain('1.1 Bê tông móng');
    expect(html).toContain('aria-label="% lũy kế"');
    expect(html).toContain('value="30"');
    expect(html).toContain('Khối lượng hôm nay: 20 m³');
  });

  it('does not disguise a missing planned quantity as zero', () => {
    const missingBundle: DailyLogWbsBundle = {
      ...bundle,
      workItems: [{ ...bundle.workItems[0], id: 'work-2', taskId: 'task-2', taskName: 'Công tác phụ', wbsCode: '1.2', plannedQuantity: null, cumulativeProgressPercent: 30, cumulativeQuantityDone: null, dailyQuantityDone: null }],
    };
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={missingBundle} />);
    expect(html).toContain('Chưa có cơ sở quy đổi');
    expect(html).not.toMatch(/>0 m³</);
  });

  it('blocks draft saving when a physical resource has no provider', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor
      bundle={{ ...bundle, labor: [{ laborType: 'Tổ xây dựng', taskId: 'task-1', count: 5, hours: 8 }] }}
    />);
    expect(html).toContain('Chọn NCC/đội hoặc nhập tay');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Lưu nháp|<button[^>]*disabled=""[^>]*[\s\S]*Lưu nháp/);
  });

  it('keeps an inactive catalog provider visible and blocks saving until it is replaced', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{
      ...bundle,
      resourceProviders: [{ id: 'provider-1', name: 'Đội cọc cũ', code: 'NCC-01', classifications: [], isActive: false }],
      labor: [{
        laborType: 'Tổ xây dựng', taskId: 'task-1', count: 5, hoursPerPerson: 8,
        partnerId: 'provider-1', providerEntryMode: 'catalog', partnerName: 'Đội cọc cũ',
      } as any],
    }} />);
    expect(html).toContain('Đội cọc cũ (đã ngừng hoạt động)');
    expect(html).toContain('Nguồn danh mục đã ngừng hoạt động');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Lưu nháp/);
  });

  it('builds a physical-only payload for a valid manual labor provider', () => {
    const draft: ContributionEditorDraft = {
      workAreaCode: 'A', workAreaName: 'Khu A',
      items: [{ clientKey: 'work-1', taskId: 'task-1', cumulativeProgressPercent: 30 }],
      labor: [{
        workItemClientKey: 'work-1', laborType: 'Tổ xây dựng', peopleCount: 5, hoursPerPerson: 8,
        provider: { entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: 'Tổ anh Minh' },
      }],
      machines: [],
    };
    const payload = buildContributionSaveInput(bundle.contribution!, draft);
    expect(payload.labor[0]).toEqual({
      workItemClientKey: 'work-1', laborType: 'Tổ xây dựng', peopleCount: 5, hoursPerPerson: 8,
      provider: { entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: 'Tổ anh Minh' },
    });
    expect(JSON.stringify(payload)).not.toMatch(/unitCost|totalCost|rate|amount/i);
  });

  it('renders loading, empty, denied, returned, conflict and read-only states explicitly', () => {
    expect(renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={null} loading />)).toContain('Đang tải công việc WBS');
    expect(renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...bundle, tasks: [], workItems: [] }} />)).toContain('Chưa có WBS để ghi nhận');
    expect(renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={bundle} denied />)).toContain('Bạn chưa có quyền sửa phiếu nguồn');
    expect(renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...bundle, contribution: { ...bundle.contribution!, status: 'returned', returnReason: 'Bổ sung ảnh' } }} />)).toContain('Phiếu đã được trả lại');
    expect(renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={bundle} error="Phiếu đã được người khác vừa cập nhật" />)).toContain('Tải dữ liệu mới');
    expect(renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...bundle, contribution: { ...bundle.contribution!, status: 'submitted' } }} />)).toContain('Phiếu đã gửi, dữ liệu đang ở chế độ chỉ đọc');
  });

  it('integrates the WBS editor behind rollout while preserving the legacy editor', () => {
    const dailyLogTab = readFileSync(resolve(process.cwd(), 'pages/project/DailyLogTab.tsx'), 'utf8');
    const detailTabs = readFileSync(resolve(process.cwd(), 'components/project/DailyLogDetailTabs.tsx'), 'utf8');
    expect(dailyLogTab).toContain('wbsBundle?.rollout.enabled');
    expect(dailyLogTab).toContain('fDate >= wbsBundle.rollout.cutoverDate');
    expect(dailyLogTab).toContain('<DailyLogContributionWorkEditor');
    expect(dailyLogTab).toContain(': <DailyLogDetailTabs');
    expect(detailTabs).toContain('onImportDailyProgressVolumes && !hideDailyProgressImport');
  });
});
