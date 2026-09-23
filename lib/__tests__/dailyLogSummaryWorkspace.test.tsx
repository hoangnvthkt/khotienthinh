import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyLogWbsBundle } from '../dailyLogWbsService';
import {
  DailyLogSummaryWorkspace,
  buildDailyLogSummaryDraft,
} from '../../components/project/daily-log/DailyLogSummaryWorkspace';

const contributions = Array.from({ length: 4 }, (_, index) => ({
  id: `contribution-${index + 1}`,
  projectId: 'project-1', constructionSiteId: 'site-1', date: '2026-09-23',
  authorUserId: `user-${index + 1}`, authorName: `Người ${index + 1}`,
  content: `Thi công khu ${index + 1}`, status: 'submitted' as const,
  workAreaCode: `A${index + 1}`, workAreaName: `Khu A${index + 1}`,
  rowVersion: 2, sourceFingerprint: `fingerprint-${index + 1}`,
  createdAt: '2026-09-23T01:00:00Z', updatedAt: `2026-09-23T0${index + 2}:00:00Z`,
}));

const workItems = contributions.map((source, index) => ({
  id: `source-work-${index + 1}`, ownerType: 'contribution' as const,
  contributionId: source.id, taskId: 'task-1', workAreaCode: source.workAreaCode!,
  workAreaName: source.workAreaName!, wbsCode: '1.1', taskName: 'Bê tông móng', unit: 'm³',
  plannedQuantity: 100, areaPlannedQuantity: index < 2 ? 50 : null,
  baselineProgressPercent: 10, baselineQuantityDone: 10,
  cumulativeProgressPercent: 30 + index, cumulativeQuantityDone: 30 + index,
  dailyQuantityDone: 20 + index,
}));

const bundle: DailyLogWbsBundle = {
  rollout: { mode: 'pilot', cutoverDate: '2026-09-23', enabled: true },
  tasks: [], workBoqItems: [], resourceProviders: [], previousProgressRows: [], nextProgressRows: [],
  contribution: null, contributionsForSummary: contributions,
  summaryLog: {
    id: 'summary-1', projectId: 'project-1', constructionSiteId: 'site-1', date: '2026-09-23',
    weather: 'sunny', workerCount: 0, description: 'Tổng hợp', status: 'draft',
    summarySourceType: 'member_contributions', createdBy: 'KTT', createdAt: '2026-09-23T06:00:00Z',
    lastActionAt: '2026-09-23T06:00:00Z',
  },
  summarySources: contributions.map((source, index) => ({
    id: `summary-source-${index + 1}`, dailyLogId: 'summary-1', contributionId: source.id,
    sourceUserId: source.authorUserId, sourceUserName: source.authorName,
    sourceVersion: source.rowVersion, sourceFingerprint: source.sourceFingerprint,
    sourceState: index === 0 ? 'changed' : 'current', reviewStatus: 'ready',
    workAreaCode: source.workAreaCode, workAreaName: source.workAreaName,
    updatedAt: source.updatedAt || undefined,
  })),
  workItems, decisions: [],
  labor: [10, 20, 18, 20].map((peopleCount, index) => ({
    id: `labor-${index + 1}`, contributionId: contributions[index].id,
    dailyLogWorkItemId: workItems[index].id, laborType: 'Tổ xây dựng', count: peopleCount,
    peopleCount, hoursPerPerson: 8, totalLaborHours: peopleCount * 8,
    providerEntryMode: index === 0 ? 'catalog' : 'manual',
    partnerId: index === 0 ? 'partner-1' : null,
    providerNameSnapshot: index === 0 ? 'Công ty An Phát' : null,
    manualProviderType: index === 0 ? null : 'day_labor',
    manualProviderName: index === 0 ? null : `Tổ đội ${index + 1}`,
  } as any)),
  machines: [{
    id: 'machine-1', contributionId: 'contribution-1', dailyLogWorkItemId: 'source-work-1',
    machineName: 'Máy đào', machineType: 'excavator', shifts: 2,
    machineCount: 2, hoursPerMachine: 4, totalMachineHours: 8,
    providerEntryMode: 'manual', manualProviderType: 'machine_owner', manualProviderName: 'Chủ máy anh Bình',
  } as any],
  periodState: null,
  permissions: { canEditSource: false, canSummarize: true, canApprove: true, canPublishProgress: true },
};

describe('DailyLogSummaryWorkspace', () => {
  it('renders four area cards and a useful operational overview', () => {
    const html = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={bundle} mode="summarize" />);
    expect((html.match(/data-testid="daily-log-area-card"/g) || [])).toHaveLength(4);
    expect(html).toContain('4 khu vực');
    expect(html).toContain('68 người');
    expect(html).toContain('2 cảnh báo');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('lg:grid-cols-2');
  });

  it('keeps an adjusted value when a source changes and offers an explicit refresh', () => {
    const adjusted = {
      ...bundle,
      workItems: [{ ...workItems[0], ownerType: 'summary_source' as const, contributionId: null, dailyLogId: 'summary-1', summarySourceId: 'summary-source-1', sourceWorkItemId: workItems[0].id, cumulativeProgressPercent: 35 }, ...workItems],
      summarySources: [{ ...bundle.summarySources[0], hasAdjustments: true, adjustmentReason: 'Đã kiểm tra hiện trường' }, ...bundle.summarySources.slice(1)],
    };
    const html = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={adjusted} mode="summarize" />);
    expect(html).toContain('value="35"');
    expect(html).toContain('Đã điều chỉnh');
    expect(html).toContain('Cập nhật từ phiếu');
  });

  it('blocks submission until ambiguous task scope has an official decision', () => {
    const draft = buildDailyLogSummaryDraft(bundle);
    expect(draft.blockers).toContain('missing_area_allocation');
    const html = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={bundle} mode="summarize" />);
    expect(html).toContain('Nhập % lũy kế chính thức');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Gửi CHT/);
  });

  it('keeps missing or returned source snapshots visible and blocks submission', () => {
    const blocked = {
      ...bundle,
      summarySources: bundle.summarySources.map((source, index) => index === 1 ? { ...source, sourceState: 'missing' as const } : index === 2 ? { ...source, sourceState: 'returned' as const } : source),
    };
    const html = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={blocked} mode="summarize" />);
    expect(html).toContain('Không còn nguồn');
    expect(html).toContain('Đã trả lại');
    expect(html).toContain('Người 2');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Gửi CHT/);
  });

  it('shows catalog and manual provider attribution with physical totals only', () => {
    const html = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={bundle} mode="summarize" />);
    expect(html).toContain('Danh mục');
    expect(html).toContain('Nhập tay');
    expect(html).toContain('Công ty An Phát');
    expect(html).toContain('Chủ máy anh Bình');
    expect(html).toContain('Nhân công nhật');
    expect(html).toContain('Chủ máy');
    expect(html).not.toMatch(/Đơn giá|Thành tiền|Định giá/i);
  });

  it('renders review actions only when approve and publish permissions are both present', () => {
    const reviewBundle = { ...bundle, summaryLog: { ...bundle.summaryLog!, status: 'submitted' as const } };
    const html = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={reviewBundle} mode="review" />);
    expect(html).toContain('Duyệt &amp; công bố');
    expect(html).toContain('Trả lại toàn bộ');
    expect(html).toContain('Yêu cầu sửa khu vực');
    const denied = renderToStaticMarkup(<DailyLogSummaryWorkspace bundle={{ ...reviewBundle, permissions: { ...reviewBundle.permissions, canPublishProgress: false } }} mode="review" />);
    expect(denied).not.toContain('Duyệt &amp; công bố');
  });

  it('keeps the save contract able to address a first-time source by contribution id', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260923093000_daily_log_wbs_area_commands.sql', import.meta.url), 'utf8');
    expect(migration).toContain("source.contribution_id = (payload->>'contributionId')::uuid");
    expect(migration).toContain("item.source_work_item_id = included.work_item_id::uuid");
  });

  it('is wired into both summarize and review surfaces after cutover', () => {
    const page = readFileSync(new URL('../../pages/project/DailyLogTab.tsx', import.meta.url), 'utf8');
    expect(page).toContain('mode="summarize"');
    expect(page).toContain('mode="review"');
    expect(page).toContain('summaryDate >= summaryWbsBundle.rollout.cutoverDate');
    expect(page).toContain('prepareWbsSummaryLog');
  });
});
