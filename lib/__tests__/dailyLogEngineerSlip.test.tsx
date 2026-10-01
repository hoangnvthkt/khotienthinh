import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogContributionWorkEditor } from '../../components/project/daily-log/DailyLogContributionWorkEditor';
import type { DailyLogDocumentBundle } from '../dailyLogWbsService';
import { DailyLogResourceEditor } from '../../components/project/daily-log/DailyLogResourceEditor';

export const engineerBundle: DailyLogDocumentBundle = {
  rollout: { mode: 'pilot', cutoverDate: '2026-09-23', enabled: true },
  tasks: [{ id: 'task-1', name: 'Bê tông móng', wbsCode: '1.1', fallbackUnit: 'm³', provisionalQuantity: 100, endDate: '2026-09-30' } as any],
  workBoqItems: [], resourceProviders: [], previousProgressRows: [], nextProgressRows: [],
  contribution: { id: 'source-A', date: '2026-09-27', authorUserId: 'engineer', authorName: 'Kỹ sư Minh',
    workAreaCode: 'A', workAreaName: 'Khu A', content: 'Nội dung cũ', issues: 'Lối vào hẹp',
    photos: [{ name: 'Ảnh hiện trường', url: '/existing-photo.png' }], status: 'draft', rowVersion: 4,
    sourceDocumentVersion: 2, createdAt: '2026-09-27T00:00:00Z',
    sourceDraftPayload: { workAreaCode: 'A', workAreaName: 'Khu A', content: 'Nội dung cũ', issues: 'Lối vào hẹp',
      photos: [{ name: 'Ảnh hiện trường', url: '/existing-photo.png' }], savedRowVersion: 4,
      items: [{ clientKey: 'item-1', taskId: 'task-1', entryMode: 'daily_quantity', enteredValue: '12,5',
        baselineFingerprint: 'qualified-A', note: 'Ghi chú hạng mục', forecastFinishDate: '2026-09-30' }], labor: [], machines: [] } },
  myContributions: [], baselineQuantityStates: { 'task-1': 'known' }, baselineQuantityFingerprints: { 'task-1': 'qualified-A' },
  quantityBaselines: { 'task-1': { state: 'known', fingerprint: 'qualified-A', allowOver100: true, priorRowId: 'prior',
    previousItem: { cumulativeQuantityDone: 40, areaPlannedQuantitySnapshot: 100, unitSnapshot: 'm³' }, nextItem: null } },
  contributionsForSummary: [], summaryLog: null, summarySources: [], workItems: [], decisions: [], labor: [], machines: [], periodState: null,
  permissions: { canCreateSource: true, canSubmitSource: true, canEditSource: true, canSummarize: false, canApprove: false, canPublishProgress: false },
};

describe('engineer v2 slip', () => {
  it('shows physical-only read-only resource details as text, not disabled controls', () => {
    const html = renderToStaticMarkup(<DailyLogResourceEditor workItemClientKey="item-1" resourceProviders={[]} readOnly reportOnly
      labor={[{ workItemClientKey:'item-1', laborType:'Tổ bê tông', peopleCount:5, hoursPerPerson:8,
        provider:{entryMode:'manual',manualProviderType:'free_crew',manualProviderName:'Tổ anh Minh'} }]}
      machines={[]} onLaborChange={() => {}} onMachinesChange={() => {}} />);
    expect(html).toContain('40 giờ công'); expect(html).toContain('Tổ anh Minh');
    expect(html).not.toContain('<input'); expect(html).not.toContain('<select');
  });
  it('restores safe raw rows and uses qualified daily quantity, retaining metadata', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={engineerBundle} />);
    expect(html).toContain('value="12,5"');
    expect(html).toContain('52,5');
    expect(html).toContain('Kỹ sư Minh');
    expect(html).toContain('Nội dung cũ');
    expect(html).toContain('Lối vào hẹp');
    expect(html).toContain('/existing-photo.png');
  });
  it('allows an empty safe draft but disables sending without work', () => {
    const bundle = { ...engineerBundle, contribution: { ...engineerBundle.contribution!, sourceDraftPayload: {
      ...engineerBundle.contribution!.sourceDraftPayload!, items: [] } } };
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={bundle} />);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>[\s\S]*?Lưu nháp/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Gửi tổng hợp/);
  });
  it('does not use whole-WBS history when the qualified baseline is unknown', () => {
    const bundle = { ...engineerBundle, quantityBaselines: {}, previousProgressRows: [{ taskId: 'task-1', quantityDone: 90 } as any] };
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={bundle} />);
    expect(html).toContain('Chưa xác định khối lượng trước ngày này');
    expect(html).not.toContain('102,5');
  });
  it('does not label an unevidenced conversion basis as a zero starting quantity', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{...engineerBundle,
      tasks:[{...engineerBundle.tasks[0],fallbackUnit:null,provisionalQuantity:null}],
      quantityBaselines:{'task-1':{...engineerBundle.quantityBaselines['task-1'],state:'none',previousItem:null}},
      contribution:{...engineerBundle.contribution!,sourceDraftPayload:{...engineerBundle.contribution!.sourceDraftPayload!,
        items:[{...engineerBundle.contribution!.sourceDraftPayload!.items[0],entryMode:'percent'}]}} }} />);
    expect(html).toContain('Chưa có cơ sở quy đổi'); expect(html).not.toContain('Trước ngày này: 0');
  });
  it('gives returned slips clear correction and resubmit actions', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...engineerBundle,
      contribution: { ...engineerBundle.contribution!, status: 'returned', returnReason: 'Bổ sung ảnh móng',
        returnedByName: 'CHT Hùng', returnedAt: '2026-09-27T02:30:00Z' } }} />);
    expect(html).toContain('Bổ sung ảnh móng'); expect(html).toContain('CHT Hùng'); expect(html).toContain('09:30');
    expect(html).toContain('Lưu chỉnh sửa'); expect(html).toContain('Gửi lại tổng hợp');
  });
  it('renders submitted physical data as a report, without quantity inputs or save/send actions', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...engineerBundle,
      contribution: { ...engineerBundle.contribution!, status: 'submitted' } }} />);
    expect(html).toContain('Đã gửi để tổng hợp');
    expect(html).not.toContain('Lưu nháp'); expect(html).not.toContain('Gửi tổng hợp');
    expect(html).not.toContain('<input'); expect(html).not.toContain('<textarea');
  });
  it('shows the submitted snapshot basis instead of recalculating with a changed task', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...engineerBundle,
      tasks:[{...engineerBundle.tasks[0], name:'Hạng mục đã đổi tên', fallbackUnit:'m²', provisionalQuantity:200}],
      quantityBaselines:{'task-1':{...engineerBundle.quantityBaselines['task-1'],state:'none',previousItem:null}},
      contribution:{...engineerBundle.contribution!,status:'submitted'},
      workItems:[{id:'snapshot',taskId:'task-1',contributionId:'source-A',ownerType:'contribution',
        taskName:'Bê tông móng giữ nguyên',unit:'m³',plannedQuantity:100,baselineQuantityDone:40,cumulativeProgressPercent:52.5,
        cumulativeQuantityDone:52.5,dailyQuantityDone:12.5} as any] }} />);
    expect(html).toContain('Kế hoạch 100 m³'); expect(html).toContain('52,5 m³'); expect(html).not.toContain('200 m²');
    expect(html).toContain('Bê tông móng giữ nguyên'); expect(html).not.toContain('Hạng mục đã đổi tên');
    expect(html).toContain('Trước ngày này: 40 m³'); expect(html).not.toContain('Trước ngày này: 0');
  });
});

describe('engineer v2 slip withdraw / delete', () => {
  const sent = (permissions: Partial<DailyLogDocumentBundle['permissions']>) => ({ ...engineerBundle,
    contribution: { ...engineerBundle.contribution!, status: 'submitted' as const, submittedAt: '2026-09-27T08:00:00Z' },
    permissions: { ...engineerBundle.permissions, canEditSource: false, canSubmitSource: false, ...permissions } });

  it('offers a never-sent draft for deletion, away from the send actions', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...engineerBundle,
      permissions: { ...engineerBundle.permissions, canDeleteSource: true } }} />);
    expect(html).toContain('Xóa phiếu nháp');
    expect(html).toContain('Khu vực &quot;Khu A&quot; sẽ được bỏ khỏi ngày');
    expect(html.indexOf('Xóa phiếu nháp')).toBeGreaterThan(html.indexOf('Ảnh chung trong ngày'));
  });

  it('hides deletion when the server does not allow it', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={engineerBundle} />);
    expect(html).not.toContain('Xóa phiếu nháp');
  });

  it('lets the author take back a sent slip the summarizer has not taken in', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={sent({ canWithdrawSource: true })} />);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*daily-log-document-button--return[^>]*>[\s\S]*?Rút về sửa/);
    expect(html).toContain('Phiếu đã gửi, chờ người tổng hợp');
    expect(html).not.toContain('Xóa phiếu nháp');
  });

  it('explains who can return a slip that is already in a summary', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={sent({ sourceInSummary: true })} />);
    expect(html).not.toContain('Rút về sửa');
    expect(html).toContain('Đang được tổng hợp');
    expect(html).toContain('nhờ người tổng hợp trả phiếu');
  });

  it('calls a withdrawn slip a resend, not a first send', () => {
    const html = renderToStaticMarkup(<DailyLogContributionWorkEditor bundle={{ ...engineerBundle,
      contribution: { ...engineerBundle.contribution!, submittedAt: '2026-09-27T08:00:00Z' } }} />);
    expect(html).toContain('Gửi lại tổng hợp');
  });
});
